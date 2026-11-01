import { supabase } from "@/lib/supabase/client";

export const PRODUCT_CATALOG_AUTO_SYNC_KEY = "pharmacy-product-auto-sync-v1";

export type ProductAutoSyncSettings = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProductAutoSyncSettings(payload: unknown): ProductAutoSyncSettings {
  if (!isRecord(payload) || typeof payload.enabled !== "boolean") {
    throw new Error("Saved product auto-sync settings have an invalid format.");
  }
  if (payload.enabled && (typeof payload.enabledAt !== "string" || !Number.isFinite(Date.parse(payload.enabledAt)))) {
    throw new Error("Saved product auto-sync start date is invalid.");
  }
  return {
    enabled: payload.enabled,
    enabledAt: payload.enabled && typeof payload.enabledAt === "string" ? payload.enabledAt : null,
  };
}

export async function resolveProductOwnerId() {
  const { data, error } = await supabase.rpc("get_my_pharmacy_dashboard_context");
  if (error) throw error;
  const context = (data ?? [])[0] as { owner_user_id?: string } | undefined;
  if (!context?.owner_user_id) {
    throw new Error("Could not resolve the pharmacy account for product management.");
  }
  return context.owner_user_id;
}

export async function loadProductAutoSyncSettings(ownerId: string) {
  const { data, error } = await supabase
    .from("pharmacy_app_data")
    .select("payload")
    .eq("owner_user_id", ownerId)
    .eq("data_key", PRODUCT_CATALOG_AUTO_SYNC_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.payload === null || data?.payload === undefined
    ? { enabled: false, enabledAt: null }
    : parseProductAutoSyncSettings(data.payload);
}

export async function saveProductAutoSyncSettings(ownerId: string, enabled: boolean) {
  const existing = await supabase
    .from("pharmacy_app_data")
    .select("data_key")
    .eq("owner_user_id", ownerId)
    .eq("data_key", PRODUCT_CATALOG_AUTO_SYNC_KEY)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const payload: ProductAutoSyncSettings = {
    enabled,
    enabledAt: enabled ? new Date().toISOString() : null,
  };
  const updatedAt = new Date().toISOString();
  const result = existing.data
    ? await supabase
      .from("pharmacy_app_data")
      .update({ payload, updated_at: updatedAt })
      .eq("owner_user_id", ownerId)
      .eq("data_key", PRODUCT_CATALOG_AUTO_SYNC_KEY)
      .select("data_key")
      .maybeSingle()
    : await supabase
      .from("pharmacy_app_data")
      .insert({
        owner_user_id: ownerId,
        data_key: PRODUCT_CATALOG_AUTO_SYNC_KEY,
        payload,
        updated_at: updatedAt,
      })
      .select("data_key")
      .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("Could not save the product auto-sync setting.");
  return payload;
}

function normalizeIdentityPart(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function getIdentityKey(product: Pick<ExistingProduct, "medicine_name" | "strength" | "dosage_form" | "manufacturer">) {
  const parts = [
    product.medicine_name,
    product.strength,
    product.dosage_form,
    product.manufacturer,
  ].map(normalizeIdentityPart);
  return parts.every(Boolean) ? JSON.stringify(parts) : null;
}

function mapCatalogProduct(row: CatalogProduct, ownerId: string): PharmacyProduct {
  const brand = row.brand_name || "-";
  const genericName = row.generic_name || "-";
  const sourceSuffix = row.id.replace(/[^a-zA-Z0-9]/g, "").slice(-12) || crypto.randomUUID();
  const price = row.unit_price ?? row.retail_price ?? "-";
  return {
    owner_user_id: ownerId,
    id: `MED-${Date.now()}-${sourceSuffix}`,
    source_catalog_id: row.id,
    serial_number: row.serial_number || "-",
    medicine_name: brand !== "-" ? brand : genericName,
    brand,
    generic_name: genericName,
    manufacturer: row.pharmaceutical_company || "-",
    product_type: row.usage_type || "Medicine",
    category: row.medicine_type_category || "",
    dosage_form: row.dosage_form_description || "-",
    strength: row.strength || "-",
    pack_size: row.pack_size || "-",
    unit: "-",
    barcode: row.dar_code || "-",
    retail_price: price,
    unit_price: price,
    pack_price: row.pack_price || "-",
    usage_type: row.usage_type || "Medicine",
    dar_code: row.dar_code || "-",
    medicine_type_category: row.medicine_type_category || "",
    registration_information: row.registration_information || "-",
  };
}

export async function importCatalogProducts(
  ownerId: string,
  options: { company?: string; createdSince?: string } = {},
) {
  const catalogRows: CatalogProduct[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("admin_medicine_catalog").select("*");
    if (options.company) query = query.eq("pharmaceutical_company", options.company);
    if (options.createdSince) query = query.gte("created_at", options.createdSince);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CatalogProduct[];
    catalogRows.push(...page);
    if (page.length < pageSize) break;
  }

  const existingProducts: ExistingProduct[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .select("source_catalog_id, medicine_name, strength, dosage_form, manufacturer")
      .eq("owner_user_id", ownerId)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingProduct[];
    existingProducts.push(...page);
    if (page.length < pageSize) break;
  }

  const importedIds = new Set(existingProducts
    .map((product) => product.source_catalog_id)
    .filter((id): id is string => Boolean(id)));
  const importedKeys = new Set(existingProducts
    .map(getIdentityKey)
    .filter((key): key is string => Boolean(key)));
  const productsToSave: PharmacyProduct[] = [];
  let duplicateCount = 0;
  for (const row of catalogRows) {
    if (importedIds.has(row.id)) {
      duplicateCount += 1;
      continue;
    }
    const product = mapCatalogProduct(row, ownerId);
    const identity = getIdentityKey(product);
    if (identity && importedKeys.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    productsToSave.push(product);
    importedIds.add(row.id);
    if (identity) importedKeys.add(identity);
  }

  let added = 0;
  for (let offset = 0; offset < productsToSave.length; offset += 100) {
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .upsert(productsToSave.slice(offset, offset + 100), {
        onConflict: "owner_user_id,source_catalog_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw error;
    added += data?.length ?? 0;
  }

  return {
    added,
    duplicates: duplicateCount + productsToSave.length - added,
    available: catalogRows.length,
  };
}
