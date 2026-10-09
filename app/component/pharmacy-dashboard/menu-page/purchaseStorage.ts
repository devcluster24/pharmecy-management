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
  availableQuantity?: string;
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
    && (!("availableQuantity" in value) || typeof value.availableQuantity === "string")
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

export function calculateTotalQuantity(packSize: string, quantity: string): number | null {
  if (!quantity.trim() || !packSize.trim()) return null;

  const parsedQuantity = Number(quantity);
  const factors = packSize.trim().split(/\s*[xX×]\s*/);
  if (
    !Number.isFinite(parsedQuantity)
    || parsedQuantity < 0
    || factors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))
  ) return null;

  const packMultiplier = factors.reduce((total, factor) => total * Number(factor), 1);
  const totalQuantity = parsedQuantity * packMultiplier;
  return Number.isFinite(totalQuantity) && packMultiplier > 0
    ? Number(totalQuantity.toFixed(4))
    : null;
}

export function calculatePackQuantity(packSize: string, totalQuantity: number): number | null {
  if (!packSize.trim() || !Number.isFinite(totalQuantity) || totalQuantity < 0) return null;
  const factors = packSize.trim().split(/\s*[xX×]\s*/);
  if (factors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))) return null;

  const packMultiplier = factors.reduce((total, factor) => total * Number(factor), 1);
  return Number.isFinite(packMultiplier) && packMultiplier > 0
    ? Number((totalQuantity / packMultiplier).toFixed(4))
    : null;
}

export function getAvailablePurchaseQuantity(row: PurchaseListRow): number | null {
  if (row.availableQuantity !== undefined) {
    const availableQuantity = Number(row.availableQuantity);
    return Number.isFinite(availableQuantity) && availableQuantity >= 0
      ? availableQuantity
      : null;
  }
  return calculateTotalQuantity(row.packSize, row.quantity ?? "");
}

export type SaleStockLine = {
  brand: string;
  batchNumber: string;
  quantity: number;
};

export function getPurchaseRowsAfterSale(lines: SaleStockLine[]) {
  const rows = readPurchaseListRows();
  const updatedRows = [...rows];
  const demands = new Map<string, SaleStockLine>();

  for (const line of lines) {
    const brand = line.brand.trim().toLocaleLowerCase();
    const batchNumber = line.batchNumber.trim().toLocaleLowerCase();
    if (!brand || !batchNumber || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("Each sold item must have a brand, batch number, and valid quantity.");
    }
    const key = JSON.stringify([brand, batchNumber]);
    const existingDemand = demands.get(key);
    demands.set(key, {
      brand,
      batchNumber,
      quantity: (existingDemand?.quantity ?? 0) + line.quantity,
    });
  }

  for (const demand of demands.values()) {
    let remaining = demand.quantity;
    const matchingIndices = updatedRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        row.brand.trim().toLocaleLowerCase() === demand.brand
        && row.batchNumber.trim().toLocaleLowerCase() === demand.batchNumber,
      )
      .map(({ index }) => index);

    for (const index of matchingIndices) {
      if (remaining === 0) break;
      const row = updatedRows[index];
      const availableQuantity = getAvailablePurchaseQuantity(row);
      if (availableQuantity === null) {
        throw new Error(`Could not determine available stock for ${row.brand}, batch ${row.batchNumber}.`);
      }
      if (availableQuantity === 0) continue;

      const soldQuantity = Math.min(availableQuantity, remaining);
      const nextAvailableQuantity = Number((availableQuantity - soldQuantity).toFixed(4));
      const nextPackQuantity = calculatePackQuantity(row.packSize, nextAvailableQuantity);
      updatedRows[index] = {
        ...row,
        availableQuantity: String(nextAvailableQuantity),
        ...(nextPackQuantity !== null ? { quantity: String(nextPackQuantity) } : {}),
        updatedAt: new Date().toISOString(),
      };
      remaining -= soldQuantity;
    }

    if (remaining > 0) {
      const availableQuantity = demand.quantity - remaining;
      throw new Error(
        `Not enough stock for ${demand.brand}, batch ${demand.batchNumber}. Available: ${availableQuantity}; requested: ${demand.quantity}.`,
      );
    }
  }

  return updatedRows;
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
  notifyPurchaseListRowsChanged(rows);
}

export function notifyPurchaseListRowsChanged(rows: PurchaseListRow[]) {
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}

export function persistPlaceOrderListRows(rows: PurchaseListRow[]) {
  localStorage.setItem(PLACE_ORDER_STORAGE_KEY, JSON.stringify(rows));
  cachedPlaceOrderSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}
