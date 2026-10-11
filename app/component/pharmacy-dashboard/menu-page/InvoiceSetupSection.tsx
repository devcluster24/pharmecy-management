"use client";

import { useState, useSyncExternalStore, type DragEvent } from "react";
import Image from "next/image";
import { retryPharmacyDataSync } from "@/lib/pharmacy-data-sync";
import { usePharmacyStoreName } from "../components/PharmacyDashboardBrand";
import {
  createDefaultInvoiceTemplateSettings,
  emptyInvoiceTemplateSnapshot,
  getInvoiceTemplateSettingsSnapshot,
  invoiceFieldOptions,
  saveInvoiceTemplateSettings,
  subscribeToInvoiceTemplateSettings,
  type InvoiceFieldKey,
  type InvoiceTemplate,
  type InvoiceTemplateItem,
  type InvoiceTemplateSettings,
} from "./invoiceTemplateStorage";

type SectionName = "header" | "footer";
const MAX_INVOICE_TEMPLATE_ITEMS = 8;

const panelStyle = {
  border: "1px solid #e1eae4",
  borderRadius: 9,
  background: "#fff",
  padding: 18,
} as const;

const inputStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "8px 10px",
  fontSize: 12,
};

function cloneSettings(settings: InvoiceTemplateSettings) {
  return JSON.parse(JSON.stringify(settings)) as InvoiceTemplateSettings;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `invoice-info-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function templateDescription(template: InvoiceTemplate) {
  const descriptions: Record<InvoiceTemplate["style"], string> = {
    classic: "Traditional green invoice with a clear item table.",
    modern: "Bold title and contemporary teal accents.",
    compact: "Space-saving layout for quick counter sales.",
    elegant: "Refined heading and warm accent details.",
  };
  return descriptions[template.style];
}

function getPreviewItemValue(item: InvoiceTemplateItem, storeName: string) {
  if (item.type === "text") return item.value.trim();

  const values: Record<InvoiceFieldKey, string> = {
    storeName: storeName || "Pharmacy Cluster",
    invoiceNumber: "INV-2026-0184",
    dateTime: "12 Oct 2026, 10:30 AM",
    customer: "Rahim Uddin",
    phone: "01712-345678",
    paymentMethod: "Cash",
    paymentStatus: "Paid",
  };
  return item.key === "storeName" ? values[item.key] : `${item.label}: ${values[item.key]}`;
}

function PaymentSealPreview({ status }: { status: "PAID" | "DUE" }) {
  const color = status === "PAID" ? "#c91625" : "#d45232";

  return (
    <svg aria-label={`${status} invoice seal`} role="img" viewBox="0 0 140 64" style={{ display: "block", width: 56, height: 26 }}>
      <rect x="4" y="5" width="132" height="54" rx="13" fill="#fff" stroke={color} strokeWidth="5" />
      <rect x="10" y="11" width="120" height="42" rx="9" fill="none" stroke={color} strokeWidth="1" />
      <text x="70" y="46" fill={color} fontFamily="Arial, sans-serif" fontSize={status === "PAID" ? "34" : "30"} fontWeight="900" textAnchor="middle">
        {status}
      </text>
    </svg>
  );
}

function InvoiceTemplatePreview({
  template,
  settings,
  previewPaymentStatus,
  storeName,
}: {
  template: InvoiceTemplate;
  settings: InvoiceTemplateSettings;
  previewPaymentStatus: "paid" | "due";
  storeName: string;
}) {
  const styles: Record<InvoiceTemplate["style"], {
    accent: string;
    pale: string;
    ink: string;
    muted: string;
    alignment: "left" | "center" | "right";
    borderRadius: number;
  }> = {
    classic: { accent: "#17704e", pale: "#eff7f2", ink: "#26352f", muted: "#65746b", alignment: "left", borderRadius: 0 },
    modern: { accent: "#247a78", pale: "#ebf6f5", ink: "#1f3133", muted: "#607373", alignment: "right", borderRadius: 5 },
    compact: { accent: "#566fa6", pale: "#eff2fa", ink: "#273043", muted: "#66718a", alignment: "left", borderRadius: 0 },
    elegant: { accent: "#98714d", pale: "#f8f3ed", ink: "#382f28", muted: "#766653", alignment: "center", borderRadius: 0 },
  };
  const appearance = styles[template.style];
  const titleAlignment = appearance.alignment === "center" ? "center" : "left";
  const leftHeaderValues = template.header.filter((item) => (item.align ?? "left") === "left").map((item) => getPreviewItemValue(item, storeName)).filter(Boolean);
  const rightHeaderValues = template.header.filter((item) => item.align === "right").map((item) => getPreviewItemValue(item, storeName)).filter(Boolean);
  const footerValues = template.footer.map((item) => getPreviewItemValue(item, storeName)).filter(Boolean);
  const signature = settings.signature.type === "text" ? settings.signature.text.trim() : "";
  const status = previewPaymentStatus === "paid"
    ? (settings.seals.paid ? "PAID" : "")
    : (settings.seals.due ? "DUE" : "");
  const pageSize = settings.pageSize ?? { format: "a4" as const, widthMm: 210, heightMm: 297 };

  return (
    <div
      aria-label={`${template.name || "Invoice"} demo invoice preview`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        aspectRatio: `${pageSize.widthMm} / ${pageSize.heightMm}`,
        minHeight: 0,
        overflow: "hidden",
        border: "1px solid #e6eae7",
        borderLeft: template.style === "compact" ? `4px solid ${appearance.accent}` : "1px solid #e6eae7",
        borderRadius: appearance.borderRadius,
        background: "#fff",
        boxShadow: "0 2px 7px rgba(26, 48, 35, 0.08)",
        padding: "10px 9px 8px",
        color: appearance.ink,
        textAlign: titleAlignment,
        position: "relative",
      }}
    >
      {template.style === "modern" && (
        <span aria-hidden="true" style={{ position: "absolute", top: 0, right: 0, width: 23, height: 23, background: appearance.accent, clipPath: "polygon(0 0, 100% 0, 100% 100%)" }} />
      )}
      {template.style === "elegant" && (
        <span aria-hidden="true" style={{ position: "absolute", top: 4, right: 4, width: 14, height: 14, border: `1px solid ${appearance.accent}`, borderRadius: "50%" }}>
          <span style={{ position: "absolute", inset: 3, border: `1px solid ${appearance.accent}`, borderRadius: "50%" }} />
        </span>
      )}
      <div style={{ borderBottom: `2px solid ${appearance.accent}`, paddingBottom: 5, paddingRight: template.style === "modern" ? 14 : template.style === "elegant" ? 18 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5 }}>
          <strong style={{ color: appearance.accent, fontSize: 8, letterSpacing: template.style === "elegant" ? 0.35 : 0, whiteSpace: "nowrap" }}>
            SALES INVOICE
          </strong>
          <span style={{ maxWidth: "60%", overflow: "hidden", color: appearance.muted, fontSize: 4.8, textAlign: "right", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Date &amp; time: 12 Oct 2026, 10:30 AM
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 4, alignContent: "start" }}>
        <div style={{ display: "grid", alignContent: "start", gap: 3 }}>
          {leftHeaderValues.length > 0 ? leftHeaderValues.map((value, index) => (
            <span key={`${template.id}-preview-header-left-${index}`} style={{ overflow: "hidden", color: index === 0 ? appearance.accent : appearance.muted, fontSize: 5.5, fontWeight: index === 0 ? 650 : 400, lineHeight: 1.25, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {value}
            </span>
          )) : <span style={{ color: "#9ba49f", fontSize: 5.5, fontStyle: "italic" }}>Left header</span>}
        </div>
        <div style={{ display: "grid", alignContent: "start", gap: 3, textAlign: "right" }}>
          {rightHeaderValues.length > 0 ? rightHeaderValues.map((value, index) => (
            <span key={`${template.id}-preview-header-right-${index}`} style={{ overflow: "hidden", color: appearance.muted, fontSize: 5.5, fontWeight: 400, lineHeight: 1.25, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {value}
            </span>
          )) : null}
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 5, ...(template.style === "compact" ? { paddingLeft: 3 } : {}) }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 18px 30px", gap: 2, background: appearance.pale, padding: "3px 4px", color: appearance.accent, fontSize: 5, fontWeight: 750 }}>
          <span>Product</span><span>Qty</span><span style={{ textAlign: "right" }}>Total</span>
        </div>
        {[["Napa Extra", "2", "৳120.00"], ["Vitamin C", "1", "৳80.00"], ["Antacid", "1", "৳45.00"]].map((row) => (
          <div key={row[0]} style={{ display: "grid", gridTemplateColumns: "1fr 18px 30px", gap: 2, borderBottom: "1px solid #f0f2f0", padding: "3px 4px", color: appearance.ink, fontSize: 5 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row[0]}</span><span>{row[1]}</span><span style={{ textAlign: "right" }}>{row[2]}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          {status === "PAID" && <PaymentSealPreview status="PAID" />}
          {status === "DUE" && <PaymentSealPreview status="DUE" />}
        </div>
        <div style={{ display: "grid", gap: 3, textAlign: "right" }}>
          <span style={{ color: appearance.muted, fontSize: 5.5 }}>Subtotal: ৳245.00</span>
          <strong style={{ color: appearance.accent, fontSize: 6.5 }}>Grand total: ৳245.00</strong>
          <span style={{ color: appearance.muted, fontSize: 5.5 }}>Payment status: {previewPaymentStatus === "paid" ? "PAID" : "DUE"}</span>
          <span style={{ color: appearance.muted, fontSize: 5.5 }}>Paid: {previewPaymentStatus === "paid" ? "৳245.00" : "৳145.00"}</span>
          {previewPaymentStatus === "due" && <span style={{ color: "#ad4b43", fontSize: 5.5 }}>Due: ৳100.00</span>}
        </div>
      </div>

      <div style={{ position: "relative", marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "flex-start", gap: 5, minHeight: 16, paddingBottom: 4 }}>
          {settings.signature.type === "image" && settings.signature.imageDataUrl ? (
            <Image src={settings.signature.imageDataUrl} alt="Signature preview" width={38} height={12} unoptimized style={{ maxWidth: "58%", height: 12, objectFit: "contain", objectPosition: "left bottom" }} />
          ) : (
            <span style={{ maxWidth: "58%", overflow: "hidden", color: appearance.ink, fontFamily: "cursive", fontSize: 7, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {signature || "Signature"}
            </span>
          )}
        </div>
        <div style={{ borderTop: `1px solid ${appearance.accent}`, paddingTop: 5 }}>
        <div style={{ display: "grid", gap: 3 }}>
          {footerValues.length > 0 ? footerValues.map((value, index) => (
            <span key={`${template.id}-preview-footer-${index}`} style={{ overflow: "hidden", color: appearance.muted, fontSize: 5.5, lineHeight: 1.25, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {value}
            </span>
          )) : (
            <span style={{ color: "#9ba49f", fontSize: 5.5, fontStyle: "italic" }}>Footer information will appear here</span>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function reorderItems(items: InvoiceTemplateItem[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function readSignatureImage(file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    throw new Error("Choose a PNG or JPEG signature image.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Signature images must be 2 MB or smaller.");
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the signature image."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the signature image."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function InvoiceSetupSection() {
  const storeName = usePharmacyStoreName();
  const snapshot = useSyncExternalStore(
    subscribeToInvoiceTemplateSettings,
    getInvoiceTemplateSettingsSnapshot,
    () => emptyInvoiceTemplateSnapshot,
  );
  const [saveState, setSaveState] = useState({ isSaving: false, message: "", error: "" });

  async function saveSettings(settings: InvoiceTemplateSettings) {
    setSaveState({ isSaving: true, message: "", error: "" });
    try {
      saveInvoiceTemplateSettings(settings);
      await retryPharmacyDataSync();
      setSaveState({ isSaving: false, message: "Invoice setup saved and synced.", error: "" });
    } catch (saveError) {
      setSaveState({
        isSaving: false,
        message: "",
        error: saveError instanceof Error ? saveError.message : "Could not save invoice setup.",
      });
    }
  }

  return (
    <InvoiceSetupEditor
      key={snapshot.revision}
      initialSettings={snapshot.settings}
      initialError={snapshot.error}
      storeName={storeName}
      isSaving={saveState.isSaving}
      message={saveState.message}
      saveError={saveState.error}
      onSaveSettings={saveSettings}
    />
  );
}

function InvoiceSetupEditor({
  initialSettings,
  initialError,
  storeName,
  isSaving,
  message,
  saveError,
  onSaveSettings,
}: {
  initialSettings: InvoiceTemplateSettings;
  initialError: string;
  storeName: string;
  isSaving: boolean;
  message: string;
  saveError: string;
  onSaveSettings: (settings: InvoiceTemplateSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => cloneSettings(initialSettings));
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialSettings.activeTemplateId);
  const [headerOption, setHeaderOption] = useState(invoiceFieldOptions[0].key);
  const [footerOption, setFooterOption] = useState(invoiceFieldOptions[0].key);
  const [previewPaymentStatus, setPreviewPaymentStatus] = useState<"paid" | "due">("paid");
  const initialPageSize = initialSettings.pageSize ?? { format: "a4" as const, widthMm: 210, heightMm: 297 };
  const [customPageWidth, setCustomPageWidth] = useState(String(initialPageSize.widthMm));
  const [customPageHeight, setCustomPageHeight] = useState(String(initialPageSize.heightMm));
  const [customHeaderText, setCustomHeaderText] = useState("");
  const [customFooterText, setCustomFooterText] = useState("");
  const [draggedItem, setDraggedItem] = useState<{ section: SectionName; index: number } | null>(null);
  const [error, setError] = useState(initialError);

  const selectedTemplate = draft.templates.find((template) => template.id === selectedTemplateId)
    ?? draft.templates[0]
    ?? createDefaultInvoiceTemplateSettings().templates[0];
  const pageSize = draft.pageSize ?? { format: "a4" as const, widthMm: 210, heightMm: 297 };

  function updateSelectedTemplate(update: (template: InvoiceTemplate) => InvoiceTemplate) {
    setDraft((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.id === selectedTemplateId ? update(template) : template),
    }));
    setError("");
  }

  function updateSection(section: SectionName, update: (items: InvoiceTemplateItem[]) => InvoiceTemplateItem[]) {
    updateSelectedTemplate((template) => ({ ...template, [section]: update(template[section]) }));
  }

  function addField(section: SectionName) {
    if (selectedTemplate[section].length >= MAX_INVOICE_TEMPLATE_ITEMS) {
      setError(`A ${section} can contain at most ${MAX_INVOICE_TEMPLATE_ITEMS} entries.`);
      return;
    }
    const key = section === "header" ? headerOption : footerOption;
    const option = invoiceFieldOptions.find((field) => field.key === key);
    if (!option) return;
    const item: InvoiceTemplateItem = {
      id: makeId(),
      type: "field",
      key: option.key,
      label: option.label,
    };
    updateSection(section, (items) => [...items, item]);
  }

  function addCustomText(section: SectionName) {
    if (selectedTemplate[section].length >= MAX_INVOICE_TEMPLATE_ITEMS) {
      setError(`A ${section} can contain at most ${MAX_INVOICE_TEMPLATE_ITEMS} entries.`);
      return;
    }
    const value = (section === "header" ? customHeaderText : customFooterText).trim();
    if (!value) {
      setError("Enter the custom text to add to the invoice.");
      return;
    }
    updateSection(section, (items) => [...items, { id: makeId(), type: "text", label: "Text", value }]);
    if (section === "header") setCustomHeaderText("");
    else setCustomFooterText("");
  }

  function updateItem(section: SectionName, itemId: string, update: (item: InvoiceTemplateItem) => InvoiceTemplateItem) {
    updateSection(section, (items) => items.map((item) => item.id === itemId ? update(item) : item));
  }

  function setHeaderAlignment(itemId: string, align: "left" | "right") {
    updateItem("header", itemId, (item) => ({ ...item, align }));
  }

  function removeItem(section: SectionName, itemId: string) {
    updateSection(section, (items) => items.filter((item) => item.id !== itemId));
  }

  function moveItem(section: SectionName, index: number, direction: -1 | 1) {
    updateSection(section, (items) => reorderItems(items, index, index + direction));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, section: SectionName, targetIndex: number) {
    event.preventDefault();
    if (draggedItem?.section === section) {
      updateSection(section, (items) => reorderItems(items, draggedItem.index, targetIndex));
    }
    setDraggedItem(null);
  }

  async function handleSignatureFile(file: File | undefined) {
    if (!file) return;
    try {
      const imageDataUrl = await readSignatureImage(file);
      setDraft((current) => ({ ...current, signature: { ...current.signature, type: "image", imageDataUrl } }));
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not load the signature image.");
    }
  }

  async function saveSettings() {
    setError("");
    if (pageSize.format === "custom") {
      const widthMm = Number(customPageWidth);
      const heightMm = Number(customPageHeight);
      if (!Number.isFinite(widthMm) || widthMm < 50 || widthMm > 420) {
        setError("Custom invoice width must be between 50 and 420 mm.");
        return;
      }
      if (!Number.isFinite(heightMm) || heightMm < 50 || heightMm > 590) {
        setError("Custom invoice height must be between 50 and 590 mm.");
        return;
      }
      await onSaveSettings({ ...draft, pageSize: { format: "custom", widthMm, heightMm } });
      return;
    }
    await onSaveSettings(draft);
  }

  function renderSectionEditor(section: SectionName) {
    const items = selectedTemplate[section];
    const option = section === "header" ? headerOption : footerOption;
    const setOption = section === "header" ? setHeaderOption : setFooterOption;
    const customText = section === "header" ? customHeaderText : customFooterText;
    const setCustomText = section === "header" ? setCustomHeaderText : setCustomFooterText;
    const title = section === "header" ? "Header information" : "Footer information";

    return (
      <section aria-label={title} style={panelStyle}>
        <h3 style={{ margin: "0 0 5px", color: "#203128", fontSize: 14 }}>{title}</h3>
        <p style={{ margin: "0 0 14px", color: "#718078", fontSize: 11, lineHeight: 1.5 }}>
          Add, edit, remove, or drag items to change their order. Header and footer items stay in their own section.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}>
          <select
            aria-label={`Add common information to ${section}`}
            value={option}
            onChange={(event) => setOption(event.currentTarget.value as typeof option)}
            style={inputStyle}
          >
            {invoiceFieldOptions.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
          <button type="button" disabled={items.length >= MAX_INVOICE_TEMPLATE_ITEMS} onClick={() => addField(section)} style={{ border: 0, borderRadius: 6, background: "#e8f6ee", color: "#16845f", padding: "8px 11px", fontSize: 11, fontWeight: 700, cursor: items.length >= MAX_INVOICE_TEMPLATE_ITEMS ? "not-allowed" : "pointer", opacity: items.length >= MAX_INVOICE_TEMPLATE_ITEMS ? 0.55 : 1 }}>
            Add info
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginTop: 8 }}>
          <input
            aria-label={`Custom text for ${section}`}
            value={customText}
            onChange={(event) => setCustomText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomText(section);
              }
            }}
            placeholder="Add custom information or a message"
            maxLength={120}
            style={inputStyle}
          />
          <button type="button" disabled={items.length >= MAX_INVOICE_TEMPLATE_ITEMS} onClick={() => addCustomText(section)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#34453b", padding: "8px 11px", fontSize: 11, fontWeight: 650, cursor: items.length >= MAX_INVOICE_TEMPLATE_ITEMS ? "not-allowed" : "pointer", opacity: items.length >= MAX_INVOICE_TEMPLATE_ITEMS ? 0.55 : 1 }}>
            Add text
          </button>
        </div>
        <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable
              onDragStart={(event) => {
                setDraggedItem({ section, index });
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, section, index)}
              onDragEnd={() => setDraggedItem(null)}
              style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) auto", alignItems: "center", gap: 8, border: "1px solid #e7ede9", borderRadius: 6, background: "#fbfdfb", padding: 8, cursor: "grab" }}
            >
              <span aria-hidden="true" style={{ color: "#93a099", fontSize: 15, textAlign: "center" }}>⠿</span>
              <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
                <span style={{ color: "#87928d", fontSize: 10 }}>
                  {item.type === "field" ? "Common information" : "Custom text"}
                </span>
                <input
                  aria-label={`Edit ${section} item ${index + 1}`}
                  value={item.type === "field" ? item.label : item.value}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateItem(section, item.id, (current) => current.type === "field"
                      ? { ...current, label: value }
                      : { ...current, value });
                  }}
                  maxLength={120}
                  style={{ ...inputStyle, padding: "6px 8px" }}
                />
                {section === "header" && (
                  <select
                    aria-label={`Header item ${index + 1} alignment`}
                    value={item.align ?? "left"}
                    onChange={(event) => setHeaderAlignment(item.id, event.currentTarget.value as "left" | "right")}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 10 }}
                  >
                    <option value="left">Left side</option>
                    <option value="right">Right side</option>
                  </select>
                )}
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button type="button" aria-label={`Move ${section} item up`} disabled={index === 0} onClick={() => moveItem(section, index, -1)} style={{ border: "1px solid #dce5df", borderRadius: 4, background: "#fff", color: "#526158", padding: "5px 7px", cursor: index === 0 ? "not-allowed" : "pointer", opacity: index === 0 ? 0.45 : 1 }}>↑</button>
                <button type="button" aria-label={`Move ${section} item down`} disabled={index === items.length - 1} onClick={() => moveItem(section, index, 1)} style={{ border: "1px solid #dce5df", borderRadius: 4, background: "#fff", color: "#526158", padding: "5px 7px", cursor: index === items.length - 1 ? "not-allowed" : "pointer", opacity: index === items.length - 1 ? 0.45 : 1 }}>↓</button>
                <button type="button" aria-label={`Delete ${section} item`} onClick={() => removeItem(section, item.id)} style={{ border: "1px solid #f0d3cf", borderRadius: 4, background: "#fff8f7", color: "#ad4b43", padding: "5px 7px", cursor: "pointer" }}>×</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <p style={{ margin: 0, border: "1px dashed #dce5df", borderRadius: 6, padding: 12, color: "#87928d", fontSize: 11 }}>No information added to this section.</p>}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="invoice-setup-title" style={{ width: "100%", maxWidth: 1100, color: "#26352f" }}>
      <header style={{ marginBottom: 18 }}>
        <h2 id="invoice-setup-title" style={{ margin: 0, color: "#203128", fontSize: 19, fontWeight: 750 }}>Invoice Setup</h2>
        <p style={{ margin: "6px 0 0", color: "#718078", fontSize: 12, lineHeight: 1.6 }}>
          Choose one of four invoice templates. The active template is used when downloading or printing invoices from Sales and Invoice.
        </p>
      </header>

      {(error || saveError) && <p role="alert" style={{ margin: "0 0 12px", border: "1px solid #f0d3cf", borderRadius: 6, background: "#fff8f7", padding: 10, color: "#ad4b43", fontSize: 12 }}>{error || saveError}</p>}
      {message && <p role="status" style={{ margin: "0 0 12px", border: "1px solid #cce9d8", borderRadius: 6, background: "#f3fbf6", padding: 10, color: "#16845f", fontSize: 12 }}>{message}</p>}

      <fieldset disabled={isSaving} style={{ display: "contents", border: 0, margin: 0, padding: 0 }}>
      <section aria-label="Invoice page size" style={{ ...panelStyle, display: "grid", gridTemplateColumns: "minmax(180px, 0.8fr) repeat(2, minmax(110px, 0.5fr))", alignItems: "end", gap: 10, marginBottom: 14 }}>
        <label style={{ display: "grid", gap: 6, color: "#34453b", fontSize: 11, fontWeight: 650 }}>
          Invoice page size
          <select
            value={pageSize.format}
            onChange={(event) => {
              const format = event.currentTarget.value as "a4" | "a5" | "custom";
              const dimensions = format === "a4"
                ? { widthMm: 210, heightMm: 297 }
                : format === "a5"
                  ? { widthMm: 148, heightMm: 210 }
                  : { widthMm: pageSize.widthMm, heightMm: pageSize.heightMm };
              setCustomPageWidth(String(dimensions.widthMm));
              setCustomPageHeight(String(dimensions.heightMm));
              setDraft((current) => ({ ...current, pageSize: { format, ...dimensions } }));
            }}
            style={inputStyle}
          >
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="a5">A4 half / A5 (148 × 210 mm)</option>
            <option value="custom">Custom size</option>
          </select>
        </label>
        {pageSize.format === "custom" ? (
          <>
            {([
              ["width", "Width (mm)", 420, customPageWidth, setCustomPageWidth],
              ["height", "Height (mm)", 590, customPageHeight, setCustomPageHeight],
            ] as const).map(([dimension, label, maximum, value, setValue]) => (
              <label key={dimension} style={{ display: "grid", gap: 6, color: "#34453b", fontSize: 11, fontWeight: 650 }}>
                {label}
                <input
                  type="text"
                  inputMode="numeric"
                  min="50"
                  max={maximum}
                  value={value}
                  onChange={(event) => {
                    const entered = event.currentTarget.value;
                    if (!/^\d{0,3}$/.test(entered)) return;
                    setValue(entered);
                    const numericValue = Number(entered);
                    if (entered && numericValue >= 50 && numericValue <= maximum) {
                      const sizeKey = dimension === "width" ? "widthMm" : "heightMm";
                      setDraft((current) => ({
                        ...current,
                        pageSize: { ...(current.pageSize ?? pageSize), [sizeKey]: numericValue },
                      }));
                    }
                  }}
                  style={inputStyle}
                />
              </label>
            ))}
          </>
        ) : (
          <p style={{ gridColumn: "span 2", margin: 0, color: "#718078", fontSize: 10, lineHeight: 1.5 }}>
            The selected paper size is used for invoice previews and downloaded or printed PDFs.
          </p>
        )}
      </section>
      </fieldset>

      <div role="group" aria-label="Demo invoice payment status" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, marginBottom: 10, color: "#687871", fontSize: 11 }}>
        <span style={{ marginRight: 3 }}>Demo status:</span>
        {(["paid", "due"] as const).map((status) => {
          const isSelected = previewPaymentStatus === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setPreviewPaymentStatus(status)}
              style={{ border: isSelected ? 0 : "1px solid #dce5df", borderRadius: 5, background: isSelected ? "#e8f6ee" : "#fff", color: isSelected ? "#16845f" : "#526158", padding: "5px 8px", fontSize: 10, fontWeight: 700, textTransform: "capitalize", cursor: "pointer" }}
            >
              {status}
            </button>
          );
        })}
        <span style={{ color: "#87928d", fontSize: 10 }}>Preview only; does not change invoice settings.</span>
      </div>

      <fieldset disabled={isSaving} style={{ display: "contents", border: 0, margin: 0, padding: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 205px), 1fr))", gap: 12, marginBottom: 18 }}>
        {draft.templates.map((template) => {
          const active = draft.activeTemplateId === template.id;
          const selected = selectedTemplateId === template.id;
          return (
            <article key={template.id} style={{ ...panelStyle, padding: 11, borderColor: active ? "#83c7a2" : selected ? "#a6cdb6" : "#e1eae4", background: active ? "#f4fbf6" : "#fff" }}>
              <button type="button" onClick={() => setSelectedTemplateId(template.id)} aria-pressed={selected} style={{ display: "grid", width: "100%", gap: 8, border: 0, background: "transparent", padding: 0, color: "#203128", textAlign: "left", cursor: "pointer" }}>
                <InvoiceTemplatePreview template={template} settings={draft} previewPaymentStatus={previewPaymentStatus} storeName={storeName} />
                <span>
                  <strong style={{ fontSize: 13 }}>{template.name || "Untitled template"}</strong>
                  <span style={{ display: "block", marginTop: 4, color: "#718078", fontSize: 10, lineHeight: 1.5 }}>{templateDescription(template)}</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setDraft((current) => ({ ...current, activeTemplateId: template.id }));
                  setSelectedTemplateId(template.id);
                }}
                style={{ marginTop: 11, border: active ? 0 : "1px solid #dce5df", borderRadius: 5, background: active ? "#179c70" : "#fff", color: active ? "#fff" : "#526158", padding: "6px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
              >
                {active ? "Active template" : "Use this template"}
              </button>
            </article>
          );
        })}
      </div>

      <section style={{ ...panelStyle, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(180px, 0.6fr)", alignItems: "end", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, color: "#34453b", fontSize: 11, fontWeight: 650 }}>
            Template name
            <input
              value={selectedTemplate.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                updateSelectedTemplate((template) => ({ ...template, name }));
              }}
              maxLength={40}
              style={inputStyle}
            />
          </label>
          <p style={{ margin: 0, color: "#718078", fontSize: 10, lineHeight: 1.5 }}>{templateDescription(selectedTemplate)}</p>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", alignItems: "start", gap: 14 }}>
        {renderSectionEditor("header")}
        {renderSectionEditor("footer")}
      </div>

      <section aria-label="Invoice payment seals" style={{ ...panelStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 14 }}>
        {([
          ["paid", "Show PAID seal on fully paid invoices"],
          ["due", "Show DUE seal when an amount is due"],
        ] as const).map(([key, label]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "#34453b", fontSize: 11, fontWeight: 600 }}>
            {label}
            <input
              type="checkbox"
              role="switch"
              checked={draft.seals[key]}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((current) => ({ ...current, seals: { ...current.seals, [key]: checked } }));
              }}
              style={{ accentColor: "#179c70", width: 18, height: 18 }}
            />
          </label>
        ))}
      </section>

      <section aria-labelledby="invoice-signature-title" style={{ ...panelStyle, marginTop: 14 }}>
        <h3 id="invoice-signature-title" style={{ margin: "0 0 5px", color: "#203128", fontSize: 14 }}>Signature</h3>
        <p style={{ margin: "0 0 12px", color: "#718078", fontSize: 11, lineHeight: 1.5 }}>Choose typed text or upload a PNG/JPEG signature image. Invoice date and time are automatically taken from the sale.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
          {(["text", "image"] as const).map((type) => (
            <label key={type} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#34453b", fontSize: 11 }}>
              <input type="radio" name="invoice-signature-type" checked={draft.signature.type === type} onChange={() => setDraft((current) => ({ ...current, signature: { ...current.signature, type } }))} />
              {type === "text" ? "Typed signature" : "Signature photo"}
            </label>
          ))}
        </div>
        {draft.signature.type === "text" ? (
          <label style={{ display: "grid", gap: 6, maxWidth: 440, color: "#34453b", fontSize: 11, fontWeight: 600 }}>
            Signature text
            <input
              value={draft.signature.text}
              onChange={(event) => {
                const text = event.currentTarget.value;
                setDraft((current) => ({ ...current, signature: { ...current.signature, text } }));
              }}
              maxLength={80}
              placeholder="Pharmacy owner name"
              style={inputStyle}
            />
          </label>
        ) : (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Upload signature image"
              onChange={(event) => {
                void handleSignatureFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
              style={{ color: "#526158", fontSize: 11 }}
            />
            {draft.signature.imageDataUrl && (
              <>
                <Image src={draft.signature.imageDataUrl} alt="Uploaded signature preview" width={180} height={72} unoptimized style={{ maxWidth: 180, maxHeight: 72, objectFit: "contain", border: "1px solid #e7ede9", borderRadius: 4, padding: 4 }} />
                <button type="button" onClick={() => setDraft((current) => ({ ...current, signature: { ...current.signature, imageDataUrl: "" } }))} style={{ border: "1px solid #f0d3cf", borderRadius: 5, background: "#fff8f7", color: "#ad4b43", padding: "7px 9px", fontSize: 10, cursor: "pointer" }}>Remove image</button>
              </>
            )}
          </div>
        )}
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" disabled={isSaving} onClick={() => void saveSettings()} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "10px 16px", fontSize: 12, fontWeight: 700, cursor: isSaving ? "wait" : "pointer", opacity: isSaving ? 0.7 : 1 }}>
          {isSaving ? "Saving..." : "Save Invoice Setup"}
        </button>
      </div>
    </fieldset>
    </section>
  );
}
