'use client';

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Sidebar from "../components/Sidebar";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";
import { supabase } from "@/lib/supabase/client";
import { ProductDocumentCapture, ProductDocumentLinks } from "./ProductDocumentCapture";
import {
  deleteProductDocuments,
  getProductDocuments,
  saveProductDocuments,
  type ProductDocument,
} from "./productDocuments";
import {
  getProductIdentityKey,
  getProductNameKey,
  type ProductImportCandidate,
} from "./productImport";
import type { ProductInformation } from "@/lib/ocr/productInfoExtractor";

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
type CatalogCompany = { name: string; count: number };
type ProductFormValues = {
  manufacturer: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  retailPrice: string;
  usageType: string;
  darCode: string;
  medicineTypeCategory: string;
  registrationInformation: string;
};
const CATALOG_PAGE_SIZE = 1000;
const IMPORT_BATCH_SIZE = 500;
const DEFAULT_PRODUCT_PAGE_SIZE = 25;

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

function createProductId() {
  return `MED-${globalThis.crypto.randomUUID().toUpperCase()}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const details = error as Record<string, unknown>;
    const parts = ["message", "details", "hint", "code"]
      .map((key) => details[key])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (parts.length) return parts.join(" · ");
  }
  return "Import failed with an unrecognized error. Check the browser console for details.";
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

async function loadAllCatalogRows(company?: string) {
  const rows: CatalogProductRow[] = [];
  for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
    let query = supabase.from("admin_medicine_catalog").select("*");
    if (company) query = query.eq("pharmaceutical_company", company);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(offset, offset + CATALOG_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as CatalogProductRow[];
    rows.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) return rows;
  }
}

async function loadCatalogCompanies(): Promise<CatalogCompany[]> {
  const { data, error } = await supabase.rpc("get_admin_catalog_manufacturers");
  if (error) throw error;
  return ((data ?? []) as { pharmaceutical_company: string; product_count: number }[])
    .map((row) => ({ name: row.pharmaceutical_company, count: Number(row.product_count) }))
    .filter((company) => company.count > 0);
}

async function loadPharmacyProductPage(ownerUserId: string, page: number, pageSize: number, searchTerm: string) {
  let query = supabase
    .from("pharmacy_catalog_products")
    .select("*", { count: "exact" })
    .eq("owner_user_id", ownerUserId);
  const search = searchTerm.trim().replace(/[\\%_,()]/g, (character) => `\\${character}`);
  if (search) {
    const columns = [
      "id", "serial_number", "medicine_name", "brand", "generic_name", "manufacturer",
      "product_type", "category", "dosage_form", "strength", "pack_size", "unit",
      "barcode", "retail_price", "usage_type", "dar_code", "medicine_type_category",
      "registration_information",
    ];
    query = query.or(columns.map((column) => `${column}.ilike.%${search}%`).join(","));
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  return {
    products: ((data ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct),
    count: count ?? 0,
  };
}

async function loadAllPharmacyProducts(ownerUserId: string) {
  const rows: PharmacyProductRow[] = [];
  for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("id", { ascending: true })
      .range(offset, offset + CATALOG_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as PharmacyProductRow[];
    rows.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) return rows.map(mapPharmacyRowToProduct);
  }
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
  const [isManualImportOpen, setIsManualImportOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedProductDocuments, setSelectedProductDocuments] = useState<ProductDocument[]>([]);
  const [isLoadingProductDocuments, setIsLoadingProductDocuments] = useState(false);
  const [productDocumentsError, setProductDocumentsError] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [savingProductId, setSavingProductId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PRODUCT_PAGE_SIZE);
  const [totalProductCount, setTotalProductCount] = useState(0);
  const [nextProductId, setNextProductId] = useState("");
  const [nextSerialNumber, setNextSerialNumber] = useState("");
  const [isPreparingProduct, setIsPreparingProduct] = useState(false);
  const [addProductError, setAddProductError] = useState("");
  const [productDocuments, setProductDocuments] = useState<File[]>([]);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ phase: "", checked: 0, total: 0 });
  const [importSummary, setImportSummary] = useState({ added: 0, duplicates: 0 });
  const [importError, setImportError] = useState("");
  const [availableCompanies, setAvailableCompanies] = useState<CatalogCompany[]>([]);
  const [totalCatalogCount, setTotalCatalogCount] = useState(0);
  const [pharmacyUserId, setPharmacyUserId] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const initialQueryKey = useRef("");
  const productQuerySequence = useRef(0);
  const editRowRef = useRef<HTMLTableRowElement | null>(null);
  const savingProductRef = useRef(false);
  const savingNewProductRef = useRef(false);
  const assignEditRowRef = useCallback((node: HTMLTableRowElement | null) => {
    editRowRef.current = node;
  }, []);

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

        const localProductsRaw = localStorage.getItem(storageKeys.products);
        const parsedLocalProducts: Product[] = localProductsRaw
          ? (JSON.parse(localProductsRaw) as Product[])
          : [];

        setPharmacyUserId(user.id);
        let sharedCatalog: CatalogProductRow[] | undefined;

        if (parsedLocalProducts.length) {
          const knownProducts = await loadAllPharmacyProducts(user.id);
          sharedCatalog = await loadAllCatalogRows();
          const productsToMigrate: Product[] = [];

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
              id: knownProducts.some((product) => product.id === localProduct.id) ? createProductId() : localProduct.id,
              sourceCatalogId: localProduct.sourceCatalogId ?? matchingCatalogRow?.id,
            };
            productsToMigrate.push(productToSave);
            knownProducts.push(productToSave);
          }

          if (productsToMigrate.length) {
            const { error } = await supabase
              .from("pharmacy_catalog_products")
              .upsert(productsToMigrate.map((product) => mapProductToPharmacyRow(product, user.id)), { onConflict: "owner_user_id,id" });
            if (error) throw error;
            localStorage.removeItem(storageKeys.products);
          }
        }

        const firstPage = await loadPharmacyProductPage(user.id, 1, DEFAULT_PRODUCT_PAGE_SIZE, "");
        if (!active) return;
        setProducts(firstPage.products);
        setTotalProductCount(firstPage.count);
        setStorageReady(true);
        initialQueryKey.current = `${user.id}:1:${DEFAULT_PRODUCT_PAGE_SIZE}:`;

        void loadCatalogCompanies()
          .then((companies) => {
            if (!active) return;
            setAvailableCompanies(companies);
            setTotalCatalogCount(companies.reduce((total, company) => total + company.count, 0));
          })
          .catch((error: unknown) => {
            if (active) setImportError(getErrorMessage(error));
          })
          .finally(() => {
            if (active) setIsLoadingCompanies(false);
          });
      } catch (error) {
        if (active) {
          setImportError(getErrorMessage(error));
          setIsLoadingCompanies(false);
        }
      } finally {
        if (active) setStorageReady(true);
      }
    }

    if (!adminMode) void loadPharmacyProducts();

    return () => {
      active = false;
      window.clearTimeout(suggestionsHydration);
    };
  }, [adminMode]);

  useEffect(() => {
    if (!pharmacyUserId || !initialQueryKey.current) return;
    const queryKey = `${pharmacyUserId}:${currentPage}:${pageSize}:${searchTerm.trim()}`;
    if (queryKey === initialQueryKey.current) return;
    const sequence = ++productQuerySequence.current;
    let active = true;
    const timeout = window.setTimeout(() => {
      void loadPharmacyProductPage(pharmacyUserId, currentPage, pageSize, searchTerm)
        .then((result) => {
          if (!active || sequence !== productQuerySequence.current) return;
          setProducts(result.products);
          setTotalProductCount(result.count);
          const lastPage = Math.max(1, Math.ceil(result.count / pageSize));
          if (currentPage > lastPage) setCurrentPage(lastPage);
          initialQueryKey.current = queryKey;
        })
        .catch((error: unknown) => {
          if (active && sequence === productQuerySequence.current) setImportError(getErrorMessage(error));
        });
    }, searchTerm ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [pharmacyUserId, currentPage, pageSize, searchTerm]);

  useEffect(() => {
    if (adminMode || !pharmacyUserId) return;

    let active = true;
    let refreshTimeout: number | undefined;
    const refreshAvailableCompanies = () => {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        void loadCatalogCompanies()
          .then((companies) => {
            if (!active) return;
            setAvailableCompanies(companies);
            setTotalCatalogCount(companies.reduce((total, company) => total + company.count, 0));
            setImportError("");
          })
          .catch((error: unknown) => {
            if (active) setImportError(getErrorMessage(error));
          });
      }, 250);
    };
    const channel = supabase
      .channel(`admin-catalog-${pharmacyUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_medicine_catalog" },
        refreshAvailableCompanies,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pharmacy_catalog_products", filter: `owner_user_id=eq.${pharmacyUserId}` },
        refreshAvailableCompanies,
      )
      .subscribe((status, error) => {
        if (!active) return;
        if (status === "SUBSCRIBED") refreshAvailableCompanies();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setImportError(`Live catalog updates are unavailable${error?.message ? `: ${error.message}` : "."}`);
        }
      });

    return () => {
      active = false;
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [adminMode, pharmacyUserId]);

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
      if (event.key === "Escape" && !isSavingProduct) {
        if (isManualImportOpen) {
          setIsManualImportOpen(false);
        } else {
          setIsAddOpen(false);
          setSelectedProduct(null);
          setSelectedProductDocuments([]);
          setProductDocumentsError("");
          setIsLoadingProductDocuments(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAddOpen, isManualImportOpen, isSavingProduct, selectedProduct]);

  useEffect(() => {
    if (!selectedProduct) return;

    let active = true;
    void getProductDocuments(selectedProduct.id)
      .then((documents) => {
        if (active) setSelectedProductDocuments(documents);
      })
      .catch((error: unknown) => {
        if (active) setProductDocumentsError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setIsLoadingProductDocuments(false);
      });
    return () => { active = false; };
  }, [selectedProduct]);

  const saveEditedProduct = useCallback(async () => {
    if (!editingProduct || !pharmacyUserId || savingProductRef.current) return;
    savingProductRef.current = true;
    setSavingProductId(editingProduct.id);
    setImportError("");
    try {
      const { data, error } = await supabase
        .from("pharmacy_catalog_products")
        .update({
          serial_number: editingProduct.serialNumber ?? "-",
          medicine_name: editingProduct.brand || editingProduct.genericName,
          brand: editingProduct.brand,
          generic_name: editingProduct.genericName,
          manufacturer: editingProduct.manufacturer,
          strength: editingProduct.strength,
          dosage_form: editingProduct.dosageForm,
          retail_price: editingProduct.retailPrice ?? "-",
          updated_at: new Date().toISOString(),
        })
        .eq("owner_user_id", pharmacyUserId)
        .eq("id", editingProduct.id)
        .select("*")
        .single();

      if (error) throw error;
      const savedProduct = mapPharmacyRowToProduct(data as PharmacyProductRow);
      setProducts((current) => current.map((product) => product.id === savedProduct.id ? savedProduct : product));
      setEditingProduct(null);
    } catch (error) {
      setImportError(`Could not save product changes: ${getErrorMessage(error)}`);
    } finally {
      savingProductRef.current = false;
      setSavingProductId("");
    }
  }, [editingProduct, pharmacyUserId]);

  useEffect(() => {
    if (!editingProduct) return;

    function saveWhenClickingOutside(event: PointerEvent) {
      if (event.target instanceof Node && !editRowRef.current?.contains(event.target)) {
        void saveEditedProduct();
      }
    }

    document.addEventListener("pointerdown", saveWhenClickingOutside, true);
    return () => document.removeEventListener("pointerdown", saveWhenClickingOutside, true);
  }, [editingProduct, saveEditedProduct]);

  async function deleteProduct(product: Product) {
    if (!pharmacyUserId || !window.confirm(`Delete ${product.brand || product.genericName || product.id} from this pharmacy's product list?`)) return;
    setImportError("");
    try {
      const { error } = await supabase
        .from("pharmacy_catalog_products")
        .delete()
        .eq("owner_user_id", pharmacyUserId)
        .eq("id", product.id);
      if (error) throw error;

      const targetPage = products.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      const refreshed = await loadPharmacyProductPage(pharmacyUserId, targetPage, pageSize, searchTerm);
      initialQueryKey.current = `${pharmacyUserId}:${targetPage}:${pageSize}:${searchTerm.trim()}`;
      setCurrentPage(targetPage);
      setProducts(refreshed.products);
      setTotalProductCount(refreshed.count);
    } catch (error) {
      setImportError(`Could not delete or refresh product: ${getErrorMessage(error)}`);
    }
  }

  const filteredProducts = products;
  const totalPages = Math.max(1, Math.ceil(totalProductCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const paginatedProducts = filteredProducts;
  const firstVisibleProduct = totalProductCount ? pageStart + 1 : 0;
  const lastVisibleProduct = Math.min(pageStart + filteredProducts.length, totalProductCount);
  const effectiveSelectedCompany = availableCompanies.some((company) => company.name === selectedCompany)
    ? selectedCompany
    : "";
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

  function updateEditingProduct(field: "manufacturer" | "brand" | "genericName" | "strength" | "dosageForm" | "retailPrice", value: string) {
    setEditingProduct((current) => current ? { ...current, [field]: value } : current);
  }

  async function openAddProduct() {
    if (!pharmacyUserId || isPreparingProduct || isImporting || !storageReady) return;
    setIsPreparingProduct(true);
    setAddProductError("");
    setIsManualImportOpen(false);
    setProductDocuments([]);
    setImportError("");
    try {
      const { data, error } = await supabase.rpc("reserve_pharmacy_product_identifiers");
      if (error) throw error;
      const identifiers = (data ?? []) as { serial_number: string; product_id: string }[];
      const reserved = identifiers[0];
      if (!reserved?.serial_number || !reserved.product_id) {
        throw new Error("The database did not return product identifiers. Apply the latest Supabase migration and retry.");
      }
      setNextSerialNumber(reserved.serial_number);
      setNextProductId(reserved.product_id);
      setIsAddOpen(true);
    } catch (error) {
      setImportError(getErrorMessage(error));
    } finally {
      setIsPreparingProduct(false);
    }
  }

  async function saveProductValues(values: ProductFormValues) {
    if (savingNewProductRef.current) return;
    savingNewProductRef.current = true;
    setIsSavingProduct(true);
    setAddProductError("");
    const value = (name: keyof ProductFormValues) => values[name].trim();
    const brand = value("brand");
    const genericName = value("genericName");
    const manufacturer = value("manufacturer");
    if (!brand || !manufacturer) {
      setAddProductError("Pharmaceutical Company and Brand Name are required.");
      setIsSavingProduct(false);
      savingNewProductRef.current = false;
      return;
    }
    const productFields: ProductImportCandidate = {
      medicineName: brand || genericName,
      brand,
      genericName,
      manufacturer,
      productType: value("usageType") || "Medicine",
      category: value("medicineTypeCategory"),
      dosageForm: value("dosageForm"),
      strength: value("strength"),
      packSize: "-",
      unit: "-",
      barcode: value("darCode"),
    };
    if (!pharmacyUserId) {
      setAddProductError("Could not verify the signed-in pharmacy account.");
      setIsSavingProduct(false);
      savingNewProductRef.current = false;
      return;
    }
    let documentsSaved = false;
    try {
      const { data: sameNameRows, error: duplicateCheckError } = await supabase
        .from("pharmacy_catalog_products")
        .select("*")
        .eq("owner_user_id", pharmacyUserId)
        .ilike("medicine_name", productFields.medicineName);
      if (duplicateCheckError) {
        setAddProductError(duplicateCheckError.message);
        return;
      }
      const sameNameProducts = ((sameNameRows ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
      const identityKey = getProductIdentityKey(productFields);
      if (identityKey && sameNameProducts.some((existing) => getProductIdentityKey(existing) === identityKey)) {
        setAddProductError("This product already exists with the same name, strength, dosage form, and manufacturer.");
        return;
      }
      const nameKey = getProductNameKey(productFields);
      if (sameNameProducts.some((existing) => getProductNameKey(existing) === nameKey && !getProductIdentityKey(existing))) {
        setAddProductError("A product with this name has incomplete identity details. Resolve that record before adding another.");
        return;
      }

      const product: Product = {
        ...productFields,
        id: nextProductId,
        serialNumber: nextSerialNumber,
        retailPrice: value("retailPrice") || "-",
        usageType: value("usageType"),
        darCode: value("darCode") || "-",
        medicineTypeCategory: value("medicineTypeCategory"),
        registrationInformation: value("registrationInformation") || "-",
      };
      await saveProductDocuments(product.id, productDocuments);
      documentsSaved = productDocuments.length > 0;

      const { data, error } = await supabase
        .from("pharmacy_catalog_products")
        .insert(mapProductToPharmacyRow(product, pharmacyUserId))
        .select("*")
        .single();

      if (error) throw new Error(error.message);

      const savedProduct = mapPharmacyRowToProduct(data as PharmacyProductRow);
      setAddProductError("");
      initialQueryKey.current = `${pharmacyUserId}:1:${pageSize}:`;
      setCurrentPage(1);
      setSearchTerm("");
      setProducts((current) => [savedProduct, ...current].slice(0, pageSize));
      setTotalProductCount((count) => count + 1);
      rememberSuggestion("dosageForm", savedProduct.dosageForm);
      rememberSuggestion("strength", savedProduct.strength);
      rememberSuggestion("packSize", savedProduct.packSize);
      rememberSuggestion("barcode", savedProduct.barcode);
      setProductDocuments([]);
      setIsAddOpen(false);
      setIsManualImportOpen(false);
    } catch (error) {
      let message = getErrorMessage(error);
      if (documentsSaved) {
        try {
          await deleteProductDocuments(nextProductId);
        } catch (cleanupError) {
          message += ` Local document cleanup also failed: ${getErrorMessage(cleanupError)}`;
        }
      }
      setAddProductError(productDocuments.length
        ? `Could not save the product and its local documents: ${message}`
        : message);
    } finally {
      setIsSavingProduct(false);
      savingNewProductRef.current = false;
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: keyof ProductFormValues) => String(form.get(name) ?? "").trim();
    await saveProductValues({
      manufacturer: value("manufacturer"),
      brand: value("brand"),
      genericName: value("genericName"),
      strength: value("strength"),
      dosageForm: value("dosageForm"),
      retailPrice: value("retailPrice"),
      usageType: value("usageType"),
      darCode: value("darCode"),
      medicineTypeCategory: value("medicineTypeCategory"),
      registrationInformation: value("registrationInformation"),
    });
  }

  async function saveExtractedProduct(information: ProductInformation) {
    await saveProductValues({
      manufacturer: information.pharmaceuticalCompany ?? "",
      brand: information.brandName ?? "",
      genericName: information.genericName ?? "",
      strength: information.strength ?? "",
      dosageForm: information.dosageFormDescription ?? "",
      retailPrice: information.retailPrice ?? "",
      usageType: "",
      darCode: "",
      medicineTypeCategory: "",
      registrationInformation: "",
    });
  }

  async function importCatalog(company?: string) {
    if (isImporting || !storageReady || !pharmacyUserId || (!company && !totalCatalogCount)) return;
    setIsImporting(true);
    setImportError("");
    setImportProgress({ phase: "Loading shared products", checked: 0, total: 0 });
    let addedCount = 0;
    try {
      const rows = await loadAllCatalogRows(company);
      if (rows.length === 0) throw new Error("No shared catalog products were found to import.");
      const knownProducts = await loadAllPharmacyProducts(pharmacyUserId);
      const importedIds = new Set(knownProducts.map((product) => product.sourceCatalogId).filter((id): id is string => Boolean(id)));
      const importedKeys = new Set(knownProducts.map(getProductIdentityKey).filter((key): key is string => Boolean(key)));
      const productsToInsert: Product[] = [];
      let duplicateCount = 0;

      for (const [index, row] of rows.entries()) {
        if (importedIds.has(row.id)) {
          duplicateCount++;
        } else {
          const catalogProduct = mapCatalogRowToProduct(row);
          const identityKey = getProductIdentityKey(catalogProduct);
          if (identityKey && importedKeys.has(identityKey)) {
            duplicateCount++;
          } else {
            productsToInsert.push({
              ...catalogProduct,
              id: createProductId(),
            });
            importedIds.add(row.id);
            if (identityKey) importedKeys.add(identityKey);
          }
        }

        if ((index + 1) % 100 === 0 || index + 1 === rows.length) {
          setImportProgress({ phase: "Checking catalog products", checked: index + 1, total: rows.length });
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      }

      setImportProgress({ phase: "Saving products", checked: 0, total: productsToInsert.length });
      for (let offset = 0; offset < productsToInsert.length; offset += IMPORT_BATCH_SIZE) {
        const batch = productsToInsert.slice(offset, offset + IMPORT_BATCH_SIZE);
        const { data: savedRows, error: saveError } = await supabase
          .from("pharmacy_catalog_products")
          .insert(batch.map((product) => mapProductToPharmacyRow(product, pharmacyUserId)))
          .select("*");
        if (saveError) throw saveError;
        const savedProducts = ((savedRows ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
        if (savedProducts.length !== batch.length) {
          throw new Error(`Only ${savedProducts.length} of ${batch.length} products in this batch were saved.`);
        }
        addedCount += savedProducts.length;
        setTotalProductCount((count) => count + savedProducts.length);
        setImportProgress({ phase: "Saving products", checked: addedCount, total: productsToInsert.length });
      }

      setImportSummary({ added: addedCount, duplicates: duplicateCount });
      setImportProgress({ phase: "Import complete", checked: rows.length, total: rows.length });
      const refreshed = await loadPharmacyProductPage(pharmacyUserId, 1, pageSize, "");
      initialQueryKey.current = `${pharmacyUserId}:1:${pageSize}:`;
      setCurrentPage(1);
      setSearchTerm("");
      setProducts(refreshed.products);
      setTotalProductCount(refreshed.count);
    } catch (error) {
      console.error("Product catalog import failed:", error);
      const message = getErrorMessage(error);
      setImportError(addedCount
        ? `${message} ${addedCount} product(s) were saved before the import stopped.`
        : message);
      setImportProgress({ phase: "Import failed", checked: addedCount, total: 0 });
    } finally {
      setIsImporting(false);
    }
  }

  function closeModal() {
    if (isSavingProduct) return;
    setIsAddOpen(false);
    setIsManualImportOpen(false);
    setSelectedProduct(null);
    setProductDocuments([]);
    setSelectedProductDocuments([]);
    setProductDocumentsError("");
    setIsLoadingProductDocuments(false);
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
            <button type="button" disabled={isImporting || !storageReady || isPreparingProduct} onClick={() => void openAddProduct()} style={{ border: 0, borderRadius: 7, background: isImporting || !storageReady || isPreparingProduct ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: isImporting || !storageReady || isPreparingProduct ? "not-allowed" : "pointer" }}>
              {isPreparingProduct ? "Preparing..." : "+ Add product"}
            </button>
          </div>

          <section aria-label="Import products" style={{ marginBottom: 18, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Import product data</h2>
              <p style={{ margin: "5px 0 0", color: "#6a7973", fontSize: 11 }}>Import one manufacturer or add every product from the shared catalog to your pharmacy list.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "14px 18px" }}>
              {!adminMode && (
                <>
                  <label style={{ display: "grid", gap: 5, color: "#526158", fontSize: 11 }}>
                    Manufacturer / company
                    <select aria-label="Select manufacturer or company" value={effectiveSelectedCompany} onChange={(event) => setSelectedCompany(event.target.value)} disabled={isLoadingCompanies || isImporting || !availableCompanies.length} style={{ minWidth: 260, maxWidth: "min(560px, 80vw)", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", padding: "9px 10px", color: "#26352f", fontSize: 12 }}>
                      <option value="">{isLoadingCompanies ? "Loading manufacturers..." : availableCompanies.length ? "Select manufacturer" : "No new products available"}</option>
                      {availableCompanies.map((company) => <option key={company.name} value={company.name}>{company.name} ({company.count} products)</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany} onClick={() => void importCatalog(effectiveSelectedCompany)} style={{ alignSelf: "end", border: 0, borderRadius: 6, background: isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 13px", fontSize: 12, fontWeight: 650, cursor: isImporting || !storageReady || isLoadingCompanies || !effectiveSelectedCompany ? "not-allowed" : "pointer" }}>{isImporting ? "Importing..." : "Import company products"}</button>
                </>
              )}
              {!adminMode && (
                <button
                  type="button"
                  disabled={isImporting || !storageReady || isLoadingCompanies || totalCatalogCount === 0}
                  onClick={() => void importCatalog()}
                  style={{ alignSelf: "end", border: 0, borderRadius: 6, background: isImporting || !storageReady || isLoadingCompanies || totalCatalogCount === 0 ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 13px", fontSize: 12, fontWeight: 650, cursor: isImporting || !storageReady || isLoadingCompanies || totalCatalogCount === 0 ? "not-allowed" : "pointer" }}
                >
                  {isImporting ? "Importing..." : "All Data Import"}
                </button>
              )}
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
                {importProgress.phase === "Import complete" && <p style={{ margin: "7px 0 0", color: "#64736b", fontSize: 10 }}>Added {importSummary.added} · Duplicates skipped {importSummary.duplicates}</p>}
              </div>
            )}
            {importError && <p role="alert" style={{ margin: "0 18px 14px", color: "#ad4b43", fontSize: 11 }}>{importError}</p>}
          </section>

          <section style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Product list <span style={{ color: "#8a9690", fontSize: 12, fontWeight: 500 }}>({totalProductCount})</span></h2>
              <input aria-label="Search products" placeholder="Search products..." value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} style={{ width: 240, maxWidth: "100%", border: "1px solid #e0e6e1", borderRadius: 6, padding: "8px 10px", color: "#26352f", fontSize: 12, outlineColor: "#28a879" }} />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120, textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Internal Product ID", "Pharmaceutical Company", "Brand Name", "Generic Name", "Strength", "Dosage Form / Description", "Retail Price", "Action"].map((column) => (
                      <th key={column} style={{ width: column === "Internal Product ID" ? 150 : undefined, maxWidth: column === "Internal Product ID" ? 150 : undefined, padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: column === "Internal Product ID" ? "normal" : "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => (
                    <tr
                      key={product.id}
                      ref={editingProduct?.id === product.id ? assignEditRowRef : undefined}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          void saveEditedProduct();
                        }
                      }}
                    >
                      <td title={product.id} style={{ width: 150, maxWidth: 150, padding: "13px", borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.id.length > 30 ? `${product.id.slice(0, 27)}...` : product.id}</td>
                      {([
                        ["manufacturer", "manufacturer"],
                        ["brand", "brand"],
                        ["genericName", "genericName"],
                        ["strength", "strength"],
                        ["dosageForm", "dosageForm"],
                        ["retailPrice", "retailPrice"],
                      ] as const).map(([field, key]) => {
                        const value = editingProduct?.id === product.id
                          ? editingProduct[field] ?? ""
                          : product[field] ?? "";
                        return (
                          <td key={`${product.id}-${key}`} style={{ padding: editingProduct?.id === product.id ? "7px" : "13px", borderBottom: "1px solid #f0f2f0", color: "#687871", fontSize: 12, whiteSpace: "nowrap" }}>
                            {editingProduct?.id === product.id ? (
                              <input
                                aria-label={`Edit ${key} for ${product.id}`}
                                value={value}
                                disabled={savingProductId === product.id}
                                onChange={(event) => updateEditingProduct(field, event.target.value)}
                                style={{ width: "100%", minWidth: 90, boxSizing: "border-box", border: "1px solid #b9d8c8", borderRadius: 4, padding: "7px", color: "#26352f", fontSize: 12, outlineColor: "#28a879" }}
                              />
                            ) : value || "—"}
                          </td>
                        );
                      })}
                      <td style={{ padding: "10px 13px", borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button type="button" disabled={editingProduct?.id === product.id} onClick={() => { setSelectedProductDocuments([]); setProductDocumentsError(""); setIsLoadingProductDocuments(true); setSelectedProduct(product); }} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#227553", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: editingProduct?.id === product.id ? "not-allowed" : "pointer", opacity: editingProduct?.id === product.id ? 0.5 : 1 }}>Details</button>
                          {editingProduct?.id === product.id ? (
                            <>
                              <button type="button" disabled={savingProductId === product.id} onClick={() => void saveEditedProduct()} style={{ border: 0, borderRadius: 5, background: savingProductId === product.id ? "#aab7af" : "#179c70", color: "#fff", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: savingProductId === product.id ? "wait" : "pointer" }}>{savingProductId === product.id ? "Saving..." : "Save"}</button>
                              <button type="button" disabled={savingProductId === product.id} onClick={() => { setImportError(""); setEditingProduct(null); }} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#526158", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: savingProductId === product.id ? "not-allowed" : "pointer" }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button type="button" disabled={Boolean(editingProduct) || Boolean(savingProductId)} onClick={() => { setImportError(""); setEditingProduct({ ...product }); }} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#526158", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: editingProduct || savingProductId ? "not-allowed" : "pointer", opacity: editingProduct || savingProductId ? 0.5 : 1 }}>Edit</button>
                              <button type="button" disabled={Boolean(savingProductId) || Boolean(editingProduct)} onClick={() => void deleteProduct(product)} style={{ border: "1px solid #f0d7d4", borderRadius: 5, background: "#fff", color: "#b34b43", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: savingProductId || editingProduct ? "not-allowed" : "pointer", opacity: editingProduct ? 0.5 : 1 }}>Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                        {!storageReady ? "Loading products..." : searchTerm ? "No products match your search." : "No products yet. Select Add product to create your first item."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "12px 16px", borderTop: "1px solid #edf0ed", color: "#687871", fontSize: 11 }}>
              <span>Showing {firstVisibleProduct}-{lastVisibleProduct} of {totalProductCount} products</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Rows per page
                  <select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", padding: "6px 8px", color: "#34453b", fontSize: 11 }}>
                    {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button type="button" aria-label="Previous page" disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(safeCurrentPage - 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: safeCurrentPage <= 1 ? "not-allowed" : "pointer", opacity: safeCurrentPage <= 1 ? 0.5 : 1 }}>Previous</button>
                <span>Page {safeCurrentPage} of {totalPages}</span>
                <button type="button" aria-label="Next page" disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(safeCurrentPage + 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "6px 9px", fontSize: 11, cursor: safeCurrentPage >= totalPages ? "not-allowed" : "pointer", opacity: safeCurrentPage >= totalPages ? 0.5 : 1 }}>Next</button>
              </div>
            </div>
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
              <button type="button" aria-label="Close" onClick={closeModal} disabled={isSavingProduct} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: isSavingProduct ? "not-allowed" : "pointer" }}>×</button>
            </div>
            <ProductDocumentCapture
              files={productDocuments}
              onFilesChange={setProductDocuments}
              onManualImport={() => {
                setAddProductError("");
                setIsManualImportOpen(true);
              }}
              onSaveProductInformation={saveExtractedProduct}
              saveError={addProductError}
              disabled={isSavingProduct}
            />
          </section>
        </div>
      )}

      {isAddOpen && isManualImportOpen && (
        <div onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingProduct) setIsManualImportOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.58)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="manual-import-title" style={{ width: "min(760px, 100%)", maxHeight: "min(90vh, 820px)", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.3)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea", background: "#fff" }}>
              <div>
                <h2 id="manual-import-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Add Manual Import</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Enter medicine details manually to add the product.</p>
              </div>
              <button type="button" aria-label="Close manual import" onClick={() => { if (!isSavingProduct) setIsManualImportOpen(false); }} disabled={isSavingProduct} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: isSavingProduct ? "not-allowed" : "pointer" }}>×</button>
            </div>
            <form onSubmit={addProduct}>
              {addProductError && <p role="alert" style={{ margin: "14px 24px 0", color: "#ad4b43", fontSize: 12 }}>{addProductError}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, padding: 24 }}>
                <FormField label="SL / Serial Number (Auto)"><input name="serialNumber" value={nextSerialNumber} readOnly style={{ ...fieldStyle, background: "#f5f8f5", color: "#75847a" }} /></FormField>
                <FormField label="Internal Product ID Number (Auto)"><input name="internalProductId" value={nextProductId} readOnly style={{ ...fieldStyle, background: "#f5f8f5", color: "#75847a" }} /></FormField>
                <FormField label="Pharmaceutical Company"><input name="manufacturer" required placeholder="Pharmaceutical company" style={fieldStyle} /></FormField>
                <FormField label="Brand Name"><input name="brand" required placeholder="Brand name" style={fieldStyle} /></FormField>
                <FormField label="Generic Name"><input name="genericName" placeholder="Generic name" style={fieldStyle} /></FormField>
                <FormField label="Strength"><input name="strength" placeholder="e.g. 500 mg" style={fieldStyle} /></FormField>
                <FormField label="Dosage Form / Description"><input name="dosageForm" placeholder="e.g. Tablet" style={fieldStyle} /></FormField>
                <FormField label="Retail Price"><input name="retailPrice" inputMode="decimal" placeholder="Retail price" style={fieldStyle} /></FormField>
                <FormField label="Usage Type"><input name="usageType" placeholder="e.g. Human" style={fieldStyle} /></FormField>
                <FormField label="DAR Code"><input name="darCode" placeholder="DAR code" style={fieldStyle} /></FormField>
                <FormField label="Medicine Type/Category"><input name="medicineTypeCategory" placeholder="Medicine type or category" style={fieldStyle} /></FormField>
                <FormField label="Registration Information"><input name="registrationInformation" placeholder="Registration information" style={fieldStyle} /></FormField>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                <button type="button" onClick={() => setIsManualImportOpen(false)} disabled={isSavingProduct} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: isSavingProduct ? "not-allowed" : "pointer" }}>Cancel</button>
                <button type="submit" disabled={isImporting || isSavingProduct} style={{ border: 0, borderRadius: 6, background: isImporting || isSavingProduct ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: isImporting || isSavingProduct ? "not-allowed" : "pointer" }}>{isSavingProduct ? "Saving product..." : "Save product"}</button>
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
                ["SL / Serial Number", selectedProduct.serialNumber || "-"],
                ["Internal Product ID Number", selectedProduct.id],
                ["Pharmaceutical Company", selectedProduct.manufacturer],
                ["Brand Name", selectedProduct.brand || "-"],
                ["Generic Name", selectedProduct.genericName || "-"],
                ["Strength", selectedProduct.strength || "-"],
                ["Dosage Form / Description", selectedProduct.dosageForm || "-"],
                ["Retail Price", selectedProduct.retailPrice || "-"],
                ["Usage Type", selectedProduct.usageType || selectedProduct.productType || "-"],
                ["DAR Code", selectedProduct.darCode || selectedProduct.barcode || "-"],
                ["Medicine Type/Category", selectedProduct.medicineTypeCategory || selectedProduct.category || "-"],
                ["Registration Information", selectedProduct.registrationInformation || "-"],
                ["Pack Size", selectedProduct.packSize || "-"],
                ["Unit", selectedProduct.unit || "-"],
                ["Barcode/GTIN", selectedProduct.barcode || "-"],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ padding: "13px 10px 13px 0", borderBottom: "1px solid #edf0ed" }}>
                  <dt style={{ color: "#7a8981", fontSize: 11 }}>{label}</dt>
                  <dd style={{ margin: "5px 0 0", color: "#26372f", fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{value}</dd>
                </div>
              ))}
            </dl>
            <section aria-label="Saved product documents" style={{ display: "grid", gap: 8, padding: "0 24px 18px" }}>
              <strong style={{ color: "#26352f", fontSize: 13 }}>Locally saved documents</strong>
              {isLoadingProductDocuments ? (
                <p style={{ margin: 0, color: "#77857d", fontSize: 12 }}>Loading documents...</p>
              ) : productDocumentsError ? (
                <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>Could not load local documents: {productDocumentsError}</p>
              ) : selectedProductDocuments.length ? (
                <ProductDocumentLinks documents={selectedProductDocuments} />
              ) : (
                <p style={{ margin: 0, color: "#77857d", fontSize: 12 }}>No local documents are attached to this product.</p>
              )}
            </section>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <button type="button" onClick={closeModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}