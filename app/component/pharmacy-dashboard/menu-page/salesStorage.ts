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

export type SalesListRow = {
  id: string;
  invoice: string;
  customer: string;
  items: number;
  time: string;
  amount: number;
  subtotalAmount?: number;
  discountAmount?: number;
  paidAmount?: number;
  dueAmount?: number;
  payment: string;
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

function isSalesListRow(value: unknown): value is SalesListRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.invoice === "string"
    && typeof row.customer === "string"
    && typeof row.items === "number"
    && Number.isInteger(row.items)
    && typeof row.time === "string"
    && typeof row.amount === "number"
    && Number.isFinite(row.amount)
    && (!("subtotalAmount" in row) || (typeof row.subtotalAmount === "number" && Number.isFinite(row.subtotalAmount)))
    && (!("discountAmount" in row) || (typeof row.discountAmount === "number" && Number.isFinite(row.discountAmount)))
    && (!("paidAmount" in row) || (typeof row.paidAmount === "number" && Number.isFinite(row.paidAmount)))
    && (!("dueAmount" in row) || (typeof row.dueAmount === "number" && Number.isFinite(row.dueAmount)))
    && typeof row.payment === "string"
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

export function persistSale(lines: SalesInvoiceItem[], paidAmount: number, discountAmount = 0) {
  if (
    lines.length === 0
    || !Number.isFinite(paidAmount)
    || paidAmount < 0
    || !Number.isFinite(discountAmount)
    || discountAmount < 0
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
  const payableAmount = Number((roundedSubtotal - roundedDiscount).toFixed(2));
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
    customer: "Walk-in customer",
    items: lines.length,
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    amount: payableAmount,
    subtotalAmount: roundedSubtotal,
    discountAmount: roundedDiscount,
    paidAmount: roundedPaidAmount,
    dueAmount,
    payment: dueAmount > 0 ? "Due" : "Paid",
    createdAt: now.toISOString(),
    lines,
  };
  const rows = [row, ...existingRows];

  localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(rows));
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(salesListUpdatedEvent));
  return row;
}
