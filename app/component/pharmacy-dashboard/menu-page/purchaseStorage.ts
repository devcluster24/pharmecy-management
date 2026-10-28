import { getPharmacyDataJson, setPharmacyDataJson } from "@/lib/pharmacy-data-sync";

export const PURCHASE_STORAGE_KEY = "pharmacy-purchase-list-v1";
export const PLACE_ORDER_STORAGE_KEY = "pharmacy-place-order-list-v1";

export type PurchaseListRow = {
  id: string;
  order: string;
  supplier: string;
  supplierContactName?: string;
  supplierPhone?: string;
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
  orderPaidAmount?: string;
  orderDueAmount?: string;
  placedAt?: string;
  updatedAt?: string;
  receivedAt?: string;
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
const purchaseListUpdatedEvent = "pharmacy-purchase-list-updated";
let cachedSnapshot: PurchaseListSnapshot | null = null;
let cachedPlaceOrderSnapshot: PurchaseListSnapshot | null = null;

export function getOrderTotal(rows: PurchaseListRow[]) {
  return rows.reduce((total, row) => {
    const amount = Number(row.totalPrice);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}

function getPackSizeMultiplier(packSize: string) {
  const factors = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((factor) =>
    Number(factor.replace(/,/g, "")),
  ) ?? [];
  if (!factors.length || factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;

  const multiplier = factors.reduce((total, factor) => total * factor, 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

export function getInventoryPackPrice(mrp?: string) {
  const parsedMrp = mrp?.trim();
  return parsedMrp && parsedMrp !== "-" ? parsedMrp : "-";
}

export function calculateInventoryUnitPrice(packPrice: string, packSize: string) {
  if (!packPrice.trim() || !packSize.trim() || packPrice.trim() === "-") return "-";
  const parsedPackPrice = Number(packPrice);
  const packMultiplier = getPackSizeMultiplier(packSize);
  if (
    !Number.isFinite(parsedPackPrice)
    || parsedPackPrice < 0
    || packMultiplier === null
  ) return "-";
  return String(Number((parsedPackPrice / packMultiplier).toFixed(4)));
}

export function groupPurchaseOrders(
  rows: PurchaseListRow[],
  useReceivedAt = false,
): GroupedPurchaseOrder[] {
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
        const timestamp = Date.parse(
          useReceivedAt
            ? row.receivedAt ?? row.orderDate
            : row.updatedAt ?? row.orderDate,
        );
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
    && (!("supplierContactName" in value) || typeof value.supplierContactName === "string")
    && (!("supplierPhone" in value) || typeof value.supplierPhone === "string")
    && (!("quantity" in value) || typeof value.quantity === "string")
    && (!("availableQuantity" in value) || typeof value.availableQuantity === "string")
    && (!("totalPrice" in value) || typeof value.totalPrice === "string")
    && (!("unitPurchasePrice" in value) || typeof value.unitPurchasePrice === "string")
    && (!("mrp" in value) || typeof value.mrp === "string")
    && (!("productId" in value) || typeof value.productId === "string")
    && (!("productPackPrice" in value) || typeof value.productPackPrice === "string")
    && (!("orderPaidAmount" in value) || typeof value.orderPaidAmount === "string")
    && (!("orderDueAmount" in value) || typeof value.orderDueAmount === "string")
    && (!("placedAt" in value) || typeof value.placedAt === "string")
    && (!("updatedAt" in value) || typeof value.updatedAt === "string")
    && (!("receivedAt" in value) || typeof value.receivedAt === "string");
}

export function calculateUnitPurchasePrice(packSize: string, totalPrice: string, quantity: string) {
  if (!packSize.trim() || !totalPrice.trim() || !quantity.trim()) return "-";
  const packMultiplier = getPackSizeMultiplier(packSize);
  const parsedTotalPrice = Number(totalPrice);
  const parsedQuantity = Number(quantity);
  if (
    packMultiplier === null ||
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
  if (
    !Number.isFinite(parsedQuantity)
    || parsedQuantity < 0
  ) return null;

  const packMultiplier = getPackSizeMultiplier(packSize);
  if (packMultiplier === null) return null;
  const totalQuantity = parsedQuantity * packMultiplier;
  return Number.isFinite(totalQuantity)
    ? Number(totalQuantity.toFixed(4))
    : null;
}

export function calculatePackQuantity(packSize: string, totalQuantity: number): number | null {
  if (!packSize.trim() || !Number.isFinite(totalQuantity) || totalQuantity < 0) return null;
  const packMultiplier = getPackSizeMultiplier(packSize);
  return packMultiplier !== null
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

export type ReturnStockLine = SaleStockLine;

export function getPurchaseRowsAfterReturn(lines: ReturnStockLine[]) {
  const rows = readPurchaseListRows();
  const updatedRows = [...rows];
  const quantities = new Map<string, ReturnStockLine>();

  for (const line of lines) {
    const brand = line.brand.trim().toLocaleLowerCase();
    const batchNumber = line.batchNumber.trim().toLocaleLowerCase();
    if (!brand || !batchNumber || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("Each returned item must have a brand, batch number, and valid quantity.");
    }
    const key = JSON.stringify([brand, batchNumber]);
    const existing = quantities.get(key);
    quantities.set(key, {
      brand,
      batchNumber,
      quantity: (existing?.quantity ?? 0) + line.quantity,
    });
  }

  for (const line of quantities.values()) {
    const rowIndex = updatedRows.findIndex((row) =>
      row.brand.trim().toLocaleLowerCase() === line.brand
      && row.batchNumber.trim().toLocaleLowerCase() === line.batchNumber,
    );
    if (rowIndex === -1) {
      throw new Error(`Could not find ${line.brand}, batch ${line.batchNumber} in inventory.`);
    }

    const row = updatedRows[rowIndex];
    const availableQuantity = getAvailablePurchaseQuantity(row);
    if (availableQuantity === null) {
      throw new Error(`Could not determine inventory quantity for ${row.brand}, batch ${row.batchNumber}.`);
    }

    const nextAvailableQuantity = Number((availableQuantity + line.quantity).toFixed(4));
    const nextPackQuantity = calculatePackQuantity(row.packSize, nextAvailableQuantity);
    updatedRows[rowIndex] = {
      ...row,
      availableQuantity: String(nextAvailableQuantity),
      ...(nextPackQuantity !== null ? { quantity: String(nextPackQuantity) } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  return updatedRows;
}

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
  const dataKey = storageKey === PURCHASE_STORAGE_KEY ? PURCHASE_STORAGE_KEY : PLACE_ORDER_STORAGE_KEY;
  const storedRows = getPharmacyDataJson(dataKey);
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

export function persistPurchaseListRows(rows: PurchaseListRow[], action: "create" | "edit" | "delete" = "edit") {
  setPharmacyDataJson(PURCHASE_STORAGE_KEY, JSON.stringify(rows), action);
  notifyPurchaseListRowsChanged(rows);
}

export function notifyPurchaseListRowsChanged(rows: PurchaseListRow[]) {
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}

export function persistPlaceOrderListRows(rows: PurchaseListRow[], action: "create" | "edit" | "delete" = "edit") {
  setPharmacyDataJson(PLACE_ORDER_STORAGE_KEY, JSON.stringify(rows), action);
  cachedPlaceOrderSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(purchaseListUpdatedEvent));
}
