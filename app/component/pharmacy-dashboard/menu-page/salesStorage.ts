import {
  getPurchaseRowsAfterSale,
  notifyPurchaseListRowsChanged,
  PURCHASE_STORAGE_KEY,
} from "./purchaseStorage";

export const SALES_STORAGE_KEY = "pharmecy-sales-list-v1";

export type SalesInvoiceItem = {
  brand: string;
  details: string;
  batchNumber: string;
  packSize: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type SalesPaymentEntry = {
  methodName: string;
  amount: number;
};

export type SalesListRow = {
  id: string;
  invoice: string;
  customer: string;
  phone?: string;
  items: number;
  time: string;
  amount: number;
  subtotalAmount?: number;
  discountAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  cashRoundingAmount?: number;
  paidAmount?: number;
  dueAmount?: number;
  payment: string;
  paymentMethodName?: string;
  payments?: SalesPaymentEntry[];
  createdAt: string;
  lines?: SalesInvoiceItem[];
};

export type SalesListSnapshot = {
  rows: SalesListRow[];
  error: string;
};

export const emptySalesListSnapshot: SalesListSnapshot = { rows: [], error: "" };
const salesListUpdatedEvent = "pharmecy-sales-list-updated";
let cachedSnapshot: SalesListSnapshot | null = null;

export function getCashRoundingAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    throw new Error("The amount to round must be a valid number.");
  }
  return Number((Math.round(amount) - amount).toFixed(2));
}

function isSalesListRow(value: unknown): value is SalesListRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.invoice === "string"
    && typeof row.customer === "string"
    && (!("phone" in row) || typeof row.phone === "string")
    && typeof row.items === "number"
    && Number.isInteger(row.items)
    && typeof row.time === "string"
    && typeof row.amount === "number"
    && Number.isFinite(row.amount)
    && (!("subtotalAmount" in row) || (typeof row.subtotalAmount === "number" && Number.isFinite(row.subtotalAmount)))
    && (!("discountAmount" in row) || (typeof row.discountAmount === "number" && Number.isFinite(row.discountAmount)))
    && (!("taxRate" in row) || (typeof row.taxRate === "number" && Number.isFinite(row.taxRate) && row.taxRate >= 0 && row.taxRate <= 100))
    && (!("taxAmount" in row) || (typeof row.taxAmount === "number" && Number.isFinite(row.taxAmount) && row.taxAmount >= 0))
    && (!("cashRoundingAmount" in row) || (typeof row.cashRoundingAmount === "number" && Number.isFinite(row.cashRoundingAmount) && Math.abs(row.cashRoundingAmount) <= 0.5))
    && (!("paidAmount" in row) || (typeof row.paidAmount === "number" && Number.isFinite(row.paidAmount)))
    && (!("dueAmount" in row) || (typeof row.dueAmount === "number" && Number.isFinite(row.dueAmount)))
    && typeof row.payment === "string"
    && (!("paymentMethodName" in row) || typeof row.paymentMethodName === "string")
    && (!("payments" in row) || (
      Array.isArray(row.payments)
      && row.payments.every((payment: unknown) => {
        if (!payment || typeof payment !== "object") return false;
        const entry = payment as Record<string, unknown>;
        return typeof entry.methodName === "string"
          && entry.methodName.trim().length > 0
          && typeof entry.amount === "number"
          && Number.isFinite(entry.amount)
          && entry.amount >= 0;
      })
    ))
    && typeof row.createdAt === "string"
    && (!("lines" in row) || (
      Array.isArray(row.lines)
      && row.lines.every((item: unknown) => {
        if (!item || typeof item !== "object") return false;
        const line = item as Record<string, unknown>;
        return typeof line.brand === "string"
          && typeof line.details === "string"
          && typeof line.batchNumber === "string"
          && typeof line.packSize === "string"
          && typeof line.quantity === "number"
          && Number.isInteger(line.quantity)
          && typeof line.unitPrice === "number"
          && Number.isFinite(line.unitPrice)
          && typeof line.totalPrice === "number"
          && Number.isFinite(line.totalPrice);
      })
    ));
}

export function readSalesListRows(): SalesListRow[] {
  const storedRows = localStorage.getItem(SALES_STORAGE_KEY);
  if (!storedRows) return [];

  const parsed: unknown = JSON.parse(storedRows);
  if (!Array.isArray(parsed) || !parsed.every(isSalesListRow)) {
    throw new Error("Saved sales data is invalid. Clear the sales list data and try again.");
  }
  return parsed;
}

function readSnapshot(): SalesListSnapshot {
  try {
    return { rows: readSalesListRows(), error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Could not load saved sales.",
    };
  }
}

export function getSalesListSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToSalesList(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== SALES_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener(salesListUpdatedEvent, listener);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(salesListUpdatedEvent, listener);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export function persistSale(
  lines: SalesInvoiceItem[],
  paidAmount: number,
  discountAmount = 0,
  taxRate = 0,
  customer = "Walk-in customer",
  phone = "",
  paymentMethodName = "Cash",
) {
  if (
    lines.length === 0
    || typeof customer !== "string"
    || typeof phone !== "string"
    || typeof paymentMethodName !== "string"
    || !Number.isFinite(paidAmount)
    || paidAmount < 0
    || !Number.isFinite(discountAmount)
    || discountAmount < 0
    || !Number.isFinite(taxRate)
    || taxRate < 0
    || taxRate > 100
    || lines.some((line) =>
      !Number.isInteger(line.quantity)
      || line.quantity < 1
      || !Number.isFinite(line.unitPrice)
      || line.unitPrice < 0
      || !Number.isFinite(line.totalPrice)
      || line.totalPrice < 0,
    )
  ) {
    throw new Error("Add at least one product with a valid quantity before saving the sale.");
  }

  const amount = lines.reduce((total, line) => total + line.totalPrice, 0);
  if (!Number.isFinite(amount)) {
    throw new Error("The sale total is invalid. Check the product prices and try again.");
  }
  const roundedSubtotal = Number(amount.toFixed(2));
  const roundedDiscount = Number(discountAmount.toFixed(2));
  if (roundedDiscount > roundedSubtotal) {
    throw new Error("Discount cannot be greater than the total price.");
  }
  const roundedTaxRate = Number(taxRate.toFixed(2));
  const taxBaseAmount = Number((roundedSubtotal - roundedDiscount).toFixed(2));
  const roundedTaxAmount = Number((taxBaseAmount * roundedTaxRate / 100).toFixed(2));
  const netAmount = Number((taxBaseAmount + roundedTaxAmount).toFixed(2));
  const cashRoundingAmount = getCashRoundingAmount(netAmount);
  const payableAmount = Number((netAmount + cashRoundingAmount).toFixed(2));
  const roundedPaidAmount = Number(paidAmount.toFixed(2));
  const dueAmount = Number(Math.max(0, payableAmount - roundedPaidAmount).toFixed(2));

  const existingRows = readSalesListRows();
  const lastInvoiceNumber = existingRows.reduce((highest, row) => {
    const match = /^INV-(\d+)$/i.exec(row.invoice);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 2086);
  const now = new Date();
  const invoice = `INV-${lastInvoiceNumber + 1}`;
  const row: SalesListRow = {
    id: invoice,
    invoice,
    customer: customer.trim() || "Walk-in customer",
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    items: lines.length,
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    amount: payableAmount,
    subtotalAmount: roundedSubtotal,
    discountAmount: roundedDiscount,
    taxRate: roundedTaxRate,
    taxAmount: roundedTaxAmount,
    cashRoundingAmount,
    paidAmount: roundedPaidAmount,
    dueAmount,
    payment: dueAmount > 0 ? "Due" : "Paid",
    paymentMethodName: paymentMethodName.trim() || "Cash",
    payments: roundedPaidAmount > 0
      ? [{ methodName: paymentMethodName.trim() || "Cash", amount: roundedPaidAmount }]
      : [],
    createdAt: now.toISOString(),
    lines,
  };
  const rows = [row, ...existingRows];
  const purchaseRows = getPurchaseRowsAfterSale(lines);
  const previousPurchaseData = localStorage.getItem(PURCHASE_STORAGE_KEY);
  const previousSalesData = localStorage.getItem(SALES_STORAGE_KEY);

  try {
    localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchaseRows));
    localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(rows));
  } catch (error) {
    try {
      if (previousPurchaseData === null) localStorage.removeItem(PURCHASE_STORAGE_KEY);
      else localStorage.setItem(PURCHASE_STORAGE_KEY, previousPurchaseData);
      if (previousSalesData === null) localStorage.removeItem(SALES_STORAGE_KEY);
      else localStorage.setItem(SALES_STORAGE_KEY, previousSalesData);
    } catch (rollbackError) {
      throw new Error(
        `Could not complete the sale and could not restore saved inventory: ${rollbackError instanceof Error ? rollbackError.message : "unknown storage error"}`,
      );
    }
    throw error;
  }

  notifyPurchaseListRowsChanged(purchaseRows);
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(salesListUpdatedEvent));
  return row;
}

export function addSalePayment(invoiceId: string, paymentAmount: number, paymentMethodName = "Cash") {
  const updatedInvoices = addSalePaymentAcrossInvoices([invoiceId], paymentAmount, paymentMethodName);
  return updatedInvoices[0];
}

export function addSalePaymentAcrossInvoices(
  invoiceIds: string[],
  paymentAmount: number,
  paymentMethodName = "Cash",
) {
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("Enter a payment amount greater than 0.");
  }
  if (typeof paymentMethodName !== "string" || !paymentMethodName.trim()) {
    throw new Error("Choose a valid payment method.");
  }
  if (invoiceIds.length === 0 || new Set(invoiceIds).size !== invoiceIds.length) {
    throw new Error("Select at least one valid invoice.");
  }

  const rows = readSalesListRows();
  const invoiceIndexes = invoiceIds.map((invoiceId) =>
    rows.findIndex((row) => row.id === invoiceId || row.invoice === invoiceId),
  );
  if (invoiceIndexes.some((invoiceIndex) => invoiceIndex === -1)) {
    throw new Error("One or more selected invoices could not be found.");
  }

  let remainingPayment = Number(paymentAmount.toFixed(2));
  const allocations = invoiceIndexes.map((invoiceIndex) => {
    const invoice = rows[invoiceIndex];
    const dueAmount = Math.max(0, invoice.dueAmount ?? invoice.amount - (invoice.paidAmount ?? invoice.amount));
    const allocation = Number(Math.min(dueAmount, remainingPayment).toFixed(2));
    remainingPayment = Number(Math.max(0, remainingPayment - allocation).toFixed(2));
    return { invoiceIndex, allocation };
  });
  if (!allocations.some(({ allocation }) => allocation > 0)) {
    throw new Error("The selected invoices have no outstanding due.");
  }
  if (remainingPayment > 0) {
    const firstDueAllocation = allocations.find(({ allocation }) => allocation > 0);
    if (!firstDueAllocation) throw new Error("The payment could not be assigned to an invoice.");
    firstDueAllocation.allocation = Number((firstDueAllocation.allocation + remainingPayment).toFixed(2));
  }

  const updatedInvoices = allocations.map(({ invoiceIndex, allocation }) => {
    if (allocation <= 0) return rows[invoiceIndex];
    const invoice = rows[invoiceIndex];
    const paidAmount = invoice.paidAmount ?? invoice.amount;
    const dueAmount = Math.max(0, invoice.dueAmount ?? invoice.amount - paidAmount);
    const nextPaidAmount = Number((paidAmount + allocation).toFixed(2));
    if (!Number.isFinite(nextPaidAmount)) throw new Error("The payment amount is too large.");
    const nextDueAmount = Number(Math.max(0, dueAmount - allocation).toFixed(2));
    const previousPayments = invoice.payments ?? (paidAmount > 0
      ? [{ methodName: invoice.paymentMethodName?.trim() || "Cash", amount: paidAmount }]
      : []);
    return {
      ...invoice,
      paidAmount: nextPaidAmount,
      dueAmount: nextDueAmount,
      payment: nextDueAmount > 0 ? "Due" : "Paid",
      paymentMethodName: paymentMethodName.trim(),
      payments: [...previousPayments, { methodName: paymentMethodName.trim(), amount: allocation }],
    };
  });
  const updatedRows = [...rows];
  allocations.forEach(({ invoiceIndex }, allocationIndex) => {
    updatedRows[invoiceIndex] = updatedInvoices[allocationIndex];
  });

  localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(updatedRows));
  cachedSnapshot = { rows: updatedRows, error: "" };
  window.dispatchEvent(new Event(salesListUpdatedEvent));
  return updatedInvoices;
}
