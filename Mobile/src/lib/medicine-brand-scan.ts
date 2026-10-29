import AsyncStorage from '@react-native-async-storage/async-storage';

const SCAN_CACHE_PREFIX = '@pharmacy-brand-scan-v1:';
const MAX_SCAN_CACHE_ENTRIES = 300;

type ScanCache = {
  entries: Map<string, string[]>;
  loaded: boolean;
  loading?: Promise<void>;
};

const scanCaches = new Map<string, ScanCache>();
const cacheWrites = new Map<string, Promise<void>>();

export function getBrandWords(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{M}]+/gu) ?? [];
}

export function normalizeBrandName(value: string) {
  return getBrandWords(value).join(' ');
}

export function buildBrandWordIndex<T>(
  items: readonly T[],
  getBrand: (item: T) => string,
) {
  const index = new Map<string, T[]>();
  for (const item of items) {
    for (const word of new Set(getBrandWords(getBrand(item)))) {
      const matches = index.get(word);
      if (matches) matches.push(item);
      else index.set(word, [item]);
    }
  }
  return index;
}

export function buildBrandNameIndex<T>(
  items: readonly T[],
  getBrand: (item: T) => string,
) {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const brand = normalizeBrandName(getBrand(item));
    if (!brand) continue;
    const matches = index.get(brand);
    if (matches) matches.push(item);
    else index.set(brand, [item]);
  }
  return index;
}

export function getBrandNameMatches<T>(
  index: ReadonlyMap<string, readonly T[]>,
  brands: readonly string[],
) {
  const matches = new Set<T>();
  for (const brand of brands) {
    for (const item of index.get(normalizeBrandName(brand)) ?? []) matches.add(item);
  }
  return [...matches];
}

export function findBrandWordMatches<T>(
  index: ReadonlyMap<string, readonly T[]>,
  scannedText: string,
) {
  const scores = new Map<T, number>();
  for (const word of new Set(getBrandWords(scannedText))) {
    for (const item of index.get(word) ?? []) {
      scores.set(item, (scores.get(item) ?? 0) + 1);
    }
  }
  return [...scores]
    .map(([item, score]) => ({ item, score }))
    .sort((left, right) => right.score - left.score);
}

function getScanCacheKey(ownerId: string, workflow: string) {
  return `${SCAN_CACHE_PREFIX}${encodeURIComponent(ownerId)}:${workflow}`;
}

function getScanCache(ownerId: string, workflow: string): ScanCache {
  const key = getScanCacheKey(ownerId, workflow);
  let cache = scanCaches.get(key);
  if (!cache) {
    cache = { entries: new Map(), loaded: false };
    scanCaches.set(key, cache);
  }
  return cache;
}

export async function loadBrandScanCache(ownerId: string, workflow: string) {
  const key = getScanCacheKey(ownerId, workflow);
  const cache = getScanCache(ownerId, workflow);
  if (cache.loaded) return;
  if (cache.loading) return cache.loading;

  cache.loading = (async () => {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored === null) return;
      const parsed: unknown = JSON.parse(stored);
      if (
        !parsed
        || typeof parsed !== 'object'
        || !('version' in parsed)
        || parsed.version !== 1
        || !('entries' in parsed)
        || !Array.isArray(parsed.entries)
      ) {
        throw new Error('Saved brand scan cache has an invalid format.');
      }
      for (const entry of parsed.entries) {
        if (
          Array.isArray(entry)
          && typeof entry[0] === 'string'
          && Array.isArray(entry[1])
          && entry[1].every((brand): brand is string => typeof brand === 'string')
        ) {
          cache.entries.set(entry[0], entry[1]);
        }
      }
      while (cache.entries.size > MAX_SCAN_CACHE_ENTRIES) {
        const oldestKey = cache.entries.keys().next().value;
        if (oldestKey === undefined) break;
        cache.entries.delete(oldestKey);
      }
    } catch (error) {
      console.warn(`Could not load brand scan cache (${workflow}).`, error);
    } finally {
      cache.loaded = true;
      cache.loading = undefined;
    }
  })();
  return cache.loading;
}

export function getCachedBrandScanResult(ownerId: string, workflow: string, scannedText: string) {
  const cache = getScanCache(ownerId, workflow);
  const query = normalizeBrandName(scannedText);
  if (!cache.loaded || !query) return undefined;
  const result = cache.entries.get(query);
  if (!result) return undefined;
  cache.entries.delete(query);
  cache.entries.set(query, result);
  return result;
}

export async function saveBrandScanResult(
  ownerId: string,
  workflow: string,
  scannedText: string,
  brands: string[],
) {
  const query = normalizeBrandName(scannedText);
  const normalizedBrands = [...new Set(brands.map(normalizeBrandName).filter(Boolean))];
  if (!query || normalizedBrands.length === 0) return;

  await loadBrandScanCache(ownerId, workflow);
  const key = getScanCacheKey(ownerId, workflow);
  const cache = getScanCache(ownerId, workflow);
  cache.entries.delete(query);
  cache.entries.set(query, normalizedBrands);
  while (cache.entries.size > MAX_SCAN_CACHE_ENTRIES) {
    const oldestKey = cache.entries.keys().next().value;
    if (oldestKey === undefined) break;
    cache.entries.delete(oldestKey);
  }

  const previousWrite = cacheWrites.get(key) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch((error: unknown) => {
      console.warn(`Previous brand scan cache write failed (${workflow}).`, error);
    })
    .then(() => AsyncStorage.setItem(key, JSON.stringify({
      version: 1,
      entries: [...cache.entries],
    })))
    .catch((error: unknown) => {
      console.warn(`Could not save brand scan cache (${workflow}).`, error);
    });
  cacheWrites.set(key, nextWrite);
  await nextWrite;
}
