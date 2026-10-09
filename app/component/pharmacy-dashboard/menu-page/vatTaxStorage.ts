export const VAT_TAX_SETTINGS_STORAGE_KEY = "pharmecy-vat-tax-settings-v1";

export type VatTaxSettingsSnapshot = {
  defaultRate: number;
  error: string;
};

export const emptyVatTaxSettingsSnapshot: VatTaxSettingsSnapshot = {
  defaultRate: 0,
  error: "",
};

const vatTaxSettingsUpdatedEvent = "pharmecy-vat-tax-settings-updated";
let cachedSnapshot: VatTaxSettingsSnapshot | null = null;

function readSnapshot(): VatTaxSettingsSnapshot {
  try {
    const storedSettings = window.localStorage.getItem(VAT_TAX_SETTINGS_STORAGE_KEY);
    if (!storedSettings) return emptyVatTaxSettingsSnapshot;

    const parsed: unknown = JSON.parse(storedSettings);
    if (
      !parsed
      || typeof parsed !== "object"
      || !("defaultRate" in parsed)
      || typeof parsed.defaultRate !== "number"
      || !Number.isFinite(parsed.defaultRate)
      || parsed.defaultRate < 0
      || parsed.defaultRate > 100
    ) {
      throw new Error("Saved VAT/TAX settings are invalid. Update the VAT/TAX rate in Settings.");
    }

    return { defaultRate: parsed.defaultRate, error: "" };
  } catch (error) {
    return {
      defaultRate: 0,
      error: error instanceof Error ? error.message : "Could not load VAT/TAX settings.",
    };
  }
}

export function getVatTaxSettingsSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToVatTaxSettings(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== VAT_TAX_SETTINGS_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  function handleSettingsUpdate() {
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(vatTaxSettingsUpdatedEvent, handleSettingsUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(vatTaxSettingsUpdatedEvent, handleSettingsUpdate);
  };
}

export function saveVatTaxDefaultRate(defaultRate: number) {
  if (!Number.isFinite(defaultRate) || defaultRate < 0 || defaultRate > 100) {
    throw new Error("VAT/TAX rate must be between 0 and 100%.");
  }

  const settings = { defaultRate: Number(defaultRate.toFixed(2)) };
  window.localStorage.setItem(VAT_TAX_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  cachedSnapshot = { ...settings, error: "" };
  window.dispatchEvent(new Event(vatTaxSettingsUpdatedEvent));
}
