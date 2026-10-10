"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  persistPlaceOrderListRows,
  persistPurchaseListRows,
  calculateTotalQuantity,
  calculateUnitPurchasePrice,
  emptyPurchaseListSnapshot,
  getPlaceOrderListSnapshot,
  readPlaceOrderListRows,
  readPurchaseListRows,
  subscribeToPlaceOrderList,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import {
  emptyPaymentMethodsSnapshot,
  getPaymentMethodsSnapshot,
  subscribeToPaymentMethods,
} from "./paymentMethodsStorage";

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
  supplierContactName: string;
  supplierPhone: string;
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
    supplierContactName: "",
    supplierPhone: "",
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

function getUnitPrice(unitPrice: string | undefined, mrp: string | undefined, packSize: string) {
  const savedUnitPrice = unitPrice?.trim();
  if (savedUnitPrice && savedUnitPrice !== "-") return savedUnitPrice;
  return calculateUnitPurchasePrice(packSize, mrp ?? "", "1");
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

function getDefaultSupplierName(company: string) {
  return company.trim() ? `${company.trim()} Distributor` : "";
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
    const key = `${row.order}\u0000${getReceivedBatchKey(row)}`;
    if (!rowIndexesByBatch.has(key)) rowIndexesByBatch.set(key, index);
  });

  for (const incomingRow of incomingRows) {
    const key = `${incomingRow.order}\u0000${getReceivedBatchKey(incomingRow)}`;
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
    let availableQuantity: number | undefined;
    if (existingRow.availableQuantity !== undefined) {
      const currentAvailable = Number(existingRow.availableQuantity);
      const receivedQuantity = calculateTotalQuantity(incomingRow.packSize, incomingRow.quantity ?? "");
      if (!Number.isFinite(currentAvailable) || currentAvailable < 0 || receivedQuantity === null) {
        throw new Error(`Could not update available stock for ${existingRow.brand}, batch ${existingRow.batchNumber}.`);
      }
      availableQuantity = currentAvailable + receivedQuantity;
    }
    rows[existingIndex] = {
      ...existingRow,
      ...(incomingRow.supplierContactName ? { supplierContactName: incomingRow.supplierContactName } : {}),
      ...(incomingRow.supplierPhone !== undefined ? { supplierPhone: incomingRow.supplierPhone } : {}),
      quantity: formatOrderPrice(quantity),
      ...(availableQuantity !== undefined ? { availableQuantity: String(availableQuantity) } : {}),
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
  const purchaseListSnapshot = useSyncExternalStore(
    subscribeToPurchaseList,
    getPurchaseListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const placeOrderListSnapshot = useSyncExternalStore(
    subscribeToPlaceOrderList,
    getPlaceOrderListSnapshot,
    () => emptyPurchaseListSnapshot,
  );
  const paymentMethodsSnapshot = useSyncExternalStore(
    subscribeToPaymentMethods,
    getPaymentMethodsSnapshot,
    () => emptyPaymentMethodsSnapshot,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isPlaceOrderOpen, setIsPlaceOrderOpen] = useState(false);
  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [companySelections, setCompanySelections] = useState<CompanySelection[]>([
    createCompanySelection(0, 0),
  ]);
  const [activeCompanySelectionId, setActiveCompanySelectionId] = useState(0);
  const [focusedSupplierInput, setFocusedSupplierInput] = useState<{
    selectionId: number;
    field: "name" | "phone";
  } | null>(null);
  const [nextCompanySelectionId, setNextCompanySelectionId] = useState(1);
  const [nextBrandSelectionId, setNextBrandSelectionId] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingBatchEntry, setPendingBatchEntry] = useState<PendingBatchEntry | null>(null);
  const [batchPurchasePriceMode, setBatchPurchasePriceMode] = useState<"flat" | "percent">("flat");
  const [batchPurchasePriceRate, setBatchPurchasePriceRate] = useState("");
  const expDateInputRef = useRef<HTMLInputElement>(null);
  const mrpInputRef = useRef<HTMLInputElement>(null);
  const focusedBatchFieldRef = useRef<{ field: EditableBatchField; originalValue: string } | null>(null);
  const [pendingOrderReceipts, setPendingOrderReceipts] = useState<PendingOrderReceipt[]>([]);
  const [receiveDiscountType, setReceiveDiscountType] = useState<"flat" | "percent">("flat");
  const [receiveDiscountValue, setReceiveDiscountValue] = useState("");
  const [receiveTaxRate, setReceiveTaxRate] = useState("0");
  const [receivePaymentMethod, setReceivePaymentMethod] = useState("cash");
  const [receivePayAmount, setReceivePayAmount] = useState("");
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
  function getSavedSupplierContacts() {
    const seenContacts = new Set<string>();
    return purchaseListSnapshot.rows
      .filter((row) => row.supplierContactName?.trim() && row.supplierPhone?.trim())
      .sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))
      .map((row) => ({
        name: row.supplierContactName?.trim() ?? "",
        phone: row.supplierPhone?.trim() ?? "",
      }))
      .filter((contact) => {
        const key = `${contact.name.toLocaleLowerCase()}\u0000${contact.phone.replace(/\D/g, "")}`;
        if (!contact.name || !contact.phone || seenContacts.has(key)) return false;
        seenContacts.add(key);
        return true;
      });
  }

  function getSavedSupplierContact(company: string) {
    const normalizedCompany = company.trim().toLocaleLowerCase();
    const companyContact = purchaseListSnapshot.rows.find((row) =>
      row.supplier.trim().toLocaleLowerCase() === normalizedCompany
      && row.supplierContactName?.trim()
      && row.supplierPhone?.trim(),
    );
    if (companyContact) {
      return {
        name: companyContact.supplierContactName?.trim() ?? "",
        phone: companyContact.supplierPhone?.trim() ?? "",
      };
    }
    return getSavedSupplierContacts()[0];
  }
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
  const hasReceiveInvoiceRows = selectedBatchDetails.length > 0 || pendingOrderReceiptRows.length > 0;
  const canReceivePurchase = hasReceiveInvoiceRows && !isLoading;
  const activeCompanyName = companySelections.find((selection) => selection.id === activeCompanySelectionId)?.company;
  const ongoingOrderRows = activeCompanyName
    ? placeOrderListSnapshot.rows.filter((row) =>
      row.supplier === activeCompanyName &&
      row.status.toLocaleLowerCase() !== "received" &&
      !pendingOrderReceiptIds.has(row.id),
    )
    : [];
  const receivedInvoiceRows = pendingOrderReceiptRows;
  const receiveSummaryLines = [
    ...selectedBatchDetails.map(({ batch }) => ({
      quantity: parseOrderPrice(batch.quantity) ?? 0,
      amount: parseOrderPrice(batch.totalPrice) ?? 0,
    })),
    ...pendingOrderReceiptRows.map((row) => ({
      quantity: parseOrderPrice(row.quantity ?? "") ?? 0,
      amount: parseOrderPrice(row.totalPrice ?? "") ?? 0,
    })),
  ];
  const receiveSummaryCompanyCount = new Set([
    ...companySelections.map((selection) => selection.company.trim().toLocaleLowerCase()).filter(Boolean),
    ...pendingOrderReceiptRows.map((row) => row.supplier.trim().toLocaleLowerCase()).filter(Boolean),
  ]).size;
  const receiveSummaryBrandCount = new Set([
    ...selectedProductDetails.map(({ companySelection, selection, product }) =>
      `${companySelection.company}\u0000${product?.brand || product?.medicine_name || selection.customBrand}`.toLocaleLowerCase(),
    ),
    ...pendingOrderReceiptRows.map((row) => `${row.supplier}\u0000${row.brand}`.toLocaleLowerCase()),
  ]).size;
  const receiveSummaryQuantity = receiveSummaryLines.reduce((total, line) => total + line.quantity, 0);
  const receiveSummaryTotal = receiveSummaryLines.reduce((total, line) => total + line.amount, 0);
  const parsedReceiveDiscount = receiveDiscountValue.trim() ? Number(receiveDiscountValue) : 0;
  const validReceiveDiscount = Number.isFinite(parsedReceiveDiscount)
    && parsedReceiveDiscount >= 0
    && (receiveDiscountType === "percent" ? parsedReceiveDiscount <= 100 : parsedReceiveDiscount <= receiveSummaryTotal);
  const receiveDiscountAmount = validReceiveDiscount
    ? Number((receiveDiscountType === "percent"
      ? receiveSummaryTotal * parsedReceiveDiscount / 100
      : parsedReceiveDiscount).toFixed(2))
    : 0;
  const receiveTaxBase = Math.max(0, receiveSummaryTotal - receiveDiscountAmount);
  const parsedReceiveTaxRate = receiveTaxRate.trim() ? Number(receiveTaxRate) : 0;
  const validReceiveTaxRate = Number.isFinite(parsedReceiveTaxRate)
    && parsedReceiveTaxRate >= 0
    && parsedReceiveTaxRate <= 100;
  const receiveTaxAmount = validReceiveTaxRate
    ? Number((receiveTaxBase * parsedReceiveTaxRate / 100).toFixed(2))
    : 0;
  const receiveSubTotal = Number((receiveTaxBase + receiveTaxAmount).toFixed(2));
  const parsedReceivePayAmount = receivePayAmount.trim() ? Number(receivePayAmount) : 0;
  const validReceivePayAmount = Number.isFinite(parsedReceivePayAmount)
    && parsedReceivePayAmount >= 0
    && parsedReceivePayAmount <= receiveSubTotal;
  const receivePaidAmount = validReceivePayAmount ? Number(parsedReceivePayAmount.toFixed(2)) : 0;
  const receiveDueAmount = validReceivePayAmount
    ? Number(Math.max(0, receiveSubTotal - receivePaidAmount).toFixed(2))
    : receiveSubTotal;
  const receivePaymentMethodOptions = [
    { value: "cash", label: "Cash" },
    ...paymentMethodsSnapshot.rows.map((method) => ({
      value: `${method.type}:${method.id}`,
      label: method.type === "mobile" ? method.name : method.bankName,
    })),
  ];
  const effectiveReceivePaymentMethod = receivePaymentMethodOptions.some((option) => option.value === receivePaymentMethod)
    ? receivePaymentMethod
    : "cash";
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
    setNextCompanySelectionId(1);
    setNextBrandSelectionId(1);
    setPendingBatchEntry(null);
    setBatchPurchasePriceMode("flat");
    setBatchPurchasePriceRate("");
    setPendingOrderReceipts([]);
    setBatchEntryError("");
    setErrorMessage("");
    setPurchaseSaveError("");
    setReceiveDiscountType("flat");
    setReceiveDiscountValue("");
    setReceiveTaxRate("0");
    setReceivePaymentMethod("cash");
    setReceivePayAmount("");
  }

  function receivePurchase() {
    if (!canReceivePurchase) return;
    if (!validReceiveDiscount) {
      setPurchaseSaveError("Enter a valid discount amount.");
      return;
    }
    if (!validReceiveTaxRate) {
      setPurchaseSaveError("Enter a VAT/Tax rate from 0 to 100.");
      return;
    }
    if (!validReceivePayAmount) {
      setPurchaseSaveError("Enter a payment amount between 0 and the subtotal.");
      return;
    }
    if (paymentMethodsSnapshot.error) {
      setPurchaseSaveError("Could not load payment methods. Please try again.");
      return;
    }
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
          supplierContactName: companySelection.supplierContactName.trim() || getDefaultSupplierName(companySelection.company),
          supplierPhone: companySelection.supplierPhone.trim(),
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
          unitPrice: getUnitPrice(product?.unit_price, batch.mrp, batch.packSize),
          orderPaidAmount: formatOrderPrice(receivePaidAmount),
          orderDueAmount: formatOrderPrice(receiveDueAmount),
          productId: product?.id,
          status: "Received",
        })),
      );
      const stagedOrderRows = pendingOrderReceiptRows.map((row) => ({
        ...row,
        order,
        orderDate,
        supplierContactName: companySelections.find((selection) => selection.company === row.supplier)?.supplierContactName.trim()
          || getDefaultSupplierName(row.supplier),
        supplierPhone: companySelections.find((selection) => selection.company === row.supplier)?.supplierPhone.trim() ?? "",
        orderPaidAmount: formatOrderPrice(receivePaidAmount),
        orderDueAmount: formatOrderPrice(receiveDueAmount),
      }));
      const updatedRows = mergeReceivedRows(receiveRows, [...newRows, ...stagedOrderRows]);
      persistPurchaseListRows(updatedRows);
      if (pendingOrderReceipts.length > 0) {
        const receivedPlaceOrders = new Map(pendingOrderReceipts.map((receipt) => {
          const receivedBatchKeys = new Set(receipt.rows.map(getReceivedBatchKey));
          const matchingRows = updatedRows.filter(
            (row) => row.order === order && receivedBatchKeys.has(getReceivedBatchKey(row)),
          );
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
      const now = new Date();
      const orderDate = now.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
      const newRows = placeOrderItems.map((line): PurchaseListRow => {
        const product = products.find((item) => item.id === line.productId);
        return {
          id: `${order}-${line.id}`,
          order,
          updatedAt: now.toISOString(),
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
    setBatchPurchasePriceMode("flat");
    setBatchPurchasePriceRate("");
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
    setBatchPurchasePriceMode("flat");
    setBatchPurchasePriceRate("");
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
    setPendingBatchEntry((current) => {
      if (!current) return current;
      if (field === "mrp" && batchPurchasePriceMode === "percent") {
        const price = getPurchasePriceFromRate(value, batchPurchasePriceRate);
        const quantity = parseOrderPrice(current.quantity);
        return {
          ...current,
          mrp: value,
          purchasePrice: price ?? "",
          totalPrice: price !== null && quantity !== null
            ? formatOrderPrice(quantity * Number(price))
            : "",
        };
      }
      return { ...current, [field]: value };
    });
    setBatchEntryError("");
  }

  function getPurchasePriceFromRate(mrpValue: string, rateValue: string) {
    const mrp = parseOrderPrice(mrpValue);
    const rate = parseOrderPrice(rateValue);
    if (mrp === null || rate === null || rate > 100) return null;
    return formatOrderPrice(Number((mrp * (1 - rate / 100)).toFixed(2)));
  }

  function getCurrentBatchPurchasePrice() {
    if (!pendingBatchEntry) return null;
    if (batchPurchasePriceMode === "percent") {
      return getPurchasePriceFromRate(pendingBatchEntry.mrp, batchPurchasePriceRate);
    }
    const price = parseOrderPrice(pendingBatchEntry.purchasePrice);
    return price === null ? null : formatOrderPrice(price);
  }

  function updateBatchPurchasePriceRate(rateValue: string) {
    setBatchPurchasePriceRate(rateValue);
    setPendingBatchEntry((current) => {
      if (!current) return current;
      const purchasePrice = getPurchasePriceFromRate(current.mrp, rateValue);
      const quantity = parseOrderPrice(current.quantity);
      return {
        ...current,
        purchasePrice: purchasePrice ?? "",
        totalPrice: purchasePrice !== null && quantity !== null
          ? formatOrderPrice(quantity * Number(purchasePrice))
          : "",
      };
    });
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
    const product = products.find((item) => item.id === pendingBatchEntry.productId);
    const defaultMrp = pendingBatchEntry.placeOrderRow?.mrp
      || (product?.pack_price.trim() && product.pack_price !== "-" ? product.pack_price : "");
    const defaultPackSize = pendingBatchEntry.placeOrderRow?.packSize
      || product?.pack_size.trim()
      || "";
    const batchNumber = pendingBatchEntry.batchNumber.trim();
    const hasCurrentBatchValues = batchNumber ||
      pendingBatchEntry.mfgDate ||
      pendingBatchEntry.expDate ||
      pendingBatchEntry.mrp !== defaultMrp ||
      pendingBatchEntry.packSize !== defaultPackSize ||
      pendingBatchEntry.quantity ||
      pendingBatchEntry.purchasePrice ||
      (batchPurchasePriceMode === "percent" && batchPurchasePriceRate) ||
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
      if (batchPurchasePriceMode === "percent" && getPurchasePriceFromRate(pendingBatchEntry.mrp, batchPurchasePriceRate) === null) {
        setBatchEntryError("Enter a discount percentage from 0 to 100 and a valid Box MRP.");
        return;
      }
      const quantity = parseOrderPrice(pendingBatchEntry.quantity);
      const purchasePrice = parseOrderPrice(pendingBatchEntry.purchasePrice);
      const totalPrice = parseOrderPrice(pendingBatchEntry.totalPrice);
      if (
        (pendingBatchEntry.mrp && parseOrderPrice(pendingBatchEntry.mrp) === null) ||
        (pendingBatchEntry.quantity && (quantity === null || quantity <= 0)) ||
        (pendingBatchEntry.purchasePrice && purchasePrice === null) ||
        (pendingBatchEntry.totalPrice && totalPrice === null)
      ) {
        setBatchEntryError("Enter a valid non-negative Box MRP, Box Quantity, Purchase Price (Box), and Total Price.");
        return;
      }
      batches = [...batches, {
        batchNumber,
        mfgDate,
        expDate,
        mrp: pendingBatchEntry.mrp.trim(),
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
        unitPrice: getUnitPrice(sourceRow.unitPrice, batch.mrp, batch.packSize),
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

    const companySelection = companySelections.find((selection) => selection.id === pendingBatchEntry.companySelectionId);
    const hasUnusedBrandSearch = companySelection?.brands.some((selection) =>
      selection.id !== pendingBatchEntry.brandSelectionId
      && !selection.productId
      && !selection.customBrand
      && !selection.isAddingBrand,
    ) ?? false;
    const newBrandSearch = hasUnusedBrandSearch
      ? undefined
      : createBrandSelection(nextBrandSelectionId);
    if (newBrandSearch) setNextBrandSelectionId((current) => current + 1);
    setCompanySelections((current) => current.map((selection) =>
      selection.id === pendingBatchEntry.companySelectionId
        ? {
            ...selection,
            brands: [
              ...selection.brands.map((brand) =>
                brand.id === pendingBatchEntry.brandSelectionId
                  ? {
                      ...brand,
                      productId: pendingBatchEntry.productId,
                      customBrand: pendingBatchEntry.customBrand,
                      brandDraft: "",
                      isAddingBrand: false,
                      batches,
                    }
                  : brand,
              ),
              ...(newBrandSearch ? [newBrandSearch] : []),
            ],
          }
        : selection,
    ));
    setPendingBatchEntry(null);
    setBatchEntryError("");
  }

  function updateCompanySelection(id: number, updates: Partial<Omit<CompanySelection, "id" | "brands">>) {
    setCompanySelections((current) => current.map((selection) =>
      selection.id === id ? { ...selection, ...updates } : selection,
    ));
  }

  function setCompanyAndResetBrands(companyId: number, company: string) {
    const savedContact = getSavedSupplierContact(company);
    const currentSelection = companySelections.find((selection) => selection.id === companyId);
    const hasInvoiceBatches = currentSelection?.brands.some((brandSelection) => brandSelection.batches.length > 0) ?? false;
    if (currentSelection && currentSelection.company !== company && hasInvoiceBatches) {
      const newSelectionId = nextCompanySelectionId;
      const newBrand = createBrandSelection(nextBrandSelectionId);
      setCompanySelections((current) => [
        ...current,
        {
          ...createCompanySelection(newSelectionId, newBrand.id),
          company,
          supplierContactName: savedContact?.name || getDefaultSupplierName(company),
          supplierPhone: savedContact?.phone ?? "",
        },
      ]);
      setActiveCompanySelectionId(newSelectionId);
      setNextCompanySelectionId((current) => current + 1);
      setNextBrandSelectionId((current) => current + 1);
      setFocusedSupplierInput(null);
      return;
    }

    const brand = createBrandSelection(nextBrandSelectionId);
    setNextBrandSelectionId((current) => current + 1);
    setCompanySelections((current) => current.map((selection) =>
      selection.id === companyId
        ? {
            ...selection,
            company,
            supplierContactName: savedContact?.name || getDefaultSupplierName(company),
            supplierPhone: savedContact?.phone ?? "",
            companyDraft: "",
            isAddingCompany: false,
            brands: [brand],
          }
        : selection,
    ));
    setFocusedSupplierInput(null);
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
          style={{ position: "fixed", inset: "78px 32px 28px 102px", zIndex: 50, display: "grid", placeItems: "center", background: "rgba(15, 28, 21, 0.48)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-purchase-title"
            style={{ display: "flex", flexDirection: "column", width: "min(1480px, 100%)", height: "100%", maxHeight: "100%", overflow: "hidden", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.24)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
              <div>
                <h2 id="create-purchase-title" style={{ margin: 0, color: "#20342a", fontSize: 20, fontWeight: 700 }}>Receive Order</h2>
                <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>Select a company, then choose one of its products.</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} style={{ border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>

            <div className="receive-order-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 290px", flex: 1, minHeight: 0, overflowY: "auto", alignItems: "start", gap: 16, padding: "22px 24px" }}>
              <div style={{ minWidth: 0 }}>
              <div style={{ display: "grid", gap: 16 }}>
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
                const savedSupplierContacts = getSavedSupplierContacts();
                const activeSupplierField = focusedSupplierInput?.selectionId === companySelection.id
                  ? focusedSupplierInput.field
                  : null;
                const supplierSearch = activeSupplierField === "phone"
                  ? companySelection.supplierPhone.replace(/\D/g, "")
                  : companySelection.supplierContactName.trim().toLocaleLowerCase();
                const supplierSuggestions = activeSupplierField && supplierSearch
                  ? savedSupplierContacts.filter((contact) =>
                    activeSupplierField === "phone"
                      ? contact.phone.replace(/\D/g, "").includes(supplierSearch)
                      : contact.name.toLocaleLowerCase().includes(supplierSearch),
                  ).slice(0, 5)
                  : [];
                const renderSupplierSuggestions = (field: "name" | "phone") =>
                  activeSupplierField === field && supplierSuggestions.length > 0 ? (
                    <div role="listbox" aria-label="Saved supplier contacts" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 26, display: "grid", maxHeight: 160, overflowY: "auto", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", boxShadow: "0 8px 22px rgba(20, 35, 27, 0.14)" }}>
                      {supplierSuggestions.map((contact) => (
                        <button
                          key={`${contact.name}-${contact.phone}`}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateCompanySelection(companySelection.id, {
                              supplierContactName: contact.name,
                              supplierPhone: contact.phone,
                            });
                            setFocusedSupplierInput(null);
                          }}
                          style={{ display: "grid", gap: 3, border: 0, borderBottom: "1px solid #f0f2f0", background: "#fff", color: "#34453b", padding: "7px 9px", textAlign: "left", cursor: "pointer" }}
                        >
                          <span style={{ fontSize: 12 }}>{contact.name}</span>
                          <span style={{ color: "#77857d", fontSize: 10 }}>{contact.phone}</span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                const companiesSelectedElsewhere = new Set(companySelections
                  .filter((selection) => selection.id !== companySelection.id)
                  .map((selection) => selection.company));
                const draftCompanyAlreadySelected = companySelections.some((selection) =>
                  selection.id !== companySelection.id &&
                  selection.company.toLocaleLowerCase() === companySelection.companyDraft.trim().toLocaleLowerCase(),
                );

                return (
                  <section key={companySelection.id} aria-label="Purchase company" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, padding: 16, border: "1px solid #dce5df", borderRadius: 8, background: "#fbfcfb" }}>
                    <div className="receive-order-company-fields" style={{ display: "grid", gridTemplateColumns: "minmax(190px, 1.2fr) minmax(170px, 1fr) minmax(150px, 0.8fr) auto", alignItems: "end", gap: 10, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                      <div style={{ display: "grid", alignContent: "start", gap: 7 }}>
                      <span style={{ color: "#526158", fontSize: 11, fontWeight: 600 }}>Company Name</span>
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
                      <div style={{ display: "contents" }}>
                        <label style={{ position: "relative", display: "grid", gap: 5, color: "#526158", fontSize: 11, fontWeight: 600 }}>
                          Supplier Name
                          <input
                            aria-label={`Supplier Name for ${companySelection.company || "company"}`}
                            autoComplete="off"
                            value={companySelection.supplierContactName}
                            onFocus={() => {
                              setFocusedSupplierInput({ selectionId: companySelection.id, field: "name" });
                              if (companySelection.supplierContactName === getDefaultSupplierName(companySelection.company)) {
                                updateCompanySelection(companySelection.id, { supplierContactName: "" });
                              }
                            }}
                            onChange={(event) => {
                              setFocusedSupplierInput({ selectionId: companySelection.id, field: "name" });
                              updateCompanySelection(companySelection.id, { supplierContactName: event.currentTarget.value });
                            }}
                            onBlur={() => {
                              setFocusedSupplierInput((current) =>
                                current?.selectionId === companySelection.id && current.field === "name" ? null : current,
                              );
                              setCompanySelections((current) => current.map((selection) =>
                                selection.id === companySelection.id && !selection.supplierContactName.trim()
                                  ? {
                                      ...selection,
                                      supplierContactName: getSavedSupplierContact(selection.company)?.name || getDefaultSupplierName(selection.company),
                                    }
                                  : selection,
                              ));
                            }}
                            placeholder={`${companySelection.company || "Company"} Distributor`}
                            style={{ ...fieldStyle, height: 34, padding: "7px 9px", fontSize: 12, fontWeight: 400 }}
                          />
                          {renderSupplierSuggestions("name")}
                        </label>
                        <label style={{ position: "relative", display: "grid", gap: 5, color: "#526158", fontSize: 11, fontWeight: 600 }}>
                          Phone Number
                          <input
                            aria-label={`Supplier Phone Number for ${companySelection.company || "company"}`}
                            type="tel"
                            inputMode="tel"
                            autoComplete="off"
                            value={companySelection.supplierPhone}
                            onFocus={() => setFocusedSupplierInput({ selectionId: companySelection.id, field: "phone" })}
                            onChange={(event) => {
                              setFocusedSupplierInput({ selectionId: companySelection.id, field: "phone" });
                              updateCompanySelection(companySelection.id, { supplierPhone: event.currentTarget.value });
                            }}
                            onBlur={() => {
                              setFocusedSupplierInput((current) =>
                                current?.selectionId === companySelection.id && current.field === "phone" ? null : current,
                              );
                            }}
                            placeholder="Phone number"
                            style={{ ...fieldStyle, height: 34, padding: "7px 9px", fontSize: 12, fontWeight: 400 }}
                          />
                          {renderSupplierSuggestions("phone")}
                        </label>
                      </div>
                    </div>

                    <div style={{ display: "grid", alignContent: "start", gap: 8 }}>
                      <span style={{ color: "#526158", fontSize: 12, fontWeight: 600 }}>Brand Name</span>
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
                <h3 style={{ margin: "0 0 10px", color: "#526158", fontSize: 13, fontWeight: 700 }}>Receive Invoice</h3>
                <div style={{ margin: "0 0 18px", overflowX: "auto", border: "1px solid #dce5df", borderRadius: 6 }}>
                  <table aria-label="Selected brand details" style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", tableLayout: "fixed", textAlign: "left" }}>
                    <thead>
                      <tr>
                        {["Company Name", "Brand Name", "Batch Number", "Mfg Date", "Exp Date", "Box MRP", "Pack Size", "Unit Price", "Box Quantity", "Total Purchase Price", "Actions"].map((heading) => (
                          <th key={heading} scope="col" style={{ padding: "7px 6px", borderBottom: "1px solid #dce5df", background: "#f4f7f5", color: "#687871", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBatchDetails.map(({ companySelection, selection, product, batch, batchIndex }, index) => (
                        <tr key={`${companySelection.id}-${selection.id}-${batchIndex}`}>
                          {([
                            companySelection.company,
                            batchIndex === 0 ? product?.brand || product?.medicine_name || selection.customBrand : "",
                            batch.batchNumber,
                            formatMonthYear(batch.mfgDate),
                            formatMonthYear(batch.expDate),
                            batch.mrp,
                            batch.packSize,
                            getUnitPrice(product?.unit_price, batch.mrp, batch.packSize),
                            batch.quantity,
                            batch.totalPrice,
                            null,
                          ] as const).map((value, cellIndex) => (
                            <td key={cellIndex} style={{ padding: "7px 6px", borderBottom: index === selectedBatchDetails.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {cellIndex === 10 ? (
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
                              ) : cellIndex === 2 ? (
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
                              ) : cellIndex === 1 ? (
                                <div
                                  title={batchIndex === 0 ? displayValue(product?.generic_name) : undefined}
                                  style={{ display: "grid", gap: 3 }}
                                >
                                  <span>{displayValue(value ?? undefined)}</span>
                                  {batchIndex === 0 && (
                                    <span style={{ color: "#77857d", fontSize: 10 }}>
                                      {[product?.strength, product?.dosage_form].filter((part) => part && part !== "-").join(" · ")}
                                    </span>
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
                            row.supplier,
                            row.brand,
                            row.batchNumber,
                            formatMonthYear(row.mfgDate),
                            formatMonthYear(row.expDate),
                            row.mrp ?? "",
                            row.packSize,
                            getUnitPrice(row.unitPrice, row.mrp, row.packSize),
                            row.quantity ?? "",
                            row.totalPrice ?? "",
                            null,
                          ].map((value, cellIndex) => (
                            <td key={cellIndex} style={{ padding: "7px 6px", borderBottom: index === receivedInvoiceRows.length - 1 ? 0 : "1px solid #e8ede9", color: "#34453b", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {cellIndex === 10 ? (
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
                              ) : cellIndex === 1 ? (
                                <div title={displayValue(row.genericName)} style={{ display: "grid", gap: 3 }}>
                                  <span>{displayValue(row.brand)}</span>
                                  <span style={{ color: "#77857d", fontSize: 10 }}>
                                    {[row.strength, row.dosageForm].filter((part) => part && part !== "-").join(" · ")}
                                  </span>
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
              </div>

              <aside className="receive-order-summary" aria-label="Bill summary" style={{ position: "sticky", top: 0, alignSelf: "start", display: "grid", alignContent: "start", gap: 10, padding: 14, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb" }}>
                <h3 style={{ margin: 0, color: "#20342a", fontSize: 15, fontWeight: 700 }}>Bill Summary</h3>
                <div style={{ display: "grid", gap: 8, color: "#526158", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Total Company</span>
                    <strong>{receiveSummaryCompanyCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Brands</span>
                    <strong>{receiveSummaryBrandCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Box Quantity</span>
                    <strong>{receiveSummaryQuantity.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 8, borderTop: "1px solid #e5ebe7" }}>
                    <strong style={{ color: "#26352f" }}>Total Purchase Price</strong>
                    <strong style={{ color: "#17704e" }}>৳{receiveSummaryTotal.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 650 }}>Discount</span>
                      <div style={{ display: "flex", gap: 5 }}>
                        {(["flat", "percent"] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={receiveDiscountType === type}
                            onClick={() => {
                              setReceiveDiscountType(type);
                              setReceiveDiscountValue("");
                            }}
                            style={{ border: `1px solid ${receiveDiscountType === type ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: receiveDiscountType === type ? "#eef8f2" : "#fff", color: receiveDiscountType === type ? "#17704e" : "#526158", padding: "4px 6px", fontSize: 10, fontWeight: 650, cursor: "pointer" }}
                          >{type === "flat" ? "Flat ৳" : "%"}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 7 }}>
                      <input
                        className="discount-input"
                        aria-label={`Discount ${receiveDiscountType === "flat" ? "amount" : "percentage"}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={receiveDiscountType === "percent" ? 100 : receiveSummaryTotal}
                        step="0.01"
                        value={receiveDiscountValue}
                        onChange={(event) => setReceiveDiscountValue(event.currentTarget.value)}
                        placeholder={receiveDiscountType === "flat" ? "Discount amount" : "Discount %"}
                        style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                      />
                      <strong style={{ color: "#526158", whiteSpace: "nowrap" }}>−৳{receiveDiscountAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                    {!validReceiveDiscount && (
                      <span role="alert" style={{ color: "#b34b43", fontSize: 10 }}>
                        {receiveDiscountType === "percent" ? "Discount cannot exceed 100%." : "Discount cannot exceed total purchase price."}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 7 }}>
                    <label htmlFor="receive-tax-rate">VAT/Tax (%)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        className="discount-input"
                        id="receive-tax-rate"
                        aria-label="VAT/Tax percentage"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.01"
                        value={receiveTaxRate}
                        onFocus={() => setReceiveTaxRate("")}
                        onChange={(event) => setReceiveTaxRate(event.currentTarget.value)}
                        style={{ ...fieldStyle, width: 64, padding: "5px 7px", fontSize: 12, textAlign: "right" }}
                      />
                      <strong style={{ whiteSpace: "nowrap" }}>+৳{receiveTaxAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                  </div>
                  {!validReceiveTaxRate && (
                    <span role="alert" style={{ color: "#b34b43", fontSize: 10 }}>VAT/Tax must be between zero and 100%.</span>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 7, borderTop: "1px solid #e5ebe7" }}>
                    <strong style={{ color: "#26352f" }}>Sub Total</strong>
                    <strong style={{ color: "#17704e" }}>৳{receiveSubTotal.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                  <div role="group" aria-label="Choose purchase payment method" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {receivePaymentMethodOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={effectiveReceivePaymentMethod === option.value}
                        onClick={() => setReceivePaymentMethod(option.value)}
                        style={{ border: `1px solid ${effectiveReceivePaymentMethod === option.value ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: effectiveReceivePaymentMethod === option.value ? "#eef8f2" : "#fff", color: effectiveReceivePaymentMethod === option.value ? "#17704e" : "#526158", padding: "5px 7px", fontSize: 10, fontWeight: 650, cursor: "pointer" }}
                      >{option.label}</button>
                    ))}
                  </div>
                  {paymentMethodsSnapshot.error && (
                    <span role="alert" style={{ color: "#b34b43", fontSize: 10 }}>{paymentMethodsSnapshot.error}</span>
                  )}
                  <label style={{ display: "grid", gap: 4, color: "#526158", fontSize: 11, fontWeight: 650 }}>
                    Payment
                    <input
                      className="pay-amount-input"
                      aria-label="Payment amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={receiveSubTotal}
                      step="0.01"
                      value={receivePayAmount}
                      onFocus={() => setReceivePayAmount("")}
                      onChange={(event) => setReceivePayAmount(event.currentTarget.value)}
                      placeholder="Payment amount"
                      style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                    />
                  </label>
                  {!validReceivePayAmount && (
                    <span role="alert" style={{ color: "#b34b43", fontSize: 10 }}>
                      {parsedReceivePayAmount > receiveSubTotal
                        ? "Payment cannot exceed the Sub Total."
                        : "Enter a valid non-negative payment amount."}
                    </span>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Paid</span>
                    <strong style={{ color: "#17704e" }}>৳{receivePaidAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Due</span>
                    <strong style={{ color: receiveDueAmount > 0 ? "#ad4b43" : "#17704e" }}>৳{receiveDueAmount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={receivePurchase}
                  disabled={!canReceivePurchase}
                  style={{ width: "100%", border: 0, borderRadius: 6, background: canReceivePurchase ? "#179c70" : "#aab7af", color: "#fff", padding: "10px 16px", fontSize: 12, fontWeight: 650, cursor: canReceivePurchase ? "pointer" : "not-allowed" }}
                >Received</button>
              </aside>
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
                  style={{ width: "min(680px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 10, background: "#fff", boxShadow: "0 24px 80px rgba(7, 28, 17, 0.28)" }}
                >
                  <div style={{ padding: "20px 24px", borderBottom: "1px solid #e9eeea" }}>
                    <h2 id="purchase-batch-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Add Batch Details</h2>
                    <p style={{ margin: "5px 0 0", color: "#77857d", fontSize: 12 }}>
                      {pendingBatchEntry.customBrand || products.find((product) => product.id === pendingBatchEntry.productId)?.brand || "Selected product"}
                    </p>
                  </div>
                  <form onSubmit={saveBatchEntry} noValidate style={{ minHeight: 0, overflowY: "auto" }}>
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
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
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
                      <div style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
                        <span>Purchase Price (Box)</span>
                        <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 5, padding: "4px 0", background: "#fff" }}>
                          {(["flat", "percent"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={batchPurchasePriceMode === mode}
                              onClick={() => {
                                setBatchPurchasePriceMode(mode);
                                if (mode === "percent") updateBatchPurchasePriceRate("");
                              }}
                              style={{ border: `1px solid ${batchPurchasePriceMode === mode ? "#179c70" : "#dce5df"}`, borderRadius: 5, background: batchPurchasePriceMode === mode ? "#eef8f2" : "#fff", color: batchPurchasePriceMode === mode ? "#17704e" : "#526158", padding: "5px 8px", fontSize: 10, fontWeight: 650, cursor: "pointer" }}
                            >{mode === "flat" ? "Flat ৳" : "%"}</button>
                          ))}
                          {batchPurchasePriceMode === "percent" && batchPurchasePriceRate.trim() !== "" && (
                            <span aria-label="Discount percentage and calculated purchase price" style={{ alignSelf: "center", color: "#526158", fontSize: 12, fontWeight: 700 }}>
                              {getCurrentBatchPurchasePrice() !== null ? `৳${getCurrentBatchPurchasePrice()}` : ""}
                            </span>
                          )}
                          {batchPurchasePriceMode === "flat" && getCurrentBatchPurchasePrice() !== null && (
                            <span aria-label="Purchase price" style={{ alignSelf: "center", color: "#17704e", fontSize: 12, fontWeight: 700 }}>
                              ৳{getCurrentBatchPurchasePrice()}
                            </span>
                          )}
                        </div>
                        {batchPurchasePriceMode === "percent" ? (
                          <input
                            aria-label="Purchase Price (Box) discount percentage"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="0.01"
                            value={batchPurchasePriceRate}
                            onChange={(event) => updateBatchPurchasePriceRate(event.currentTarget.value)}
                            placeholder="Discount %"
                            style={{ ...fieldStyle, width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12 }}
                          />
                        ) : (
                          <input
                            aria-label="Purchase Price (Box)"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={pendingBatchEntry.purchasePrice}
                            onChange={(event) => updatePendingBatchField("purchasePrice", event.target.value)}
                            onBlur={() => finishEditingBatchField("purchasePrice")}
                            onFocus={(event) => preservePendingBatchFieldOnFocus("purchasePrice", event.currentTarget)}
                            style={{ ...fieldStyle, padding: "6px 8px", fontSize: 12 }}
                          />
                        )}
                      </div>
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
