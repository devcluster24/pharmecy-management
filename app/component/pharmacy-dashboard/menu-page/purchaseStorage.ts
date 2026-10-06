export const PURCHASE_STORAGE_KEY = "pharmecy-purchase-list-v1";
export const PLACE_ORDER_STORAGE_KEY = "pharmecy-place-order-list-v1";

export type PurchaseListRow = {
  id: string;
  order: string;
  supplier: string;
  orderDate: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp?: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
  status: string;
  quantity?: string;
  totalPrice?: string;
  unitPurchasePrice?: string;
  productId?: string;
  productPackPrice?: string;
  updatedAt?: string;
};

export type PurchaseListSnapshot = {
  rows: PurchaseListRow[];
  error: string;
};

export type GroupedPurchaseOrder = {
  order: string;
  rows: PurchaseListRow[];
  updatedAt: number;
};

export const emptyPurchaseListSnapshot: PurchaseListSnapshot = { rows: [], error: "" };
const purchaseListUpdatedEvent = "pharmecy-purchase-list-updated";
let cachedSnapshot: PurchaseListSnapshot | null = null;
let cachedPlaceOrderSnapshot: PurchaseListSnapshot | null = null;

export function getOrderTotal(rows: PurchaseListRow[]) {
  return rows.reduce((total, row) => {
    const amount = Number(row.totalPrice);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}

export function groupPurchaseOrders(rows: PurchaseListRow[]): GroupedPurchaseOrder[] {
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

function isPurchaseListRow(value: unknown): value is PurchaseListRow {
  if (!value || typeof value !== "object") return false;
  return [
    "id",
    "order",
    "supplier",
    "orderDate",
    "brand",
    "genericName",
    "strength",
    "dosageForm",
    "batchNumber",
    "mfgDate",
    "expDate",
    "packSize",
    "unitPrice",
    "packPrice",
    "status",
  ].every((key) => key in value && typeof value[key as keyof typeof value] === "string")
    && (!("quantity" in value) || typeof value.quantity === "string")
    && (!("totalPrice" in value) || typeof value.totalPrice === "string")
    && (!("unitPurchasePrice" in value) || typeof value.unitPurchasePrice === "string")
    && (!("mrp" in value) || typeof value.mrp === "string")
    && (!("productId" in value) || typeof value.productId === "string")
    && (!("productPackPrice" in value) || typeof value.productPackPrice === "string")
    && (!("updatedAt" in value) || typeof value.updatedAt === "string");
}

export function calculateUnitPurchasePrice(packSize: string, totalPrice: string, quantity: string) {
  if (!packSize.trim() || !totalPrice.trim() || !quantity.trim()) return "-";
  const packFactors = packSize.trim().split(/\s*[xX×]\s*/);
  if (!packFactors.length || packFactors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))) return "-";
  const packMultiplier = packFactors.reduce((total, factor) => total * Number(factor), 1);
  const parsedTotalPrice = Number(totalPrice);
  const parsedQuantity = Number(quantity);
  if (
    !Number.isFinite(packMultiplier) ||
    packMultiplier <= 0 ||
    !Number.isFinite(parsedTotalPrice) ||
    parsedTotalPrice < 0 ||
    !Number.isFinite(parsedQuantity) ||
    parsedQuantity <= 0
  ) return "-";
  return String(Number((parsedTotalPrice / parsedQuantity / packMultiplier).toFixed(4)));
}

function readRows(storageKey: string): PurchaseListRow[] {
  const storedRows = localStorage.getItem(storageKey);
  if (!storedRows) return [];

  const parsed: unknown = JSON.parse(storedRows);
  if (!Array.isArray(parsed) || !parsed.every(isPurchaseListRow)) {
    throw new Error("Saved purchase data is invalid. Clear the purchase list data and try again.");
  }
  return parsed;
}

export function readPurchaseListRows() {
  return readRows(PURCHASE_STORAGE_KEY);
}

export function readPlaceOrderListRows() {
  return readRows(PLACE_ORDER_STORAGE_KEY);
}

function readSnapshot(readRowsFromStorage: () => PurchaseListRow[]): PurchaseListSnapshot {
  try {
    return { rows: readRowsFromStorage(), error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Could not load saved purchases.",
    };
  }
}

export function getPurchaseListSnapshot() {
  cachedSnapshot ??= readSnapshot(readPurchaseListRows);
  return cachedSnapshot;
}

export function getPlaceOrderListSnapshot() {
  cachedPlaceOrderSnapshot ??= readSnapshot(readPlaceOrderListRows);
  return cachedPlaceOrderSnapshot;
}

function subscribeToPurchaseLists(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== PURCHASE_STORAGE_KEY && event.key !== PLACE_ORDER_STORAGE_KEY) return;
    cachedSnapshot = null;
    cachedPlaceOrderSnapshot = null;
    listener();
  }

  window.addEventListener(purchaseListUpdatedEvent, listener);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(purchaseListUpdatedEvent, listener);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export const subscribeToPurchaseList = subscribeToPurchaseLists;
export const subscribeToPlaceOrderList = subscribeToPurchaseLists;

export function persistPurchaseListRows(rows: PurchaseListRow[]) {
  localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(rows));
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}

export function persistPlaceOrderListRows(rows: PurchaseListRow[]) {
  localStorage.setItem(PLACE_ORDER_STORAGE_KEY, JSON.stringify(rows));
  cachedPlaceOrderSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}
