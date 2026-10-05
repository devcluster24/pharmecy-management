'use client';

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";
import { supabase } from "@/lib/supabase/client";
import { ProductDocumentUpload } from "./ProductDocumentUpload";
import { type ExtractedProductDetails } from "@/lib/ocr/extractProductDetails";
import { getProductIdentityKey, getProductNameKey, type ProductImportCandidate } from "./productImport";

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
  unitPrice?: string;
  packPrice?: string;
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
  pack_size?: string;
  unit_price?: string;
  pack_price?: string;
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
  unit_price?: string;
  pack_price?: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type CatalogCompany = { name: string; count: number };
const CATALOG_PAGE_SIZE = 1000;
const IMPORT_BATCH_SIZE = 500;
const DEFAULT_PRODUCT_PAGE_SIZE = 25;

const storageKeys = {
  products: "pharmacy-cluster-products",
};

type NewProductNameFields = {
  id: string;
  brandName: string;
  genericName: string;
  company: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
};

type PriceField = "packSize" | "unitPrice" | "packPrice";

function createNewProductNameFields(): NewProductNameFields {
  return {
    id: "",
    brandName: "",
    genericName: "",
    company: "",
    strength: "",
    dosageForm: "",
    packSize: "",
    unitPrice: "",
    packPrice: "",
  };
}

function parsePrice(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatCalculatedPrice(value: number) {
  return String(Number(value.toFixed(4)));
}

function calculateNewNamePrices(field: PriceField, values: NewProductNameFields): NewProductNameFields {
  const packSize = parsePrice(values.packSize);
  const unitPrice = parsePrice(values.unitPrice);
  const packPrice = parsePrice(values.packPrice);
  const next = { ...values };

  if (field === "packSize" && packSize !== null) {
    if (unitPrice !== null) next.packPrice = formatCalculatedPrice(packSize * unitPrice);
    else if (packPrice !== null && packSize > 0) next.unitPrice = formatCalculatedPrice(packPrice / packSize);
  } else if (field === "unitPrice" && unitPrice !== null) {
    if (packSize !== null) next.packPrice = formatCalculatedPrice(packSize * unitPrice);
    else if (packPrice !== null && unitPrice > 0) next.packSize = formatCalculatedPrice(packPrice / unitPrice);
  } else if (field === "packPrice" && packPrice !== null) {
    if (packSize !== null && packSize > 0) next.unitPrice = formatCalculatedPrice(packPrice / packSize);
    else if (unitPrice !== null && unitPrice > 0) next.packSize = formatCalculatedPrice(packPrice / unitPrice);
  }

  if (field === "packSize" && packSize !== null) next.packSize = formatCalculatedPrice(packSize);
  if (field === "unitPrice" && unitPrice !== null) next.unitPrice = formatCalculatedPrice(unitPrice);
  if (field === "packPrice" && packPrice !== null) next.packPrice = formatCalculatedPrice(packPrice);
  return next;
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
    unitPrice: row.unit_price ?? row.retail_price,
    packPrice: row.pack_price ?? "-",
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
    unit_price: product.unitPrice ?? product.retailPrice ?? "-",
    pack_price: product.packPrice ?? "-",
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
    packSize: row.pack_size ?? "-",
    unit: "-",
    barcode: row.dar_code,
    retailPrice: row.retail_price,
    unitPrice: row.unit_price ?? row.retail_price,
    packPrice: row.pack_price ?? "-",
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
      "id", "source_catalog_id", "serial_number", "medicine_name", "brand", "generic_name", "manufacturer",
      "product_type", "category", "dosage_form", "strength", "pack_size", "unit",
      "barcode", "retail_price", "unit_price", "pack_price", "usage_type", "dar_code", "medicine_type_category",
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

async function loadPharmacyProductNames(ownerUserId: string) {
  const companyNames = new Set<string>();
  const genericNames = new Set<string>();
  for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .select("manufacturer, generic_name")
      .eq("owner_user_id", ownerUserId)
      .order("manufacturer", { ascending: true })
      .range(offset, offset + CATALOG_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as { manufacturer: string; generic_name: string }[];
    page.forEach(({ manufacturer, generic_name }) => {
      const companyName = manufacturer.trim();
      const genericName = generic_name.trim();
      if (companyName && companyName !== "-") companyNames.add(companyName);
      if (genericName && genericName !== "-") genericNames.add(genericName);
    });
    if (page.length < CATALOG_PAGE_SIZE) return {
      companyNames: [...companyNames],
      genericNames: [...genericNames],
    };
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
  const [storageReady, setStorageReady] = useState(adminMode);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isNewNameOpen, setIsNewNameOpen] = useState(false);
  const [isGeneratingNewNameId, setIsGeneratingNewNameId] = useState(false);
  const [isSavingNewName, setIsSavingNewName] = useState(false);
  const [isCompanyInputFocused, setIsCompanyInputFocused] = useState(false);
  const [newNameFields, setNewNameFields] = useState<NewProductNameFields>(createNewProductNameFields);
  const [newNameError, setNewNameError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [savingProductId, setSavingProductId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PRODUCT_PAGE_SIZE);
  const [totalProductCount, setTotalProductCount] = useState(0);
  const [productDocuments, setProductDocuments] = useState<File[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ phase: "", checked: 0, total: 0 });
  const [importSummary, setImportSummary] = useState({ added: 0, duplicates: 0 });
  const [importError, setImportError] = useState("");
  const [availableCompanies, setAvailableCompanies] = useState<CatalogCompany[]>([]);
  const [pharmacyCompanyNames, setPharmacyCompanyNames] = useState<string[]>([]);
  const [pharmacyCompanyNamesError, setPharmacyCompanyNamesError] = useState("");
  const [pharmacyGenericNames, setPharmacyGenericNames] = useState<string[]>([]);
  const [pharmacyGenericNamesError, setPharmacyGenericNamesError] = useState("");
  const [totalCatalogCount, setTotalCatalogCount] = useState(0);
  const [pharmacyUserId, setPharmacyUserId] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const initialQueryKey = useRef("");
  const productQuerySequence = useRef(0);
  const editRowRef = useRef<HTMLTableRowElement | null>(null);
  const savingProductRef = useRef(false);
  const assignEditRowRef = useCallback((node: HTMLTableRowElement | null) => {
    editRowRef.current = node;
  }, []);

  useEffect(() => {
    let active = true;

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

        void loadPharmacyProductNames(user.id)
          .then(({ companyNames, genericNames }) => {
            if (!active) return;
            setPharmacyCompanyNames(companyNames);
            setPharmacyGenericNames(genericNames);
          })
          .catch((error: unknown) => {
            if (!active) return;
            const message = getErrorMessage(error);
            setPharmacyCompanyNamesError(`Could not load company names from your product list: ${message}`);
            setPharmacyGenericNamesError(`Could not load generic names from your product list: ${message}`);
          });

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
    if (!isAddOpen && !isNewNameOpen && !selectedProduct) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isGeneratingNewNameId || isSavingNewName) return;
        setIsAddOpen(false);
        setIsNewNameOpen(false);
        setSelectedProduct(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAddOpen, isGeneratingNewNameId, isNewNameOpen, isSavingNewName, selectedProduct]);

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
          pack_size: editingProduct.packSize,
          retail_price: editingProduct.unitPrice ?? editingProduct.retailPrice ?? "-",
          unit_price: editingProduct.unitPrice ?? editingProduct.retailPrice ?? "-",
          pack_price: editingProduct.packPrice ?? "-",
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
  const typedCompanyName = newNameFields.company.trimStart();
  const inlineCompanySuggestion = isCompanyInputFocused && typedCompanyName
    ? pharmacyCompanyNames.find((name) =>
        name.toLocaleLowerCase().startsWith(typedCompanyName.toLocaleLowerCase()) &&
        name.length > typedCompanyName.length,
      )
    : undefined;
  const progressPercentage = importProgress.total
    ? Math.round((importProgress.checked / importProgress.total) * 100)
    : 0;

  function updateEditingProduct(field: "manufacturer" | "brand" | "genericName" | "strength" | "dosageForm" | "packSize" | "unitPrice" | "packPrice", value: string) {
    setEditingProduct((current) => current
      ? field === "unitPrice"
        ? { ...current, unitPrice: value, retailPrice: value }
        : { ...current, [field]: value }
      : current);
  }

  function openAddProduct() {
    if (!pharmacyUserId || isImporting || !storageReady) return;
    setProductDocuments([]);
    setImportError("");
    setIsAddOpen(true);
  }

  async function saveOcrProduct(details: ExtractedProductDetails) {
    if (!pharmacyUserId) throw new Error("Could not verify the signed-in pharmacy account.");
    const brand = details.brandName.trim();
    const genericName = details.genericName.trim();
    const manufacturer = details.company.trim();
    if (!brand || !manufacturer) {
      throw new Error("Brand Name and Company are required.");
    }

    const productFields: ProductImportCandidate = {
      medicineName: brand || genericName,
      brand,
      genericName: genericName || "-",
      manufacturer,
      productType: "Medicine",
      category: "",
      dosageForm: details.dosageForm.trim() || "-",
      strength: details.strength.trim() || "-",
      packSize: details.packSize.trim() || "-",
      unit: "-",
      barcode: "-",
    };

    const { data: matchingRows, error: duplicateCheckError } = await supabase
      .from("pharmacy_catalog_products")
      .select("*")
      .eq("owner_user_id", pharmacyUserId)
      .ilike("medicine_name", productFields.medicineName);
    if (duplicateCheckError) throw duplicateCheckError;
    const matchingProducts = ((matchingRows ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
    const identityKey = getProductIdentityKey(productFields);
    if (identityKey && matchingProducts.some((product) => getProductIdentityKey(product) === identityKey)) {
      throw new Error("This product already exists with the same name, strength, dosage form, and company.");
    }
    const nameKey = getProductNameKey(productFields);
    if (matchingProducts.some((product) => getProductNameKey(product) === nameKey && !getProductIdentityKey(product))) {
      throw new Error("A product with this name has incomplete details. Resolve that record before adding another.");
    }

    const { data: identifiers, error: identifierError } = await supabase.rpc("reserve_pharmacy_product_identifiers");
    if (identifierError) throw identifierError;
    const reserved = (identifiers ?? [])[0] as { serial_number?: string; product_id?: string } | undefined;
    if (!reserved?.serial_number || !reserved.product_id) {
      throw new Error("The database did not return product identifiers. Apply the latest Supabase migration and retry.");
    }

    const unitPrice = details.unitPrice.trim() || "-";
    const product: Product = {
      ...productFields,
      id: reserved.product_id,
      serialNumber: reserved.serial_number,
      retailPrice: unitPrice,
      unitPrice,
      packPrice: details.packPrice.trim() || "-",
      usageType: "Medicine",
      darCode: "-",
      medicineTypeCategory: "",
      registrationInformation: "-",
    };
    const { data, error } = await supabase
      .from("pharmacy_catalog_products")
      .insert(mapProductToPharmacyRow(product, pharmacyUserId))
      .select("*")
      .single();
    if (error) throw error;

    const savedProduct = mapPharmacyRowToProduct(data as PharmacyProductRow);
    initialQueryKey.current = `${pharmacyUserId}:1:${pageSize}:`;
    setCurrentPage(1);
    setSearchTerm("");
    setImportError("");
    try {
      const refreshed = await loadPharmacyProductPage(pharmacyUserId, 1, pageSize, "");
      setProducts(refreshed.products);
      setTotalProductCount(refreshed.count);
    } catch (error) {
      setProducts([savedProduct]);
      setTotalProductCount((count) => count + 1);
      setImportError(`Product was saved, but the product list could not be refreshed: ${getErrorMessage(error)}`);
    }
    setPharmacyCompanyNames((current) => current.includes(manufacturer) ? current : [...current, manufacturer]);
    if (genericName !== "-") {
      setPharmacyGenericNames((current) => current.includes(genericName) ? current : [...current, genericName]);
    }
    setProductDocuments([]);
    setIsAddOpen(false);
  }

  async function openNewNameModal() {
    if (!pharmacyUserId || !storageReady || isImporting) return;
    setNewNameFields(createNewProductNameFields());
    setNewNameError("");
    setIsNewNameOpen(true);
    setIsGeneratingNewNameId(true);
    try {
      const { data, error } = await supabase.rpc("reserve_pharmacy_product_identifiers");
      if (error) throw error;
      const reserved = (data ?? [])[0] as { product_id?: string } | undefined;
      const productId = reserved?.product_id;
      if (!productId) {
        throw new Error("The database did not return a product ID. Apply the latest Supabase migration and retry.");
      }
      setNewNameFields((current) => ({ ...current, id: productId }));
    } catch (error) {
      console.error("Could not reserve a product ID:", error);
      setNewNameError(getErrorMessage(error));
    } finally {
      setIsGeneratingNewNameId(false);
    }
  }

  function closeNewNameModal() {
    if (isGeneratingNewNameId || isSavingNewName) return;
    setIsNewNameOpen(false);
    setNewNameError("");
  }

  function handleNewNamePriceBlur(field: PriceField) {
    const value = newNameFields[field];
    if (value.trim() && parsePrice(value) === null) {
      setNewNameError("Enter a valid non-negative number for pack size and prices.");
      return;
    }
    setNewNameFields((current) => calculateNewNamePrices(field, current));
    setNewNameError("");
  }

  async function saveNewName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingNewName) return;
    if (!pharmacyUserId) {
      setNewNameError("Could not verify the signed-in pharmacy account.");
      return;
    }

    const brand = newNameFields.brandName.trim();
    const genericName = newNameFields.genericName.trim();
    const manufacturer = newNameFields.company.trim();
    const strength = newNameFields.strength.trim();
    const dosageForm = newNameFields.dosageForm.trim();
    const productId = newNameFields.id.trim();
    const enteredPrices = [newNameFields.packSize, newNameFields.unitPrice, newNameFields.packPrice];
    const parsedPrices = enteredPrices.map(parsePrice);

    if (!brand || !manufacturer) {
      setNewNameError("Brand Name and Company Name are required.");
      return;
    }
    if (!productId) {
      setNewNameError("A product ID could not be generated. Close and reopen the form to retry.");
      return;
    }
    if (enteredPrices.some((value, index) => value.trim() && parsedPrices[index] === null)) {
      setNewNameError("Enter valid non-negative numbers for Pack Size, Unit Price, or Pack Price.");
      return;
    }
    const [packSize, unitPrice, packPrice] = parsedPrices;
    if (packSize !== null && packSize <= 0) {
      setNewNameError("Pack Size must be greater than zero.");
      return;
    }

    const candidate: ProductImportCandidate = {
      medicineName: brand,
      brand,
      genericName: genericName || "-",
      manufacturer,
      productType: "Medicine",
      category: "",
      dosageForm: dosageForm || "-",
      strength: strength || "-",
      packSize: packSize === null ? "-" : formatCalculatedPrice(packSize),
      unit: "-",
      barcode: "-",
    };

    setIsSavingNewName(true);
    setNewNameError("");
    try {
      const { data: matchingRows, error: duplicateCheckError } = await supabase
        .from("pharmacy_catalog_products")
        .select("*")
        .eq("owner_user_id", pharmacyUserId)
        .ilike("medicine_name", brand);
      if (duplicateCheckError) throw duplicateCheckError;
      const matchingProducts = ((matchingRows ?? []) as PharmacyProductRow[]).map(mapPharmacyRowToProduct);
      const identityKey = getProductIdentityKey(candidate);
      if (identityKey && matchingProducts.some((product) => getProductIdentityKey(product) === identityKey)) {
        throw new Error("This product already exists with the same name, strength, dosage form, and company.");
      }

      const product: Product = {
        ...candidate,
        id: productId,
        retailPrice: unitPrice === null ? "-" : formatCalculatedPrice(unitPrice),
        unitPrice: unitPrice === null ? "-" : formatCalculatedPrice(unitPrice),
        packPrice: packPrice === null ? "-" : formatCalculatedPrice(packPrice),
        usageType: "Medicine",
        darCode: "-",
        medicineTypeCategory: "",
        registrationInformation: "-",
      };
      const { data, error } = await supabase
        .from("pharmacy_catalog_products")
        .insert(mapProductToPharmacyRow(product, pharmacyUserId))
        .select("*")
        .single();
      if (error) throw error;

      const savedProduct = mapPharmacyRowToProduct(data as PharmacyProductRow);
      initialQueryKey.current = `${pharmacyUserId}:1:${pageSize}:`;
      setCurrentPage(1);
      setSearchTerm("");
      try {
        const refreshed = await loadPharmacyProductPage(pharmacyUserId, 1, pageSize, "");
        setProducts(refreshed.products);
        setTotalProductCount(refreshed.count);
      } catch (error) {
        setProducts((current) => [savedProduct, ...current]);
        setTotalProductCount((count) => count + 1);
        setImportError(`Product was saved, but the product list could not be refreshed: ${getErrorMessage(error)}`);
      }
      setPharmacyCompanyNames((current) => current.includes(manufacturer) ? current : [...current, manufacturer]);
      if (genericName && genericName !== "-") {
        setPharmacyGenericNames((current) => current.includes(genericName) ? current : [...current, genericName]);
      }
      setIsNewNameOpen(false);
    } catch (error) {
      console.error("Could not save new product name:", error);
      setNewNameError(getErrorMessage(error));
    } finally {
      setIsSavingNewName(false);
    }
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
    setIsAddOpen(false);
    setSelectedProduct(null);
    setProductDocuments([]);
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" disabled={isImporting || !storageReady} onClick={openAddProduct} style={{ border: 0, borderRadius: 7, background: isImporting || !storageReady ? "#aab7af" : "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: isImporting || !storageReady ? "not-allowed" : "pointer" }}>
                Read product label
              </button>

              {!adminMode && (
                <button type="button" disabled={isImporting || !storageReady || !pharmacyUserId} onClick={openNewNameModal} style={{ border: "1px solid #179c70", borderRadius: 7, background: "#fff", color: "#16845f", padding: "9px 13px", fontSize: 13, fontWeight: 650, cursor: isImporting || !storageReady || !pharmacyUserId ? "not-allowed" : "pointer", opacity: isImporting || !storageReady || !pharmacyUserId ? 0.6 : 1 }}>
                  + Add New
                </button>
              )}
            </div>
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
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1450, textAlign: "left" }}>
                <thead>
                  <tr>
                    {["ID Number", "Brand Name", "Generic Name", "Company", "Strength", "Dosage Form", "Pack Size", "Unit Price", "Pack Price", "Actions"].map((column) => (
                      <th key={column} style={{ width: column === "ID Number" ? 150 : undefined, maxWidth: column === "ID Number" ? 150 : undefined, padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: column === "ID Number" ? "normal" : "nowrap" }}>{column}</th>
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
                      <td title={product.sourceCatalogId ?? product.id} style={{ width: 150, maxWidth: 150, padding: "13px", borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(product.sourceCatalogId ?? product.id).length > 30 ? `${(product.sourceCatalogId ?? product.id).slice(0, 27)}...` : product.sourceCatalogId ?? product.id}</td>
                      {([
                        ["brand", "brand"],
                        ["genericName", "genericName"],
                        ["manufacturer", "manufacturer"],
                        ["strength", "strength"],
                        ["dosageForm", "dosageForm"],
                        ["packSize", "packSize"],
                        ["unitPrice", "unitPrice"],
                        ["packPrice", "packPrice"],
                      ] as const).map(([field, key]) => {
                        const value = editingProduct?.id === product.id
                          ? editingProduct[field] ?? (field === "unitPrice" ? editingProduct.retailPrice : "")
                          : product[field] ?? (field === "unitPrice" ? product.retailPrice : "");
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
                          <button type="button" disabled={editingProduct?.id === product.id} onClick={() => setSelectedProduct(product)} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#227553", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: editingProduct?.id === product.id ? "not-allowed" : "pointer", opacity: editingProduct?.id === product.id ? 0.5 : 1 }}>Details</button>
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
                      <td colSpan={10} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                        {!storageReady ? "Loading products..." : searchTerm ? "No products match your search." : "No products yet. Import products from the shared catalog to add them to your pharmacy list."}
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
                <h2 id="add-product-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Read product label</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Scan product images and review the extracted details.</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <ProductDocumentUpload
              files={productDocuments}
              onFilesChange={setProductDocuments}
              companyNames={pharmacyCompanyNames}
              companyNamesError={pharmacyCompanyNamesError}
              genericNames={pharmacyGenericNames}
              genericNamesError={pharmacyGenericNamesError}
              onSaveProduct={saveOcrProduct}
            />
          </section>
        </div>
      )}

      {isNewNameOpen && (
        <div onMouseDown={(event) => { if (event.target === event.currentTarget) closeNewNameModal(); }} style={{ position: "fixed", inset: 0, zIndex: 51, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="new-product-name-title" style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea", background: "#fff" }}>
              <div>
                <h2 id="new-product-name-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Add New Product</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Add product details and pricing to your pharmacy list.</p>
              </div>
              <button type="button" aria-label="Close" disabled={isGeneratingNewNameId || isSavingNewName} onClick={closeNewNameModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: isGeneratingNewNameId || isSavingNewName ? "not-allowed" : "pointer" }}>×</button>
            </div>
            <form onSubmit={(event) => void saveNewName(event)} noValidate>
              <div style={{ padding: "8px 24px 18px" }}>
                <h3 style={{ margin: "8px 0 0", padding: "10px 0", borderBottom: "2px solid #cbd8cf", color: "#526158", fontSize: 12, fontWeight: 700 }}>Product details</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", columnGap: 18 }}>
                  <label style={{ display: "grid", alignContent: "start", gap: 6, padding: "10px 10px 10px 0", borderBottom: "1px solid #dce4de", color: "#7a8981", fontSize: 11 }}>
                    ID Number
                    <input aria-label="ID Number" value={isGeneratingNewNameId ? "Generating ID..." : newNameFields.id} readOnly style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d5dfd8", borderRadius: 5, background: "#f8faf8", padding: "6px 9px", color: "#26372f", fontSize: 12, fontWeight: 600 }} />
                  </label>
                  {([
                    ["brandName", "Brand Name"],
                    ["genericName", "Generic Name"],
                    ["company", "Company Name"],
                    ["strength", "Strength"],
                    ["dosageForm", "Dosage Form"],
                  ] as const).map(([field, label]) => (
                    <label key={field} style={{ display: "grid", alignContent: "start", gap: 6, padding: "10px 10px 10px 0", borderBottom: "1px solid #dce4de", color: "#7a8981", fontSize: 11 }}>
                      <span>{label}{(field === "brandName" || field === "company") && <span aria-hidden="true" style={{ color: "#c4574c" }}> *</span>}</span>
                      <div style={{ position: "relative" }}>
                        <input
                          aria-label={label}
                          aria-required={field === "brandName" || field === "company"}
                          required={field === "brandName" || field === "company"}
                          autoComplete={field === "company" ? "off" : undefined}
                          value={newNameFields[field]}
                          onFocus={field === "company" ? () => setIsCompanyInputFocused(true) : undefined}
                          onBlur={field === "company" ? () => setIsCompanyInputFocused(false) : undefined}
                          onKeyDown={field === "company" && inlineCompanySuggestion ? (event) => {
                            const input = event.currentTarget;
                            if (
                              (event.key === "Tab" || event.key === "ArrowRight") &&
                              (event.key === "Tab" || input.selectionStart === input.value.length)
                            ) {
                              event.preventDefault();
                              setNewNameFields((current) => ({ ...current, company: inlineCompanySuggestion }));
                            }
                          } : undefined}
                          onChange={(event) => {
                            const value = event.target.value;
                            setNewNameFields((current) => ({ ...current, [field]: value }));
                            setNewNameError("");
                          }}
                          style={{ position: "relative", zIndex: 1, width: "100%", boxSizing: "border-box", border: "1px solid #d5dfd8", borderRadius: 5, background: inlineCompanySuggestion ? "transparent" : "#fff", padding: "6px 9px", color: inlineCompanySuggestion ? "transparent" : "#26372f", caretColor: "#26372f", fontSize: 12 }}
                        />
                        {field === "company" && inlineCompanySuggestion && (
                          <span aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", padding: "7px 10px", color: "#26372f", fontSize: 12, lineHeight: "normal", whiteSpace: "pre", pointerEvents: "none" }}>
                            <span style={{ color: "transparent" }}>{newNameFields.company}</span>
                            <span style={{ color: "#9aa79f" }}>{inlineCompanySuggestion.slice(typedCompanyName.length)}</span>
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                <h3 style={{ margin: "14px 0 0", padding: "10px 0", borderBottom: "2px solid #cbd8cf", color: "#526158", fontSize: 12, fontWeight: 700 }}>Pack &amp; pricing</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", columnGap: 18 }}>
                  {([
                    ["packSize", "Pack Size"],
                    ["unitPrice", "Unit Price"],
                    ["packPrice", "Pack Price"],
                  ] as const).map(([field, label]) => (
                    <label key={field} style={{ display: "grid", alignContent: "start", gap: 6, padding: "10px 10px 10px 0", borderBottom: "1px solid #dce4de", color: "#7a8981", fontSize: 11 }}>
                      <span>{label}</span>
                      <input
                        aria-label={label}
                        type="text"
                        inputMode="decimal"
                        value={newNameFields[field]}
                        onChange={(event) => {
                          const value = event.target.value;
                          setNewNameFields((current) => ({ ...current, [field]: value }));
                          setNewNameError("");
                        }}
                        onBlur={() => handleNewNamePriceBlur(field)}
                        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d5dfd8", borderRadius: 5, background: "#fff", padding: "6px 9px", color: "#26372f", fontSize: 12 }}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <p style={{ margin: "-7px 24px 16px", color: "#77857d", fontSize: 11 }}>Price fields calculate the related value when you leave the input. Enter any two values to calculate the third.</p>
              {newNameError && <p role="alert" style={{ margin: "0 24px 16px", color: "#b34b43", fontSize: 12 }}>{newNameError}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                <button type="button" disabled={isGeneratingNewNameId || isSavingNewName} onClick={closeNewNameModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: isGeneratingNewNameId || isSavingNewName ? "not-allowed" : "pointer" }}>Cancel</button>
                <button type="submit" disabled={isGeneratingNewNameId || isSavingNewName || !newNameFields.id} style={{ border: 0, borderRadius: 6, background: isGeneratingNewNameId || isSavingNewName || !newNameFields.id ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: isSavingNewName ? "wait" : "pointer" }}>{isGeneratingNewNameId ? "Generating ID..." : isSavingNewName ? "Saving..." : "Save"}</button>
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
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 0, margin: 0, padding: "8px 24px 18px" }}>
              {([
                ["ID Number", selectedProduct.sourceCatalogId ?? selectedProduct.id],
                ["Brand Name", selectedProduct.brand || "-"],
                ["Generic Name", selectedProduct.genericName || "-"],
                ["Company", selectedProduct.manufacturer || "-"],
                ["Strength", selectedProduct.strength || "-"],
                ["Dosage Form", selectedProduct.dosageForm || "-"],
                ["Pack Size", selectedProduct.packSize || "-"],
                ["Unit Price", selectedProduct.unitPrice || selectedProduct.retailPrice || "-"],
                ["Pack Price", selectedProduct.packPrice || "-"],
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