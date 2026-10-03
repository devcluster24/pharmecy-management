"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const saleTypes = ["Prescription Sale", "Wholesale", "New Sale"] as const;
type SaleType = (typeof saleTypes)[number];

type SaleProduct = {
  id: string;
  brand: string;
  genericName: string;
  medicineName: string;
  retailPrice: string;
  unit: string;
  packSize: string;
};

type SaleLine = {
  product: SaleProduct;
  quantities: [string, string, string];
  quantityTotal: string;
  unitPrice: string;
  boxCountEnabled: boolean;
  boxCountQty: string;
  boxCountTotalPrice: string;
};

type EntryModal = {
  productId: string;
  mode: "quantity" | "boxCount";
} | null;

type PharmacyProductRow = {
  id: string;
  brand: string;
  generic_name: string;
  medicine_name: string;
  retail_price: string;
  unit: string;
  pack_size: string;
};

const MATCH_LIMIT = 30;
const inputStyle = {
  boxSizing: "border-box" as const,
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "9px 10px",
  fontSize: 13,
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Could not load products. Please try again.";
}

function mapProduct(row: PharmacyProductRow): SaleProduct {
  return {
    id: row.id,
    brand: row.brand.trim() || row.medicine_name.trim(),
    genericName: row.generic_name,
    medicineName: row.medicine_name,
    retailPrice: row.retail_price,
    unit: row.unit,
    packSize: row.pack_size,
  };
}

function getUnitPrice(price: string) {
  const parsedPrice = Number.parseFloat(price.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
}

function formatPrice(price: number) {
  return `৳${price.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getQuantityTotal(quantities: [string, string, string]) {
  return quantities.reduce((sum, quantity) => {
    const parsed = Number.parseInt(quantity, 10);
    return sum + (Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
  }, 0);
}

function clearZeroOnFocus(value: string, clear: () => void) {
  if (value === "0" || value === "0.00") clear();
}

function getMatchRank(product: SaleProduct, query: string) {
  const brand = product.brand.toLocaleLowerCase();
  const generic = product.genericName.toLocaleLowerCase();
  const medicine = product.medicineName.toLocaleLowerCase();
  if (brand === query) return 0;
  if (brand.startsWith(query)) return 1;
  if (brand.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (brand.includes(query)) return 3;
  if (generic.startsWith(query) || medicine.startsWith(query)) return 4;
  return 5;
}

export default function SalesActions() {
  const [activeSaleType, setActiveSaleType] = useState<SaleType | null>(null);
  const [matchingProducts, setMatchingProducts] = useState<SaleProduct[]>([]);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(true);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [productError, setProductError] = useState("");
  const [entryModal, setEntryModal] = useState<EntryModal>(null);
  const [quantityDraft, setQuantityDraft] = useState<[string, string, string]>(["0", "0", "0"]);
  const [quantityTotalDraft, setQuantityTotalDraft] = useState("0");
  const [boxCountQtyDraft, setBoxCountQtyDraft] = useState("0");
  const [boxCountPriceDraft, setBoxCountPriceDraft] = useState("0");
  const searchSequence = useRef(0);
  const selectedProductIds = useRef(new Set<string>());

  useEffect(() => {
    if (!activeSaleType) return;
    const query = searchTerm.trim();
    if (!query) return;

    let active = true;
    const requestSequence = ++searchSequence.current;
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!session?.user.id) throw new Error("Sign in to search products.");

          const escapedQuery = query.replace(/[\\%_,()]/g, (character) => `\\${character}`);
          const { data, error } = await supabase
            .from("pharmacy_catalog_products")
            .select("id, brand, generic_name, medicine_name, retail_price, unit, pack_size")
            .eq("owner_user_id", session.user.id)
            .or(`brand.ilike.%${escapedQuery}%,generic_name.ilike.%${escapedQuery}%,medicine_name.ilike.%${escapedQuery}%`)
            .order("brand", { ascending: true })
            .limit(MATCH_LIMIT);
          if (error) throw error;

          if (!active || requestSequence !== searchSequence.current) return;
          const normalizedQuery = query.toLocaleLowerCase();
          const matches = ((data ?? []) as PharmacyProductRow[])
            .map(mapProduct)
            .filter((product) => !selectedProductIds.current.has(product.id))
            .sort((left, right) =>
              getMatchRank(left, normalizedQuery) - getMatchRank(right, normalizedQuery)
              || left.brand.localeCompare(right.brand),
            )
            .slice(0, 8);
          setMatchingProducts(matches);
          setProductError("");
        } catch (error) {
          if (active && requestSequence === searchSequence.current) {
            setMatchingProducts([]);
            setProductError(getErrorMessage(error));
          }
        } finally {
          if (active && requestSequence === searchSequence.current) setIsSearchingProducts(false);
        }
      })();
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [activeSaleType, searchTerm]);

  useEffect(() => {
    if (!activeSaleType) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (entryModal) setEntryModal(null);
      else setActiveSaleType(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeSaleType, entryModal]);

  const totalUnits = saleLines.reduce(
    (total, line) => total + getQuantityTotal([line.quantityTotal, "0", "0"]),
    0,
  );
  const totalPrice = saleLines.reduce(
    (total, line) => total + getQuantityTotal([line.quantityTotal, "0", "0"]) * getUnitPrice(line.unitPrice),
    0,
  );

  function addProduct(product: SaleProduct) {
    selectedProductIds.current.add(product.id);
    setSaleLines((current) => current.some((line) => line.product.id === product.id)
      ? current
      : [...current, {
        product,
        quantities: ["0", "0", "0"],
        quantityTotal: "0",
        unitPrice: String(getUnitPrice(product.retailPrice)),
        boxCountEnabled: false,
        boxCountQty: "0",
        boxCountTotalPrice: "0",
      }]);
    setSearchTerm("");
    setMatchingProducts([]);
    setIsSearchingProducts(false);
    setIsProductSearchOpen(false);
  }

  function updateUnitPrice(productId: string, value: string) {
    setSaleLines((current) => current.map((line) => line.product.id === productId
      ? { ...line, unitPrice: value }
      : line));
  }

  function openEntryModal(line: SaleLine, mode: "quantity" | "boxCount") {
    if (mode === "quantity") {
      setQuantityDraft([...line.quantities] as [string, string, string]);
      setQuantityTotalDraft(line.quantityTotal);
    } else {
      setBoxCountQtyDraft(line.boxCountQty);
      setBoxCountPriceDraft(line.boxCountTotalPrice);
    }
    setEntryModal({ productId: line.product.id, mode });
  }

  function commitEntryModal() {
    if (!entryModal) return;
    if (entryModal.mode === "quantity") {
      const parsedTotal = Number.parseInt(quantityTotalDraft, 10);
      const first = Number.parseInt(quantityDraft[0], 10) || 0;
      const second = Number.parseInt(quantityDraft[1], 10) || 0;
      const quantities: [string, string, string] = Number.isFinite(parsedTotal) && parsedTotal >= 0
        ? parsedTotal < first + second
          ? [String(parsedTotal), "0", "0"]
          : [String(first), String(second), String(parsedTotal - first - second)]
        : quantityDraft;
      setSaleLines((current) => current.map((line) => line.product.id === entryModal.productId
        ? { ...line, quantities, quantityTotal: String(getQuantityTotal(quantities)) }
        : line));
    } else {
      setSaleLines((current) => current.map((line) => {
        if (line.product.id !== entryModal.productId) return line;
        const boxQty = Number.parseFloat(boxCountQtyDraft);
        const boxPrice = Number.parseFloat(boxCountPriceDraft);
        return {
          ...line,
          boxCountEnabled: true,
          boxCountQty: boxCountQtyDraft,
          boxCountTotalPrice: boxCountPriceDraft,
          unitPrice: Number.isFinite(boxQty) && boxQty > 0 && Number.isFinite(boxPrice) && boxPrice >= 0
            ? (boxPrice / boxQty).toFixed(2)
            : line.unitPrice,
        };
      }));
    }
    setEntryModal(null);
  }

  function removeProduct(productId: string) {
    selectedProductIds.current.delete(productId);
    setSaleLines((current) => current.filter((line) => line.product.id !== productId));
    setIsProductSearchOpen(true);
  }

  function openSale(saleType: SaleType) {
    searchSequence.current += 1;
    setMatchingProducts([]);
    selectedProductIds.current.clear();
    setSaleLines([]);
    setSearchTerm("");
    setIsProductSearchOpen(true);
    setProductError("");
    setIsSearchingProducts(false);
    setActiveSaleType(saleType);
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {saleTypes.map((saleType, index) => (
          <button
            key={saleType}
            type="button"
            onClick={() => openSale(saleType)}
            style={{
              border: index === 0 ? 0 : "1px solid #dce5df",
              borderRadius: 7,
              background: index === 0 ? "#179c70" : "#fff",
              color: index === 0 ? "#fff" : "#405248",
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 650,
              cursor: "pointer",
            }}
          >
            {saleType}
          </button>
        ))}
      </div>

      {activeSaleType && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveSaleType(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(15, 28, 21, 0.48)",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-sale-title"
            style={{
              display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr) auto",
              width: "min(900px, 100%)",
              maxHeight: "min(90vh, 850px)",
              borderRadius: 10,
              background: "#fff",
              boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="new-sale-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>{activeSaleType}</h2>
                <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 12 }}>Search the Product List and add quantities.</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActiveSaleType(null)}
                style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <div style={{ minHeight: 0, overflowY: "auto", padding: 24 }}>
              {productError && <p role="alert" style={{ margin: "0 0 14px", color: "#ad4b43", fontSize: 13 }}>{productError}</p>}
              {isProductSearchOpen && (
                <div style={{ position: "relative", marginBottom: 18 }}>
                  <label htmlFor="sale-product-search" style={{ display: "block", marginBottom: 6, color: "#405248", fontSize: 12, fontWeight: 650 }}>Brand Name</label>
                  <input
                    id="sale-product-search"
                    autoComplete="off"
                    value={searchTerm}
                    onChange={(event) => {
                      setSearchTerm(event.currentTarget.value);
                      setMatchingProducts([]);
                      setProductError("");
                      setIsSearchingProducts(Boolean(event.currentTarget.value.trim()));
                    }}
                    placeholder="Type a brand name to search..."
                    style={{ ...inputStyle, width: "100%" }}
                  />
                  {searchTerm.trim() && (isSearchingProducts || matchingProducts.length > 0 || productError) && (
                    <div role="listbox" aria-label="Matching products" style={{ position: "absolute", zIndex: 2, top: "100%", left: 0, right: 0, maxHeight: 240, overflowY: "auto", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", boxShadow: "0 8px 24px rgba(7, 28, 17, 0.12)" }}>
                      {isSearchingProducts ? (
                        <p role="status" style={{ margin: 0, padding: "10px 12px", color: "#77857d", fontSize: 12 }}>Searching products...</p>
                      ) : productError ? (
                        <p role="alert" style={{ margin: 0, padding: "10px 12px", color: "#ad4b43", fontSize: 12 }}>{productError}</p>
                      ) : matchingProducts.length ? matchingProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onClick={() => addProduct(product)}
                          style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 12, border: 0, borderBottom: "1px solid #edf0ed", background: "#fff", padding: "10px 12px", textAlign: "left", cursor: "pointer" }}
                        >
                          <span>
                            <strong style={{ display: "block", color: "#26352f", fontSize: 13 }}>{product.brand}</strong>
                            {product.genericName && <small style={{ display: "block", marginTop: 3, color: "#77857d", fontSize: 11 }}>{product.genericName}</small>}
                          </span>
                          <span style={{ flexShrink: 0, color: "#17704e", fontSize: 12 }}>{formatPrice(getUnitPrice(product.retailPrice))}</span>
                        </button>
                      )) : (
                        <p style={{ margin: 0, padding: "10px 12px", color: "#77857d", fontSize: 12 }}>No matching brand found.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {saleLines.length > 0 && (
                <div style={{ display: "grid", gap: 10 }}>
                  {saleLines.map((line) => {
                    const quantityTotal = getQuantityTotal([line.quantityTotal, "0", "0"]);
                    const unitPrice = getUnitPrice(line.unitPrice);
                    return (
                      <div key={line.product.id} style={{ overflowX: "auto", border: "1px solid #e5ebe6", borderRadius: 7 }}>
                        <article style={{ display: "grid", gridTemplateColumns: "minmax(190px, 1fr) auto 115px 115px 28px", alignItems: "center", gap: 12, minWidth: 700, padding: 12 }}>
                          <div style={{ display: "grid", justifyItems: "start", gap: 6, minWidth: 0 }}>
                            <strong style={{ display: "block", overflow: "hidden", color: "#26352f", fontSize: 13, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.product.brand}</strong>
                            <small style={{ display: "block", marginTop: 3, overflow: "hidden", color: "#77857d", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[line.product.genericName, line.product.packSize, line.product.unit].filter(Boolean).join(" · ") || line.product.medicineName}</small>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {quantityTotal > 0 && <small style={{ borderRadius: 4, background: "#eef6f1", padding: "3px 6px", color: "#17704e", fontSize: 10 }}>Quantity: {line.quantities.join(" + ")} = {quantityTotal}</small>}
                              {line.boxCountEnabled && <small style={{ borderRadius: 4, background: "#f4f1e8", padding: "3px 6px", color: "#80631b", fontSize: 10 }}>Box Count: {line.boxCountQty} × {formatPrice(getUnitPrice(line.unitPrice))} = {formatPrice(Number.parseFloat(line.boxCountTotalPrice) || 0)}</small>}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            <button type="button" onClick={() => openEntryModal(line, "quantity")} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#405248", padding: "6px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Quantity</button>
                            <button type="button" onClick={() => openEntryModal(line, "boxCount")} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#405248", padding: "6px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>+ Box Count</button>
                          </div>
                          <label style={{ color: "#77857d", fontSize: 10 }}>
                            Unit Price
                            <input
                              aria-label={`${line.product.brand} unit price`}
                              type="text"
                              inputMode="decimal"
                              value={line.unitPrice}
                              onFocus={() => clearZeroOnFocus(line.unitPrice, () => updateUnitPrice(line.product.id, ""))}
                              onChange={(event) => updateUnitPrice(line.product.id, event.currentTarget.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                              onBlur={() => { if (!line.unitPrice) updateUnitPrice(line.product.id, "0"); }}
                              style={{ ...inputStyle, display: "block", width: "100%", marginTop: 5, padding: "7px 5px" }}
                            />
                          </label>
                          <div style={{ textAlign: "right" }}>
                            <small style={{ display: "block", marginBottom: 5, color: "#77857d", fontSize: 10 }}>Total Price</small>
                            <strong style={{ color: "#17704e", fontSize: 12 }}>{formatPrice(unitPrice * quantityTotal)}</strong>
                          </div>
                          <button type="button" aria-label={`Remove ${line.product.brand}`} onClick={() => removeProduct(line.product.id)} style={{ border: 0, background: "transparent", color: "#ad4b43", fontSize: 18, cursor: "pointer" }}>×</button>
                        </article>
                      </div>
                    );
                  })}
                </div>
              )}
              {saleLines.some((line) => getQuantityTotal(line.quantities) > 0 || line.boxCountEnabled) && !isProductSearchOpen && (
                <button type="button" onClick={() => setIsProductSearchOpen(true)} style={{ marginTop: 14, border: "1px dashed #b8c8be", borderRadius: 6, background: "#fbfcfb", color: "#17704e", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>
                  + Add another Brand Name
                </button>
              )}
            </div>

            <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "15px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <div style={{ display: "flex", gap: 24, color: "#405248", fontSize: 13 }}>
                <span>Total units: <strong>{totalUnits}</strong></span>
                <span>Total price: <strong style={{ color: "#17704e" }}>{formatPrice(totalPrice)}</strong></span>
              </div>
              <button type="button" onClick={() => setActiveSaleType(null)} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {activeSaleType && entryModal && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEntryModal(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.42)" }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="sale-entry-title" style={{ width: "min(420px, 100%)", borderRadius: 9, background: "#fff", boxShadow: "0 20px 60px rgba(7, 28, 17, 0.25)" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #e9eeea" }}>
              <h3 id="sale-entry-title" style={{ margin: 0, color: "#20342a", fontSize: 16, fontWeight: 700 }}>
                {entryModal.mode === "quantity" ? "Quantity" : "Box Count"}
              </h3>
              <button type="button" aria-label="Close" onClick={() => setEntryModal(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 22, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <div style={{ display: "grid", gap: 14, padding: 20 }}>
              {entryModal.mode === "quantity" ? (
                <>
                  <label style={{ color: "#405248", fontSize: 12, fontWeight: 600 }}>
                    Quantity
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                      {quantityDraft.map((quantity, index) => (
                        <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          {index > 0 && <span style={{ color: "#87938d" }}>+</span>}
                          <input
                            aria-label={`Quantity ${index + 1}`}
                            type="text"
                            inputMode="numeric"
                            value={quantity}
                            onFocus={() => clearZeroOnFocus(quantity, () => setQuantityDraft((current) => current.map((item, itemIndex) => itemIndex === index ? "" : item) as [string, string, string]))}
                            onChange={(event) => {
                              const value = event.currentTarget.value.replace(/\D/g, "");
                              setQuantityDraft((current) => {
                                const updated = current.map((item, itemIndex) => itemIndex === index ? value : item) as [string, string, string];
                                setQuantityTotalDraft(String(getQuantityTotal(updated)));
                                return updated;
                              });
                            }}
                            onBlur={() => {
                              if (!quantityDraft[index]) {
                                setQuantityDraft((current) => current.map((item, itemIndex) => itemIndex === index ? "0" : item) as [string, string, string]);
                              }
                            }}
                            style={{ ...inputStyle, width: 70, textAlign: "center" }}
                          />
                        </span>
                      ))}
                    </div>
                  </label>
                  <label style={{ color: "#405248", fontSize: 12, fontWeight: 600 }}>
                    Total Qty
                    <input
                      type="text"
                      inputMode="numeric"
                      value={quantityTotalDraft}
                      onFocus={() => clearZeroOnFocus(quantityTotalDraft, () => setQuantityTotalDraft(""))}
                      onChange={(event) => {
                        const value = event.currentTarget.value.replace(/\D/g, "");
                        setQuantityTotalDraft(value);
                        const parsed = Number.parseInt(value, 10);
                        const first = Number.parseInt(quantityDraft[0], 10) || 0;
                        const second = Number.parseInt(quantityDraft[1], 10) || 0;
                        if (Number.isFinite(parsed)) {
                          setQuantityDraft(parsed < first + second
                            ? [String(parsed), "0", "0"]
                            : [String(first), String(second), String(parsed - first - second)]);
                        }
                      }}
                      onBlur={() => { if (!quantityTotalDraft) setQuantityTotalDraft("0"); }}
                      style={{ ...inputStyle, display: "block", width: "100%", marginTop: 6 }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label style={{ color: "#405248", fontSize: 12, fontWeight: 600 }}>
                    Qty
                    <input
                      type="text"
                      inputMode="decimal"
                      value={boxCountQtyDraft}
                      onFocus={() => clearZeroOnFocus(boxCountQtyDraft, () => setBoxCountQtyDraft(""))}
                      onChange={(event) => setBoxCountQtyDraft(event.currentTarget.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                      onBlur={() => { if (!boxCountQtyDraft) setBoxCountQtyDraft("0"); }}
                      style={{ ...inputStyle, display: "block", width: "100%", marginTop: 6 }}
                    />
                  </label>
                  <label style={{ color: "#405248", fontSize: 12, fontWeight: 600 }}>
                    Total Price
                    <input
                      type="text"
                      inputMode="decimal"
                      value={boxCountPriceDraft}
                      onFocus={() => clearZeroOnFocus(boxCountPriceDraft, () => setBoxCountPriceDraft(""))}
                      onChange={(event) => setBoxCountPriceDraft(event.currentTarget.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                      onBlur={() => { if (!boxCountPriceDraft) setBoxCountPriceDraft("0"); }}
                      style={{ ...inputStyle, display: "block", width: "100%", marginTop: 6 }}
                    />
                  </label>
                  <small style={{ color: "#77857d", fontSize: 11 }}>Unit Price = Total Price ÷ Qty</small>
                </>
              )}
            </div>
            <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <button type="button" onClick={() => setEntryModal(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={commitEntryModal} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Add</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
