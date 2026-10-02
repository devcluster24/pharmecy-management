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
  { key: "retailPrice", label: "Retail Price" },
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

function normalizeImportUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) {
    throw new Error("Please enter a data URL.");
  }

  /*
   * GitHub:
   * https://github.com/user/repo/blob/main/file.json
   *
   * becomes:
   * https://raw.githubusercontent.com/user/repo/main/file.json
   */

  const githubMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i
  );

  if (githubMatch) {
    const [, owner, repo, path] = githubMatch;

    return `https://raw.githubusercontent.com/${owner}/${repo}/${path}`;
  }

  return trimmed;
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
  return {
    id: product.id,
    serial_number: product.serialNumber,
    pharmaceutical_company: product.pharmaceuticalCompany,
    brand_name: product.brandName,
    generic_name: product.genericName,
    strength: product.strength,
    dosage_form_description: product.dosageFormDescription,
    retail_price: product.retailPrice,
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
): ProductFields | null {
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
      findValue("retailPrice")
    ),

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
   JSON
========================================================= */

function extractProductRows(
  payload: unknown
): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (
        item
      ): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null
    );
  }

  if (
    typeof payload === "object" &&
    payload !== null
  ) {
    const object =
      payload as Record<string, unknown>;

    const possibleKeys = [
      "data",
      "items",
      "medicines",
      "products",
      "records",
    ];

    for (const key of possibleKeys) {
      const value = object[key];

      if (Array.isArray(value)) {
        return value.filter(
          (
            item
          ): item is Record<string, unknown> =>
            typeof item === "object" &&
            item !== null
        );
      }
    }
  }

  return [];
}

/* =========================================================
   CSV Parser
   No external package required
========================================================= */

function parseCSV(text: string): Record<string, unknown>[] {
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
   URL Fetch
========================================================= */

async function fetchProductDataFromUrl(
  url: string
) {
  const normalizedUrl = normalizeImportUrl(url);

  const response = await fetch(normalizedUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch data. HTTP ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  const text = await response.text();

  /*
   * CSV
   */
  if (
    contentType.includes("text/csv") ||
    normalizedUrl.toLowerCase().endsWith(".csv")
  ) {
    return parseCSV(text);
  }

  /*
   * JSON
   */
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "The URL did not return valid JSON or CSV data."
    );
  }
}

/* =========================================================
   UI
========================================================= */

export default function ProductDataImportPage() {
  const [products, setProducts] = useState<Product[]>(
    []
  );

  const [importUrl, setImportUrl] =
    useState("");

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

  const [showClearConfirm, setShowClearConfirm] =
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

  /* =======================================================
     Import URL
  ======================================================= */

  async function handleImportProductData() {
    if (!importUrl.trim()) {
      setImportStatus(
        "Please enter a JSON or CSV data URL."
      );

      return;
    }

    try {
      setIsImporting(true);
      setImportStatus("Connecting to data source...");

      const payload = await fetchProductDataFromUrl(importUrl);
      const rows = extractProductRows(payload);
      if (!rows.length) {
        throw new Error("No product data found in this URL.");
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw authError ?? new Error("Sign in before importing products.");
      }

      let addedCount = 0;
      let duplicateCount = 0;
      let skippedCount = 0;
      const currentProducts = [...products];

      for (let index = 0; index < rows.length; index++) {
        const productData = createProductFromSourceRow(rows[index], index);
        if (!productData) {
          skippedCount++;
          continue;
        }

        if (isDuplicateProduct(productData, currentProducts)) {
          duplicateCount++;
          continue;
        }

        const newProduct: Product = {
          ...productData,
          id: createProductId(currentProducts),
        };
        const savedProduct = await insertProductIntoCatalog(newProduct, user.id);
        currentProducts.push(savedProduct);
        setProducts([...currentProducts]);
        addedCount++;
        setImportStatus(`Imported ${addedCount} product(s) • Checked ${index + 1}/${rows.length} • ${duplicateCount} duplicate skipped`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      setCurrentPage(1);
      setImportStatus(`Import completed: ${addedCount} added, ${duplicateCount} duplicate skipped, ${skippedCount} invalid skipped.`);
    } catch (error) {
      console.error(error);
      setImportStatus(error instanceof Error ? error.message : "Failed to import product data.");
    } finally {
      setIsImporting(false);
    }
  }

  /* =======================================================
     Local File Import
  ======================================================= */

  async function handleFileImport(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsImporting(true);

      setImportStatus(
        `Reading ${file.name}...`
      );

      const text = await file.text();

      let payload: unknown;

      if (
        file.name
          .toLowerCase()
          .endsWith(".csv")
      ) {
        payload = parseCSV(text);
      } else {
        payload = JSON.parse(text);
      }

      const rows =
        extractProductRows(payload);

      if (!rows.length) {
        throw new Error(
          "No product data found in the selected file."
        );
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw authError ?? new Error("Sign in before importing products.");
      }

      let addedCount = 0;
      let duplicateCount = 0;
      let skippedCount = 0;
      const currentProducts = [...products];

      for (
        let index = 0;
        index < rows.length;
        index++
      ) {
        const productData =
          createProductFromSourceRow(
            rows[index],
            index
          );

        if (!productData) {
          skippedCount++;
          continue;
        }

        if (
          isDuplicateProduct(
            productData,
            currentProducts
          )
        ) {
          duplicateCount++;
          continue;
        }

        const newProduct: Product = {
          ...productData,
          id: createProductId(
            currentProducts
          ),
        };

        const savedProduct = await insertProductIntoCatalog(newProduct, user.id);
        currentProducts.push(savedProduct);
        setProducts([...currentProducts]);

        addedCount++;

        setImportStatus(
          `Imported ${addedCount} product(s) • ` +
            `Checked ${index + 1}/${rows.length}`
        );

        await new Promise<void>(
          (resolve) =>
            setTimeout(resolve, 0)
        );
      }

      setCurrentPage(1);

      setImportStatus(
        `File import completed: ${addedCount} added, ` +
          `${duplicateCount} duplicate skipped, ` +
          `${skippedCount} invalid skipped.`
      );
    } catch (error) {
      console.error(error);

      setImportStatus(
        error instanceof Error
          ? error.message
          : "Failed to import file."
      );
    } finally {
      setIsImporting(false);

      /*
       * Same file আবার select করার সুযোগ
       */
      event.target.value = "";
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
    const { error } = await supabase
      .from("admin_medicine_catalog")
      .delete()
      .not("id", "is", null);

    if (error) {
      setImportStatus(error.message);
      return;
    }

    setProducts([]);

    if (typeof window !== "undefined") {
      localStorage.removeItem(PRODUCT_STORAGE_KEY);
    }

    setSelectedProduct(null);
    setShowClearConfirm(false);
    setCurrentPage(1);
    setImportStatus(
      "All products have been deleted from the shared Supabase catalog."
    );
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

            <button
              type="button"
              onClick={() =>
                setShowClearConfirm(true)
              }
              disabled={
                isLoadingProducts || products.length === 0
              }
              className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear All
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
                Paste a JSON/CSV URL or select a
                local JSON/CSV file.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                type="url"
                value={importUrl}
                onChange={(event) =>
                  setImportUrl(
                    event.target.value
                  )
                }
                placeholder="https://example.com/products.json"
                disabled={isImporting || isLoadingProducts}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-black focus:ring-1 focus:ring-black disabled:bg-gray-100"
              />

              <button
                type="button"
                onClick={
                  handleImportProductData
                }
                disabled={
                  isImporting ||
                  isLoadingProducts ||
                  !importUrl.trim()
                }
                className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImporting
                  ? "Importing..."
                  : "Import Product Data"}
              </button>

              <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-6 py-3 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                Select File

                <input
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={
                    handleFileImport
                  }
                  disabled={isImporting || isLoadingProducts}
                  className="hidden"
                />
              </label>
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
                SL / Serial Number • Pharmaceutical
                Company • Brand Name • Generic Name •
                Strength • Dosage Form / Description •
                Retail Price • Usage Type • DAR Code •
                Medicine Type/Category • Registration
                Information
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

            <div className="flex items-center gap-2 text-xs text-[#687871]">
              <span>Rows:</span>

              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(
                    Number(event.target.value)
                  );
                  setCurrentPage(1);
                }}
                className="rounded-md border border-[#e0e6e1] bg-white px-2.5 py-2 text-xs text-[#26352f] outline-none focus:border-emerald-600"
              >
                <option value={10}>
                  10
                </option>

                <option value={25}>
                  25
                </option>

                <option value={50}>
                  50
                </option>

                <option value={100}>
                  100
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* =================================================
            Product Table
        ================================================= */}

        <div style={{ overflow: "hidden", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1220, borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr>
                  {["SL / Serial Number", "Pharmaceutical Company", "Brand Name", "Generic Name", "Strength", "Dosage Form / Description", "Retail Price", "Usage Type", "Actions"].map((column) => (
                    <th key={column} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                      {searchTerm ? "No products match your search." : "No products yet. Import product data to get started."}
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((product) => (
                      <tr key={product.id} style={{ borderBottom: "1px solid #f0f2f0" }}>
                        {[product.serialNumber, product.pharmaceuticalCompany, product.brandName, product.genericName, product.strength, product.dosageFormDescription, product.retailPrice, product.usageType].map((value, index) => (
                          <td key={`${product.id}-${index}`} title={value} style={{ maxWidth: index === 1 || index === 3 || index === 5 ? 210 : undefined, padding: "13px", color: index === 0 || index === 2 ? "#26352f" : "#687871", fontSize: 12, fontWeight: index === 0 || index === 2 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

      {/* =====================================================
          Clear Confirmation
      ===================================================== */}

      {showClearConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() =>
            setShowClearConfirm(false)
          }
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <h2 className="text-lg font-bold text-gray-900">
              Clear all products?
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              This will permanently remove all
              currently stored products from this
              browser&apos;s local storage.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setShowClearConfirm(false)
                }
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  handleClearAllProducts
                }
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Clear All
              </button>
            </div>
          </div>
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