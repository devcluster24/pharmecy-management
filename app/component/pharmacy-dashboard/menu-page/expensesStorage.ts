import {
  getPharmacyDataJson,
  setPharmacyDataBatch,
  setPharmacyDataJson,
} from "@/lib/pharmacy-data-sync";
import {
  notifyPurchaseListRowsChanged,
  PURCHASE_STORAGE_KEY,
  type PurchaseListRow,
} from "./purchaseStorage";

export const EXPENSES_STORAGE_KEY = "pharmacy-expenses-v1";

export type ExpenseRecord = {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  createdAt: string;
};

export type ExpensesSnapshot = {
  rows: ExpenseRecord[];
  error: string;
};

export const emptyExpensesSnapshot: ExpensesSnapshot = { rows: [], error: "" };
const expensesUpdatedEvent = "pharmacy-expenses-updated";
let cachedSnapshot: ExpensesSnapshot | null = null;

function isExpenseRecord(value: unknown): value is ExpenseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
    && typeof row.category === "string"
    && typeof row.description === "string"
    && typeof row.amount === "number"
    && Number.isFinite(row.amount)
    && (row.amount > 0 || (row.amount === 0 && row.category === "Destroy" && row.paymentMethod === ""))
    && typeof row.paymentMethod === "string"
    && typeof row.createdAt === "string";
}

function readExpenses(): ExpenseRecord[] {
  const saved = getPharmacyDataJson(EXPENSES_STORAGE_KEY);
  if (!saved) return [];
  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed) || !parsed.every(isExpenseRecord)) {
    throw new Error("Saved expense data is invalid.");
  }
  return parsed;
}

function readSnapshot(): ExpensesSnapshot {
  try {
    return { rows: readExpenses(), error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Could not load saved expenses.",
    };
  }
}

export function getExpensesSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToExpenses(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== EXPENSES_STORAGE_KEY && event.key !== null) return;
    cachedSnapshot = null;
    listener();
  }
  function handleExpensesUpdate() {
    cachedSnapshot = null;
    listener();
  }
  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(expensesUpdatedEvent, handleExpensesUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(expensesUpdatedEvent, handleExpensesUpdate);
  };
}

function saveExpenses(rows: ExpenseRecord[], action: "create" | "edit" | "delete" = "edit") {
  setPharmacyDataJson(EXPENSES_STORAGE_KEY, JSON.stringify(rows), action);
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(expensesUpdatedEvent));
}

export function addExpense(input: Omit<ExpenseRecord, "id" | "createdAt">) {
  const rows = readExpenses();
  const expense = createExpenseRecord(input);
  saveExpenses([expense, ...rows], "create");
  return expense;
}

export function addDestroyExpenseAndRemovePurchaseRow(
  input: Omit<ExpenseRecord, "id" | "createdAt">,
  remainingPurchaseRows: PurchaseListRow[],
) {
  const expenses = readExpenses();
  const expense = createExpenseRecord(input, true);
  const updatedExpenses = [expense, ...expenses];

  setPharmacyDataBatch(
    {
      [EXPENSES_STORAGE_KEY]: updatedExpenses,
      [PURCHASE_STORAGE_KEY]: remainingPurchaseRows,
    },
    {
      [EXPENSES_STORAGE_KEY]: "create",
      [PURCHASE_STORAGE_KEY]: "delete",
    },
  );
  cachedSnapshot = { rows: updatedExpenses, error: "" };
  window.dispatchEvent(new Event(expensesUpdatedEvent));
  notifyPurchaseListRowsChanged(remainingPurchaseRows);
  return expense;
}

function createExpenseRecord(
  input: Omit<ExpenseRecord, "id" | "createdAt">,
  allowEmptyPaymentMethod = false,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
    || !input.category.trim()
    || !input.description.trim()
    || !Number.isFinite(input.amount)
    || input.amount < 0
    || (input.amount === 0 && !allowEmptyPaymentMethod)
    || (!allowEmptyPaymentMethod && !input.paymentMethod.trim())
  ) {
    throw new Error("Enter a valid date, category, description, amount, and payment method.");
  }
  return {
    ...input,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    category: input.category.trim(),
    description: input.description.trim(),
    paymentMethod: input.paymentMethod.trim(),
    amount: Number(input.amount.toFixed(2)),
    createdAt: new Date().toISOString(),
  };
}

export function deleteExpense(id: string) {
  const rows = readExpenses();
  if (!rows.some((row) => row.id === id)) {
    throw new Error("This expense could not be found. Refresh the list and try again.");
  }
  saveExpenses(rows.filter((row) => row.id !== id), "delete");
}
