import {
  notifyPurchaseListRowsChanged,
  PURCHASE_STORAGE_KEY,
  type PurchaseListRow,
} from "./purchaseStorage";

export const RETURNS_STORAGE_KEY = "pharmecy-return-records-v1";

export type ReturnRecord = {
  id: string;
  returnId?: string;
  invoice: string;
  reInvoice?: string;
  reBatch?: string;
  product: string;
  brand?: string;
  batchNumber?: string;
  quantity?: number;
  amount?: number;
  netRefundAmount?: number;
  customer?: string;
  phone?: string;
  returnMethod?: "Cash Return" | "Product Adjust";
  date: string;
  reason: string;
  status: string;
};

export type ReturnsSnapshot = {
  rows: ReturnRecord[];
  error: string;
};

export const emptyReturnsSnapshot: ReturnsSnapshot = { rows: [], error: "" };
const returnsUpdatedEvent = "pharmecy-return-records-updated";
let cachedSnapshot: ReturnsSnapshot | null = null;

function isReturnRecord(value: unknown): value is ReturnRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && (!("returnId" in record) || typeof record.returnId === "string")
    && typeof record.invoice === "string"
    && (!("reInvoice" in record) || typeof record.reInvoice === "string")
    && (!("reBatch" in record) || typeof record.reBatch === "string")
    && typeof record.product === "string"
    && (!("brand" in record) || typeof record.brand === "string")
    && (!("batchNumber" in record) || typeof record.batchNumber === "string")
    && (!("quantity" in record) || (typeof record.quantity === "number" && Number.isInteger(record.quantity) && record.quantity > 0))
    && (!("amount" in record) || (typeof record.amount === "number" && Number.isFinite(record.amount) && record.amount >= 0))
    && (!("netRefundAmount" in record) || (typeof record.netRefundAmount === "number" && Number.isFinite(record.netRefundAmount) && record.netRefundAmount >= 0))
    && (!("customer" in record) || typeof record.customer === "string")
    && (!("phone" in record) || typeof record.phone === "string")
    && (!("returnMethod" in record) || record.returnMethod === "Cash Return" || record.returnMethod === "Product Adjust")
    && typeof record.date === "string"
    && typeof record.reason === "string"
    && typeof record.status === "string";
}

function readSnapshot(): ReturnsSnapshot {
  try {
    const stored = window.localStorage.getItem(RETURNS_STORAGE_KEY);
    if (!stored) return emptyReturnsSnapshot;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every(isReturnRecord)) {
      throw new Error("Saved return records are invalid.");
    }
    return { rows: parsed, error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Could not load return records.",
    };
  }
}

export function getReturnsSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToReturns(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== RETURNS_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  function handleReturnsUpdate() {
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(returnsUpdatedEvent, handleReturnsUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(returnsUpdatedEvent, handleReturnsUpdate);
  };
}

export function saveReturnRecords(rows: ReturnRecord[]) {
  if (!rows.every(isReturnRecord)) {
    throw new Error("Return record data is invalid.");
  }
  window.localStorage.setItem(RETURNS_STORAGE_KEY, JSON.stringify(rows));
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(returnsUpdatedEvent));
}

export function saveReturnRecordsAndInventory(rows: ReturnRecord[], purchaseRows: PurchaseListRow[]) {
  if (!rows.every(isReturnRecord)) {
    throw new Error("Return record data is invalid.");
  }

  const previousReturnData = window.localStorage.getItem(RETURNS_STORAGE_KEY);
  const previousPurchaseData = window.localStorage.getItem(PURCHASE_STORAGE_KEY);
  try {
    window.localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchaseRows));
    window.localStorage.setItem(RETURNS_STORAGE_KEY, JSON.stringify(rows));
  } catch (error) {
    try {
      if (previousPurchaseData === null) window.localStorage.removeItem(PURCHASE_STORAGE_KEY);
      else window.localStorage.setItem(PURCHASE_STORAGE_KEY, previousPurchaseData);
      if (previousReturnData === null) window.localStorage.removeItem(RETURNS_STORAGE_KEY);
      else window.localStorage.setItem(RETURNS_STORAGE_KEY, previousReturnData);
    } catch (rollbackError) {
      throw new Error(
        `Could not save the return and could not restore saved data: ${rollbackError instanceof Error ? rollbackError.message : "unknown storage error"}`,
      );
    }
    throw error;
  }

  notifyPurchaseListRowsChanged(purchaseRows);
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(returnsUpdatedEvent));
}
