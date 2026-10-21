import { supabase } from '@/lib/supabase';

export const PRODUCT_CATALOG_AUTO_SYNC_KEY = 'pharmacy-product-auto-sync-v1';

type AutoSyncSettings = {
  enabled: boolean;
  enabledAt: string | null;
};

type CatalogProduct = {
  id: string;
  serial_number: string;
  pharmaceutical_company: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form_description: string;
  retail_price: string;
  pack_size?: string;
  unit_price?: string;
  pack_price?: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type PharmacyProduct = {
  owner_user_id: string;
  id: string;
  source_catalog_id: string;
  serial_number: string;
  medicine_name: string;
  brand: string;
  generic_name: string;
  manufacturer: string;
  product_type: string;
  category: string;
  dosage_form: string;
  strength: string;
  pack_size: string;
  unit: string;
  barcode: string;
  retail_price: string;
  unit_price: string;
  pack_price: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type ExistingProduct = {
  source_catalog_id: string | null;
  medicine_name: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
};

type Supabase = NonNullable<typeof supabase>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProductAutoSyncSettings(payload: unknown): AutoSyncSettings {
  if (!isRecord(payload) || typeof payload.enabled !== 'boolean') {
    throw new Error('Saved product auto-sync settings have an invalid format.');
  }
  if (payload.enabled && (typeof payload.enabledAt !== 'string' || !Number.isFinite(Date.parse(payload.enabledAt)))) {
    throw new Error('Saved product auto-sync start date is invalid.');
  }
  return {
    enabled: payload.enabled,
    enabledAt: payload.enabled && typeof payload.enabledAt === 'string' ? payload.enabledAt : null,
  };
}

export async function loadProductAutoSyncSettings(client: Supabase, ownerId: string) {
  const { data, error } = await client
    .from('pharmacy_app_data')
    .select('payload')
    .eq('owner_user_id', ownerId)
    .eq('data_key', PRODUCT_CATALOG_AUTO_SYNC_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.payload === null || data?.payload === undefined
    ? { enabled: false, enabledAt: null }
    : parseProductAutoSyncSettings(data.payload);
}

export async function saveProductAutoSyncSettings(
  client: Supabase,
  ownerId: string,
  enabled: boolean,
) {
  const existing = await client
    .from('pharmacy_app_data')
    .select('data_key')
    .eq('owner_user_id', ownerId)
    .eq('data_key', PRODUCT_CATALOG_AUTO_SYNC_KEY)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const payload: AutoSyncSettings = {
    enabled,
    enabledAt: enabled ? new Date().toISOString() : null,
  };
  const values = {
    owner_user_id: ownerId,
    data_key: PRODUCT_CATALOG_AUTO_SYNC_KEY,
    payload,
    updated_at: new Date().toISOString(),
  };
  const result = existing.data
    ? await client.from('pharmacy_app_data')
      .update({ payload, updated_at: values.updated_at })
      .eq('owner_user_id', ownerId)
      .eq('data_key', PRODUCT_CATALOG_AUTO_SYNC_KEY)
      .select('data_key')
      .maybeSingle()
    : await client.from('pharmacy_app_data')
      .insert(values)
      .select('data_key')
      .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Could not save the product auto-sync setting.');
  return payload;
}

function normalizeIdentityPart(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function getIdentityKey(product: Pick<ExistingProduct, 'medicine_name' | 'strength' | 'dosage_form' | 'manufacturer'>) {
  const parts = [
    product.medicine_name,
    product.strength,
    product.dosage_form,
    product.manufacturer,
  ].map(normalizeIdentityPart);
  return parts.every(Boolean) ? JSON.stringify(parts) : null;
}

function mapCatalogProduct(row: CatalogProduct, ownerId: string): PharmacyProduct {
  const brand = row.brand_name || '-';
  const genericName = row.generic_name || '-';
  return {
    owner_user_id: ownerId,
    id: `MED-${Date.now()}-${row.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`,
    source_catalog_id: row.id,
    serial_number: row.serial_number || '-',
    medicine_name: brand !== '-' ? brand : genericName,
    brand,
    generic_name: genericName,
    manufacturer: row.pharmaceutical_company || '-',
    product_type: row.usage_type || 'Medicine',
    category: row.medicine_type_category || '',
    dosage_form: row.dosage_form_description || '-',
    strength: row.strength || '-',
    pack_size: row.pack_size || '-',
    unit: '-',
    barcode: row.dar_code || '-',
    retail_price: row.unit_price ?? row.retail_price ?? '-',
    unit_price: row.unit_price ?? row.retail_price ?? '-',
    pack_price: row.pack_price || '-',
    usage_type: row.usage_type || 'Medicine',
    dar_code: row.dar_code || '-',
    medicine_type_category: row.medicine_type_category || '',
    registration_information: row.registration_information || '-',
  };
}

export async function importCatalogProductsAddedSince(
  client: Supabase,
  ownerId: string,
  enabledAt: string,
) {
  const rows: CatalogProduct[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('admin_medicine_catalog')
      .select('*')
      .gte('created_at', enabledAt)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CatalogProduct[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  if (rows.length === 0) return 0;

  const existing: ExistingProduct[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('pharmacy_catalog_products')
      .select('source_catalog_id, medicine_name, strength, dosage_form, manufacturer')
      .eq('owner_user_id', ownerId)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingProduct[];
    existing.push(...page);
    if (page.length < pageSize) break;
  }

  const importedIds = new Set(existing
    .map((product) => product.source_catalog_id)
    .filter((id): id is string => Boolean(id)));
  const importedKeys = new Set(existing
    .map(getIdentityKey)
    .filter((key): key is string => Boolean(key)));
  const productsToSave: PharmacyProduct[] = [];
  for (const row of rows) {
    if (importedIds.has(row.id)) continue;
    const product = mapCatalogProduct(row, ownerId);
    const identityKey = getIdentityKey(product);
    if (identityKey && importedKeys.has(identityKey)) continue;
    productsToSave.push(product);
    importedIds.add(row.id);
    if (identityKey) importedKeys.add(identityKey);
  }

  for (let offset = 0; offset < productsToSave.length; offset += 100) {
    const { error } = await client
      .from('pharmacy_catalog_products')
      .insert(productsToSave.slice(offset, offset + 100));
    if (error) throw error;
  }
  return productsToSave.length;
}

export type { AutoSyncSettings, Supabase };
