"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import { usePharmacyStoreName } from "../components/PharmacyDashboardBrand";
import {
  emptyPurchaseListSnapshot,
  getAvailablePurchaseQuantity,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import {
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
  type SalesListRow,
} from "./salesStorage";
import {
  emptyReturnsSnapshot,
  getReturnsSnapshot,
  subscribeToReturns,
  type ReturnRecord,
} from "./returnsStorage";
import {
  emptyLowStockThresholdSnapshot,
  getLowStockThresholdSnapshot,
  subscribeToLowStockThreshold,
} from "./lowStockStorage";
import {
  emptyExpensesSnapshot,
  getExpensesSnapshot,
  subscribeToExpenses,
} from "./expensesStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";
import { getPharmacyDataJson } from "@/lib/pharmacy-data-sync";

type ReportPeriod = "today" | "this-week" | "this-month" | "last-month" | "custom";
type DateRange = { start: Date; end: Date };
type ReportTab = "sales" | "customers" | "suppliers" | "stock" | "returns" | "profit";
type ReportMetric = { label: string; value: string; detail: string; onClick?: () => void };
type ReportDetails = { title: string; columns: string[]; rows: ReactNode[][] };
type DueEntry = { amount: number; createdAt: string; paymentMethod?: string };
type SupplierDueLedgerSnapshot = {
  adjustments: Record<string, DueEntry[]>;
  payments: Record<string, DueEntry[]>;
  error: string;
};
type SupplierSummary = {
  key: string;
  name: string;
  phone: string;
  orders: Map<string, PurchaseListRow[]>;
};
type CustomerSummary = {
  name: string;
  phone: string;
  invoices: SalesListRow[];
  bill: number;
  paid: number;
  due: number;
  latestInvoice: SalesListRow;
};
type ReturnSummary = {
  id: string;
  records: ReturnRecord[];
  customer: string;
  reason: string;
  method: string;
  quantity: number;
  grossAmount: number;
  refundAmount: number;
};

const supplierDueAdjustmentStorageKey = "pharmacy-supplier-due-adjustments-v1";
const supplierDuePaymentStorageKey = "pharmacy-supplier-due-payments-v1";
const supplierDueLedgerUpdatedEvent = "pharmacy-supplier-dues-updated";
const reportsPerPage = 10;
const emptySupplierDueLedgerSnapshot: SupplierDueLedgerSnapshot = {
  adjustments: {},
  payments: {},
  error: "",
};
let cachedSupplierDueLedgerSnapshot: SupplierDueLedgerSnapshot | null = null;

const emptyPageData: SectionData = {
  description: "Detailed business reports in easy-to-understand summaries.",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

const periodOptions: { value: Exclude<ReportPeriod, "custom">; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this-week", label: "This week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
];

const reportTabs: { value: ReportTab; label: string }[] = [
  { value: "sales", label: "Sales Report" },
  { value: "customers", label: "Customer Due" },
  { value: "suppliers", label: "Purchase & Supplier" },
  { value: "stock", label: "Stock & Expiry" },
  { value: "returns", label: "Returns" },
  { value: "profit", label: "Profit & Loss" },
];

function isDueEntry(value: unknown): value is DueEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.amount === "number"
    && Number.isFinite(entry.amount)
    && entry.amount > 0
    && typeof entry.createdAt === "string"
    && Number.isFinite(Date.parse(entry.createdAt))
    && (!("paymentMethod" in entry) || typeof entry.paymentMethod === "string");
}

function parseDueEntries(value: unknown): Record<string, DueEntry[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved supplier due data is invalid.");
  }
  const result: Record<string, DueEntry[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries) || !entries.every(isDueEntry)) {
      throw new Error("Saved supplier due data is invalid.");
    }
    result[key] = entries;
  }
  return result;
}

function readSupplierDueLedgerSnapshot(): SupplierDueLedgerSnapshot {
  try {
    const adjustments = getPharmacyDataJson(supplierDueAdjustmentStorageKey);
    const payments = getPharmacyDataJson(supplierDuePaymentStorageKey);
    return {
      adjustments: adjustments ? parseDueEntries(JSON.parse(adjustments)) : {},
      payments: payments ? parseDueEntries(JSON.parse(payments)) : {},
      error: "",
    };
  } catch (error) {
    return {
      adjustments: {},
      payments: {},
      error: error instanceof Error ? error.message : "Could not load supplier due records.",
    };
  }
}

function getSupplierDueLedgerSnapshot() {
  cachedSupplierDueLedgerSnapshot ??= readSupplierDueLedgerSnapshot();
  return cachedSupplierDueLedgerSnapshot;
}

function subscribeToSupplierDueLedger(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (
      event.key !== supplierDueAdjustmentStorageKey
      && event.key !== supplierDuePaymentStorageKey
      && event.key !== null
    ) return;
    cachedSupplierDueLedgerSnapshot = readSupplierDueLedgerSnapshot();
    listener();
  }
  function handleUpdate() {
    cachedSupplierDueLedgerSnapshot = readSupplierDueLedgerSnapshot();
    listener();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(supplierDueLedgerUpdatedEvent, handleUpdate);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(supplierDueLedgerUpdatedEvent, handleUpdate);
  };
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthRange(date: Date): DateRange {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  };
}

function getPeriodRange(period: ReportPeriod, now: Date, customStart: string, customEnd: string): DateRange | null {
  if (period === "custom") {
    const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customStart);
    const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customEnd);
    if (!startMatch || !endMatch) return null;
    const start = new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3]));
    const end = new Date(Number(endMatch[1]), Number(endMatch[2]) - 1, Number(endMatch[3]));
    if (
      start.getFullYear() !== Number(startMatch[1])
      || start.getMonth() !== Number(startMatch[2]) - 1
      || start.getDate() !== Number(startMatch[3])
      || end.getFullYear() !== Number(endMatch[1])
      || end.getMonth() !== Number(endMatch[2]) - 1
      || end.getDate() !== Number(endMatch[3])
      || start > end
    ) return null;
    return { start, end };
  }
  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end: start };
  }
  if (period === "this-week") {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { start, end: today };
  }
  if (period === "last-month") return getMonthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  };
}

function getPreviousPeriodRange(range: DateRange, period: ReportPeriod): DateRange {
  if (period === "today") {
    const previous = new Date(range.start);
    previous.setDate(previous.getDate() - 1);
    return { start: previous, end: previous };
  }
  if (period === "this-week") {
    const start = new Date(range.start);
    const end = new Date(range.end);
    start.setDate(start.getDate() - 7);
    end.setDate(end.getDate() - 7);
    return { start, end };
  }
  if (period === "this-month") {
    const previousMonthStart = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1);
    const previousMonthEnd = new Date(previousMonthStart.getFullYear(), previousMonthStart.getMonth() + 1, 0);
    const previousRangeEnd = new Date(previousMonthStart);
    previousRangeEnd.setDate(Math.min(range.end.getDate(), previousMonthEnd.getDate()));
    return { start: previousMonthStart, end: previousRangeEnd };
  }
  if (period === "last-month") {
    return getMonthRange(new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1));
  }
  const durationDays = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1;
  const end = new Date(range.start);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - durationDays + 1);
  return { start, end };
}

function getLocalDateKey(value: string) {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnlyMatch) return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return toDateInputValue(new Date(timestamp));
}

function isInRange(value: string, range: DateRange) {
  const dateKey = getLocalDateKey(value);
  return dateKey !== null
    && dateKey >= toDateInputValue(range.start)
    && dateKey <= toDateInputValue(range.end);
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(amount: number) {
  return amount.toLocaleString("en-BD", { maximumFractionDigits: 4 });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-BD", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("en-BD") : value || "—";
}

function downloadCsv(fileName: string, columns: string[], rows: string[][]) {
  const escapeCsvValue = (value: string) => {
    const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  };
  const csvContent = [columns, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getSupplierIdentity(name: string, phone: string) {
  return JSON.stringify([name.trim().toLocaleLowerCase(), phone.replace(/\D/g, "")]);
}

function getPurchaseAmount(row: PurchaseListRow) {
  const amount = Number(row.totalPrice);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function getSavedUnitPurchaseCost(value?: string) {
  if (!value?.trim() || value.trim() === "-") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getSaleDue(sale: SalesListRow) {
  return Math.max(0, sale.dueAmount ?? sale.amount - (sale.paidAmount ?? sale.amount));
}

function getReturnSummary(records: ReturnRecord[]): ReturnSummary[] {
  const groups = new Map<string, ReturnRecord[]>();
  for (const record of records) {
    const id = record.returnId || record.id;
    groups.set(id, [...(groups.get(id) ?? []), record]);
  }
  return [...groups.entries()].map(([id, groupedRecords]) => {
    const refund = groupedRecords.find((record) => record.netRefundAmount !== undefined)?.netRefundAmount
      ?? groupedRecords.reduce((total, record) => total + (record.amount ?? 0), 0);
    return {
      id,
      records: groupedRecords,
      customer: groupedRecords[0]?.customer?.trim() || "Walk-in customer",
      reason: [...new Set(groupedRecords.map((record) => record.reason).filter(Boolean))].join(", ") || "—",
      method: groupedRecords[0]?.returnMethod ?? "Cash Return",
      quantity: groupedRecords.reduce((total, record) => total + (record.quantity ?? 0), 0),
      grossAmount: groupedRecords.reduce((total, record) => total + (record.amount ?? 0), 0),
      refundAmount: refund,
    };
  });
}

function Metrics({ items }: { items: ReportMetric[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
      {items.map((item) => {
        const style = { minHeight: 84, width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e9e5", borderRadius: 7, background: "#fff", padding: "13px 15px", textAlign: "left" as const };
        const content = (
          <>
          <div style={{ color: "#687871", fontSize: 11 }}>{item.label}</div>
          <div style={{ marginTop: 7, color: "#172622", fontSize: 20, fontWeight: 700 }}>{item.value}</div>
          <div style={{ marginTop: 4, color: "#85918c", fontSize: 10 }}>{item.detail}</div>
          {item.onClick && <div style={{ marginTop: 7, color: "#16845f", fontSize: 10, fontWeight: 700 }}>Click to see details</div>}
          </>
        );
        return item.onClick ? (
          <button key={item.label} type="button" onClick={item.onClick} style={{ ...style, cursor: "pointer" }}>{content}</button>
        ) : (
          <article key={item.label} style={style}>{content}</article>
        );
      })}
    </div>
  );
}

function ReportPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section style={{ overflow: "hidden", border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
      <header style={{ padding: "14px 16px", borderBottom: "1px solid #edf0ed" }}>
        <h2 style={{ margin: 0, color: "#26352f", fontSize: 14 }}>{title}</h2>
        {description && <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 11, lineHeight: 1.5 }}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

function ReportTable({
  columns,
  rows,
  emptyMessage,
  onRowClick,
  showPagination = true,
  fitContainer = false,
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyMessage: string;
  onRowClick?: (rowIndex: number) => void;
  showPagination?: boolean;
  fitContainer?: boolean;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / reportsPerPage));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = showPagination
    ? rows.slice((currentPage - 1) * reportsPerPage, currentPage * reportsPerPage)
    : rows;
  return (
    <>
      <div style={{ overflowX: fitContainer ? "hidden" : "auto", width: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: fitContainer ? 0 : 680, tableLayout: fitContainer ? "fixed" : "auto", textAlign: "left" }}>
          <thead>
            <tr>{columns.map((column) => <th key={column} style={{ padding: fitContainer ? "9px 7px" : "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 10, fontWeight: 650, whiteSpace: fitContainer ? "normal" : "nowrap", overflowWrap: fitContainer ? "anywhere" : undefined }}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={`${currentPage}-${rowIndex}`}
                onClick={onRowClick ? () => onRowClick((currentPage - 1) * reportsPerPage + rowIndex) : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick((currentPage - 1) * reportsPerPage + rowIndex);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.map((cell, columnIndex) => <td key={`${rowIndex}-${columnIndex}`} style={{ padding: fitContainer ? "9px 7px" : "10px 12px", borderBottom: rowIndex === visibleRows.length - 1 ? 0 : "1px solid #f0f2f0", color: "#42524b", fontSize: 11, verticalAlign: "top", overflowWrap: fitContainer ? "anywhere" : undefined }}>{cell}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 22, color: "#87928d", fontSize: 12, textAlign: "center" }}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
      {showPagination && (
        <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", color: "#87928d", fontSize: 10 }}>
          <span>{rows.length === 0 ? "Showing 0 records" : `Showing ${(currentPage - 1) * reportsPerPage + 1}-${Math.min(currentPage * reportsPerPage, rows.length)} of ${rows.length} records`}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "5px 8px", fontSize: 10, cursor: currentPage <= 1 ? "not-allowed" : "pointer", opacity: currentPage <= 1 ? 0.5 : 1 }}>Previous</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button type="button" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "5px 8px", fontSize: 10, cursor: currentPage >= totalPages ? "not-allowed" : "pointer", opacity: currentPage >= totalPages ? 0.5 : 1 }}>Next</button>
          </div>
        </footer>
      )}
    </>
  );
}

function PaymentMethodDonut({ entries }: { entries: [string, number][] }) {
  const colors = ["#16845f", "#4e79a7", "#ed9b40", "#9b6ab0", "#d65c5c", "#54a6a6"];
  const chartEntries = entries.map(([method, amount]) => ({ method, amount: Math.max(0, amount) }));
  const total = chartEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 12, minHeight: 220, padding: 16 }}>
      <div style={{ position: "relative", width: 164, height: 164 }}>
        <svg role="img" aria-label="Payment amounts by method" viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#edf2ef" strokeWidth="12" />
          {total > 0 && chartEntries.map(({ method, amount }, index) => {
            const segmentLength = amount / total * circumference;
            const segmentOffset = offset;
            offset += segmentLength;
            return (
              <circle
                key={method}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="12"
                strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                strokeDashoffset={-segmentOffset}
              >
                <title>{`${method}: ${formatCurrency(amount)}`}</title>
              </circle>
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", alignContent: "center", justifyItems: "center", gap: 3, pointerEvents: "none" }}>
          <span style={{ color: "#77857d", fontSize: 10 }}>Recorded paid</span>
          <strong style={{ color: "#26352f", fontSize: 12 }}>{formatCurrency(total)}</strong>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "7px 12px", width: "100%" }}>
        {chartEntries.map(({ method, amount }, index) => (
          <div key={method} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, color: "#526158", fontSize: 10 }}>
            <span aria-hidden="true" style={{ flex: "0 0 8px", width: 8, height: 8, borderRadius: "50%", background: colors[index % colors.length] }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{method}</span>
            <strong style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{formatCurrency(amount)}</strong>
          </div>
        ))}
        {chartEntries.length === 0 && <span style={{ gridColumn: "1 / -1", color: "#87928d", fontSize: 11, textAlign: "center" }}>No payment data for this period.</span>}
      </div>
    </div>
  );
}

function CompanySalesBarChart({ entries }: { entries: { company: string; quantity: number }[] }) {
  const maxQuantity = Math.max(1, ...entries.map((entry) => entry.quantity));
  return (
    <div aria-label="Quantity sold by company" role="img" style={{ display: "grid", alignContent: "start", gap: 12, minWidth: 0, padding: 16 }}>
      <h3 style={{ margin: 0, color: "#26352f", fontSize: 12 }}>Quantity sold by company</h3>
      {entries.length === 0
        ? <p style={{ margin: 0, color: "#87928d", fontSize: 11 }}>No company data available for sold products.</p>
        : entries.map(({ company, quantity }) => (
          <div key={company} style={{ display: "grid", gap: 5, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "#526158", fontSize: 10 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={company}>{company}</span>
              <strong style={{ flex: "0 0 auto" }}>{formatQuantity(quantity)}</strong>
            </div>
            <div aria-hidden="true" style={{ height: 9, overflow: "hidden", borderRadius: 5, background: "#edf2ef" }}>
              <div style={{ width: `${Math.max(2, quantity / maxQuantity * 100)}%`, height: "100%", borderRadius: 5, background: "#16845f" }} />
            </div>
          </div>
        ))}
    </div>
  );
}

function getReturnItemNames(records: ReturnRecord[]) {
  return records.map((record) => {
    const itemName = record.brand || record.product;
    return `${itemName}${record.quantity ? ` × ${record.quantity}` : ""}`;
  }).join(", ");
}

export default function ReportsPage() {
  const storeName = usePharmacyStoreName();
  const sales = useSyncExternalStore(subscribeToSalesList, getSalesListSnapshot, () => emptySalesListSnapshot);
  const purchases = useSyncExternalStore(subscribeToPurchaseList, getPurchaseListSnapshot, () => emptyPurchaseListSnapshot);
  const returns = useSyncExternalStore(subscribeToReturns, getReturnsSnapshot, () => emptyReturnsSnapshot);
  const lowStockThreshold = useSyncExternalStore(
    subscribeToLowStockThreshold,
    getLowStockThresholdSnapshot,
    () => emptyLowStockThresholdSnapshot,
  );
  const expenses = useSyncExternalStore(
    subscribeToExpenses,
    getExpensesSnapshot,
    () => emptyExpensesSnapshot,
  );
  const supplierDueLedger = useSyncExternalStore(
    subscribeToSupplierDueLedger,
    getSupplierDueLedgerSnapshot,
    () => emptySupplierDueLedgerSnapshot,
  );
  const [period, setPeriod] = useState<ReportPeriod>("this-month");
  const [activeTab, setActiveTab] = useState<ReportTab>("sales");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out" | "expiring" | "expired">("all");
  const [customStart, setCustomStart] = useState(() => toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));
  const [selectedInvoice, setSelectedInvoice] = useState<SalesListRow | null>(null);
  const [reportDetails, setReportDetails] = useState<ReportDetails | null>(null);
  const [exportError, setExportError] = useState("");
  const now = new Date();
  const dateRange = getPeriodRange(period, now, customStart, customEnd);
  const selectedSales = dateRange ? sales.rows.filter((sale) => isInRange(sale.createdAt, dateRange)) : [];
  const previousRange = dateRange ? getPreviousPeriodRange(dateRange, period) : null;
  const previousSales = previousRange ? sales.rows.filter((sale) => isInRange(sale.createdAt, previousRange)) : [];
  const salesTotal = selectedSales.reduce((total, sale) => total + sale.amount, 0);
  const previousSalesTotal = previousSales.reduce((total, sale) => total + sale.amount, 0);
  const selectedDiscount = selectedSales.reduce((total, sale) => total + (sale.discountAmount ?? 0), 0);
  const selectedTax = selectedSales.reduce((total, sale) => total + (sale.taxAmount ?? 0), 0);
  const selectedRounding = selectedSales.reduce((total, sale) => total + (sale.cashRoundingAmount ?? 0), 0);
  const selectedPaid = selectedSales.reduce((total, sale) => total + (sale.paidAmount ?? sale.amount), 0);
  const selectedDue = selectedSales.reduce((total, sale) => total + getSaleDue(sale), 0);
  const receivedPurchaseRows = purchases.rows.filter((row) => row.status !== "Placed");
  const periodPurchaseRows = dateRange
    ? receivedPurchaseRows.filter((row) => isInRange(row.orderDate, dateRange))
    : [];
  const periodPurchaseTotal = periodPurchaseRows.reduce((total, row) => total + getPurchaseAmount(row), 0);
  const periodExpenses = dateRange
    ? expenses.rows.filter((expense) => isInRange(expense.date, dateRange))
    : [];
  const periodExpenseTotal = periodExpenses.reduce((total, expense) => total + expense.amount, 0);
  const reportReturns = getReturnSummary(
    dateRange ? returns.rows.filter((record) => isInRange(record.date, dateRange)) : [],
  );
  const reportReturnAmount = reportReturns.reduce((total, record) => total + record.refundAmount, 0);
  const cashRefundAmount = reportReturns.filter((record) => record.method === "Cash Return")
    .reduce((total, record) => total + record.refundAmount, 0);
  const adjustedReturnCount = reportReturns.filter((record) => record.method === "Product Adjust").length;

  const currentStockRows = receivedPurchaseRows;
  const threshold = Number(lowStockThreshold.threshold);
  const lowStockEnabled = Number.isInteger(threshold) && threshold > 0;
  function getStockState(row: PurchaseListRow): "Out of stock" | "Low stock" | "Expired" | "Expiring soon" | "In stock" | "Unknown quantity" {
    const quantity = getAvailablePurchaseQuantity(row);
    if (quantity === null) return "Unknown quantity";
    if (quantity === 0) return "Out of stock";
    if (isInventoryItemExpired(row.expDate, now)) return "Expired";
    const expMatch = /^(\d{4})-(\d{2})$/.exec(row.expDate);
    if (expMatch) {
      const months = Number(expMatch[1]) * 12 + Number(expMatch[2]) - (now.getFullYear() * 12 + now.getMonth() + 1);
      if (months >= 0 && months <= 3) return "Expiring soon";
    }
    if (lowStockEnabled && quantity <= threshold) return "Low stock";
    return "In stock";
  }
  const lowStockRows = currentStockRows.filter((row) => getStockState(row) === "Low stock");
  const outOfStockRows = currentStockRows.filter((row) => getStockState(row) === "Out of stock");
  const expiredRows = currentStockRows.filter((row) => getStockState(row) === "Expired");
  const expiringRows = currentStockRows.filter((row) => getStockState(row) === "Expiring soon");
  const stockRows = currentStockRows.filter((row) => {
    if (stockFilter === "low") return getStockState(row) === "Low stock";
    if (stockFilter === "out") return getStockState(row) === "Out of stock";
    if (stockFilter === "expired") return getStockState(row) === "Expired";
    if (stockFilter === "expiring") return getStockState(row) === "Expiring soon";
    return true;
  }).sort((left, right) => {
    const priority = (state: string) => state === "Expired" ? 0 : state === "Out of stock" ? 1 : state === "Expiring soon" ? 2 : state === "Low stock" ? 3 : 4;
    return priority(getStockState(left)) - priority(getStockState(right))
      || left.brand.localeCompare(right.brand);
  });

  const customers = new Map<string, CustomerSummary>();
  for (const invoice of sales.rows) {
    const name = invoice.customer.trim() || "Walk-in customer";
    const phone = invoice.phone?.trim() ?? "";
    const normalizedPhone = phone.replace(/\D/g, "") || phone.toLocaleLowerCase();
    const key = `${name.toLocaleLowerCase()}\u0000${normalizedPhone}`;
    const customer = customers.get(key);
    if (customer) {
      customer.invoices.push(invoice);
      customer.bill += invoice.amount;
      customer.paid += invoice.paidAmount ?? invoice.amount;
      customer.due += getSaleDue(invoice);
      if (Date.parse(invoice.createdAt) > Date.parse(customer.latestInvoice.createdAt)) customer.latestInvoice = invoice;
    } else {
      customers.set(key, {
        name,
        phone,
        invoices: [invoice],
        bill: invoice.amount,
        paid: invoice.paidAmount ?? invoice.amount,
        due: getSaleDue(invoice),
        latestInvoice: invoice,
      });
    }
  }
  const dueCustomers = [...customers.values()].filter((customer) => customer.due > 0)
    .sort((left, right) => right.due - left.due);
  const customerDueTotal = dueCustomers.reduce((total, customer) => total + customer.due, 0);

  const suppliers = new Map<string, SupplierSummary>();
  for (const row of receivedPurchaseRows) {
    const name = row.supplierContactName?.trim() || `${row.supplier.trim()} Distributor`;
    if (!name.trim()) continue;
    const phone = row.supplierPhone?.trim() ?? "";
    const key = getSupplierIdentity(name, phone);
    const supplier = suppliers.get(key) ?? { key, name, phone, orders: new Map<string, PurchaseListRow[]>() };
    supplier.orders.set(row.order, [...(supplier.orders.get(row.order) ?? []), row]);
    suppliers.set(key, supplier);
  }
  const supplierSummaries = [...suppliers.values()].map((supplier) => {
    const orders = [...supplier.orders.entries()].map(([order, rows]) => {
      const purchase = rows.reduce((total, row) => total + getPurchaseAmount(row), 0);
      const paid = rows.map((row) => Number(row.orderPaidAmount)).find(Number.isFinite) ?? 0;
      return { order, rows, purchase, paid, due: Math.max(0, purchase - paid) };
    });
    const purchasePeriodOrders = orders.filter(({ rows }) => dateRange && isInRange(rows[0]?.orderDate ?? "", dateRange));
    const currentPurchase = orders.reduce((total, order) => total + order.purchase, 0);
    const currentPaid = orders.reduce((total, order) => total + order.paid, 0)
      + (supplierDueLedger.payments[supplier.key] ?? []).reduce((total, payment) => total + payment.amount, 0);
    const currentDue = Math.max(
      0,
      orders.reduce((total, order) => total + order.due, 0)
        + (supplierDueLedger.adjustments[supplier.key] ?? []).reduce((total, adjustment) => total + adjustment.amount, 0)
        - (supplierDueLedger.payments[supplier.key] ?? []).reduce((total, payment) => total + payment.amount, 0),
    );
    return {
      ...supplier,
      orders,
      currentPurchase,
      currentPaid,
      currentDue,
      periodOrders: purchasePeriodOrders,
      periodPurchase: purchasePeriodOrders.reduce((total, order) => total + order.purchase, 0),
      periodPaid: purchasePeriodOrders.reduce((total, order) => total + order.paid, 0),
      periodDue: purchasePeriodOrders.reduce((total, order) => total + order.due, 0),
    };
  }).sort((left, right) => right.currentDue - left.currentDue || left.name.localeCompare(right.name));
  const purchaseOrders = new Map<string, { order: string; supplier: string; date: string; amount: number; paid: number; due: number }>();
  for (const row of periodPurchaseRows) {
    const current = purchaseOrders.get(row.order) ?? {
      order: row.order,
      supplier: row.supplierContactName?.trim() || `${row.supplier.trim()} Distributor`,
      date: row.orderDate,
      amount: 0,
      paid: Number(row.orderPaidAmount) || 0,
      due: 0,
    };
    current.amount += getPurchaseAmount(row);
    purchaseOrders.set(row.order, current);
  }
  for (const order of purchaseOrders.values()) order.due = Math.max(0, order.amount - order.paid);

  const topProducts = new Map<string, { name: string; quantity: number; sales: number }>();
  const productCompanies = new Map<string, string>();
  for (const row of receivedPurchaseRows) {
    const brandKey = row.brand.trim().toLocaleLowerCase();
    const batchKey = row.batchNumber.trim().toLocaleLowerCase();
    const company = row.supplier.trim();
    if (brandKey && batchKey && company && !productCompanies.has(`${brandKey}\u0000${batchKey}`)) {
      productCompanies.set(`${brandKey}\u0000${batchKey}`, company);
    }
  }
  for (const sale of selectedSales) {
    for (const line of sale.lines ?? []) {
      const name = line.brand.trim() || "Unspecified product";
      const product = topProducts.get(name) ?? { name, quantity: 0, sales: 0 };
      product.quantity += line.quantity;
      product.sales += line.totalPrice;
      topProducts.set(name, product);
    }
  }
  const sortedTopProducts = [...topProducts.values()]
    .sort((left, right) => right.sales - left.sales || right.quantity - left.quantity || left.name.localeCompare(right.name))
    .slice(0, 10);
  const topBrandNames = new Set(sortedTopProducts.map((product) => product.name));
  const companySales = new Map<string, number>();
  for (const sale of selectedSales) {
    for (const line of sale.lines ?? []) {
      const brand = line.brand.trim() || "Unspecified product";
      if (!topBrandNames.has(brand)) continue;
      const company = productCompanies.get(`${line.brand.trim().toLocaleLowerCase()}\u0000${line.batchNumber.trim().toLocaleLowerCase()}`) || "Unknown company";
      companySales.set(company, (companySales.get(company) ?? 0) + line.quantity);
    }
  }
  const topProductRows = sortedTopProducts
    .map((product) => [product.name, formatQuantity(product.quantity), formatCurrency(product.sales)]);
  const companySalesEntries = [...companySales.entries()]
    .map(([company, quantity]) => ({ company, quantity }))
    .sort((left, right) => right.quantity - left.quantity || left.company.localeCompare(right.company));
  const paymentMethods = new Map<string, number>();
  for (const sale of selectedSales) {
    const payments = sale.payments?.length
      ? sale.payments
      : [{ methodName: sale.paymentMethodName?.trim() || "Cash", amount: sale.paidAmount ?? sale.amount }];
    for (const payment of payments) {
      paymentMethods.set(payment.methodName || "Cash", (paymentMethods.get(payment.methodName || "Cash") ?? 0) + payment.amount);
    }
  }
  const sortedPaymentMethods = [...paymentMethods.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const paymentMethodRows = sortedPaymentMethods
    .map(([method, amount]) => [method, formatCurrency(amount)]);
  const invoiceRows = [...selectedSales].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((sale) => [
      <button key={`${sale.id}-invoice`} type="button" onClick={() => setSelectedInvoice(sale)} style={{ border: 0, padding: 0, background: "transparent", color: "#16845f", font: "inherit", fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{sale.invoice}</button>,
      sale.customer,
      formatDateValue(sale.createdAt),
      String(sale.items),
      formatCurrency(sale.amount),
      formatCurrency(sale.discountAmount ?? 0),
      `${formatCurrency(sale.taxAmount ?? 0)} (${sale.taxRate ?? 0}%)`,
      formatCurrency(sale.cashRoundingAmount ?? 0),
      formatCurrency(sale.paidAmount ?? sale.amount),
      formatCurrency(getSaleDue(sale)),
      sale.payment,
    ]);

  function openReportDetails(title: string, columns: string[], rows: ReactNode[][]) {
    setReportDetails({ title, columns, rows });
  }

  function openInvoiceDetails(title: string, invoices: SalesListRow[]) {
    openReportDetails(
      title,
      ["Invoice", "Customer", "Date", "Total", "Paid", "Due", "Status"],
      invoices.map((sale) => [
        sale.invoice,
        sale.customer,
        formatDateValue(sale.createdAt),
        formatCurrency(sale.amount),
        formatCurrency(sale.paidAmount ?? sale.amount),
        formatCurrency(getSaleDue(sale)),
        sale.payment,
      ]),
    );
  }

  const purchaseCostsByBatch = new Map<string, PurchaseListRow[]>();
  for (const row of receivedPurchaseRows) {
    const brand = row.brand.trim().toLocaleLowerCase();
    const batch = row.batchNumber.trim().toLocaleLowerCase();
    if (!brand || !batch) continue;
    const key = `${brand}\u0000${batch}`;
    purchaseCostsByBatch.set(key, [...(purchaseCostsByBatch.get(key) ?? []), row]);
  }

  let cogsTotal = 0;
  let cogsCostedLineCount = 0;
  let cogsMissingLineCount = 0;
  let cogsMissingInvoiceDetails = 0;
  const cogsRows: ReactNode[][] = [];
  for (const sale of selectedSales) {
    if (!sale.lines?.length) {
      cogsMissingInvoiceDetails += 1;
      cogsRows.push([sale.invoice, "Product details not saved", "—", "—", "—", "Not available"]);
      continue;
    }
    const saleDateKey = getLocalDateKey(sale.createdAt);
    for (const line of sale.lines) {
      let unitCost = line.unitPurchasePrice ?? null;
      if (unitCost === null && saleDateKey !== null) {
        const brand = line.brand.trim().toLocaleLowerCase();
        const batch = line.batchNumber.trim().toLocaleLowerCase();
        const eligibleCosts = (purchaseCostsByBatch.get(`${brand}\u0000${batch}`) ?? [])
          .filter((row) => {
            const purchaseDateKey = getLocalDateKey(row.orderDate);
            return purchaseDateKey !== null && purchaseDateKey < saleDateKey;
          })
          .map((row) => getSavedUnitPurchaseCost(row.unitPurchasePrice))
          .filter((cost): cost is number => cost !== null);
        const distinctCosts = new Map(eligibleCosts.map((cost) => [cost.toFixed(4), cost]));
        if (distinctCosts.size === 1) unitCost = [...distinctCosts.values()][0];
      }

      const lineCogs = unitCost === null ? null : Number((unitCost * line.quantity).toFixed(2));
      if (lineCogs === null) {
        cogsMissingLineCount += 1;
      } else {
        cogsCostedLineCount += 1;
        cogsTotal += lineCogs;
      }
      cogsRows.push([
        sale.invoice,
        line.brand || "—",
        line.batchNumber || "—",
        formatQuantity(line.quantity),
        unitCost === null ? "Not available" : formatCurrency(unitCost),
        lineCogs === null ? "Not available" : formatCurrency(lineCogs),
      ]);
    }
  }
  cogsTotal = Number(cogsTotal.toFixed(2));
  const cogsIsComplete = cogsMissingLineCount === 0 && cogsMissingInvoiceDetails === 0;
  const cogsCoverageDetail = `${cogsCostedLineCount} of ${cogsCostedLineCount + cogsMissingLineCount} saved product lines costed${cogsMissingInvoiceDetails > 0 ? `; ${cogsMissingInvoiceDetails} invoice(s) have no saved product details` : ""}`;
  const cogsDisplayValue = cogsIsComplete
    ? formatCurrency(cogsTotal)
    : `Partial ${formatCurrency(cogsTotal)}`;
  const estimatedNetProfit = Number((salesTotal - reportReturnAmount - cogsTotal - periodExpenseTotal).toFixed(2));
  const estimatedNetProfitDisplay = cogsIsComplete
    ? formatCurrency(estimatedNetProfit)
    : `Partial ${formatCurrency(estimatedNetProfit)}`;
  const expenseDetailRows = [...periodExpenses]
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt))
    .map((expense) => [
      formatDateValue(expense.date),
      expense.category,
      expense.description,
      expense.paymentMethod,
      formatCurrency(expense.amount),
    ]);

  const exportRows: { columns: string[]; rows: string[][] } = activeTab === "sales"
    ? {
      columns: ["Invoice", "Customer", "Date", "Items", "Total", "Discount", "VAT / TAX", "Cash rounding", "Paid to date", "Due", "Payment status"],
      rows: [...selectedSales].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((sale) => [
        sale.invoice,
        sale.customer,
        formatDateValue(sale.createdAt),
        String(sale.items),
        String(sale.amount),
        String(sale.discountAmount ?? 0),
        String(sale.taxAmount ?? 0),
        String(sale.cashRoundingAmount ?? 0),
        String(sale.paidAmount ?? sale.amount),
        String(getSaleDue(sale)),
        sale.payment,
      ]),
    }
    : activeTab === "customers"
      ? {
        columns: ["Customer", "Phone", "Invoice count", "Total bill", "Paid", "Due", "Last invoice"],
        rows: dueCustomers.map((customer) => [customer.name, customer.phone, String(customer.invoices.length), String(customer.bill), String(customer.paid), String(customer.due), formatDateValue(customer.latestInvoice.createdAt)]),
      }
      : activeTab === "suppliers"
        ? {
          columns: ["Supplier", "Phone", "Orders in period", "Purchase in period", "Paid on period orders", "Due on period orders", "Current total due"],
          rows: supplierSummaries.map((supplier) => [supplier.name, supplier.phone, String(supplier.periodOrders.length), String(supplier.periodPurchase), String(supplier.periodPaid), String(supplier.periodDue), String(supplier.currentDue)]),
        }
        : activeTab === "stock"
          ? {
            columns: ["Product", "Generic", "Batch", "Supplier", "Available quantity", "Expiry", "Status"],
            rows: stockRows.map((row) => [row.brand, row.genericName, row.batchNumber, row.supplierContactName?.trim() || row.supplier, String(getAvailablePurchaseQuantity(row) ?? ""), row.expDate, getStockState(row)]),
          }
          : activeTab === "returns"
            ? {
              columns: ["Return ID", "Date", "Customer", "Products", "Quantity", "Reason", "Method", "Item value", "Net refund"],
              rows: reportReturns.map((record) => [record.id, formatDateValue(record.records[0]?.date ?? ""), record.customer, getReturnItemNames(record.records), String(record.quantity), record.reason, record.method, String(record.grossAmount), String(record.refundAmount)]),
            }
            : {
              columns: ["Profit & Loss item", "Amount / status", "Explanation"],
              rows: [
                ["Sales revenue", String(salesTotal), `${selectedSales.length} invoices`],
                ["Customer returns", String(reportReturnAmount), "Net refund where recorded"],
                ["Purchases received", String(periodPurchaseTotal), "Purchases are not the same as cost of goods sold"],
                ["Cost of goods sold (COGS)", cogsIsComplete ? String(cogsTotal) : `Partial: ${cogsTotal}`, cogsCoverageDetail],
                ["Shop expenses", String(periodExpenseTotal), `${periodExpenses.length} expenses in selected period`],
                ["Estimated net profit / loss", String(estimatedNetProfit), cogsIsComplete ? "Sales less returns, COGS, and recorded expenses" : `Partial: ${cogsCoverageDetail}`],
              ],
            };

  const errors = [sales.error, purchases.error, returns.error, lowStockThreshold.error, supplierDueLedger.error, expenses.error].filter(Boolean);

  let activeReport: ReactNode;
  if (activeTab === "sales") {
    const percentChange = previousSalesTotal > 0 ? (salesTotal - previousSalesTotal) / previousSalesTotal * 100 : null;
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Total sales", value: formatCurrency(salesTotal), detail: `${selectedSales.length} invoices${percentChange === null ? "" : ` · ${percentChange >= 0 ? "Up" : "Down"} ${Math.abs(percentChange).toLocaleString("en-BD", { maximumFractionDigits: 1 })}%`}`, onClick: () => openInvoiceDetails("Invoices in this period", selectedSales) },
          { label: "Discount given", value: formatCurrency(selectedDiscount), detail: "Discount given on these invoices", onClick: () => {
            const discountedSales = selectedSales.filter((sale) => (sale.discountAmount ?? 0) > 0);
            openReportDetails(
              "Invoices with discounts",
              ["Invoice", "Customer", "Date", "Total Discount"],
              discountedSales.map((sale) => [
                sale.invoice,
                sale.customer,
                formatDateValue(sale.createdAt),
                formatCurrency(sale.discountAmount ?? 0),
              ]),
            );
          } },
          { label: "VAT / TAX", value: formatCurrency(selectedTax), detail: "Tax recorded on these invoices", onClick: () => {
            const taxedSales = selectedSales.filter((sale) => (sale.taxAmount ?? 0) > 0);
            openReportDetails(
              "Invoices with VAT / TAX",
              ["Invoice", "Customer", "Date", "Total VAT / TAX"],
              taxedSales.map((sale) => [
                sale.invoice,
                sale.customer,
                formatDateValue(sale.createdAt),
                formatCurrency(sale.taxAmount ?? 0),
              ]),
            );
          } },
          { label: "Cash rounding", value: formatCurrency(selectedRounding), detail: "Positive or negative rounding", onClick: () => {
            const roundedSales = selectedSales.filter((sale) => (sale.cashRoundingAmount ?? 0) !== 0);
            openReportDetails(
              "Invoices with cash rounding",
              ["Invoice", "Customer", "Date", "Total Cash rounding"],
              roundedSales.map((sale) => [
                sale.invoice,
                sale.customer,
                formatDateValue(sale.createdAt),
                formatCurrency(sale.cashRoundingAmount ?? 0),
              ]),
            );
          } },
          { label: "Paid to date", value: formatCurrency(selectedPaid), detail: "Customer payments recorded against these invoices", onClick: () => openInvoiceDetails("Payments against these invoices", selectedSales.filter((sale) => (sale.paidAmount ?? sale.amount) > 0)) },
          { label: "Still due", value: formatCurrency(selectedDue), detail: "Outstanding balance on these invoices", onClick: () => openInvoiceDetails("Invoices with outstanding due", selectedSales.filter((sale) => getSaleDue(sale) > 0)) },
        ]} />
        <ReportPanel title="Payment method summary" description="Payment amounts recorded on invoices in this range. Existing payment history does not store payment dates, so this is not a cash-collection-by-date report.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", alignItems: "center" }}>
            <ReportTable columns={["Payment method", "Recorded paid amount"]} rows={paymentMethodRows} emptyMessage="No recorded payments for these invoices." showPagination={false} fitContainer onRowClick={(rowIndex) => {
              const method = sortedPaymentMethods[rowIndex]?.[0];
              if (!method) return;
              const methodInvoices = selectedSales.filter((sale) => {
                const payments = sale.payments?.length
                  ? sale.payments
                  : [{ methodName: sale.paymentMethodName?.trim() || "Cash", amount: sale.paidAmount ?? sale.amount }];
                return payments.some((payment) => (payment.methodName || "Cash") === method);
              });
              openInvoiceDetails(`${method} payments`, methodInvoices);
            }} />
            <PaymentMethodDonut entries={sortedPaymentMethods} />
          </div>
        </ReportPanel>
        <ReportPanel title="Top 10 selling brands" description="The 10 brands with the highest sales amount in this period. The bar chart groups quantity sold by company for these brands only; company names are matched using the sold batch.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", alignItems: "start" }}>
            <ReportTable columns={["Brand name", "Quantity sold", "Sales amount"]} rows={topProductRows} emptyMessage="No saved product-level sales details in this date range." showPagination={false} fitContainer onRowClick={(rowIndex) => {
              const product = sortedTopProducts[rowIndex];
              if (!product) return;
              const relatedSales = selectedSales.filter((sale) => sale.lines?.some((line) => (line.brand.trim() || "Unspecified product") === product.name));
              openInvoiceDetails(`Invoices containing ${product.name}`, relatedSales);
            }} />
            <CompanySalesBarChart entries={companySalesEntries} />
          </div>
        </ReportPanel>
        <ReportPanel title="Invoice details" description="Click an invoice number to view its items and amounts.">
          <ReportTable columns={["Invoice", "Customer", "Date", "Items", "Total", "Discount", "VAT / TAX", "Rounding", "Paid", "Due", "Status"]} rows={invoiceRows} emptyMessage="No invoices in this date range." />
        </ReportPanel>
      </div>
    );
  } else if (activeTab === "customers") {
    const customerRows = dueCustomers.map((customer) => [
      <span key={`${customer.name}-${customer.phone}`} style={{ display: "grid", gap: 3 }}><strong style={{ color: "#26352f" }}>{customer.name}</strong><span style={{ color: "#77857d" }}>{customer.phone || "No phone number"}</span></span>,
      String(customer.invoices.length),
      formatCurrency(customer.bill),
      formatCurrency(customer.paid),
      <strong key={`${customer.name}-${customer.phone}-due`} style={{ color: "#ad4b43" }}>{formatCurrency(customer.due)}</strong>,
      formatDateValue(customer.latestInvoice.createdAt),
    ]);
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Customers with due", value: String(dueCustomers.length), detail: "All customers with an outstanding balance", onClick: () => openReportDetails("Customers with outstanding due", ["Customer", "Phone", "Invoices", "Bill", "Paid", "Due"], customerRows) },
          { label: "Total customer due", value: formatCurrency(customerDueTotal), detail: "Current balance; not limited to selected dates", onClick: () => openReportDetails("Due by customer", ["Customer", "Phone", "Invoices", "Bill", "Paid", "Due"], customerRows) },
          { label: "Largest customer due", value: formatCurrency(dueCustomers[0]?.due ?? 0), detail: dueCustomers[0]?.name ?? "No outstanding customers", onClick: () => {
            const customer = dueCustomers[0];
            if (customer) openInvoiceDetails(`${customer.name} invoices`, customer.invoices);
          } },
        ]} />
        <ReportPanel title="Customer due list" description="Current outstanding balance across all invoices. Highest due customers appear first.">
          <ReportTable columns={["Customer / Phone", "Invoices", "Total bill", "Paid", "Due", "Last invoice"]} rows={customerRows} emptyMessage="No customers have an outstanding due." onRowClick={(rowIndex) => {
            const customer = dueCustomers[rowIndex];
            if (customer) openInvoiceDetails(`${customer.name} invoices`, customer.invoices);
          }} />
        </ReportPanel>
      </div>
    );
  } else if (activeTab === "suppliers") {
    const supplierRows = supplierSummaries.map((supplier) => [
      <span key={`${supplier.key}-supplier`} style={{ display: "grid", gap: 3 }}><strong style={{ color: "#26352f" }}>{supplier.name}</strong><span style={{ color: "#77857d" }}>{supplier.phone || "No phone number"}</span></span>,
      String(supplier.periodOrders.length),
      formatCurrency(supplier.periodPurchase),
      formatCurrency(supplier.periodPaid),
      formatCurrency(supplier.periodDue),
      <strong key={`${supplier.key}-due`} style={{ color: supplier.currentDue > 0 ? "#ad4b43" : "#17704e" }}>{formatCurrency(supplier.currentDue)}</strong>,
    ]);
    const orderRows = [...purchaseOrders.values()].sort((left, right) => Date.parse(right.date) - Date.parse(left.date)).map((order) => [
      order.order,
      order.supplier,
      formatDateValue(order.date),
      formatCurrency(order.amount),
      formatCurrency(order.paid),
      formatCurrency(order.due),
    ]);
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Purchases received", value: formatCurrency(periodPurchaseTotal), detail: `${periodPurchaseRows.length} received product entries in selected range`, onClick: () => openReportDetails("Received purchase orders", ["Order", "Supplier", "Date", "Purchase", "Paid", "Due"], [...purchaseOrders.values()].map((order) => [order.order, order.supplier, formatDateValue(order.date), formatCurrency(order.amount), formatCurrency(order.paid), formatCurrency(order.due)])) },
          { label: "Suppliers", value: String(supplierSummaries.length), detail: "Suppliers with received stock", onClick: () => openReportDetails("Supplier balances", ["Supplier", "Phone", "Period purchase", "Period due", "Current due"], supplierSummaries.map((supplier) => [supplier.name, supplier.phone || "—", formatCurrency(supplier.periodPurchase), formatCurrency(supplier.periodDue), formatCurrency(supplier.currentDue)])) },
          { label: "Current supplier due", value: formatCurrency(supplierSummaries.reduce((total, supplier) => total + supplier.currentDue, 0)), detail: "Outstanding across all dates, including due payments/adjustments", onClick: () => openReportDetails("Current supplier due", ["Supplier", "Phone", "Current due"], supplierSummaries.filter((supplier) => supplier.currentDue > 0).map((supplier) => [supplier.name, supplier.phone || "—", formatCurrency(supplier.currentDue)])) },
        ]} />
        {supplierDueLedger.error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{supplierDueLedger.error}</p>}
        <ReportPanel title="Supplier summary" description="Period purchase and order payment columns follow the selected date range. Current due includes all dates and saved supplier due payments.">
          <ReportTable columns={["Supplier / Phone", "Orders in period", "Purchase in period", "Paid on period orders", "Due on period orders", "Current total due"]} rows={supplierRows} emptyMessage="No received supplier purchases in this date range." onRowClick={(rowIndex) => {
            const supplier = supplierSummaries[rowIndex];
            if (!supplier) return;
            const orders = supplier.orders.map((order) => [order.order, supplier.name, formatDateValue(order.rows[0]?.orderDate ?? ""), formatCurrency(order.purchase), formatCurrency(order.paid), formatCurrency(order.due)]);
            openReportDetails(`${supplier.name} order details`, ["Order", "Supplier", "Date", "Purchase", "Paid", "Due"], orders);
          }} />
        </ReportPanel>
        <ReportPanel title="Purchase order details" description="Each received order shows its purchase, paid, and remaining due amounts.">
          <ReportTable columns={["Order", "Supplier", "Order date", "Purchase", "Paid", "Due"]} rows={orderRows} emptyMessage="No received orders in this date range." onRowClick={(rowIndex) => {
            const order = [...purchaseOrders.values()].sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[rowIndex];
            if (!order) return;
            const lineRows = periodPurchaseRows.filter((row) => row.order === order.order).map((row) => [row.brand, row.batchNumber, formatQuantity(getAvailablePurchaseQuantity(row) ?? 0), formatCurrency(getPurchaseAmount(row))]);
            openReportDetails(`${order.order} items`, ["Product", "Batch", "Available quantity", "Purchase price"], lineRows);
          }} />
        </ReportPanel>
      </div>
    );
  } else if (activeTab === "stock") {
    const stockRowsData = stockRows.map((row) => [
      <span key={`${row.id}-product`} style={{ display: "grid", gap: 2 }}><strong style={{ color: "#26352f" }}>{row.brand || "—"}</strong><span style={{ color: "#77857d" }}>{[row.genericName, row.strength, row.dosageForm].filter(Boolean).join(" · ") || "No extra details"}</span></span>,
      row.batchNumber || "—",
      row.supplierContactName?.trim() || row.supplier || "—",
      formatQuantity(getAvailablePurchaseQuantity(row) ?? 0),
      row.expDate || "No expiry date",
      <strong key={`${row.id}-status`} style={{ color: getStockState(row) === "In stock" ? "#17704e" : "#ad4b43" }}>{getStockState(row)}</strong>,
    ]);
    const stockFilters: { value: typeof stockFilter; label: string }[] = [
      { value: "all", label: `All stock (${currentStockRows.length})` },
      { value: "low", label: `Low stock (${lowStockEnabled ? lowStockRows.length : "—"})` },
      { value: "out", label: `Out of stock (${outOfStockRows.length})` },
      { value: "expiring", label: `Expiring soon (${expiringRows.length})` },
      { value: "expired", label: `Expired (${expiredRows.length})` },
    ];
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Received batches", value: String(currentStockRows.length), detail: "Current inventory rows", onClick: () => setStockFilter("all") },
          { label: "Low stock", value: lowStockEnabled ? String(lowStockRows.length) : "Not set", detail: lowStockEnabled ? `At or below ${formatQuantity(threshold)} units` : "Set a low-stock threshold in Settings", onClick: () => setStockFilter("low") },
          { label: "Out of stock", value: String(outOfStockRows.length), detail: "Batches with zero available quantity", onClick: () => setStockFilter("out") },
          { label: "Expiring within 3 months", value: String(expiringRows.length), detail: "Based on the batch expiry month", onClick: () => setStockFilter("expiring") },
          { label: "Expired", value: String(expiredRows.length), detail: "Expiry month before the current month", onClick: () => setStockFilter("expired") },
        ]} />
        <ReportPanel title="Stock and expiry details" description="Available quantity is shown for each batch. Expiry is based on the current inventory snapshot.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, padding: "11px 12px", borderBottom: "1px solid #edf0ed" }}>
            {stockFilters.map((filter) => (
              <button key={filter.value} type="button" aria-pressed={stockFilter === filter.value} onClick={() => setStockFilter(filter.value)} style={{ border: `1px solid ${stockFilter === filter.value ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: stockFilter === filter.value ? "#eef8f2" : "#fff", color: stockFilter === filter.value ? "#17704e" : "#526158", padding: "6px 8px", fontSize: 10, fontWeight: 650, cursor: "pointer" }}>{filter.label}</button>
            ))}
          </div>
          {!lowStockEnabled && stockFilter === "low" && <p style={{ margin: 0, padding: "10px 12px", color: "#ad6b28", fontSize: 11 }}>Configure a low-stock threshold in Settings to identify low-stock items.</p>}
          <ReportTable columns={["Product", "Batch", "Supplier", "Available quantity", "Expiry", "Status"]} rows={stockRowsData} emptyMessage={stockFilter === "low" && !lowStockEnabled ? "Low-stock threshold is not configured." : "No stock records match this filter."} onRowClick={(rowIndex) => {
            const row = stockRows[rowIndex];
            if (!row) return;
            openReportDetails(`${row.brand || "Product"} batch details`, ["Field", "Details"], [
              ["Generic name", row.genericName || "—"],
              ["Strength / form", [row.strength, row.dosageForm].filter(Boolean).join(" · ") || "—"],
              ["Batch number", row.batchNumber || "—"],
              ["Supplier", row.supplierContactName?.trim() || row.supplier || "—"],
              ["Available quantity", formatQuantity(getAvailablePurchaseQuantity(row) ?? 0)],
              ["Pack size", row.packSize || "—"],
              ["Expiry date", row.expDate || "—"],
              ["Stock status", getStockState(row)],
            ]);
          }} />
        </ReportPanel>
      </div>
    );
  } else if (activeTab === "returns") {
    const returnRows = reportReturns.sort((left, right) => {
      const leftDate = Date.parse(left.records[0]?.date ?? "");
      const rightDate = Date.parse(right.records[0]?.date ?? "");
      return rightDate - leftDate;
    }).map((record) => [
      record.id,
      formatDateValue(record.records[0]?.date ?? ""),
      record.customer,
      getReturnItemNames(record.records),
      formatQuantity(record.quantity),
      record.reason,
      record.method,
      formatCurrency(record.grossAmount),
      formatCurrency(record.refundAmount),
    ]);
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Return transactions", value: String(reportReturns.length), detail: "Grouped by return transaction ID", onClick: () => openReportDetails("Return transactions", ["Return ID", "Customer", "Products", "Quantity", "Reason", "Method", "Refund"], returnRows) },
          { label: "Returned quantity", value: formatQuantity(reportReturns.reduce((total, record) => total + record.quantity, 0)), detail: "Total units returned in this period", onClick: () => openReportDetails("Returned items", ["Return ID", "Product(s)", "Quantity", "Method"], reportReturns.map((record) => [record.id, getReturnItemNames(record.records), formatQuantity(record.quantity), record.method])) },
          { label: "Cash refund", value: formatCurrency(cashRefundAmount), detail: "Recorded cash return amount", onClick: () => openReportDetails("Cash return details", ["Return ID", "Customer", "Products", "Refund"], reportReturns.filter((record) => record.method === "Cash Return").map((record) => [record.id, record.customer, getReturnItemNames(record.records), formatCurrency(record.refundAmount)])) },
          { label: "Product adjustments", value: String(adjustedReturnCount), detail: "Transactions adjusted with product instead of cash", onClick: () => openReportDetails("Product-adjusted returns", ["Return ID", "Customer", "Products", "Quantity"], reportReturns.filter((record) => record.method === "Product Adjust").map((record) => [record.id, record.customer, getReturnItemNames(record.records), formatQuantity(record.quantity)])) },
          { label: "Total refund amount", value: formatCurrency(reportReturnAmount), detail: "Net refund where recorded; otherwise item return value", onClick: () => openReportDetails("Refund details", ["Return ID", "Customer", "Method", "Net refund"], reportReturns.map((record) => [record.id, record.customer, record.method, formatCurrency(record.refundAmount)])) },
        ]} />
        <ReportPanel title="Return details" description="Return transactions are grouped so each return is counted once.">
          <ReportTable columns={["Return ID", "Date", "Customer", "Product(s)", "Quantity", "Reason", "Method", "Item value", "Net refund"]} rows={returnRows} emptyMessage="No returns in this date range." onRowClick={(rowIndex) => {
            const record = reportReturns[rowIndex];
            if (record) openReportDetails(`${record.id} item details`, ["Product", "Batch", "Quantity", "Item value", "Reason"], record.records.map((item) => [item.brand || item.product, item.batchNumber || "—", formatQuantity(item.quantity ?? 0), formatCurrency(item.amount ?? 0), item.reason]));
          }} />
        </ReportPanel>
      </div>
    );
  } else {
    activeReport = (
      <div style={{ display: "grid", gap: 14 }}>
        <Metrics items={[
          { label: "Sales revenue", value: formatCurrency(salesTotal), detail: `${selectedSales.length} invoices in selected period` },
          { label: "Customer returns", value: formatCurrency(reportReturnAmount), detail: "Net refund where recorded" },
          { label: "Purchases received", value: formatCurrency(periodPurchaseTotal), detail: "Stock purchases; not the same as cost of goods sold" },
          { label: "Cost of goods sold (COGS)", value: cogsDisplayValue, detail: cogsCoverageDetail },
          { label: "Shop expenses", value: formatCurrency(periodExpenseTotal), detail: `${periodExpenses.length} recorded expenses in selected period`, onClick: () => openReportDetails("Shop expenses in selected period", ["Date", "Category", "Description", "Payment method", "Amount"], expenseDetailRows) },
          { label: "Estimated net profit / loss", value: estimatedNetProfitDisplay, detail: cogsIsComplete ? "Sales less returns, COGS, and recorded shop expenses" : `Partial because some COGS is unavailable · ${cogsCoverageDetail}` },
        ]} />
        <ReportPanel title="Cost of goods sold details" description="COGS is calculated as sold quantity multiplied by that batch's unit purchase cost. Purchase cost is saved on new sales; older sales are matched only when one earlier batch cost can be identified.">
          {cogsMissingLineCount > 0 || cogsMissingInvoiceDetails > 0
            ? <p role="status" style={{ margin: 0, padding: "11px 15px", color: "#8a5b20", background: "#fffaf0", borderBottom: "1px solid #edf0ed", fontSize: 11, lineHeight: 1.5 }}>COGS is partial. {cogsCoverageDetail}. Lines with missing or ambiguous batch cost are not included in the amount.</p>
            : <p role="status" style={{ margin: 0, padding: "11px 15px", color: "#17704e", background: "#f2faf5", borderBottom: "1px solid #edf0ed", fontSize: 11, lineHeight: 1.5 }}>All saved product lines in the selected period have a batch purchase cost. {cogsCoverageDetail}.</p>}
          <ReportTable columns={["Invoice", "Brand", "Batch", "Quantity sold", "Unit purchase cost", "COGS"]} rows={cogsRows} emptyMessage="No sales in this date range." />
        </ReportPanel>
        <ReportPanel title="Recorded shop expenses" description="Expenses recorded on the Expenses page and dated within the selected report period.">
          <ReportTable columns={["Date", "Category", "Description", "Payment method", "Amount"]} rows={expenseDetailRows} emptyMessage="No shop expenses recorded in this date range." />
        </ReportPanel>
        <ReportPanel title="About this estimate" description="Net profit is estimated as sales less returns, COGS, and recorded shop expenses.">
          <div style={{ display: "grid", gap: 8, padding: 15, color: "#526158", fontSize: 12, lineHeight: 1.55 }}>
            <p style={{ margin: 0 }}>COGS is shown from recorded unit purchase prices matched to sold batches. Earlier sales without a saved cost are only counted when their purchase batch cost can be matched unambiguously.</p>
            <p style={{ margin: 0 }}>Only expenses entered in the Expenses page are included. If some expenses have not been recorded, the estimate will be higher than actual profit. When COGS is incomplete, the net result is marked partial.</p>
          </div>
        </ReportPanel>
      </div>
    );
  }

  function exportCurrentReport() {
    setExportError("");
    try {
      const rangeLabel = dateRange
        ? `${toDateInputValue(dateRange.start)}-to-${toDateInputValue(dateRange.end)}`
        : "invalid-range";
      const safeStoreName = (storeName || "Pharmacy Cluster")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/[. ]+$/g, "")
        .trim();
      downloadCsv(`${safeStoreName}-${activeTab}-report-${rangeLabel}.csv`, exportRows.columns, exportRows.rows);
    } catch (error) {
      setExportError(error instanceof Error ? `CSV export failed: ${error.message}` : "CSV export failed.");
    }
  }

  const errorMessage = errors.join(" ");
  const pageData: SectionData = {
    ...emptyPageData,
    errorMessage: errorMessage || undefined,
  };

  return (
    <>
      <DashboardSectionPage
        sectionSlug="reports"
        data={pageData}
        hideAction
        content={(
          <div style={{ display: "grid", gap: 16 }}>
            <section aria-label="Report date range" style={{ display: "grid", gap: 12, padding: 15, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
                {periodOptions.map((option) => (
                  <button key={option.value} type="button" aria-pressed={period === option.value} onClick={() => setPeriod(option.value)} style={{ border: `1px solid ${period === option.value ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: period === option.value ? "#eef8f2" : "#fff", color: period === option.value ? "#17704e" : "#526158", padding: "7px 9px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>{option.label}</button>
                ))}
                <button type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")} style={{ border: `1px solid ${period === "custom" ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: period === "custom" ? "#eef8f2" : "#fff", color: period === "custom" ? "#17704e" : "#526158", padding: "7px 9px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>Custom range</button>
                {period === "custom" && (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#526158", fontSize: 10 }}>From <input aria-label="Report start date" type="date" value={customStart} onChange={(event) => setCustomStart(event.currentTarget.value)} style={{ border: "1px solid #dce5df", borderRadius: 5, padding: "6px 7px", color: "#26352f", fontSize: 11 }} /></label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#526158", fontSize: 10 }}>To <input aria-label="Report end date" type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.currentTarget.value)} style={{ border: "1px solid #dce5df", borderRadius: 5, padding: "6px 7px", color: "#26352f", fontSize: 11 }} /></label>
                  </>
                )}
                <div style={{ display: "flex", gap: 7, marginLeft: "auto" }}>
                  <button type="button" disabled={!dateRange} onClick={exportCurrentReport} style={{ border: "1px solid #b9dfd0", borderRadius: 5, background: "#fff", color: "#17704e", padding: "8px 10px", fontSize: 11, fontWeight: 650, cursor: dateRange ? "pointer" : "not-allowed", opacity: dateRange ? 1 : 0.5 }}>Download CSV</button>
                </div>
              </div>
              <div aria-live="polite" style={{ color: dateRange ? "#687871" : "#ad4b43", fontSize: 11 }}>{dateRange ? `Selected period: ${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}` : "Choose a valid date range. The start date must not be after the end date."}</div>
            </section>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 14 }}>
              <nav aria-label="Report sections" style={{ display: "flex", flex: "0 0 190px", flexDirection: "column", gap: 5, padding: 6, border: "1px solid #e4e9e5", borderRadius: 7, background: "#fff" }}>
                {reportTabs.map((tab) => (
                  <button key={tab.value} type="button" aria-pressed={activeTab === tab.value} onClick={() => setActiveTab(tab.value)} style={{ width: "100%", border: 0, borderRadius: 5, background: activeTab === tab.value ? "#eaf6f0" : "transparent", color: activeTab === tab.value ? "#17704e" : "#687871", padding: "10px 11px", fontSize: 11, fontWeight: 700, textAlign: "left", cursor: "pointer" }}>{tab.label}</button>
                ))}
              </nav>
              <div style={{ display: "grid", flex: "1 1 520px", minWidth: 0, gap: 12 }}>
                {exportError && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{exportError}</p>}
                {activeReport}
              </div>
            </div>
          </div>
        )}
      />
      {selectedInvoice && (
        <div onClick={(event) => { if (event.target === event.currentTarget) setSelectedInvoice(null); }} style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 18, background: "rgba(18, 35, 27, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="report-invoice-title" style={{ width: "min(760px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: 9, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "16px 18px", borderBottom: "1px solid #e9eeea" }}>
              <div><h2 id="report-invoice-title" style={{ margin: 0, color: "#20342a", fontSize: 16 }}>Invoice {selectedInvoice.invoice}</h2><p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 11 }}>{selectedInvoice.customer} · {formatDateValue(selectedInvoice.createdAt)}</p></div>
              <button type="button" onClick={() => setSelectedInvoice(null)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#526158", padding: "6px 9px", fontSize: 11, cursor: "pointer" }}>Close</button>
            </header>
            <div style={{ display: "grid", gap: 12, padding: 16 }}>
              <ReportTable columns={["Product", "Details", "Batch", "Quantity", "Unit price", "Total"]} rows={(selectedInvoice.lines ?? []).map((line) => [line.brand, line.details || "—", line.batchNumber || "—", formatQuantity(line.quantity), formatCurrency(line.unitPrice), formatCurrency(line.totalPrice)])} emptyMessage="No saved product details for this invoice." />
              <div style={{ display: "grid", justifyContent: "end", gap: 5, color: "#526158", fontSize: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}><span>Subtotal</span><strong>{formatCurrency(selectedInvoice.subtotalAmount ?? selectedInvoice.amount)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}><span>Discount</span><strong>{formatCurrency(selectedInvoice.discountAmount ?? 0)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}><span>VAT / TAX</span><strong>{formatCurrency(selectedInvoice.taxAmount ?? 0)} ({selectedInvoice.taxRate ?? 0}%)</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}><span>Cash rounding</span><strong>{formatCurrency(selectedInvoice.cashRoundingAmount ?? 0)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 24, paddingTop: 6, borderTop: "1px solid #edf0ed" }}><span>Total / Paid / Due</span><strong>{formatCurrency(selectedInvoice.amount)} / {formatCurrency(selectedInvoice.paidAmount ?? selectedInvoice.amount)} / {formatCurrency(getSaleDue(selectedInvoice))}</strong></div>
              </div>
            </div>
          </section>
        </div>
      )}
      {reportDetails && (
        <div onClick={(event) => { if (event.target === event.currentTarget) setReportDetails(null); }} style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 18, background: "rgba(18, 35, 27, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="report-details-title" style={{ width: "min(900px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: 9, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}>
            <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "15px 18px", borderBottom: "1px solid #e9eeea", background: "#fff" }}>
              <h2 id="report-details-title" style={{ margin: 0, color: "#20342a", fontSize: 15 }}>{reportDetails.title}</h2>
              <button type="button" onClick={() => setReportDetails(null)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#526158", padding: "6px 9px", fontSize: 11, cursor: "pointer" }}>Close</button>
            </header>
            <ReportTable columns={reportDetails.columns} rows={reportDetails.rows} emptyMessage="No details to show." />
          </section>
        </div>
      )}
    </>
  );
}
