"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  importCatalogProducts,
  loadProductAutoSyncSettings,
  parseProductAutoSyncSettings,
  PRODUCT_CATALOG_AUTO_SYNC_KEY,
  resolveProductOwnerId,
  type ProductAutoSyncSettings,
} from "./productCatalogSync";

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
          await importCatalogProducts(ownerId, { createdSince: settings.enabledAt });
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
