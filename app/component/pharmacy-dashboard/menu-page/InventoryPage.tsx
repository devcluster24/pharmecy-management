"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import ExcelExportButton from "../components/ExcelExportButton";
import { confirmDelete } from "@/lib/confirmDelete";
import {
  emptyPurchaseListSnapshot,
  getPurchaseListSnapshot,
  readPurchaseListRows,
  getAvailablePurchaseQuantity,
  calculatePackQuantity,
  calculateTotalQuantity,
  calculateInventoryUnitPrice,
  getInventoryPackPrice,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import { addDestroyExpenseAndRemovePurchaseRow } from "./expensesStorage";
import {
  emptyLowStockThresholdSnapshot,
  getLowStockThresholdSnapshot,
  subscribeToLowStockThreshold,
} from "./lowStockStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";
import {
  emptyReturnsSnapshot,
  getReturnsSnapshot,
  subscribeToReturns,
} from "./returnsStorage";

const receiveOrderColumns = [
  "Date & Time",
  "Batch Number",
  "Order Number",
  "Supplier",
  "Brand Name",
  "Generic",
  "Strength",
  "Dosage Form",
  "Box Quantity",
  "Pack Size",
  "Total Quantity",
  "Unit Price",
  "Pack Price",
  "Exp Date",
  "Actions",
];
const ORDERS_PER_PAGE = 10;
type InventoryListType = "inventory" | "expire-soon" | "expaired" | "low-stock" | "out-of-stock";
type ExpiryMonthFilter = 1 | 2 | 3;

function getCurrentPackQuantity(row: PurchaseListRow) {
  const totalQuantity = getAvailablePurchaseQuantity(row);
  const currentQuantity = totalQuantity === null
    ? null
    : calculatePackQuantity(row.packSize, totalQuantity);
  return currentQuantity?.toLocaleString("en-BD", { maximumFractionDigits: 4 })
    ?? row.quantity
    ?? "-";
}

function getCurrentTotalQuantity(row: PurchaseListRow) {
  if (row.availableQuantity !== undefined) {
    const availableQuantity = Number(row.availableQuantity);
    if (Number.isFinite(availableQuantity) && availableQuantity >= 0) return availableQuantity;
  }

  if (row.quantity === undefined || !row.quantity.trim()) return null;
  const boxQuantity = Number(row.quantity);
  const packMultiplier = calculateTotalQuantity(row.packSize, "1");
  if (!Number.isFinite(boxQuantity) || boxQuantity < 0 || packMultiplier === null) return null;

  const totalQuantity = boxQuantity * packMultiplier;
  return Number.isFinite(totalQuantity) ? Number(totalQuantity.toFixed(4)) : null;
}

function getAvailableStockAmount(row: PurchaseListRow) {
  const totalQuantity = getCurrentTotalQuantity(row);
  if (totalQuantity === null) return null;
  if (totalQuantity === 0) return 0;

  const savedUnitPrice = Number(row.unitPurchasePrice);
  const unitPrice = row.unitPurchasePrice?.trim()
    && row.unitPurchasePrice.trim() !== "-"
    && Number.isFinite(savedUnitPrice)
    && savedUnitPrice >= 0
    ? savedUnitPrice
    : (() => {
      const packQuantity = Number(row.quantity);
      const totalPrice = Number(row.totalPrice);
      const packMultiplier = calculateTotalQuantity(row.packSize, "1");
      if (
        !Number.isFinite(packQuantity)
        || packQuantity <= 0
        || !Number.isFinite(totalPrice)
        || totalPrice < 0
        || packMultiplier === null
      ) return Number.NaN;
      return totalPrice / packQuantity / packMultiplier;
    })();
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;

  const availableValue = totalQuantity * unitPrice;
  return Number.isFinite(availableValue) ? Number(availableValue.toFixed(2)) : null;
}

function getAvailableStockValue(row: PurchaseListRow) {
  const amount = getAvailableStockAmount(row);
  return amount !== null
    ? `৳${amount.toLocaleString("en-BD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
    : "-";
}

function todayInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatDateTime(row: PurchaseListRow) {
  const timestamp = Date.parse(row.updatedAt ?? "");
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }
  return row.orderDate;
}

function expiresWithinSelectedMonths(expDate: string, now: Date, months: ExpiryMonthFilter) {
  const match = /^(\d{4})-(\d{2})$/.exec(expDate);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;

  const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
  const expirationMonth = year * 12 + month;
  const monthsUntilExpiry = expirationMonth - currentMonth;
  return monthsUntilExpiry >= 0 && monthsUntilExpiry <= months;
}

export default function InventoryPage() {
  const purchaseList = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const lowStockThresholdSnapshot = useSyncExternalStore(
    subscribeToLowStockThreshold,
    getLowStockThresholdSnapshot,
    () => emptyLowStockThresholdSnapshot,
  );
  const returns = useSyncExternalStore(
    subscribeToReturns,
    getReturnsSnapshot,
    () => emptyReturnsSnapshot,
  );
  const [selectedRow, setSelectedRow] = useState<PurchaseListRow | null>(null);
  const [selectedReturnBatch, setSelectedReturnBatch] = useState<{ brand: string; batchNumber: string } | null>(null);
  const [activeList, setActiveList] = useState<InventoryListType>("inventory");
  const [expiryMonthFilter, setExpiryMonthFilter] = useState<ExpiryMonthFilter>(3);
  const [searchQuery, setSearchQuery] = useState("");
  const [paginationState, setPaginationState] = useState({ key: "", page: 1 });
  const [actionError, setActionError] = useState("");
  const [destroyingRowId, setDestroyingRowId] = useState<string | null>(null);

  async function handleDestroy(row: PurchaseListRow) {
    setActionError("");
    const amount = getAvailableStockAmount(row);
    if (amount === null || amount < 0) {
      setActionError(`Could not destroy ${row.brand}, batch ${row.batchNumber}: a valid purchase value is required.`);
      return;
    }
    if (!await confirmDelete(
      `Destroy ${row.brand}, batch ${row.batchNumber} and record ৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} as an expense?`,
    )) return;

    setDestroyingRowId(row.id);
    try {
      const currentRows = readPurchaseListRows();
      const currentRow = currentRows.find((item) => item.id === row.id);
      if (!currentRow) throw new Error("This inventory row could not be found. Refresh and try again.");
      if (!isInventoryItemExpired(currentRow.expDate, new Date())) {
        throw new Error("This batch is no longer expired. Refresh the inventory list and try again.");
      }

      const currentAmount = getAvailableStockAmount(currentRow);
      if (currentAmount === null || currentAmount < 0) {
        throw new Error(`Could not destroy ${currentRow.brand}, batch ${currentRow.batchNumber}: a valid purchase value is required.`);
      }
      addDestroyExpenseAndRemovePurchaseRow(
        {
          date: todayInputValue(),
          category: "Destroy",
          description: currentRow.brand.trim() || currentRow.genericName.trim(),
          amount: currentAmount,
          paymentMethod: "",
        },
        currentRows.filter((item) => item.id !== currentRow.id),
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not destroy this inventory row.");
    } finally {
      setDestroyingRowId(null);
    }
  }
  const sortedRows = useMemo(
    () => [...purchaseList.rows].sort((left, right) => {
      const leftTimestamp = Date.parse(left.updatedAt ?? "");
      const rightTimestamp = Date.parse(right.updatedAt ?? "");
      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp !== rightTimestamp) {
        return rightTimestamp - leftTimestamp;
      }
      return right.order.localeCompare(left.order);
    }),
    [purchaseList.rows],
  );
  const globalDate = new Date();
  const threshold = Number(lowStockThresholdSnapshot.threshold);
  const lowStockEnabled = lowStockThresholdSnapshot.threshold.trim() !== ""
    && Number.isInteger(threshold)
    && threshold > 0;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  function getInventoryRows(listType: InventoryListType) {
    const filteredList = listType === "expire-soon"
      ? sortedRows.filter((row) => expiresWithinSelectedMonths(row.expDate, globalDate, expiryMonthFilter))
      : listType === "expaired"
        ? sortedRows.filter((row) => isInventoryItemExpired(row.expDate, globalDate))
        : listType === "low-stock"
          ? lowStockEnabled
            ? sortedRows.filter((row) => {
              const totalQuantity = getCurrentTotalQuantity(row);
              return totalQuantity !== null && totalQuantity <= threshold;
            })
            : []
          : listType === "out-of-stock"
            ? sortedRows.filter((row) => getCurrentTotalQuantity(row) === 0)
            : sortedRows;
    return normalizedSearchQuery
      ? filteredList.filter((row) => [
      row.batchNumber,
      row.order,
      row.supplier,
      row.brand,
      row.genericName,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery)))
      : filteredList;
  }
  const rows = getInventoryRows(activeList);
  const paginationKey = `${activeList}:${expiryMonthFilter}:${threshold}:${rows.map(({ id, updatedAt }) => `${id}:${updatedAt ?? ""}`).join("|")}`;
  const totalPages = Math.max(1, Math.ceil(rows.length / ORDERS_PER_PAGE));
  const currentPage = Math.min(
    paginationState.key === paginationKey ? paginationState.page : 1,
    totalPages,
  );
  const pageRows = rows.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);

  const pageData: SectionData = {
    description: activeList === "expire-soon"
      ? `Review items expiring within the next ${expiryMonthFilter} month${expiryMonthFilter === 1 ? "" : "s"}.`
      : activeList === "expaired"
        ? "Review items that expired before the current month."
        : activeList === "low-stock"
          ? lowStockEnabled
            ? `Items with quantity equal to or below ${threshold} units.`
            : "Low Stock Not Working: enter and save a threshold greater than 0 in Settings."
          : activeList === "out-of-stock"
            ? "Items with zero quantity."
            : "Review stock received from your suppliers.",
    errorMessage: actionError || purchaseList.error || returns.error || (activeList === "low-stock" ? lowStockThresholdSnapshot.error : ""),
    action: "Adjust stock",
    metrics: [],
    columns: receiveOrderColumns,
    rowKeys: pageRows.map((row) => row.id),
    rows: pageRows.map((row) => {
      const cells = [
        formatDateTime(row),
        row.batchNumber,
        row.order,
        row.supplier,
        row.brand,
        row.genericName,
        row.strength,
        row.dosageForm,
        getCurrentPackQuantity(row),
        row.packSize,
        getCurrentTotalQuantity(row)?.toLocaleString("en-BD", { maximumFractionDigits: 4 }) ?? "-",
        calculateInventoryUnitPrice(getInventoryPackPrice(row.mrp), row.packSize),
        getInventoryPackPrice(row.mrp),
        row.expDate,
      ];
      const hasReturnForBatch = returns.rows.some((record) =>
        record.brand?.trim().toLocaleLowerCase() === row.brand.trim().toLocaleLowerCase()
        && record.batchNumber?.trim().toLocaleLowerCase() === row.batchNumber.trim().toLocaleLowerCase(),
      );
      return [
        ...cells.map((value, index) => (
          <span key={`${row.id}-${index}`} style={{
            ...(activeList === "expaired" || ((activeList === "low-stock" || activeList === "out-of-stock") && index === 10) ? { color: "#dc2626" } : {}),
            ...((activeList === "low-stock" || activeList === "out-of-stock") && index === 10 ? { fontWeight: 700 } : {}),
          }}>
            {index === 1 && hasReturnForBatch ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {value}
                <button
                  type="button"
                  aria-label={`View return invoices for ${row.brand}, batch ${row.batchNumber}`}
                  onClick={() => setSelectedReturnBatch({ brand: row.brand, batchNumber: row.batchNumber })}
                  style={{ border: "1px solid #b9dfd0", borderRadius: 4, background: "#fff", color: "#16845f", padding: "2px 5px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                >
                  + Re
                </button>
              </span>
            ) : value}
          </span>
        )),
        ...(activeList === "expaired" ? [
          <button
            key={`${row.id}-destroy`}
            type="button"
            disabled={destroyingRowId === row.id}
            onClick={() => void handleDestroy(row)}
            style={{ marginRight: 6, border: "1px solid #f0d5d3", borderRadius: 5, background: "#fff", color: "#dc2626", padding: "5px 10px", fontSize: 11, fontWeight: 650, cursor: destroyingRowId === row.id ? "wait" : "pointer", opacity: destroyingRowId === row.id ? 0.6 : 1 }}
          >
            {destroyingRowId === row.id ? "Destroying..." : "Destroy"}
          </button>,
        ] : []),
        <button
          key={`${row.id}-view`}
          type="button"
          onClick={() => setSelectedRow(row)}
          style={{ border: "1px solid #b9dfd0", borderRadius: 5, background: "#fff", color: "#16845f", padding: "5px 10px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
        >
          View
        </button>,
      ];
    }),
    listFooter: (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
        <span>
          {rows.length === 0
            ? "Showing 0 items"
            : `Showing ${(currentPage - 1) * ORDERS_PER_PAGE + 1}-${Math.min(currentPage * ORDERS_PER_PAGE, rows.length)} of ${rows.length} items`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPaginationState({ key: paginationKey, page: currentPage - 1 })}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentPage <= 1 ? "not-allowed" : "pointer", opacity: currentPage <= 1 ? 0.5 : 1 }}
          >Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={currentPage >= totalPages}
            onClick={() => setPaginationState({ key: paginationKey, page: currentPage + 1 })}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentPage >= totalPages ? "not-allowed" : "pointer", opacity: currentPage >= totalPages ? 0.5 : 1 }}
          >Next</button>
        </div>
      </div>
    ),
  };

  return (
    <>
    <DashboardSectionPage
      sectionSlug="inventory"
      data={pageData}
      hideAction
      listTitle=""
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchAccessory={(
        <>
          {activeList === "expire-soon" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#687871", fontSize: 12 }}>
              Expiry:
              <select
                aria-label="Filter items expiring within"
                value={expiryMonthFilter}
                onChange={(event) => {
                  const months = Number(event.target.value);
                  if (months === 1 || months === 2 || months === 3) {
                    setExpiryMonthFilter(months);
                  }
                }}
                style={{ border: "1px solid #e0e6e1", borderRadius: 5, background: "#fff", color: "#26352f", padding: "5px 8px", fontSize: 12 }}
              >
                <option value={1}>1 Month</option>
                <option value={2}>2 Months</option>
                <option value={3}>3 Months</option>
              </select>
            </label>
          )}
          <ExcelExportButton
            fileName="Inventory"
            sheets={[
              ["Inventory", "inventory"],
              ["Expire Soon", "expire-soon"],
              ["Expired", "expaired"],
              ["Low Stock", "low-stock"],
              ["Out of Stock", "out-of-stock"],
            ].map(([name, listType]) => ({
              name,
              columns: receiveOrderColumns.slice(0, -1),
              rows: getInventoryRows(listType as InventoryListType).map((row) => [
                formatDateTime(row),
                row.batchNumber,
                row.order,
                row.supplier,
                row.brand,
                row.genericName,
                row.strength,
                row.dosageForm,
                getCurrentPackQuantity(row),
                row.packSize,
                getCurrentTotalQuantity(row) ?? "",
                calculateInventoryUnitPrice(getInventoryPackPrice(row.mrp), row.packSize),
                getInventoryPackPrice(row.mrp),
                row.expDate,
              ]),
            }))}
          />
        </>
      )}
      listNavigation={
        <div className="inventory-list-tabs" role="group" aria-label="Inventory list type" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {([
            ["inventory", "Inventory"],
            ["expire-soon", "Expire Soon"],
            ["expaired", "Expaired"],
            ["low-stock", "Low Stock"],
            ["out-of-stock", "Out of Stock"],
          ] as const).map(([listType, label]) => (
            <button
              key={listType}
              type="button"
              aria-pressed={activeList === listType}
              onClick={() => setActiveList(listType)}
              style={{ border: 0, background: "transparent", color: activeList === listType ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: activeList === listType ? "underline" : "none", textUnderlineOffset: 4, cursor: "pointer" }}
            >
              {label}
            </button>
          ))}
        </div>
      }
    />
    {selectedReturnBatch && (
      <div
        className="inventory-dialog-overlay inventory-return-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedReturnBatch(null);
        }}
        style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 20, background: "rgba(18, 35, 27, 0.45)" }}
      >
        <section
          className="inventory-dialog inventory-return-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-invoice-history-title"
          style={{ width: "min(620px, 100%)", maxHeight: "85vh", overflow: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 22px", borderBottom: "1px solid #e9eeea" }}>
            <div>
              <h2 id="return-invoice-history-title" style={{ margin: 0, color: "#20342a", fontSize: 17, fontWeight: 700 }}>Return Invoice</h2>
              <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>
                {selectedReturnBatch.brand} · Batch {selectedReturnBatch.batchNumber}
              </p>
            </div>
            <button type="button" aria-label="Close return invoices" onClick={() => setSelectedReturnBatch(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
          </header>
          <div style={{ display: "grid", gap: 8, padding: 18 }}>
            {returns.rows
              .filter((record) =>
                record.brand?.trim().toLocaleLowerCase() === selectedReturnBatch.brand.trim().toLocaleLowerCase()
                && record.batchNumber?.trim().toLocaleLowerCase() === selectedReturnBatch.batchNumber.trim().toLocaleLowerCase(),
              )
              .map((record) => (
                <article key={record.id} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px", padding: 12, border: "1px solid #e5ebe7", borderRadius: 7, background: "#fbfcfb", color: "#526158", fontSize: 12 }}>
                  <strong style={{ color: "#26352f" }}>Return Invoice: {record.reInvoice ?? record.id}</strong>
                  <span>Original Invoice: {record.invoice}</span>
                  <span>Brand: {record.brand}</span>
                  <span>Batch Number: {record.batchNumber}</span>
                  <span>Return Quantity: {record.quantity ?? "—"}</span>
                  <span>Customer Name: {record.customer || "Walk-in customer"}</span>
                  <span>Phone Number: {record.phone || "—"}</span>
                  <span>Date: {record.date}</span>
                </article>
              ))}
            {returns.rows.every((record) =>
              record.brand?.trim().toLocaleLowerCase() !== selectedReturnBatch.brand.trim().toLocaleLowerCase()
              || record.batchNumber?.trim().toLocaleLowerCase() !== selectedReturnBatch.batchNumber.trim().toLocaleLowerCase(),
            ) && (
              <p style={{ margin: 0, color: "#77857d", fontSize: 13 }}>No return invoices found for this brand and batch.</p>
            )}
          </div>
        </section>
      </div>
    )}
    {selectedRow && (
      <div
        className="inventory-dialog-overlay inventory-item-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedRow(null);
        }}
        style={{ position: "fixed", inset: 0, zIndex: 7, display: "grid", placeItems: "center", padding: 20, background: "rgba(18, 35, 27, 0.45)" }}
      >
        <section
          className="inventory-dialog inventory-item-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-item-title"
          style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
            <div>
              <h2 id="inventory-item-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Inventory item · {selectedRow.brand}</h2>
              <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Order {selectedRow.order}</p>
            </div>
            <button type="button" aria-label="Close item details" onClick={() => setSelectedRow(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr", gap: "12px 20px", margin: 0, padding: 24, color: "#34453b", fontSize: 13 }}>
            {[
              ["Date & Time", formatDateTime(selectedRow)],
              ["Batch Number", selectedRow.batchNumber],
              ["Supplier", selectedRow.supplier],
              ["Generic", selectedRow.genericName],
              ["Strength", selectedRow.strength],
              ["Dosage Form", selectedRow.dosageForm],
              ["Box Quantity", getCurrentPackQuantity(selectedRow)],
              ["Pack Size", selectedRow.packSize],
              ["Total Quantity", getCurrentTotalQuantity(selectedRow)?.toLocaleString("en-BD", { maximumFractionDigits: 4 }) ?? "-"],
              ["Unit Price", calculateInventoryUnitPrice(getInventoryPackPrice(selectedRow.mrp), selectedRow.packSize)],
              ...(activeList === "expaired" ? [["Price", getAvailableStockValue(selectedRow)]] : []),
              ["Pack Price", getInventoryPackPrice(selectedRow.mrp)],
              ["Exp Date", selectedRow.expDate],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt style={{ color: "#77857d" }}>{label}</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    )}
    </>
  );
}