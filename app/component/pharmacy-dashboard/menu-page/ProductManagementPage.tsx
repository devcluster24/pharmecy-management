'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import DashboardLanguageMenu from "../components/DashboardLanguageMenu";
import PharmacyDashboardBrand, { PharmacyDashboardStoreName } from "../components/PharmacyDashboardBrand";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";
import Sidebar from "../components/Sidebar";
import {
  getProductIdentityKey,
  normalizeProductValue,
  parseProductCsv,
  parseProductJson,
  resolveCsvSources,
  type CsvSourceOption,
  type ProductImportCandidate,
} from "./productImport";
import {
  importCatalogProducts,
  loadProductAutoSyncSettings,
  resolveProductOwnerId,
  saveProductAutoSyncSettings,
} from "./productCatalogSync";

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
};

type SuggestionField = "dosageForm" | "strength" | "packSize" | "barcode";
type Suggestions = Record<SuggestionField, string[]>;
type CatalogProduct = {
  id: string;
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
};

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

function getPageProductIdentityKey(product: ProductImportCandidate) {
  const identity = getProductIdentityKey(product);
  if (identity) return identity;
  if (!product.medicineName.trim()) return null;
  return JSON.stringify([
    product.medicineName,
    product.strength,
    product.dosageForm,
    product.manufacturer,
  ].map(normalizeProductValue));
}

export default function ProductManagementPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(initialSuggestions);
  const [storageReady, setStorageReady] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [catalogCompanies, setCatalogCompanies] = useState<{ name: string; count: number }[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [isAutoSyncLoading, setIsAutoSyncLoading] = useState(true);
  const [isAutoSyncSaving, setIsAutoSyncSaving] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isCatalogImporting, setIsCatalogImporting] = useState(false);
  const [catalogImportStatus, setCatalogImportStatus] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ProductImportCandidate[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState("");
  const [isFileImporting, setIsFileImporting] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceOptions, setSourceOptions] = useState<CsvSourceOption[]>([]);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [isResolvingSource, setIsResolvingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCatalogProducts = useCallback(async (activeOwnerId: string) => {
    const rows: CatalogProduct[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("pharmacy_catalog_products")
        .select("id, medicine_name, brand, generic_name, manufacturer, product_type, category, dosage_form, strength, pack_size, unit, barcode")
        .eq("owner_user_id", activeOwnerId)
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      const page = (data ?? []) as CatalogProduct[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const savedProducts = localStorage.getItem(storageKeys.products);
        const savedSuggestions = localStorage.getItem(storageKeys.suggestions);
        if (savedProducts) {
          const parsedProducts: unknown = JSON.parse(savedProducts);
          if (Array.isArray(parsedProducts)) setProducts(parsedProducts as Product[]);
        }
        if (savedSuggestions) {
          const parsedSuggestions: Partial<Suggestions> = JSON.parse(savedSuggestions);
          setSuggestions({
            dosageForm: [...new Set([...initialSuggestions.dosageForm, ...(parsedSuggestions.dosageForm ?? [])])],
            strength: [...new Set([...initialSuggestions.strength, ...(parsedSuggestions.strength ?? [])])],
            packSize: [...new Set([...initialSuggestions.packSize, ...(parsedSuggestions.packSize ?? [])])],
            barcode: [...new Set(parsedSuggestions.barcode ?? [])],
          });
        }
      } catch {
        localStorage.removeItem(storageKeys.products);
        localStorage.removeItem(storageKeys.suggestions);
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadPageData() {
      try {
        const resolvedOwnerId = await resolveProductOwnerId();
        if (!active) return;
        setOwnerId(resolvedOwnerId);
        const [settings, companiesResult, savedCatalogProducts] = await Promise.all([
          loadProductAutoSyncSettings(resolvedOwnerId),
          supabase.rpc("get_admin_catalog_manufacturers"),
          loadCatalogProducts(resolvedOwnerId),
        ]);
        if (companiesResult.error) throw companiesResult.error;
        if (!active) return;
        setAutoSyncEnabled(settings.enabled);
        setCatalogProducts(savedCatalogProducts);
        const companies = ((companiesResult.data ?? []) as { pharmaceutical_company: string; product_count: number }[])
          .map((company) => ({
            name: company.pharmaceutical_company,
            count: Number(company.product_count),
          }))
          .filter((company) => company.name && company.count > 0);
        setCatalogCompanies(companies);
      } catch (loadError) {
        if (active) {
          setCatalogError(loadError instanceof Error ? loadError.message : "Could not load product data.");
        }
      } finally {
        if (active) {
          setIsCatalogLoading(false);
          setIsAutoSyncLoading(false);
        }
      }
    }
    void loadPageData();
    return () => {
      active = false;
    };
  }, [loadCatalogProducts]);

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    const channel = supabase
      .channel(`web-product-list-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pharmacy_catalog_products",
          filter: `owner_user_id=eq.${ownerId}`,
        },
        () => {
          void loadCatalogProducts(ownerId)
            .then((rows) => {
              if (active) setCatalogProducts(rows);
            })
            .catch((loadError: unknown) => {
              if (active) setCatalogError(loadError instanceof Error ? loadError.message : "Could not refresh imported products.");
            });
        },
      )
      .subscribe((status, subscribeError) => {
        if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
          setCatalogError(`Live product updates are unavailable${subscribeError?.message ? `: ${subscribeError.message}` : "."}`);
        }
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [loadCatalogProducts, ownerId]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(storageKeys.products, JSON.stringify(products));
      localStorage.setItem(storageKeys.suggestions, JSON.stringify(suggestions));
    } catch {
      // The page remains usable if browser storage is unavailable.
    }
  }, [products, suggestions, storageReady]);

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

  const allProducts = useMemo(() => {
    const records = [
      ...products,
      ...catalogProducts.map((product) => ({
        id: product.id,
        medicineName: product.medicine_name,
        brand: product.brand,
        genericName: product.generic_name,
        manufacturer: product.manufacturer,
        productType: product.product_type,
        category: product.category,
        dosageForm: product.dosage_form,
        strength: product.strength,
        packSize: product.pack_size,
        unit: product.unit,
        barcode: product.barcode,
      })),
    ];
    const ids = new Set<string>();
    const identities = new Set<string>();
    return records.filter((product) => {
      if (ids.has(product.id)) return false;
      ids.add(product.id);
      const identity = getPageProductIdentityKey(product);
      if (identity && identities.has(identity)) return false;
      if (identity) identities.add(identity);
      return true;
    });
  }, [catalogProducts, products]);
  const filteredProducts = allProducts.filter((product) =>
    [product.id, product.medicineName, product.brand, product.genericName, product.manufacturer, product.barcode]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );
  const nextProductNumber = allProducts.reduce((highest, product) => {
    const match = /^MED-(\d+)$/i.exec(product.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
  const nextProductId = `MED-${String(nextProductNumber).padStart(4, "0")}`;

  async function toggleAutoSync() {
    if (!ownerId || isAutoSyncSaving || isAutoSyncLoading) return;
    setIsAutoSyncSaving(true);
    setCatalogError("");
    try {
      const settings = await saveProductAutoSyncSettings(ownerId, !autoSyncEnabled);
      setAutoSyncEnabled(settings.enabled);
    } catch (saveError) {
      setCatalogError(saveError instanceof Error ? saveError.message : "Could not save auto-sync settings.");
    } finally {
      setIsAutoSyncSaving(false);
    }
  }

  async function importSharedCatalog(company?: string) {
    if (!ownerId || isCatalogImporting) return;
    setIsCatalogImporting(true);
    setCatalogError("");
    setCatalogImportStatus("Loading shared products...");
    try {
      const result = await importCatalogProducts(ownerId, company ? { company } : {});
      if (!result.available) throw new Error("No shared catalog products were found to import.");
      const [savedProducts, companyResult] = await Promise.all([
        loadCatalogProducts(ownerId),
        supabase.rpc("get_admin_catalog_manufacturers"),
      ]);
      if (companyResult.error) throw companyResult.error;
      setCatalogProducts(savedProducts);
      setCatalogCompanies(((companyResult.data ?? []) as { pharmaceutical_company: string; product_count: number }[])
        .map((item) => ({ name: item.pharmaceutical_company, count: Number(item.product_count) }))
        .filter((item) => item.name && item.count > 0));
      setSelectedCompany("");
      setCatalogImportStatus(`Imported ${result.added} product(s). ${result.duplicates} duplicate(s) skipped.`);
    } catch (importError) {
      setCatalogError(importError instanceof Error ? importError.message : "Product import failed.");
      setCatalogImportStatus("");
    } finally {
      setIsCatalogImporting(false);
    }
  }

  function stageImport(text: string, fileName: string, isJson: boolean) {
    const parsed = isJson ? parseProductJson(text) : parseProductCsv(text);
    if (!parsed.rows.length) throw new Error("No valid product rows were found in the selected data.");
    setImportFileName(fileName);
    setImportRows(parsed.rows);
    setImportWarnings(parsed.warnings);
    setImportStatus(`${parsed.rows.length} product row(s) ready to import.`);
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName(file.name);
    const isJson = file.name.toLowerCase().endsWith(".json");
    if (!isJson && !file.name.toLowerCase().endsWith(".csv")) {
      setImportStatus("Choose a CSV or JSON file.");
      return;
    }
    try {
      stageImport(await file.text(), file.name, isJson);
    } catch (parseError) {
      setImportRows([]);
      setImportWarnings([]);
      setImportStatus(parseError instanceof Error ? parseError.message : "Could not read the selected product file.");
    }
  }

  async function loadRemoteSource(option: CsvSourceOption) {
    setIsResolvingSource(true);
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName(option.label);
    setImportStatus(`Loading ${option.label}...`);
    try {
      const response = await fetch(option.url);
      if (!response.ok) throw new Error(`Could not download ${option.label} (HTTP ${response.status}).`);
      const text = await response.text();
      const isJson = new URL(option.url).pathname.toLowerCase().endsWith(".json")
        || response.headers.get("content-type")?.toLowerCase().includes("json") === true;
      stageImport(text, option.label, isJson);
    } catch (loadError) {
      setImportRows([]);
      setImportWarnings([]);
      setImportStatus(loadError instanceof Error ? loadError.message : "Could not load the product data source.");
    } finally {
      setIsResolvingSource(false);
    }
  }

  async function handleResolveSource() {
    if (!sourceUrl.trim() || isResolvingSource) {
      setImportStatus("Enter a product data source link first.");
      return;
    }
    setIsResolvingSource(true);
    setImportStatus("Finding product data files...");
    try {
      const options = await resolveCsvSources(sourceUrl);
      setSourceOptions(options);
      if (options.length === 1) {
        setSelectedSourceUrl(options[0].url);
        await loadRemoteSource(options[0]);
      } else {
        setSelectedSourceUrl(options[0].url);
        setImportStatus(`${options.length} product data files found. Choose one to load.`);
      }
    } catch (resolveError) {
      setSourceOptions([]);
      setSelectedSourceUrl("");
      setImportStatus(resolveError instanceof Error ? resolveError.message : "Could not find product data files.");
    } finally {
      setIsResolvingSource(false);
    }
  }

  async function importStagedProducts() {
    if (!ownerId || isFileImporting || !importRows.length) return;
    const existingIdentities = new Set(
      allProducts
        .map(getPageProductIdentityKey)
        .filter((identity): identity is string => Boolean(identity)),
    );
    let duplicateCount = 0;
    const newRows: {
      owner_user_id: string;
      id: string;
      source_catalog_id: null;
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
    }[] = [];

    for (const row of importRows) {
      const identity = getPageProductIdentityKey(row);
      if (identity && existingIdentities.has(identity)) {
        duplicateCount += 1;
        continue;
      }
      const generatedId = `MED-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      newRows.push({
        owner_user_id: ownerId,
        id: generatedId,
        source_catalog_id: null,
        serial_number: "-",
        medicine_name: row.medicineName,
        brand: row.brand,
        generic_name: row.genericName,
        manufacturer: row.manufacturer,
        product_type: row.productType,
        category: row.category,
        dosage_form: row.dosageForm,
        strength: row.strength,
        pack_size: row.packSize,
        unit: row.unit,
        barcode: row.barcode,
        retail_price: "-",
        unit_price: "-",
        pack_price: "-",
        usage_type: row.productType,
        dar_code: "-",
        medicine_type_category: row.category,
        registration_information: "-",
      });
      if (identity) existingIdentities.add(identity);
    }

    setIsFileImporting(true);
    setCatalogError("");
    let importedCount = 0;
    try {
      for (let offset = 0; offset < newRows.length; offset += 100) {
        const batch = newRows.slice(offset, offset + 100);
        const { error } = await supabase.from("pharmacy_catalog_products").insert(batch);
        if (error) throw error;
        importedCount += batch.length;
      }
      if (importedCount > 0) {
        const rows = await loadCatalogProducts(ownerId);
        setCatalogProducts(rows);
        newRows.slice(0, importedCount).forEach((row) => {
          rememberSuggestion("dosageForm", row.dosage_form);
          rememberSuggestion("strength", row.strength);
          rememberSuggestion("packSize", row.pack_size);
          rememberSuggestion("barcode", row.barcode);
        });
      }
      setImportStatus(`Imported ${importedCount} product(s). ${duplicateCount} duplicate(s) skipped.`);
      setImportRows([]);
      setImportWarnings([]);
    } catch (importError) {
      setImportStatus("");
      setCatalogError(importedCount
        ? `Import stopped after ${importedCount} product(s): ${importError instanceof Error ? importError.message : "Could not save product data."}`
        : importError instanceof Error ? importError.message : "Could not save product data.");
    } finally {
      setIsFileImporting(false);
    }
  }

  function rememberSuggestion(field: SuggestionField, value: string) {
    const cleanValue = value.trim();
    if (!cleanValue) return;
    setSuggestions((current) => current[field].includes(cleanValue)
      ? current
      : { ...current, [field]: [...current[field], cleanValue] });
  }

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: keyof Omit<Product, "id">) => String(form.get(name) ?? "").trim();
    const product: Product = {
      id: nextProductId,
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
    setProducts((current) => [product, ...current]);
    rememberSuggestion("dosageForm", product.dosageForm);
    rememberSuggestion("strength", product.strength);
    rememberSuggestion("packSize", product.packSize);
    rememberSuggestion("barcode", product.barcode);
    setIsAddOpen(false);
  }

  function closeModal() {
    setIsAddOpen(false);
    setSelectedProduct(null);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f7", color: "#202624", fontFamily: "Inter, Arial, sans-serif" }}>
      <header
        className="dashboard-navbar"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          minHeight: 62,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 24px",
          background: "#fff",
          borderBottom: "1px solid #e8e8e6",
        }}
      >
        <PharmacyDashboardBrand />
        <div className="dashboard-navbar-actions" style={{ display: "flex", alignItems: "center", gap: 16, color: "#64716d", fontSize: 12 }}>
          <DashboardLanguageMenu />
          <span className="dashboard-navbar-store-name"><PharmacyDashboardStoreName /></span>
          <PharmacyProfileMenu />
        </div>
      </header>
      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, padding: "32px clamp(18px, 4vw, 48px) 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
            <div>
              <div style={{ color: "#72807b", fontSize: 12, marginBottom: 8 }}>Pharmacy / Product Management</div>
              <h1 style={{ margin: 0, color: "#172622", fontSize: 30, lineHeight: 1.2, fontWeight: 750 }}>Product Management</h1>
              <p style={{ margin: "8px 0 0", color: "#6a7973", fontSize: 14 }}>Manage your pharmacy catalog, prices, and product availability.</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                aria-expanded={isImportOpen}
                onClick={() => setIsImportOpen((open) => !open)}
                style={{ border: "1px solid #179c70", borderRadius: 7, background: "#fff", color: "#17704e", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}
              >
                {isImportOpen ? "Hide Import" : "Import Product Data"}
              </button>
              <button type="button" onClick={() => setIsAddOpen(true)} style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}>
                + Add product
              </button>
            </div>
          </div>

          {catalogError && !isImportOpen && (
            <p role="alert" style={{ margin: "0 0 16px", color: "#b34b43", fontSize: 12 }}>{catalogError}</p>
          )}

          {isImportOpen && (
            <section style={{ marginBottom: 22, padding: 18, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, color: "#26352f", fontSize: 16, fontWeight: 700 }}>Import Product Data</h2>
                <p style={{ margin: "6px 0 0", color: "#6a7973", fontSize: 12 }}>Import products from the shared catalog, a CSV file, or a public CSV/JSON link.</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16, padding: 14, borderRadius: 7, background: "#f7faf8" }}>
                <div>
                  <strong style={{ display: "block", color: "#26352f", fontSize: 13 }}>Auto Sync</strong>
                  <span style={{ display: "block", marginTop: 4, color: "#718078", fontSize: 11 }}>Automatically add new products added to the shared catalog.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Auto Sync"
                  aria-checked={autoSyncEnabled}
                  disabled={!ownerId || isAutoSyncLoading || isAutoSyncSaving}
                  onClick={() => void toggleAutoSync()}
                  style={{
                    width: 46,
                    height: 26,
                    padding: 3,
                    border: 0,
                    borderRadius: 999,
                    background: autoSyncEnabled ? "#179c70" : "#cbd5ce",
                    cursor: !ownerId || isAutoSyncLoading || isAutoSyncSaving ? "wait" : "pointer",
                    opacity: !ownerId || isAutoSyncLoading || isAutoSyncSaving ? 0.65 : 1,
                    transition: "background 0.15s ease",
                  }}
                >
                  <span style={{ display: "block", width: 20, height: 20, borderRadius: "50%", background: "#fff", transform: autoSyncEnabled ? "translateX(20px)" : "translateX(0)", transition: "transform 0.15s ease" }} />
                </button>
              </div>
              {isAutoSyncLoading && <p role="status" style={{ margin: "8px 0 0", color: "#718078", fontSize: 11 }}>Loading Auto Sync setting...</p>}
              {isAutoSyncSaving && <p role="status" style={{ margin: "8px 0 0", color: "#718078", fontSize: 11 }}>Saving Auto Sync setting...</p>}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #edf0ed" }}>
                <h3 style={{ margin: "0 0 6px", color: "#26352f", fontSize: 13 }}>Shared product catalog</h3>
                <p style={{ margin: "0 0 10px", color: "#718078", fontSize: 11 }}>Choose a manufacturer or import all available shared products.</p>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <select
                    aria-label="Manufacturer / company"
                    value={selectedCompany}
                    onChange={(event) => setSelectedCompany(event.currentTarget.value)}
                    disabled={isCatalogLoading || isCatalogImporting}
                    style={{ ...fieldStyle, width: "min(360px, 100%)", padding: "9px 10px" }}
                  >
                    <option value="">Select manufacturer / company</option>
                    {catalogCompanies.map((company) => (
                      <option key={company.name} value={company.name}>{company.name} ({company.count})</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedCompany || isCatalogImporting || isCatalogLoading}
                    onClick={() => void importSharedCatalog(selectedCompany)}
                    style={{ border: "1px solid #179c70", borderRadius: 6, background: "#fff", color: "#17704e", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: !selectedCompany || isCatalogImporting ? "not-allowed" : "pointer", opacity: !selectedCompany || isCatalogImporting ? 0.6 : 1 }}
                  >
                    Import company products
                  </button>
                  <button
                    type="button"
                    disabled={!catalogCompanies.length || isCatalogImporting || isCatalogLoading}
                    onClick={() => void importSharedCatalog()}
                    style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: !catalogCompanies.length || isCatalogImporting ? "not-allowed" : "pointer", opacity: !catalogCompanies.length || isCatalogImporting ? 0.6 : 1 }}
                  >
                    All Data Import
                  </button>
                </div>
                {isCatalogLoading && <p role="status" style={{ margin: "9px 0 0", color: "#718078", fontSize: 11 }}>Loading shared catalog...</p>}
                {!isCatalogLoading && catalogCompanies.length === 0 && <p style={{ margin: "9px 0 0", color: "#718078", fontSize: 11 }}>No new shared products available.</p>}
                {isCatalogImporting && <p role="status" style={{ margin: "9px 0 0", color: "#17704e", fontSize: 11 }}>Importing shared products...</p>}
                {catalogImportStatus && <p role="status" style={{ margin: "9px 0 0", color: "#17704e", fontSize: 11 }}>{catalogImportStatus}</p>}
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #edf0ed" }}>
                <h3 style={{ margin: "0 0 6px", color: "#26352f", fontSize: 13 }}>Import from a file or link</h3>
                <p style={{ margin: "0 0 10px", color: "#718078", fontSize: 11 }}>Supported headers include Product Name, Medicine Name, Brand, Manufacturer, Strength, Dosage Form, Pack Size, and Barcode.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  aria-label="Select product data file"
                  onChange={(event) => void handleFileSelection(event)}
                  style={{ display: "none" }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#34453b", padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Upload CSV/JSON
                  </button>
                  <span style={{ color: "#718078", fontSize: 11 }}>{importFileName || "No file selected"}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <input
                    aria-label="Public product data link"
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.currentTarget.value)}
                    placeholder="Paste a public HTTPS CSV/JSON or GitHub link"
                    style={{ ...fieldStyle, flex: "1 1 320px", width: "auto", padding: "9px 10px" }}
                  />
                  <button
                    type="button"
                    disabled={isResolvingSource}
                    onClick={() => void handleResolveSource()}
                    style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#34453b", padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: isResolvingSource ? "wait" : "pointer" }}
                  >
                    Load link
                  </button>
                  {sourceOptions.length > 1 && (
                    <>
                      <select
                        aria-label="Choose product data file"
                        value={selectedSourceUrl}
                        onChange={(event) => setSelectedSourceUrl(event.currentTarget.value)}
                        style={{ ...fieldStyle, flex: "1 1 220px", width: "auto", padding: "9px 10px" }}
                      >
                        {sourceOptions.map((option) => <option key={option.url} value={option.url}>{option.label}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedSourceUrl || isResolvingSource}
                        onClick={() => {
                          const option = sourceOptions.find((item) => item.url === selectedSourceUrl);
                          if (option) void loadRemoteSource(option);
                        }}
                        style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#34453b", padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: !selectedSourceUrl || isResolvingSource ? "not-allowed" : "pointer" }}
                      >
                        Load selected
                      </button>
                    </>
                  )}
                </div>
                {importRows.length > 0 && (
                  <p style={{ margin: "10px 0 0", color: "#526158", fontSize: 11 }}>
                    Preview: {importRows.length} product row(s) ready
                    {importWarnings.length ? ` · ${importWarnings.length} warning(s)` : ""}
                  </p>
                )}
                {importWarnings.length > 0 && (
                  <ul style={{ maxHeight: 90, overflow: "auto", margin: "6px 0 0", paddingLeft: 20, color: "#8a6a20", fontSize: 11 }}>
                    {importWarnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
                    {importWarnings.length > 5 && <li>{importWarnings.length - 5} more warning(s)</li>}
                  </ul>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                  {importStatus && <p role="status" style={{ margin: 0, color: importRows.length ? "#17704e" : "#8a6a20", fontSize: 11 }}>{importStatus}</p>}
                  <button
                    type="button"
                    disabled={!importRows.length || isFileImporting || !ownerId}
                    onClick={() => void importStagedProducts()}
                    style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: !importRows.length || isFileImporting || !ownerId ? "not-allowed" : "pointer", opacity: !importRows.length || isFileImporting || !ownerId ? 0.6 : 1 }}
                  >
                    {isFileImporting ? "Importing..." : "Import selected data"}
                  </button>
                </div>
              </div>
              {catalogError && <p role="alert" style={{ margin: "12px 0 0", color: "#b34b43", fontSize: 12 }}>{catalogError}</p>}
            </section>
          )}

          <section style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Product list <span style={{ color: "#8a9690", fontSize: 12, fontWeight: 500 }}>({allProducts.length})</span></h2>
              <input aria-label="Search products" placeholder="Search products..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} style={{ width: 240, maxWidth: "100%", border: "1px solid #e0e6e1", borderRadius: 6, padding: "8px 10px", color: "#26352f", fontSize: 12, outlineColor: "#28a879" }} />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980, textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Product ID", "Medicine Name", "Brand", "Manufacturer", "Dosage Form", "Strength", "Pack Size", "Unit", "Action"].map((column) => (
                      <th key={column} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id}>
                      {[product.id, product.medicineName, product.brand, product.manufacturer, product.dosageForm, product.strength, product.packSize, product.unit].map((cell, index) => (
                        <td key={`${product.id}-${index}`} style={{ padding: "13px", borderBottom: "1px solid #f0f2f0", color: index < 2 ? "#26352f" : "#687871", fontSize: 12, fontWeight: index < 2 ? 600 : 400, whiteSpace: "nowrap" }}>{cell || "—"}</td>
                      ))}
                      <td style={{ padding: "13px", borderBottom: "1px solid #f0f2f0" }}>
                        <button type="button" onClick={() => setSelectedProduct(product)} style={{ border: "1px solid #dce6df", borderRadius: 5, background: "#fff", color: "#227553", padding: "6px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Details</button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: "52px 20px", textAlign: "center", color: "#77857d", fontSize: 13 }}>
                        {searchTerm ? "No products match your search." : "No products yet. Select Add product to create your first item."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 16px", color: "#87928c", fontSize: 11 }}>Showing {filteredProducts.length} of {allProducts.length} products</div>
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