import { supabase } from "@/lib/supabase/client";

export const PRODUCT_CATALOG_AUTO_SYNC_KEY = "pharmacy-product-auto-sync-v1";
export const PRODUCT_CATALOG_INITIAL_IMPORT_KEY = "pharmacy-product-catalog-initial-import-v1";

export type InitialCatalogImportState = {
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  imported: number;
  duplicates: number;
  skipped: number;
  cursor: string | null;
  startedAt: string;
  updatedAt: string;
  error?: string;
};

export type CatalogImportProgress = {
  processed: number;
  imported: number;
  duplicates: number;
  skipped: number;
  cursor: string | null;
};

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

export async function loadInitialCatalogImportState(ownerId: string): Promise<InitialCatalogImportState | null> {
  const { data, error } = await supabase
    .from("pharmacy_app_data")
    .select("payload")
    .eq("owner_user_id", ownerId)
    .eq("data_key", PRODUCT_CATALOG_INITIAL_IMPORT_KEY)
    .maybeSingle();
  if (error) throw error;
  if (data?.payload === null || data?.payload === undefined) return null;
  const payload = data.payload as Partial<InitialCatalogImportState>;
  if (
    (payload.status !== "running" && payload.status !== "completed" && payload.status !== "failed")
    || !Number.isFinite(payload.total)
    || !Number.isFinite(payload.processed)
    || !Number.isFinite(payload.imported)
    || !Number.isFinite(payload.duplicates)
    || !Number.isFinite(payload.skipped)
    || typeof payload.startedAt !== "string"
  ) {
    throw new Error("Saved initial product catalog import progress has an invalid format.");
  }
  return {
    status: payload.status,
    total: payload.total as number,
    processed: payload.processed as number,
    imported: payload.imported as number,
    duplicates: payload.duplicates as number,
    skipped: payload.skipped as number,
    cursor: typeof payload.cursor === "string" ? payload.cursor : null,
    startedAt: payload.startedAt,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : payload.startedAt,
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
  };
}

export async function saveInitialCatalogImportState(ownerId: string, state: InitialCatalogImportState) {
  const { error } = await supabase
    .from("pharmacy_app_data")
    .upsert({
      owner_user_id: ownerId,
      data_key: PRODUCT_CATALOG_INITIAL_IMPORT_KEY,
      payload: state,
      updated_at: state.updatedAt,
    }, { onConflict: "owner_user_id,data_key" });
  if (error) throw error;
}

function normalizeIdentityPart(value: string | null | undefined) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}]+/gu, "")
    : "";
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
  options: {
    company?: string;
    createdSince?: string;
    afterId?: string | null;
    pageSize?: number;
    onProgress?: (progress: CatalogImportProgress) => Promise<void>;
  } = {},
) {
  const existingProducts: ExistingProduct[] = [];
  const existingPageSize = 1000;
  for (let offset = 0; ; offset += existingPageSize) {
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .select("source_catalog_id, medicine_name, strength, dosage_form, manufacturer")
      .eq("owner_user_id", ownerId)
      .order("id", { ascending: true })
      .range(offset, offset + existingPageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingProduct[];
    existingProducts.push(...page);
    if (page.length < existingPageSize) break;
  }

  const importedIds = new Set(existingProducts
    .map((product) => product.source_catalog_id)
    .filter((id): id is string => Boolean(id)));
  const importedKeys = new Set(existingProducts
    .map(getIdentityKey)
    .filter((key): key is string => Boolean(key)));
  let processed = 0;
  let added = 0;
  let duplicates = 0;
  let skipped = 0;
  let cursor = options.afterId ?? null;
  const catalogPageSize = Math.max(1, options.pageSize ?? 500);

  while (true) {
    let query = supabase.from("admin_medicine_catalog").select("*");
    if (options.company) query = query.eq("pharmaceutical_company", options.company);
    if (options.createdSince) query = query.gte("created_at", options.createdSince);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(catalogPageSize);
    if (error) throw error;
    const page = (data ?? []) as CatalogProduct[];
    if (page.length === 0) break;

    const productsToSave: PharmacyProduct[] = [];
    for (const row of page) {
      processed += 1;
      cursor = row.id;
      try {
        if (importedIds.has(row.id)) {
          duplicates += 1;
          continue;
        }
        const product = mapCatalogProduct(row, ownerId);
        const identity = getIdentityKey(product);
        if (identity && importedKeys.has(identity)) {
          duplicates += 1;
          continue;
        }
        productsToSave.push(product);
        importedIds.add(row.id);
        if (identity) importedKeys.add(identity);
      } catch (productError) {
        skipped += 1;
        console.warn(`Skipping shared catalog product ${row.id}:`, productError);
      }
    }

    for (let offset = 0; offset < productsToSave.length; offset += 100) {
      const batch = productsToSave.slice(offset, offset + 100);
      try {
        const { data: saved, error: saveError } = await supabase
          .from("pharmacy_catalog_products")
          .upsert(batch, {
            onConflict: "owner_user_id,source_catalog_id",
            ignoreDuplicates: true,
          })
          .select("id");
        if (saveError) throw saveError;
        added += saved?.length ?? 0;
        continue;
      } catch (batchError) {
        console.warn("Could not import a product batch; retrying its products individually:", batchError);
      }

      for (const product of batch) {
        try {
          const singleResult = await supabase
            .from("pharmacy_catalog_products")
            .upsert(product, {
              onConflict: "owner_user_id,source_catalog_id",
              ignoreDuplicates: true,
            })
            .select("id")
            .maybeSingle();
          if (singleResult.error) throw singleResult.error;
          if (singleResult.data) added += 1;
        } catch (productError) {
          skipped += 1;
          console.warn(`Skipping shared catalog product ${product.source_catalog_id}:`, productError);
        }
      }
    }

    duplicates = processed - added - skipped;
    if (options.onProgress && cursor) {
      await options.onProgress({ processed, imported: added, duplicates, skipped, cursor });
    }
    if (page.length < catalogPageSize) break;
  }

  return {
    added,
    duplicates,
    available: processed,
    skipped,
    cursor,
  };
}
