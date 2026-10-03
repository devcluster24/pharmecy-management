import type { OcrLine, OcrPage, OcrResult } from "@/app/component/ocr/types";

type Candidate = {
  text: string;
  line: OcrLine;
  page: number;
  index: number;
  fontSize: number | null;
  top: number | null;
  bottom: number | null;
};

export type ProductText = {
  brandName: string;
  genericName: string | null;
};

const MAX_GENERIC_LINES = 2;
const MAX_GENERIC_VERTICAL_GAP = 100;
const BRAND_LABEL = /^\s*(?:brand(?:\s+name)?|trade\s+name|product\s+name)\s*(?::|[-–])\s*(.+?)\s*$/i;
const NON_BRAND_LINE = /^(?:batch|b\.?no|mfg|manufactur(?:ed)?\s+by|marketed\s+by|composition|generic(?:\s+name)?|dosage|warning|keep|store|each\s+(?:tablet|capsule)\s+contains|price|mrp|reg(?:istration)?\s*(?:no|number)|dar\s*(?:no|code))\b/i;
const CORPORATE_NAME = /\b(?:pharmaceuticals?|laboratories|laboratory|labs?|limited|ltd|incorporated|inc|corporation|corp|company|co\.)\b/i;
const CORPORATE_CUE = /^(?:mfg|manufactured|marketed|distributed|imported)\s*(?:by|for)?\s*:?\s*$/i;
const GENERIC_COMPANY_KEYWORD = /\b(?:ltd|limited|pharmaceuticals?|pharma|laboratories|lab|company|plc|pvt|manufactured|bangladesh)\b/i;
const GENERIC_COMPOSITION_KEYWORD = /\b(?:composition|each|contains|equivalent|manufactured)\b/i;
const GENERIC_DOSAGE_ONLY = /^\s*(?:\d+(?:\s*[x×]\s*\d+)?\s*)?(?:tablets?|capsules?|syrup|injections?|creams?)\s*$/i;
const MINIMUM_MEANINGFUL_WORD = /[a-z]{2,}/i;

function polygonMetrics(box: number[][] | undefined) {
  if (!box || box.length < 3 || box.some((point) => point.length < 2 || !point.every(Number.isFinite))) {
    return null;
  }

  const ys = box.map(([, y]) => y);
  let twiceArea = 0;
  for (let index = 0; index < box.length; index++) {
    const current = box[index];
    const next = box[(index + 1) % box.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }

  return {
    height: Math.max(...ys) - Math.min(...ys),
    area: Math.abs(twiceArea) / 2,
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...box.map(([x]) => x)),
    right: Math.max(...box.map(([x]) => x)),
  };
}

function cleanBrandName(value: string) {
  return value.replace(/^[\s:;,|.-]+|[\s:;,|.-]+$/g, "").trim();
}

function overlapsBrandHorizontally(line: ReturnType<typeof polygonMetrics>, brand: ReturnType<typeof polygonMetrics>) {
  if (!line || !brand) return true;
  return Math.min(line.right, brand.right) > Math.max(line.left, brand.left);
}

function isUsableCandidate(candidate: Candidate, candidates: Candidate[]) {
  const text = candidate.text.trim();
  if (text.length < 2 || text.length > 70 || NON_BRAND_LINE.test(text) || CORPORATE_NAME.test(text)) return false;
  if (!/[a-z]/i.test(text) || /^\d/.test(text)) return false;
  if (text.split(/\s+/).length > 8) return false;

  const previousLines = candidates
    .filter((entry) => entry.page === candidate.page && entry.index < candidate.index && candidate.index - entry.index <= 2)
    .map((entry) => entry.text);
  return !previousLines.some((line) => CORPORATE_CUE.test(line));
}

function compareCandidates(left: Candidate, right: Candidate) {
  if (left.fontSize !== null && right.fontSize === null) return -1;
  if (left.fontSize === null && right.fontSize !== null) return 1;
  if (left.fontSize !== null && right.fontSize !== null && left.fontSize !== right.fontSize) {
    return right.fontSize - left.fontSize;
  }
  if (left.top !== null && right.top === null) return -1;
  if (left.top === null && right.top !== null) return 1;
  if (left.top !== null && right.top !== null && left.top !== right.top) {
    return left.top - right.top;
  }
  return left.index - right.index;
}

function getPages(result: OcrResult): OcrPage[] {
  return result.pages.length
    ? result.pages
    : [{ page: 1, lines: result.text.split(/\r?\n/).map((text) => ({ text, confidence: null })) }];
}

function getBrandCandidate(result: OcrResult): Candidate | null {
  const candidates: Candidate[] = [];

  for (const page of getPages(result)) {
    page.lines.forEach((line, index) => {
      const text = line.text.trim();
      if (!text) return;
      const labeledMatch = text.match(BRAND_LABEL);
      const cleaned = cleanBrandName(labeledMatch?.[1] ?? text);
      if (!cleaned) return;
      const metrics = polygonMetrics(line.box);
      candidates.push({
        text: cleaned,
        line,
        page: page.page,
        index,
        fontSize: metrics?.height ?? null,
        top: metrics?.top ?? null,
        bottom: metrics?.bottom ?? null,
      });
    });
  }

  const usableCandidates = candidates.filter((candidate) => isUsableCandidate(candidate, candidates));
  if (!usableCandidates.length) return null;

  return usableCandidates.sort(compareCandidates)[0];
}

function extractGenericBelowBrand(result: OcrResult, brand: Candidate): string | null {
  const page = getPages(result).find((entry) => entry.page === brand.page);
  if (!page) return null;

  const brandMetrics = polygonMetrics(brand.line.box);
  return page.lines
    .map((line, index) => ({ line, index, metrics: polygonMetrics(line.box) }))
    .filter(({ line, index, metrics }) => {
      if (!line.text.trim() || index === brand.index) return false;
      if (!brandMetrics || !metrics) return !brandMetrics && index > brand.index;
      const verticalGap = metrics.top - brandMetrics.bottom;
      const overlap = Math.max(0, -verticalGap);
      const slightOverlapLimit = Math.max(10, (metrics.bottom - metrics.top) * 0.25);
      const centerBelowBrand = (metrics.top + metrics.bottom) / 2 > brandMetrics.bottom;
      return centerBelowBrand
        && overlap <= slightOverlapLimit
        && verticalGap <= MAX_GENERIC_VERTICAL_GAP
        && overlapsBrandHorizontally(metrics, brandMetrics);
    })
    .sort((left, right) => {
      if (left.metrics && right.metrics) return left.metrics.top - right.metrics.top;
      return left.index - right.index;
    })
    .filter(({ line }) => {
      const text = line.text.trim();
      return MINIMUM_MEANINGFUL_WORD.test(text)
        && !GENERIC_COMPANY_KEYWORD.test(text)
        && !GENERIC_COMPOSITION_KEYWORD.test(text)
        && !GENERIC_DOSAGE_ONLY.test(text);
    })
    .slice(0, MAX_GENERIC_LINES)
    .map(({ line }) => line.text.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

export function extractProductText(result: OcrResult): ProductText | null {
  const brand = getBrandCandidate(result);
  if (!brand) return null;
  return {
    brandName: brand.text,
    genericName: extractGenericBelowBrand(result, brand),
  };
}

export function extractProductTextFromResults(results: OcrResult[]): ProductText | null {
  const candidates = results.flatMap((result) =>
    getPages(result).flatMap((page) => {
      const pageResult: OcrResult = {
        text: page.lines.map((line) => line.text).join("\n"),
        pages: [page],
      };
      const brand = getBrandCandidate(pageResult);
      if (!brand) return [];
      return [{
        productText: {
          brandName: brand.text,
          genericName: extractGenericBelowBrand(pageResult, brand),
        },
        fontSize: brand.fontSize,
        top: brand.top,
      }];
    }),
  );
  if (!candidates.length) return null;

  candidates.sort((left, right) => {
    if (left.fontSize !== null && right.fontSize === null) return -1;
    if (left.fontSize === null && right.fontSize !== null) return 1;
    if (left.fontSize !== null && right.fontSize !== null && left.fontSize !== right.fontSize) {
      return right.fontSize - left.fontSize;
    }
    if (left.top !== null && right.top !== null && left.top !== right.top) {
      return left.top - right.top;
    }
    return 0;
  });
  return candidates[0].productText;
}

export function extractBrandName(result: OcrResult): string | null {
  return getBrandCandidate(result)?.text ?? null;
}
