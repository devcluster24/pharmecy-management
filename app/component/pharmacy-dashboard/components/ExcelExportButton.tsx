"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

export type ExportSheet = {
  name: string;
  columns: string[];
  rows: (string | number | boolean | null | undefined)[][];
};

const exportButtonStyle = {
  minHeight: 34,
  border: "1px solid #b9dfd0",
  borderRadius: 6,
  background: "#fff",
  color: "#17704e",
  padding: "8px 11px",
  fontSize: 11,
  fontWeight: 650,
  whiteSpace: "nowrap" as const,
  cursor: "pointer",
};

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;

  const normalized = value.trim();
  const yearMonthDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (yearMonthDay) {
    const date = new Date(Number(yearMonthDay[1]), Number(yearMonthDay[2]) - 1, Number(yearMonthDay[3]));
    return date.getFullYear() === Number(yearMonthDay[1])
      && date.getMonth() === Number(yearMonthDay[2]) - 1
      && date.getDate() === Number(yearMonthDay[3])
      ? date
      : null;
  }
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (yearMonth) return new Date(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1);

  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(normalized);
  if (dayFirst) {
    const date = new Date(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));
    return date.getFullYear() === Number(dayFirst[3])
      && date.getMonth() === Number(dayFirst[2]) - 1
      && date.getDate() === Number(dayFirst[1])
      ? date
      : null;
  }

  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getDateRange(sheets: ExportSheet[]) {
  const dates: Date[] = [];
  for (const sheet of sheets) {
    const dateColumnIndexes = sheet.columns
      .map((column, index) => (/date|time|created|updated|occurred|expiry/i.test(column) ? index : -1))
      .filter((index) => index >= 0);
    for (const row of sheet.rows) {
      for (const index of dateColumnIndexes) {
        const date = parseDate(row[index]);
        if (date) dates.push(date);
      }
    }
  }

  const now = new Date();
  const timestamps = dates.map((date) => date.getTime());
  const earliest = timestamps.length ? new Date(timestamps.reduce((min, time) => Math.min(min, time), Infinity)) : now;
  const latest = timestamps.length ? new Date(timestamps.reduce((max, time) => Math.max(max, time), -Infinity)) : now;
  return `${formatDate(earliest)}-${formatDate(latest)}`;
}

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function safeFileName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    || "Export";
}

function safeWorksheetName(value: string, usedNames: Set<string>) {
  const baseName = value
    .replace(/[:\\/?*\[\]\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 31)
    || "Sheet";
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    const suffixText = ` (${suffix})`;
    name = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedNames.add(name.toLocaleLowerCase());
  return name;
}

export default function ExcelExportButton({
  fileName,
  sheets,
  disabled = false,
  onError,
  getSheets,
}: {
  fileName: string;
  sheets: ExportSheet[];
  disabled?: boolean;
  onError?: (message: string) => void;
  getSheets?: () => Promise<ExportSheet[]>;
}) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportWorkbook() {
    setIsExporting(true);
    try {
      const exportSheets = getSheets ? await getSheets() : sheets;
      if (exportSheets.length === 0) throw new Error("There is no table to export.");
      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();
      for (const sheet of exportSheets) {
        const worksheet = XLSX.utils.aoa_to_sheet([
          sheet.columns,
          ...sheet.rows.map((row) => row.map((value) => value ?? "")),
        ]);
        XLSX.utils.book_append_sheet(workbook, worksheet, safeWorksheetName(sheet.name, usedSheetNames));
      }
      XLSX.writeFile(workbook, `${safeFileName(fileName)}_${getDateRange(exportSheets)}.xlsx`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export the workbook.";
      if (onError) onError(message);
      else console.error("Could not export the workbook.", error);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button type="button" disabled={disabled || isExporting} onClick={() => void exportWorkbook()} style={{
      ...exportButtonStyle,
      opacity: disabled || isExporting ? 0.55 : 1,
      cursor: disabled || isExporting ? "not-allowed" : "pointer",
    }}>
      {isExporting ? "Preparing..." : "Export Excel"}
    </button>
  );
}
