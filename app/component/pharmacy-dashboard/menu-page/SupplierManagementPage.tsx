"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  emptyPurchaseListSnapshot,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import {
  emptyPaymentMethodsSnapshot,
  getPaymentMethodsSnapshot,
  subscribeToPaymentMethods,
} from "./paymentMethodsStorage";

const supplierStatusStorageKey = "pharmecy-supplier-status-v1";
const supplierDueAdjustmentStorageKey = "pharmecy-supplier-due-adjustments-v1";
const supplierDuePaymentStorageKey = "pharmecy-supplier-due-payments-v1";
const supplierDueLedgerUpdatedEvent = "pharmecy-supplier-dues-updated";
const SUPPLIERS_PER_PAGE = 10;
type SupplierStatus = "Active" | "Inactive";
type SupplierStatusSnapshot = { statuses: Record<string, SupplierStatus>; error: string };
const emptySupplierStatusSnapshot: SupplierStatusSnapshot = { statuses: {}, error: "" };
let cachedSupplierStatusSnapshot: SupplierStatusSnapshot | null = null;
const supplierStatusListeners = new Set<() => void>();
type SupplierDueAdjustment = { amount: number; createdAt: string; paymentMethod?: string };
type SupplierDueAdjustmentSnapshot = {
  adjustments: Record<string, SupplierDueAdjustment[]>;
  error: string;
};
const emptySupplierDueAdjustmentSnapshot: SupplierDueAdjustmentSnapshot = { adjustments: {}, error: "" };
let cachedSupplierDueAdjustmentSnapshot: SupplierDueAdjustmentSnapshot | null = null;
const supplierDueAdjustmentListeners = new Set<() => void>();
type SupplierDuePaymentSnapshot = {
  payments: Record<string, SupplierDueAdjustment[]>;
  error: string;
};
const emptySupplierDuePaymentSnapshot: SupplierDuePaymentSnapshot = { payments: {}, error: "" };
let cachedSupplierDuePaymentSnapshot: SupplierDuePaymentSnapshot | null = null;
const supplierDuePaymentListeners = new Set<() => void>();

type SupplierOrder = {
  order: string;
  rows: PurchaseListRow[];
  purchaseAmount: number;
  paidAmount: number | null;
  dueAmount: number;
};

type SupplierSummary = {
  key: string;
  name: string;
  phone: string;
  rows: PurchaseListRow[];
  orders: SupplierOrder[];
  purchaseAmount: number;
  paidAmount: number;
  dueAmount: number;
  dueAdjustments: SupplierDueAdjustment[];
  duePayments: SupplierDueAdjustment[];
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

function isSupplierDueAdjustment(value: unknown): value is SupplierDueAdjustment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const adjustment = value as Record<string, unknown>;
  return typeof adjustment.amount === "number"
    && Number.isFinite(adjustment.amount)
    && adjustment.amount > 0
    && typeof adjustment.createdAt === "string"
    && Number.isFinite(Date.parse(adjustment.createdAt))
    && (!("paymentMethod" in adjustment) || typeof adjustment.paymentMethod === "string");
}

function getSupplierDueAdjustmentMap(value: unknown): Record<string, SupplierDueAdjustment[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved supplier due adjustments are invalid.");
  }
  const adjustments: Record<string, SupplierDueAdjustment[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries) || !entries.every(isSupplierDueAdjustment)) {
      throw new Error("Saved supplier due adjustments are invalid.");
    }
    adjustments[key] = entries;
  }
  return adjustments;
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

function readSupplierDueAdjustmentSnapshot(): SupplierDueAdjustmentSnapshot {
  try {
    const storedAdjustments = localStorage.getItem(supplierDueAdjustmentStorageKey);
    return {
      adjustments: storedAdjustments
        ? getSupplierDueAdjustmentMap(JSON.parse(storedAdjustments))
        : {},
      error: "",
    };
  } catch {
    return { adjustments: {}, error: "Could not load saved supplier due adjustments." };
  }
}

function readSupplierDuePaymentSnapshot(): SupplierDuePaymentSnapshot {
  try {
    const storedPayments = localStorage.getItem(supplierDuePaymentStorageKey);
    return {
      payments: storedPayments
        ? getSupplierDueAdjustmentMap(JSON.parse(storedPayments))
        : {},
      error: "",
    };
  } catch {
    return { payments: {}, error: "Could not load saved supplier due payments." };
  }
}

function getSupplierStatusSnapshot() {
  if (!cachedSupplierStatusSnapshot) cachedSupplierStatusSnapshot = readSupplierStatusSnapshot();
  return cachedSupplierStatusSnapshot;
}

function getSupplierDueAdjustmentSnapshot() {
  if (!cachedSupplierDueAdjustmentSnapshot) {
    cachedSupplierDueAdjustmentSnapshot = readSupplierDueAdjustmentSnapshot();
  }
  return cachedSupplierDueAdjustmentSnapshot;
}

function getSupplierDuePaymentSnapshot() {
  if (!cachedSupplierDuePaymentSnapshot) {
    cachedSupplierDuePaymentSnapshot = readSupplierDuePaymentSnapshot();
  }
  return cachedSupplierDuePaymentSnapshot;
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

function subscribeToSupplierDueAdjustments(listener: () => void) {
  supplierDueAdjustmentListeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key !== supplierDueAdjustmentStorageKey && event.key !== null) return;
    cachedSupplierDueAdjustmentSnapshot = readSupplierDueAdjustmentSnapshot();
    supplierDueAdjustmentListeners.forEach((notify) => notify());
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    supplierDueAdjustmentListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function subscribeToSupplierDuePayments(listener: () => void) {
  supplierDuePaymentListeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key !== supplierDuePaymentStorageKey && event.key !== null) return;
    cachedSupplierDuePaymentSnapshot = readSupplierDuePaymentSnapshot();
    supplierDuePaymentListeners.forEach((notify) => notify());
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    supplierDuePaymentListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function saveSupplierStatus(key: string, status: SupplierStatus) {
  const currentSnapshot = getSupplierStatusSnapshot();
  const statuses = { ...currentSnapshot.statuses, [key]: status };
  localStorage.setItem(supplierStatusStorageKey, JSON.stringify(statuses));
  cachedSupplierStatusSnapshot = { statuses, error: "" };
  supplierStatusListeners.forEach((notify) => notify());
  window.dispatchEvent(new Event(supplierDueLedgerUpdatedEvent));
}

function saveSupplierDuePayment(key: string, amount: number, paymentMethod: string) {
  const currentSnapshot = getSupplierDuePaymentSnapshot();
  const payments = {
    ...currentSnapshot.payments,
    [key]: [
      ...(currentSnapshot.payments[key] ?? []),
      { amount, createdAt: new Date().toISOString(), paymentMethod },
    ],
  };
  localStorage.setItem(supplierDuePaymentStorageKey, JSON.stringify(payments));
  cachedSupplierDuePaymentSnapshot = { payments, error: "" };
  supplierDuePaymentListeners.forEach((notify) => notify());
  window.dispatchEvent(new Event(supplierDueLedgerUpdatedEvent));
}

export default function SupplierManagementPage() {
  const purchaseList = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const supplierStatusData = useSyncExternalStore(
    subscribeToSupplierStatuses,
    getSupplierStatusSnapshot,
    () => emptySupplierStatusSnapshot,
  );
  const supplierDueAdjustmentData = useSyncExternalStore(
    subscribeToSupplierDueAdjustments,
    getSupplierDueAdjustmentSnapshot,
    () => emptySupplierDueAdjustmentSnapshot,
  );
  const supplierDuePaymentData = useSyncExternalStore(
    subscribeToSupplierDuePayments,
    getSupplierDuePaymentSnapshot,
    () => emptySupplierDuePaymentSnapshot,
  );
  const paymentMethodsSnapshot = useSyncExternalStore(
    subscribeToPaymentMethods,
    getPaymentMethodsSnapshot,
    () => emptyPaymentMethodsSnapshot,
  );
  const supplierStatuses = supplierStatusData.statuses;
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);
  const [selectedDueSupplierKey, setSelectedDueSupplierKey] = useState<string | null>(null);
  const [dueAdjustmentAmount, setDueAdjustmentAmount] = useState("");
  const [selectedDuePaymentMethod, setSelectedDuePaymentMethod] = useState("cash");
  const [dueAdjustmentError, setDueAdjustmentError] = useState("");
  const [statusSaveError, setStatusSaveError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [paginationState, setPaginationState] = useState({ key: "", page: 1 });

  const suppliers = useMemo(() => {
    const supplierMap = new Map<string, Omit<SupplierSummary, "orders" | "purchaseAmount" | "paidAmount" | "dueAmount" | "dueAdjustments" | "duePayments">>();

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

        const orders = [...orderMap.entries()].map(([order, rows]) => {
          const purchaseAmount = rows.reduce((total, row) => total + (parseAmount(row.totalPrice ?? "") ?? 0), 0);
          const paidAmount = rows.map((row) => parseAmount(row.orderPaidAmount)).find((amount) => amount !== null) ?? null;
          return {
            order,
            rows,
            purchaseAmount,
            paidAmount,
            dueAmount: Math.max(0, purchaseAmount - (paidAmount ?? 0)),
          };
        }).sort((left, right) => {
          const leftRow = left.rows[0];
          const rightRow = right.rows[0];
          return getOrderTimestamp(rightRow.orderDate, rightRow.updatedAt)
            - getOrderTimestamp(leftRow.orderDate, leftRow.updatedAt);
        });
        const dueAdjustments = supplierDueAdjustmentData.adjustments[supplier.key] ?? [];
        const adjustedAmount = dueAdjustments.reduce((total, adjustment) => total + adjustment.amount, 0);
        const duePayments = supplierDuePaymentData.payments[supplier.key] ?? [];
        const paidAdjustmentAmount = duePayments.reduce((total, payment) => total + payment.amount, 0);
        return {
          ...supplier,
          orders,
          purchaseAmount: orders.reduce((total, order) => total + order.purchaseAmount, 0),
          paidAmount: orders.reduce((total, order) => total + (order.paidAmount ?? 0), 0) + paidAdjustmentAmount,
          dueAmount: Math.max(0, orders.reduce((total, order) => total + order.dueAmount, 0) + adjustedAmount - paidAdjustmentAmount),
          dueAdjustments,
          duePayments,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [purchaseList.rows, supplierDueAdjustmentData.adjustments, supplierDuePaymentData.payments]);

  const selectedSupplier = suppliers.find((supplier) => supplier.key === selectedSupplierKey) ?? null;
  const selectedDueSupplier = suppliers.find((supplier) => supplier.key === selectedDueSupplierKey) ?? null;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const normalizedPhoneQuery = searchQuery.replace(/\D/g, "");
  const filteredSuppliers = normalizedSearchQuery
    ? suppliers.filter((supplier) => {
      const nameMatches = supplier.name.toLocaleLowerCase().includes(normalizedSearchQuery);
      const phoneMatches = supplier.phone.toLocaleLowerCase().includes(normalizedSearchQuery)
        || (normalizedPhoneQuery.length > 0 && supplier.phone.replace(/\D/g, "").includes(normalizedPhoneQuery));
      return nameMatches || phoneMatches;
    })
    : suppliers;
  const paginationKey = `${normalizedSearchQuery}:${filteredSuppliers.map((supplier) => supplier.key).join("|")}`;
  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / SUPPLIERS_PER_PAGE));
  const currentPage = Math.min(
    paginationState.key === paginationKey ? paginationState.page : 1,
    totalPages,
  );
  const pageSuppliers = filteredSuppliers.slice(
    (currentPage - 1) * SUPPLIERS_PER_PAGE,
    currentPage * SUPPLIERS_PER_PAGE,
  );
  const parsedDuePaymentAmount = parseAmount(dueAdjustmentAmount) ?? 0;
  const duePaymentPreviewAmount = selectedDueSupplier && parsedDuePaymentAmount <= selectedDueSupplier.dueAmount
    ? parsedDuePaymentAmount
    : 0;
  const duePaymentMethodOptions = [
    { value: "cash", label: "Cash" },
    ...paymentMethodsSnapshot.rows.map((method) => ({
      value: `${method.type}:${method.id}`,
      label: method.type === "mobile" ? method.name : method.bankName,
    })),
  ];
  const effectiveDuePaymentMethod = duePaymentMethodOptions.some((option) => option.value === selectedDuePaymentMethod)
    ? selectedDuePaymentMethod
    : "cash";
  const activeSupplierCount = suppliers.filter((supplier) => (supplierStatuses[supplier.key] ?? "Active") === "Active").length;
  const inactiveSupplierCount = suppliers.length - activeSupplierCount;
  const totalPurchaseAmount = suppliers.reduce((total, supplier) => total + supplier.purchaseAmount, 0);
  const totalDueAmount = suppliers.reduce((total, supplier) => total + supplier.dueAmount, 0);

  function toggleSupplierStatus(key: string) {
    const nextStatus = supplierStatuses[key] === "Inactive" ? "Active" : "Inactive";
    try {
      saveSupplierStatus(key, nextStatus);
      setStatusSaveError("");
    } catch {
      setStatusSaveError("Supplier status could not be saved.");
    }
  }

  function openDueAdjustment(supplierKey: string) {
    setSelectedDueSupplierKey(supplierKey);
    setDueAdjustmentAmount("");
    setSelectedDuePaymentMethod("cash");
    setDueAdjustmentError("");
  }

  function saveDueAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDueAdjustmentError("");
    if (!selectedDueSupplier) return;

    const amount = Number(dueAdjustmentAmount);
    if (!dueAdjustmentAmount.trim() || !Number.isFinite(amount) || amount < 0.01) {
      setDueAdjustmentError("Enter an amount greater than 0.");
      return;
    }
    if (amount > selectedDueSupplier.dueAmount) {
      setDueAdjustmentError("Payment amount cannot be greater than the current due.");
      return;
    }

    try {
      const paymentMethod = duePaymentMethodOptions.find((option) => option.value === effectiveDuePaymentMethod)?.label ?? "Cash";
      saveSupplierDuePayment(selectedDueSupplier.key, Number(amount.toFixed(2)), paymentMethod);
      setSelectedDueSupplierKey(null);
      setDueAdjustmentAmount("");
      setSelectedDuePaymentMethod("cash");
    } catch {
      setDueAdjustmentError("Supplier due adjustment could not be saved.");
    }
  }

  const pageData: SectionData = {
    description: "Manage supplier contacts, received orders, purchase totals, and account status.",
    action: "",
    metrics: [
      { label: "Active suppliers", value: String(activeSupplierCount), detail: "Active supplier contacts" },
      { label: "Inactive suppliers", value: String(inactiveSupplierCount), detail: "Inactive supplier contacts" },
      { label: "Total Purchase", value: formatCurrency(totalPurchaseAmount), detail: "Purchase amount across suppliers" },
      { label: "Due Amount", value: formatCurrency(totalDueAmount), detail: "Outstanding supplier due" },
    ],
    columns: ["Supplier Name & Phone Number", "All Order Number", "Total Purchase Amount", "Total Due Amount", "Current Status"],
    rows: pageSuppliers.map((supplier) => {
      const status = supplierStatuses[supplier.key] ?? "Active";
      const dueText = formatCurrency(supplier.dueAmount);
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
        <button
          key="due"
          type="button"
          aria-label={`Adjust due for ${supplier.name}, currently ${dueText}`}
          onClick={() => openDueAdjustment(supplier.key)}
          style={{ border: 0, background: "transparent", color: supplier.dueAmount > 0 ? "#ad4b43" : "#17704e", padding: 0, fontSize: 12, fontWeight: 650, cursor: "pointer", textAlign: "left", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          {dueText}
        </button>,
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
    listFooter: (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
        <span>
          {filteredSuppliers.length === 0
            ? "Showing 0 suppliers"
            : `Showing ${(currentPage - 1) * SUPPLIERS_PER_PAGE + 1}-${Math.min(currentPage * SUPPLIERS_PER_PAGE, filteredSuppliers.length)} of ${filteredSuppliers.length} suppliers`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPaginationState({ key: paginationKey, page: currentPage - 1 })}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentPage <= 1 ? "not-allowed" : "pointer", opacity: currentPage <= 1 ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={currentPage >= totalPages}
            onClick={() => setPaginationState({ key: paginationKey, page: currentPage + 1 })}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentPage >= totalPages ? "not-allowed" : "pointer", opacity: currentPage >= totalPages ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      </div>
    ),
    errorMessage: [purchaseList.error, supplierStatusData.error, supplierDueAdjustmentData.error, supplierDuePaymentData.error, paymentMethodsSnapshot.error, statusSaveError].filter(Boolean).join(" "),
  };

  return (
    <DashboardSectionPage
      sectionSlug="suppliers"
      data={pageData}
      hideAction
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      content={(selectedSupplier || selectedDueSupplier) && (
        <>
          {selectedSupplier && (
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
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 16px", marginTop: 6, color: "#687871", fontSize: 12 }}>
                      <span>{selectedSupplier.name} · {selectedSupplier.phone || "No phone number"}</span>
                      <span>Total Purchase: <strong style={{ color: "#17704e" }}>{formatCurrency(selectedSupplier.orders.reduce((total, order) => total + order.purchaseAmount, 0))}</strong></span>
                      <span>Total Due: <strong style={{ color: selectedSupplier.dueAmount > 0 ? "#ad4b43" : "#17704e" }}>{formatCurrency(selectedSupplier.dueAmount)}</strong></span>
                    </div>
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
                            <span>Purchase: <strong>{formatCurrency(order.purchaseAmount)}</strong></span>
                            <span>Paid: <strong>{order.paidAmount === null ? "—" : formatCurrency(order.paidAmount)}</strong></span>
                            <span>Due: <strong>{formatCurrency(order.dueAmount)}</strong></span>
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
          {selectedDueSupplier && (
            <div
              onClick={() => setSelectedDueSupplierKey(null)}
              style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "rgba(16, 28, 23, 0.46)", padding: 18 }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="supplier-due-adjustment-title"
                onClick={(event) => event.stopPropagation()}
                style={{ width: "min(460px, 100%)", maxHeight: "85vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", borderBottom: "1px solid #e8eeea", padding: "18px 22px" }}>
                  <div>
                    <h2 id="supplier-due-adjustment-title" style={{ margin: 0, color: "#172622", fontSize: 18 }}>Adjust Supplier Due</h2>
                    <p style={{ margin: "6px 0 0", color: "#687871", fontSize: 12 }}>{selectedDueSupplier.name} · {selectedDueSupplier.phone || "No phone number"}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedDueSupplierKey(null)} aria-label="Close due adjustment" style={{ border: "1px solid #dfe7e2", borderRadius: 6, background: "#fff", color: "#42524b", padding: "7px 10px", cursor: "pointer" }}>Close</button>
                </header>
                <form onSubmit={saveDueAdjustment} style={{ display: "grid", gap: 16, padding: 22 }}>
                  <div style={{ display: "grid", gap: 9, color: "#42524b", fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>Current Total Due</span>
                      <strong>{formatCurrency(selectedDueSupplier.dueAmount - duePaymentPreviewAmount)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>Paid Amount</span>
                      <strong>{formatCurrency(selectedDueSupplier.paidAmount + duePaymentPreviewAmount)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>Current Total Purchase</span>
                      <strong>{formatCurrency(selectedDueSupplier.purchaseAmount)}</strong>
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 7, color: "#526158", fontSize: 12, fontWeight: 650 }}>
                    Adjustment amount
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={dueAdjustmentAmount}
                      onChange={(event) => {
                        setDueAdjustmentAmount(event.currentTarget.value);
                        setDueAdjustmentError("");
                      }}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "10px 11px", color: "#26352f", fontSize: 13 }}
                    />
                  </label>
                  {dueAdjustmentAmount.trim() && (
                    <div role="group" aria-label="Choose payment method" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {duePaymentMethodOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={effectiveDuePaymentMethod === option.value}
                          onClick={() => setSelectedDuePaymentMethod(option.value)}
                          style={{
                            border: `1px solid ${effectiveDuePaymentMethod === option.value ? "#179c70" : "#dce5df"}`,
                            borderRadius: 5,
                            background: effectiveDuePaymentMethod === option.value ? "#eef8f2" : "#fff",
                            color: effectiveDuePaymentMethod === option.value ? "#17704e" : "#526158",
                            padding: "6px 9px",
                            fontSize: 11,
                            fontWeight: 650,
                            cursor: "pointer",
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {paymentMethodsSnapshot.error && dueAdjustmentAmount.trim() && (
                    <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{paymentMethodsSnapshot.error}</p>
                  )}
                  <p style={{ margin: 0, color: "#77857d", fontSize: 11 }}>
                    This payment will increase Paid Amount and reduce Total Due Amount.
                  </p>
                  {selectedDueSupplier.duePayments.length > 0 && (
                    <div style={{ display: "grid", gap: 7, borderTop: "1px solid #edf0ed", paddingTop: 12 }}>
                      <strong style={{ color: "#42524b", fontSize: 11 }}>Previous payments</strong>
                      {selectedDueSupplier.duePayments.slice().reverse().map((payment, index) => (
                        <div key={`${payment.createdAt}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#77857d", fontSize: 11 }}>
                          <span>{new Date(payment.createdAt).toLocaleString()} · {payment.paymentMethod ?? "Not recorded"}</span>
                          <strong style={{ color: "#26352f" }}>{formatCurrency(payment.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDueSupplier.dueAdjustments.length > 0 && (
                    <div style={{ display: "grid", gap: 7, borderTop: "1px solid #edf0ed", paddingTop: 12 }}>
                      <strong style={{ color: "#42524b", fontSize: 11 }}>Previous due adjustments</strong>
                      {selectedDueSupplier.dueAdjustments.slice().reverse().map((adjustment, index) => (
                        <div key={`${adjustment.createdAt}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#77857d", fontSize: 11 }}>
                          <span>{new Date(adjustment.createdAt).toLocaleString()}</span>
                          <strong style={{ color: "#26352f" }}>{formatCurrency(adjustment.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {dueAdjustmentError && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{dueAdjustmentError}</p>}
                  <button type="submit" style={{ border: 0, borderRadius: 6, background: "#16845f", color: "#fff", padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Save Adjustment
                  </button>
                </form>
              </section>
            </div>
          )}
        </>
      )}
    />
  );
}
