"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  addSalePayment,
  addSalePaymentAcrossInvoices,
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
  type SalesListRow,
} from "./salesStorage";
import {
  emptyPaymentMethodsSnapshot,
  getPaymentMethodsSnapshot,
  subscribeToPaymentMethods,
} from "./paymentMethodsStorage";

const pageData: SectionData = {
  description: "Review customer invoices and outstanding balances.",
  action: "",
  metrics: [],
  columns: [
    "Invoice",
    "Date & Time",
    "Customer Name & Phone Number",
    "Items",
    "Subtotal",
    "Discount Amount",
    "VAT/TAX",
    "Cash Rounding",
    "Total",
    "Paid",
    "Due",
    "Payment",
    "Actions",
  ],
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

function formatPrice(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getDueAmount(invoice: SalesListRow) {
  return Math.max(0, invoice.dueAmount ?? invoice.amount - (invoice.paidAmount ?? invoice.amount));
}

type CustomerInvoiceGroup = {
  customer: string;
  phone: string;
  invoices: SalesListRow[];
  lastInvoice: SalesListRow;
  totalAmount: number;
  totalPaid: number;
  totalDue: number;
};

function getInvoicePayments(invoice: SalesListRow) {
  return invoice.payments ?? [{
    methodName: invoice.paymentMethodName?.trim() || "Cash",
    amount: invoice.paidAmount ?? invoice.amount,
  }];
}

function getPaymentAllocations(invoices: SalesListRow[], paymentAmount: number) {
  let remaining = Number.isFinite(paymentAmount) && paymentAmount > 0
    ? Number(paymentAmount.toFixed(2))
    : 0;
  const orderedInvoices = [...invoices].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const allocations = orderedInvoices.map((invoice) => {
    const due = getDueAmount(invoice);
    const amount = Number(Math.min(due, remaining).toFixed(2));
    remaining = Number(Math.max(0, remaining - amount).toFixed(2));
    return { invoice, amount };
  }).filter(({ amount }) => amount > 0);
  if (remaining > 0 && allocations.length > 0) {
    allocations[0].amount = Number((allocations[0].amount + remaining).toFixed(2));
  }
  return allocations;
}

export default function CustomerManagementPage() {
  const sales = useSyncExternalStore(
    subscribeToSalesList,
    getSalesListSnapshot,
    () => emptySalesListSnapshot,
  );
  const paymentMethods = useSyncExternalStore(
    subscribeToPaymentMethods,
    getPaymentMethodsSnapshot,
    () => emptyPaymentMethodsSnapshot,
  );
  const [selectedInvoice, setSelectedInvoice] = useState<SalesListRow | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [customerDueAmount, setCustomerDueAmount] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const [adjustError, setAdjustError] = useState("");
  const [adjustMessage, setAdjustMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeList, setActiveList] = useState<"customers" | "due">("customers");
  const [detailModal, setDetailModal] = useState<{
    type: "invoices" | "payments" | "collect-due";
    customer: CustomerInvoiceGroup;
  } | null>(null);
  const paymentMethodOptions = [
    { value: "cash", label: "Cash" },
    ...paymentMethods.rows.map((method) => ({
      value: `${method.type}:${method.id}`,
      label: method.type === "mobile" ? method.name : method.bankName,
    })),
  ];
  const effectivePaymentMethod = paymentMethodOptions.some((option) => option.value === selectedPaymentMethod)
    ? selectedPaymentMethod
    : "cash";

  function openAdjustModal(invoice: SalesListRow) {
    setSelectedInvoice(invoice);
    setAdjustAmount("");
    setSelectedPaymentMethod("cash");
    setAdjustError("");
    setAdjustMessage("");
  }

  function saveAdjustedAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdjustError("");
    if (!selectedInvoice) return;
    const amount = Number(adjustAmount);
    if (adjustAmount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
      setAdjustError("Enter an amount greater than 0.");
      return;
    }

    try {
      const paymentMethodName = paymentMethodOptions.find((option) => option.value === effectivePaymentMethod)?.label ?? "Cash";
      const updatedInvoice = addSalePayment(selectedInvoice.id, amount, paymentMethodName);
      setSelectedInvoice(updatedInvoice);
      setAdjustMessage("Payment added to the invoice.");
      setAdjustAmount("");
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : "Could not adjust the invoice amount.");
    }
  }

  function openCollectDueModal(customer: CustomerInvoiceGroup) {
    setCustomerDueAmount("");
    setSelectedPaymentMethod("cash");
    setAdjustError("");
    setDetailModal({ type: "collect-due", customer });
  }

  function saveCustomerDuePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdjustError("");
    const amount = Number(customerDueAmount);
    if (customerDueAmount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
      setAdjustError("Enter an amount greater than 0.");
      return;
    }
    if (!detailModal || detailModal.type !== "collect-due") return;

    try {
      const paymentMethodName = paymentMethodOptions.find((option) => option.value === effectivePaymentMethod)?.label ?? "Cash";
      const prioritizedInvoiceIds = [...detailModal.customer.invoices]
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .map((invoice) => invoice.id);
      addSalePaymentAcrossInvoices(prioritizedInvoiceIds, amount, paymentMethodName);
      setDetailModal(null);
      setCustomerDueAmount("");
      setAdjustError("");
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : "Could not adjust the customer invoices.");
    }
  }

  const customerGroups = new Map<string, CustomerInvoiceGroup>();
  for (const invoice of sales.rows) {
    const customer = invoice.customer.trim() || "Walk-in customer";
    const phone = invoice.phone?.trim() ?? "";
    const normalizedPhone = phone.replace(/\D/g, "") || phone.toLocaleLowerCase();
    const groupKey = `${customer.toLocaleLowerCase()}\u0000${normalizedPhone}`;
    const existingGroup = customerGroups.get(groupKey);
    if (existingGroup) {
      existingGroup.invoices.push(invoice);
      existingGroup.totalAmount += invoice.amount;
      existingGroup.totalPaid += invoice.paidAmount ?? invoice.amount;
      existingGroup.totalDue += getDueAmount(invoice);
      if (Date.parse(invoice.createdAt) > Date.parse(existingGroup.lastInvoice.createdAt)) {
        existingGroup.lastInvoice = invoice;
      }
    } else {
      customerGroups.set(groupKey, {
        customer,
        phone,
        invoices: [invoice],
        lastInvoice: invoice,
        totalAmount: invoice.amount,
        totalPaid: invoice.paidAmount ?? invoice.amount,
        totalDue: getDueAmount(invoice),
      });
    }
  }

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const dueCustomerGroups = [...customerGroups.values()]
    .filter((group) => group.totalDue > 0)
    .filter((group) =>
      !normalizedSearch
      || [
        group.customer,
        group.phone,
        ...group.invoices.map((invoice) => invoice.invoice),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    );
  const totalDueAmount = dueCustomerGroups.reduce((total, group) => total + group.totalDue, 0);
  const rows = activeList === "customers"
    ? sales.rows
    .filter((invoice) =>
      !normalizedSearch
      || [invoice.invoice, invoice.customer, invoice.phone ?? "", invoice.payment]
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .map((invoice) => {
      const subtotal = invoice.subtotalAmount ?? invoice.amount;
      const discount = invoice.discountAmount ?? 0;
      const discountRate = subtotal > 0 ? discount / subtotal * 100 : 0;
      const taxRate = invoice.taxRate ?? 0;
      const taxAmount = invoice.taxAmount ?? 0;
      const cashRounding = invoice.cashRoundingAmount ?? 0;
      const due = getDueAmount(invoice);
      return [
        invoice.invoice,
        new Date(invoice.createdAt).toLocaleString("en-BD"),
        <span key={`${invoice.id}-customer`} style={{ display: "grid", gap: 3 }}>
          <span>{invoice.customer}</span>
          {invoice.phone && <span style={{ color: "#77857d", fontSize: 11 }}>{invoice.phone}</span>}
        </span>,
        invoice.items,
        formatPrice(subtotal),
        `${formatPrice(discount)} (${discountRate.toLocaleString("en-BD", { maximumFractionDigits: 2 })}%)`,
        `${taxRate}% · ${formatPrice(taxAmount)}`,
        `${cashRounding > 0 ? "+" : ""}${formatPrice(cashRounding)}`,
        formatPrice(invoice.amount),
        formatPrice(invoice.paidAmount ?? invoice.amount),
        formatPrice(due),
        invoice.payment,
        <button
          key={`${invoice.id}-adjust`}
          type="button"
          disabled={due <= 0}
          onClick={() => openAdjustModal(invoice)}
          style={{
            border: `1px solid ${due > 0 ? "#b9dfd0" : "#e5ebe7"}`,
            borderRadius: 5,
            background: due > 0 ? "#fff" : "#f5f6f5",
            color: due > 0 ? "#16845f" : "#a0aaa4",
            padding: "5px 9px",
            fontSize: 11,
            fontWeight: 650,
            cursor: due > 0 ? "pointer" : "not-allowed",
          }}
        >
          Adjust Amount
        </button>,
      ];
    })
    : dueCustomerGroups.map((group) => [
        <span key={`${group.customer}-${group.phone}`} style={{ display: "grid", gap: 3 }}>
          <span>{group.customer}</span>
          {group.phone && <span style={{ color: "#77857d", fontSize: 11 }}>{group.phone}</span>}
        </span>,
        new Date(group.lastInvoice.createdAt).toLocaleString("en-BD"),
        <button
          key={`${group.customer}-${group.phone}-invoices`}
          type="button"
          onClick={() => setDetailModal({ type: "invoices", customer: group })}
          style={{ border: "1px solid #b9dfd0", borderRadius: 5, background: "#fff", color: "#16845f", padding: "5px 9px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
        >
          View Invoices
        </button>,
        group.invoices.length,
        formatPrice(group.totalAmount),
        <button
          key={`${group.customer}-${group.phone}-paid`}
          type="button"
          onClick={() => setDetailModal({ type: "payments", customer: group })}
          style={{ border: 0, background: "transparent", color: "#16845f", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: "underline", cursor: "pointer" }}
        >
          {formatPrice(group.totalPaid)}
        </button>,
        <button
          key={`${group.customer}-${group.phone}-due`}
          type="button"
          onClick={() => openCollectDueModal(group)}
          style={{ border: 0, background: "transparent", color: "#ad4b43", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: "underline", cursor: "pointer" }}
        >
          {formatPrice(group.totalDue)}
        </button>,
      ]);

  const data: SectionData = {
    ...pageData,
    errorMessage: sales.error || undefined,
    columns: activeList === "customers"
      ? pageData.columns
      : ["Customer Name & Phone Number", "Last Invoice Date", "View Invoices", "Total Visit Time", "Total Bill Amount", "Total Paid", "Total Due"],
    listTitle: "",
    listFooter: activeList === "due" ? (
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 16px", color: "#87928d", fontSize: 11 }}>
        <span>Showing {rows.length} records</span>
        <strong style={{ color: "#ad4b43", fontSize: 12 }}>Total Due Amount: {formatPrice(totalDueAmount)}</strong>
      </div>
    ) : undefined,
    listNavigation: (
      <div role="group" aria-label="Customer list type" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {([
          ["customers", "Customer Management List"],
          ["due", "Due Customer List"],
        ] as const).map(([listType, label]) => (
          <button
            key={listType}
            type="button"
            aria-pressed={activeList === listType}
            onClick={() => {
              setActiveList(listType);
              setSearchQuery("");
            }}
            style={{ border: 0, background: "transparent", color: activeList === listType ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: activeList === listType ? "underline" : "none", textUnderlineOffset: 4, cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </div>
    ),
    rows,
  };

  return (
    <DashboardSectionPage
      sectionSlug="customers"
      data={data}
      hideAction
      listTitle={data.listTitle}
      listNavigation={data.listNavigation}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      content={selectedInvoice ? (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedInvoice(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 20, background: "rgba(18, 35, 27, 0.45)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjust-invoice-amount-title"
            style={{ width: "min(460px, 100%)", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 22px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="adjust-invoice-amount-title" style={{ margin: 0, color: "#20342a", fontSize: 17, fontWeight: 700 }}>Adjust Amount</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>{selectedInvoice.invoice} · {selectedInvoice.customer}</p>
              </div>
              <button type="button" aria-label="Close amount adjustment" onClick={() => setSelectedInvoice(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <form onSubmit={saveAdjustedAmount} style={{ display: "grid", gap: 14, padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#526158", fontSize: 13 }}>
                <span>Outstanding Due</span>
                <strong style={{ color: "#ad4b43" }}>{formatPrice(getDueAmount(selectedInvoice))}</strong>
              </div>
              <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                Amount
                <input
                  aria-label="Amount to add to invoice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={adjustAmount}
                  onChange={(event) => {
                    setAdjustAmount(event.currentTarget.value);
                    setAdjustError("");
                    setAdjustMessage("");
                  }}
                  style={inputStyle}
                />
              </label>
              <div role="group" aria-label="Choose payment method" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {paymentMethodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={effectivePaymentMethod === option.value}
                    onClick={() => setSelectedPaymentMethod(option.value)}
                    style={{
                      border: `1px solid ${effectivePaymentMethod === option.value ? "#179c70" : "#dce5df"}`,
                      borderRadius: 5,
                      background: effectivePaymentMethod === option.value ? "#eef8f2" : "#fff",
                      color: effectivePaymentMethod === option.value ? "#17704e" : "#526158",
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
              {paymentMethods.error && <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{paymentMethods.error}</p>}
              {adjustError && <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{adjustError}</p>}
              {adjustMessage && <p role="status" style={{ margin: 0, color: "#16845f", fontSize: 12 }}>{adjustMessage}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setSelectedInvoice(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Close</button>
                <button type="submit" style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Add to Invoice</button>
              </div>
            </form>
          </section>
        </div>
      ) : detailModal ? (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailModal(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", overflowY: "auto", padding: 20, background: "rgba(18, 35, 27, 0.45)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-detail-title"
            style={{ width: "min(760px, 100%)", maxHeight: "min(680px, 90vh)", display: "flex", flexDirection: "column", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 22px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="customer-detail-title" style={{ margin: 0, color: "#20342a", fontSize: 17, fontWeight: 700 }}>
                  {detailModal.type === "invoices"
                    ? "Customer Invoices"
                    : detailModal.type === "payments" ? "Payment Method Summary" : "Add Customer Due Payment"}
                </h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>
                  {detailModal.customer.customer}{detailModal.customer.phone ? ` · ${detailModal.customer.phone}` : ""}
                </p>
              </div>
              <button type="button" aria-label="Close customer details" onClick={() => setDetailModal(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <div style={{ overflow: "auto", padding: 18 }}>
              {detailModal.type === "collect-due" ? (
                <form onSubmit={saveCustomerDuePayment} style={{ display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#526158", fontSize: 13 }}>
                    <span>Total Outstanding Due</span>
                    <strong style={{ color: "#ad4b43" }}>{formatPrice(detailModal.customer.totalDue)}</strong>
                  </div>
                  <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                    Amount
                    <input
                      aria-label="Amount to add to customer invoices"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={customerDueAmount}
                      onChange={(event) => {
                        setCustomerDueAmount(event.currentTarget.value);
                        setAdjustError("");
                      }}
                      style={inputStyle}
                    />
                  </label>
                  {getPaymentAllocations(detailModal.customer.invoices, Number(customerDueAmount)).length > 0 && (
                    <div style={{ display: "grid", gap: 6, border: "1px solid #e9eeea", borderRadius: 6, padding: 11 }}>
                      <strong style={{ color: "#34453b", fontSize: 12 }}>Auto-selected invoices (oldest due first)</strong>
                      {getPaymentAllocations(detailModal.customer.invoices, Number(customerDueAmount)).map(({ invoice, amount }) => (
                        <div key={invoice.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#687871", fontSize: 12 }}>
                          <span>{invoice.invoice}</span>
                          <span>{formatPrice(amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div role="group" aria-label="Choose payment method" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {paymentMethodOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={effectivePaymentMethod === option.value}
                        onClick={() => setSelectedPaymentMethod(option.value)}
                        style={{
                          border: `1px solid ${effectivePaymentMethod === option.value ? "#179c70" : "#dce5df"}`,
                          borderRadius: 5,
                          background: effectivePaymentMethod === option.value ? "#eef8f2" : "#fff",
                          color: effectivePaymentMethod === option.value ? "#17704e" : "#526158",
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
                  {paymentMethods.error && <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{paymentMethods.error}</p>}
                  {adjustError && <p role="alert" style={{ margin: 0, color: "#b34b43", fontSize: 12 }}>{adjustError}</p>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" onClick={() => setDetailModal(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    <button type="submit" style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Add Payment</button>
                  </div>
                </form>
              ) : detailModal.type === "invoices" ? (
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr>
                      {["Invoice", "Quantity", "Total Bill Amount", "Total Paid", "Total Due"].map((column) => (
                        <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailModal.customer.invoices.map((invoice) => {
                      const quantity = invoice.lines?.reduce((total, line) => total + line.quantity, 0) ?? invoice.items;
                      return (
                        <tr key={invoice.id}>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 12, fontWeight: 600 }}>{invoice.invoice}</td>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#687871", fontSize: 12 }}>{quantity}</td>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#687871", fontSize: 12 }}>{formatPrice(invoice.amount)}</td>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#687871", fontSize: 12 }}>{formatPrice(invoice.paidAmount ?? invoice.amount)}</td>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#ad4b43", fontSize: 12 }}>{formatPrice(getDueAmount(invoice))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (() => {
                const methodTotals = new Map<string, number>();
                for (const invoice of detailModal.customer.invoices) {
                  for (const payment of getInvoicePayments(invoice)) {
                    methodTotals.set(payment.methodName, (methodTotals.get(payment.methodName) ?? 0) + payment.amount);
                  }
                }
                const methodRows = [...methodTotals.entries()];
                return (
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr>
                        {["Payment Method", "Total Paid"].map((column) => (
                          <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650 }}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {methodRows.map(([methodName, amount]) => (
                        <tr key={methodName}>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 12 }}>{methodName}</td>
                          <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#687871", fontSize: 12 }}>{formatPrice(amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            <footer style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #e9eeea", padding: "12px 18px" }}>
              <button type="button" onClick={() => setDetailModal(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Close</button>
            </footer>
          </section>
        </div>
      ) : null}
    />
  );
}
