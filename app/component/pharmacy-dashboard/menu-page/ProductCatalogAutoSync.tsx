"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  importCatalogProducts,
  loadInitialCatalogImportState,
  loadProductAutoSyncSettings,
  parseProductAutoSyncSettings,
  PRODUCT_CATALOG_AUTO_SYNC_KEY,
  resolveProductOwnerId,
  saveInitialCatalogImportState,
  saveProductAutoSyncSettings,
  type ProductAutoSyncSettings,
  type InitialCatalogImportState,
} from "./productCatalogSync";

const initialImportOwners = new Set<string>();
const initialImportRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function startInitialCatalogImport(ownerId: string) {
  if (initialImportOwners.has(ownerId)) return;
  const retryTimer = initialImportRetryTimers.get(ownerId);
  if (retryTimer) {
    clearTimeout(retryTimer);
    initialImportRetryTimers.delete(ownerId);
  }
  initialImportOwners.add(ownerId);
  let state: InitialCatalogImportState | null = null;
  let shouldRetry = false;
  try {
    state = await loadInitialCatalogImportState(ownerId);
    if (state?.status === "completed") return;

    if (!state) {
      const { count: catalogCount, error: catalogCountError } = await supabase
        .from("admin_medicine_catalog")
        .select("id", { count: "exact", head: true });
      if (catalogCountError) throw catalogCountError;

      const startedAt = new Date().toISOString();
      const settings = await loadProductAutoSyncSettings(ownerId);
      if (!settings.enabled) await saveProductAutoSyncSettings(ownerId, true);

      state = {
        status: "running",
        total: catalogCount ?? 0,
        processed: 0,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        cursor: null,
        startedAt,
        updatedAt: startedAt,
      };
      if (!state.total) state.status = "completed";
      await saveInitialCatalogImportState(ownerId, state);
      if (state.status === "completed") return;
    } else {
      state = {
        ...state,
        status: "running",
        updatedAt: new Date().toISOString(),
      };
      delete state.error;
      await saveInitialCatalogImportState(ownerId, state);
    }

    const checkpoint = state;
    const result = await importCatalogProducts(ownerId, {
      afterId: checkpoint.cursor,
      pageSize: 500,
      onProgress: async (progress) => {
        state = {
          ...checkpoint,
          status: "running",
          processed: checkpoint.processed + progress.processed,
          imported: checkpoint.imported + progress.imported,
          duplicates: checkpoint.duplicates + progress.duplicates,
          skipped: checkpoint.skipped + progress.skipped,
          cursor: progress.cursor,
          updatedAt: new Date().toISOString(),
        };
        await saveInitialCatalogImportState(ownerId, state);
      },
    });

    state = {
      ...state,
      status: "completed",
      processed: checkpoint.processed + result.available,
      imported: checkpoint.imported + result.added,
      duplicates: checkpoint.duplicates + result.duplicates,
      skipped: checkpoint.skipped + result.skipped,
      cursor: result.cursor ?? state.cursor,
      updatedAt: new Date().toISOString(),
    };
    await saveInitialCatalogImportState(ownerId, state);
  } catch (syncError) {
    console.error("Initial product catalog import failed:", syncError);
    shouldRetry = true;
    const now = new Date().toISOString();
    const message = syncError instanceof Error ? syncError.message : "Initial catalog import failed.";
    state = {
      status: "failed",
      total: state?.total ?? 0,
      processed: state?.processed ?? 0,
      imported: state?.imported ?? 0,
      duplicates: state?.duplicates ?? 0,
      skipped: state?.skipped ?? 0,
      cursor: state?.cursor ?? null,
      startedAt: state?.startedAt ?? now,
      updatedAt: now,
      error: message,
    };
    try {
      await saveInitialCatalogImportState(ownerId, state);
    } catch (progressError) {
      console.error("Could not save initial catalog import failure state:", progressError);
    }
  } finally {
    initialImportOwners.delete(ownerId);
    if (shouldRetry && !initialImportRetryTimers.has(ownerId)) {
      const timer = setTimeout(() => {
        initialImportRetryTimers.delete(ownerId);
        void startInitialCatalogImport(ownerId);
      }, 3000);
      initialImportRetryTimers.set(ownerId, timer);
    }
  }
}

export async function resumeInitialCatalogImport(ownerId: string) {
  await startInitialCatalogImport(ownerId);
}

export default function ProductCatalogAutoSync() {
  useEffect(() => {
    let active = true;
    let ownerId = "";
    let settings: ProductAutoSyncSettings = { enabled: false, enabledAt: null };
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let syncing = false;
    let syncRequested = false;

    async function syncCatalog() {
      if (!active || !settings.enabled || !settings.enabledAt || !ownerId) return;
      if (syncing) {
        syncRequested = true;
        return;
      }

      syncing = true;
      try {
        do {
          syncRequested = false;
          if (!active || !settings.enabled || !settings.enabledAt) break;
          const initialImport = await loadInitialCatalogImportState(ownerId);
          if (initialImport?.status === "running") {
            if (active) syncTimer = setTimeout(scheduleSync, 1000);
            break;
          }
          const result = await importCatalogProducts(ownerId, { createdSince: settings.enabledAt });
          if (result.skipped > 0) {
            console.warn(`Automatic product catalog sync skipped ${result.skipped} product(s) after individual import failures.`);
          }
        } while (active && syncRequested);
      } catch (syncError) {
        console.error("Automatic product catalog sync failed:", syncError);
      } finally {
        syncing = false;
      }
    }

    function scheduleSync() {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => void syncCatalog(), 350);
    }

    async function start() {
      try {
        ownerId = await resolveProductOwnerId();
        settings = await loadProductAutoSyncSettings(ownerId);
        if (!active) return undefined;

        const channel = supabase
          .channel(`web-product-catalog-auto-sync-${ownerId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "admin_medicine_catalog" },
            () => {
              if (settings.enabled) scheduleSync();
            },
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "pharmacy_app_data",
              filter: `owner_user_id=eq.${ownerId}`,
            },
            (event) => {
              const record = event.new as { data_key?: string; payload?: unknown } | null;
              if (record?.data_key !== PRODUCT_CATALOG_AUTO_SYNC_KEY) return;
              try {
                settings = parseProductAutoSyncSettings(record.payload);
                if (settings.enabled) scheduleSync();
              } catch (settingsError) {
                console.error("Could not read product auto-sync settings:", settingsError);
              }
            },
          )
          .subscribe((status, error) => {
            if (status === "SUBSCRIBED" && settings.enabled) scheduleSync();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.error("Automatic product catalog updates are unavailable:", error?.message ?? status);
            }
          });

        void startInitialCatalogImport(ownerId).then(async () => {
          if (!active) return;
          settings = await loadProductAutoSyncSettings(ownerId);
          if (settings.enabled) scheduleSync();
        }).catch((initialImportError: unknown) => {
          console.error("Could not start initial product catalog import:", initialImportError);
        });
        if (settings.enabled) scheduleSync();
        return channel;
      } catch (setupError) {
        if (active) console.error("Could not initialize automatic product catalog sync:", setupError);
        return undefined;
      }
    }

    let channel: Awaited<ReturnType<typeof start>> | undefined;
    void start().then((startedChannel) => {
      channel = startedChannel;
      if (!active && channel) void supabase.removeChannel(channel);
    });

    return () => {
      active = false;
      if (syncTimer) clearTimeout(syncTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
