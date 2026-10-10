import { supabase } from "@/lib/supabase/client";

export const pharmacyDataKeys = [
  "pharmecy-sales-list-v1",
  "pharmecy-purchase-list-v1",
  "pharmecy-place-order-list-v1",
  "pharmecy-expenses-v1",
  "pharmecy-return-records-v1",
  "pharmecy-low-stock-threshold-v1",
  "pharmecy-payment-methods-v1",
  "pharmecy-vat-tax-settings-v1",
  "pharmecy-return-deduction-settings-v1",
  "pharmecy-supplier-status-v1",
  "pharmecy-supplier-due-adjustments-v1",
  "pharmecy-supplier-due-payments-v1",
] as const;

export type PharmacyDataKey = (typeof pharmacyDataKeys)[number];
type SyncState = "idle" | "syncing" | "synced" | "error";
type SyncStatus = { state: SyncState; message: string; lastSyncedAt: number | null };
type CloudDataRow = { data_key: string; payload: unknown };

const syncStatusEvent = "pharmecy-data-sync-status";
const localCacheKeys = [
  ...pharmacyDataKeys,
  "pharmacy-cluster-products",
  "pharmecy-data-sync-owner-v1",
  "pharmecy-data-sync-state-v1",
] as const;
const keyEvents: Record<PharmacyDataKey, string> = {
  "pharmecy-sales-list-v1": "pharmecy-sales-list-updated",
  "pharmecy-purchase-list-v1": "pharmecy-purchase-list-updated",
  "pharmecy-place-order-list-v1": "pharmecy-purchase-list-updated",
  "pharmecy-expenses-v1": "pharmecy-expenses-updated",
  "pharmecy-return-records-v1": "pharmecy-return-records-updated",
  "pharmecy-low-stock-threshold-v1": "pharmecy-low-stock-threshold-updated",
  "pharmecy-payment-methods-v1": "pharmecy-payment-methods-updated",
  "pharmecy-vat-tax-settings-v1": "pharmecy-vat-tax-settings-updated",
  "pharmecy-return-deduction-settings-v1": "pharmecy-return-deduction-settings-updated",
  "pharmecy-supplier-status-v1": "pharmecy-supplier-dues-updated",
  "pharmecy-supplier-due-adjustments-v1": "pharmecy-supplier-dues-updated",
  "pharmecy-supplier-due-payments-v1": "pharmecy-supplier-dues-updated",
};

const emptySyncStatus: SyncStatus = { state: "idle", message: "", lastSyncedAt: null };
const pharmacyData = new Map<PharmacyDataKey, unknown>();
const statusListeners = new Set<() => void>();
let syncStatus = emptySyncStatus;
let initializedOwnerId: string | null = null;
let initialization: Promise<void> | null = null;
let initializationOwnerId: string | null = null;
let ownerGeneration = 0;
let refreshTimer: number | null = null;
let activeEventCleanups: (() => void)[] = [];
let dirtyKeys = new Set<PharmacyDataKey>();
let refreshInProgress = false;
let writeQueue: Promise<void> = Promise.resolve();

const dataKeySet = new Set<string>(pharmacyDataKeys);

function notifyStatus(nextStatus: SyncStatus) {
  syncStatus = nextStatus;
  window.dispatchEvent(new Event(syncStatusEvent));
  statusListeners.forEach((listener) => listener());
}

function notifyDataChanged(keys: PharmacyDataKey[]) {
  for (const eventName of new Set(keys.map((key) => keyEvents[key]))) {
    window.dispatchEvent(new Event(eventName));
  }
}

function reportSyncError(error: unknown) {
  notifyStatus({
    state: "error",
    message: error instanceof Error ? error.message : "Could not sync pharmacy data with Supabase.",
    lastSyncedAt: syncStatus.lastSyncedAt,
  });
}

function assertInitialized() {
  if (!initializedOwnerId) {
    throw new Error("Pharmacy cloud data is not ready yet. Wait for dashboard data to finish loading.");
  }
}

export function getPharmacyDataJson(key: PharmacyDataKey) {
  const payload = pharmacyData.get(key);
  return payload === undefined ? null : JSON.stringify(payload);
}

export function setPharmacyDataJson(key: PharmacyDataKey, serialized: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`Could not save ${key}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  setPharmacyDataBatch({ [key]: payload });
}

async function flushDirtyData(ownerId: string) {
  if (initializedOwnerId !== ownerId || !dirtyKeys.size) return;
  const entries = [...dirtyKeys]
    .map((key) => [key, pharmacyData.get(key)] as const)
    .filter((entry) => entry[1] !== undefined);
  if (!entries.length) return;
  const rows = entries.map(([data_key, payload]) => ({
    owner_user_id: ownerId,
    data_key,
    payload,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("pharmacy_app_data")
    .upsert(rows, { onConflict: "owner_user_id,data_key" });
  if (error) throw error;
  entries.forEach(([key, payload]) => {
    if (JSON.stringify(pharmacyData.get(key)) === JSON.stringify(payload)) dirtyKeys.delete(key);
  });
  if (dirtyKeys.size === 0) {
    notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
  }
}

function queueDirtyData(ownerId: string) {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => flushDirtyData(ownerId))
    .catch(reportSyncError);
}

export function setPharmacyDataBatch(updates: Partial<Record<PharmacyDataKey, unknown>>) {
  assertInitialized();
  const entries = Object.entries(updates) as [PharmacyDataKey, unknown][];
  if (!entries.length) return;
  for (const [key, payload] of entries) {
    pharmacyData.set(key, payload);
    dirtyKeys.add(key);
  }
  notifyDataChanged(entries.map(([key]) => key));
  notifyStatus({ state: "syncing", message: "Saving changes to this pharmacy's Supabase account…", lastSyncedAt: syncStatus.lastSyncedAt });
  const ownerId = initializedOwnerId;
  if (!ownerId) throw new Error("The signed-in pharmacy changed before the data could be saved.");
  queueDirtyData(ownerId);
}

async function readCloudRows(ownerId: string) {
  const { data, error } = await supabase
    .from("pharmacy_app_data")
    .select("data_key, payload")
    .eq("owner_user_id", ownerId);
  if (error) throw error;
  return (data ?? []) as CloudDataRow[];
}

async function refreshFromCloud() {
  if (!initializedOwnerId || refreshInProgress) return;
  refreshInProgress = true;
  const ownerId = initializedOwnerId;
  try {
    const rows = await readCloudRows(ownerId);
    if (initializedOwnerId !== ownerId) return;
    const refreshedKeys: PharmacyDataKey[] = [];
    const remoteKeys = new Set<PharmacyDataKey>();
    for (const row of rows) {
      if (!dataKeySet.has(row.data_key)) continue;
      const key = row.data_key as PharmacyDataKey;
      remoteKeys.add(key);
      if (dirtyKeys.has(key)) continue;
      const oldPayload = pharmacyData.get(key);
      if (JSON.stringify(oldPayload) !== JSON.stringify(row.payload)) {
        pharmacyData.set(key, row.payload);
        refreshedKeys.push(key);
      }
    }
    pharmacyDataKeys.forEach((key) => {
      if (!remoteKeys.has(key) && !dirtyKeys.has(key) && pharmacyData.delete(key)) refreshedKeys.push(key);
    });
    if (refreshedKeys.length) notifyDataChanged(refreshedKeys);
    notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
  } catch (error) {
    reportSyncError(error);
    throw error;
  } finally {
    refreshInProgress = false;
  }
}

function stopOwnerListeners() {
  ownerGeneration += 1;
  activeEventCleanups.forEach((cleanup) => cleanup());
  activeEventCleanups = [];
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  initializedOwnerId = null;
  dirtyKeys = new Set();
  pharmacyData.clear();
  writeQueue = Promise.resolve();
}

function refreshListener() {
  void retryPharmacyDataSync().catch(() => undefined);
}

function listenForRefresh() {
  window.addEventListener("focus", refreshListener);
  window.addEventListener("online", refreshListener);
  activeEventCleanups.push(() => {
    window.removeEventListener("focus", refreshListener);
    window.removeEventListener("online", refreshListener);
  });
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void retryPharmacyDataSync().catch(() => undefined);
    }
  }, 30_000);
}

async function initializeOwner(ownerId: string) {
  stopOwnerListeners();
  const generation = ownerGeneration;
  notifyStatus({ state: "syncing", message: "Loading this pharmacy's data from Supabase…", lastSyncedAt: null });
  for (const key of localCacheKeys) window.localStorage.removeItem(key);
  const rows = await readCloudRows(ownerId);
  if (generation !== ownerGeneration) throw new Error("The signed-in pharmacy changed while loading its data.");

  for (const row of rows) {
    if (dataKeySet.has(row.data_key)) {
      pharmacyData.set(row.data_key as PharmacyDataKey, row.payload);
    }
  }
  initializedOwnerId = ownerId;
  notifyDataChanged([...pharmacyDataKeys]);
  listenForRefresh();
  notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
}

export function initializePharmacyDataSync(ownerId: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (initializedOwnerId === ownerId) return Promise.resolve();
  if (initialization && initializationOwnerId === ownerId) return initialization;
  initializationOwnerId = ownerId;
  const request = initializeOwner(ownerId)
    .catch((error: unknown) => {
      if (initializationOwnerId === ownerId) reportSyncError(error);
      throw error;
    })
    .finally(() => {
      if (initialization === request) {
        initialization = null;
        initializationOwnerId = null;
      }
    });
  initialization = request;
  return request;
}

export function retryPharmacyDataSync() {
  if (!initializedOwnerId) return Promise.resolve();
  notifyStatus({ state: "syncing", message: "Checking Supabase for pharmacy data…", lastSyncedAt: syncStatus.lastSyncedAt });
  const ownerId = initializedOwnerId;
  if (dirtyKeys.size) queueDirtyData(ownerId);
  const waitForPendingWrites = async () => {
    while (true) {
      const pendingWrites = writeQueue;
      await pendingWrites;
      if (pendingWrites === writeQueue) return;
    }
  };
  return waitForPendingWrites().then(() => {
    if (dirtyKeys.size) throw new Error("Some pharmacy data is still waiting to sync.");
    return refreshFromCloud();
  }).then(() => {
    if (dirtyKeys.size) throw new Error("Some pharmacy data is still waiting to sync.");
  }).catch((error: unknown) => {
    reportSyncError(error);
    throw error;
  });
}

export function getPharmacyDataSyncStatus() {
  return syncStatus;
}

export function subscribeToPharmacyDataSync(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
