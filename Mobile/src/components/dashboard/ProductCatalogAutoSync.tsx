import { importCatalogProductsAddedSince, loadProductAutoSyncSettings, parseProductAutoSyncSettings, PRODUCT_CATALOG_AUTO_SYNC_KEY, type AutoSyncSettings } from '@/lib/product-catalog-auto-sync';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useEffect } from 'react';

export function useProductCatalogAutoSync() {
  const {
    approvalStatus,
    dashboardRole,
    isLoading,
    profileLoading,
    session,
  } = useAuth();

  useEffect(() => {
    if (isLoading || profileLoading || approvalStatus !== 'approved'
      || !session || !dashboardRole || !supabase) return;
    const client = supabase;
    const sessionUserId = session.user.id;
    let active = true;
    let ownerId = session.user.id;
    let settings: AutoSyncSettings = { enabled: false, enabledAt: null };
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
          await importCatalogProductsAddedSince(client, ownerId, settings.enabledAt);
        } while (active && syncRequested);
      } catch (syncError) {
        console.error('Automatic product catalog sync failed:', syncError);
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
        if (dashboardRole === 'staff') {
          const { data, error } = await client.rpc('get_my_pharmacy_dashboard_context');
          if (error) throw error;
          const context = (data ?? [])[0] as { owner_user_id?: string } | undefined;
          if (!context?.owner_user_id) throw new Error('Could not resolve the pharmacy for automatic product sync.');
          ownerId = context.owner_user_id;
        }

        settings = await loadProductAutoSyncSettings(client, ownerId);
        if (!active) return;

        const channel = client
          .channel(`product-catalog-auto-sync-${sessionUserId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'admin_medicine_catalog' },
            () => {
              if (settings.enabled) scheduleSync();
            },
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'pharmacy_app_data',
              filter: `owner_user_id=eq.${ownerId}`,
            },
            (event) => {
              const record = event.new as { data_key?: string; payload?: unknown } | null;
              if (record?.data_key !== PRODUCT_CATALOG_AUTO_SYNC_KEY) return;
              try {
                settings = parseProductAutoSyncSettings(record.payload);
                if (settings.enabled) scheduleSync();
              } catch (settingsError) {
                console.error('Could not read product auto-sync settings:', settingsError);
              }
            },
          )
          .subscribe((status, error) => {
            if (status === 'SUBSCRIBED' && settings.enabled) scheduleSync();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('Automatic product catalog updates are unavailable:', error?.message ?? status);
            }
          });

        if (settings.enabled) scheduleSync();
        return channel;
      } catch (setupError) {
        if (active) console.error('Could not initialize automatic product catalog sync:', setupError);
        return undefined;
      }
    }

    let channel: Awaited<ReturnType<typeof start>> | undefined;
    void start().then((startedChannel) => {
      channel = startedChannel;
      if (!active && channel) void client.removeChannel(channel);
    });

    return () => {
      active = false;
      if (syncTimer) clearTimeout(syncTimer);
      if (channel) void client.removeChannel(channel);
    };
  }, [approvalStatus, dashboardRole, isLoading, profileLoading, session]);

}
