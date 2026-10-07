"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { downloadSaleInvoicePdf } from "./saleInvoicePdf";
import { persistSale, type SalesListRow } from "./salesStorage";
import {
  emptyPurchaseListSnapshot,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
} from "./purchaseStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";

const saleTypes = ["New Sale"] as const;
type SaleType = (typeof saleTypes)[number];

type SaleProduct = {
  id: string;
  brand: string;
  genericName: string;
  medicineName: string;
  strength: string;
  unit: string;
  packSize: string;
  boxPrice: string;
  unitPrice: string;
  batchNumber: string;
  expDate: string;
  isExpired: boolean;
};

type SaleLine = {
  id: string;
  product: SaleProduct;
  batchOptions: SaleProduct[];
  selectedBatches: SaleProduct[];
  quantity: string;
};

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

function mapInventoryRow(row: {
  id: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  batchNumber: string;
  expDate: string;
  mrp?: string;
  unitPrice: string;
  packPrice: string;
  productPackPrice?: string;
  packSize: string;
}): SaleProduct {
  const boxPrice = [row.mrp, row.productPackPrice, row.packPrice]
    .find((price) => Boolean(price?.trim() && price.trim() !== "-"));
  return {
    id: row.id,
    brand: row.brand.trim(),
    genericName: row.genericName,
    medicineName: row.brand,
    strength: row.strength,
    unit: row.dosageForm,
    packSize: row.packSize,
    boxPrice: boxPrice || "0",
    unitPrice: row.unitPrice,
    batchNumber: row.batchNumber,
    expDate: row.expDate,
    isExpired: isInventoryItemExpired(row.expDate),
  };
}

function getUnitPrice(price: string) {
  const parsedPrice = Number.parseFloat(price.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
}

function formatPrice(price: number) {
  return `৳${price.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function roundCurrency(amount: number) {
  return Number(amount.toFixed(2));
}

function getQuantityTotal(quantity: string) {
  const parsed = Number.parseInt(quantity, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
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

function getProductGroupKey(product: SaleProduct) {
  return JSON.stringify([
    product.brand,
    product.genericName,
    product.strength,
    product.unit,
    product.packSize,
  ].map((value) => value.trim().toLocaleLowerCase()));
}

export default function SalesActions() {
  const inventorySnapshot = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const [activeSaleType, setActiveSaleType] = useState<SaleType | null>(null);
  const [matchingProducts, setMatchingProducts] = useState<SaleProduct[]>([]);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [payAmount, setPayAmount] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [keyboardActiveGroupKey, setKeyboardActiveGroupKey] = useState<string | null>(null);
  const [batchSelectionLineId, setBatchSelectionLineId] = useState<string | null>(null);
  const [batchSearchTerm, setBatchSearchTerm] = useState("");
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [productError, setProductError] = useState("");
  const [saleSaveError, setSaleSaveError] = useState("");
  const [saleInvoice, setSaleInvoice] = useState<SalesListRow | null>(null);
  const [invoicePdfError, setInvoicePdfError] = useState("");
  const [expiredProduct, setExpiredProduct] = useState<SaleProduct | null>(null);
  const searchSequence = useRef(0);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  useEffect(() => {
    if (!activeSaleType) return;
    const query = searchTerm.trim();
    if (!query) return;

    let active = true;
    const requestSequence = ++searchSequence.current;
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          if (inventorySnapshot.error) throw new Error(inventorySnapshot.error);

          if (!active || requestSequence !== searchSequence.current) return;
          const normalizedQuery = query.toLocaleLowerCase();
          const matches = inventorySnapshot.rows
            .map(mapInventoryRow)
            .filter((product) =>
              product.brand.toLocaleLowerCase().includes(normalizedQuery)
              || product.genericName.toLocaleLowerCase().includes(normalizedQuery),
            )
            .filter((product) => !selectedProductIds.includes(product.id))
            .sort((left, right) =>
              getMatchRank(left, normalizedQuery) - getMatchRank(right, normalizedQuery)
              || left.brand.localeCompare(right.brand)
              || left.expDate.localeCompare(right.expDate),
            )
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
  }, [activeSaleType, inventorySnapshot, searchTerm, selectedProductIds]);

  useEffect(() => {
    if (!activeSaleType) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (expiredProduct) setExpiredProduct(null);
      else if (batchSelectionLineId) setBatchSelectionLineId(null);
      else setActiveSaleType(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeSaleType, batchSelectionLineId, expiredProduct]);

  const totalUnits = saleLines.reduce(
    (total, line) => total + getQuantityTotal(line.quantity),
    0,
  );
  const totalPrice = saleLines.reduce(
    (total, line) => total + roundCurrency(getQuantityTotal(line.quantity) * getUnitPrice(line.selectedBatches[0]?.unitPrice ?? "0")),
    0,
  );
  const hasPayAmount = payAmount.trim() !== "";
  const parsedPayAmount = hasPayAmount ? roundCurrency(Number(payAmount)) : 0;
  const validPayAmount = hasPayAmount
    && Number.isFinite(parsedPayAmount)
    && parsedPayAmount >= 0
    && parsedPayAmount <= totalPrice;
  const dueAmount = validPayAmount ? roundCurrency(Math.max(0, totalPrice - parsedPayAmount)) : 0;
  const matchingProductGroups = [...matchingProducts.reduce((groups, product) => {
    const groupKey = getProductGroupKey(product);
    const group = groups.get(groupKey) ?? [];
    group.push(product);
    groups.set(groupKey, group);
    return groups;
  }, new Map<string, SaleProduct[]>()).entries()];

  function addProductsToSale(products: SaleProduct[]) {
    if (products.length === 0) return;
    const groupKey = getProductGroupKey(products[0]);

    setSelectedProductIds((current) => [
      ...current,
      ...products.map((product) => product.id).filter((id) => !current.includes(id)),
    ]);
    setSaleLines((current) => {
      if (current.some((line) => getProductGroupKey(line.product) === groupKey)) return current;
      const availableBatches = products.filter((product) => !product.isExpired);
      const selectedBatches = availableBatches.length === 1 ? availableBatches : [];
      return [
        ...current,
        { id: products[0].id, product: products[0], batchOptions: products, selectedBatches, quantity: selectedBatches.length ? "0" : "" },
      ];
    });
    if (products.filter((product) => !product.isExpired).length !== 1) {
      setBatchSelectionLineId(products[0].id);
      setBatchSearchTerm("");
    }
    setSearchTerm("");
    setKeyboardActiveGroupKey(null);
    setMatchingProducts([]);
    setIsSearchingProducts(false);
  }

  function handleProductSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matchingProductGroups.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = matchingProductGroups.findIndex(([groupKey]) => groupKey === keyboardActiveGroupKey);
      const nextIndex = currentIndex < 0
        ? event.key === "ArrowDown" ? 0 : matchingProductGroups.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + matchingProductGroups.length) % matchingProductGroups.length;
      setKeyboardActiveGroupKey(matchingProductGroups[nextIndex][0]);
      return;
    }
    if (event.key !== "Enter") return;

    const selectedGroup = matchingProductGroups.find(([groupKey]) => groupKey === keyboardActiveGroupKey)
      ?? (matchingProductGroups.length === 1 ? matchingProductGroups[0] : undefined);
    if (!selectedGroup) return;
    event.preventDefault();
    addProductsToSale(selectedGroup[1]);
  }

  function removeProduct(productId: string) {
    const removedLine = saleLines.find((line) => line.id === productId);
    const hasAnotherLineForProduct = saleLines.some((line) =>
      line.id !== productId
      && removedLine
      && getProductGroupKey(line.product) === getProductGroupKey(removedLine.product),
    );
    if (!hasAnotherLineForProduct && removedLine) {
      const removedIds = new Set(removedLine.batchOptions.map((product) => product.id));
      setSelectedProductIds((current) => current.filter((id) => !removedIds.has(id)));
    }
    setSaleLines((current) => current.filter((line) => line.id !== productId));
  }

  function openBatchSelection(line: SaleLine) {
    setBatchSelectionLineId(line.id);
    setBatchSearchTerm("");
  }

  function selectBatchForSale(line: SaleLine, batch: SaleProduct) {
    if (batch.isExpired) {
      setExpiredProduct(batch);
      return;
    }
    setSaleLines((current) => current.map((saleLine) => {
      if (saleLine.id !== line.id) return saleLine;
      const isSelected = saleLine.selectedBatches.some((selectedBatch) => selectedBatch.id === batch.id);
      const selectedBatches = isSelected
        ? saleLine.selectedBatches.filter((selectedBatch) => selectedBatch.id !== batch.id)
        : [...saleLine.selectedBatches, batch];
      return {
        ...saleLine,
        selectedBatches,
        quantity: selectedBatches.length > 0 ? saleLine.quantity || "0" : "",
      };
    }));
  }

  function openSale(saleType: SaleType) {
    searchSequence.current += 1;
    setMatchingProducts([]);
    setSelectedProductIds([]);
    setSaleLines([]);
    setPayAmount("");
    setSearchTerm("");
    setKeyboardActiveGroupKey(null);
    setBatchSelectionLineId(null);
    setBatchSearchTerm("");
    setProductError("");
    setSaleSaveError("");
    setIsSearchingProducts(false);
    setActiveSaleType(saleType);
  }

  function saveSale() {
    if (!validPayAmount) {
      setSaleSaveError("Pay amount must be between zero and the total price.");
      return;
    }

    const completedLines = saleLines.filter(
      (line) => line.selectedBatches.length > 0 && getQuantityTotal(line.quantity) > 0,
    );
    if (completedLines.length === 0) {
      setSaleSaveError("Add at least one product and enter a quantity greater than zero.");
      return;
    }

    const invoiceLines = completedLines.map((line) => {
      const selectedBatch = line.selectedBatches[0];
      const quantity = getQuantityTotal(line.quantity);
      const unitPrice = getUnitPrice(selectedBatch.unitPrice);
      return {
        brand: line.product.brand,
        details: [line.product.genericName, line.product.strength, line.product.unit, line.product.packSize]
          .filter(Boolean)
          .join(" · "),
        batchNumber: line.selectedBatches.map((batch) => batch.batchNumber || "-").join(", "),
        packSize: line.product.packSize || "-",
        quantity,
        unitPrice,
        totalPrice: roundCurrency(quantity * unitPrice),
      };
    });

    try {
      const savedSale = persistSale(invoiceLines, parsedPayAmount);
      setSaleSaveError("");
      setActiveSaleType(null);
      setSaleInvoice(savedSale);
      setInvoicePdfError("");
      try {
        downloadSaleInvoicePdf(savedSale);
      } catch (error) {
        setInvoicePdfError(getErrorMessage(error));
      }
    } catch (error) {
      setSaleSaveError(getErrorMessage(error));
    }
  }

  function saveInvoicePdf() {
    if (!saleInvoice) return;
    try {
      downloadSaleInvoicePdf(saleInvoice);
      setInvoicePdfError("");
    } catch (error) {
      setInvoicePdfError(getErrorMessage(error));
    }
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
              width: "min(1200px, 100%)",
              height: "min(90vh, 850px)",
              maxHeight: "calc(100vh - 32px)",
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
              {(productError || inventorySnapshot.error) && <p role="alert" style={{ margin: "0 0 14px", color: "#ad4b43", fontSize: 13 }}>{productError || inventorySnapshot.error}</p>}
              <div style={{ position: "relative", marginBottom: 18 }}>
                <label htmlFor="sale-product-search" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "#405248", fontSize: 12, fontWeight: 650 }}>
                  Brand Name
                  <span aria-label={`${inventorySnapshot.rows.length} inventory items`} style={{ borderRadius: 999, background: "#eef6f1", color: "#17704e", padding: "2px 7px", fontSize: 11 }}>
                    {inventorySnapshot.rows.length}
                  </span>
                </label>
                <input
                  id="sale-product-search"
                  autoComplete="off"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.currentTarget.value);
                    setKeyboardActiveGroupKey(null);
                    setMatchingProducts([]);
                    setProductError("");
                    setIsSearchingProducts(Boolean(event.currentTarget.value.trim()));
                  }}
                  onKeyDown={handleProductSearchKeyDown}
                  placeholder="Type a brand name to search..."
                  style={{ ...inputStyle, width: "100%" }}
                />
                {searchTerm.trim() && (isSearchingProducts || matchingProducts.length > 0 || productError) && (
                  <div aria-label="Matching inventory brands" style={{ position: "absolute", zIndex: 2, top: "100%", left: 0, right: 0, maxHeight: 320, overflowY: "auto", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", boxShadow: "0 8px 24px rgba(7, 28, 17, 0.12)" }}>
                    {isSearchingProducts ? (
                      <p role="status" style={{ margin: 0, padding: "10px 12px", color: "#77857d", fontSize: 12 }}>Searching products...</p>
                    ) : productError ? (
                      <p role="alert" style={{ margin: 0, padding: "10px 12px", color: "#ad4b43", fontSize: 12 }}>{productError}</p>
                    ) : matchingProductGroups.length ? matchingProductGroups.map(([groupKey, products]) => {
                      const firstProduct = products[0];
                      return (
                        <button
                          key={groupKey}
                          type="button"
                          aria-label={`Select ${firstProduct.brand}`}
                          onClick={() => addProductsToSale(products)}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 14, padding: "10px 12px", border: 0, borderBottom: "1px solid #edf0ed", background: groupKey === keyboardActiveGroupKey ? "#f4faf6" : "#fff", textAlign: "left", cursor: "pointer" }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", color: "#26352f", fontSize: 13 }}>{firstProduct.brand}</strong>
                            <small style={{ display: "block", marginTop: 3, color: "#77857d", fontSize: 11 }}>
                              {[firstProduct.genericName, firstProduct.strength, firstProduct.unit, firstProduct.packSize].filter(Boolean).join(" · ")}
                            </small>
                            <small style={{ display: "block", marginTop: 4, color: "#77857d", fontSize: 10 }}>
                              {products.length} batch{products.length === 1 ? "" : "es"} available
                            </small>
                          </div>
                        </button>
                      );
                    }) : (
                      <p style={{ margin: 0, padding: "10px 12px", color: "#77857d", fontSize: 12 }}>No matching brand found in Inventory.</p>
                    )}
                  </div>
                )}
              </div>

              {saleLines.length > 0 && (
                <div style={{ display: "grid", gap: 10, overflowX: "auto" }}>
                  <div
                    aria-hidden="true"
                    style={{ display: "grid", gridTemplateColumns: "150px 100px minmax(200px, 1.5fr) 90px 95px 95px 90px 110px 28px", alignItems: "center", gap: 12, minWidth: 1100, padding: "0 0 8px", borderBottom: "1px solid #e5ebe6", color: "#77857d", fontSize: 10, fontWeight: 650 }}
                  >
                    {["Brand Name", "Batch Number", "Details", "Pack Size", "Box Price", "Unit Price", "Quantity", "Total Price", ""].map((heading, index) => (
                      <span key={`${heading}-${index}`} style={{ textAlign: index >= 4 && index <= 5 ? "right" : "left" }}>{heading}</span>
                    ))}
                  </div>
                  {saleLines.map((line) => {
                    const quantity = getQuantityTotal(line.quantity);
                    const selectedBatch = line.selectedBatches[0];
                    const boxPrice = getUnitPrice(selectedBatch?.boxPrice ?? "0");
                    const unitPrice = getUnitPrice(selectedBatch?.unitPrice ?? "0");
                    const usedBatchIds = new Set(saleLines
                      .filter((otherLine) => otherLine.id !== line.id && getProductGroupKey(otherLine.product) === getProductGroupKey(line.product))
                      .flatMap((otherLine) => otherLine.selectedBatches.map((batch) => batch.id))
                      .filter((id): id is string => Boolean(id)));
                    const expiredBatches = line.batchOptions.filter((batch) => batch.isExpired);
                    const hasAnotherAvailableBatch = line.batchOptions.some((batch) =>
                      !batch.isExpired
                      && !line.selectedBatches.some((selected) => selected.id === batch.id)
                      && !usedBatchIds.has(batch.id),
                    );
                    return (
                      <div key={line.id}>
                        <article style={{ display: "grid", gridTemplateColumns: "150px 100px minmax(200px, 1.5fr) 90px 95px 95px 90px 110px 28px", alignItems: "center", gap: 12, minWidth: 1100, padding: "4px 0" }}>
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", overflow: "hidden", color: "#26352f", fontSize: 13, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.product.brand}</strong>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                              {line.selectedBatches.length > 0 ? line.selectedBatches.map((batch) => (
                                <small key={batch.id} style={{ borderRadius: 4, background: "#eef6f1", padding: "3px 5px", color: "#17704e", fontSize: 10, whiteSpace: "nowrap" }}>
                                  {batch.batchNumber || "-"}
                                </small>
                              )) : (
                                <small style={{ color: "#77857d", fontSize: 10 }}>Batch not selected</small>
                              )}
                            </div>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={() => openBatchSelection(line)}
                              style={{ border: 0, outline: "none", background: "transparent", color: "#17704e", padding: "7px 0", fontSize: 11, cursor: "pointer" }}
                            >
                              {line.selectedBatches.length > 0 ? "Edit batches" : "Select batch"}
                            </button>
                            {expiredBatches.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpiredProduct(expiredBatches[0])}
                                style={{ marginTop: 4, border: 0, background: "transparent", color: "#b42318", padding: 0, fontSize: 10, cursor: "pointer" }}
                              >
                                Expaired batch info
                              </button>
                            )}
                            {hasAnotherAvailableBatch && selectedBatch && (
                              <small style={{ display: "block", color: "#77857d", fontSize: 10 }}>More batches available</small>
                            )}
                          </div>
                          <span style={{ overflow: "hidden", color: "#77857d", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[line.product.genericName, line.product.strength, line.product.unit].filter(Boolean).join(" · ") || line.product.medicineName}
                          </span>
                          <span style={{ overflow: "hidden", color: "#526158", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.product.packSize || "-"}</span>
                          <span style={{ color: "#405248", fontSize: 12, textAlign: "right" }}>{formatPrice(boxPrice)}</span>
                          <span style={{ color: "#405248", fontSize: 12, textAlign: "right" }}>{formatPrice(unitPrice)}</span>
                          <label style={{ color: "#77857d", fontSize: 10 }}>
                            <input
                              aria-label={`${line.product.brand} quantity`}
                              type="text"
                              inputMode="numeric"
                              value={line.quantity}
                              disabled={line.selectedBatches.length === 0}
                              onFocus={() => {
                                setSaleLines((current) => current.map((currentLine) =>
                                  currentLine.id === line.id
                                    ? { ...currentLine, quantity: "" }
                                    : currentLine,
                                ));
                              }}
                              onChange={(event) => {
                                const nextQuantity = event.currentTarget.value.replace(/\D/g, "");
                                setSaleLines((current) => current.map((currentLine) =>
                                  currentLine.id === line.id
                                    ? { ...currentLine, quantity: nextQuantity }
                                    : currentLine,
                                ));
                              }}
                              placeholder={line.selectedBatches.length > 0 ? "0" : "Select batch first"}
                              style={{ ...inputStyle, display: "block", width: "100%", padding: "7px 5px", opacity: line.selectedBatches.length > 0 ? 1 : 0.55 }}
                            />
                          </label>
                          <div style={{ textAlign: "right" }}>
                            <strong style={{ color: "#17704e", fontSize: 12 }}>{formatPrice(unitPrice * quantity)}</strong>
                          </div>
                          <button type="button" aria-label={`Remove ${line.product.brand}`} onClick={() => removeProduct(line.id)} style={{ border: 0, background: "transparent", color: "#ad4b43", fontSize: 18, cursor: "pointer" }}>×</button>
                        </article>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, padding: "15px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 18, color: "#405248", fontSize: 13 }}>
                <span>Total units: <strong>{totalUnits}</strong></span>
                <span>Total price: <strong style={{ color: "#17704e" }}>{formatPrice(totalPrice)}</strong></span>
                <label style={{ display: "grid", gap: 4, color: "#526158", fontSize: 11, fontWeight: 650 }}>
                  Pay Amount
                  <input
                    className="pay-amount-input"
                    aria-label="Pay Amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={totalPrice}
                    step="0.01"
                    value={payAmount}
                    onFocus={() => setPayAmount("")}
                    onChange={(event) => setPayAmount(event.currentTarget.value)}
                    style={{ ...inputStyle, width: 130, border: "1px solid #e5ebe7", outline: "none", padding: "7px 8px", fontSize: 12 }}
                  />
                </label>
                <span style={{ display: "grid", gap: 4, color: "#526158", fontSize: 11, fontWeight: 650 }}>
                  Due
                  <strong aria-live="polite" style={{ color: dueAmount > 0 ? "#ad4b43" : "#17704e", fontSize: 13 }}>
                    {validPayAmount ? formatPrice(dueAmount) : hasPayAmount ? "Check pay amount" : "Enter pay amount"}
                  </strong>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {saleSaveError && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{saleSaveError}</p>}
                <button type="button" onClick={() => setActiveSaleType(null)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#405248", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Close</button>
                <button
                  type="button"
                  onClick={saveSale}
                  disabled={!validPayAmount}
                  style={{ border: 0, borderRadius: 6, background: validPayAmount ? "#179c70" : "#aab8b0", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: validPayAmount ? "pointer" : "not-allowed" }}
                >
                  Save
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {activeSaleType && batchSelectionLineId && (() => {
        const line = saleLines.find((saleLine) => saleLine.id === batchSelectionLineId);
        if (!line) return null;

        const normalizedBatchSearch = batchSearchTerm.trim().toLocaleLowerCase();
        const matchingBatches = line.batchOptions.filter((batch) =>
          batch.batchNumber.toLocaleLowerCase().includes(normalizedBatchSearch),
        );

        return (
          <div
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setBatchSelectionLineId(null);
            }}
            style={{ position: "fixed", inset: 0, zIndex: 75, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
          >
            <section role="dialog" aria-modal="true" aria-labelledby="sale-batch-title" style={{ display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr) auto", width: "min(520px, 100%)", maxHeight: "min(75vh, 620px)", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)", overflow: "hidden" }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "16px 20px", borderBottom: "1px solid #e9eeea" }}>
                <div>
                  <h2 id="sale-batch-title" style={{ margin: 0, color: "#20342a", fontSize: 17, fontWeight: 700 }}>Search Batch Number</h2>
                  <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 12 }}>{line.product.brand}</p>
                </div>
                <button type="button" aria-label="Close batch search" onClick={() => setBatchSelectionLineId(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
              </header>
              <div style={{ padding: "14px 20px 10px" }}>
                <label htmlFor="sale-batch-search" style={{ display: "block", marginBottom: 6, color: "#405248", fontSize: 12, fontWeight: 650 }}>Search Batch Number</label>
                <input
                  id="sale-batch-search"
                  autoComplete="off"
                  value={batchSearchTerm}
                  onChange={(event) => setBatchSearchTerm(event.currentTarget.value)}
                  placeholder="Type a batch number..."
                  style={{ ...inputStyle, width: "100%" }}
                />
              </div>
              <div style={{ minHeight: 0, overflowY: "auto", padding: "0 20px 16px" }}>
                {matchingBatches.length > 0 ? (
                  <div style={{ display: "grid" }}>
                    {matchingBatches.map((batch) => {
                      const isUsedByAnotherRow = saleLines.some((saleLine) =>
                        saleLine.id !== line.id && saleLine.selectedBatches.some((selectedBatch) => selectedBatch.id === batch.id),
                      );
                      const isSelected = line.selectedBatches.some((selectedBatch) => selectedBatch.id === batch.id);
                      if (batch.isExpired) {
                        return (
                          <div key={batch.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid #edf0ed", padding: "10px 4px" }}>
                            <span style={{ color: "#718078", fontSize: 12 }}>Batch {batch.batchNumber || "-"} · Exp {batch.expDate || "-"}</span>
                            <button type="button" onClick={() => setExpiredProduct(batch)} style={{ border: "1px solid #f1c3c0", borderRadius: 5, background: "#fff7f6", color: "#b42318", padding: "5px 8px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>Expaired</button>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={batch.id}
                          type="button"
                          disabled={isUsedByAnotherRow}
                          onClick={() => selectBatchForSale(line, batch)}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: 0, borderBottom: "1px solid #edf0ed", background: isSelected ? "#eef6f1" : "#fff", padding: "10px 4px", textAlign: "left", cursor: isUsedByAnotherRow ? "not-allowed" : "pointer", opacity: isUsedByAnotherRow ? 0.55 : 1 }}
                        >
                          <span style={{ color: "#34453b", fontSize: 12 }}>
                            Batch {batch.batchNumber || "-"} · Exp {batch.expDate || "-"}
                            {isUsedByAnotherRow ? " · Already added" : ""}
                          </span>
                          <span style={{ color: isSelected ? "#17704e" : "#77857d", fontSize: 11 }}>
                            {isSelected ? "Selected · Click to remove" : `Box ${formatPrice(getUnitPrice(batch.boxPrice))}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ margin: 0, padding: "12px 4px", color: "#77857d", fontSize: 12 }}>No matching batch number found.</p>
                )}
              </div>
              <footer style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                <button type="button" onClick={() => setBatchSelectionLineId(null)} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Done ({line.selectedBatches.length} selected)</button>
              </footer>
            </section>
          </div>
        );
      })()}

      {saleInvoice && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSaleInvoice(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-invoice-title"
            className="sale-invoice-print"
            style={{ width: "min(760px, 100%)", maxHeight: "min(90vh, 850px)", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)", padding: 28 }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingBottom: 18, borderBottom: "1px solid #e9eeea" }}>
              <div>
                <p style={{ margin: "0 0 5px", color: "#17704e", fontSize: 12, fontWeight: 700 }}>Pharmecy Cluster</p>
                <h2 id="sale-invoice-title" style={{ margin: 0, color: "#20342a", fontSize: 22 }}>Sales invoice</h2>
              </div>
              <strong style={{ color: "#17704e", fontSize: 16 }}>{saleInvoice.invoice}</strong>
            </header>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, margin: "18px 0", color: "#526158", fontSize: 12 }}>
              <span>Customer: <strong>{saleInvoice.customer}</strong></span>
              <span>{new Date(saleInvoice.createdAt).toLocaleString("en-BD")}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Product", "Batch", "Quantity", "Unit price", "Total"].map((heading) => (
                      <th key={heading} style={{ padding: "10px 8px", background: "#eff7f2", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saleInvoice.lines?.map((line, index) => (
                    <tr key={`${line.brand}-${index}`}>
                      <td style={{ padding: "11px 8px", borderBottom: "1px solid #edf0ed", color: "#26352f", fontSize: 12 }}>
                        <strong>{line.brand}</strong>
                        {line.details && <small style={{ display: "block", marginTop: 3, color: "#77857d" }}>{line.details}</small>}
                      </td>
                      <td style={{ padding: "11px 8px", borderBottom: "1px solid #edf0ed", color: "#526158", fontSize: 12 }}>{line.batchNumber}</td>
                      <td style={{ padding: "11px 8px", borderBottom: "1px solid #edf0ed", color: "#526158", fontSize: 12 }}>{line.quantity}</td>
                      <td style={{ padding: "11px 8px", borderBottom: "1px solid #edf0ed", color: "#526158", fontSize: 12, whiteSpace: "nowrap" }}>{formatPrice(line.unitPrice)}</td>
                      <td style={{ padding: "11px 8px", borderBottom: "1px solid #edf0ed", color: "#526158", fontSize: 12, whiteSpace: "nowrap" }}>{formatPrice(line.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18, color: "#17704e", fontSize: 16 }}>
              <strong>Grand total: {formatPrice(saleInvoice.amount)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 10, color: "#526158", fontSize: 13 }}>
              <span>Pay Amount: <strong>{formatPrice(saleInvoice.paidAmount ?? saleInvoice.amount)}</strong></span>
              <span style={{ color: (saleInvoice.dueAmount ?? 0) > 0 ? "#ad4b43" : "#17704e" }}>
                Due: <strong>{formatPrice(saleInvoice.dueAmount ?? 0)}</strong>
              </span>
            </div>
            <footer className="sale-invoice-print-actions" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 24, paddingTop: 16, borderTop: "1px solid #e9eeea" }}>
              {invoicePdfError && <p role="alert" style={{ margin: "0 auto 0 0", color: "#ad4b43", fontSize: 12 }}>{invoicePdfError}</p>}
              <button type="button" onClick={() => window.print()} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#405248", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Print invoice</button>
              <button type="button" onClick={saveInvoicePdf} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Save PDF</button>
              <button type="button" onClick={() => setSaleInvoice(null)} style={{ border: 0, borderRadius: 6, background: "#eef2ef", color: "#405248", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {activeSaleType && expiredProduct && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpiredProduct(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="expired-item-title" style={{ width: "min(380px, 100%)", borderRadius: 9, background: "#fff", boxShadow: "0 20px 60px rgba(7, 28, 17, 0.25)" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #f3dada" }}>
              <h3 id="expired-item-title" style={{ margin: 0, color: "#b42318", fontSize: 17, fontWeight: 700 }}>Expaired</h3>
              <button type="button" aria-label="Close expired item notice" onClick={() => setExpiredProduct(null)} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 22, lineHeight: 1, cursor: "pointer" }}>×</button>
            </header>
            <div style={{ display: "grid", gap: 6, padding: 20, color: "#405248", fontSize: 13 }}>
              <strong>{expiredProduct.brand}</strong>
              {expiredProduct.batchNumber && <span>Batch: {expiredProduct.batchNumber}</span>}
              <span>Expiry date: {expiredProduct.expDate || "-"}</span>
              <p style={{ margin: "8px 0 0", color: "#b42318" }}>This inventory item cannot be added to the sale.</p>
            </div>
            <footer style={{ display: "flex", justifyContent: "flex-end", padding: "0 20px 16px" }}>
              <button type="button" onClick={() => setExpiredProduct(null)} style={{ border: 0, borderRadius: 6, background: "#b42318", color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Close</button>
            </footer>
          </section>
        </div>
      )}

    </>
  );
}
