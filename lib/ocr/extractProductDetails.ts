import type { OcrResult } from "@paddleocr/paddleocr-js";

export type ExtractedProductDetails = {
  brandName: string;
  genericName: string;
  company: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  packSizeNumberSuggestions: string[];
  unitPrice: string;
  packPrice: string;
};
type ProductDetailField = Exclude<keyof ExtractedProductDetails, "packSizeNumberSuggestions">;

export type PackPriceDetails = Pick<ExtractedProductDetails, "packSize" | "unitPrice" | "packPrice">;

type PositionedLine = {
  text: string;
  normalized: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const fieldLabels: Record<ProductDetailField, string> = {
  brandName: "Brand Name",
  genericName: "Generic Name",
  company: "Company",
  strength: "Strength",
  dosageForm: "Dosage Form",
  packSize: "Pack Size",
  unitPrice: "Unit Price",
  packPrice: "Pack Price",
};

const dosageForms = [
  ["sustained release tablet", "Tablet"],
  ["extended release tablet", "Tablet"],
  ["film coated tablet", "Tablet"],
  ["dispersible tablet", "Tablet"],
  ["chewable tablet", "Tablet"],
  ["tablet", "Tablet"],
  ["tablets", "Tablet"],
  ["capsule", "Capsule"],
  ["capsules", "Capsule"],
  ["syrup", "Syrup"],
  ["oral solution", "Oral solution"],
  ["oral suspension", "Suspension"],
  ["suspension", "Suspension"],
  ["injection", "Injection"],
  ["injectable", "Injection"],
  ["cream", "Cream"],
  ["ointment", "Ointment"],
  ["gel", "Gel"],
  ["eye drops", "Eye drops"],
  ["ear drops", "Ear drops"],
  ["drops", "Drops"],
  ["inhaler", "Inhaler"],
  ["powder", "Powder"],
  ["suppository", "Suppository"],
];

const labelPattern = /(?:manufactured|marketed|distributed|imported|composition|each\s+(?:tablet|capsule|5\s*ml)|generic\s+name|brand\s+name|mrp|m\.?\s*r\.?\s*p\.?|pack\s+price|retail\s+price|unit\s+price|price\s+per\s+unit|per\s+(?:tablet|capsule|unit)|batch\s*(?:no|number)?|mfg\.?\s*(?:by|date)?|exp(?:iry)?\.?\s*(?:date)?|reg(?:istration)?\.?\s*(?:no|number)?)/i;
const companyNameKeyword = /\b(?:pharmaceuticals?|pharma|laboratories|labs|healthcare|limited|ltd|plc)\b/i;
const strengthPattern = /\b\d+(?:[.,]\d+)?\s*(?:mcg|µg|μg|mg|kg|g|ml|mL|IU|%)\b(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:mcg|µg|μg|mg|kg|g|ml|mL|IU))?/i;
const pricePattern = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?/i;

function getPositionedLines(results: OcrResult[]): PositionedLine[] {
  return results.flatMap((result) => result.items.flatMap((item) => {
    const points = item.poly.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (!item.text.trim() || points.length < 2) return [];
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return [{
      text: item.text.trim(),
      normalized: item.text.toLocaleLowerCase("en-US"),
      x: Math.min(...xs) / result.image.width,
      y: Math.min(...ys) / result.image.height,
      width: (Math.max(...xs) - Math.min(...xs)) / result.image.width,
      height: (Math.max(...ys) - Math.min(...ys)) / result.image.height,
    }];
  })).sort((left, right) => left.y - right.y || left.x - right.x);
}

function findCompany(lines: PositionedLine[]) {
  const companyLabel = /\b(?:manufactured|marketed|distributed|imported)\s*(?:and|&)?\s*(?:manufactured|marketed)?\s*(?:by|for)\b|\bmfg\.?\s*by\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].text.match(companyLabel);
    if (!match) continue;
    const value = lines[index].text.slice((match.index ?? 0) + match[0].length).replace(/^[\s:.-]+/, "").trim();
    if (value.length > 1) return value;
    const nextLine = lines.slice(index + 1, index + 3).find((line) => !labelPattern.test(line.text));
    if (nextLine) return nextLine.text;
  }
  return lines.find((line) =>
    companyNameKeyword.test(line.text)
    && line.text.length <= 100
    && !/\b(?:composition|each\s+(?:tablet|capsule)|batch|expiry|registration)\b/i.test(line.text),
  )?.text ?? "";
}

function normalizeProductName(name: string) {
  return name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function getEditDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function matchKnownProductName(candidate: string, knownNames: string[]) {
  const normalizedOcr = normalizeProductName(candidate);
  if (!normalizedOcr) return "";
  const normalizedNames = knownNames
    .map((name) => ({ name, normalized: normalizeProductName(name) }))
    .filter((company) => company.normalized);
  const exactMatch = normalizedNames.find((company) => company.normalized === normalizedOcr);
  if (exactMatch) return exactMatch.name;

  const bestMatch = normalizedNames
    .map((company) => {
      const distance = getEditDistance(normalizedOcr, company.normalized);
      return {
        ...company,
        similarity: 1 - distance / Math.max(normalizedOcr.length, company.normalized.length),
      };
    })
    .sort((left, right) => right.similarity - left.similarity)[0];

  return bestMatch && bestMatch.similarity >= 0.78 ? bestMatch.name : "";
}

export const matchCompanyName = matchKnownProductName;

function findGenericName(lines: PositionedLine[]) {
  const compositionLabel = /\b(?:composition|each\s+(?:tablet|capsule|5\s*ml)\s+contains|generic\s+name)\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    const match = line.match(compositionLabel);
    if (!match) continue;
    const inlineValue = line.slice((match.index ?? 0) + match[0].length).replace(/^[\s:.-]+/, "").trim();
    const candidate = inlineValue || lines.slice(index + 1, index + 4).find((next) =>
      next.text.length > 2 && !labelPattern.test(next.text),
    )?.text || "";
    if (candidate) return candidate.replace(strengthPattern, "").replace(/[,:;.\s-]+$/, "").trim();
  }
  return "";
}

function findBrandName(lines: PositionedLine[], company: string, genericName: string, strength: string, dosageForm: string) {
  const excludedValues = new Set([company, genericName, strength, dosageForm].map((value) => value.toLocaleLowerCase("en-US")).filter(Boolean));
  const candidates = lines.filter((line) =>
    line.text.length >= 2
    && line.text.length <= 48
    && !labelPattern.test(line.text)
    && !strengthPattern.test(line.text)
    && !/^\W*\d[\d\s.,/-]*\W*$/.test(line.text)
    && !excludedValues.has(line.normalized),
  );
  const maxHeight = Math.max(...candidates.map((line) => line.height), 0);
  const scored = candidates.map((line) => {
    const sizeScore = maxHeight ? line.height / maxHeight : 0;
    const positionScore = Math.max(0, 1 - line.y / 0.75);
    const centerScore = Math.max(0, 1 - Math.abs(line.x + line.width / 2 - 0.5) * 1.5);
    const textPenalty = /\b(?:mg|mcg|µg|μg|ml|tablet|capsule|syrup|injection|cream|ointment)\b/i.test(line.text) ? 0.45 : 0;
    return { line, score: sizeScore * 0.65 + positionScore * 0.2 + centerScore * 0.15 - textPenalty };
  }).sort((left, right) => right.score - left.score);
  return scored[0]?.score >= 0.35 ? scored[0].line.text : "";
}

function findPackSize(lines: PositionedLine[]) {
  const unitPattern = /\b(?:tablets?|capsules?)\b/i;
  const countBeforeUnit = /\b(\d{1,4})\s*(?:'s\s*)?(?:tablets?|capsules?)\b/i;
  const countAfterUnit = /\b(?:tablets?|capsules?)\s*(?:of|x|×|:|-)?\s*(\d{1,4})\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!unitPattern.test(line.text)) continue;

    const sameLineCount = line.text.match(countBeforeUnit)?.[1] ?? line.text.match(countAfterUnit)?.[1];
    if (sameLineCount) return sameLineCount;

    for (const neighbor of [lines[index - 1], lines[index + 1]]) {
      if (!neighbor || !/^\s*\d{1,4}\s*$/.test(neighbor.text)) continue;
      const verticalDistance = Math.abs(line.y - neighbor.y);
      if (verticalDistance <= Math.max(0.025, line.height * 2, neighbor.height * 2)) {
        return neighbor.text.trim();
      }
    }
  }
  return "";
}

function findPrice(lines: PositionedLine[], labels: RegExp) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    const match = labels.exec(line);
    if (!match) continue;
    const remainder = line.slice((match.index ?? 0) + match[0].length);
    const inlinePrice = remainder.match(pricePattern);
    if (inlinePrice?.[0].trim()) return inlinePrice[0].trim();
    for (const nextLine of lines.slice(index + 1, index + 3)) {
      if (labelPattern.test(nextLine.text)) break;
      const nextPrice = nextLine.text.match(pricePattern);
      if (nextPrice?.[0].trim()) return nextPrice[0].trim();
    }
  }
  return "";
}

function parseNumericValue(value: string) {
  const trimmed = value.trim();
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)
    ? trimmed.replace(/,/g, "")
    : trimmed.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCalculatedValue(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function calculateMissingPackPriceDetails(details: PackPriceDetails): PackPriceDetails {
  const packSize = parseNumericValue(details.packSize);
  const unitPrice = parseNumericValue(details.unitPrice);
  const packPrice = parseNumericValue(details.packPrice);

  if (packSize === null && unitPrice !== null && unitPrice > 0 && packPrice !== null) {
    return { ...details, packSize: formatCalculatedValue(packPrice / unitPrice) };
  }
  if (unitPrice === null && packSize !== null && packSize > 0 && packPrice !== null) {
    return { ...details, unitPrice: formatCalculatedValue(packPrice / packSize) };
  }
  if (packPrice === null && packSize !== null && unitPrice !== null) {
    return { ...details, packPrice: formatCalculatedValue(packSize * unitPrice) };
  }
  return details;
}

export function reconcilePackPriceDetails(
  details: PackPriceDetails,
  editedField?: keyof PackPriceDetails,
): PackPriceDetails {
  const calculated = calculateMissingPackPriceDetails(details);
  const packSize = parseNumericValue(calculated.packSize);
  const unitPrice = parseNumericValue(calculated.unitPrice);
  const packPrice = parseNumericValue(calculated.packPrice);
  if (packSize === null || packSize <= 0 || unitPrice === null || packPrice === null) return calculated;

  const calculatedPackPrice = packSize * unitPrice;
  if (Math.abs(calculatedPackPrice - packPrice) <= 0.01) return calculated;

  if (editedField === "unitPrice") {
    return {
      ...calculated,
      packPrice: formatCalculatedValue(packSize * unitPrice),
    };
  }

  return {
    ...calculated,
    unitPrice: formatCalculatedValue(packPrice / packSize),
  };
}

export function extractProductDetails(
  result: OcrResult | OcrResult[],
  knownCompanyNames: string[] = [],
  knownGenericNames: string[] = [],
): ExtractedProductDetails {
  const lines = getPositionedLines(Array.isArray(result) ? result : [result]);
  const allText = lines.map((line) => line.text).join("\n");
  const strength = allText.match(strengthPattern)?.[0].trim() ?? "";
  const dosageForm = dosageForms.find(([keyword]) => new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(allText))?.[1] ?? "";
  const packSize = findPackSize(lines);
  const packSizeNumberSuggestions = [...new Set(allText.match(/\d+(?:[.,]\d+)*/g) ?? [])];
  const ocrCompany = findCompany(lines);
  const company = matchCompanyName(ocrCompany, knownCompanyNames);
  const genericName = matchKnownProductName(findGenericName(lines), knownGenericNames);

  const priceDetails = reconcilePackPriceDetails({
    packSize,
    unitPrice: findPrice(lines, /\b(?:unit\s+price|price\s+per\s+unit|per\s+(?:tablet|capsule|unit))\b/i),
    packPrice: findPrice(lines, /\b(?:pack\s+price|m\.?\s*r\.?\s*p\.?|max(?:imum)?\s+retail\s+price|retail\s+price|indicative\s+price|ip|tk\.?)\b/i),
  });

  return {
    brandName: findBrandName(lines, company, genericName, strength, dosageForm),
    genericName,
    company,
    strength,
    dosageForm,
    packSize: priceDetails.packSize,
    packSizeNumberSuggestions,
    unitPrice: priceDetails.unitPrice,
    packPrice: priceDetails.packPrice,
  };
}

export { fieldLabels as extractedProductDetailLabels };
