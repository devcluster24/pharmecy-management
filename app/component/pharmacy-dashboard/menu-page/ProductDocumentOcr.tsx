"use client";

import { useState, type FormEvent } from "react";
import {
  extractedProductDetailLabels,
  type ExtractedProductDetails,
} from "@/lib/ocr/extractProductDetails";

export type ProductDocumentOcrState = {
  status: string;
  error: string;
  extractedDetails: ExtractedProductDetails | null;
  qualityMessage: string;
};

type EditableProductDetail = Exclude<keyof ExtractedProductDetails, "packSizeNumberSuggestions">;

export function ProductDocumentOcr({
  scanState,
  companyNames,
  companyNamesError,
  genericNames,
  genericNamesError,
  onDetailsChange,
  onDetailsBlur,
  onPackSizeSelect,
  onSaveProduct,
}: {
  scanState?: ProductDocumentOcrState;
  companyNames: string[];
  companyNamesError: string;
  genericNames: string[];
  genericNamesError: string;
  onDetailsChange: (field: EditableProductDetail, value: string) => void;
  onDetailsBlur: (field: EditableProductDetail, value: string) => void;
  onPackSizeSelect: (packSize: string) => void;
  onSaveProduct: (details: ExtractedProductDetails) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const details = scanState?.extractedDetails;
  const companyQuery = details?.company.trim().toLocaleLowerCase("en-US") ?? "";
  const companySuggestions = companyQuery
    ? companyNames
      .filter((name) => name.toLocaleLowerCase("en-US").includes(companyQuery))
      .sort((left, right) => {
        const leftStartsWith = left.toLocaleLowerCase("en-US").startsWith(companyQuery);
        const rightStartsWith = right.toLocaleLowerCase("en-US").startsWith(companyQuery);
        return Number(rightStartsWith) - Number(leftStartsWith) || left.localeCompare(right);
      })
      .slice(0, 6)
    : [];
  const genericQuery = details?.genericName.trim().toLocaleLowerCase("en-US") ?? "";
  const genericSuggestions = genericQuery
    ? genericNames
      .filter((name) => name.toLocaleLowerCase("en-US").includes(genericQuery))
      .sort((left, right) => {
        const leftStartsWith = left.toLocaleLowerCase("en-US").startsWith(genericQuery);
        const rightStartsWith = right.toLocaleLowerCase("en-US").startsWith(genericQuery);
        return Number(rightStartsWith) - Number(leftStartsWith) || left.localeCompare(right);
      })
      .slice(0, 6)
    : [];

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onSaveProduct(details);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
          : "Could not save this product.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 7, padding: "11px 12px", border: "1px solid #d8ebe1", borderRadius: 7, background: "#f5fbf7" }}>
      {scanState?.status && <p role="status" aria-live="polite" style={{ margin: 0, color: "#47715b", fontSize: 11 }}>{scanState.status}</p>}
      {scanState?.error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 11 }}>{scanState.error}</p>}
      {scanState?.qualityMessage && <p role="status" style={{ margin: 0, color: "#916517", fontSize: 11 }}>{scanState.qualityMessage}</p>}
      {details && (
        <form onSubmit={submitProduct} style={{ display: "grid", gap: 10 }}>
          <div>
            <strong style={{ color: "#2c4939", fontSize: 12 }}>Possible product details</strong>
            <p style={{ margin: "3px 0 0", color: "#708077", fontSize: 11 }}>Review or edit the extracted details, then save the product to your pharmacy list.</p>
            {companyNamesError && <p role="status" style={{ margin: "3px 0 0", color: "#916517", fontSize: 11 }}>{companyNamesError}</p>}
            {genericNamesError && <p role="status" style={{ margin: "3px 0 0", color: "#916517", fontSize: 11 }}>{genericNamesError}</p>}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, margin: 0 }}>
            {(Object.entries(extractedProductDetailLabels) as [EditableProductDetail, string][]).map(([field, label]) => (
              <div key={field} style={{ minWidth: 0 }}>
                <dt style={{ marginBottom: 3, color: "#708077", fontSize: 10 }}>{label}{field === "brandName" || field === "company" ? " *" : ""}</dt>
                <dd style={{ margin: 0 }}>
                  <input
                    aria-label={label}
                    name={field}
                    required={field === "brandName" || field === "company" || field === "genericName"}
                    inputMode={field === "packSize" || field === "unitPrice" || field === "packPrice" ? "decimal" : undefined}
                    value={details[field]}
                    onChange={(event) => onDetailsChange(field, event.target.value)}
                    onFocus={() => onDetailsChange(field, "")}
                    onBlur={(event) => onDetailsBlur(field, event.currentTarget.value)}
                    placeholder="Not detected"
                    disabled={isSaving}
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 4, padding: "6px 7px", color: "#405248", fontSize: 11 }}
                  />
                  {field === "company" && companySuggestions.length > 0 && (
                    <div aria-label="Company suggestions from product list" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {companySuggestions.map((company) => (
                        <button
                          key={company}
                          type="button"
                          onClick={() => onDetailsChange("company", company)}
                          disabled={isSaving}
                          style={{ border: "1px solid #d8e9df", borderRadius: 5, background: "#f5fbf7", color: "#47715b", padding: "4px 7px", fontSize: 10, cursor: isSaving ? "not-allowed" : "pointer" }}
                        >
                          {company}
                        </button>
                      ))}
                    </div>
                  )}
                  {field === "genericName" && genericSuggestions.length > 0 && (
                    <div aria-label="Generic name suggestions from product list" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {genericSuggestions.map((genericName) => (
                        <button
                          key={genericName}
                          type="button"
                          onClick={() => onDetailsChange("genericName", genericName)}
                          disabled={isSaving}
                          style={{ border: "1px solid #d8e9df", borderRadius: 5, background: "#f5fbf7", color: "#47715b", padding: "4px 7px", fontSize: 10, cursor: isSaving ? "not-allowed" : "pointer" }}
                        >
                          {genericName}
                        </button>
                      ))}
                    </div>
                  )}
                  {field === "packSize" && !details.packSize.trim() && details.packSizeNumberSuggestions.length > 0 && (
                    <div aria-label="Pack Size number suggestions" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {details.packSizeNumberSuggestions.map((number, index) => (
                        <button
                          key={`${number}-${index}`}
                          type="button"
                          onClick={() => onPackSizeSelect(number)}
                          disabled={isSaving}
                          aria-label={`Use ${number} as Pack Size`}
                          title={`Set Pack Size to ${number}`}
                          style={{ border: "1px solid #d8e9df", borderRadius: 5, background: "#f5fbf7", color: "#47715b", padding: "3px 6px", fontSize: 10, cursor: isSaving ? "not-allowed" : "pointer" }}
                        >
                          {number}
                        </button>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {saveError && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{saveError}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{ border: 0, borderRadius: 6, background: isSaving ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: isSaving ? "not-allowed" : "pointer" }}
            >
              {isSaving ? "Saving product..." : "Save product"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
