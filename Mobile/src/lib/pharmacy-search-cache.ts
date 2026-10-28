import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const CACHE_PREFIX = '@pharmacy-search-cache-v1:';
const PRODUCT_PAGE_SIZE = 1000;
const PRODUCT_SELECT = 'id, brand, medicine_name, generic_name, manufacturer, strength, dosage_form, pack_size, unit_price, pack_price';
const ALL_SEARCH_DATA_KEYS = [
  'pharmacy-purchase-list-v1',
  'pharmacy-place-order-list-v1',
  'pharmacy-sales-list-v1',
  'pharmacy-payment-methods-v1',
  'pharmacy-vat-tax-settings-v1',
  'pharmacy-return-records-v1',
  'pharmacy-return-deduction-settings-v1',
];
const memoryCache = new Map<string, unknown>();
const activePrefetches = new Map<string, Promise<void>>();
const activeCatalogLoads = new Map<string, Promise<Record<string, unknown>[]>>();
const activePayloadLoads = new Map<string, Promise<Map<string, unknown>>>();

function getStorageKey(ownerId: string, cacheName: string) {
  return `${CACHE_PREFIX}${encodeURIComponent(ownerId)}:${cacheName}`;
}

export function getCachedPharmacySearchData<T>(ownerId: string, cacheName: string) {
  const key = getStorageKey(ownerId, cacheName);
  return memoryCache.has(key) ? memoryCache.get(key) as T : undefined;
}

export async function readCachedPharmacySearchData<T>(ownerId: string, cacheName: string) {
  const key = getStorageKey(ownerId, cacheName);
  if (memoryCache.has(key)) return memoryCache.get(key) as T;

  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return undefined;
    const entry: unknown = JSON.parse(stored);
    if (
      !entry
      || typeof entry !== 'object'
      || !('payload' in entry)
      || !('version' in entry)
      || entry.version !== 1
    ) {
      throw new Error('Cached search data has an invalid format.');
    }
    memoryCache.set(key, entry.payload);
    return entry.payload as T;
  } catch (error) {
    console.warn(`Could not read cached search data (${cacheName}).`, error);
    return undefined;
  }
}

export async function cachePharmacySearchData(ownerId: string, cacheName: string, payload: unknown) {
  const key = getStorageKey(ownerId, cacheName);
  memoryCache.set(key, payload);
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ version: 1, payload }));
  } catch (error) {
    console.warn(`Could not save cached search data (${cacheName}).`, error);
  }
}

export async function clearCachedPharmacySearchData(ownerId: string, cacheName: string) {
  const key = getStorageKey(ownerId, cacheName);
  memoryCache.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`Could not clear cached search data (${cacheName}).`, error);
  }
}

export function loadPharmacySearchPayloads(ownerId: string, dataKeys: readonly string[]) {
  const loadKey = `${ownerId}:${[...dataKeys].sort().join(',')}`;
  const activeLoad = activePayloadLoads.get(loadKey);
  if (activeLoad) return activeLoad;
  if (!supabase) return Promise.reject(new Error('Pharmacy search data is unavailable. Check your account connection.'));

  const client = supabase;
  const load = (async () => {
    const { data, error } = await client
      .from('pharmacy_app_data')
      .select('data_key, payload')
      .eq('owner_user_id', ownerId)
      .in('data_key', [...dataKeys]);
    if (error) throw error;
    return new Map((data ?? []).map((row) => [row.data_key, row.payload]));
  })().finally(() => {
    activePayloadLoads.delete(loadKey);
  });
  activePayloadLoads.set(loadKey, load);
  return load;
}

export function loadPharmacyProductCatalog(ownerId: string) {
  const activeLoad = activeCatalogLoads.get(ownerId);
  if (activeLoad) return activeLoad;
  if (!supabase) return Promise.reject(new Error('Product catalog is unavailable. Check your account connection.'));

  const client = supabase;
  const load = (async () => {
    const products: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PRODUCT_PAGE_SIZE) {
      const { data, error } = await client
        .from('pharmacy_catalog_products')
        .select(PRODUCT_SELECT)
        .eq('owner_user_id', ownerId)
        .order('id', { ascending: true })
        .range(offset, offset + PRODUCT_PAGE_SIZE - 1);
      if (error) throw error;
      const page = data ?? [];
      products.push(...page);
      if (page.length < PRODUCT_PAGE_SIZE) break;
    }
    await cachePharmacySearchData(ownerId, 'purchase-product-catalog', { products });
    return products;
  })().finally(() => {
    activeCatalogLoads.delete(ownerId);
  });
  activeCatalogLoads.set(ownerId, load);
  return load;
}

export function prefetchPharmacySearchData(ownerId: string) {
  const activePrefetch = activePrefetches.get(ownerId);
  if (activePrefetch) return activePrefetch;
  if (
    getCachedPharmacySearchData(ownerId, 'new-sale-search') !== undefined
    && getCachedPharmacySearchData(ownerId, 'purchase-search-data') !== undefined
    && getCachedPharmacySearchData(ownerId, 'return-search-data') !== undefined
    && getCachedPharmacySearchData(ownerId, 'purchase-product-catalog') !== undefined
  ) return Promise.resolve();
  if (!supabase) return Promise.resolve();

  const prefetch = Promise.all([
    (async () => {
      const payloads = await loadPharmacySearchPayloads(ownerId, ALL_SEARCH_DATA_KEYS);
      const inventory = payloads.get('pharmacy-purchase-list-v1') ?? [];
      const sales = payloads.get('pharmacy-sales-list-v1') ?? [];
      const purchase = {
        purchaseRows: inventory,
        placeRows: payloads.get('pharmacy-place-order-list-v1') ?? [],
        paymentMethods: payloads.get('pharmacy-payment-methods-v1'),
      };
      await Promise.all([
        cachePharmacySearchData(ownerId, 'new-sale-search', {
          inventory,
          sales,
          paymentMethods: purchase.paymentMethods,
          vat: payloads.get('pharmacy-vat-tax-settings-v1'),
        }),
        cachePharmacySearchData(ownerId, 'purchase-search-data', purchase),
        cachePharmacySearchData(ownerId, 'return-search-data', {
          sales,
          returns: payloads.get('pharmacy-return-records-v1') ?? [],
          purchaseRows: inventory,
          deductionSettings: payloads.get('pharmacy-return-deduction-settings-v1'),
        }),
      ]);
    })().catch((error: unknown) => {
      console.error('Could not prefetch pharmacy search data.', error);
    }),
    loadPharmacyProductCatalog(ownerId).catch((error: unknown) => {
      console.error('Could not prefetch the Purchase product catalog.', error);
    }),
  ]).then(() => undefined).finally(() => {
    activePrefetches.delete(ownerId);
  });
  activePrefetches.set(ownerId, prefetch);
  return prefetch;
}
