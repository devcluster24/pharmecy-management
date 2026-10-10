"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  emptyPurchaseListSnapshot,
  getPlaceOrderListSnapshot,
  getPurchaseListSnapshot,
  subscribeToPlaceOrderList,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";

const supplierStatusStorageKey = "pharmecy-supplier-status-v1";
type SupplierStatus = "Active" | "Inactive";
type SupplierStatusSnapshot = { statuses: Record<string, SupplierStatus>; error: string };
const emptySupplierStatusSnapshot: SupplierStatusSnapshot = { statuses: {}, error: "" };
let cachedSupplierStatusSnapshot: SupplierStatusSnapshot | null = null;
const supplierStatusListeners = new Set<() => void>();

type SupplierOrder = {
  order: string;
  rows: PurchaseListRow[];
  paidAmount: number | null;
  dueAmount: number | null;
};

type SupplierSummary = {
  key: string;
  name: string;
  phone: string;
  rows: PurchaseListRow[];
  orders: SupplierOrder[];
  purchaseAmount: number;
  dueAmount: number;
  hasUnrecordedDue: boolean;
};

function getOrderTimestamp(orderDate: string, updatedAt?: string) {
  const updatedTimestamp = Date.parse(updatedAt ?? "");
  if (Number.isFinite(updatedTimestamp)) return updatedTimestamp;
  const orderTimestamp = Date.parse(orderDate);
  return Number.isFinite(orderTimestamp) ? orderTimestamp : 0;
}

function formatOrderDate(orderDate: string, updatedAt?: string) {
  const timestamp = getOrderTimestamp(orderDate, updatedAt);
  return timestamp > 0
    ? new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
    : orderDate || "-";
}

function parseAmount(value?: string) {
  if (!value?.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSupplierIdentity(name: string, phone: string) {
  return JSON.stringify([name.trim().toLocaleLowerCase(), phone.replace(/\D/g, "")]);
}

function getSupplierStatusMap(value: unknown): Record<string, SupplierStatus> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const statuses: Record<string, SupplierStatus> = {};
  for (const [key, status] of Object.entries(value)) {
    if (status === "Active" || status === "Inactive") statuses[key] = status;
  }
  return statuses;
}

function readSupplierStatusSnapshot(): SupplierStatusSnapshot {
  try {
    const storedStatuses = localStorage.getItem(supplierStatusStorageKey);
    return {
      statuses: storedStatuses ? getSupplierStatusMap(JSON.parse(storedStatuses)) : {},
      error: "",
    };
  } catch {
    return { statuses: {}, error: "Could not load saved supplier statuses." };
  }
}

function getSupplierStatusSnapshot() {
  if (!cachedSupplierStatusSnapshot) cachedSupplierStatusSnapshot = readSupplierStatusSnapshot();
  return cachedSupplierStatusSnapshot;
}

function subscribeToSupplierStatuses(listener: () => void) {
  supplierStatusListeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key !== supplierStatusStorageKey && event.key !== null) return;
    cachedSupplierStatusSnapshot = readSupplierStatusSnapshot();
    supplierStatusListeners.forEach((notify) => notify());
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    supplierStatusListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function saveSupplierStatus(key: string, status: SupplierStatus) {
  const currentSnapshot = getSupplierStatusSnapshot();
  const statuses = { ...currentSnapshot.statuses, [key]: status };
  localStorage.setItem(supplierStatusStorageKey, JSON.stringify(statuses));
  cachedSupplierStatusSnapshot = { statuses, error: "" };
  supplierStatusListeners.forEach((notify) => notify());
}

export default function SupplierManagementPage() {
  const purchaseList = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const placeOrderList = useSyncExternalStore(
    subscribeToPlaceOrderList,
    getPlaceOrderListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const supplierStatusData = useSyncExternalStore(
    subscribeToSupplierStatuses,
    getSupplierStatusSnapshot,
    () => emptySupplierStatusSnapshot,
  );
  const supplierStatuses = supplierStatusData.statuses;
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);
  const [statusSaveError, setStatusSaveError] = useState("");

  const suppliers = useMemo(() => {
    const supplierMap = new Map<string, Omit<SupplierSummary, "orders" | "purchaseAmount" | "dueAmount" | "hasUnrecordedDue">>();

    for (const row of purchaseList.rows) {
      const name = row.supplierContactName?.trim() || `${row.supplier.trim()} Distributor`;
      if (!name.trim()) continue;
      const phone = row.supplierPhone?.trim() ?? "";
      const key = getSupplierIdentity(name, phone);
      const supplier = supplierMap.get(key) ?? { key, name, phone, rows: [] };
      supplier.rows.push(row);
      supplierMap.set(key, supplier);
    }

    return [...supplierMap.values()]
      .map((supplier): SupplierSummary => {
        const orderMap = new Map<string, PurchaseListRow[]>();
        for (const row of supplier.rows) {
          const orderRows = orderMap.get(row.order) ?? [];
          orderRows.push(row);
          orderMap.set(row.order, orderRows);
        }

        const orders = [...orderMap.entries()].map(([order, rows]) => ({
          order,
          rows,
          paidAmount: rows.map((row) => parseAmount(row.orderPaidAmount)).find((amount) => amount !== null) ?? null,
          dueAmount: rows.map((row) => parseAmount(row.orderDueAmount)).find((amount) => amount !== null) ?? null,
        })).sort((left, right) => {
          const leftRow = left.rows[0];
          const rightRow = right.rows[0];
          return getOrderTimestamp(rightRow.orderDate, rightRow.updatedAt)
            - getOrderTimestamp(leftRow.orderDate, leftRow.updatedAt);
        });
        const ordersWithoutDue = orders.filter((order) => order.dueAmount === null);
        return {
          ...supplier,
          orders,
          purchaseAmount: supplier.rows.reduce((total, row) => total + (parseAmount(row.totalPrice ?? "") ?? 0), 0),
          dueAmount: orders.reduce((total, order) => total + (order.dueAmount ?? 0), 0),
          hasUnrecordedDue: ordersWithoutDue.length > 0,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [purchaseList.rows]);

  const selectedSupplier = suppliers.find((supplier) => supplier.key === selectedSupplierKey) ?? null;
  const activeSupplierCount = suppliers.filter((supplier) => (supplierStatuses[supplier.key] ?? "Active") === "Active").length;
  const openOrderCount = useMemo(
    () => new Set(placeOrderList.rows
      .filter((row) => row.status.toLocaleLowerCase() !== "received")
      .map((row) => row.order),
    ).size,
    [placeOrderList.rows],
  );
  const receivedOrderCount = new Set(purchaseList.rows.map((row) => row.order)).size;

  function toggleSupplierStatus(key: string) {
    const nextStatus = supplierStatuses[key] === "Inactive" ? "Active" : "Inactive";
    try {
      saveSupplierStatus(key, nextStatus);
      setStatusSaveError("");
    } catch {
      setStatusSaveError("Supplier status could not be saved.");
    }
  }

  const pageData: SectionData = {
    description: "Manage supplier contacts, received orders, purchase totals, and account status.",
    action: "",
    metrics: [
      { label: "Active suppliers", value: String(activeSupplierCount), detail: "Contact-based supplier records" },
      { label: "Open orders", value: String(openOrderCount), detail: "Awaiting delivery" },
      { label: "Received orders", value: String(receivedOrderCount), detail: "Purchase orders on record" },
    ],
    columns: ["Supplier Name & Phone Number", "All Order Number", "Total Purchase Amount", "Total Due Amount", "Current Status"],
    rows: suppliers.map((supplier) => {
      const status = supplierStatuses[supplier.key] ?? "Active";
      const dueText = supplier.hasUnrecordedDue
        ? supplier.dueAmount > 0 ? `${formatCurrency(supplier.dueAmount)} (partial)` : "—"
        : formatCurrency(supplier.dueAmount);
      return [
        <div key="supplier" style={{ display: "grid", gap: 4 }}>
          <strong style={{ color: "#26352f", fontSize: 12 }}>{supplier.name}</strong>
          <span style={{ color: "#77857d", fontSize: 11 }}>{supplier.phone || "No phone number"}</span>
        </div>,
        <button
          key="orders"
          type="button"
          onClick={() => setSelectedSupplierKey(supplier.key)}
          style={{ border: "1px solid #cde9dd", borderRadius: 5, background: "#f2faf6", color: "#17704e", padding: "6px 10px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
        >
          View ({supplier.orders.length})
        </button>,
        formatCurrency(supplier.purchaseAmount),
        dueText,
        <button
          key="status"
          type="button"
          aria-label={`Set ${supplier.name} status to ${status === "Active" ? "Inactive" : "Active"}`}
          aria-pressed={status === "Active"}
          onClick={() => toggleSupplierStatus(supplier.key)}
          style={{ minWidth: 84, border: 0, borderRadius: 14, background: status === "Active" ? "#e6f5ee" : "#f2eded", color: status === "Active" ? "#17704e" : "#8e514a", padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          {status}
        </button>,
      ];
    }),
    errorMessage: [purchaseList.error, placeOrderList.error, supplierStatusData.error, statusSaveError].filter(Boolean).join(" "),
  };

  return (
    <DashboardSectionPage
      sectionSlug="suppliers"
      data={pageData}
      content={selectedSupplier && (
        <div
          onClick={() => setSelectedSupplierKey(null)}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "rgba(16, 28, 23, 0.46)", padding: 18 }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-order-history-title"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(900px, 100%)", maxHeight: "85vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}
          >
            <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", borderBottom: "1px solid #e8eeea", background: "#fff", padding: "18px 22px" }}>
              <div>
                <h2 id="supplier-order-history-title" style={{ margin: 0, color: "#172622", fontSize: 18 }}>Supplier order history</h2>
                <p style={{ margin: "6px 0 0", color: "#687871", fontSize: 12 }}>{selectedSupplier.name} · {selectedSupplier.phone || "No phone number"}</p>
              </div>
              <button type="button" onClick={() => setSelectedSupplierKey(null)} aria-label="Close order history" style={{ border: "1px solid #dfe7e2", borderRadius: 6, background: "#fff", color: "#42524b", padding: "7px 10px", cursor: "pointer" }}>Close</button>
            </header>
            <div style={{ display: "grid", gap: 14, padding: 20 }}>
              {selectedSupplier.orders.map((order) => {
                const firstRow = order.rows[0];
                const companies = [...new Set(order.rows.map((row) => row.supplier).filter(Boolean))];
                return (
                  <article key={order.order} style={{ overflow: "hidden", border: "1px solid #e4e9e5", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, background: "#f8faf8", padding: "13px 15px" }}>
                      <div>
                        <strong style={{ color: "#26352f", fontSize: 13 }}>{order.order}</strong>
                        <div style={{ marginTop: 4, color: "#77857d", fontSize: 11 }}>
                          {formatOrderDate(firstRow.orderDate, firstRow.updatedAt)} · {companies.join(", ") || "Company not recorded"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 14, color: "#42524b", fontSize: 11 }}>
                        <span>Paid: <strong>{order.paidAmount === null ? "—" : formatCurrency(order.paidAmount)}</strong></span>
                        <span>Due: <strong>{order.dueAmount === null ? "— (not recorded)" : formatCurrency(order.dueAmount)}</strong></span>
                      </div>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, textAlign: "left" }}>
                        <thead>
                          <tr>
                            {["Company", "Brand / Product", "Batch Number", "Box Quantity", "Total Purchase Price"].map((column) => (
                              <th key={column} style={{ borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 10, fontWeight: 650, padding: "9px 12px", whiteSpace: "nowrap" }}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {order.rows.map((row) => (
                            <tr key={row.id}>
                              <td style={{ borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11, padding: "9px 12px" }}>{row.supplier || "—"}</td>
                              <td style={{ borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 11, padding: "9px 12px" }}>
                                <div>{row.brand || "—"}</div>
                                <div style={{ marginTop: 3, color: "#77857d", fontSize: 10 }}>{[row.strength, row.dosageForm].filter(Boolean).join(" · ")}</div>
                              </td>
                              <td style={{ borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11, padding: "9px 12px" }}>{row.batchNumber || "—"}</td>
                              <td style={{ borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11, padding: "9px 12px" }}>{row.quantity || "—"}</td>
                              <td style={{ borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 11, padding: "9px 12px" }}>{formatCurrency(parseAmount(row.totalPrice) ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    />
  );
}
