import type { OcrResult } from "@/app/component/ocr/types";

export type ProductOcrFields = Partial<Record<
  | "manufacturer"
  | "brand"
  | "genericName"
  | "strength"
  | "dosageForm"
  | "retailPrice"
  | "usageType"
  | "darCode"
  | "medicineTypeCategory"
  | "registrationInformation",
  string
>>;

const FIELD_LABELS: Record<keyof ProductOcrFields, string[]> = {
  manufacturer: ["pharmaceutical company", "manufactured by", "marketed by", "mfg by", "manufacturer", "company"],
  brand: ["brand name", "trade name", "product name", "brand"],
  genericName: ["generic name", "composition", "active ingredient", "generic"],
  strength: ["strength", "each tablet contains", "each capsule contains"],
  dosageForm: ["dosage form", "presentation", "form"],
  retailPrice: ["retail price", "maximum retail price", "mrp", "price"],
  usageType: ["usage type", "for use", "use"],
  darCode: ["dar code", "dar no", "dar number", "registration no", "reg no"],
  medicineTypeCategory: ["medicine type", "medicine category", "category"],
  registrationInformation: ["registration information", "registration number", "registration no", "reg no"],
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getProductFieldsFromOcr(result: OcrResult): ProductOcrFields {
  const lines = result.pages.flatMap((page) => page.lines.map((line) => line.text.trim())).filter(Boolean);
  if (!lines.length) lines.push(...result.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

  const fields: ProductOcrFields = {};
  for (const [field, labels] of Object.entries(FIELD_LABELS) as [keyof ProductOcrFields, string[]][]) {
    const labelPattern = labels.map(escapeRegex).join("|");
    const expression = new RegExp(`^\\s*(?:${labelPattern})\\s*(?::|[-–]|\\s)\\s*(.+?)\\s*$`, "i");
    const line = lines.find((candidate) => expression.test(candidate));
    const value = line?.match(expression)?.[1]?.trim();
    if (value) fields[field] = value;
  }

  if (!fields.strength) {
    const strengthMatches = result.text.match(/\b\d+(?:\.\d+)?\s*(?:mcg|μg|mg|g|kg|ml|l|iu|units?|%)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mcg|μg|mg|g|ml|l))?/gi);
    if (strengthMatches?.length) fields.strength = [...new Set(strengthMatches)].join(", ");
  }

  if (!fields.dosageForm) {
    const dosageForm = result.text.match(/\b(?:film[- ]coated\s+)?(?:tablets?|capsules?|syrups?|suspensions?|solutions?|injections?|drops?|creams?|ointments?|powders?|soaps?|inhalers?|suppositories?)\b/i);
    if (dosageForm) fields.dosageForm = dosageForm[0];
  }

  if (!fields.brand) {
    const likelyBrand = lines.find((line) =>
      line.length >= 2
      && line.length <= 50
      && !/\d/.test(line)
      && !/^(?:batch|mfg|exp|expiry|manufactured|marketed|composition|generic|dosage|warning|keep|store)\b/i.test(line),
    );
    if (likelyBrand) fields.brand = likelyBrand;
  }

  return fields;
}
