"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { downloadSaleInvoicePdf } from "./saleInvoicePdf";
import { getCashRoundingAmount, persistSale, type SalesListRow } from "./salesStorage";
import {
  emptyPurchaseListSnapshot,
  getAvailablePurchaseQuantity,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";
import {
  emptyVatTaxSettingsSnapshot,
  getVatTaxSettingsSnapshot,
  subscribeToVatTaxSettings,
} from "./vatTaxStorage";

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
  availableQuantity: number | null;
};

type SaleBatchAllocation = {
  batch: SaleProduct;
  quantity: number;
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

function mapInventoryRow(row: PurchaseListRow): SaleProduct {
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
    availableQuantity: getAvailablePurchaseQuantity(row),
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

function getBatchAllocations(line: SaleLine): SaleBatchAllocation[] {
  let remainingQuantity = getQuantityTotal(line.quantity);
  const allocations: SaleBatchAllocation[] = [];
  for (const batch of line.selectedBatches) {
    if (remainingQuantity === 0) break;
    if (batch.availableQuantity === null) continue;
    const quantity = Math.min(batch.availableQuantity, remainingQuantity);
    if (quantity <= 0) continue;
    allocations.push({ batch, quantity });
    remainingQuantity -= quantity;
  }
  return allocations;
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
  const vatTaxSettingsSnapshot = useSyncExternalStore(
    subscribeToVatTaxSettings,
    getVatTaxSettingsSnapshot,
    () => emptyVatTaxSettingsSnapshot,
  );
  const [matchingProducts, setMatchingProducts] = useState<SaleProduct[]>([]);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [payAmount, setPayAmount] = useState("");
  const [discountType, setDiscountType] = useState<"flat" | "percent">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [taxRate, setTaxRate] = useState(String(vatTaxSettingsSnapshot.defaultRate));
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
  }, [inventorySnapshot, searchTerm, selectedProductIds]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (expiredProduct) setExpiredProduct(null);
      else if (batchSelectionLineId) setBatchSelectionLineId(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [batchSelectionLineId, expiredProduct]);

  const totalUnits = saleLines.reduce(
    (total, line) => total + getQuantityTotal(line.quantity),
    0,
  );
  const stockErrorLine = saleLines.find((line) => {
    const quantity = getQuantityTotal(line.quantity);
    if (quantity === 0 || line.selectedBatches.length === 0) return false;
    return line.selectedBatches.some((batch) => batch.availableQuantity === null)
      || quantity > line.selectedBatches.reduce(
        (total, batch) => total + (batch.availableQuantity ?? 0),
        0,
      );
  });
  const stockError = stockErrorLine
    ? stockErrorLine.selectedBatches.some((batch) => batch.availableQuantity === null)
      ? `Could not determine available stock for ${stockErrorLine.product.brand}.`
      : `Not enough stock for ${stockErrorLine.product.brand}. Available: ${stockErrorLine.selectedBatches.reduce((total, batch) => total + (batch.availableQuantity ?? 0), 0)}; requested: ${getQuantityTotal(stockErrorLine.quantity)}.`
    : "";
  const totalPrice = saleLines.reduce(
    (total, line) => total + getBatchAllocations(line).reduce(
      (lineTotal, allocation) => lineTotal + roundCurrency(allocation.quantity * getUnitPrice(allocation.batch.unitPrice)),
      0,
    ),
    0,
  );
  const hasDiscountValue = discountValue.trim() !== "";
  const parsedDiscountValue = hasDiscountValue ? Number(discountValue) : 0;
  const validDiscount = !hasDiscountValue
    || (Number.isFinite(parsedDiscountValue)
      && parsedDiscountValue >= 0
      && (discountType === "percent" ? parsedDiscountValue <= 100 : parsedDiscountValue <= totalPrice));
  const discountAmount = validDiscount
    ? roundCurrency(discountType === "percent" ? totalPrice * parsedDiscountValue / 100 : parsedDiscountValue)
    : 0;
  const payableAmount = roundCurrency(Math.max(0, totalPrice - discountAmount));
  const hasTaxRate = taxRate.trim() !== "";
  const parsedTaxRate = hasTaxRate ? Number(taxRate) : 0;
  const validTaxRate = !vatTaxSettingsSnapshot.error
    && (!hasTaxRate || (Number.isFinite(parsedTaxRate) && parsedTaxRate >= 0 && parsedTaxRate <= 100));
  const taxAmount = validTaxRate ? roundCurrency(payableAmount * parsedTaxRate / 100) : 0;
  const netTotal = roundCurrency(payableAmount + taxAmount);
  const cashRoundingAmount = getCashRoundingAmount(netTotal);
  const roundedTotal = roundCurrency(netTotal + cashRoundingAmount);
  const hasPayAmount = payAmount.trim() !== "";
  const parsedPayAmount = hasPayAmount ? roundCurrency(Number(payAmount)) : 0;
  const validPayAmount = hasPayAmount
    && Number.isFinite(parsedPayAmount)
    && parsedPayAmount >= 0
    && validDiscount
    && validTaxRate
    && !stockError;
  const dueAmount = validPayAmount ? roundCurrency(Math.max(0, roundedTotal - parsedPayAmount)) : 0;
  const changeCash = validPayAmount ? roundCurrency(Math.max(0, parsedPayAmount - roundedTotal)) : 0;
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
      const availableBatches = products.filter((product) =>
        !product.isExpired
        && product.batchNumber.trim() !== ""
        && product.availableQuantity !== null
        && product.availableQuantity > 0,
      );
      const selectedBatches = availableBatches.length === 1 ? availableBatches : [];
      return [
        ...current,
        { id: products[0].id, product: products[0], batchOptions: products, selectedBatches, quantity: selectedBatches.length ? "0" : "" },
      ];
    });
    if (products.filter((product) =>
      !product.isExpired
      && product.batchNumber.trim() !== ""
      && product.availableQuantity !== null
      && product.availableQuantity > 0,
    ).length !== 1) {
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
    const isSelected = line.selectedBatches.some((selectedBatch) => selectedBatch.id === batch.id);
    if (!isSelected && (!batch.batchNumber.trim() || batch.availableQuantity === null || batch.availableQuantity <= 0)) {
      setSaleSaveError(`No available stock for ${batch.brand}, batch ${batch.batchNumber}.`);
      return;
    }
    setSaleLines((current) => current.map((saleLine) => {
      if (saleLine.id !== line.id) return saleLine;
      const isSelectedBatch = saleLine.selectedBatches.some((selectedBatch) => selectedBatch.id === batch.id);
      const selectedBatches = isSelectedBatch
        ? saleLine.selectedBatches.filter((selectedBatch) => selectedBatch.id !== batch.id)
        : [...saleLine.selectedBatches, batch];
      return {
        ...saleLine,
        selectedBatches,
        quantity: selectedBatches.length > 0 ? saleLine.quantity || "0" : "",
      };
    }));
  }

  function saveSale() {
    if (!validDiscount) {
      setSaleSaveError(discountType === "percent"
        ? "Discount must be between zero and 100%."
        : "Discount cannot be greater than the total price.");
      return;
    }
    if (vatTaxSettingsSnapshot.error) {
      setSaleSaveError(vatTaxSettingsSnapshot.error);
      return;
    }
    if (!validTaxRate) {
      setSaleSaveError("VAT/TAX must be between zero and 100%.");
      return;
    }
    if (stockError) {
      setSaleSaveError(stockError);
      return;
    }
    if (!validPayAmount) {
      setSaleSaveError("Pay amount must be zero or greater.");
      return;
    }

    const completedLines = saleLines.filter(
      (line) => line.selectedBatches.length > 0 && getQuantityTotal(line.quantity) > 0,
    );
    if (completedLines.length === 0) {
      setSaleSaveError("Add at least one product and enter a quantity greater than zero.");
      return;
    }

    const invoiceLines = completedLines.flatMap((line) =>
      getBatchAllocations(line).map(({ batch, quantity }) => {
        const unitPrice = getUnitPrice(batch.unitPrice);
        return {
          brand: line.product.brand,
          details: [line.product.genericName, line.product.strength, line.product.unit, line.product.packSize]
            .filter(Boolean)
            .join(" · "),
          batchNumber: batch.batchNumber,
          packSize: line.product.packSize || "-",
          quantity,
          unitPrice,
          totalPrice: roundCurrency(quantity * unitPrice),
        };
      }),
    );

    try {
      const savedSale = persistSale(invoiceLines, parsedPayAmount, discountAmount, parsedTaxRate);
      setSaleSaveError("");
      setSaleLines([]);
      setSelectedProductIds([]);
      setPayAmount("");
      setDiscountType("percent");
      setDiscountValue("");
      setTaxRate(String(vatTaxSettingsSnapshot.defaultRate));
      setSearchTerm("");
      setMatchingProducts([]);
      setKeyboardActiveGroupKey(null);
      setBatchSelectionLineId(null);
      setBatchSearchTerm("");
      setIsSearchingProducts(false);
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
      <section
        className="new-sale-form"
        aria-labelledby="new-sale-title"
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          width: "100%",
          border: "1px solid #e4e9e5",
          borderRadius: 10,
          background: "#fff",
          overflow: "hidden",
        }}
      >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "10px 16px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="new-sale-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>New Sale</h2>
                <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 12 }}>Search the Product List and add quantities.</p>
              </div>
            </div>

            <div className="new-sale-content" style={{ padding: 14 }}>
              <div className="new-sale-products">
              {(productError || inventorySnapshot.error) && <p role="alert" style={{ margin: "0 0 14px", color: "#ad4b43", fontSize: 13 }}>{productError || inventorySnapshot.error}</p>}
              <div className="new-sale-search" style={{ position: "relative", marginBottom: 18 }}>
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
                    style={{ display: "grid", gridTemplateColumns: "230px 90px 95px 95px 90px 110px 70px", alignItems: "center", gap: 12, minWidth: 850, padding: "0 0 8px", borderBottom: "1px solid #e5ebe6", color: "#77857d", fontSize: 10, fontWeight: 650 }}
                  >
                    {["Brand Name", "Pack Size", "Box Price", "Unit Price", "Quantity", "Total Price", "Actions"].map((heading, index) => (
                      <span key={`${heading}-${index}`}>{heading}</span>
                    ))}
                  </div>
                  {saleLines.map((line) => {
                    const quantity = getQuantityTotal(line.quantity);
                    const selectedBatch = line.selectedBatches[0];
                    const boxPrice = getUnitPrice(selectedBatch?.boxPrice ?? "0");
                    const unitPrice = getUnitPrice(selectedBatch?.unitPrice ?? "0");
                    const lineTotal = getBatchAllocations(line).reduce(
                      (total, allocation) => total + roundCurrency(allocation.quantity * getUnitPrice(allocation.batch.unitPrice)),
                      0,
                    );
                    const expiredBatches = line.batchOptions.filter((batch) => batch.isExpired);
                    return (
                      <div key={line.id}>
                      <article style={{ display: "grid", gridTemplateColumns: "230px 90px 95px 95px 90px 110px 70px", alignItems: "center", gap: 12, minWidth: 850, padding: "4px 0" }}>
                          <div style={{ minWidth: 0 }}>
                          <strong style={{ display: "block", overflow: "hidden", color: "#26352f", fontSize: 13, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[line.product.brand, line.product.strength].filter(Boolean).join(" · ")}
                          </strong>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 }}>
                              {line.selectedBatches.map((batch) => (
                                <small key={batch.id} style={{ borderRadius: 4, background: "#eef6f1", padding: "3px 5px", color: "#17704e", fontSize: 10, whiteSpace: "nowrap" }}>
                                  {batch.batchNumber || "-"}
                                </small>
                              ))}
                              {line.selectedBatches.length === 0 && (
                                <small style={{ color: "#77857d", fontSize: 10 }}>Batch not selected</small>
                              )}
                              <button
                                type="button"
                                aria-label={`Add or edit batches for ${line.product.brand}`}
                                title="Add or edit batches"
                                onClick={() => openBatchSelection(line)}
                                style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, border: "1px solid #cfe4d7", borderRadius: 999, background: "#f4faf6", color: "#17704e", padding: 0, fontSize: 14, lineHeight: 1, cursor: "pointer" }}
                              >
                                +
                              </button>
                            </div>
                            {expiredBatches.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpiredProduct(expiredBatches[0])}
                                style={{ marginTop: 4, border: 0, background: "transparent", color: "#b42318", padding: 0, fontSize: 10, cursor: "pointer" }}
                              >
                                Expaired batch info
                              </button>
                            )}
                          </div>
                          <span style={{ overflow: "hidden", color: "#526158", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.product.packSize || "-"}</span>
                          <span style={{ color: "#405248", fontSize: 12, textAlign: "left" }}>{formatPrice(boxPrice)}</span>
                          <span style={{ color: "#405248", fontSize: 12, textAlign: "left" }}>{formatPrice(unitPrice)}</span>
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
                              style={{ ...inputStyle, display: "block", width: "100%", padding: "7px 5px", textAlign: "left", opacity: line.selectedBatches.length > 0 ? 1 : 0.55 }}
                            />
                            {quantity > 0 && stockErrorLine?.id === line.id && (
                              <span role="alert" style={{ display: "block", width: 150, marginTop: 3, color: "#ad4b43", fontSize: 10 }}>
                                {stockError}
                              </span>
                            )}
                          </label>
                          <div style={{ textAlign: "left" }}>
                            <strong style={{ color: "#17704e", fontSize: 12 }}>{formatPrice(lineTotal)}</strong>
                          </div>
                          <button type="button" aria-label={`Remove ${line.product.brand}`} onClick={() => removeProduct(line.id)} style={{ justifySelf: "start", border: "1px solid #f1d8d5", borderRadius: 5, background: "#fff", color: "#ad4b43", padding: "4px 9px", fontSize: 12, cursor: "pointer" }}>Delete</button>
                        </article>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>

              <aside className="new-sale-summary" aria-label="Bill summary" style={{ display: "grid", alignContent: "start", gap: 9, padding: 12, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb" }}>
                <h3 style={{ margin: 0, color: "#20342a", fontSize: 15, fontWeight: 700 }}>Bill Summary</h3>
                <div style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Total units</span>
                    <strong style={{ color: "#26352f" }}>{totalUnits}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Total price</span>
                    <strong style={{ color: "#17704e" }}>{formatPrice(totalPrice)}</strong>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: "#526158", fontSize: 11, fontWeight: 650 }}>Discount</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {(["flat", "percent"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={discountType === type}
                          onClick={() => {
                            setDiscountType(type);
                            setDiscountValue("");
                            setSaleSaveError("");
                          }}
                          style={{ border: `1px solid ${discountType === type ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: discountType === type ? "#eef8f2" : "#fff", color: discountType === type ? "#17704e" : "#526158", padding: "6px 8px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
                        >
                          {type === "flat" ? "Flat (৳)" : "%"}
                        </button>
                      ))}
                    </div>
                    <input
                      className="discount-input"
                      aria-label={`Discount ${discountType === "flat" ? "amount" : "percentage"}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={discountType === "percent" ? 100 : totalPrice}
                      step="0.01"
                      value={discountValue}
                      onChange={(event) => {
                        setDiscountValue(event.currentTarget.value);
                        setSaleSaveError("");
                      }}
                      placeholder={discountType === "flat" ? "Enter amount" : "Enter percentage"}
                      style={{ ...inputStyle, width: "100%", padding: "6px 8px", fontSize: 12 }}
                    />
                    {!validDiscount && (
                      <span role="alert" style={{ color: "#ad4b43", fontSize: 11 }}>
                        {discountType === "percent" ? "Discount cannot exceed 100%." : "Discount cannot exceed total price."}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Discount amount</span>
                    <strong style={{ color: "#526158" }}>−{formatPrice(discountAmount)}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#526158", fontSize: 12 }}>
                    <label htmlFor="sale-tax-rate" style={{ whiteSpace: "nowrap" }}>VAT/TAX (%)</label>
                    <input
                      className="discount-input"
                      id="sale-tax-rate"
                      aria-label="VAT/TAX percentage"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={taxRate}
                      onChange={(event) => {
                        setTaxRate(event.currentTarget.value);
                        setSaleSaveError("");
                      }}
                      style={{ ...inputStyle, width: 64, padding: "5px 8px", fontSize: 12, textAlign: "right" }}
                    />
                    <strong style={{ color: "#526158", whiteSpace: "nowrap" }}>+{formatPrice(taxAmount)}</strong>
                  </div>
                  {vatTaxSettingsSnapshot.error && (
                    <span role="alert" style={{ color: "#ad4b43", fontSize: 11 }}>
                      {vatTaxSettingsSnapshot.error}
                    </span>
                  )}
                  {!validTaxRate && !vatTaxSettingsSnapshot.error && (
                    <span role="alert" style={{ color: "#ad4b43", fontSize: 11 }}>
                      VAT/TAX must be between zero and 100%.
                    </span>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 5, borderTop: "1px solid #e5ebe7" }}>
                    <strong style={{ color: "#26352f" }}>Net Total</strong>
                    <strong style={{ color: "#17704e" }}>{formatPrice(netTotal)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Cash Rounding</span>
                    <strong style={{ color: cashRoundingAmount < 0 ? "#ad4b43" : "#526158" }}>
                      {cashRoundingAmount > 0 ? "+" : cashRoundingAmount < 0 ? "−" : ""}{formatPrice(Math.abs(cashRoundingAmount))}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong style={{ color: "#26352f" }}>Rounded Total</strong>
                    <strong style={{ color: "#17704e" }}>{formatPrice(roundedTotal)}</strong>
                  </div>
                  <label style={{ display: "grid", gap: 3, color: "#526158", fontSize: 11, fontWeight: 650 }}>
                    Pay Amount
                    <input
                      className="pay-amount-input"
                      aria-label="Pay Amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={payAmount}
                      onFocus={() => setPayAmount("")}
                      onChange={(event) => setPayAmount(event.currentTarget.value)}
                      style={{ ...inputStyle, width: "100%", border: "1px solid #e5ebe7", outline: "none", padding: "6px 8px", fontSize: 12 }}
                    />
                  </label>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Due</span>
                    <strong aria-live="polite" style={{ color: dueAmount > 0 ? "#ad4b43" : "#17704e" }}>
                      {validPayAmount ? formatPrice(dueAmount) : hasPayAmount ? "Check pay amount" : "Enter pay amount"}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Change Cash</span>
                    <strong aria-live="polite" style={{ color: "#17704e" }}>
                      {validPayAmount ? formatPrice(changeCash) : hasPayAmount ? "Check pay amount" : "Enter pay amount"}
                    </strong>
                  </div>
                </div>
              </aside>
            </div>

            <footer style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              {saleSaveError && <p role="alert" style={{ margin: "0 auto 0 0", color: "#ad4b43", fontSize: 12 }}>{saleSaveError}</p>}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={saveSale}
                  disabled={!validPayAmount || !validDiscount}
                  style={{ border: 0, borderRadius: 6, background: validPayAmount && validDiscount ? "#179c70" : "#aab8b0", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: validPayAmount && validDiscount ? "pointer" : "not-allowed" }}
                >
                  Save
                </button>
              </div>
            </footer>
      </section>

      {batchSelectionLineId && (() => {
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
                          disabled={isUsedByAnotherRow || !batch.batchNumber.trim() || batch.availableQuantity === null || batch.availableQuantity <= 0}
                          onClick={() => selectBatchForSale(line, batch)}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: 0, borderBottom: "1px solid #edf0ed", background: isSelected ? "#eef6f1" : "#fff", padding: "10px 4px", textAlign: "left", cursor: isUsedByAnotherRow || !batch.batchNumber.trim() || batch.availableQuantity === null || batch.availableQuantity <= 0 ? "not-allowed" : "pointer", opacity: isUsedByAnotherRow || !batch.batchNumber.trim() || batch.availableQuantity === null || batch.availableQuantity <= 0 ? 0.55 : 1 }}
                        >
                          <span style={{ color: "#34453b", fontSize: 12 }}>
                            Batch {batch.batchNumber || "-"} · Exp {batch.expDate || "-"}
                            {isUsedByAnotherRow ? " · Already added" : ""}
                          </span>
                          <span style={{ color: isSelected ? "#17704e" : "#77857d", fontSize: 11 }}>
                            {!batch.batchNumber.trim()
                              ? "Batch number required"
                              : batch.availableQuantity === null
                              ? "Stock unavailable"
                              : `Available ${batch.availableQuantity}${isSelected ? " · Selected" : ""} · Box ${formatPrice(getUnitPrice(batch.boxPrice))}`}
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
            <div style={{ display: "grid", justifyItems: "end", gap: 6, marginTop: 18, color: "#526158", fontSize: 13 }}>
              {saleInvoice.discountAmount || saleInvoice.taxAmount ? (
                <>
                  <span>Subtotal: <strong>{formatPrice(saleInvoice.subtotalAmount ?? saleInvoice.amount)}</strong></span>
                </>
              ) : null}
              {saleInvoice.discountAmount ? (
                <span>Discount: <strong>−{formatPrice(saleInvoice.discountAmount)}</strong></span>
              ) : null}
              {saleInvoice.taxAmount ? (
                <span>VAT/TAX ({saleInvoice.taxRate ?? 0}%): <strong>+{formatPrice(saleInvoice.taxAmount)}</strong></span>
              ) : null}
              {saleInvoice.cashRoundingAmount ? (
                <span>Cash Rounding: <strong>{saleInvoice.cashRoundingAmount > 0 ? "+" : "−"}{formatPrice(Math.abs(saleInvoice.cashRoundingAmount))}</strong></span>
              ) : null}
              <strong style={{ color: "#17704e", fontSize: 16 }}>Grand total: {formatPrice(saleInvoice.amount)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 10, color: "#526158", fontSize: 13 }}>
              <span>Pay Amount: <strong>{formatPrice(saleInvoice.paidAmount ?? saleInvoice.amount)}</strong></span>
              <span style={{ color: (saleInvoice.dueAmount ?? 0) > 0 ? "#ad4b43" : "#17704e" }}>
                Due: <strong>{formatPrice(saleInvoice.dueAmount ?? 0)}</strong>
              </span>
              <span style={{ color: "#17704e" }}>
                Change Cash: <strong>{formatPrice(Math.max(0, (saleInvoice.paidAmount ?? saleInvoice.amount) - saleInvoice.amount))}</strong>
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

      {expiredProduct && (
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
