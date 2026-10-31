'use client';

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Sidebar from "../components/Sidebar";

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

function ProductManagementHeader() {
  return (
    <header style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e8e8e6" }}>
      <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, color: "#202624", textDecoration: "none" }}>
        <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "#2ad49a", color: "#07372b", fontSize: 14 }}>✚</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Pharmecy Cluster</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#64716d", fontSize: 12 }}>
        <span>Green Valley Pharmacy</span>
        <span style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", background: "#e4f5ee", color: "#187553", fontWeight: 700 }}>PC</span>
      </div>
    </header>
  );
}

export default function ProductManagementPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(initialSuggestions);
  const [storageReady, setStorageReady] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

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

  const filteredProducts = products.filter((product) =>
    [product.id, product.medicineName, product.brand, product.genericName, product.manufacturer, product.barcode]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );
  const nextProductId = `MED-${String(products.length + 1).padStart(4, "0")}`;

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
      <ProductManagementHeader />
      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, padding: "32px clamp(18px, 4vw, 48px) 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
            <div>
              <div style={{ color: "#72807b", fontSize: 12, marginBottom: 8 }}>Pharmacy / Product Management</div>
              <h1 style={{ margin: 0, color: "#172622", fontSize: 30, lineHeight: 1.2, fontWeight: 750 }}>Product Management</h1>
              <p style={{ margin: "8px 0 0", color: "#6a7973", fontSize: 14 }}>Manage your pharmacy catalog, prices, and product availability.</p>
            </div>
            <button type="button" onClick={() => setIsAddOpen(true)} style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}>
              + Add product
            </button>
          </div>

          <section style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#26352f", fontSize: 15, fontWeight: 700 }}>Product list <span style={{ color: "#8a9690", fontSize: 12, fontWeight: 500 }}>({products.length})</span></h2>
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