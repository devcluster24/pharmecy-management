import type { OcrResult } from "@/app/component/ocr/types";

export type OcrImageDimensions = {
  width: number;
  height: number;
};

export type OcrLayoutLine = {
  text: string;
  confidence: number | null;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    points: number[][];
  };
  relationToPrevious: "same line" | "separate line" | null;
  gapFromPrevious: number | null;
  gapDirection: "horizontal" | "vertical" | null;
  topMargin: number | null;
  bottomMargin: number | null;
};

export type OcrLayoutPage = {
  page: number;
  imageDimensions: OcrImageDimensions | null;
  lines: OcrLayoutLine[];
};

type MeasuredLine = OcrLayoutLine & {
  right: number;
  bottom: number;
};

function isValidDimensions(dimensions: OcrImageDimensions | undefined): dimensions is OcrImageDimensions {
  return Boolean(dimensions
    && Number.isFinite(dimensions.width)
    && Number.isFinite(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0);
}

function getLineMetrics(
  text: string,
  confidence: number | null,
  points: number[][] | undefined,
  imageDimensions: OcrImageDimensions | null,
): MeasuredLine | null {
  if (!points || points.length < 3
    || points.some((point) => point.length < 2 || !point.every(Number.isFinite))) {
    return null;
  }

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    text,
    confidence,
    box: {
      x,
      y,
      width: right - x,
      height: bottom - y,
      points,
    },
    relationToPrevious: null,
    gapFromPrevious: null,
    gapDirection: null,
    topMargin: imageDimensions ? y : null,
    bottomMargin: imageDimensions ? imageDimensions.height - bottom : null,
    right,
    bottom,
  };
}

function verticalOverlapRatio(left: MeasuredLine, right: MeasuredLine) {
  const overlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.box.y, right.box.y));
  const shortestHeight = Math.min(left.box.height, right.box.height);
  return shortestHeight > 0 ? overlap / shortestHeight : 0;
}

export function analyzeOcrLayout(
  result: OcrResult,
  imageDimensionsByPage: Array<OcrImageDimensions | undefined> = [],
): OcrLayoutPage[] {
  return result.pages.map((page, pageIndex) => {
    const suppliedDimensions = imageDimensionsByPage[pageIndex];
    const imageDimensions = isValidDimensions(suppliedDimensions) ? suppliedDimensions : null;
    const lines = page.lines
      .map((line) => getLineMetrics(line.text, line.confidence, line.box, imageDimensions))
      .filter((line): line is MeasuredLine => line !== null)
      .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);

    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1];
      const current = lines[index];
      const isSameLine = verticalOverlapRatio(previous, current) >= 0.5;

      current.relationToPrevious = isSameLine ? "same line" : "separate line";
      current.gapDirection = isSameLine ? "horizontal" : "vertical";
      current.gapFromPrevious = isSameLine
        ? Math.max(0, current.box.x - previous.right)
        : Math.max(0, current.box.y - previous.bottom);
    }

    return {
      page: page.page,
      imageDimensions,
      lines: lines.map((line) => ({
        text: line.text,
        confidence: line.confidence,
        box: line.box,
        relationToPrevious: line.relationToPrevious,
        gapFromPrevious: line.gapFromPrevious,
        gapDirection: line.gapDirection,
        topMargin: line.topMargin,
        bottomMargin: line.bottomMargin,
      })),
    };
  });
}
