"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import ExcelExportButton from "../components/ExcelExportButton";
import {
  emptyReturnsSnapshot,
  getReturnsSnapshot,
  saveReturnRecordsAndInventory,
  subscribeToReturns,
} from "./returnsStorage";
import { getPurchaseRowsAfterReturn } from "./purchaseStorage";
import {
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
  type SalesInvoiceItem,
  type SalesListRow,
} from "./salesStorage";
import {
  emptyReturnDeductionSettingsSnapshot,
  getReturnDeductionSettingsSnapshot,
  subscribeToReturnDeductionSettings,
} from "./returnDeductionStorage";

type ReturnItemMatch = {
  key: string;
  invoice: SalesListRow;
  line: SalesInvoiceItem;
};

type SelectedReturnItem = ReturnItemMatch & { quantity: string };
const RETURNS_PER_PAGE = 10;

const pageData: SectionData = {
  description: "Review returned products and keep return adjustments traceable.",
  action: "Record Return",
  metrics: [],
  columns: ["Return ID", "Date & Time", "Customer Name & Phone Number", "Re-Invoice", "Invoice", "Product", "Return Qty", "Amount", "Return Method"],
  rows: [],
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "9px 10px",
  fontSize: 13,
};

function getProductStrength(details: string) {
  return details.split(" · ").filter(Boolean)[1] ?? "";
}

function getReInvoice(invoice: string) {
  const invoiceNumber = /(\d+)$/.exec(invoice)?.[1];
  return `RET-${invoiceNumber ?? invoice}`;
}

function getReBatch(batchNumber: string) {
  return `Re-${batchNumber || "N/A"}`;
}

function isSameMonth(dateValue: string, year: number, month: number) {
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return false;
  const date = new Date(timestamp);
  return date.getFullYear() === year && date.getMonth() === month;
}

export default function ReturnSystemPage() {
  const sales = useSyncExternalStore(
    subscribeToSalesList,
    getSalesListSnapshot,
    () => emptySalesListSnapshot,
  );
  const returns = useSyncExternalStore(
    subscribeToReturns,
    getReturnsSnapshot,
    () => emptyReturnsSnapshot,
  );
  const returnDeductionSettings = useSyncExternalStore(
    subscribeToReturnDeductionSettings,
    getReturnDeductionSettingsSnapshot,
    () => emptyReturnDeductionSettingsSnapshot,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [returnListPage, setReturnListPage] = useState(1);
  const [searchValue, setSearchValue] = useState("");
  const [selectedItems, setSelectedItems] = useState<SelectedReturnItem[]>([]);
  const [returnDeductionRate, setReturnDeductionRate] = useState("0");
  const [returnAmountOverride, setReturnAmountOverride] = useState<string | null>(null);
  const [returnMethod, setReturnMethod] = useState<"Cash Return" | "Product Adjust">("Cash Return");
  const [customerName, setCustomerName] = useState("Walk-in customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [selectedSalesInvoice, setSelectedSalesInvoice] = useState<SalesListRow | null>(null);
  const [isMobileBillOpen, setIsMobileBillOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModalOpen(false);
        setIsMobileBillOpen(false);
        setSelectedReturnId(null);
        setSelectedSalesInvoice(null);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const matchingInvoices = normalizedSearch
    ? sales.rows.filter((invoice) => invoice.invoice.toLocaleLowerCase().includes(normalizedSearch))
    : [];
  const matchingInvoiceIds = new Set(matchingInvoices.map((invoice) => invoice.id));
  const matchingItems: ReturnItemMatch[] = normalizedSearch
    ? sales.rows.flatMap((invoice) =>
        (invoice.lines ?? []).flatMap((line, index) =>
          (matchingInvoiceIds.size > 0
            ? matchingInvoiceIds.has(invoice.id)
            : line.brand.toLocaleLowerCase().includes(normalizedSearch))
          && !selectedItems.some((selected) => selected.key === `${invoice.id}-${line.batchNumber}-${index}`)
          ? [{ key: `${invoice.id}-${line.batchNumber}-${index}`, invoice, line }]
          : [],
        ),
      )
    : [];
  const totalReturnAmount = selectedItems.reduce(
    (total, item) => total + item.line.unitPrice * (Number(item.quantity) || 0),
    0,
  );
  const totalReturnUnits = selectedItems.reduce(
    (total, item) => total + (Number(item.quantity) || 0),
    0,
  );
  const deductionRate = Number(returnDeductionRate) || 0;
  const returnDeductionAmount = totalReturnAmount * deductionRate / 100;
  const netRefundAmount = Math.max(0, totalReturnAmount - returnDeductionAmount);
  const returnAmount = returnAmountOverride ?? (returnMethod === "Cash Return" ? netRefundAmount.toFixed(2) : "0");

  function openModal() {
    setSearchValue("");
    setSelectedItems([]);
    setReturnDeductionRate(String(returnDeductionSettings.defaultRate));
    setReturnAmountOverride(null);
    setReturnMethod("Cash Return");
    setCustomerName("Walk-in customer");
    setCustomerPhone("");
    setIsMobileBillOpen(false);
    setError(returnDeductionSettings.error);
    setIsModalOpen(true);
  }

  function recordReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (selectedItems.length === 0) {
      setError("Search and add at least one invoice product.");
      return;
    }
    const invalidItem = selectedItems.find(({ line, quantity: returnQty }) => {
      const quantity = Number(returnQty);
      return !Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity;
    });
    if (invalidItem) {
      setError(`Return quantity must be between 1 and ${invalidItem.line.quantity} for ${invalidItem.line.brand}.`);
      return;
    }
    const date = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const lastReturnId = returns.rows.reduce((highest, record) => {
      const match = /^RE-ID-(\d+)$/i.exec(record.returnId ?? "");
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const lastRecordId = returns.rows.reduce((highest, record) => {
      const match = /^RET-(\d+)$/i.exec(record.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 124);
    const returnId = `RE-ID-${String(lastReturnId + 1).padStart(4, "0")}`;
    const newRecords = selectedItems.map(({ invoice, line, quantity }, index) => ({
      id: `RET-${String(lastRecordId + index + 1).padStart(4, "0")}`,
      returnId,
      invoice: invoice.invoice,
      reInvoice: getReInvoice(invoice.invoice),
      reBatch: getReBatch(line.batchNumber),
      product: `${line.brand} · Qty ${Number(quantity)} · Batch ${line.batchNumber || "-"}`,
      brand: line.brand,
      batchNumber: line.batchNumber,
      quantity: Number(quantity),
      amount: Number((line.unitPrice * Number(quantity)).toFixed(2)),
      ...(index === 0 ? { netRefundAmount: Number(returnAmount) || 0 } : {}),
      customer: customerName.trim() || "Walk-in customer",
      phone: customerPhone.trim(),
      returnMethod,
      date,
      reason: "Product return",
      status: "Pending",
    }));
    const nextRecords = [...newRecords, ...returns.rows];
    try {
      const purchaseRows = getPurchaseRowsAfterReturn(selectedItems.map(({ line, quantity }) => ({
        brand: line.brand,
        batchNumber: line.batchNumber,
        quantity: Number(quantity),
      })));
      saveReturnRecordsAndInventory(nextRecords, purchaseRows);
      setIsModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this return.");
    }
  }

  const normalizedListSearch = searchQuery.trim().toLocaleLowerCase();
  const matchingReturnRecords = normalizedListSearch
    ? returns.rows.filter((record) => [
      record.returnId ?? record.id,
      record.reInvoice ?? getReInvoice(record.invoice),
      record.invoice,
      record.product,
      record.batchNumber ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(normalizedListSearch)))
    : returns.rows;
  const returnRowCount = matchingReturnRecords.length;
  const returnPageCount = Math.max(1, Math.ceil(returnRowCount / RETURNS_PER_PAGE));
  const currentReturnPage = Math.min(returnListPage, returnPageCount);
  const pageRecords = matchingReturnRecords.slice((currentReturnPage - 1) * RETURNS_PER_PAGE, currentReturnPage * RETURNS_PER_PAGE);
  const returnRows: ReactNode[][] = [
    ...pageRecords.map((record) => {
      const returnId = record.returnId ?? record.id;
      const originalInvoice = sales.rows.find((sale) => sale.invoice === record.invoice);
      return [
        <button
          key={`${record.id}-return-id`}
          type="button"
          onClick={() => setSelectedReturnId(returnId)}
          style={{ border: 0, background: "transparent", color: "#16845f", padding: 0, fontSize: 12, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}
        >
          {returnId}
        </button>,
        record.date,
        <span key={`${record.id}-customer`} style={{ display: "grid", gap: 3 }}>
          <span>{record.customer || "Walk-in customer"}</span>
          {record.phone && <span style={{ color: "#77857d", fontSize: 11 }}>{record.phone}</span>}
        </span>,
        record.reInvoice ?? getReInvoice(record.invoice),
        <span key={`${record.id}-invoice-cell`} className="return-invoice-cell">
          <span className="return-desktop-invoice">{record.invoice}</span>
          {originalInvoice && (
            <button
              key={`${record.id}-invoice`}
              className="return-mobile-invoice-link"
              type="button"
              onClick={() => setSelectedSalesInvoice(originalInvoice)}
            >
              {record.invoice}
            </button>
          )}
          {!originalInvoice && <span className="return-mobile-invoice-fallback">{record.invoice}</span>}
        </span>,
        record.product,
        record.quantity ?? "—",
        record.amount === undefined
          ? "—"
          : `৳${record.amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        record.returnMethod ?? "Cash Return",
      ];
    }),
  ];
  const selectedReturnRecords = selectedReturnId
    ? returns.rows.filter((record) => (record.returnId ?? record.id) === selectedReturnId)
    : [];
  const now = new Date();
  const currentMonthRecords = returns.rows.filter((record) =>
    isSameMonth(record.date, now.getFullYear(), now.getMonth()),
  );
  const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthRecords = returns.rows.filter((record) =>
    isSameMonth(record.date, previousMonthDate.getFullYear(), previousMonthDate.getMonth()),
  );
  const getInvoiceCount = (records: typeof returns.rows) =>
    new Set(records.map((record) => record.returnId ?? record.id)).size;
  const currentMonthInvoiceCount = getInvoiceCount(currentMonthRecords);
  const previousMonthInvoiceCount = getInvoiceCount(previousMonthRecords);
  const returnsMonthComparison = previousMonthInvoiceCount === 0
    ? currentMonthInvoiceCount === 0 ? "No returns last month" : "New returns this month"
    : currentMonthInvoiceCount === previousMonthInvoiceCount
      ? "Same as last month"
      : `${Math.round(Math.abs(currentMonthInvoiceCount - previousMonthInvoiceCount) / previousMonthInvoiceCount * 100)}% ${currentMonthInvoiceCount > previousMonthInvoiceCount ? "more" : "less"} than last month`;
  const currentMonthReturnGroups = new Map<string, typeof currentMonthRecords>();
  for (const record of currentMonthRecords) {
    const groupKey = record.returnId ?? record.id;
    currentMonthReturnGroups.set(groupKey, [...(currentMonthReturnGroups.get(groupKey) ?? []), record]);
  }
  const refundedThisMonth = [...currentMonthReturnGroups.values()].reduce((total, records) => {
    const savedNetRefund = records.find((record) => record.netRefundAmount !== undefined)?.netRefundAmount;
    return total + (savedNetRefund ?? records.reduce((amount, record) => amount + (record.amount ?? 0), 0));
  }, 0);
  const returnedBrands = new Map<string, number>();
  for (const record of currentMonthRecords) {
    if (!record.brand) continue;
    returnedBrands.set(record.brand, (returnedBrands.get(record.brand) ?? 0) + (record.quantity ?? 0));
  }
  const returnedBrandCount = returnedBrands.size;
  const totalReturnedQuantity = [...returnedBrands.values()].reduce((total, quantity) => total + quantity, 0);
  const metrics = [
    {
      label: "Returns this month",
      value: String(currentMonthInvoiceCount),
      detail: returnsMonthComparison,
    },
    {
      label: "Return Brands",
      value: String(returnedBrandCount),
      detail: `Total Quantity: ${totalReturnedQuantity}`,
    },
    {
      label: "Refunded",
      value: `৳${refundedThisMonth.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      detail: "This month",
    },
  ];
  const data: SectionData = {
    ...pageData,
    errorMessage: sales.error || returns.error || error || undefined,
    metrics,
    rows: returnRows,
    rowKeys: pageRecords.map((record) => record.id),
    listFooter: (
      <div className="return-list-pagination" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
        <span>
          {returnRowCount === 0
            ? "Showing 0 records"
            : `Showing ${(currentReturnPage - 1) * RETURNS_PER_PAGE + 1}-${Math.min(currentReturnPage * RETURNS_PER_PAGE, returnRowCount)} of ${returnRowCount} records`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            aria-label="Previous returns page"
            disabled={currentReturnPage <= 1}
            onClick={() => setReturnListPage(Math.max(1, currentReturnPage - 1))}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentReturnPage <= 1 ? "not-allowed" : "pointer", opacity: currentReturnPage <= 1 ? 0.5 : 1 }}
          >Previous</button>
          <span>Page {currentReturnPage} of {returnPageCount}</span>
          <button
            type="button"
            aria-label="Next returns page"
            disabled={currentReturnPage >= returnPageCount}
            onClick={() => setReturnListPage(Math.min(returnPageCount, currentReturnPage + 1))}
            style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: currentReturnPage >= returnPageCount ? "not-allowed" : "pointer", opacity: currentReturnPage >= returnPageCount ? 0.5 : 1 }}
          >Next</button>
        </div>
      </div>
    ),
  };

  return (
    <DashboardSectionPage
      sectionSlug="returns"
      data={data}
      searchValue={searchQuery}
      onSearchChange={(value) => {
        setSearchQuery(value);
        setReturnListPage(1);
      }}
      searchAccessory={(
        <ExcelExportButton
          fileName="Returns"
          sheets={[{
            name: "Returns",
            columns: ["Return ID", "Date & Time", "Customer", "Phone", "Re-Invoice", "Invoice", "Product", "Return Quantity", "Amount", "Net Refund", "Return Method"],
            rows: matchingReturnRecords.map((record) => [
              record.returnId ?? record.id,
              record.date,
              record.customer || "Walk-in customer",
              record.phone ?? "",
              record.reInvoice ?? getReInvoice(record.invoice),
              record.invoice,
              record.product,
              record.quantity ?? "",
              record.amount ?? "",
              record.netRefundAmount ?? "",
              record.returnMethod ?? "Cash Return",
            ]),
          }]}
        />
      )}
      actionContent={(
        <button
          className="return-record-launch-button"
          type="button"
          onClick={openModal}
          style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}
        >
          Record Return
        </button>
      )}
      content={selectedReturnId ? (
        <div
          className="return-details-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedReturnId(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            className="return-details-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-id-details-title"
            style={{ width: "min(900px, 100%)", maxHeight: "85vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="return-id-details-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Return Invoices · {selectedReturnId}</h2>
                {selectedReturnRecords[0] && (
                  <p style={{ margin: "6px 0 0", color: "#687871", fontSize: 12 }}>
                    Customer: {selectedReturnRecords[0].customer || "Walk-in customer"}
                    {selectedReturnRecords[0].phone && ` · Phone: ${selectedReturnRecords[0].phone}`}
                  </p>
                )}
              </div>
              <button type="button" aria-label="Close Return ID details" onClick={() => setSelectedReturnId(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <div style={{ display: "grid", gap: 10, padding: 20 }}>
              {selectedReturnRecords.map((record) => (
                <article key={record.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px 16px", padding: 12, border: "1px solid #e5ebe7", borderRadius: 7, background: "#fbfcfb", color: "#526158", fontSize: 12 }}>
                  <span><strong>Date & Time:</strong> {record.date}</span>
                  <span><strong>Re-Invoice:</strong> {record.reInvoice ?? getReInvoice(record.invoice)}</span>
                  <span><strong>Invoice:</strong> {record.invoice}</span>
                  <span><strong>Product:</strong> {record.product}</span>
                  <span><strong>Batch:</strong> {record.batchNumber || "—"}</span>
                  <span><strong>Qty:</strong> {record.quantity ?? "—"}</span>
                  <span><strong>Amount:</strong> {record.amount === undefined ? "—" : `৳${record.amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                </article>
              ))}
              {selectedReturnRecords[0] && (
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, padding: 12, borderTop: "1px solid #e5ebe7", color: "#526158", fontSize: 12 }}>
                  <strong>
                    Net Refund Amount: {selectedReturnRecords[0].netRefundAmount === undefined
                      ? "—"
                      : `৳${selectedReturnRecords[0].netRefundAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </strong>
                  <strong>Return Method: {selectedReturnRecords[0].returnMethod ?? "Cash Return"}</strong>
                </div>
              )}
              {selectedReturnRecords.length === 0 && (
                <p style={{ margin: 0, color: "#77857d", fontSize: 13 }}>No saved return invoices found for this Return ID.</p>
              )}
            </div>
          </section>
        </div>
      ) : selectedSalesInvoice ? (
        <div
          className="return-sales-invoice-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSalesInvoice(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 95, display: "grid", placeItems: "center", overflowY: "auto", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            className="return-sales-invoice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-sales-invoice-title"
            style={{ width: "min(1100px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 20px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <p style={{ margin: "0 0 4px", color: "#16845f", fontSize: 10, fontWeight: 700 }}>{selectedSalesInvoice.customer || "Walk-in customer"}{selectedSalesInvoice.phone ? ` · ${selectedSalesInvoice.phone}` : ""}</p>
                <h2 id="return-sales-invoice-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Sales Invoice · {selectedSalesInvoice.invoice}</h2>
              </div>
              <button type="button" aria-label="Close sales invoice" onClick={() => setSelectedSalesInvoice(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <div className="return-sales-invoice-body" style={{ padding: 20 }}>
              <div className="return-sales-invoice-meta" style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16, color: "#526158", fontSize: 12 }}>
                <span>Date: {new Date(selectedSalesInvoice.createdAt).toLocaleString("en-BD")}</span>
                <span>Payment: {selectedSalesInvoice.paymentMethodName ?? "Cash"}</span>
                <span>Status: {selectedSalesInvoice.payment}</span>
              </div>
              <div className="return-sales-invoice-table-scroll" style={{ overflowX: "auto", border: "1px solid #edf0ed", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr>
                      {["Product", "Details", "Batch", "Qty", "Unit price", "Total"].map((heading) => (
                        <th key={heading} style={{ padding: "8px 10px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 10, whiteSpace: "nowrap" }}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSalesInvoice.lines ?? []).map((line, index) => (
                      <tr key={`${line.batchNumber}-${index}`}>
                        {[line.brand, line.details || "-", line.batchNumber || "-", String(line.quantity), `৳${line.unitPrice.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, `৳${line.totalPrice.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`].map((value, cellIndex) => (
                          <td key={cellIndex} style={{ padding: "8px 10px", borderBottom: index === (selectedSalesInvoice.lines?.length ?? 0) - 1 ? 0 : "1px solid #f0f2f0", color: "#34453b", fontSize: 11, whiteSpace: cellIndex === 1 ? "normal" : "nowrap", overflowWrap: "anywhere" }}>{value}</td>
                        ))}
                      </tr>
                    ))}
                    {(!selectedSalesInvoice.lines || selectedSalesInvoice.lines.length === 0) && (
                      <tr><td colSpan={6} style={{ padding: 16, color: "#87928d", fontSize: 11, textAlign: "center" }}>No item details are available for this invoice.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="return-sales-invoice-total" style={{ display: "grid", justifyContent: "end", gap: 5, marginTop: 14, color: "#526158", fontSize: 11 }}>
                <span>Subtotal: ৳{(selectedSalesInvoice.subtotalAmount ?? selectedSalesInvoice.amount).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                {(selectedSalesInvoice.discountAmount ?? 0) > 0 && <span>Discount: −৳{selectedSalesInvoice.discountAmount?.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                {(selectedSalesInvoice.taxAmount ?? 0) > 0 && <span>VAT/TAX: ৳{selectedSalesInvoice.taxAmount?.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                {(selectedSalesInvoice.cashRoundingAmount ?? 0) !== 0 && <span>Cash rounding: ৳{selectedSalesInvoice.cashRoundingAmount?.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                <strong style={{ color: "#16845f", fontSize: 13 }}>Grand total: ৳{selectedSalesInvoice.amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span>Paid: ৳{(selectedSalesInvoice.paidAmount ?? selectedSalesInvoice.amount).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span>Due: ৳{(selectedSalesInvoice.dueAmount ?? 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <footer className="return-sales-invoice-footer" style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid #e9eeea" }}>
              <button type="button" onClick={() => setSelectedSalesInvoice(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Close</button>
            </footer>
          </section>
        </div>
      ) : isModalOpen ? (
        <div
          className="return-record-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsModalOpen(false);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            className="return-record-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-return-title"
            style={{ display: "flex", flexDirection: "column", width: "min(1100px, 100%)", height: "calc(100vh - 32px)", maxHeight: "calc(100vh - 32px)", overflow: "hidden", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <header className="return-record-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: "1px solid #e9eeea" }}>
              <h2 id="record-return-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Record Return</h2>
              <div className="return-record-header-actions">
                <button className="return-mobile-bill-button" type="button" aria-label="Open bill summary" onClick={() => setIsMobileBillOpen(true)}>Bill</button>
                <button type="button" aria-label="Close Record Return" onClick={() => setIsModalOpen(false)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
            </header>
            <form className="return-record-form" onSubmit={recordReturn} style={{ display: "flex", flex: 1, flexDirection: "column", gap: 14, minHeight: 0, padding: 20 }}>
              {isMobileBillOpen && (
                <button
                  type="button"
                  className="return-mobile-bill-backdrop"
                  aria-label="Close bill summary"
                  onClick={() => setIsMobileBillOpen(false)}
                />
              )}
              <div className="return-record-scroll" style={{ display: "flex", flex: 1, flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
              <div className="return-record-main" style={{ display: "flex", flex: 1, flexDirection: "column", gap: 18, minHeight: 0 }}>
                <section className="return-product-search" aria-labelledby="return-search-title" style={{ display: "grid", alignContent: "start", gap: 10, minWidth: 0 }}>
                  <h3 id="return-search-title" style={{ margin: 0, color: "#34453b", fontSize: 13, fontWeight: 650, whiteSpace: "nowrap" }}>Search Invoice Products by Invoice Number or Brand Name</h3>
                  <input
                    aria-label="Search invoice products by invoice number or brand name"
                    autoComplete="off"
                    value={searchValue}
                    onChange={(event) => {
                      setSearchValue(event.currentTarget.value);
                      setError("");
                    }}
                    placeholder="Enter invoice number or brand name..."
                    style={{ ...inputStyle, maxWidth: 420 }}
                  />
                  {normalizedSearch && (
                    <div aria-label="Matching invoice products" style={{ display: "grid", gap: 6 }}>
                      {matchingItems.map((match) => (
                        <button
                          key={match.key}
                          type="button"
                          onClick={() => {
                            setSelectedItems((current) => current.some((item) => item.key === match.key)
                              ? current
                              : [...current, { ...match, quantity: "1" }]);
                            setSearchValue("");
                            setError("");
                          }}
                          style={{ display: "grid", gap: 4, padding: 10, border: "1px solid #e5ebe7", borderRadius: 6, background: "#fff", color: "#526158", textAlign: "left", cursor: "pointer" }}
                        >
                          <strong style={{ color: "#26352f", fontSize: 13 }}>{match.line.brand}</strong>
                          <span style={{ fontSize: 11 }}>Invoice: {match.invoice.invoice} · Sold quantity: {match.line.quantity} · Batch: {match.line.batchNumber || "-"}</span>
                          <span style={{ fontSize: 11 }}>Strength: {getProductStrength(match.line.details) || "-"} · Pack: {match.line.packSize || "-"}</span>
                          <span style={{ fontSize: 11 }}>Unit price: ৳{match.line.unitPrice.toLocaleString("en-BD")} · Total: ৳{match.line.totalPrice.toLocaleString("en-BD")}</span>
                          <span style={{ color: "#17704e", fontSize: 11, fontWeight: 650 }}>Add to return →</span>
                        </button>
                      ))}
                      {matchingItems.length === 0 && (
                        <p style={{ margin: 0, padding: 10, color: "#77857d", fontSize: 12 }}>No matching brand found in saved invoices.</p>
                      )}
                    </div>
                  )}
                </section>
                <div className="return-record-columns" style={{ display: "grid", flex: 1, gridTemplateColumns: "minmax(0, 1fr) minmax(250px, 0.42fr)", alignItems: "stretch", gap: 14, minHeight: 0 }}>
                <section className="return-items-panel" aria-labelledby="return-invoice-title" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0, padding: 12, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb", overflow: "hidden" }}>
                  <h3 id="return-invoice-title" style={{ margin: 0, color: "#34453b", fontSize: 13, fontWeight: 650 }}>Return Invoice ({selectedItems.length})</h3>
                  {selectedItems.length === 0 ? (
                    <p style={{ margin: 0, color: "#77857d", fontSize: 12 }}>Search and add invoice products to this return.</p>
                  ) : (
                    <div style={{ display: "grid", flex: 1, alignContent: "start", gap: 8, minHeight: 0, overflowY: "auto" }}>
                      {selectedItems.map((item) => (
                        <article key={item.key} style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #e5ebe7", borderRadius: 6, background: "#fff", color: "#526158", fontSize: 11 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px 12px" }}>
                            <strong style={{ color: "#26352f", fontSize: 12 }}>
                              {item.line.brand}
                              {getProductStrength(item.line.details) && <span style={{ marginLeft: 8, color: "#526158", fontWeight: 500 }}>{getProductStrength(item.line.details)}</span>}
                            </strong>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                              <span>Sold: {item.line.quantity}</span>
                              <span>Unit Price: ৳{item.line.unitPrice.toLocaleString("en-BD")}</span>
                              <span>Re-Invoice: {getReInvoice(item.invoice.invoice)}</span>
                              <span>Re-Batch: {getReBatch(item.line.batchNumber)}</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                              <span>Invoice: {item.invoice.invoice}</span>
                              <span>Batch: {item.line.batchNumber || "-"}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                            <label htmlFor={`return-quantity-${item.key}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              Return Qty
                              <input
                                id={`return-quantity-${item.key}`}
                                aria-label={`Return quantity for ${item.line.brand}, invoice ${item.invoice.invoice}`}
                                type="text"
                                inputMode="numeric"
                                value={item.quantity}
                                onFocus={() => {
                                  setSelectedItems((current) => current.map((selected) =>
                                    selected.key === item.key ? { ...selected, quantity: "" } : selected,
                                  ));
                                  setError("");
                                }}
                                onChange={(event) => {
                                  const value = event.currentTarget.value.replace(/\D/g, "");
                                  const parsedQuantity = Number(value);
                                  const boundedValue = value !== "" && Number.isFinite(parsedQuantity) && parsedQuantity > item.line.quantity
                                    ? String(item.line.quantity)
                                    : value;
                                  setSelectedItems((current) => current.map((selected) =>
                                    selected.key === item.key ? { ...selected, quantity: boundedValue } : selected,
                                  ));
                                  setError("");
                                }}
                                onBlur={() => setSelectedItems((current) => current.map((selected) =>
                                  selected.key === item.key
                                    ? { ...selected, quantity: selected.quantity.trim() ? selected.quantity : "1" }
                                    : selected,
                                ))}
                                style={{ ...inputStyle, width: 90, padding: "5px 7px", fontSize: 12 }}
                              />
                            </label>
                            <span aria-live="polite" style={{ color: "#526158", whiteSpace: "nowrap" }}>
                              Amount: <strong style={{ color: "#17704e" }}>
                                ৳{(item.line.unitPrice * (Number(item.quantity) || 0)).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </strong>
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${item.line.brand} from return`}
                              onClick={() => setSelectedItems((current) => current.filter((selected) => selected.key !== item.key))}
                              style={{ border: "1px solid #f1d8d5", borderRadius: 5, background: "#fff", color: "#ad4b43", padding: "5px 8px", fontSize: 11, cursor: "pointer" }}
                            >
                              Remove
                            </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <aside className={`return-bill-summary${isMobileBillOpen ? " is-open" : ""}`} aria-label="Bill summary" style={{ display: "grid", alignContent: "start", gap: 14, minWidth: 0, padding: 14, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb" }}>
                  <div className="return-bill-summary-header">
                    <h3 id="return-bill-summary-title" style={{ margin: 0, color: "#34453b", fontSize: 13, fontWeight: 650 }}>Bill Summary</h3>
                    <button type="button" aria-label="Close bill summary" onClick={() => setIsMobileBillOpen(false)}>×</button>
                  </div>
                  <div style={{ display: "grid", gap: 12, color: "#526158", fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>Total Return Unit</span>
                      <strong style={{ color: "#26352f" }}>{totalReturnUnits}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>Total Amount</span>
                      <strong style={{ color: "#17704e" }}>
                        ৳{totalReturnAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      Return Deduction %
                      <input
                        aria-label="Return Deduction percentage"
                        type="text"
                        inputMode="decimal"
                        value={returnDeductionRate}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (!/^\d*\.?\d*$/.test(value)) return;
                          const parsedRate = Number(value);
                          setReturnDeductionRate(value !== "" && parsedRate > 100 ? "100" : value);
                        }}
                        onFocus={(event) => {
                          event.currentTarget.style.border = "1px solid #cbd8d0";
                          event.currentTarget.style.outline = "none";
                        }}
                        onBlur={(event) => {
                          event.currentTarget.style.border = "1px solid #dce5df";
                        }}
                        style={{ ...inputStyle, width: 68, padding: "7px 6px", fontSize: 12 }}
                      />
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      <span>Return Method:</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(["Cash Return", "Product Adjust"] as const).map((method) => (
                          <button
                            key={method}
                            type="button"
                            aria-pressed={returnMethod === method}
                            onClick={() => {
                              setReturnMethod(method);
                              setReturnAmountOverride(null);
                            }}
                            style={{
                              border: `1px solid ${returnMethod === method ? "#179c70" : "#dce5df"}`,
                              borderRadius: 5,
                              background: returnMethod === method ? "#eef8f2" : "#fff",
                              color: returnMethod === method ? "#17704e" : "#526158",
                              padding: "7px 9px",
                              fontSize: 11,
                              fontWeight: 650,
                              cursor: "pointer",
                            }}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label="Amount"
                        type="text"
                        inputMode="decimal"
                        placeholder="Amount"
                        value={returnAmount}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (/^\d*\.?\d*$/.test(value)) setReturnAmountOverride(value);
                        }}
                        style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 10, borderTop: "1px solid #e5ebe7" }}>
                      <span>Net Refund Amount:</span>
                      <strong style={{ color: "#17704e" }}>
                        ৳{netRefundAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <label style={{ display: "grid", gap: 6 }}>
                      Customer Name
                      <input
                        aria-label="Customer Name"
                        type="text"
                        value={customerName}
                        onFocus={() => setCustomerName("")}
                        onChange={(event) => setCustomerName(event.currentTarget.value)}
                        onBlur={() => {
                          if (!customerName.trim()) setCustomerName("Walk-in customer");
                        }}
                        style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      Phone Number
                      <input
                        aria-label="Phone Number"
                        type="tel"
                        inputMode="tel"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.currentTarget.value)}
                        style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
                      />
                    </label>
                  </div>
                  <footer className="return-record-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12, flexShrink: 0, paddingTop: 12, borderTop: "1px solid #e9eeea" }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <button type="button" onClick={() => setIsModalOpen(false)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 13px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                      <button type="submit" disabled={selectedItems.length === 0} style={{ border: 0, borderRadius: 6, background: selectedItems.length > 0 ? "#179c70" : "#aab8b0", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: selectedItems.length > 0 ? "pointer" : "not-allowed" }}>Record Return</button>
                    </div>
                  </footer>
                </aside>
                </div>
              </div>
              {error && <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{error}</p>}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    />
  );
}
