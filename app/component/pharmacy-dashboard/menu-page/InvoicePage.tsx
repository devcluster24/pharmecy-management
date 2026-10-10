"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
  type SalesListRow,
} from "./salesStorage";
import { downloadSaleInvoicePdf } from "./saleInvoicePdf";

const basePageData: SectionData = {
  description: "Saved sales invoices.",
  action: "",
  metrics: [],
  columns: ["Invoice", "Customer", "Items", "Time", "Subtotal", "Discount", "VAT/TAX", "Cash rounding", "Total", "Paid", "Due", "Payment"],
  rows: [],
};

function formatPrice(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvoicePage() {
  const sales = useSyncExternalStore(
    subscribeToSalesList,
    getSalesListSnapshot,
    () => emptySalesListSnapshot,
  );
  const [searchValue, setSearchValue] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<SalesListRow | null>(null);
  const [invoiceActionError, setInvoiceActionError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedInvoice(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const rows = sales.rows
    .filter((sale) =>
      !normalizedSearch
      || [sale.invoice, sale.customer, sale.phone ?? "", sale.payment].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .map((sale) => {
      const subtotal = sale.subtotalAmount ?? sale.amount;
      const discount = sale.discountAmount ?? 0;
      const taxRate = sale.taxRate ?? 0;
      const taxAmount = sale.taxAmount ?? 0;
      const cashRoundingAmount = sale.cashRoundingAmount ?? 0;

      return [
        <button
          key={`${sale.id}-invoice`}
          type="button"
          onClick={() => {
            setSelectedInvoice(sale);
            setInvoiceActionError("");
          }}
          style={{ border: 0, padding: 0, background: "transparent", color: "#16845f", font: "inherit", fontWeight: 650, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          {sale.invoice}
        </button>,
        sale.customer,
        String(sale.items),
        `${sale.createdAt.slice(0, 10)} ${sale.time}`,
        formatPrice(subtotal),
        formatPrice(discount),
        `${formatPrice(taxAmount)} (${taxRate}%)`,
        `${cashRoundingAmount > 0 ? "+" : ""}${formatPrice(cashRoundingAmount)}`,
        formatPrice(sale.amount),
        formatPrice(sale.paidAmount ?? sale.amount),
        formatPrice(sale.dueAmount ?? 0),
        sale.payment,
      ];
    });
  const data: SectionData = {
    ...basePageData,
    errorMessage: sales.error || undefined,
    rows,
  };

  return (
    <DashboardSectionPage
      sectionSlug="invoice"
      data={data}
      hideAction
      content={selectedInvoice ? (
        <div
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedInvoice(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", overflowY: "auto", padding: 20, background: "rgba(18, 32, 25, 0.52)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-preview-title"
            style={{ width: "min(1100px, calc(100vw - 40px))", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <p style={{ margin: "0 0 5px", color: "#16845f", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>PHARMECY CLUSTER</p>
                <h2 id="invoice-preview-title" style={{ margin: 0, color: "#20342a", fontSize: 20 }}>Sales Invoice · {selectedInvoice.invoice}</h2>
              </div>
              <button type="button" aria-label="Close invoice" onClick={() => setSelectedInvoice(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 26, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px 24px", marginBottom: 24, color: "#526158", fontSize: 13 }}>
                <div><span style={{ color: "#87928d" }}>Customer</span><div style={{ marginTop: 4, color: "#26352f", fontWeight: 600 }}>{selectedInvoice.customer}</div></div>
                {selectedInvoice.phone && <div><span style={{ color: "#87928d" }}>Phone number</span><div style={{ marginTop: 4, color: "#26352f", fontWeight: 600 }}>{selectedInvoice.phone}</div></div>}
                {selectedInvoice.paymentMethodName && <div><span style={{ color: "#87928d" }}>Payment method</span><div style={{ marginTop: 4, color: "#26352f", fontWeight: 600 }}>{selectedInvoice.paymentMethodName}</div></div>}
                <div><span style={{ color: "#87928d" }}>Date &amp; time</span><div style={{ marginTop: 4, color: "#26352f", fontWeight: 600 }}>{new Date(selectedInvoice.createdAt).toLocaleString("en-BD")}</div></div>
                <div><span style={{ color: "#87928d" }}>Payment status</span><div style={{ marginTop: 4, color: "#26352f", fontWeight: 600 }}>{selectedInvoice.payment}</div></div>
              </div>
              <div style={{ overflowX: "auto", border: "1px solid #edf0ed", borderRadius: 7 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", textAlign: "left" }}>
                  <thead><tr>
                    {["Product", "Details", "Batch", "Qty", "Unit price", "Total"].map((heading) => (
                      <th key={heading} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, whiteSpace: "nowrap" }}>{heading}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(selectedInvoice.lines ?? []).map((line, index) => (
                      <tr key={`${line.batchNumber}-${index}`}>
                        {[line.brand, line.details || "-", line.batchNumber || "-", String(line.quantity), formatPrice(line.unitPrice), formatPrice(line.totalPrice)].map((value, cellIndex) => (
                          <td key={cellIndex} style={{ padding: "11px 12px", borderBottom: index === (selectedInvoice.lines?.length ?? 0) - 1 ? 0 : "1px solid #f0f2f0", color: "#34453b", fontSize: 12, whiteSpace: cellIndex === 1 ? "normal" : "nowrap", overflowWrap: "anywhere" }}>{value}</td>
                        ))}
                      </tr>
                    ))}
                    {(!selectedInvoice.lines || selectedInvoice.lines.length === 0) && (
                      <tr><td colSpan={6} style={{ padding: 18, color: "#87928d", fontSize: 12, textAlign: "center" }}>No item details are available for this invoice.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "grid", justifyContent: "end", gap: 8, marginTop: 20, color: "#526158", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>Subtotal</span><strong>{formatPrice(selectedInvoice.subtotalAmount ?? selectedInvoice.amount)}</strong></div>
                {(selectedInvoice.discountAmount ?? 0) > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>Discount</span><strong>-{formatPrice(selectedInvoice.discountAmount ?? 0)}</strong></div>}
                {(selectedInvoice.taxAmount ?? 0) > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>VAT/TAX ({selectedInvoice.taxRate ?? 0}%)</span><strong>{formatPrice(selectedInvoice.taxAmount ?? 0)}</strong></div>}
                {(selectedInvoice.cashRoundingAmount ?? 0) !== 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>Cash rounding</span><strong>{formatPrice(selectedInvoice.cashRoundingAmount ?? 0)}</strong></div>}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 32, paddingTop: 8, borderTop: "1px solid #e9eeea", color: "#16845f", fontSize: 16 }}><span>Grand total</span><strong>{formatPrice(selectedInvoice.amount)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>Paid</span><strong>{formatPrice(selectedInvoice.paidAmount ?? selectedInvoice.amount)}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 32 }}><span>Due</span><strong>{formatPrice(selectedInvoice.dueAmount ?? 0)}</strong></div>
              </div>
              {invoiceActionError && <p role="alert" style={{ margin: "14px 0 0", color: "#b34b43", fontSize: 12 }}>{invoiceActionError}</p>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e9eeea" }}>
              <button type="button" onClick={() => setSelectedInvoice(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
              <button type="button" onClick={() => {
                try {
                  downloadSaleInvoicePdf(selectedInvoice);
                  setInvoiceActionError("");
                } catch (error) {
                  setInvoiceActionError(error instanceof Error ? error.message : "Could not download invoice.");
                }
              }} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Download PDF</button>
            </div>
          </section>
        </div>
      ) : null}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
    />
  );
}
