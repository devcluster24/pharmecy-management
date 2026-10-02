'use client';

import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Sidebar from "../components/Sidebar";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";
import { supabase } from "@/lib/supabase/client";
import {
  getProductIdentityKey,
  getProductNameKey,
  parseProductCsv,
  type ProductImportCandidate,
} from "./productImport";

type Product = {
  id: string;
  medicineName: string;
  brand: string;
  genericName: string;
  manufacturer: string;
  productType: string;
  category: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  unit: string;
  barcode: string;
  serialNumber?: string;
  retailPrice?: string;
  usageType?: string;
  darCode?: string;
  medicineTypeCategory?: string;
  registrationInformation?: string;
  sourceCatalogId?: string;
};

type CatalogProductRow = {
  id: string;
  serial_number: string;
  pharmaceutical_company: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form_description: string;
  retail_price: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type PharmacyProductRow = {
  owner_user_id: string;
  id: string;
  source_catalog_id: string | null;
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
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type SuggestionField = "dosageForm" | "strength" | "packSize" | "barcode";
type Suggestions = Record<SuggestionField, string[]>;
type ImportReview = { key: string; product: ProductImportCandidate; reason: string; error?: string };

const storageKeys = {
  products: "pharmacy-cluster-products",
  suggestions: "pharmacy-cluster-product-suggestions",
};

const initialSuggestions: Suggestions = {
  dosageForm: ["Tablet", "Capsule", "Syrup", "Injection"],
  strength: ["500mg", "5mg/5ml"],
  packSize: ["10 tablets", "100ml"],
  barcode: [],
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #dce5df",
  borderRadius: 7,
  padding: "10px 11px",
  color: "#24372d",
  background: "#fff",
  fontSize: 13,
  outlineColor: "#28a879",
};

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, color: "#405248", fontSize: 12, fontWeight: 600 }}>
      {label}
      {children}
    </label>
  );
}

function createProductId(products: Product[]) {
  const highestId = products.reduce((highest, product) => {
    const match = /^MED-(\d+)$/i.exec(product.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `MED-${String(highestId + 1).padStart(4, "0")}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Import failed. Check the source and try again.";
}

function mapPharmacyRowToProduct(row: PharmacyProductRow): Product {
  return {
    id: row.id,
    sourceCatalogId: row.source_catalog_id ?? undefined,
    serialNumber: row.serial_number,
    medicineName: row.medicine_name,
    brand: row.brand,
    genericName: row.generic_name,
    manufacturer: row.manufacturer,
    productType: row.product_type,
    category: row.category,
    dosageForm: row.dosage_form,
    strength: row.strength,
    packSize: row.pack_size,
    unit: row.unit,
    barcode: row.barcode,
    retailPrice: row.retail_price,
    usageType: row.usage_type,
    darCode: row.dar_code,
    medicineTypeCategory: row.medicine_type_category,
    registrationInformation: row.registration_information,
  };
}

function mapProductToPharmacyRow(product: Product, ownerUserId: string) {
  return {
    owner_user_id: ownerUserId,
    id: product.id,
    source_catalog_id: product.sourceCatalogId ?? null,
    serial_number: product.serialNumber ?? "-",
    medicine_name: product.medicineName,
    brand: product.brand,
    generic_name: product.genericName,
    manufacturer: product.manufacturer,
    product_type: product.productType,
    category: product.category,
    dosage_form: product.dosageForm,
    strength: product.strength,
    pack_size: product.packSize,
    unit: product.unit,
    barcode: product.barcode,
    retail_price: product.retailPrice ?? "-",
    usage_type: product.usageType ?? product.productType,
    dar_code: product.darCode ?? product.barcode ?? "-",
    medicine_type_category: product.medicineTypeCategory ?? product.category,
    registration_information: product.registrationInformation ?? "-",
  };
}

function mapCatalogRowToProduct(row: CatalogProductRow): Product {
  return {
    id: row.id,
    sourceCatalogId: row.id,
    serialNumber: row.serial_number,
    medicineName: row.brand_name !== "-" ? row.brand_name : row.generic_name,
    brand: row.brand_name,
    genericName: row.generic_name,
    manufacturer: row.pharmaceutical_company,
    productType: row.usage_type,
    category: row.medicine_type_category,
    dosageForm: row.dosage_form_description,
    strength: row.strength,
    packSize: "-",
    unit: "-",
    barcode: row.dar_code,
    retailPrice: row.retail_price,
    usageType: row.usage_type,
    darCode: row.dar_code,
    medicineTypeCategory: row.medicine_type_category,
    registrationInformation: row.registration_information,
  };
}

function ProductManagementHeader() {
  return (
    <header style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e8e8e6" }}>
      <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, color: "#202624", textDecoration: "none" }}>
        <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "#2ad49a", color: "#07372b", fontSize: 14 }}>✚</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Pharmecy Cluster</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#64716d", fontSize: 12 }}>
        <span>Green Valley Pharmacy</span>
        <PharmacyProfileMenu />
      </div>
    </header>
  );
}

export default function ProductManagementPage({ adminMode = false }: { adminMode?: boolean } = {}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(initialSuggestions);
  const [storageReady, setStorageReady] = useState(adminMode);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [addProductError, setAddProductError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ phase: "", checked: 0, total: 0 });
  const [importSummary, setImportSummary] = useState({ added: 0, duplicates: 0 });
  const [importError, setImportError] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importReviews, setImportReviews] = useState<ImportReview[]>([]);
  const [catalogRows, setCatalogRows] = useState<CatalogProductRow[]>([]);
  const [pharmacyUserId, setPharmacyUserId] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);

  useEffect(() => {
    let active = true;
    let parsedSuggestions: Partial<Suggestions> | undefined;
    try {
      const savedSuggestions = localStorage.getItem(storageKeys.suggestions);
      if (savedSuggestions) {
        parsedSuggestions = JSON.parse(savedSuggestions) as Partial<Suggestions>;
      }
    } catch {
      localStorage.removeItem(storageKeys.suggestions);
    }

    const suggestionsHydration = window.setTimeout(() => {
      if (parsedSuggestions) {
        setSuggestions({
          dosageForm: [...new Set([...initialSuggestions.dosageForm, ...(parsedSuggestions.dosageForm ?? [])])],
          strength: [...new Set([...initialSuggestions.strength, ...(parsedSuggestions.strength ?? [])])],
          packSize: [...new Set([...initialSuggestions.packSize, ...(parsedSuggestions.packSize ?? [])])],
          barcode: [...new Set(parsedSuggestions.barcode ?? [])],
        });
      }
    });

    async function loadPharmacyProducts() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw authError ?? new Error("Sign in to load your product list.");

        const [productResult, catalogResult] = await Promise.all([
          supabase.from("pharmacy_catalog_products").select("*").eq("owner_user_id", user.id).order("created_at"),
          supabase.from("admin_medicine_catalog").select("*").order("pharmaceutical_company"),
        ]);
        if (productResult.error) throw productResult.error;
        if (catalogResult.error) throw catalogResult.error;

        const remoteProducts = ((productResult.data ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
        const sharedCatalog = (catalogResult.data ?? []) as CatalogProductRow[];
        const localProductsRaw = localStorage.getItem(storageKeys.products);
        const parsedLocalProducts: Product[] = localProductsRaw
          ? (JSON.parse(localProductsRaw) as Product[])
          : [];
        const productsToMigrate: Product[] = [];
        const knownProducts = [...remoteProducts];

        for (const localProduct of parsedLocalProducts) {
          const existing = knownProducts.find((product) =>
            product.id === localProduct.id ||
            (getProductIdentityKey(product) !== null && getProductIdentityKey(product) === getProductIdentityKey(localProduct)),
          );
          if (existing) continue;

          const matchingCatalogRow = sharedCatalog.find((row) => {
            if (knownProducts.some((product) => product.sourceCatalogId === row.id)) return false;
            return getProductIdentityKey(localProduct) === getProductIdentityKey(mapCatalogRowToProduct(row));
          });
          const productToSave = {
            ...localProduct,
            id: knownProducts.some((product) => product.id === localProduct.id)
              ? createProductId(knownProducts)
              : localProduct.id,
            sourceCatalogId: localProduct.sourceCatalogId ?? matchingCatalogRow?.id,
          };
          productsToMigrate.push(productToSave);
          knownProducts.push(productToSave);
        }

        if (productsToMigrate.length) {
          const { data, error } = await supabase
            .from("pharmacy_catalog_products")
            .upsert(productsToMigrate.map((product) => mapProductToPharmacyRow(product, user.id)), { onConflict: "owner_user_id,id" })
            .select("*");
          if (error) throw error;
          const migratedProducts = ((data ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
          const migratedIds = new Set(migratedProducts.map((product) => product.id));
          for (let index = 0; index < knownProducts.length; index++) {
            if (migratedIds.has(knownProducts[index].id)) {
              const migrated = migratedProducts.find((product) => product.id === knownProducts[index].id);
              if (migrated) knownProducts[index] = migrated;
            }
          }
        }

        if (!active) return;
        setPharmacyUserId(user.id);
        setProducts(knownProducts);
        setCatalogRows(sharedCatalog);
        if (parsedLocalProducts.length) {
          localStorage.removeItem(storageKeys.products);
        }
      } catch (error) {
        if (active) setImportError(getErrorMessage(error));
      } finally {
        if (active) {
          setStorageReady(true);
          setIsLoadingCompanies(false);
        }
      }
    }

    if (!adminMode) void loadPharmacyProducts();

    return () => {
      active = false;
      window.clearTimeout(suggestionsHydration);
    };
  }, [adminMode]);

  useEffect(() => {
    if (adminMode) return;

    async function refreshSharedCatalog() {
      const { data, error } = await supabase
        .from("admin_medicine_catalog")
        .select("*")
        .order("pharmaceutical_company");

      if (!error) setCatalogRows((data ?? []) as CatalogProductRow[]);
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshSharedCatalog();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [adminMode]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKeys.suggestions, JSON.stringify(suggestions));
    } catch {
      // The page remains usable if browser storage is unavailable.
    }
  }, [suggestions]);

  useEffect(() => {
    if (!isAddOpen && !selectedProduct) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddOpen(false);
        setSelectedProduct(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAddOpen, selectedProduct]);

  const filteredProducts = products.filter((product) =>
    [product.id, product.serialNumber, product.medicineName, product.brand, product.genericName, product.manufacturer, product.dosageForm, product.strength, product.packSize, product.barcode, product.retailPrice, product.usageType, product.darCode, product.medicineTypeCategory, product.registrationInformation]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );
  const importedCatalogIds = new Set(products.map((product) => product.sourceCatalogId).filter((id): id is string => Boolean(id)));
  const importedProductKeys = new Set(products.map(getProductIdentityKey).filter((key): key is string => Boolean(key)));
  const companyCounts = new Map<string, { name: string; count: number }>();
  for (const row of catalogRows) {
    if (importedCatalogIds.has(row.id)) continue;
    const identityKey = getProductIdentityKey(mapCatalogRowToProduct(row));
    if (identityKey && importedProductKeys.has(identityKey)) continue;
    const company = row.pharmaceutical_company.trim();
    if (!company || company === "-") continue;
    const normalizedCompany = company.toLocaleLowerCase();
    const current = companyCounts.get(normalizedCompany);
    companyCounts.set(normalizedCompany, { name: current?.name ?? company, count: (current?.count ?? 0) + 1 });
  }
  const availableCompanies = [...companyCounts.values()].sort((left, right) => left.name.localeCompare(right.name));
  const effectiveSelectedCompany = availableCompanies.some((company) => company.name === selectedCompany)
    ? selectedCompany
    : "";
  const nextProductId = createProductId(products);
  const progressPercentage = importProgress.total
    ? Math.round((importProgress.checked / importProgress.total) * 100)
    : 0;

  function rememberSuggestion(field: SuggestionField, value: string) {
    const cleanValue = value.trim();
    if (!cleanValue) return;
    setSuggestions((current) => current[field].includes(cleanValue)
      ? current
      : { ...current, [field]: [...current[field], cleanValue] });
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: keyof Omit<Product, "id">) => String(form.get(name) ?? "").trim();
    const productFields: ProductImportCandidate = {
      medicineName: value("medicineName"),
      brand: value("brand"),
      genericName: value("genericName"),
      manufacturer: value("manufacturer"),
      productType: value("productType"),
      category: value("category"),
      dosageForm: value("dosageForm"),
      strength: value("strength"),
      packSize: value("packSize"),
      unit: value("unit"),
      barcode: value("barcode"),
    };
    const identityKey = getProductIdentityKey(productFields);
    if (identityKey && products.some((existing) => getProductIdentityKey(existing) === identityKey)) {
      setAddProductError("This product already exists with the same name, strength, dosage form, and manufacturer.");
      return;
    }
    const nameKey = getProductNameKey(productFields);
    if (products.some((existing) => getProductNameKey(existing) === nameKey && !getProductIdentityKey(existing))) {
      setAddProductError("A product with this name has incomplete identity details. Resolve that record before adding another.");
      return;
    }
    if (!pharmacyUserId) {
      setAddProductError("Could not verify the signed-in pharmacy account.");
      return;
    }

    const product: Product = { ...productFields, id: nextProductId };
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .insert(mapProductToPharmacyRow(product, pharmacyUserId))
      .select("*")
      .single();

    if (error) {
      setAddProductError(error.message);
      return;
    }

    const savedProduct = mapPharmacyRowToProduct(data as PharmacyProductRow);
    setAddProductError("");
    setProducts((current) => [savedProduct, ...current]);
    rememberSuggestion("dosageForm", savedProduct.dosageForm);
    rememberSuggestion("strength", savedProduct.strength);
    rememberSuggestion("packSize", savedProduct.packSize);
    rememberSuggestion("barcode", savedProduct.barcode);
    setIsAddOpen(false);
  }

  async function processCsvText(csvText: string) {
    if (csvText.length > 10 * 1024 * 1024) {
      throw new Error("CSV is larger than 10 MB. Split it into smaller files and import them separately.");
    }

    setImportProgress({ phase: "Reading CSV", checked: 0, total: 0 });
    const parsed = parseProductCsv(csvText);
    if (parsed.rows.length === 0) {
      throw new Error("No rows with a product name were found in this CSV.");
    }
    if (parsed.rows.length > 20000) {
      throw new Error("This CSV has more than 20,000 product rows. Split it into smaller files before importing.");
    }

    setImportWarnings(parsed.warnings);
    setImportProgress({ phase: "Checking products", checked: 0, total: parsed.rows.length });

    const knownProducts = [...products];
    const newProducts: Product[] = [];
    const newReviews: ImportReview[] = [];
    let duplicateCount = 0;

    for (const [index, candidate] of parsed.rows.entries()) {
      const candidateKey = getProductIdentityKey(candidate);
      const nameKey = getProductNameKey(candidate);
      const sameName = knownProducts.filter((product) => getProductNameKey(product) === nameKey);
      const exactDuplicate = candidateKey && sameName.some((product) => getProductIdentityKey(product) === candidateKey);

      if (exactDuplicate) {
        duplicateCount += 1;
      } else if (!candidateKey) {
        newReviews.push({
          key: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          product: candidate,
          reason: "Strength, dosage form, and manufacturer are required to finish duplicate validation before adding this product.",
        });
      } else if (sameName.some((product) => !getProductIdentityKey(product))) {
        newReviews.push({
          key: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          product: candidate,
          reason: "A product with this name exists, but strength, dosage form, or manufacturer is missing. Complete these fields to verify it.",
        });
      } else {
        const product: Product = { ...candidate, id: createProductId(knownProducts) };
        knownProducts.push(product);
        newProducts.push(product);
      }

      const checked = index + 1;
      if (checked % 25 === 0 || checked === parsed.rows.length) {
        setImportProgress({ phase: "Checking products", checked, total: parsed.rows.length });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
    }

    let savedProducts: Product[] = [];
    if (newProducts.length) {
      if (!pharmacyUserId) throw new Error("Could not verify the signed-in pharmacy account.");
      const { data, error } = await supabase
        .from("pharmacy_catalog_products")
        .insert(newProducts.map((product) => mapProductToPharmacyRow(product, pharmacyUserId)))
        .select("*");
      if (error) throw error;
      savedProducts = ((data ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
      setProducts((current) => [...savedProducts, ...current]);
    }
    if (newReviews.length) setImportReviews((current) => [...newReviews, ...current]);
    setImportSummary({ added: newProducts.length, duplicates: duplicateCount });
    setImportProgress({ phase: "Import complete", checked: parsed.rows.length, total: parsed.rows.length });
  }

  async function importSelectedCompany() {
    if (isImporting || !storageReady || !effectiveSelectedCompany || !pharmacyUserId) return;
    setIsImporting(true);
    setImportError("");
    setImportWarnings([]);
    setImportReviews([]);
    setImportProgress({ phase: "Loading company products", checked: 0, total: 0 });
    try {
      const { data, error } = await supabase
        .from("admin_medicine_catalog")
        .select("*")
        .eq("pharmaceutical_company", effectiveSelectedCompany)
        .order("serial_number");

      if (error) throw error;

      const rows = (data ?? []) as CatalogProductRow[];
      const knownProducts = [...products];
      const productsToInsert: Product[] = [];
      let addedCount = 0;
      let duplicateCount = 0;

      for (const row of rows) {
        if (knownProducts.some((existing) => existing.sourceCatalogId === row.id) || productsToInsert.some((product) => product.sourceCatalogId === row.id)) {
          duplicateCount++;
          continue;
        }

        const catalogProduct = mapCatalogRowToProduct(row);
        const identityKey = getProductIdentityKey(catalogProduct);
        const matchingProduct = identityKey
          ? knownProducts.find((existing) => getProductIdentityKey(existing) === identityKey)
          : undefined;

        if (matchingProduct) {
          if (!matchingProduct.sourceCatalogId) {
            const { error: linkError } = await supabase
              .from("pharmacy_catalog_products")
              .update({ source_catalog_id: row.id })
              .eq("owner_user_id", pharmacyUserId)
              .eq("id", matchingProduct.id);
            if (linkError) throw linkError;
            matchingProduct.sourceCatalogId = row.id;
          }
          duplicateCount++;
          continue;
        }

        productsToInsert.push({
          ...catalogProduct,
          id: createProductId([...knownProducts, ...productsToInsert]),
        });
      }

      let savedProducts: Product[] = [];
      if (productsToInsert.length) {
        const { data: savedRows, error: saveError } = await supabase
          .from("pharmacy_catalog_products")
          .insert(productsToInsert.map((product) => mapProductToPharmacyRow(product, pharmacyUserId)))
          .select("*");
        if (saveError) throw saveError;
        savedProducts = ((savedRows ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
        addedCount = savedProducts.length;
      }

      setProducts([...knownProducts, ...savedProducts]);
      setCatalogRows((current) => {
        const existingIds = new Set(current.map((row) => row.id));
        return [...current, ...rows.filter((row) => !existingIds.has(row.id))];
      });
      setImportSummary({ added: addedCount, duplicates: duplicateCount });
      setImportProgress({ phase: "Import complete", checked: rows.length, total: rows.length });
    } catch (error) {
      setImportError(getErrorMessage(error));
      setImportProgress({ phase: "Import failed", checked: 0, total: 0 });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || isImporting || !storageReady) return;
    setIsImporting(true);
    setImportError("");
    setImportWarnings([]);
    try {
      await processCsvText(await file.text());
    } catch (error) {
      setImportError(getErrorMessage(error));
      setImportProgress({ phase: "Import failed", checked: 0, total: 0 });
    } finally {
      setIsImporting(false);
    }
  }

  function editReviewField(key: string, field: keyof ProductImportCandidate, value: string) {
    setImportReviews((current) => current.map((review) => review.key === key
      ? { ...review, product: { ...review.product, [field]: value }, error: undefined }
      : review));
  }

  async function finishReview(key: string, addProductToList: boolean) {
    const review = importReviews.find((item) => item.key === key);
    if (!review) return;

    if (!addProductToList) {
      setImportReviews((current) => current.filter((item) => item.key !== key));
      return;
    }

    const identityKey = getProductIdentityKey(review.product);
    if (!identityKey) {
      setImportReviews((current) => current.map((item) => item.key === key
        ? { ...item, error: "Enter product name, strength, dosage form, and manufacturer to finish duplicate validation." }
        : item));
      return;
    }

    const sameName = products.filter((product) => getProductNameKey(product) === getProductNameKey(review.product));
    if (sameName.some((product) => !getProductIdentityKey(product))) {
      setImportReviews((current) => current.map((item) => item.key === key
        ? { ...item, error: "An existing product with this name also has incomplete details. Update it first, then retry." }
        : item));
      return;
    }
    if (sameName.some((product) => getProductIdentityKey(product) === identityKey)) {
      setImportReviews((current) => current.filter((item) => item.key !== key));
      setImportSummary((current) => ({ ...current, duplicates: current.duplicates + 1 }));
      return;
    }

    if (!pharmacyUserId) {
      setImportReviews((current) => current.map((item) => item.key === key
        ? { ...item, error: "Could not verify the signed-in pharmacy account." }
        : item));
      return;
    }

    const product: Product = { ...review.product, id: createProductId(products) };
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .insert(mapProductToPharmacyRow(product, pharmacyUserId))
      .select("*")
      .single();
    if (error) {
      setImportReviews((current) => current.map((item) => item.key === key
        ? { ...item, error: error.message }
        : item));
      return;
    }

    setProducts((current) => [mapPharmacyRowToProduct(data as PharmacyProductRow), ...current]);
    setImportReviews((current) => current.filter((item) => item.key !== key));
    setImportSummary((current) => ({ ...current, added: current.added + 1 }));
  }

  function closeModal() {
    setIsAddOpen(false);
    setSelectedProduct(null);
  }

  return (
    <div style={{ minHeight: adminMode ? "auto" : "100vh", background: adminMode ? "transparent" : "#f8f8f7", color: "#202624", fontFamily: adminMode ? "inherit" : "Inter, Arial, sans-serif" }}>
      {!adminMode && <ProductManagementHeader />}
      <div style={{ display: "flex", minHeight: adminMode ? "auto" : "calc(100vh - 62px)" }}>
        {!adminMode && <Sidebar />}
        <main style={{ flex: 1, minWidth: 0, width: adminMode ? "100%" : undefined, maxWidth: adminMode ? 1440 : undefined, margin: adminMode ? "0 auto" : undefined, padding: adminMode ? "28px clamp(16px, 3vw, 38px) 44px" : "32px clamp(18px, 4vw, 48px) 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: adminMode ? "flex-end" : "flex-start", gap: 20, flexWrap: "wrap", marginBottom: adminMode ? 22 : 24 }}>
            <div>
              <div style={{ color: adminMode ? "#78867f" : "#72807b", fontSize: adminMode ? 11 : 12, marginBottom: adminMode ? 6 : 8 }}>{adminMode ? "Admin / Analytics" : "Pharmacy / Product Management"}</div>
              <h1 style={{ margin: 0, color: adminMode ? "#1d2c25" : "#172622", fontSize: adminMode ? 26 : 30, lineHeight: 1.2, fontWeight: 750 }}>{adminMode ? "Product Data Import" : "Product Management"}</h1>
              <p style={{ margin: adminMode ? "7px 0 0" : "8px 0 0", color: adminMode ? "#78867f" : "#6a7973", fontSize: adminMode ? 12 : 14 }}>{adminMode ? "Import, validate, search, and manage the shared product catalog." : "Manage your pharmacy catalog, prices, and product availability."}</p>
            </div>
            <button type="button" disabled={isImporting || !storageReady} onClick={() => { setAddProductError(""); setIsAddOpen(true); }} style={{ border: 0, borderRadius: 7, background: isImporting || !storageReady ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: isImporting || !storageReady ? "not-allowed" : "pointer" }}>
              + Add product
            </button>
          </div>

          <section aria-label="Import products" style={{ marginBottom: 18, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Import product data</h2>
              <p style={{ margin: "5px 0 0", color: "#6a7973", fontSize: 11 }}>Choose a manufacturer to add its shared catalog products to your pharmacy list.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "14px 18px" }}>
              {!adminMode && (
                <>
                  <label style={{ display: "grid", gap: 5, color: "#526158", fontSize: 11 }}>
                    Manufacturer / company
                    <select aria-label="Select manufacturer or company" value={effectiveSelectedCompany} onChange={(event) => setSelectedCompany(event.target.value)} disabled={isLoadingCompanies || isImporting || !availableCompanies.length} style={{ minWidth: 260, maxWidth: "min(560px, 80vw)", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", padding: "9px 10px", color: "#26352f", fontSize: 12 }}>
                      <option value="">{isLoadingCompanies ? "Loading manufacturers..." : availableCompanies.length ? "Select manufacturer" : "No new products available"}</option>
                      {availableCompanies.map((company) => <option key={company.name} value={company.name}>{company.name} ({company.count} new)</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany} onClick={() => void importSelectedCompany()} style={{ alignSelf: "end", border: 0, borderRadius: 6, background: isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 13px", fontSize: 12, fontWeight: 650, cursor: isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany ? "not-allowed" : "pointer" }}>{isImporting ? "Importing..." : "Import company products"}</button>
                </>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#315444", padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: isImporting ? "not-allowed" : "pointer" }}>
                Upload CSV
                <input aria-label="Upload CSV file" type="file" accept=".csv,text/csv" disabled={isImporting || !storageReady} onChange={(event) => void handleCsvUpload(event)} style={{ display: "none" }} />
              </label>
            </div>

            {(isImporting || importProgress.phase) && (
              <div aria-live="polite" style={{ padding: "0 18px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, color: "#5f7066", fontSize: 10 }}>
                  <span>{importProgress.phase || "Preparing import"}</span>
                  <strong>{progressPercentage}%{importProgress.total ? ` · ${importProgress.checked}/${importProgress.total} rows` : ""}</strong>
                </div>
                <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercentage} style={{ height: 7, overflow: "hidden", borderRadius: 5, background: "#eaf0ec" }}>
                  <div style={{ width: `${progressPercentage}%`, height: "100%", borderRadius: 5, background: importError ? "#d36b61" : "#27a879", transition: "width 0.15s ease" }} />
                </div>
                {importProgress.phase === "Import complete" && <p style={{ margin: "7px 0 0", color: "#64736b", fontSize: 10 }}>Added {importSummary.added} · Duplicates skipped {importSummary.duplicates} · Needs review {importReviews.length}</p>}
              </div>
            )}
            {importError && <p role="alert" style={{ margin: "0 18px 14px", color: "#ad4b43", fontSize: 11 }}>{importError}</p>}
            {importWarnings.length > 0 && <p style={{ margin: "0 18px 14px", color: "#92621b", fontSize: 10 }}>{importWarnings.slice(0, 3).join(" ")}{importWarnings.length > 3 ? ` And ${importWarnings.length - 3} more CSV warnings.` : ""}</p>}
          </section>

          {importReviews.length > 0 && (
            <section aria-label="Products needing duplicate review" style={{ marginBottom: 18, border: "1px solid #eadab9", borderRadius: 8, background: "#fffdf8", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1e8d5" }}>
                <h2 style={{ margin: 0, color: "#634b22", fontSize: 14, fontWeight: 700 }}>Review possible duplicates ({importReviews.length})</h2>
                <p style={{ margin: "5px 0 0", color: "#89734d", fontSize: 10 }}>Complete the missing identity fields. The row is not added until duplicate validation passes.</p>
              </div>
              <div style={{ display: "grid", gap: 10, padding: 14 }}>
                {importReviews.map((review) => (
                  <article key={review.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", alignItems: "end", gap: 9, padding: 12, border: "1px solid #f0e6d3", borderRadius: 6, background: "#fff" }}>
                    {(["medicineName", "strength", "dosageForm", "manufacturer"] as const).map((field) => (
                      <label key={field} style={{ display: "grid", gap: 5, color: "#69776f", fontSize: 9 }}>
                        {field === "medicineName" ? "Product name" : field === "dosageForm" ? "Dosage form" : field === "manufacturer" ? "Manufacturer" : "Strength"}
                        <input value={review.product[field]} onChange={(event) => editReviewField(review.key, field, event.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 5, padding: "7px 8px", color: "#34453b", fontSize: 10 }} />
                      </label>
                    ))}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => finishReview(review.key, true)} style={{ border: 0, borderRadius: 5, background: "#179c70", color: "#fff", padding: "7px 9px", fontSize: 10, fontWeight: 650, cursor: "pointer" }}>Validate &amp; add</button>
                      <button type="button" onClick={() => finishReview(review.key, false)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#526158", padding: "7px 9px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Skip</button>
                    </div>
                    <p style={{ gridColumn: "1 / -1", margin: 0, color: review.error ? "#ad4b43" : "#89734d", fontSize: 9 }}>{review.error || review.reason}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Product list <span style={{ color: "#8a9690", fontSize: 12, fontWeight: 500 }}>({products.length})</span></h2>
              <input aria-label="Search products" placeholder="Search products..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} style={{ width: 240, maxWidth: "100%", border: "1px solid #e0e6e1", borderRadius: 6, padding: "8px 10px", color: "#26352f", fontSize: 12, outlineColor: "#28a879" }} />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1480, textAlign: "left" }}>
                <thead>
                  <tr>
                    {["SL / Serial Number", "Internal Product ID Number", "Pharmaceutical Company", "Brand Name", "Generic Name", "Strength", "Dosage Form / Description", "Retail Price", "Usage Type", "DAR Code", "Medicine Type/Category", "Registration Information", "Action"].map((column) => (
                      <th key={column} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id}>
                      {[product.serialNumber || "-", product.id, product.manufacturer, product.brand, product.genericName, product.strength, product.dosageForm, product.retailPrice || "-", product.usageType || product.productType, product.darCode || product.barcode || "-", product.medicineTypeCategory || product.category, product.registrationInformation || "-"].map((cell, index) => (
                        <td key={`${product.id}-${index}`} style={{ padding: "13px", borderBottom: "1px solid #f0f2f0", color: index < 2 ? "#26352f" : "#687871", fontSize: 12, fontWeight: index < 2 ? 600 : 400, whiteSpace: "nowrap" }}>{cell || "—"}</td>
                      ))}
                      <td style={{ padding: "13px", borderBottom: "1px solid #f0f2f0" }}>
                        <button type="button" onClick={() => setSelectedProduct(product)} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#227553", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Details</button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={13} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                        {searchTerm ? "No products match your search." : "No products yet. Select Add product to create your first item."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 16px", color: "#87928c", fontSize: 11 }}>Showing {filteredProducts.length} of {products.length} products</div>
          </section>
        </main>
      </div>

      {isAddOpen && (
        <div onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }} style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="add-product-title" style={{ width: "min(760px, 100%)", maxHeight: "min(90vh, 820px)", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea", background: "#fff" }}>
              <div>
                <h2 id="add-product-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Add product</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Enter medicine details to add it to your product list.</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <form onSubmit={addProduct}>
              {addProductError && <p role="alert" style={{ margin: "14px 24px 0", color: "#ad4b43", fontSize: 12 }}>{addProductError}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, padding: 24 }}>
                <FormField label="Product ID (Auto)"><input name="productId" value={nextProductId} readOnly style={{ ...fieldStyle, background: "#f5f8f5", color: "#75847a" }} /></FormField>
                <FormField label="Medicine Name"><input name="medicineName" required autoFocus placeholder="e.g. Paracetamol 500mg" style={fieldStyle} /></FormField>
                <FormField label="Brand"><input name="brand" required placeholder="Brand name" style={fieldStyle} /></FormField>
                <FormField label="Generic Name"><input name="genericName" required placeholder="Generic medicine name" style={fieldStyle} /></FormField>
                <FormField label="Manufacturer/Company"><input name="manufacturer" required placeholder="Manufacturer or company" style={fieldStyle} /></FormField>
                <FormField label="Product Type"><input name="productType" required placeholder="e.g. Medicine" style={fieldStyle} /></FormField>
                <FormField label="Category"><input name="category" required placeholder="e.g. Pain relief" style={fieldStyle} /></FormField>
                <FormField label="Dosage Form">
                  <input name="dosageForm" list="dosage-form-options" required placeholder="Choose or enter a dosage form" onBlur={(event) => rememberSuggestion("dosageForm", event.currentTarget.value)} style={fieldStyle} />
                  <datalist id="dosage-form-options">{suggestions.dosageForm.map((option) => <option key={option} value={option} />)}</datalist>
                </FormField>
                <FormField label="Strength">
                  <input name="strength" list="strength-options" required placeholder="Choose or enter strength" onBlur={(event) => rememberSuggestion("strength", event.currentTarget.value)} style={fieldStyle} />
                  <datalist id="strength-options">{suggestions.strength.map((option) => <option key={option} value={option} />)}</datalist>
                </FormField>
                <FormField label="Pack Size">
                  <input name="packSize" list="pack-size-options" required placeholder="Choose or enter pack size" onBlur={(event) => rememberSuggestion("packSize", event.currentTarget.value)} style={fieldStyle} />
                  <datalist id="pack-size-options">{suggestions.packSize.map((option) => <option key={option} value={option} />)}</datalist>
                </FormField>
                <FormField label="Unit">
                  <select name="unit" required defaultValue="" style={fieldStyle}>
                    <option value="" disabled>Select unit</option>
                    {["Tablet", "Box", "Bottle", "Strip"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </FormField>
                <FormField label="Barcode/GTIN">
                  <input name="barcode" list="barcode-options" placeholder="Choose or enter barcode" onBlur={(event) => rememberSuggestion("barcode", event.currentTarget.value)} style={fieldStyle} />
                  <datalist id="barcode-options">{suggestions.barcode.map((option) => <option key={option} value={option} />)}</datalist>
                </FormField>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                <button type="button" onClick={closeModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Save product</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedProduct && (
        <div onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }} style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="product-details-title" style={{ width: "min(600px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="product-details-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Product details</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>{selectedProduct.id} · {selectedProduct.medicineName}</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 0, margin: 0, padding: "8px 24px 18px" }}>
              {([
                ["Product ID", selectedProduct.id],
                ["Medicine Name", selectedProduct.medicineName],
                ["Brand", selectedProduct.brand],
                ["Generic Name", selectedProduct.genericName],
                ["Manufacturer/Company", selectedProduct.manufacturer],
                ["Product Type", selectedProduct.productType],
                ["Category", selectedProduct.category],
                ["Dosage Form", selectedProduct.dosageForm],
                ["Strength", selectedProduct.strength],
                ["Pack Size", selectedProduct.packSize],
                ["Unit", selectedProduct.unit],
                ["Barcode/GTIN", selectedProduct.barcode || "Not provided"],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ padding: "13px 10px 13px 0", borderBottom: "1px solid #edf0ed" }}>
                  <dt style={{ color: "#7a8981", fontSize: 11 }}>{label}</dt>
                  <dd style={{ margin: "5px 0 0", color: "#26372f", fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{value}</dd>
                </div>
              ))}
            </dl>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <button type="button" onClick={closeModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}