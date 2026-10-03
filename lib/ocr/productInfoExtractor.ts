import type { OcrLine, OcrPage, OcrResult } from "@/app/component/ocr/types";

export type ProductInformation = {
  pharmaceuticalCompany: string | null;
  brandName: string | null;
  genericName: string | null;
  strength: string | null;
  dosageFormDescription: string | null;
  retailPrice: string | null;
};

type LineMetrics = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
};

type IndexedLine = {
  line: OcrLine;
  index: number;
  metrics: LineMetrics | null;
};

type BrandCandidate = {
  text: string;
  line: IndexedLine;
  page: OcrPage;
};

const COMPANY_ENDING = /(?:\b(?:ltd\.?|limited|pharmaceuticals?|laboratories|pharma|plc)\b|\bpvt\.?\s+ltd\.?)\s*[.,;]*$/i;
const MANUFACTURED_BY = /^\s*(?:manufactured|manufacture|mfg\.?)\s+by\s*:?\s*(.*?)\s*$/i;
const BRAND_LABEL = /^\s*(?:brand(?:\s+name)?|trade\s+name|product\s+name)\s*(?::|[-–])\s*(.+?)\s*$/i;
const COMPANY_OR_METADATA = /^(?:batch|b\.?\s*no|mfg|manufactur(?:e|ed)?\s+by|marketed\s+by|warning|keep|store|price|mrp|retail\s+price|reg(?:istration)?\s*(?:no|number)|dar\s*(?:no|code)|sku)\b/i;
const PACK_QUANTITY = /^(?:(?:pack(?:ed)?\s*(?:size|of)?|box\s*(?:of|contains)?|contains|qty|quantity)\s*:?\s*)?\d+(?:\s*[x×]\s*\d+)?\s*(?:'s|tablets?|capsules?|strips?|sachets?|ampoules?|vials?|bottles?|units?|pieces?|pcs)\b.*$/i;
const GENERIC_COMPANY_KEYWORD = /\b(?:ltd|limited|pharmaceuticals?|pharma|laboratories|lab|company|plc|pvt|manufactured|bangladesh)\b/i;
const GENERIC_COMPOSITION_KEYWORD = /\b(?:composition|each|contains|equivalent|manufactured)\b/i;
const GENERIC_DOSAGE_ONLY = /^\s*(?:\d+(?:\s*[x×]\s*\d+)?\s*)?(?:tablets?|capsules?|syrup|injections?|creams?)\s*$/i;
const MINIMUM_MEANINGFUL_WORD = /[a-z]{2,}/i;
const MAX_GENERIC_VERTICAL_GAP = 100;
const STRENGTH_UNIT = /(?:mg\s*\/\s*5\s*m[l1]|mg\s*\/\s*m[l1]|mcg\s*\/\s*m[l1]|mg\s*\/\s*g|mcg|[µμ]g|kg|ng|mg|g|iu|m[l1]|l|%|units?)/i;
const STRENGTH_PATTERN = new RegExp(
  `(?:^|[^a-z\\d])(\\d+(?:\\.\\d+)?)\\s*(${STRENGTH_UNIT.source})(?=$|[^a-z])`,
  "gi",
);
const DOSAGE_FORMS = [
  "Nebuliser Solution",
  "Dispersible Tablet",
  "Effervescent Tablet",
  "Chewable Tablet",
  "Vaginal Tablet",
  "Vaginal Cream",
  "Oral Suspension",
  "Oral Solution",
  "Nasal Drops",
  "Eye Drops",
  "Ear Drops",
  "Dry Syrup",
  "Suppository",
  "Suspension",
  "Solution",
  "Injection",
  "Ointment",
  "Granules",
  "Mouthwash",
  "Lozenge",
  "Inhaler",
  "Sachet",
  "Emulsion",
  "Shampoo",
  "Lotion",
  "Tablet",
  "Tablets",
  "Capsule",
  "Capsules",
  "Syrup",
  "Drops",
  "Cream",
  "Powder",
  "Spray",
  "Gel",
  "Elixir",
  "Paste",
];
const DOSAGE_FORM_OCR_ALIASES: Record<string, string> = {
  Tatbilets: "Tablets",
};
const PRICE_PATTERN = /\b(?:retail\s+price|price|mrp|m\.r\.p\.?)\b\s*:?\s*(?:(?:tk\.?|bdt|৳)\s*)?(\d+(?:[.,]\d{1,2})?)/i;

function getPages(result: OcrResult): OcrPage[] {
  if (result.pages.length) return result.pages;
  return [{
    page: 1,
    lines: result.text.split(/\r?\n/).map((text) => ({ text, confidence: null })),
  }];
}

function getMetrics(box: number[][] | undefined): LineMetrics | null {
  if (!box || box.length < 3
    || box.some((point) => point.length < 2 || !point.every(Number.isFinite))) return null;

  const xs = box.map(([x]) => x);
  const ys = box.map(([, y]) => y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    top,
    bottom,
    left: Math.min(...xs),
    right: Math.max(...xs),
    height: bottom - top,
  };
}

function getIndexedLines(page: OcrPage): IndexedLine[] {
  return page.lines.map((line, index) => ({ line, index, metrics: getMetrics(line.box) }));
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isCompanyName(text: string) {
  return COMPANY_ENDING.test(cleanText(text));
}

function findCompanyName(lines: IndexedLine[]): string | null {
  for (const [index, entry] of lines.entries()) {
    const lineText = cleanText(entry.line.text);
    const manufacturedMatch = lineText.match(MANUFACTURED_BY);
    if (manufacturedMatch) {
      const sameLineCompany = cleanText(manufacturedMatch[1]);
      if (sameLineCompany) return sameLineCompany;

      const nextLine = lines.slice(index + 1).find(({ line }) => line.text.trim());
      if (nextLine) return cleanText(nextLine.line.text);
    }

    if (isCompanyName(lineText)) return lineText;
  }
  return null;
}

function isLikelyBrand(text: string) {
  const value = cleanText(text);
  if (value.length < 2 || value.length > 80 || !/[a-z]/i.test(value)) return false;
  if (value.split(/\s+/).length > 8 || /^\d/.test(value)) return false;
  if (isCompanyName(value) || COMPANY_OR_METADATA.test(value) || PACK_QUANTITY.test(value)) return false;
  if (DOSAGE_FORMS.some((form) => new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value))) {
    return false;
  }
  STRENGTH_PATTERN.lastIndex = 0;
  return !STRENGTH_PATTERN.test(value);
}

function getBrandCandidate(page: OcrPage, lines: IndexedLine[]): BrandCandidate | null {
  const candidates = lines.flatMap((entry) => {
    const labeled = cleanText(entry.line.text).match(BRAND_LABEL)?.[1];
    const text = cleanText(labeled ?? entry.line.text);
    return isLikelyBrand(text) ? [{ text, line: entry, page }] : [];
  });
  candidates.sort((left, right) => {
    const leftHeight = left.line.metrics?.height;
    const rightHeight = right.line.metrics?.height;
    if (leftHeight !== undefined && rightHeight === undefined) return -1;
    if (leftHeight === undefined && rightHeight !== undefined) return 1;
    if (leftHeight !== undefined && rightHeight !== undefined && leftHeight !== rightHeight) {
      return rightHeight - leftHeight;
    }
    const leftTop = left.line.metrics?.top;
    const rightTop = right.line.metrics?.top;
    if (leftTop !== undefined && rightTop !== undefined && leftTop !== rightTop) return leftTop - rightTop;
    return left.line.index - right.line.index;
  });
  return candidates[0] ?? null;
}

function horizontallyOverlaps(left: LineMetrics, right: LineMetrics) {
  return Math.min(left.right, right.right) > Math.max(left.left, right.left);
}

function getGenericLines(candidate: BrandCandidate, lines: IndexedLine[]) {
  const brandMetrics = candidate.line.metrics;
  return lines
    .filter(({ line, index, metrics }) => {
      if (!line.text.trim() || index === candidate.line.index) return false;
      if (!brandMetrics || !metrics) return !brandMetrics && index > candidate.line.index;
      const verticalGap = metrics.top - brandMetrics.bottom;
      const overlap = Math.max(0, -verticalGap);
      const slightOverlapLimit = Math.max(10, metrics.height * 0.25);
      const centerBelowBrand = (metrics.top + metrics.bottom) / 2 > brandMetrics.bottom;
      return centerBelowBrand
        && overlap <= slightOverlapLimit
        && verticalGap <= MAX_GENERIC_VERTICAL_GAP
        && horizontallyOverlaps(metrics, brandMetrics);
    })
    .sort((left, right) => {
      if (left.metrics && right.metrics) return left.metrics.top - right.metrics.top;
      return left.index - right.index;
    })
    .filter(({ line }) => {
      const text = cleanText(line.text);
      return MINIMUM_MEANINGFUL_WORD.test(text)
        && !GENERIC_COMPANY_KEYWORD.test(text)
        && !GENERIC_COMPOSITION_KEYWORD.test(text)
        && !GENERIC_DOSAGE_ONLY.test(text);
    })
    .slice(0, 2)
    .map(({ line }) => cleanText(line.text))
    .join(" ")
    .trim() || null;
}

function extractStrength(genericName: string | null) {
  if (!genericName) return null;
  const strengths: string[] = [];
  STRENGTH_PATTERN.lastIndex = 0;
  for (const match of genericName.matchAll(STRENGTH_PATTERN)) {
    const value = `${match[1]}${match[2].replace(/\s+/g, "")}`;
    if (!strengths.some((strength) => strength.toLowerCase() === value.toLowerCase())) {
      strengths.push(value);
    }
  }
  return strengths.slice(0, 2).join(" * ") || null;
}

function extractDosageForm(lines: IndexedLine[]) {
  const matchingForms = [
    ...DOSAGE_FORMS.map((form) => ({ form, variants: [form] })),
    ...Object.entries(DOSAGE_FORM_OCR_ALIASES).map(([alias, form]) => ({ form, variants: [alias] })),
  ].flatMap(({ form, variants }) => {
    const found = lines.some(({ line }) => variants.some((variant) => {
      const pattern = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return pattern.test(line.text);
    }));
    return found ? [form] : [];
  }).sort((left, right) => right.length - left.length);
  return matchingForms[0] ?? null;
}

function extractRetailPrice(lines: IndexedLine[]) {
  for (const { line } of lines) {
    const match = cleanText(line.text).match(PRICE_PATTERN);
    if (match) return match[1].replace(",", ".");
  }
  return null;
}

export function extractProductInformation(result: OcrResult): ProductInformation {
  return extractProductInformationFromResults([result]);
}

export function extractProductInformationFromResults(results: OcrResult[]): ProductInformation {
  const pages = results.flatMap(getPages);
  const indexedPages = pages.map((page) => ({ page, lines: getIndexedLines(page) }));
  const brands = indexedPages.flatMap(({ page, lines }) => {
    const candidate = getBrandCandidate(page, lines);
    return candidate ? [{ candidate, lines }] : [];
  });

  brands.sort((left, right) => {
    const leftHeight = left.candidate.line.metrics?.height;
    const rightHeight = right.candidate.line.metrics?.height;
    if (leftHeight !== undefined && rightHeight === undefined) return -1;
    if (leftHeight === undefined && rightHeight !== undefined) return 1;
    if (leftHeight !== undefined && rightHeight !== undefined && leftHeight !== rightHeight) {
      return rightHeight - leftHeight;
    }
    return (left.candidate.line.metrics?.top ?? Infinity) - (right.candidate.line.metrics?.top ?? Infinity);
  });

  const selected = brands[0];
  const genericName = selected
    ? getGenericLines(selected.candidate, selected.lines)
    : null;
  const allLines = indexedPages.flatMap(({ lines }) => lines);

  return {
    pharmaceuticalCompany: indexedPages
      .map(({ lines }) => findCompanyName(lines))
      .find((company): company is string => company !== null) ?? null,
    brandName: selected?.candidate.text ?? null,
    genericName,
    strength: extractStrength(genericName),
    dosageFormDescription: extractDosageForm(allLines),
    retailPrice: extractRetailPrice(allLines),
  };
}
