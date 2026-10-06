"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  emptyPurchaseListSnapshot,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import {
  emptyLowStockThresholdSnapshot,
  getLowStockThresholdSnapshot,
  subscribeToLowStockThreshold,
} from "./lowStockStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";

const receiveOrderColumns = [
  "Date & Time",
  "Batch Number",
  "Order Number",
  "Supplier",
  "Brand Name",
  "Generic",
  "Strength",
  "Dosage Form",
  "Quantity",
  "Pack Size",
  "Pack Price",
  "Exp Date",
  "Actions",
];
const ORDERS_PER_PAGE = 10;
type InventoryListType = "inventory" | "expire-soon" | "expaired" | "low-stock";
type ExpiryMonthFilter = 1 | 2 | 3;

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
  const [selectedRow, setSelectedRow] = useState<PurchaseListRow | null>(null);
  const [activeList, setActiveList] = useState<InventoryListType>("inventory");
  const [expiryMonthFilter, setExpiryMonthFilter] = useState<ExpiryMonthFilter>(3);
  const [searchQuery, setSearchQuery] = useState("");
  const [paginationState, setPaginationState] = useState({ key: "", page: 1 });
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
  const listRows = activeList === "expire-soon"
    ? sortedRows.filter((row) => expiresWithinSelectedMonths(row.expDate, globalDate, expiryMonthFilter))
    : activeList === "expaired"
      ? sortedRows.filter((row) => isInventoryItemExpired(row.expDate, globalDate))
      : activeList === "low-stock"
        ? lowStockEnabled
          ? sortedRows.filter((row) => {
            const rawQuantity = row.quantity?.trim();
            if (!rawQuantity) return false;
            const quantity = Number(rawQuantity);
            return Number.isFinite(quantity) && quantity <= threshold;
          })
          : []
        : sortedRows;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const rows = normalizedSearchQuery
    ? listRows.filter((row) => [
      row.batchNumber,
      row.order,
      row.supplier,
      row.brand,
      row.genericName,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery)))
    : listRows;
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
          : "Review stock received from your suppliers.",
    errorMessage: purchaseList.error || (activeList === "low-stock" ? lowStockThresholdSnapshot.error : ""),
    action: "Adjust stock",
    metrics: [],
    columns: receiveOrderColumns,
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
        row.quantity ?? "-",
        row.packSize,
        row.packPrice,
        row.expDate,
      ];
      return [
        ...cells.map((value, index) => (
          <span key={`${row.id}-${index}`} style={{
            ...(activeList === "expaired" || (activeList === "low-stock" && index === 8) ? { color: "#dc2626" } : {}),
            ...(activeList === "low-stock" && index === 8 ? { fontWeight: 700 } : {}),
          }}>
            {value}
          </span>
        )),
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
      listTitle=""
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchAccessory={activeList === "expire-soon" ? (
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
      ) : undefined}
      listNavigation={
        <div role="group" aria-label="Inventory list type" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {([
            ["inventory", "Inventory"],
            ["expire-soon", "Expire Soon"],
            ["expaired", "Expaired"],
            ["low-stock", "Low Stock"],
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
    {selectedRow && (
      <div
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedRow(null);
        }}
        style={{ position: "fixed", inset: 0, zIndex: 7, display: "grid", placeItems: "center", padding: 20, background: "rgba(18, 35, 27, 0.45)" }}
      >
        <section
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
              ["Quantity", selectedRow.quantity ?? "-"],
              ["Pack Size", selectedRow.packSize],
              ["Pack Price", selectedRow.packPrice],
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