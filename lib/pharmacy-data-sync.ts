import { supabase } from "@/lib/supabase/client";
import {
  assertPharmacyStaffAccess,
  type StaffPageAction,
} from "@/lib/pharmacy-staff-permissions";

export const pharmacyDataKeys = [
  "pharmacy-sales-list-v1",
  "pharmacy-purchase-list-v1",
  "pharmacy-place-order-list-v1",
  "pharmacy-expenses-v1",
  "pharmacy-return-records-v1",
  "pharmacy-low-stock-threshold-v1",
  "pharmacy-payment-methods-v1",
  "pharmacy-vat-tax-settings-v1",
  "pharmacy-return-deduction-settings-v1",
  "pharmacy-invoice-templates-v1",
  "pharmacy-supplier-status-v1",
  "pharmacy-supplier-due-adjustments-v1",
  "pharmacy-supplier-due-payments-v1",
] as const;

export type PharmacyDataKey = (typeof pharmacyDataKeys)[number];
type SyncState = "idle" | "syncing" | "synced" | "error";
type SyncStatus = { state: SyncState; message: string; lastSyncedAt: number | null };
type CloudDataRow = { data_key: string; payload: unknown };

const syncStatusEvent = "pharmacy-data-sync-status";
const localCacheKeys = [
  ...pharmacyDataKeys,
  "pharmacy-cluster-products",
  "pharmacy-data-sync-owner-v1",
  "pharmacy-data-sync-state-v1",
] as const;
const keyEvents: Record<PharmacyDataKey, string> = {
  "pharmacy-sales-list-v1": "pharmacy-sales-list-updated",
  "pharmacy-purchase-list-v1": "pharmacy-purchase-list-updated",
  "pharmacy-place-order-list-v1": "pharmacy-purchase-list-updated",
  "pharmacy-expenses-v1": "pharmacy-expenses-updated",
  "pharmacy-return-records-v1": "pharmacy-return-records-updated",
  "pharmacy-low-stock-threshold-v1": "pharmacy-low-stock-threshold-updated",
  "pharmacy-payment-methods-v1": "pharmacy-payment-methods-updated",
  "pharmacy-vat-tax-settings-v1": "pharmacy-vat-tax-settings-updated",
  "pharmacy-return-deduction-settings-v1": "pharmacy-return-deduction-settings-updated",
  "pharmacy-invoice-templates-v1": "pharmacy-invoice-templates-updated",
  "pharmacy-supplier-status-v1": "pharmacy-supplier-dues-updated",
  "pharmacy-supplier-due-adjustments-v1": "pharmacy-supplier-dues-updated",
  "pharmacy-supplier-due-payments-v1": "pharmacy-supplier-dues-updated",
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
let knownDataKeys = new Set<PharmacyDataKey>();
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

function getSyncErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const message = typeof details.message === "string" ? details.message : "";
    const code = typeof details.code === "string" ? ` (${details.code})` : "";
    const detail = typeof details.details === "string" ? ` Details: ${details.details}` : "";
    const hint = typeof details.hint === "string" ? ` Hint: ${details.hint}` : "";
    if (message || code || detail || hint) return `${message || "Supabase request failed."}${code}${detail}${hint}`;

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      return "Could not sync pharmacy data with Supabase.";
    }
  }

  return "Could not sync pharmacy data with Supabase.";
}

function reportSyncError(error: unknown) {
  notifyStatus({
    state: "error",
    message: getSyncErrorMessage(error),
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

const dataKeyPages: Record<PharmacyDataKey, string> = {
  "pharmacy-sales-list-v1": "sales",
  "pharmacy-purchase-list-v1": "purchase",
  "pharmacy-place-order-list-v1": "purchase",
  "pharmacy-expenses-v1": "expenses",
  "pharmacy-return-records-v1": "returns",
  "pharmacy-low-stock-threshold-v1": "settings",
  "pharmacy-payment-methods-v1": "settings",
  "pharmacy-vat-tax-settings-v1": "settings",
  "pharmacy-return-deduction-settings-v1": "settings",
  "pharmacy-invoice-templates-v1": "settings",
  "pharmacy-supplier-status-v1": "suppliers",
  "pharmacy-supplier-due-adjustments-v1": "suppliers",
  "pharmacy-supplier-due-payments-v1": "suppliers",
};

export function setPharmacyDataJson(
  key: PharmacyDataKey,
  serialized: string,
  action: StaffPageAction = "edit",
) {
  let payload: unknown;
  try {
    payload = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`Could not save ${key}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  setPharmacyDataBatch({ [key]: payload }, action);
}

async function flushDirtyData(ownerId: string) {
  if (initializedOwnerId !== ownerId || !dirtyKeys.size) return;
  const entries = [...dirtyKeys]
    .map((key) => [key, pharmacyData.get(key)] as const)
    .filter((entry) => entry[1] !== undefined);
  if (!entries.length) return;
  for (const [data_key, payload] of entries) {
    const row = {
      owner_user_id: ownerId,
      data_key,
      payload,
      updated_at: new Date().toISOString(),
    };
    const result = knownDataKeys.has(data_key)
      ? await supabase
        .from("pharmacy_app_data")
        .update(row)
        .eq("owner_user_id", ownerId)
        .eq("data_key", data_key)
        .select("data_key")
        .maybeSingle()
      : await supabase
        .from("pharmacy_app_data")
        .insert(row)
        .select("data_key")
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      throw new Error(`Could not save ${data_key}; check that you have permission to edit this page.`);
    }
    knownDataKeys.add(data_key);
  }
  entries.forEach(([key, payload]) => {
    if (JSON.stringify(pharmacyData.get(key)) === JSON.stringify(payload)) dirtyKeys.delete(key);
  });
  if (dirtyKeys.size === 0) {
    notifyStatus({ state: "synced", message: "All pharmacy data is synced.", lastSyncedAt: Date.now() });
  }
}

function queueDirtyData(ownerId: string) {
  const queuedWrite = writeQueue
    .catch(() => undefined)
    .then(() => flushDirtyData(ownerId));
  writeQueue = queuedWrite;
  void queuedWrite.catch(reportSyncError);
  return queuedWrite;
}

export function setPharmacyDataBatch(
  updates: Partial<Record<PharmacyDataKey, unknown>>,
  action: StaffPageAction | Partial<Record<PharmacyDataKey, StaffPageAction>> = "edit",
) {
  assertInitialized();
  const entries = Object.entries(updates) as [PharmacyDataKey, unknown][];
  if (!entries.length) return;
  for (const [key] of entries) {
    const requestedAction = typeof action === "string" ? action : action[key] ?? "edit";
    const effectiveAction = !knownDataKeys.has(key) && requestedAction === "edit"
      ? "create"
      : requestedAction;
    assertPharmacyStaffAccess(dataKeyPages[key], effectiveAction);
  }
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
  knownDataKeys = new Set();
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
      const key = row.data_key as PharmacyDataKey;
      pharmacyData.set(key, row.payload);
      knownDataKeys.add(key);
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
  const waitForPendingWrites = async (ignorePreviousFailure = false) => {
    while (true) {
      const pendingWrites = writeQueue;
      try {
        await pendingWrites;
      } catch (error) {
        if (!ignorePreviousFailure) throw error;
      }
      if (pendingWrites === writeQueue) return;
    }
  };

  return waitForPendingWrites(true).then(async () => {
    if (dirtyKeys.size) await queueDirtyData(ownerId);
    await waitForPendingWrites();
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
