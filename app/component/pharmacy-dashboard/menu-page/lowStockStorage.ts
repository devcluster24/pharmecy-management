export const LOW_STOCK_THRESHOLD_STORAGE_KEY = "pharmecy-low-stock-threshold-v1";

export type LowStockThresholdSnapshot = {
  threshold: string;
  error: string;
};

export const emptyLowStockThresholdSnapshot: LowStockThresholdSnapshot = {
  threshold: "",
  error: "",
};

const lowStockThresholdUpdatedEvent = "pharmecy-low-stock-threshold-updated";
let cachedSnapshot: LowStockThresholdSnapshot | null = null;

export function getLowStockThresholdSnapshot() {
  if (cachedSnapshot) return cachedSnapshot;

  try {
    cachedSnapshot = {
      threshold: window.localStorage.getItem(LOW_STOCK_THRESHOLD_STORAGE_KEY) ?? "",
      error: "",
    };
  } catch (error) {
    cachedSnapshot = {
      threshold: "",
      error: error instanceof Error ? error.message : "Could not load the low stock threshold.",
    };
  }

  return cachedSnapshot;
}

export function subscribeToLowStockThreshold(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== LOW_STOCK_THRESHOLD_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  function handleThresholdUpdate() {
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(lowStockThresholdUpdatedEvent, handleThresholdUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(lowStockThresholdUpdatedEvent, handleThresholdUpdate);
  };
}

export function saveLowStockThreshold(value: string) {
  window.localStorage.setItem(LOW_STOCK_THRESHOLD_STORAGE_KEY, value);
  cachedSnapshot = { threshold: value, error: "" };
  window.dispatchEvent(new Event(lowStockThresholdUpdatedEvent));
}
