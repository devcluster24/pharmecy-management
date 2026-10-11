import { getPharmacyDataJson, setPharmacyDataJson } from "@/lib/pharmacy-data-sync";

export const INVOICE_TEMPLATE_SETTINGS_KEY = "pharmecy-invoice-templates-v1" as const;
const invoiceTemplateUpdatedEvent = "pharmecy-invoice-templates-updated";
const maxTemplateItems = 8;
const maxSignatureImageLength = 2_800_000;

export type InvoiceFieldKey =
  | "storeName"
  | "invoiceNumber"
  | "dateTime"
  | "customer"
  | "phone"
  | "paymentMethod"
  | "paymentStatus";

export type InvoiceTemplateItem =
  | { id: string; type: "field"; key: InvoiceFieldKey; label: string; align?: "left" | "right" }
  | { id: string; type: "text"; label: string; value: string; align?: "left" | "right" };

export type InvoiceTemplate = {
  id: string;
  name: string;
  style: "classic" | "modern" | "compact" | "elegant";
  header: InvoiceTemplateItem[];
  footer: InvoiceTemplateItem[];
};

export type InvoiceTemplateSettings = {
  templates: InvoiceTemplate[];
  activeTemplateId: string;
  pageSize?: {
    format: "a4" | "a5" | "custom";
    widthMm: number;
    heightMm: number;
  };
  seals: { paid: boolean; due: boolean };
  signature: {
    type: "text" | "image";
    text: string;
    imageDataUrl: string;
  };
};

export type InvoiceTemplateSnapshot = {
  settings: InvoiceTemplateSettings;
  error: string;
  revision: number;
};

export const invoiceFieldOptions: { key: InvoiceFieldKey; label: string }[] = [
  { key: "storeName", label: "Store name" },
  { key: "invoiceNumber", label: "Invoice number" },
  { key: "dateTime", label: "Date & time" },
  { key: "customer", label: "Customer name" },
  { key: "phone", label: "Customer phone" },
  { key: "paymentMethod", label: "Payment method" },
  { key: "paymentStatus", label: "Payment status" },
];

function makeDefaultTemplate(
  id: string,
  name: string,
  style: InvoiceTemplate["style"],
  headerKeys: InvoiceFieldKey[],
  footerText: string,
): InvoiceTemplate {
  return {
    id,
    name,
    style,
    header: headerKeys.map((key, index) => ({
      id: `${id}-header-${index}`,
      type: "field",
      key,
      label: invoiceFieldOptions.find((option) => option.key === key)?.label ?? key,
    })),
    footer: [{ id: `${id}-footer-thanks`, type: "text", label: "Message", value: footerText }],
  };
}

export function createDefaultInvoiceTemplateSettings(): InvoiceTemplateSettings {
  return {
    templates: [
      makeDefaultTemplate(
        "classic",
        "Classic",
        "classic",
        ["storeName", "invoiceNumber", "dateTime", "customer", "phone", "paymentMethod", "paymentStatus"],
        "Thank you for your purchase.",
      ),
      makeDefaultTemplate(
        "modern",
        "Modern",
        "modern",
        ["storeName", "customer", "phone", "dateTime", "invoiceNumber", "paymentStatus"],
        "We appreciate your business.",
      ),
      makeDefaultTemplate(
        "compact",
        "Compact",
        "compact",
        ["storeName", "invoiceNumber", "dateTime", "customer", "paymentStatus"],
        "Please keep this invoice for your records.",
      ),
      makeDefaultTemplate(
        "elegant",
        "Elegant",
        "elegant",
        ["storeName", "invoiceNumber", "customer", "dateTime", "phone", "paymentMethod", "paymentStatus"],
        "Thank you for choosing our pharmacy.",
      ),
    ],
    activeTemplateId: "classic",
    pageSize: { format: "a4", widthMm: 210, heightMm: 297 },
    seals: { paid: true, due: true },
    signature: { type: "text", text: "", imageDataUrl: "" },
  };
}

function isInvoiceFieldKey(value: unknown): value is InvoiceFieldKey {
  return invoiceFieldOptions.some((option) => option.key === value);
}

function isTemplateItem(value: unknown): value is InvoiceTemplateItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || item.id.length === 0
    || typeof item.label !== "string"
    || item.label.length > 120
  ) return false;
  if (item.align !== undefined && item.align !== "left" && item.align !== "right") return false;
  if (item.type === "field") return isInvoiceFieldKey(item.key);
  return item.type === "text" && typeof item.value === "string" && item.value.length <= 120;
}

function isInvoiceTemplate(value: unknown): value is InvoiceTemplate {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  return typeof template.id === "string"
    && typeof template.name === "string"
    && template.name.trim().length > 0
    && template.name.length <= 40
    && ["classic", "modern", "compact", "elegant"].includes(String(template.style))
    && Array.isArray(template.header)
    && template.header.length <= maxTemplateItems
    && template.header.every(isTemplateItem)
    && Array.isArray(template.footer)
    && template.footer.length <= maxTemplateItems
    && template.footer.every(isTemplateItem);
}

function isInvoiceTemplateSettings(value: unknown): value is InvoiceTemplateSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  if (
    !Array.isArray(settings.templates)
    || settings.templates.length !== 4
    || !settings.templates.every(isInvoiceTemplate)
    || typeof settings.activeTemplateId !== "string"
    || !settings.templates.some((template) => template.id === settings.activeTemplateId)
  ) return false;
  const pageSize = settings.pageSize;
  if (pageSize !== undefined) {
    if (!pageSize || typeof pageSize !== "object") return false;
    const size = pageSize as Record<string, unknown>;
    if (
      !["a4", "a5", "custom"].includes(String(size.format))
      || typeof size.widthMm !== "number"
      || !Number.isFinite(size.widthMm)
      || size.widthMm < 50
      || size.widthMm > 420
      || typeof size.heightMm !== "number"
      || !Number.isFinite(size.heightMm)
      || size.heightMm < 50
      || size.heightMm > 590
    ) return false;
  }

  const seals = settings.seals;
  const signature = settings.signature;
  if (!seals || typeof seals !== "object" || !signature || typeof signature !== "object") return false;
  const sealSettings = seals as Record<string, unknown>;
  const signatureSettings = signature as Record<string, unknown>;
  return typeof sealSettings.paid === "boolean"
    && typeof sealSettings.due === "boolean"
    && (signatureSettings.type === "text" || signatureSettings.type === "image")
    && typeof signatureSettings.text === "string"
    && typeof signatureSettings.imageDataUrl === "string"
    && signatureSettings.imageDataUrl.length <= maxSignatureImageLength
    && (
      signatureSettings.imageDataUrl === ""
      || /^data:image\/(png|jpeg);base64,/.test(signatureSettings.imageDataUrl)
    );
}

let cachedSnapshot: InvoiceTemplateSnapshot | null = null;
let snapshotRevision = 0;

export const emptyInvoiceTemplateSnapshot: InvoiceTemplateSnapshot = {
  settings: createDefaultInvoiceTemplateSettings(),
  error: "",
  revision: 0,
};

export function getInvoiceTemplateSettingsSnapshot(): InvoiceTemplateSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const saved = getPharmacyDataJson(INVOICE_TEMPLATE_SETTINGS_KEY);
  if (!saved) {
    cachedSnapshot = {
      settings: emptyInvoiceTemplateSnapshot.settings,
      error: "",
      revision: snapshotRevision,
    };
    return cachedSnapshot;
  }

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!isInvoiceTemplateSettings(parsed)) {
      throw new Error("Saved invoice template settings are invalid. Review and save the invoice setup again.");
    }
    const normalized = {
      ...parsed,
      pageSize: parsed.pageSize ?? { format: "a4" as const, widthMm: 210, heightMm: 297 },
      templates: parsed.templates.map((template) => ({
        ...template,
        header: template.header.map((item) => ({ ...item, align: item.align ?? "left" as const })),
      })),
    };
    cachedSnapshot = { settings: normalized, error: "", revision: snapshotRevision };
  } catch (error) {
    cachedSnapshot = {
      settings: createDefaultInvoiceTemplateSettings(),
      error: error instanceof Error ? error.message : "Could not load invoice template settings.",
      revision: snapshotRevision,
    };
  }
  return cachedSnapshot;
}

export function getInvoiceTemplateSettings() {
  const snapshot = getInvoiceTemplateSettingsSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot.settings;
}

export function subscribeToInvoiceTemplateSettings(listener: () => void) {
  function handleUpdate() {
    cachedSnapshot = null;
    snapshotRevision += 1;
    listener();
  }

  window.addEventListener(invoiceTemplateUpdatedEvent, handleUpdate);
  return () => {
    window.removeEventListener(invoiceTemplateUpdatedEvent, handleUpdate);
  };
}

export function saveInvoiceTemplateSettings(settings: InvoiceTemplateSettings) {
  if (!isInvoiceTemplateSettings(settings)) {
    throw new Error("Invoice template settings are incomplete or invalid.");
  }
  if (settings.templates.some((template) =>
    template.header.length > maxTemplateItems || template.footer.length > maxTemplateItems)) {
    throw new Error(`A template cannot contain more than ${maxTemplateItems} header or footer entries.`);
  }

  cachedSnapshot = { settings, error: "", revision: snapshotRevision };
  setPharmacyDataJson(INVOICE_TEMPLATE_SETTINGS_KEY, JSON.stringify(settings));
}
