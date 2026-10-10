export const RETURN_DEDUCTION_SETTINGS_STORAGE_KEY = "pharmecy-return-deduction-settings-v1";

export type ReturnDeductionSettingsSnapshot = {
  defaultRate: number;
  error: string;
};

export const emptyReturnDeductionSettingsSnapshot: ReturnDeductionSettingsSnapshot = {
  defaultRate: 0,
  error: "",
};

const returnDeductionSettingsUpdatedEvent = "pharmecy-return-deduction-settings-updated";
let cachedSnapshot: ReturnDeductionSettingsSnapshot | null = null;

function readSnapshot(): ReturnDeductionSettingsSnapshot {
  try {
    const storedSettings = window.localStorage.getItem(RETURN_DEDUCTION_SETTINGS_STORAGE_KEY);
    if (!storedSettings) return emptyReturnDeductionSettingsSnapshot;

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
      throw new Error("Saved return deduction settings are invalid. Update the rate in Settings.");
    }

    return { defaultRate: parsed.defaultRate, error: "" };
  } catch (error) {
    return {
      defaultRate: 0,
      error: error instanceof Error ? error.message : "Could not load return deduction settings.",
    };
  }
}

export function getReturnDeductionSettingsSnapshot() {
  cachedSnapshot ??= readSnapshot();
  return cachedSnapshot;
}

export function subscribeToReturnDeductionSettings(listener: () => void) {
  function handleStorageChange(event: StorageEvent) {
    if (event.key !== RETURN_DEDUCTION_SETTINGS_STORAGE_KEY) return;
    cachedSnapshot = null;
    listener();
  }

  function handleSettingsUpdate() {
    cachedSnapshot = null;
    listener();
  }

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(returnDeductionSettingsUpdatedEvent, handleSettingsUpdate);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(returnDeductionSettingsUpdatedEvent, handleSettingsUpdate);
  };
}

export function saveReturnDeductionDefaultRate(defaultRate: number) {
  if (!Number.isFinite(defaultRate) || defaultRate < 0 || defaultRate > 100) {
    throw new Error("Return deduction rate must be between 0 and 100%.");
  }

  const settings = { defaultRate: Number(defaultRate.toFixed(2)) };
  window.localStorage.setItem(RETURN_DEDUCTION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  cachedSnapshot = { ...settings, error: "" };
  window.dispatchEvent(new Event(returnDeductionSettingsUpdatedEvent));
}
