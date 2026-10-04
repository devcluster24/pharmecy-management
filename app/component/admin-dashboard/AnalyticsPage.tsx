"use client";

import React, { useEffect, useMemo, useState } from "react";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";

type ProductFields = {
  serialNumber: string;
  pharmaceuticalCompany: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageFormDescription: string;
  retailPrice: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
  usageType: string;
  darCode: string;
  medicineTypeCategory: string;
  registrationInformation: string;
};

type Product = ProductFields & {
  id: string;
};

const PRODUCT_STORAGE_KEY = "medicine-products";
const CATALOG_PAGE_SIZE = 1000;
const editableProductFields: { key: keyof ProductFields; label: string }[] = [
  { key: "serialNumber", label: "SL / Serial Number" },
  { key: "pharmaceuticalCompany", label: "Pharmaceutical Company" },
  { key: "brandName", label: "Brand Name" },
  { key: "genericName", label: "Generic Name" },
  { key: "strength", label: "Strength" },
  { key: "dosageFormDescription", label: "Dosage Form / Description" },
  { key: "packSize", label: "Pack Size" },
  { key: "unitPrice", label: "Unit Price" },
  { key: "packPrice", label: "Pack Price" },
  { key: "usageType", label: "Usage Type" },
  { key: "darCode", label: "DAR Code" },
  { key: "medicineTypeCategory", label: "Medicine Type/Category" },
  { key: "registrationInformation", label: "Registration Information" },
];

const productColumnAliases: Record<keyof ProductFields, string[]> = {
  serialNumber: [
    "sl",
    "sl no",
    "sl serial number",
    "serial",
    "serial no",
    "serial number",
    "sl number",
  ],

  pharmaceuticalCompany: [
    "pharmaceutical company",
    "pharma company",
    "pharmaceutical co",
    "name of the pharmaceutical",
    "name of pharmaceutical",
    "manufacturer",
    "company",
    "company name",
  ],

  brandName: [
    "brand name",
    "brand",
    "trade name",
    "trademark",
    "medicine name",
    "product name",
  ],

  genericName: [
    "generic name and strength",
    "generic name",
    "generic",
    "genericname",
  ],

  strength: [
    "strength",
    "dosage strength",
    "medicine strength",
    "dose",
  ],

  dosageFormDescription: [
    "dosage form description",
    "dosage form",
    "dosageform",
    "form description",
    "dosages",
    "dosage",
    "description",
    "form",
  ],

  retailPrice: [
    "retail price",
    "mrp",
    "maximum retail price",
    "price",
    "unit price",
  ],

  packSize: [
    "pack size",
    "pack",
    "package size",
    "pack quantity",
  ],

  unitPrice: [
    "unit price",
    "retail price",
    "mrp",
    "price",
  ],

  packPrice: [
    "pack price",
    "package price",
    "strip price",
  ],

  usageType: [
    "usage type",
    "usage type human animal",
    "human animal",
    "human/animal",
    "use type",
    "usage",
  ],

  darCode: [
    "dar code",
    "dar",
    "registration code",
  ],

  medicineTypeCategory: [
    "medicine type category",
    "medicine type",
    "type/category",
    "category",
    "therapeutic category",
    "type",
  ],

  registrationInformation: [
    "registration information",
    "registration info",
    "registration number",
    "registration no",
    "registration",
    "reg info",
  ],
};

/* =========================================================
   Helpers
========================================================= */

function normalizeProductValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toProductText(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const text = String(value).trim();

  return text || "-";
}

function splitGenericAndStrength(value: string) {
  const text = value.trim();

  if (!text) {
    return {
      genericName: "-",
      strength: "-",
    };
  }

  /*
   * Examples:
   * Paracetamol 500 mg
   * Amoxicillin 500 mg
   * Omeprazole 20 mg
   */

  const match = text.match(
    /^(.+?)\s+((?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|l|iu|%|mg\/ml|mcg\/ml)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|l))?))$/i
  );

  if (!match) {
    return {
      genericName: text,
      strength: "-",
    };
  }

  return {
    genericName: match[1].trim(),
    strength: match[2].trim(),
  };
}

/* =========================================================
   Product ID
========================================================= */

function createProductId(products: Product[]) {
  const highestId = products.reduce((highest, product) => {
    const match = /^MED-(\d+)$/i.exec(product.id);

    if (!match) {
      return highest;
    }

    return Math.max(highest, Number(match[1]));
  }, 0);

  return `MED-${String(highestId + 1).padStart(4, "0")}`;
}

/* =========================================================
   Duplicate
========================================================= */

function getProductIdentityKey(product: ProductFields) {
  const values = [
    product.brandName !== "-"
      ? product.brandName
      : product.genericName,

    product.strength,
    product.dosageFormDescription,
    product.pharmaceuticalCompany,
  ].map(normalizeProductValue);

  return JSON.stringify(values);
}

function isDuplicateProduct(
  product: ProductFields,
  existingProducts: Product[]
) {
  const newKey = getProductIdentityKey(product);

  return existingProducts.some(
    (existingProduct) =>
      getProductIdentityKey(existingProduct) === newKey
  );
}

/* =========================================================
   Local Storage
========================================================= */

function loadProductsFromLocalStorage(): Product[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(PRODUCT_STORAGE_KEY);

    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function insertProductIntoCatalog(
  product: Product,
  createdBy: string
): Promise<Product> {
  const { data, error } = await supabase
    .from("admin_medicine_catalog")
    .insert({ ...mapProductToCatalogRow(product), created_by: createdBy })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapCatalogRowToProduct(data);
}

function mapProductToCatalogRow(product: Product) {
  const unitPrice = product.unitPrice === "-" ? product.retailPrice : product.unitPrice;
  return {
    id: product.id,
    serial_number: product.serialNumber,
    pharmaceutical_company: product.pharmaceuticalCompany,
    brand_name: product.brandName,
    generic_name: product.genericName,
    strength: product.strength,
    dosage_form_description: product.dosageFormDescription,
    retail_price: unitPrice,
    pack_size: product.packSize,
    unit_price: unitPrice,
    pack_price: product.packPrice,
    usage_type: product.usageType,
    dar_code: product.darCode,
    medicine_type_category: product.medicineTypeCategory,
    registration_information: product.registrationInformation,
  };
}

function mapCatalogRowToProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    serialNumber: String(row.serial_number ?? "-"),
    pharmaceuticalCompany: String(row.pharmaceutical_company ?? "-"),
    brandName: String(row.brand_name ?? "-"),
    genericName: String(row.generic_name ?? "-"),
    strength: String(row.strength ?? "-"),
    dosageFormDescription: String(row.dosage_form_description ?? "-"),
    retailPrice: String(row.retail_price ?? "-"),
    packSize: String(row.pack_size ?? "-"),
    unitPrice: String(row.unit_price ?? row.retail_price ?? "-"),
    packPrice: String(row.pack_price ?? "-"),
    usageType: String(row.usage_type ?? "-"),
    darCode: String(row.dar_code ?? "-"),
    medicineTypeCategory: String(row.medicine_type_category ?? "-"),
    registrationInformation: String(row.registration_information ?? "-"),
  };
}

/* =========================================================
   Source Row -> Product
========================================================= */

function createProductFromSourceRow(
  row: Record<string, unknown>,
  index: number
): (ProductFields & { id: string }) | null {
  const normalizedRow: Record<string, unknown> = {};

  Object.entries(row).forEach(([key, value]) => {
    normalizedRow[normalizeProductValue(key)] = value;
  });

  function findValue(field: keyof ProductFields) {
    const aliases = productColumnAliases[field];

    for (const alias of aliases) {
      const normalizedAlias =
        normalizeProductValue(alias);

      const exactKey = Object.keys(normalizedRow).find(
        (key) => key === normalizedAlias
      );

      if (exactKey) {
        return normalizedRow[exactKey];
      }

      const startsWithKey = Object.keys(normalizedRow).find(
        (key) =>
          key.startsWith(normalizedAlias) ||
          normalizedAlias.startsWith(key)
      );

      if (startsWithKey) {
        return normalizedRow[startsWithKey];
      }
    }

    return undefined;
  }

  const genericAndStrengthRaw =
    findValue("genericName") ??
    normalizedRow["generic name and strength"];

  let genericName = toProductText(
    findValue("genericName")
  );

  let strength = toProductText(
    findValue("strength")
  );

  /*
   * Generic Name and Strength একসাথে থাকলে
   * আলাদা করার চেষ্টা করবে।
   */
  if (
    genericAndStrengthRaw !== undefined &&
    genericAndStrengthRaw !== null
  ) {
    const parsed = splitGenericAndStrength(
      String(genericAndStrengthRaw)
    );

    if (genericName === "-") {
      genericName = parsed.genericName;
    }

    if (strength === "-") {
      strength = parsed.strength;
    }
  }

  const brandName = toProductText(
    findValue("brandName")
  );
  const importedId = toProductText(
    normalizedRow["id number"] ??
      normalizedRow["id"] ??
      normalizedRow["product id"] ??
      normalizedRow["id no"]
  );

  /*
   * Brand Name এবং Generic Name দুটোই না থাকলে
   * row বাদ যাবে।
   */
  if (
    brandName === "-" &&
    genericName === "-"
  ) {
    return null;
  }

  return {
    id: importedId === "-" ? "" : importedId,
    serialNumber: toProductText(
      findValue("serialNumber") ?? index + 1
    ),

    pharmaceuticalCompany: toProductText(
      findValue("pharmaceuticalCompany")
    ),

    brandName,

    genericName,

    strength,

    dosageFormDescription: toProductText(
      findValue("dosageFormDescription")
    ),

    retailPrice: toProductText(
      findValue("unitPrice") ?? findValue("retailPrice")
    ),

    packSize: toProductText(findValue("packSize")),
    unitPrice: toProductText(findValue("unitPrice") ?? findValue("retailPrice")),
    packPrice: toProductText(findValue("packPrice")),

    usageType: toProductText(
      findValue("usageType")
    ),

    darCode: toProductText(
      findValue("darCode")
    ),

    medicineTypeCategory: toProductText(
      findValue("medicineTypeCategory")
    ),

    registrationInformation: toProductText(
      findValue("registrationInformation")
    ),
  };
}

/* =========================================================
   CSV Parser
   No external package required
========================================================= */

function parseCSV(text: string): Record<string, unknown>[] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];

  let currentRow: string[] = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentValue += '"';
      i++;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (
      (char === "\n" || char === "\r") &&
      !insideQuotes
    ) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }

      currentRow.push(currentValue);
      currentValue = "";

      if (
        currentRow.some(
          (value) => value.trim() !== ""
        )
      ) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);

    if (
      currentRow.some(
        (value) => value.trim() !== ""
      )
    ) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];

  return rows.slice(1).map((row) => {
    const object: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      object[header.trim()] =
        row[index]?.trim() ?? "";
    });

    return object;
  });
}

/* =========================================================
   UI
========================================================= */

export default function ProductDataImportPage() {
  const [products, setProducts] = useState<Product[]>(
    []
  );

  const [selectedCsvFile, setSelectedCsvFile] =
    useState<File | null>(null);

  const [isImporting, setIsImporting] =
    useState(false);

  const [isLoadingProducts, setIsLoadingProducts] =
    useState(true);

  const [importStatus, setImportStatus] =
    useState("");

  const [searchTerm, setSearchTerm] =
    useState("");

  const [selectedProduct, setSelectedProduct] =
    useState<Product | null>(null);

  const [editingProduct, setEditingProduct] =
    useState<Product | null>(null);

  const [currentPage, setCurrentPage] =
    useState(1);

  const [pageSize, setPageSize] =
    useState(25);

  const [showImportPanel, setShowImportPanel] =
    useState(true);

  const [isClearingProducts, setIsClearingProducts] =
    useState(false);

  const [isClearingPharmacyProducts, setIsClearingPharmacyProducts] =
    useState(false);

  /*
   * Load the shared catalog and migrate any legacy browser-only imports.
   */
  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          throw authError ?? new Error("Sign in to load the product catalog.");
        }

        const catalogRows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
          const { data, error } = await supabase
            .from("admin_medicine_catalog")
            .select("*")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + CATALOG_PAGE_SIZE - 1);

          if (error) {
            throw error;
          }

          const page = data ?? [];
          catalogRows.push(...page);
          if (page.length < CATALOG_PAGE_SIZE) {
            break;
          }
        }

        const catalog = catalogRows.map((row) => mapCatalogRowToProduct(row));
        const legacyProducts = loadProductsFromLocalStorage();
        let migratedCount = 0;

        for (const legacyProduct of legacyProducts) {
          if (isDuplicateProduct(legacyProduct, catalog)) {
            continue;
          }

          const savedProduct = await insertProductIntoCatalog({
            ...legacyProduct,
            id: createProductId(catalog),
          }, user.id);

          catalog.push(savedProduct);
          migratedCount++;
        }

        if (active) {
          setProducts(catalog);
          if (migratedCount > 0) {
            setImportStatus(`${migratedCount} existing product(s) moved from this browser to the shared Supabase catalog.`);
          }
        }

        if (legacyProducts.length > 0 && typeof window !== "undefined") {
          localStorage.removeItem(PRODUCT_STORAGE_KEY);
        }
      } catch (error) {
        if (active) {
          setImportStatus(error instanceof Error ? error.message : "Failed to load the shared product catalog.");
        }
      } finally {
        if (active) {
          setIsLoadingProducts(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  /* =======================================================
     Search
  ======================================================= */

  const filteredProducts = useMemo(() => {
    const search =
      normalizeProductValue(searchTerm);

    if (!search) {
      return products;
    }

    return products.filter((product) => {
      const searchableText = [
        product.serialNumber,
        product.pharmaceuticalCompany,
        product.brandName,
        product.genericName,
        product.strength,
        product.dosageFormDescription,
        product.retailPrice,
        product.usageType,
        product.darCode,
        product.medicineTypeCategory,
        product.registrationInformation,
        product.packSize,
        product.unitPrice,
        product.packPrice,
        product.id,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(search);
    });
  }, [products, searchTerm]);

  /* =======================================================
     Pagination
  ======================================================= */

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredProducts.length / pageSize
    )
  );

  const safeCurrentPage = Math.min(
    currentPage,
    totalPages
  );

  const paginatedProducts = useMemo(() => {
    const start =
      (safeCurrentPage - 1) * pageSize;

    return filteredProducts.slice(
      start,
      start + pageSize
    );
  }, [
    filteredProducts,
    safeCurrentPage,
    pageSize,
  ]);

  function handleCsvSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportStatus("Choose a CSV file.");
      return;
    }
    setSelectedCsvFile(file);
    setImportStatus("");
  }

  async function handleImportCsv() {
    if (!selectedCsvFile) {
      setImportStatus("Upload a CSV file before importing.");
      return;
    }

    try {
      setIsImporting(true);
      setImportStatus(`Reading ${selectedCsvFile.name}...`);
      const rows = parseCSV(await selectedCsvFile.text());
      if (!rows.length) {
        throw new Error("The CSV file has no product rows.");
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw authError ?? new Error("Sign in before importing products.");
      }

      let skippedCount = 0;
      let upsertedCount = 0;
      let generatedId = createProductId(products);
      const usedIds = new Set(products.map((product) => product.id));
      const currentProducts = new Map(products.map((product) => [product.id, product]));
      const reservedIds = new Set(
        rows
          .map((row) => createProductFromSourceRow(row, 0)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const importedIds = new Set<string>();
      const importedProducts: Product[] = [];

      for (let index = 0; index < rows.length; index++) {
        const parsedProduct = createProductFromSourceRow(rows[index], index);
        if (!parsedProduct) {
          skippedCount++;
          continue;
        }

        let id = parsedProduct.id;
        if (!id) {
          while (usedIds.has(generatedId) || reservedIds.has(generatedId)) {
            generatedId = `MED-${String(Number(generatedId.slice(4)) + 1).padStart(4, "0")}`;
          }
          id = generatedId;
          reservedIds.add(id);
          generatedId = `MED-${String(Number(generatedId.slice(4)) + 1).padStart(4, "0")}`;
        }

        if (importedIds.has(id)) {
          skippedCount++;
          continue;
        }
        importedIds.add(id);
        usedIds.add(id);

        const product: Product = { ...parsedProduct, id };
        if (!parsedProduct.id && isDuplicateProduct(product, [...currentProducts.values()])) {
          skippedCount++;
          continue;
        }
        importedProducts.push(product);
      }

      if (!importedProducts.length) {
        throw new Error("No valid products were found in the CSV file.");
      }

      for (let offset = 0; offset < importedProducts.length; offset += 250) {
        const batch = importedProducts.slice(offset, offset + 250);
        const { data, error } = await supabase
          .from("admin_medicine_catalog")
          .upsert(
            batch.map((product) => ({
              ...mapProductToCatalogRow(product),
              created_by: user.id,
            })),
            { onConflict: "id" },
          )
          .select("*");

        if (error) {
          if (
            error.code === "PGRST204" ||
            /could not find the .* column of 'admin_medicine_catalog' in the schema cache/i.test(error.message)
          ) {
            throw new Error(
              "The Supabase catalog schema is missing the new pricing columns. Run supabase/migrations/20261004171500_admin_catalog_pricing_fields.sql in the Supabase SQL Editor, then retry the CSV import.",
            );
          }
          throw new Error(`Imported ${upsertedCount} row(s) before the next CSV batch failed: ${error.message}`);
        }
        if (!data || data.length !== batch.length) {
          throw new Error(`Supabase saved ${data?.length ?? 0} of ${batch.length} rows in the current CSV batch.`);
        }

        for (const row of data) {
          const savedProduct = mapCatalogRowToProduct(row);
          currentProducts.set(savedProduct.id, savedProduct);
        }
        upsertedCount += data.length;
        setProducts([...currentProducts.values()]);
        setImportStatus(`Imported ${upsertedCount}/${importedProducts.length} CSV row(s) to Supabase...`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      setCurrentPage(1);
      setSelectedCsvFile(null);
      setImportStatus(`CSV import complete: ${upsertedCount} row(s) saved to Supabase; ${skippedCount} invalid or duplicate row(s) skipped.`);
    } catch (error) {
      console.error(error);
      setImportStatus(error instanceof Error ? error.message : "Failed to import CSV data.");
    } finally {
      setIsImporting(false);
    }
  }

  /* =======================================================
     Delete Product
  ======================================================= */

  async function handleDeleteProduct(
    productId: string
  ) {
    const { error } = await supabase
      .from("admin_medicine_catalog")
      .delete()
      .eq("id", productId);

    if (error) {
      setImportStatus(error.message);
      return;
    }

    const updatedProducts =
      products.filter(
        (product) =>
          product.id !== productId
      );

    setProducts(updatedProducts);

    if (
      selectedProduct?.id === productId
    ) {
      setSelectedProduct(null);
    }
  }

  async function handleSaveEditedProduct(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!editingProduct) {
      return;
    }

    const { data, error } = await supabase
      .from("admin_medicine_catalog")
      .update({ ...mapProductToCatalogRow(editingProduct), updated_at: new Date().toISOString() })
      .eq("id", editingProduct.id)
      .select("*")
      .single();

    if (error) {
      setImportStatus(error.message);
      return;
    }

    const savedProduct = mapCatalogRowToProduct(data);
    const updatedProducts = products.map((product) =>
      product.id === savedProduct.id ? savedProduct : product
    );

    setProducts(updatedProducts);
    setEditingProduct(null);

    if (selectedProduct?.id === editingProduct.id) {
      setSelectedProduct(savedProduct);
    }
  }

  /* =======================================================
     Clear All
  ======================================================= */

  async function handleClearAllProducts() {
    setIsClearingProducts(true);
    setImportStatus("Deleting all products from Supabase in batches...");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw sessionError ?? new Error("Sign in again before deleting catalog data.");
      }

      const response = await fetch("/api/admin/catalog/delete-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json() as {
        deletedCount?: number;
        remainingCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? `Catalog deletion failed (HTTP ${response.status}).`);
      }
      if (result.remainingCount !== 0 || typeof result.deletedCount !== "number") {
        throw new Error("The server did not confirm that the entire catalog was deleted.");
      }

      setProducts([]);

      if (typeof window !== "undefined") {
        localStorage.removeItem(PRODUCT_STORAGE_KEY);
      }

      setSelectedProduct(null);
      setCurrentPage(1);
      setImportStatus(`${result.deletedCount.toLocaleString()} product(s) deleted from Supabase. Remaining records: ${result.remainingCount}.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Could not delete products from the shared Supabase catalog.");
    } finally {
      setIsClearingProducts(false);
    }
  }

  async function handleClearAllPharmacyProducts() {
    if (!window.confirm("Delete every pharmacy account's Product list from Supabase? This cannot be undone.")) {
      return;
    }

    setIsClearingPharmacyProducts(true);
    setImportStatus("Deleting all pharmacy Product list records from Supabase...");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw sessionError ?? new Error("Sign in again before deleting pharmacy product data.");
      }

      const response = await fetch("/api/admin/pharmacy-catalog/delete-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json() as {
        deletedCount?: number;
        remainingCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? `Pharmacy product deletion failed (HTTP ${response.status}).`);
      }
      if (result.remainingCount !== 0 || typeof result.deletedCount !== "number") {
        throw new Error("The server did not confirm that all pharmacy Product list records were deleted.");
      }

      setImportStatus(`${result.deletedCount.toLocaleString()} pharmacy Product list record(s) deleted from Supabase. Remaining records: ${result.remainingCount}.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Could not delete pharmacy Product list data.");
    } finally {
      setIsClearingPharmacyProducts(false);
    }
  }

  /* =======================================================
     Pagination
  ======================================================= */

  function goToPage(page: number) {
    if (
      page < 1 ||
      page > totalPages
    ) {
      return;
    }

    setCurrentPage(page);
  }

  const firstItem =
    filteredProducts.length === 0
      ? 0
      : (safeCurrentPage - 1) *
          pageSize +
        1;

  const lastItem = Math.min(
    safeCurrentPage * pageSize,
    filteredProducts.length
  );

  /* =======================================================
     Render
  ======================================================= */

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        {/* =================================================
            Header
        ================================================= */}

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
            <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>
              Product Data Import
            </h1>

            <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>
              Import and manage medicine product
              data.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                setShowImportPanel(
                  !showImportPanel
                )
              }
              style={{ padding: "8px 12px", border: 0, borderRadius: 6, background: "#18845d", color: "#fff", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
            >
              {showImportPanel
                ? "Hide Import"
                : "Import Product Data"}
            </button>

          </div>
        </div>

        {/* =================================================
            Import Panel
        ================================================= */}

        {showImportPanel && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Import Product Data
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Upload a CSV file with product columns, then import it into Supabase.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-6 py-3 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvSelection}
                  disabled={isImporting || isLoadingProducts}
                  className="hidden"
                />
              </label>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-600">
                {selectedCsvFile?.name ?? "No CSV file selected"}
              </span>
              <button
                type="button"
                onClick={() => void handleImportCsv()}
                disabled={isImporting || isLoadingProducts || !selectedCsvFile}
                className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImporting ? "Importing..." : "Import"}
              </button>
            </div>

            {importStatus && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {importStatus}
              </div>
            )}

            <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
              <p className="font-medium">
                Supported product fields
              </p>

              <p className="mt-1 leading-6">
                ID Number • Brand Name • Generic Name • Company • Strength •
                Dosage Form • Pack Size • Unit Price • Pack Price
              </p>

              <p className="mt-2">
                Missing information will be stored as{" "}
                <strong>-</strong>.
              </p>
            </div>
          </div>
        )}

        {/* =================================================
            Stats
        ================================================= */}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[#e4e9e5] bg-white p-4">
            <p className="text-xs text-[#77857d]">
              Total Products
            </p>

            <p className="mt-2 text-xl font-bold text-[#26352f]">
              {products.length}
            </p>
          </div>

          <div className="rounded-lg border border-[#e4e9e5] bg-white p-4">
            <p className="text-xs text-[#77857d]">
              Search Results
            </p>

            <p className="mt-2 text-xl font-bold text-[#26352f]">
              {filteredProducts.length}
            </p>
          </div>

          <div className="rounded-lg border border-[#e4e9e5] bg-white p-4">
            <p className="text-xs text-[#77857d]">
              Storage
            </p>

            <p className="mt-2 text-xl font-bold text-[#26352f]">
              Supabase
            </p>
          </div>
        </div>

        {/* =================================================
            Search / Controls
        ================================================= */}

        <div className="mb-4 rounded-lg border border-[#e4e9e5] bg-white px-[18px] py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(
                  event.target.value
                );
                setCurrentPage(1);
              }}
              placeholder="Search product, brand, generic, company, DAR..."
              className="w-full rounded-md border border-[#e0e6e1] px-[10px] py-2 text-xs text-[#26352f] outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 md:w-[240px]"
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-[#687871]">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded-md border border-[#e0e6e1] bg-white px-2.5 py-2 text-xs text-[#26352f] outline-none focus:border-emerald-600"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleClearAllProducts()}
                disabled={isLoadingProducts || isClearingProducts}
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isClearingProducts ? "Deleting..." : "Delete all Supabase data"}
              </button>
              <button
                type="button"
                onClick={() => void handleClearAllPharmacyProducts()}
                disabled={isLoadingProducts || isClearingProducts || isClearingPharmacyProducts}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isClearingPharmacyProducts ? "Deleting pharmacy lists..." : "Delete all pharmacy Product lists"}
              </button>
            </div>
          </div>
        </div>

        {/* =================================================
            Product Table
        ================================================= */}

        <div style={{ overflow: "hidden", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1400, borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr>
                  {["ID Number", "Brand Name", "Generic Name", "Company", "Strength", "Dosage Form", "Pack Size", "Unit Price", "Pack Price", "Actions"].map((column) => (
                    <th key={column} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                      {searchTerm ? "No products match your search." : "No products yet. Import product data to get started."}
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((product) => (
                      <tr key={product.id} style={{ borderBottom: "1px solid #f0f2f0" }}>
                        {[product.id, product.brandName, product.genericName, product.pharmaceuticalCompany, product.strength, product.dosageFormDescription, product.packSize, product.unitPrice, product.packPrice].map((value, index) => (
                          <td key={`${product.id}-${index}`} title={value} style={{ maxWidth: index === 1 || index === 2 || index === 5 ? 210 : undefined, padding: "13px", color: index === 0 || index === 1 ? "#26352f" : "#687871", fontSize: 12, fontWeight: index === 0 || index === 1 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {value || "-"}
                          </td>
                        ))}
                        <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button type="button" onClick={() => setSelectedProduct(product)} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#227553", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                              Details
                            </button>
                            <button type="button" onClick={() => setEditingProduct({ ...product })} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#526158", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => handleDeleteProduct(product.id)} style={{ border: "1px solid #f0d7d4", borderRadius: 5, background: "#fff", color: "#b34b43", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {/* =================================================
              Pagination
          ================================================= */}

          {filteredProducts.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                Showing{" "}
                <span className="font-medium text-gray-700">
                  {firstItem}
                </span>{" "}
                to{" "}
                <span className="font-medium text-gray-700">
                  {lastItem}
                </span>{" "}
                of{" "}
                <span className="font-medium text-gray-700">
                  {filteredProducts.length}
                </span>
              </p>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    goToPage(
                      safeCurrentPage - 1
                    )
                  }
                  disabled={
                    safeCurrentPage === 1
                  }
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>

                {Array.from(
                  {
                    length: Math.min(
                      totalPages,
                      7
                    ),
                  },
                  (_, index) => {
                    let pageNumber =
                      index + 1;

                    if (
                      totalPages > 7 &&
                      safeCurrentPage > 4
                    ) {
                      pageNumber =
                        safeCurrentPage -
                        3 +
                        index;

                      if (
                        pageNumber >
                        totalPages
                      ) {
                        pageNumber =
                          totalPages -
                          6 +
                          index;
                      }
                    }

                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() =>
                          goToPage(
                            pageNumber
                          )
                        }
                        className={`min-w-9 rounded-lg px-3 py-2 text-sm ${
                          pageNumber ===
                          safeCurrentPage
                            ? "bg-black text-white"
                            : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {pageNumber}
                      </button>
                    );
                  }
                )}

                <button
                  type="button"
                  onClick={() =>
                    goToPage(
                      safeCurrentPage + 1
                    )
                  }
                  disabled={
                    safeCurrentPage ===
                    totalPages
                  }
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* =====================================================
          Product Details Modal
      ===================================================== */}

      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() =>
            setSelectedProduct(null)
          }
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {selectedProduct.brandName !==
                  "-"
                    ? selectedProduct.brandName
                    : selectedProduct.genericName}
                </h2>

                <p className="mt-1 text-xs text-gray-500">
                  Product ID:{" "}
                  {selectedProduct.id}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedProduct(null)
                }
                className="rounded-lg px-3 py-2 text-xl text-gray-500 hover:bg-gray-100"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <DetailItem label="DAR Code" value={selectedProduct.darCode} />
              <DetailItem label="Medicine Type/Category" value={selectedProduct.medicineTypeCategory} />
              <DetailItem label="Registration Information" value={selectedProduct.registrationInformation} />
              <DetailItem label="Internal Product ID" value={selectedProduct.id} />
            </div>

            <div className="flex justify-end border-t bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setSelectedProduct(null)
                }
                className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingProduct(null)}>
          <form className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()} onSubmit={handleSaveEditedProduct}>
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Edit product</h2>
              <p className="mt-1 text-xs text-gray-500">Product ID: {editingProduct.id}</p>
            </div>
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-6 sm:grid-cols-2">
              {editableProductFields.map(({ key, label }) => (
                <label key={key} className="grid gap-1.5 text-xs font-medium text-gray-600">
                  {label}
                  <input value={editingProduct[key]} onChange={(event) => setEditingProduct((current) => current ? { ...current, [key]: event.target.value } : current)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal text-gray-800 outline-none focus:border-emerald-600" />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button type="button" onClick={() => setEditingProduct(null)} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700">Cancel</button>
              <button type="submit" className="rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">Save changes</button>
            </div>
          </form>
        </div>
      )}

    </AdminDashboardShell>
  );
}

/* =========================================================
   Detail Item
========================================================= */

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>

      <p className="mt-1 break-words text-sm font-medium text-gray-900">
        {value || "-"}
      </p>
    </div>
  );
}