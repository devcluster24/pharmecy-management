"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  persistPlaceOrderListRows,
  persistPurchaseListRows,
  calculateUnitPurchasePrice,
  emptyPurchaseListSnapshot,
  getPlaceOrderListSnapshot,
  readPlaceOrderListRows,
  readPurchaseListRows,
  subscribeToPlaceOrderList,
  type PurchaseListRow,
} from "./purchaseStorage";

type PurchaseProduct = {
  id: string;
  brand: string;
  medicine_name: string;
  generic_name: string;
  manufacturer: string;
  strength: string;
  dosage_form: string;
  pack_size: string;
  unit_price: string;
  pack_price: string;
};

type BatchDetails = {
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp: string;
  packSize: string;
  quantity: string;
  purchasePrice: string;
  totalPrice: string;
};

type BrandSelection = {
  id: number;
  productId: string;
  customBrand: string;
  brandDraft: string;
  isAddingBrand: boolean;
  batches: BatchDetails[];
};

type PendingBatchEntry = {
  companySelectionId: number;
  brandSelectionId: number;
  productId: string;
  customBrand: string;
  brandDraft: string;
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp: string;
  packSize: string;
  quantity: string;
  purchasePrice: string;
  totalPrice: string;
  batches: BatchDetails[];
  placeOrderRow?: PurchaseListRow;
};

type EditableBatchField =
  | "batchNumber"
  | "mfgDate"
  | "expDate"
  | "mrp"
  | "packSize"
  | "quantity"
  | "purchasePrice"
  | "totalPrice";

type PlaceOrderLine = {
  id: number;
  productId: string;
  packPrice: string;
  quantity: string;
  purchasePrice: string;
  packSize: string;
  totalPrice: string;
};

type CompanySelection = {
  id: number;
  company: string;
  companyDraft: string;
  isAddingCompany: boolean;
  brands: BrandSelection[];
};

type PendingOrderReceipt = {
  sourceRowId: string;
  rows: PurchaseListRow[];
};

const PAGE_SIZE = 1000;

function createBrandSelection(id: number): BrandSelection {
  return {
    id,
    productId: "",
    customBrand: "",
    brandDraft: "",
    isAddingBrand: false,
    batches: [],
  };
}

function createCompanySelection(id: number, brandId: number): CompanySelection {
  return {
    id,
    company: "",
    companyDraft: "",
    isAddingCompany: false,
    brands: [createBrandSelection(brandId)],
  };
}

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "9px 10px",
  fontSize: 13,
};

function displayValue(value: string | undefined) {
  return value?.trim() || "-";
}

function formatMonthYear(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[1].slice(-2)}` : value;
}

function normalizeMonthYearInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function parseMonthYearInput(value: string) {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[2]);
  if (year < 18) return null;
  return `${2000 + year}-${match[1]}`;
}

function parseOrderPrice(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatOrderPrice(value: number) {
  return String(Number(value.toFixed(4)));
}

function getReceivedBatchKey(row: PurchaseListRow) {
  return JSON.stringify([
    row.supplier.trim().toLocaleLowerCase(),
    row.brand.trim().toLocaleLowerCase(),
    row.batchNumber.trim().toLocaleLowerCase(),
    row.mfgDate.trim(),
    row.expDate.trim(),
  ]);
}

function mergeReceivedRows(
  existingRows: PurchaseListRow[],
  incomingRows: PurchaseListRow[],
) {
  const rows = [...existingRows];
  const rowIndexesByBatch = new Map<string, number>();
  const updatedAt = new Date().toISOString();

  rows.forEach((row, index) => {
    const key = getReceivedBatchKey(row);
    if (!rowIndexesByBatch.has(key)) rowIndexesByBatch.set(key, index);
  });

  for (const incomingRow of incomingRows) {
    const key = getReceivedBatchKey(incomingRow);
    const existingIndex = rowIndexesByBatch.get(key);
    if (existingIndex === undefined) {
      rowIndexesByBatch.set(key, rows.length);
      rows.push({ ...incomingRow, updatedAt });
      continue;
    }

    const existingRow = rows[existingIndex];
    const quantity = (parseOrderPrice(existingRow.quantity ?? "") ?? 0)
      + (parseOrderPrice(incomingRow.quantity ?? "") ?? 0);
    const totalPrice = (parseOrderPrice(existingRow.totalPrice ?? "") ?? 0)
      + (parseOrderPrice(incomingRow.totalPrice ?? "") ?? 0);
    rows[existingIndex] = {
      ...existingRow,
      quantity: formatOrderPrice(quantity),
      totalPrice: formatOrderPrice(totalPrice),
      updatedAt,
      unitPurchasePrice: calculateUnitPurchasePrice(
        existingRow.packSize,
        formatOrderPrice(totalPrice),
        formatOrderPrice(quantity),
      ),
      status: "Received",
    };
  }

  return rows;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Could not load products. Please try again.";
}

export default function PurchaseCreateAction() {
  const placeOrderListSnapshot = useSyncExternalStore(
    subscribeToPlaceOrderList,
    getPlaceOrderListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isPlaceOrderOpen, setIsPlaceOrderOpen] = useState(false);
  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [companySelections, setCompanySelections] = useState<CompanySelection[]>([
    createCompanySelection(0, 0),
  ]);
  const [activeCompanySelectionId, setActiveCompanySelectionId] = useState(0);
  const [isCompanyListOpen, setIsCompanyListOpen] = useState(false);
  const [nextCompanySelectionId, setNextCompanySelectionId] = useState(1);
  const [nextBrandSelectionId, setNextBrandSelectionId] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingBatchEntry, setPendingBatchEntry] = useState<PendingBatchEntry | null>(null);
  const expDateInputRef = useRef<HTMLInputElement>(null);
  const mrpInputRef = useRef<HTMLInputElement>(null);
  const focusedBatchFieldRef = useRef<{ field: EditableBatchField; originalValue: string } | null>(null);
  const [pendingOrderReceipts, setPendingOrderReceipts] = useState<PendingOrderReceipt[]>([]);
  const [batchEntryError, setBatchEntryError] = useState("");
  const [purchaseSaveError, setPurchaseSaveError] = useState("");
  const [placeOrderCompany, setPlaceOrderCompany] = useState("");
  const [placeOrderDraft, setPlaceOrderDraft] = useState({ productId: "", packPrice: "", quantity: "", purchasePrice: "" });
  const [placeOrderPackSize, setPlaceOrderPackSize] = useState("");
  const [placeOrderItems, setPlaceOrderItems] = useState<PlaceOrderLine[]>([]);
  const [nextPlaceOrderLineId, setNextPlaceOrderLineId] = useState(0);
  const [placeOrderError, setPlaceOrderError] = useState("");

  const companyNames = useMemo(
    () => [...new Set(products.map((product) => product.manufacturer.trim()).filter((name) => name && name !== "-"))]
      .sort((left, right) => left.localeCompare(right)),
    [products],
  );
  const selectedProductDetails = companySelections.flatMap((companySelection) => {
    const companyProducts = products.filter((product) => product.manufacturer.trim() === companySelection.company);
    return companySelection.brands
      .filter((selection) => selection.productId || selection.customBrand)
      .map((selection) => ({
        companySelection,
        selection,
        product: companyProducts.find((product) => product.id === selection.productId),
      }));
  });
  const selectedBatchDetails = selectedProductDetails.flatMap(({ companySelection, selection, product }) =>
    selection.batches.map((batch, batchIndex) => ({ companySelection, selection, product, batch, batchIndex })),
  );
  const pendingOrderReceiptRows = pendingOrderReceipts.flatMap((receipt) => receipt.rows);
  const pendingOrderReceiptIds = new Set(pendingOrderReceipts.map((receipt) => receipt.sourceRowId));
  const canReceivePurchase = (selectedBatchDetails.length > 0 || pendingOrderReceiptRows.length > 0)
    && companySelections.every((selection) => !selection.isAddingCompany)
    && !isLoading;
  const activeCompanyName = companySelections.find((selection) => selection.id === activeCompanySelectionId)?.company;
  const ongoingOrderRows = activeCompanyName
    ? placeOrderListSnapshot.rows.filter((row) =>
      row.supplier === activeCompanyName &&
      row.status.toLocaleLowerCase() !== "received" &&
      !pendingOrderReceiptIds.has(row.id),
    )
    : [];
  const receivedInvoiceRows = activeCompanyName
    ? pendingOrderReceiptRows.filter((row) => row.supplier === activeCompanyName)
    : [];
  const placeOrderTotal = placeOrderItems.reduce((total, item) => total + (parseOrderPrice(item.totalPrice) ?? 0), 0);

  useEffect(() => {
    if (!isOpen && !isPlaceOrderOpen) return;

    let active = true;
    async function loadProducts() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Sign in to create a purchase.");

        const rows: PurchaseProduct[] = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error } = await supabase
            .from("pharmacy_catalog_products")
            .select("id, brand, medicine_name, generic_name, manufacturer, strength, dosage_form, pack_size, unit_price, pack_price")
            .eq("owner_user_id", user.id)
            .order("manufacturer", { ascending: true })
            .order("brand", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
          if (error) throw error;

          const page = (data ?? []) as PurchaseProduct[];
          rows.push(...page);
          if (page.length < PAGE_SIZE) break;
        }

        if (!active) return;
        setProducts(rows);
        setCompanySelections([createCompanySelection(0, 0)]);
        setActiveCompanySelectionId(0);
        setIsCompanyListOpen(false);
        setNextCompanySelectionId(1);
        setNextBrandSelectionId(1);
      } catch (error) {
        if (active) setErrorMessage(getErrorMessage(error));
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      active = false;
    };
  }, [isOpen, isPlaceOrderOpen]);

  function closeModal() {
    setIsOpen(false);
    setCompanySelections([createCompanySelection(0, 0)]);
    setActiveCompanySelectionId(0);
    setIsCompanyListOpen(false);
    setNextCompanySelectionId(1);
    setNextBrandSelectionId(1);
    setPendingBatchEntry(null);
    setPendingOrderReceipts([]);
    setBatchEntryError("");
    setErrorMessage("");
    setPurchaseSaveError("");
  }

  function receivePurchase() {
    if (!canReceivePurchase) return;
    try {
      const receiveRows = readPurchaseListRows();
      const nextOrderNumber = receiveRows.reduce((maxNumber, row) => {
        const match = /^PO-RC-(\d+)$/.exec(row.order);
        return match ? Math.max(maxNumber, Number(match[1])) : maxNumber;
      }, 0) + 1;
      const order = `PO-RC-${String(nextOrderNumber).padStart(4, "0")}`;
      const orderDate = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
      const newRows = selectedProductDetails.flatMap(({ companySelection, selection, product }) =>
        selection.batches.map((batch, index): PurchaseListRow => ({
          id: `${order}-${companySelection.id}-${selection.id}-${index}`,
          order,
          supplier: companySelection.company,
          orderDate,
          brand: product?.brand.trim() || product?.medicine_name.trim() || selection.customBrand,
          genericName: displayValue(product?.generic_name),
          strength: displayValue(product?.strength),
          dosageForm: displayValue(product?.dosage_form),
          batchNumber: batch.batchNumber,
          mfgDate: batch.mfgDate,
          expDate: batch.expDate,
          mrp: batch.mrp,
          packSize: batch.packSize,
          quantity: batch.quantity,
          totalPrice: batch.totalPrice,
          packPrice: batch.purchasePrice,
          productPackPrice: product?.pack_price,
          unitPurchasePrice: calculateUnitPurchasePrice(batch.packSize, batch.totalPrice, batch.quantity),
          unitPrice: displayValue(product?.unit_price),
          productId: product?.id,
          status: "Received",
        })),
      );
      const stagedOrderRows = pendingOrderReceiptRows.map((row) => ({
        ...row,
        order,
        orderDate,
      }));
      const updatedRows = mergeReceivedRows(receiveRows, [...newRows, ...stagedOrderRows]);
      persistPurchaseListRows(updatedRows);
      if (pendingOrderReceipts.length > 0) {
        const receivedPlaceOrders = new Map(pendingOrderReceipts.map((receipt) => {
          const receivedBatchKeys = new Set(receipt.rows.map(getReceivedBatchKey));
          const matchingRows = updatedRows.filter((row) => receivedBatchKeys.has(getReceivedBatchKey(row)));
          const quantity = matchingRows.reduce(
            (total, row) => total + (parseOrderPrice(row.quantity ?? "") ?? 0),
            0,
          );
          const totalPrice = matchingRows.reduce(
            (total, row) => total + (parseOrderPrice(row.totalPrice ?? "") ?? 0),
            0,
          );
          return [receipt.sourceRowId, {
            quantity: formatOrderPrice(quantity),
            totalPrice: formatOrderPrice(totalPrice),
          }] as const;
        }));
        persistPlaceOrderListRows(readPlaceOrderListRows().map((row) => {
          const receivedTotals = receivedPlaceOrders.get(row.id);
          return receivedTotals
            ? { ...row, ...receivedTotals, status: "Received" }
            : row;
        }));
      }
      closeModal();
    } catch (error) {
      setPurchaseSaveError(error instanceof Error ? error.message : "Could not save this purchase.");
    }
  }

  function addPlaceOrderItem() {
    const quantity = parseOrderPrice(placeOrderDraft.quantity);
    const purchasePrice = parseOrderPrice(placeOrderDraft.purchasePrice);
    const product = products.find((item) => item.id === placeOrderDraft.productId);
    if (!product || quantity === null || quantity <= 0 || purchasePrice === null) {
      setPlaceOrderError("Select a brand and enter a Box Quantity greater than zero and a valid Purchase Price (Box).");
      return;
    }

    setPlaceOrderItems((current) => [
      ...current,
      {
        id: nextPlaceOrderLineId,
        productId: product.id,
        packPrice: placeOrderDraft.packPrice.trim(),
        quantity: String(quantity),
        purchasePrice: formatOrderPrice(purchasePrice),
        packSize: placeOrderPackSize,
        totalPrice: formatOrderPrice(quantity * purchasePrice),
      },
    ]);
    setNextPlaceOrderLineId((current) => current + 1);
    setPlaceOrderDraft({ productId: "", packPrice: "", quantity: "", purchasePrice: "" });
    setPlaceOrderPackSize("");
    setPlaceOrderError("");
  }

  function closePlaceOrderModal() {
    setIsPlaceOrderOpen(false);
    setPlaceOrderCompany("");
    setPlaceOrderDraft({ productId: "", packPrice: "", quantity: "", purchasePrice: "" });
    setPlaceOrderPackSize("");
    setPlaceOrderItems([]);
    setNextPlaceOrderLineId(0);
    setPlaceOrderError("");
  }

  function submitPlaceOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!placeOrderCompany || placeOrderItems.length === 0) {
      setPlaceOrderError("Select a company and add at least one brand to the order list.");
      return;
    }

    try {
      const savedRows = readPlaceOrderListRows();
      const nextOrderNumber = savedRows.reduce((maxNumber, row) => {
        const match = /^PO-(\d+)$/.exec(row.order);
        return match ? Math.max(maxNumber, Number(match[1])) : maxNumber;
      }, 0) + 1;
      const order = `PO-${String(nextOrderNumber).padStart(4, "0")}`;
      const orderDate = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
      const newRows = placeOrderItems.map((line): PurchaseListRow => {
        const product = products.find((item) => item.id === line.productId);
        return {
          id: `${order}-${line.id}`,
          order,
          supplier: placeOrderCompany,
          orderDate,
          brand: product?.brand.trim() || product?.medicine_name.trim() || "",
          genericName: displayValue(product?.generic_name),
          strength: displayValue(product?.strength),
          dosageForm: displayValue(product?.dosage_form),
          batchNumber: "-",
          mfgDate: "",
          expDate: "",
          packSize: line.packSize,
          unitPrice: displayValue(product?.unit_price),
          packPrice: line.purchasePrice,
          productPackPrice: line.packPrice,
          quantity: line.quantity,
          totalPrice: line.totalPrice,
          unitPurchasePrice: calculateUnitPurchasePrice(line.packSize, line.totalPrice, line.quantity),
          productId: product?.id,
          status: "Placed",
        };
      });
      persistPlaceOrderListRows([...newRows, ...readPlaceOrderListRows()]);
      closePlaceOrderModal();
    } catch (error) {
      setPlaceOrderError(error instanceof Error ? error.message : "Could not place this order.");
    }
  }

  function openBatchEntry(
    companySelectionId: number,
    brandSelectionId: number,
    brand: Pick<PendingBatchEntry, "productId" | "customBrand" | "brandDraft">,
    batches: BatchDetails[] = [],
  ) {
    const product = products.find((item) => item.id === brand.productId);
    setPendingBatchEntry({
      companySelectionId,
      brandSelectionId,
      ...brand,
      batchNumber: "",
      mfgDate: "",
      expDate: "",
      mrp: product?.pack_price.trim() && product.pack_price !== "-" ? product.pack_price : "",
      packSize: products.find((product) => product.id === brand.productId)?.pack_size.trim() || "",
      quantity: "",
      purchasePrice: "",
      totalPrice: "",
      batches,
    });
    setBatchEntryError("");
  }

  function openOngoingOrderReceive(row: PurchaseListRow) {
    const product = products.find((item) => item.id === row.productId)
      ?? products.find((item) =>
        item.manufacturer.trim() === row.supplier &&
        (item.brand.trim() || item.medicine_name.trim()) === row.brand &&
        item.strength === row.strength,
      );
    setPendingBatchEntry({
      companySelectionId: -1,
      brandSelectionId: -1,
      productId: product?.id ?? row.productId ?? "",
      customBrand: row.brand,
      brandDraft: "",
      batchNumber: "",
      mfgDate: "",
      expDate: "",
      mrp: row.mrp || (product?.pack_price.trim() && product.pack_price !== "-" ? product.pack_price : ""),
      packSize: row.packSize,
      quantity: row.quantity ?? "",
      purchasePrice: row.packPrice,
      totalPrice: row.totalPrice ?? "",
      batches: [],
      placeOrderRow: row,
    });
    setBatchEntryError("");
  }

  function cancelBatchEntry() {
    if (pendingBatchEntry?.brandDraft) {
      updateBrandSelection(pendingBatchEntry.companySelectionId, pendingBatchEntry.brandSelectionId, {
        isAddingBrand: true,
        brandDraft: pendingBatchEntry.brandDraft,
      });
    }
    setPendingBatchEntry(null);
    setBatchEntryError("");
  }

  function updatePendingBatchField(
    field: "batchNumber" | "mfgDate" | "expDate" | "mrp" | "packSize" | "quantity" | "purchasePrice" | "totalPrice",
    value: string,
  ) {
    if (!pendingBatchEntry) return;
    setPendingBatchEntry((current) => current ? { ...current, [field]: value } : current);
    setBatchEntryError("");
  }

  function preservePendingBatchFieldOnFocus(
    field: EditableBatchField,
    input: HTMLInputElement,
  ) {
    if (!pendingBatchEntry) return;
    focusedBatchFieldRef.current = { field, originalValue: pendingBatchEntry[field] };
    input.select();
  }

  function updateBatchDate(field: "mfgDate" | "expDate", value: string) {
    const normalizedValue = normalizeMonthYearInput(value);
    updatePendingBatchField(field, normalizedValue);
    if (normalizedValue.length === 5) {
      window.setTimeout(() => {
        if (field === "mfgDate") expDateInputRef.current?.focus();
        else mrpInputRef.current?.focus();
      }, 0);
    }
  }

  function finishEditingBatchField(field: EditableBatchField) {
    const focusedBatchField = focusedBatchFieldRef.current;
    if (!focusedBatchField || focusedBatchField.field !== field) return;
    focusedBatchFieldRef.current = null;

    setPendingBatchEntry((current) => {
      if (!current) return current;
      const updated = current[field]
        ? current
        : { ...current, [field]: focusedBatchField.originalValue };
      if (field !== "packSize" && field !== "quantity" && field !== "purchasePrice") return updated;
      const quantity = parseOrderPrice(updated.quantity);
      const purchasePrice = parseOrderPrice(updated.purchasePrice);
      if (quantity === null || purchasePrice === null) return updated;
      return { ...updated, totalPrice: formatOrderPrice(quantity * purchasePrice) };
    });
  }

  useEffect(() => {
    if (!isOpen && !isPlaceOrderOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (pendingBatchEntry) {
        if (pendingBatchEntry.brandDraft) {
          setCompanySelections((current) => current.map((companySelection) =>
            companySelection.id === pendingBatchEntry.companySelectionId
              ? {
                  ...companySelection,
                  brands: companySelection.brands.map((brand) =>
                    brand.id === pendingBatchEntry.brandSelectionId
                      ? { ...brand, isAddingBrand: true, brandDraft: pendingBatchEntry.brandDraft }
                      : brand,
                  ),
                }
              : companySelection,
          ));
        }
        setPendingBatchEntry(null);
        setBatchEntryError("");
      } else if (isPlaceOrderOpen) {
        closePlaceOrderModal();
      } else {
        closeModal();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, isPlaceOrderOpen, pendingBatchEntry]);

  function saveBatchEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingBatchEntry) return;
    let batches = pendingBatchEntry.batches;
    const batchNumber = pendingBatchEntry.batchNumber.trim();
    const hasCurrentBatchValues = batchNumber ||
      pendingBatchEntry.mfgDate ||
      pendingBatchEntry.expDate ||
      pendingBatchEntry.quantity ||
      pendingBatchEntry.purchasePrice ||
      pendingBatchEntry.totalPrice;
    if (hasCurrentBatchValues) {
      if (!batchNumber || !pendingBatchEntry.mfgDate || !pendingBatchEntry.expDate) {
        setBatchEntryError("Complete Batch Number, Mfg Date, and Exp Date before saving.");
        return;
      }
      const mfgDate = parseMonthYearInput(pendingBatchEntry.mfgDate);
      const expDate = parseMonthYearInput(pendingBatchEntry.expDate);
      if (!mfgDate || !expDate) {
        setBatchEntryError("Enter dates in MM/YY format with a month from 01 to 12 and a year from 18 to 99.");
        return;
      }
      if (expDate <= mfgDate) {
        setBatchEntryError("Exp Date must be after Mfg Date.");
        return;
      }
      const quantity = parseOrderPrice(pendingBatchEntry.quantity);
      const purchasePrice = parseOrderPrice(pendingBatchEntry.purchasePrice);
      const totalPrice = parseOrderPrice(pendingBatchEntry.totalPrice);
      if (
        (pendingBatchEntry.quantity && (quantity === null || quantity <= 0)) ||
        (pendingBatchEntry.purchasePrice && purchasePrice === null) ||
        (pendingBatchEntry.totalPrice && totalPrice === null)
      ) {
        setBatchEntryError("Enter valid non-negative numbers for Box Quantity, Purchase Price (Box), and Total Price.");
        return;
      }
      const product = products.find((item) => item.id === pendingBatchEntry.productId);
      batches = [...batches, {
        batchNumber,
        mfgDate,
        expDate,
        mrp: pendingBatchEntry.mrp,
        packSize: pendingBatchEntry.packSize.trim() || product?.pack_size.trim() || pendingBatchEntry.placeOrderRow?.packSize || "-",
        quantity: pendingBatchEntry.quantity,
        purchasePrice: pendingBatchEntry.purchasePrice,
        totalPrice: pendingBatchEntry.totalPrice,
      }];
    }
    if (batches.length === 0) {
      setBatchEntryError("Add at least one complete batch before continuing.");
      return;
    }

    if (pendingBatchEntry.placeOrderRow) {
      const sourceRow = pendingBatchEntry.placeOrderRow;
      const product = products.find((item) => item.id === sourceRow.productId)
        ?? products.find((item) =>
          item.manufacturer.trim() === sourceRow.supplier &&
          (item.brand.trim() || item.medicine_name.trim()) === sourceRow.brand &&
          item.strength === sourceRow.strength,
        );
      const receivedRows = batches.map((batch, index): PurchaseListRow => ({
        id: `${sourceRow.id}-received-${batch.batchNumber}-${batch.mfgDate}-${batch.expDate}-${index}`,
        order: sourceRow.order,
        supplier: sourceRow.supplier,
        orderDate: sourceRow.orderDate,
        brand: sourceRow.brand,
        genericName: sourceRow.genericName,
        strength: sourceRow.strength,
        dosageForm: sourceRow.dosageForm,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expDate: batch.expDate,
        mrp: batch.mrp,
        packSize: batch.packSize,
        unitPrice: sourceRow.unitPrice,
        quantity: batch.quantity || sourceRow.quantity || "",
        totalPrice: batch.totalPrice || sourceRow.totalPrice || "",
        unitPurchasePrice: calculateUnitPurchasePrice(
          batch.packSize,
          batch.totalPrice || sourceRow.totalPrice || "",
          batch.quantity || sourceRow.quantity || "",
        ),
        packPrice: batch.purchasePrice || sourceRow.packPrice,
        productPackPrice: sourceRow.productPackPrice,
        productId: product?.id ?? sourceRow.productId,
        status: "Received",
      }));
      setPendingOrderReceipts((current) => [
        ...current.filter((receipt) => receipt.sourceRowId !== sourceRow.id),
        { sourceRowId: sourceRow.id, rows: receivedRows },
      ]);
      setPendingBatchEntry(null);
      setBatchEntryError("");
      return;
    }

    updateBrandSelection(pendingBatchEntry.companySelectionId, pendingBatchEntry.brandSelectionId, {
      productId: pendingBatchEntry.productId,
      customBrand: pendingBatchEntry.customBrand,
      brandDraft: "",
      isAddingBrand: false,
      batches,
    });
    setPendingBatchEntry(null);
    setBatchEntryError("");
  }

  function updateCompanySelection(id: number, updates: Partial<Omit<CompanySelection, "id" | "brands">>) {
    setCompanySelections((current) => current.map((selection) =>
      selection.id === id ? { ...selection, ...updates } : selection,
    ));
  }

  function setCompanyAndResetBrands(companyId: number, company: string) {
    const brand = createBrandSelection(nextBrandSelectionId);
    setNextBrandSelectionId((current) => current + 1);
    setCompanySelections((current) => current.map((selection) =>
      selection.id === companyId
        ? { ...selection, company, companyDraft: "", isAddingCompany: false, brands: [brand] }
        : selection,
    ));
  }

  function updateBrandSelection(companyId: number, brandId: number, updates: Partial<Omit<BrandSelection, "id">>) {
    setCompanySelections((current) => current.map((companySelection) =>
      companySelection.id === companyId
        ? {
            ...companySelection,
            brands: companySelection.brands.map((selection) =>
              selection.id === brandId ? { ...selection, ...updates } : selection,
            ),
          }
        : companySelection,
    ));
  }

  function addCompanySelection() {
    if (companySelections.some((selection) => !selection.company || selection.isAddingCompany)) return;
    const newSelectionId = nextCompanySelectionId;
    setCompanySelections((current) => [
      ...current,
      createCompanySelection(nextCompanySelectionId, nextBrandSelectionId),
    ]);
    setActiveCompanySelectionId(newSelectionId);
    setNextCompanySelectionId((current) => current + 1);
    setNextBrandSelectionId((current) => current + 1);
  }

  function removeCompanySelection(companyId: number) {
    const remainingSelections = companySelections.filter((selection) => selection.id !== companyId);
    if (remainingSelections.length === 0) {
      const replacement = createCompanySelection(nextCompanySelectionId, nextBrandSelectionId);
      setCompanySelections([replacement]);
      setActiveCompanySelectionId(replacement.id);
      setNextCompanySelectionId((current) => current + 1);
      setNextBrandSelectionId((current) => current + 1);
    } else {
      setCompanySelections(remainingSelections);
      if (activeCompanySelectionId === companyId) {
        setActiveCompanySelectionId(
          (remainingSelections.find((selection) => selection.company) ?? remainingSelections[0]).id,
        );
      }
    }
    setIsCompanyListOpen(false);
  }

  function addBrandSelection(companyId: number) {
    const companySelection = companySelections.find((selection) => selection.id === companyId);
    if (
      !companySelection ||
      companySelection.brands.some((brand) => !brand.productId && !brand.customBrand || brand.isAddingBrand)
    ) {
      return;
    }

    setCompanySelections((current) => current.map((companySelection) =>
      companySelection.id === companyId
        ? { ...companySelection, brands: [...companySelection.brands, createBrandSelection(nextBrandSelectionId)] }
        : companySelection,
    ));
    setNextBrandSelectionId((current) => current + 1);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={() => setIsPlaceOrderOpen(true)}
          style={{ border: "1px solid #179c70", borderRadius: 7, background: "#fff", color: "#16845f", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}
        >
          Place Order
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: "pointer" }}
        >
          Receive Order
        </button>
      </div>
      {isOpen && (
        <div
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-purchase-title"
            style={{ width: "min(1120px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="create-purchase-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Receive Order</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Select a company, then choose one of its products.</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "grid", gap: 16, padding: "22px 24px" }}>
              {companySelections
                .filter((selection) => selection.id === activeCompanySelectionId)
                .map((companySelection) => {
                const companyProducts = products
                  .filter((product) => product.manufacturer.trim() === companySelection.company)
                  .sort((left, right) => {
                    const leftBrand = left.brand.trim() || left.medicine_name.trim();
                    const rightBrand = right.brand.trim() || right.medicine_name.trim();
                    return leftBrand.localeCompare(rightBrand) || left.strength.localeCompare(right.strength);
                  });
                const companiesSelectedElsewhere = new Set(companySelections
                  .filter((selection) => selection.id !== companySelection.id)
                  .map((selection) => selection.company));
                const draftCompanyAlreadySelected = companySelections.some((selection) =>
                  selection.id !== companySelection.id &&
                  selection.company.toLocaleLowerCase() === companySelection.companyDraft.trim().toLocaleLowerCase(),
                );

                return (
                  <section key={companySelection.id} aria-label="Purchase company" style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.85fr) minmax(320px, 1.4fr)", gap: 18, padding: 16, border: "1px solid #dce5df", borderRadius: 8, background: "#fbfcfb" }}>
                    <div style={{ display: "grid", alignContent: "start", gap: 7, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                      <span>Company Name</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                          <input
                            aria-label="Company Name"
                            autoComplete="off"
                            value={companySelection.isAddingCompany ? companySelection.companyDraft : companySelection.company}
                            onChange={(event) => updateCompanySelection(companySelection.id, {
                              companyDraft: event.target.value,
                              isAddingCompany: true,
                            })}
                            placeholder={isLoading ? "Loading companies..." : "Type or select company"}
                            disabled={isLoading}
                            style={{ ...fieldStyle, height: 34, padding: "7px 9px", fontSize: 12, fontWeight: 400 }}
                          />
                          {companySelection.isAddingCompany && companySelection.companyDraft.trim() && (
                            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 25, display: "grid", maxHeight: 180, overflowY: "auto", padding: 4, border: "1px solid #dce5df", borderRadius: 6, background: "#fff", boxShadow: "0 8px 22px rgba(20, 35, 27, 0.14)" }}>
                              {companyNames
                                .filter((companyName) =>
                                  companyName.toLocaleLowerCase().includes(companySelection.companyDraft.trim().toLocaleLowerCase()) &&
                                  !companiesSelectedElsewhere.has(companyName),
                                )
                                .map((companyName) => (
                                  <button
                                    key={companyName}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => setCompanyAndResetBrands(companySelection.id, companyName)}
                                    style={{ border: 0, borderRadius: 4, background: "#fff", color: "#34453b", padding: "7px 8px", fontSize: 12, fontWeight: 400, textAlign: "left", cursor: "pointer" }}
                                  >{companyName}</button>
                                ))}
                              <span style={{ borderTop: "1px solid #edf0ed", marginTop: 3, padding: "7px 8px 4px", color: "#77857d", fontSize: 11, fontWeight: 400 }}>
                                {companyNames.some((companyName) => companyName.toLocaleLowerCase().includes(companySelection.companyDraft.trim().toLocaleLowerCase()))
                                  ? "Choose a match or use the typed name"
                                  : "No matching company; you can use the typed name"}
                              </span>
                            </div>
                          )}
                        </div>
                        {companySelection.isAddingCompany ? (
                          <>
                            <button
                              type="button"
                              disabled={!companySelection.companyDraft.trim() || draftCompanyAlreadySelected}
                              onClick={() => {
                                const match = companyNames.find((name) =>
                                  name.toLocaleLowerCase() === companySelection.companyDraft.trim().toLocaleLowerCase(),
                                );
                                setCompanyAndResetBrands(companySelection.id, match ?? companySelection.companyDraft.trim());
                              }}
                              style={{ border: 0, borderRadius: 6, background: companySelection.companyDraft.trim() && !draftCompanyAlreadySelected ? "#179c70" : "#aab7af", color: "#fff", padding: "7px 10px", fontSize: 12, fontWeight: 400, cursor: companySelection.companyDraft.trim() && !draftCompanyAlreadySelected ? "pointer" : "not-allowed" }}
                            >Set</button>
                            <button type="button" onClick={() => updateCompanySelection(companySelection.id, { companyDraft: "", isAddingCompany: false })} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "7px 10px", fontSize: 12, fontWeight: 400, cursor: "pointer" }}>Cancel</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            aria-label={companySelection.company ? "Add another company" : "Add a new company"}
                            title={companySelection.company ? "Add another company" : "Add a new company"}
                            disabled={isLoading || companySelection.isAddingCompany || companySelections.some((selection) => selection.id !== companySelection.id && (!selection.company || selection.isAddingCompany))}
                            onClick={() => {
                              if (companySelection.company) {
                                addCompanySelection();
                              } else {
                                updateCompanySelection(companySelection.id, { companyDraft: "", isAddingCompany: true });
                              }
                            }}
                            style={{ flex: "0 0 34px", width: 34, height: 34, border: "1px solid #179c70", borderRadius: 6, background: "#fff", color: "#16845f", fontSize: 18, fontWeight: 400, lineHeight: 1, cursor: isLoading || companySelection.isAddingCompany || companySelections.some((selection) => selection.id !== companySelection.id && (!selection.company || selection.isAddingCompany)) ? "not-allowed" : "pointer", opacity: isLoading || companySelection.isAddingCompany || companySelections.some((selection) => selection.id !== companySelection.id && (!selection.company || selection.isAddingCompany)) ? 0.55 : 1 }}
                          >+</button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "grid", alignContent: "start", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <span style={{ color: "#526158", fontSize: 12, fontWeight: 600 }}>Brand Name</span>
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            aria-haspopup="true"
                            aria-expanded={isCompanyListOpen}
                            onClick={() => setIsCompanyListOpen((current) => !current)}
                            style={{ border: 0, background: "transparent", color: "#16845f", padding: 0, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                          >Company List ▾</button>
                          {isCompanyListOpen && (
                            <div aria-label="Company List" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 20, display: "grid", gap: 2, minWidth: 220, maxHeight: 260, overflowY: "auto", padding: 6, border: "1px solid #dce5df", borderRadius: 7, background: "#fff", boxShadow: "0 12px 32px rgba(20, 35, 27, 0.16)" }}>
                              {companySelections.filter((item) => item.company).map((item) => (
                                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <button
                                    type="button"
                                    aria-pressed={item.id === companySelection.id}
                                    onClick={() => {
                                      setActiveCompanySelectionId(item.id);
                                      setIsCompanyListOpen(false);
                                    }}
                                    style={{ flex: 1, minWidth: 0, border: 0, borderRadius: 4, background: item.id === companySelection.id ? "#eaf7f1" : "#fff", color: "#34453b", padding: "8px 9px", fontSize: 12, textAlign: "left", cursor: "pointer" }}
                                  >{item.company}</button>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${item.company} and its selected brand data`}
                                    title={`Delete ${item.company}`}
                                    onClick={() => removeCompanySelection(item.id)}
                                    style={{ width: 26, height: 26, border: 0, borderRadius: 4, background: "transparent", color: "#b34b43", fontSize: 17, lineHeight: 1, cursor: "pointer" }}
                                  >×</button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  setIsCompanyListOpen(false);
                                  addCompanySelection();
                                }}
                                disabled={!companySelection.company || isLoading}
                                style={{ border: 0, borderTop: "1px solid #edf0ed", background: "#fff", color: "#16845f", padding: "9px", fontSize: 12, textAlign: "left", cursor: "pointer" }}
                              >+ Add company</button>
                            </div>
                          )}
                        </div>
                      </div>
                      {companySelection.brands
                        .filter((selection) => (!selection.productId && !selection.customBrand) || selection.isAddingBrand)
                        .map((selection, brandIndex) => (
                        <div key={selection.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {selection.isAddingBrand ? (
                            <input
                              aria-label={`New brand name ${brandIndex + 1}`}
                              autoFocus
                              value={selection.brandDraft}
                              onChange={(event) => updateBrandSelection(companySelection.id, selection.id, { brandDraft: event.target.value })}
                              placeholder="Enter new brand name"
                              disabled={!companySelection.company}
                              style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
                            />
                          ) : (
                            <select
                              aria-label={`Brand Name ${brandIndex + 1}`}
                              value={selection.productId}
                              disabled={!companySelection.company || companySelection.isAddingCompany || isLoading || companyProducts.length === 0}
                              onChange={(event) => {
                                const productId = event.target.value;
                                if (!productId) return;
                                openBatchEntry(companySelection.id, selection.id, {
                                  productId,
                                  customBrand: "",
                                  brandDraft: "",
                                });
                              }}
                              style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
                            >
                              <option value="">{!companySelection.company ? "Select company first" : companyProducts.length ? "Select brand" : "No brands for this company"}</option>
                              {companyProducts.map((product) => {
                                const brandName = product.brand.trim() || product.medicine_name.trim();
                                const duplicateBrand = companyProducts.some((other) =>
                                  other.id !== product.id &&
                                  (other.brand.trim() || other.medicine_name.trim()).toLocaleLowerCase() === brandName.toLocaleLowerCase(),
                                );
                                const suffix = duplicateBrand
                                  ? [product.strength, product.dosage_form].filter((value) => value && value !== "-").join(" · ")
                                  : "";
                                const alreadySelected = companySelection.brands.some((other) =>
                                  other.id !== selection.id && other.productId === product.id,
                                );
                                return (
                                  <option key={product.id} value={product.id} disabled={alreadySelected}>
                                    {suffix ? `${brandName} — ${suffix}` : brandName}
                                  </option>
                                );
                              })}
                            </select>
                          )}
                          {selection.isAddingBrand ? (
                            <>
                              <button
                                type="button"
                                disabled={!selection.brandDraft.trim()}
                                onClick={() => openBatchEntry(companySelection.id, selection.id, {
                                  productId: "",
                                  customBrand: selection.brandDraft.trim(),
                                  brandDraft: selection.brandDraft.trim(),
                                })}
                                style={{ border: 0, borderRadius: 6, background: selection.brandDraft.trim() ? "#179c70" : "#aab7af", color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: selection.brandDraft.trim() ? "pointer" : "not-allowed" }}
                              >Set</button>
                              <button type="button" onClick={() => updateBrandSelection(companySelection.id, selection.id, { isAddingBrand: false })} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                aria-label={`Add custom brand ${brandIndex + 1}`}
                                title="Add new brand"
                                disabled={!companySelection.company || companySelection.isAddingCompany}
                                onClick={() => updateBrandSelection(companySelection.id, selection.id, { brandDraft: "", isAddingBrand: true })}
                                style={{ flex: "0 0 36px", width: 36, height: 36, border: "1px solid #179c70", borderRadius: 6, background: "#fff", color: "#16845f", fontSize: 20, lineHeight: 1, cursor: companySelection.company ? "pointer" : "not-allowed", opacity: companySelection.company ? 1 : 0.5 }}
                              >+</button>
                              {companySelection.brands.length > 1 && (
                                <button
                                  type="button"
                                  aria-label={`Remove brand row ${brandIndex + 1}`}
                                  onClick={() => setCompanySelections((current) => current.map((item) =>
                                    item.id === companySelection.id
                                      ? { ...item, brands: item.brands.filter((brand) => brand.id !== selection.id) }
                                      : item,
                                  ))}
                                  style={{ flex: "0 0 36px", width: 36, height: 36, border: "1px solid #f0d7d4", borderRadius: 6, background: "#fff", color: "#b34b43", fontSize: 18, lineHeight: 1, cursor: "pointer" }}
                                >×</button>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      {companySelection.company && !companySelection.isAddingCompany && (
                        <button
                          type="button"
                          onClick={() => addBrandSelection(companySelection.id)}
                          disabled={companySelection.brands.some((brand) => (!brand.productId && !brand.customBrand) || brand.isAddingBrand)}
                          style={{ justifySelf: "start", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#16845f", padding: "7px 10px", fontSize: 12, fontWeight: 600, cursor: companySelection.brands.some((brand) => (!brand.productId && !brand.customBrand) || brand.isAddingBrand) ? "not-allowed" : "pointer", opacity: companySelection.brands.some((brand) => (!brand.productId && !brand.customBrand) || brand.isAddingBrand) ? 0.55 : 1 }}
                        >+ Add another brand</button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {isLoading && <p role="status" style={{ margin: "0 24px 18px", color: "#687871", fontSize: 12 }}>Loading products from your Product List...</p>}
            {errorMessage && <p role="alert" style={{ margin: "0 24px 18px", color: "#b34b43", fontSize: 12 }}>{errorMessage}</p>}

            {activeCompanyName && ongoingOrderRows.length > 0 && (
              <section aria-labelledby="ongoing-order-title" style={{ margin: "0 24px 18px" }}>
                <h3 id="ongoing-order-title" style={{ margin: "0 0 10px", color: "#526158", fontSize: 13, fontWeight: 700 }}>Ongoing Order</h3>
                <div style={{ overflowX: "auto", border: "1px solid #dce5df", borderRadius: 6 }}>
                  <table aria-label={`Ongoing orders for ${activeCompanyName}`} style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr>
                        {["Order", "Brand Name", "Strength", "Box Quantity", "Pack Size", "Purchase Price (Box)", "Total Price", "Action"].map((heading) => (
                          <th key={heading} scope="col" style={{ padding: "9px 11px", borderBottom: "1px solid #dce5df", background: "#f4f7f5", color: "#687871", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ongoingOrderRows.map((row, index) => (
                        <tr key={row.id}>
                          {[row.order, row.brand, row.strength, row.quantity ?? "-", row.packSize, `৳${row.packPrice}`, row.totalPrice ? `৳${row.totalPrice}` : "-", null].map((value, cellIndex) => (
                            <td key={cellIndex} style={{ padding: "9px 11px", borderBottom: index === ongoingOrderRows.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>
                              {cellIndex === 7 ? (
                                <button
                                  type="button"
                                  onClick={() => openOngoingOrderReceive(row)}
                                  style={{ border: 0, borderRadius: 5, background: "#179c70", color: "#fff", padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                                >Receive</button>
                              ) : value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {(selectedBatchDetails.length > 0 || receivedInvoiceRows.length > 0) && (
              <>
                <h3 style={{ margin: "0 24px 10px", color: "#526158", fontSize: 13, fontWeight: 700 }}>Receive Invoice</h3>
                <div style={{ margin: "0 24px 18px", overflowX: "auto", border: "1px solid #dce5df", borderRadius: 6 }}>
                  <table aria-label="Selected brand details" style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr>
                        {["Brand Name", "Generic Name", "Strength", "Dosage Form", "Batch Number", "Mfg Date", "Exp Date", "Box MRP", "Pack Size", "Unit Price", "Pack Price", "Actions"].map((heading) => (
                          <th key={heading} scope="col" style={{ padding: "10px 12px", borderBottom: "1px solid #dce5df", background: "#f4f7f5", color: "#687871", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBatchDetails.map(({ companySelection, selection, product, batch, batchIndex }, index) => (
                        <tr key={`${companySelection.id}-${selection.id}-${batchIndex}`}>
                          {([
                            batchIndex === 0 ? product?.brand || product?.medicine_name || selection.customBrand : "",
                            batchIndex === 0 ? product?.generic_name : "",
                            batchIndex === 0 ? product?.strength : "",
                            batchIndex === 0 ? product?.dosage_form : "",
                            batch.batchNumber,
                            formatMonthYear(batch.mfgDate),
                            formatMonthYear(batch.expDate),
                            batch.mrp,
                            batch.packSize,
                            batchIndex === 0 ? product?.unit_price : "",
                            batchIndex === 0 ? product?.pack_price : "",
                            null,
                          ] as const).map((value, cellIndex) => (
                            <td key={cellIndex} style={{ padding: "10px 12px", borderBottom: index === selectedBatchDetails.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>
                              {cellIndex === 11 ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ color: "#16845f", fontSize: 11, fontWeight: 600 }}>Received</span>
                                  <button
                                    type="button"
                                    aria-label={`Delete batch ${batch.batchNumber}`}
                                    title="Delete batch"
                                    onClick={() => updateBrandSelection(companySelection.id, selection.id, {
                                      batches: selection.batches.filter((_, currentBatchIndex) => currentBatchIndex !== batchIndex),
                                    })}
                                    style={{ width: 24, height: 24, border: "1px solid #f0d7d4", borderRadius: 5, background: "#fff", color: "#b34b43", fontSize: 17, lineHeight: 1, cursor: "pointer" }}
                                  >×</button>
                                </div>
                              ) : cellIndex === 4 ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span>{displayValue(value ?? undefined)}</span>
                                  {batchIndex === 0 && (
                                    <button
                                      type="button"
                                      aria-label={`Add batch for ${displayValue(product?.brand || product?.medicine_name || selection.customBrand)}`}
                                      title="Add batch"
                                      onClick={() => openBatchEntry(
                                        companySelection.id,
                                        selection.id,
                                        {
                                          productId: selection.productId,
                                          customBrand: selection.customBrand,
                                          brandDraft: selection.brandDraft,
                                        },
                                        selection.batches,
                                      )}
                                      style={{ width: 22, height: 22, border: "1px solid #b9dfd0", borderRadius: 5, background: "#fff", color: "#16845f", fontSize: 17, lineHeight: 1, cursor: "pointer" }}
                                    >+</button>
                                  )}
                                </div>
                              ) : value === "" ? "" : displayValue(value ?? undefined)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {receivedInvoiceRows.map((row, index) => (
                        <tr key={row.id}>
                          {[
                            row.brand,
                            row.genericName,
                            row.strength,
                            row.dosageForm,
                            row.batchNumber,
                            formatMonthYear(row.mfgDate),
                            formatMonthYear(row.expDate),
                            row.mrp ?? "",
                            row.packSize,
                            row.unitPrice,
                            row.packPrice,
                            null,
                          ].map((value, cellIndex) => (
                            <td key={cellIndex} style={{ padding: "10px 12px", borderBottom: index === receivedInvoiceRows.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>
                              {cellIndex === 11 ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ color: "#16845f", fontSize: 11, fontWeight: 600 }}>Received</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${row.brand} from Receive Invoice`}
                                    title="Remove from Receive Invoice"
                                    onClick={() => setPendingOrderReceipts((current) =>
                                      current
                                        .map((receipt) => ({
                                          ...receipt,
                                          rows: receipt.rows.filter((receiptRow) => receiptRow.id !== row.id),
                                        }))
                                        .filter((receipt) => receipt.rows.length > 0),
                                    )}
                                    style={{ width: 24, height: 24, border: "1px solid #f0d7d4", borderRadius: 5, background: "#fff", color: "#b34b43", fontSize: 17, lineHeight: 1, cursor: "pointer" }}
                                  >×</button>
                                </div>
                              ) : displayValue(value ?? undefined)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {purchaseSaveError && <p role="alert" style={{ margin: "0 24px 12px", color: "#b34b43", fontSize: 12 }}>{purchaseSaveError}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 24px 18px" }}>
              <button
                type="button"
                onClick={receivePurchase}
                disabled={!canReceivePurchase}
                style={{ border: 0, borderRadius: 6, background: canReceivePurchase ? "#179c70" : "#aab7af", color: "#fff", padding: "10px 16px", fontSize: 12, fontWeight: 650, cursor: canReceivePurchase ? "pointer" : "not-allowed" }}
              >Received</button>
            </div>

            {pendingBatchEntry && (
              <div
                onMouseDown={(event) => { if (event.target === event.currentTarget) cancelBatchEntry(); }}
                style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.56)" }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="purchase-batch-title"
                  style={{ width: "min(680px, 100%)", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
                >
                  <div style={{ padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
                    <h2 id="purchase-batch-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Add Batch Details</h2>
                    <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>
                      {pendingBatchEntry.customBrand || products.find((product) => product.id === pendingBatchEntry.productId)?.brand || "Selected product"}
                    </p>
                  </div>
                  <form onSubmit={saveBatchEntry} noValidate>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, padding: "18px 24px" }}>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Batch Number
                        <input
                          aria-label="Batch Number"
                          required
                          autoFocus
                          value={pendingBatchEntry.batchNumber}
                          onChange={(event) => updatePendingBatchField("batchNumber", event.target.value)}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("batchNumber", event.currentTarget)}
                          onBlur={() => finishEditingBatchField("batchNumber")}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Mfg Date
                        <input
                          aria-label="Mfg Date"
                          inputMode="numeric"
                          placeholder="MM/YY"
                          maxLength={5}
                          value={pendingBatchEntry.mfgDate}
                          onChange={(event) => updateBatchDate("mfgDate", event.target.value)}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("mfgDate", event.currentTarget)}
                          onBlur={() => finishEditingBatchField("mfgDate")}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Exp Date
                        <input
                          aria-label="Exp Date"
                          inputMode="numeric"
                          placeholder="MM/YY"
                          maxLength={5}
                          value={pendingBatchEntry.expDate}
                          onChange={(event) => updateBatchDate("expDate", event.target.value)}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("expDate", event.currentTarget)}
                          onBlur={() => finishEditingBatchField("expDate")}
                          ref={expDateInputRef}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Box MRP
                        <input
                          aria-label="Box MRP"
                          inputMode="decimal"
                          value={pendingBatchEntry.mrp}
                          onChange={(event) => updatePendingBatchField("mrp", event.target.value)}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("mrp", event.currentTarget)}
                          onBlur={() => finishEditingBatchField("mrp")}
                          ref={mrpInputRef}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Pack Size
                        <input
                          aria-label="Pack Size"
                          value={pendingBatchEntry.packSize}
                          onChange={(event) => updatePendingBatchField("packSize", event.target.value)}
                          onBlur={() => finishEditingBatchField("packSize")}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("packSize", event.currentTarget)}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Box Quantity
                        <input
                          aria-label="Box Quantity"
                          inputMode="decimal"
                          value={pendingBatchEntry.quantity}
                          onChange={(event) => updatePendingBatchField("quantity", event.target.value)}
                          onBlur={() => finishEditingBatchField("quantity")}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("quantity", event.currentTarget)}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Purchase Price (Box)
                        <input
                          aria-label="Purchase Price (Box)"
                          inputMode="decimal"
                          value={pendingBatchEntry.purchasePrice}
                          onChange={(event) => updatePendingBatchField("purchasePrice", event.target.value)}
                          onBlur={() => finishEditingBatchField("purchasePrice")}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("purchasePrice", event.currentTarget)}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Total Purchase Price
                        <input
                          aria-label="Total Purchase Price"
                          inputMode="decimal"
                          value={pendingBatchEntry.totalPrice}
                          onChange={(event) => updatePendingBatchField("totalPrice", event.target.value)}
                          onFocus={(event) => preservePendingBatchFieldOnFocus("totalPrice", event.currentTarget)}
                          onBlur={() => finishEditingBatchField("totalPrice")}
                          style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                        />
                      </label>
                    </div>
                    {pendingBatchEntry.batches.length > 0 && (
                      <div style={{ margin: "0 24px 16px", overflowX: "auto", border: "1px solid #dce5df", borderRadius: 6 }}>
                        <table aria-label="Added batch details" style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                          <thead>
                            <tr>
                              {["Batch Number", "Mfg Date", "Exp Date", "Box MRP", "Pack Size", "Box Quantity", "Purchase Price (Box)", "Total Purchase Price", "Actions"].map((heading) => (
                                <th key={heading} scope="col" style={{ padding: "9px 12px", borderBottom: "1px solid #dce5df", background: "#f4f7f5", color: "#687871", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pendingBatchEntry.batches.map((batch, index) => (
                              <tr key={`${batch.batchNumber}-${index}`}>
                                {[
                                  batch.batchNumber,
                                  formatMonthYear(batch.mfgDate),
                                  formatMonthYear(batch.expDate),
                                  batch.mrp || "-",
                                  batch.packSize,
                                  batch.quantity || "-",
                                  batch.purchasePrice || "-",
                                  batch.totalPrice || "-",
                                ].map((value, cellIndex) => (
                                  <td key={cellIndex} style={{ padding: "9px 12px", borderBottom: index === pendingBatchEntry.batches.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>{value}</td>
                                ))}
                                <td style={{ padding: "9px 12px", borderBottom: index === pendingBatchEntry.batches.length - 1 ? 0 : "1px solid #e8ede9" }}>
                                  <button
                                    type="button"
                                    aria-label={`Delete batch ${batch.batchNumber}`}
                                    title="Delete batch"
                                    onClick={() => setPendingBatchEntry((current) => current ? {
                                      ...current,
                                      batches: current.batches.filter((_, batchIndex) => batchIndex !== index),
                                    } : current)}
                                    style={{ width: 24, height: 24, border: "1px solid #f0d7d4", borderRadius: 5, background: "#fff", color: "#b34b43", fontSize: 17, lineHeight: 1, cursor: "pointer" }}
                                  >×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {batchEntryError && <p role="alert" style={{ margin: "0 24px 14px", color: "#b34b43", fontSize: 12 }}>{batchEntryError}</p>}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                      <button type="button" onClick={cancelBatchEntry} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                      <button type="submit" style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Done</button>
                    </div>
                  </form>
                </section>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
              <button type="button" onClick={closeModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
            </div>
          </section>
        </div>
      )}
      {isPlaceOrderOpen && (
        <div
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePlaceOrderModal(); }}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16, background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="place-order-title"
            style={{ width: "min(1080px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="place-order-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Place Order</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Select a company and one or more brands to place an order.</p>
              </div>
              <button type="button" aria-label="Close Place Order" onClick={closePlaceOrderModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <form onSubmit={submitPlaceOrder}>
              <div style={{ display: "grid", gap: 18, padding: "22px 24px" }}>
                <label style={{ display: "grid", gridTemplateColumns: "120px minmax(220px, 1fr)", alignItems: "center", maxWidth: 520, gap: 12, color: "#526158", fontSize: 12, fontWeight: 400 }}>
                  <span>Company Name</span>
                  <select
                    aria-label="Place Order Company Name"
                    required
                    value={placeOrderCompany}
                    disabled={isLoading}
                    onChange={(event) => {
                      setPlaceOrderCompany(event.target.value);
                      setPlaceOrderDraft({ productId: "", packPrice: "", quantity: "", purchasePrice: "" });
                      setPlaceOrderPackSize("");
                      setPlaceOrderItems([]);
                      setNextPlaceOrderLineId(0);
                      setPlaceOrderError("");
                    }}
                    style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                  >
                    <option value="">{isLoading ? "Loading companies..." : "Select company"}</option>
                    {companyNames.map((company) => <option key={company} value={company}>{company}</option>)}
                  </select>
                </label>

                {placeOrderCompany && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.5fr) repeat(4, minmax(115px, 1fr)) auto", alignItems: "end", gap: 12 }}>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Brand Name
                        <select
                          aria-label="Place Order Brand Name"
                          value={placeOrderDraft.productId}
                          onChange={(event) => {
                            const product = products.find((item) => item.id === event.target.value);
                            setPlaceOrderDraft((current) => ({
                              ...current,
                              productId: event.target.value,
                              packPrice: product?.pack_price && product.pack_price !== "-" ? product.pack_price : "",
                            }));
                            setPlaceOrderPackSize(product?.pack_size ?? "");
                            setPlaceOrderError("");
                          }}
                          style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                        >
                          <option value="">Select brand</option>
                          {products
                            .filter((product) => product.manufacturer.trim() === placeOrderCompany)
                            .map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.brand.trim() || product.medicine_name.trim()}
                                {product.strength.trim() ? ` · ${product.strength.trim()}` : ""}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Pack Price
                        <input
                          aria-label="Place Order Pack Price"
                          inputMode="decimal"
                          value={placeOrderDraft.packPrice}
                          onChange={(event) => {
                            setPlaceOrderDraft((current) => ({ ...current, packPrice: event.target.value }));
                            setPlaceOrderError("");
                          }}
                          style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Box Quantity
                        <input
                          aria-label="Place Order Box Quantity"
                          inputMode="decimal"
                          value={placeOrderDraft.quantity}
                          onChange={(event) => {
                            setPlaceOrderDraft((current) => ({ ...current, quantity: event.target.value }));
                            setPlaceOrderError("");
                          }}
                          style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Pack Size
                        <input
                          aria-label="Place Order Pack Size"
                          inputMode="decimal"
                          value={placeOrderPackSize}
                          onChange={(event) => {
                            setPlaceOrderPackSize(event.target.value);
                            setPlaceOrderError("");
                          }}
                          style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        Purchase Price (Box)
                        <input
                          aria-label="Place Order Purchase Price (Box)"
                          inputMode="decimal"
                          value={placeOrderDraft.purchasePrice}
                          onChange={(event) => {
                            setPlaceOrderDraft((current) => ({ ...current, purchasePrice: event.target.value }));
                            setPlaceOrderError("");
                          }}
                          style={{ ...fieldStyle, height: 34, padding: "6px 8px", fontSize: 12, fontWeight: 400 }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={addPlaceOrderItem}
                        style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                      >Add</button>
                    </div>
                    {placeOrderItems.length > 0 && (
                      <div style={{ overflowX: "auto", borderTop: "1px solid #e8ede9", borderBottom: "1px solid #e8ede9" }}>
                        <table aria-label="Place order items" style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", textAlign: "left" }}>
                          <thead>
                            <tr>
                              {["Brand Name", "Pack Price", "Pack Size", "Box Quantity", "Purchase Price (Box)", "Total Price", "Unit Purchase Price", "Actions"].map((heading) => (
                                <th key={heading} scope="col" style={{ padding: "10px 12px", borderBottom: "1px solid #dce5df", color: "#687871", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {placeOrderItems.map((item) => {
                              const product = products.find((candidate) => candidate.id === item.productId);
                              return (
                                <tr key={item.id}>
                                  {[
                                    product?.brand.trim() || product?.medicine_name.trim() || "",
                                    item.packPrice || "-",
                                    displayValue(item.packSize),
                                    item.quantity,
                                    `৳${item.purchasePrice}`,
                                    `৳${Number(item.totalPrice).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                    calculateUnitPurchasePrice(item.packSize, item.totalPrice, item.quantity) === "-"
                                      ? "-"
                                      : `৳${Number(calculateUnitPurchasePrice(item.packSize, item.totalPrice, item.quantity)).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                  ].map((value, cellIndex) => (
                                    <td key={cellIndex} style={{ padding: "10px 12px", borderBottom: "1px solid #f0f2f0", color: "#34453b", fontSize: 12, whiteSpace: "nowrap" }}>{value}</td>
                                  ))}
                                  <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f2f0" }}>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${product?.brand.trim() || product?.medicine_name.trim() || "brand"} from order`}
                                      onClick={() => setPlaceOrderItems((current) => current.filter((entry) => entry.id !== item.id))}
                                      style={{ border: 0, background: "transparent", color: "#b34b43", fontSize: 18, cursor: "pointer" }}
                                    >×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 16px", borderRadius: 7, background: "#f4f7f5", color: "#20342a", fontSize: 13, fontWeight: 700 }}>
                  Total Order Price: ৳{placeOrderTotal.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              {placeOrderError && <p role="alert" style={{ margin: "0 24px 14px", color: "#b34b43", fontSize: 12 }}>{placeOrderError}</p>}
              {errorMessage && <p role="alert" style={{ margin: "0 24px 14px", color: "#b34b43", fontSize: 12 }}>{errorMessage}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 24px", borderTop: "1px solid #e9eeea", background: "#fbfcfb" }}>
                <button type="button" onClick={closePlaceOrderModal} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={isLoading || !placeOrderCompany} style={{ border: 0, borderRadius: 6, background: isLoading || !placeOrderCompany ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: isLoading || !placeOrderCompany ? "not-allowed" : "pointer" }}>Place Order</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
