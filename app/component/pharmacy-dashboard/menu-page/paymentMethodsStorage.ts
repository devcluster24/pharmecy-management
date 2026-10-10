export const PAYMENT_METHODS_STORAGE_KEY = "pharmecy-payment-methods-v1";

export type PaymentMethod =
  | { id: string; type: "mobile"; name: string; phone: string }
  | { id: string; type: "bank"; bankName: string; accountHolderName: string; accountNumber: string; branch: string; district: string };

export type PaymentMethodsSnapshot = {
  rows: PaymentMethod[];
  error: string;
};

export const emptyPaymentMethodsSnapshot: PaymentMethodsSnapshot = { rows: [], error: "" };
const paymentMethodsUpdatedEvent = "pharmecy-payment-methods-updated";
let cachedSnapshot: PaymentMethodsSnapshot | null = null;

function isPaymentMethod(value: unknown): value is PaymentMethod {
  if (!value || typeof value !== "object") return false;
  const method = value as Record<string, unknown>;
  if (typeof method.id !== "string" || typeof method.type !== "string") return false;
  if (method.type === "mobile") {
    return typeof method.name === "string" && typeof method.phone === "string";
  }
  if (method.type === "bank") {
    return typeof method.bankName === "string"
      && typeof method.accountHolderName === "string"
      && typeof method.accountNumber === "string"
      && typeof method.branch === "string"
      && typeof method.district === "string";
  }
  return false;
}

function readSnapshot(): PaymentMethodsSnapshot {
  try {
    const storedMethods = window.localStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
    if (!storedMethods) return emptyPaymentMethodsSnapshot;
    const parsed: unknown = JSON.parse(storedMethods);
    if (!Array.isArray(parsed) || !parsed.every(isPaymentMethod)) {
      throw new Error("Saved payment methods are invalid. Update them in Settings.");
    }
    return { rows: parsed, error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "Could not load payment methods.",
    };
  }
}

export function getPaymentMethodsSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToPaymentMethods(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== PAYMENT_METHODS_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  function handlePaymentMethodsUpdate() {
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(paymentMethodsUpdatedEvent, handlePaymentMethodsUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(paymentMethodsUpdatedEvent, handlePaymentMethodsUpdate);
  };
}

export function savePaymentMethods(rows: PaymentMethod[]) {
  if (!rows.every(isPaymentMethod)) {
    throw new Error("Payment method data is invalid.");
  }
  window.localStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(rows));
  cachedSnapshot = { rows, error: "" };
  window.dispatchEvent(new Event(paymentMethodsUpdatedEvent));
}
