export type BatchOcrLine = {
  text: string;
  frame?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

export type ScannedBatchDetails = {
  batchNumber?: string;
  suggestedBatchNumber?: string;
  mfgDate?: string;
  expDate?: string;
};

function parseOcrMonthYear(value: string) {
  const datePattern = /\b(?:(\d{1,2})\s*[./\s-]\s*(\d{2}|\d{4})|([A-Za-z]{3,9})\.?\s*[./\s-]*\s*(\d{2}|\d{4}))\b/g;
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];

  for (const match of value.matchAll(datePattern)) {
    const numericMonth = match[1] ? Number(match[1]) : undefined;
    const namedMonth = match[3]
      ? monthNames.findIndex((month) => month === match[3].slice(0, 3).toLocaleLowerCase("en-US")) + 1
      : undefined;
    const month = numericMonth ?? namedMonth;
    const year = match[2] ?? match[4];
    if (!month || month > 12 || !year) continue;
    return `${String(month).padStart(2, "0")}/${year.slice(-2)}`;
  }
  return undefined;
}

function normalizeBatchNumber(value: string) {
  const candidate = value.match(/[A-Za-z0-9](?:[\s-]*[A-Za-z0-9])*/)?.[0];
  if (!candidate || parseOcrMonthYear(candidate)) return undefined;
  const compact = candidate.replace(/\s+/g, "");
  return compact.length >= 2 ? compact : undefined;
}

export function parseScannedBatchDetails(
  text: string,
  recognizedLines: BatchOcrLine[] = [],
): ScannedBatchDetails {
  const lines: BatchOcrLine[] = (recognizedLines.length
    ? recognizedLines.map(({ text: lineText, frame }) => ({ text: lineText.trim(), frame }))
    : text.split(/\r?\n/).map((lineText) => ({ text: lineText.trim() })))
    .filter(({ text: lineText }) => lineText);
  const batchLabel = /\b(?:batch(?:\s*(?:no|number))?|lot(?:\s*(?:no|number))?|b\.?\s*no\.?)\b\.?\s*[:#.-]?\s*/i;
  const mfgLabel = /\b(?:mfg|mfd|mfr|manufactur(?:ed|ing)?)(?:\s*\.?\s*date)?\b\.?\s*[:#.-]?\s*/i;
  const expLabel = /\b(?:exp|expiry|expires?|expiration|use\s*by)(?:\s*\.?\s*date)?\b\.?\s*[:#.-]?\s*/i;
  const anyFieldLabel = /(?:\b(?:batch(?:\s*(?:no|number))?|lot(?:\s*(?:no|number))?|b\.?\s*no\.?)\b|\b(?:mfg|mfd|mfr|manufactur(?:ed|ing)|exp|expiry|expires?|expiration|use\s*by)\b)/i;

  function getValueAfterLabel(lineText: string, label: RegExp) {
    const match = label.exec(lineText);
    if (!match) return undefined;
    const value = lineText.slice(match.index + match[0].length);
    const nextLabelIndex = value.search(anyFieldLabel);
    return (nextLabelIndex >= 0 ? value.slice(0, nextLabelIndex) : value).trim();
  }

  function nearbyValue(labelIndex: number, labelFrame: BatchOcrLine["frame"], isDate: boolean) {
    const candidates = lines.flatMap((line, index) => {
      if (
        index === labelIndex
        || anyFieldLabel.test(line.text)
        || /\b(?:price|mrp|tk|vat|indicative)\b/i.test(line.text)
      ) return [];
      const value = isDate ? parseOcrMonthYear(line.text) : normalizeBatchNumber(line.text);
      if (!value) return [];
      const indexDistance = Math.abs(index - labelIndex);
      let score = indexDistance + (index < labelIndex ? 0.5 : 0);
      if (labelFrame && line.frame) {
        const labelCenterY = labelFrame.top + labelFrame.height / 2;
        const lineCenterY = line.frame.top + line.frame.height / 2;
        const labelCenterX = labelFrame.left + labelFrame.width / 2;
        const lineCenterX = line.frame.left + line.frame.width / 2;
        const verticalDistance = Math.abs(labelCenterY - lineCenterY)
          / Math.max(labelFrame.height, line.frame.height, 1);
        const horizontalDistance = Math.abs(labelCenterX - lineCenterX)
          / Math.max(labelFrame.height, line.frame.height, 1);
        score = verticalDistance + horizontalDistance * 0.15;
      }
      if (score > 4) return [];
      return [{ value, score }];
    });
    return candidates.sort((left, right) => left.score - right.score)[0]?.value;
  }

  function findDate(label: RegExp) {
    for (const [index, line] of lines.entries()) {
      if (!label.test(line.text)) continue;
      const value = getValueAfterLabel(line.text, label);
      const sameLineDate = value && parseOcrMonthYear(value);
      if (sameLineDate) return sameLineDate;
      const nearbyDate = nearbyValue(index, line.frame, true);
      if (nearbyDate) return nearbyDate;
    }
    return undefined;
  }

  function findBatchNumberAboveMfg() {
    const mfgIndex = lines.findIndex((line) => mfgLabel.test(line.text));
    if (mfgIndex < 0) return undefined;
    const mfgLine = lines[mfgIndex];
    const candidates = lines.flatMap((line, index) => {
      if (
        index === mfgIndex
        || anyFieldLabel.test(line.text)
        || /\b(?:price|mrp|tk|vat|indicative)\b/i.test(line.text)
        || parseOcrMonthYear(line.text)
      ) return [];
      if (mfgLine.frame && line.frame) {
        const mfgCenterY = mfgLine.frame.top + mfgLine.frame.height / 2;
        const lineCenterY = line.frame.top + line.frame.height / 2;
        if (lineCenterY >= mfgCenterY) return [];
      } else if (index >= mfgIndex) {
        return [];
      }
      const value = normalizeBatchNumber(line.text);
      if (!value || !/\d/.test(value)) return [];
      const distance = mfgLine.frame && line.frame
        ? mfgLine.frame.top - line.frame.top
        : mfgIndex - index;
      return [{ value, distance }];
    });
    return candidates.sort((left, right) => left.distance - right.distance)[0]?.value;
  }

  let batchNumber: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (!batchLabel.test(line.text)) continue;
    const value = getValueAfterLabel(line.text, batchLabel);
    const sameLineBatch = value && normalizeBatchNumber(value);
    if (sameLineBatch) {
      batchNumber = sameLineBatch;
      break;
    }
    batchNumber = nearbyValue(index, line.frame, false);
    if (batchNumber) break;
  }

  const suggestedBatchNumber = batchNumber ? undefined : findBatchNumberAboveMfg();
  const mfgDate = findDate(mfgLabel);
  const expDate = findDate(expLabel);
  return {
    ...(batchNumber ? { batchNumber } : {}),
    ...(suggestedBatchNumber ? { suggestedBatchNumber } : {}),
    ...(mfgDate ? { mfgDate } : {}),
    ...(expDate ? { expDate } : {}),
  };
}
