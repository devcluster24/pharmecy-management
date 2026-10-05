"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import PurchaseCreateAction from "./PurchaseCreateAction";
import {
  calculateUnitPurchasePrice,
  emptyPurchaseListSnapshot,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
  emptyPurchaseListSnapshot as emptyPlaceOrderSnapshot,
  getPlaceOrderListSnapshot,
  subscribeToPlaceOrderList,
} from "./purchaseStorage";

const placeOrderColumns = [
  "Order",
  "Supplier",
  "Order date",
  "Brand",
];
const receiveOrderColumns = [
  "Date & Time",
  "Order Number",
  "Supplier",
  "Total Purchase Amount",
  "Actions",
];
type ListType = "place" | "receive";
const ORDERS_PER_PAGE = 10;

function formatMonthYear(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[1].slice(-2)}` : value;
}

function getOrderTotal(rows: PurchaseListRow[]) {
  return rows.reduce((total, row) => {
    const amount = Number(row.totalPrice);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupOrders(rows: PurchaseListRow[]) {
  const groupedOrders = new Map<string, PurchaseListRow[]>();
  for (const row of rows) {
    const orderRows = groupedOrders.get(row.order) ?? [];
    orderRows.push(row);
    groupedOrders.set(row.order, orderRows);
  }
  return [...groupedOrders.entries()]
    .map(([order, orderRows]) => ({
      order,
      rows: orderRows,
      updatedAt: orderRows.reduce((latest, row) => {
        const timestamp = Date.parse(row.updatedAt ?? "");
        return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
      }, 0),
    }))
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
      const leftSequence = Number(/^PO(?:-RC)?-(\d+)$/.exec(left.order)?.[1] ?? 0);
      const rightSequence = Number(/^PO(?:-RC)?-(\d+)$/.exec(right.order)?.[1] ?? 0);
      return rightSequence - leftSequence;
    });
}

export default function PurchasePage() {
  const purchaseList = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const placeOrderList = useSyncExternalStore(
    subscribeToPlaceOrderList,
    getPlaceOrderListSnapshot,
    () => emptyPlaceOrderSnapshot,
  );
  const [activeList, setActiveList] = useState<ListType>("place");
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [paginationState, setPaginationState] = useState({ key: "", page: 1 });
  const placeOrders = useMemo(() => groupOrders(placeOrderList.rows), [placeOrderList.rows]);
  const receiveOrders = useMemo(() => groupOrders(purchaseList.rows), [purchaseList.rows]);
  const orders = activeList === "place" ? placeOrders : receiveOrders;
  const paginationKey = `${activeList}:${orders.map(({ order, updatedAt }) => `${order}:${updatedAt}`).join("|")}`;
  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PER_PAGE));
  const currentPage = Math.min(
    paginationState.key === paginationKey ? paginationState.page : 1,
    totalPages,
  );
  const pageOrders = orders.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);
  const activeError = activeList === "place" ? placeOrderList.error : purchaseList.error;
  const selectedOrderRows = selectedOrder
    ? orders.find((order) => order.order === selectedOrder)?.rows ?? []
    : [];

  const pageData: SectionData = {
    description: "Track placed orders and received stock from your suppliers.",
    errorMessage: activeError,
    action: "Receive Order",
    metrics: [],
    columns: activeList === "receive" ? receiveOrderColumns : placeOrderColumns,
    rows: pageOrders.map(({ order, rows, updatedAt }) => {
      const suppliers = [...new Set(rows.map((row) => row.supplier))].join(", ");
      const viewButton = (
        <button
          type="button"
          onClick={() => setSelectedOrder(order)}
          style={{ border: "1px solid #b9dfd0", borderRadius: 5, background: "#fff", color: "#16845f", padding: "5px 10px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
        >
          View
        </button>
      );
      if (activeList === "receive") {
        const updatedDate = updatedAt > 0 ? new Date(updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : rows[0]?.orderDate ?? "";
        return [
          updatedDate,
          order,
          suppliers,
          formatCurrency(getOrderTotal(rows)),
          <div key={`${order}-actions`} style={{ display: "flex", alignItems: "center", gap: 10 }}>{viewButton}</div>,
        ];
      }
      return [
        order,
        suppliers,
        rows[0]?.orderDate ?? "",
        <div key={`${order}-actions`} style={{ display: "flex", alignItems: "center", gap: 10 }}>{viewButton}</div>,
      ];
    }),
    listFooter: orders.length > ORDERS_PER_PAGE ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
        <span>Showing {(currentPage - 1) * ORDERS_PER_PAGE + 1}-{Math.min(currentPage * ORDERS_PER_PAGE, orders.length)} of {orders.length} orders</span>
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
    ) : undefined,
  };

  return (
    <>
      <DashboardSectionPage
        sectionSlug="purchase"
        data={pageData}
        listTitle=""
        listNavigation={
          <div role="group" aria-label="Purchase list type" style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {([
              ["place", "Place Order List"],
              ["receive", "Receive Order List"],
            ] as const).map(([listType, label]) => (
              <button
                key={listType}
                type="button"
                aria-pressed={activeList === listType}
                onClick={() => {
                  setActiveList(listType);
                  setSelectedOrder(null);
                }}
                style={{ border: 0, background: "transparent", color: activeList === listType ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: activeList === listType ? "underline" : "none", textUnderlineOffset: 4, cursor: "pointer" }}
              >
                {label}
              </button>
            ))}
          </div>
        }
        actionContent={<PurchaseCreateAction />}
      />
      {selectedOrder && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedOrder(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.56)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-history-title"
            style={{ width: "min(1040px, 100%)", maxHeight: "85vh", overflow: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="purchase-history-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Order history · {selectedOrder}</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>All brands and batches in this purchase order.</p>
              </div>
              <button type="button" aria-label="Close order history" onClick={() => setSelectedOrder(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ overflowX: "auto", padding: 24 }}>
              <table aria-label={`Purchase history for ${selectedOrder}`} style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Supplier", "Brand", "Pack Price", "Generic Name", "Strength", "Dosage Form", "Batch Number", "Mfg Date", "Exp Date", "Box MRP", "Box Quantity", "Pack Size", "Unit Price", "Purchase Price (Box)", "Total Purchase Price", "Unit Purchase Price", "Status"].map((heading) => (
                      <th key={heading} scope="col" style={{ padding: "10px 12px", borderBottom: "1px solid #dce5df", background: "#f4f7f5", color: "#687871", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedOrderRows.map((row) => (
                    <tr key={row.id}>
                      {[
                        row.supplier,
                        row.brand,
                        row.productPackPrice ?? "-",
                        row.genericName,
                        row.strength,
                        row.dosageForm,
                        row.batchNumber,
                        formatMonthYear(row.mfgDate),
                        formatMonthYear(row.expDate),
                        row.mrp ?? "-",
                        row.quantity ?? "-",
                        row.packSize,
                        row.unitPrice,
                        row.packPrice,
                        row.totalPrice ? `৳${Number(row.totalPrice).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-",
                        calculateUnitPurchasePrice(row.packSize, row.totalPrice ?? "", row.quantity ?? "") === "-"
                          ? "-"
                          : `৳${Number(calculateUnitPurchasePrice(row.packSize, row.totalPrice ?? "", row.quantity ?? "")).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                        row.status,
                      ].map((value, cellIndex) => (
                        <td key={cellIndex} style={{ padding: "10px 12px", borderBottom: "1px solid #e8ede9", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {activeList === "receive" && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 24px 20px", color: "#20342a", fontSize: 13, fontWeight: 650 }}>
                Total Purchase Amount: {formatCurrency(getOrderTotal(selectedOrderRows))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
