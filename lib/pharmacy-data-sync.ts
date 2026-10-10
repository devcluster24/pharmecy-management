import { supabase } from "@/lib/supabase/client";

const syncOwnerMarkerKey = "pharmecy-data-sync-owner-v1";
const refreshIntervalMs = 30_000;
const syncStatusEvent = "pharmecy-data-sync-status";

const localDataKeys = [
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

type LocalDataKey = (typeof localDataKeys)[number];
type SyncState = "idle" | "syncing" | "synced" | "error";
type SyncStatus = { state: SyncState; message: string; lastSyncedAt: number | null };
type CloudDataRow = { data_key: LocalDataKey; payload: unknown };

const emptySyncStatus: SyncStatus = { state: "idle", message: "", lastSyncedAt: null };
let syncStatus = emptySyncStatus;
let initializedOwnerId: string | null = null;
let initialization: Promise<void> | null = null;
let refreshTimer: number | null = null;
const statusListeners = new Set<() => void>();
let activeEventCleanups: (() => void)[] = [];
let syncQueue = new Map<LocalDataKey, Promise<void>>();
let dirtyKeys = new Set<LocalDataKey>();
let refreshInProgress = false;
let applyingCloudData = false;

const eventKeys: Record<string, LocalDataKey[]> = {
  "pharmecy-sales-list-updated": ["pharmecy-sales-list-v1", "pharmecy-purchase-list-v1"],
  "pharmecy-purchase-list-updated": ["pharmecy-purchase-list-v1", "pharmecy-place-order-list-v1"],
  "pharmecy-expenses-updated": ["pharmecy-expenses-v1"],
  "pharmecy-return-records-updated": ["pharmecy-return-records-v1", "pharmecy-purchase-list-v1"],
  "pharmecy-low-stock-threshold-updated": ["pharmecy-low-stock-threshold-v1"],
  "pharmecy-payment-methods-updated": ["pharmecy-payment-methods-v1"],
  "pharmecy-vat-tax-settings-updated": ["pharmecy-vat-tax-settings-v1"],
  "pharmecy-return-deduction-settings-updated": ["pharmecy-return-deduction-settings-v1"],
  "pharmecy-supplier-dues-updated": [
    "pharmecy-supplier-status-v1",
    "pharmecy-supplier-due-adjustments-v1",
    "pharmecy-supplier-due-payments-v1",
  ],
};

const keyEvents: Record<LocalDataKey, string> = {
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

const dataKeySet = new Set<string>(localDataKeys);
const cloudRefreshListener = () => {
  void retryPharmacyDataSync().catch(() => undefined);
};

function notifyStatus(nextStatus: SyncStatus) {
  syncStatus = nextStatus;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(syncStatusEvent));
  }
  statusListeners.forEach((listener) => listener());
}

function parseLocalPayload(key: LocalDataKey): unknown | null {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return null;
  try {
    return JSON.parse(saved) as unknown;
  } catch (error) {
    throw new Error(`Could not import saved data for ${key}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function saveCloudPayloadLocally(key: LocalDataKey, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (window.localStorage.getItem(key) === serialized) return;
  applyingCloudData = true;
  try {
    window.localStorage.setItem(key, serialized);
    window.dispatchEvent(new Event(keyEvents[key]));
  } finally {
    applyingCloudData = false;
  }
}

async function readCloudRows(ownerId: string) {
  const { data, error } = await supabase
    .from("pharmacy_app_data")
    .select("data_key, payload")
    .eq("owner_user_id", ownerId);
  if (error) throw error;
  return (data ?? []) as CloudDataRow[];
}

async function upsertCloudPayload(ownerId: string, key: LocalDataKey, payload: unknown) {
  const { error } = await supabase
    .from("pharmacy_app_data")
    .upsert(
      { owner_user_id: ownerId, data_key: key, payload, updated_at: new Date().toISOString() },
      { onConflict: "owner_user_id,data_key" },
    );
  if (error) throw error;
}

function stopOwnerListeners() {
  activeEventCleanups.forEach((cleanup) => cleanup());
  activeEventCleanups = [];
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  window.removeEventListener("focus", cloudRefreshListener);
  window.removeEventListener("online", cloudRefreshListener);
  initializedOwnerId = null;
  syncQueue = new Map();
  dirtyKeys = new Set();
}

function reportSyncError(error: unknown) {
  notifyStatus({
    state: "error",
    message: error instanceof Error ? error.message : "Could not sync pharmacy data with Supabase.",
    lastSyncedAt: syncStatus.lastSyncedAt,
  });
}

async function syncKeyToCloud(key: LocalDataKey) {
  const ownerId = initializedOwnerId;
  if (!ownerId) return;
  const payload = parseLocalPayload(key);
  if (payload === null) {
    const { error } = await supabase
      .from("pharmacy_app_data")
      .delete()
      .eq("owner_user_id", ownerId)
      .eq("data_key", key);
    if (error) throw error;
    return;
  }
  await upsertCloudPayload(ownerId, key, payload);
}

function queueKeySync(key: LocalDataKey) {
  if (!initializedOwnerId) return Promise.resolve();
  dirtyKeys.add(key);
  notifyStatus({ state: "syncing", message: "Saving changes to this pharmacy's Supabase account…", lastSyncedAt: syncStatus.lastSyncedAt });
  const previous = syncQueue.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => syncKeyToCloud(key))
    .then(() => {
      dirtyKeys.delete(key);
      if (dirtyKeys.size === 0) {
        notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
      }
    })
    .catch(reportSyncError)
    .finally(() => {
      if (syncQueue.get(key) === current) syncQueue.delete(key);
    });
  syncQueue.set(key, current);
    return current;
}

async function refreshFromCloud() {
  if (!initializedOwnerId || refreshInProgress) return;
  refreshInProgress = true;
  const ownerId = initializedOwnerId;
  try {
    const rows = await readCloudRows(ownerId);
    if (initializedOwnerId !== ownerId) return;
    for (const row of rows) {
      if (dataKeySet.has(row.data_key) && !dirtyKeys.has(row.data_key)) {
        saveCloudPayloadLocally(row.data_key, row.payload);
      }
    }
    notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
  } catch (error) {
    reportSyncError(error);
    throw error;
  } finally {
    refreshInProgress = false;
  }
}

function listenForWrites() {
  for (const [eventName, keys] of Object.entries(eventKeys)) {
    const handler = () => {
      if (applyingCloudData) return;
      keys.forEach(queueKeySync);
    };
    window.addEventListener(eventName, handler);
    activeEventCleanups.push(() => window.removeEventListener(eventName, handler));
  }
  window.addEventListener("focus", cloudRefreshListener);
  window.addEventListener("online", cloudRefreshListener);
  activeEventCleanups.push(() => {
    window.removeEventListener("focus", cloudRefreshListener);
    window.removeEventListener("online", cloudRefreshListener);
  });
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void retryPharmacyDataSync().catch(() => undefined);
    }
  }, refreshIntervalMs);
}

async function initializeOwner(ownerId: string) {
  stopOwnerListeners();
  notifyStatus({ state: "syncing", message: "Loading this pharmacy's cloud data…", lastSyncedAt: syncStatus.lastSyncedAt });
  const remoteRows = await readCloudRows(ownerId);
  const remoteByKey = new Map<LocalDataKey, unknown>(
    remoteRows
      .filter((row) => dataKeySet.has(row.data_key))
      .map((row) => [row.data_key, row.payload]),
  );
  const migrationMarker = window.localStorage.getItem(syncOwnerMarkerKey);
  const shouldImportLegacyData = migrationMarker === null;
  const localPayloads = new Map<LocalDataKey, unknown>();
  if (shouldImportLegacyData) {
    for (const key of localDataKeys) {
      if (!remoteByKey.has(key)) {
        const payload = parseLocalPayload(key);
        if (payload !== null) localPayloads.set(key, payload);
      }
    }
  }

  const importRows = [...localPayloads.entries()].map(([data_key, payload]) => ({
    owner_user_id: ownerId,
    data_key,
    payload,
    updated_at: new Date().toISOString(),
  }));
  if (importRows.length > 0) {
    const { error } = await supabase
      .from("pharmacy_app_data")
      .upsert(importRows, { onConflict: "owner_user_id,data_key" });
    if (error) throw error;
  }

  for (const key of localDataKeys) {
    if (remoteByKey.has(key)) {
      saveCloudPayloadLocally(key, remoteByKey.get(key));
    } else if (localPayloads.has(key)) {
      saveCloudPayloadLocally(key, localPayloads.get(key));
    } else {
      window.localStorage.removeItem(key);
    }
  }
  window.localStorage.setItem(syncOwnerMarkerKey, ownerId);
  initializedOwnerId = ownerId;
  listenForWrites();
  notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
}

export function initializePharmacyDataSync(ownerId: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (initializedOwnerId === ownerId) return Promise.resolve();
  if (initialization) return initialization;
  initialization = initializeOwner(ownerId)
    .catch((error: unknown) => {
      reportSyncError(error);
      throw error;
    })
    .finally(() => {
      initialization = null;
    });
  return initialization;
}

export function retryPharmacyDataSync() {
  if (!initializedOwnerId) return Promise.resolve();
  notifyStatus({ state: "syncing", message: "Retrying Supabase sync…", lastSyncedAt: syncStatus.lastSyncedAt });
  return Promise.all([...syncQueue.values()]).then(() => refreshFromCloud()).then(async () => {
    await Promise.all([...dirtyKeys].map((key) => queueKeySync(key)));
    if (dirtyKeys.size > 0) throw new Error(syncStatus.message || "Some pharmacy data is still waiting to sync.");
    notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
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
