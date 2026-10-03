import { supabase } from "@/lib/supabase/client";
import { OCR_ACCEPTED_FILE_TYPES, OCR_MAX_FILE_BYTES } from "./constants";
import type { OcrLine, OcrResult } from "./types";

const OCR_MAX_BATCH_FILES = 3;

function isOcrBox(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every((point) => Array.isArray(point)
    && point.length >= 2
    && point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)));
}

function isOcrLine(value: unknown): value is OcrLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<OcrLine>;
  return typeof line.text === "string"
    && (line.confidence === null || typeof line.confidence === "number")
    && (line.box === undefined || isOcrBox(line.box));
}

function isOcrResult(value: unknown): value is OcrResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<OcrResult>;
  return typeof result.text === "string"
    && Array.isArray(result.pages)
    && result.pages.every((page) => page
      && Number.isInteger(page.page)
      && Array.isArray(page.lines)
      && (page.width === undefined || (typeof page.width === "number" && Number.isFinite(page.width) && page.width > 0))
      && (page.height === undefined || (typeof page.height === "number" && Number.isFinite(page.height) && page.height > 0))
      && page.lines.every(isOcrLine));
}

export async function recognizeMultipleWithPaddleOcr(files: File[]): Promise<OcrResult> {
  if (!files.length || files.length > OCR_MAX_BATCH_FILES) {
    throw new Error(`Choose between 1 and ${OCR_MAX_BATCH_FILES} scan photos.`);
  }
  if (files.some((file) => !OCR_ACCEPTED_FILE_TYPES.some((type) => type === file.type))) {
    throw new Error("Choose JPEG, PNG, WEBP, BMP, TIFF, or PDF files.");
  }
  if (files.some((file) => file.size > OCR_MAX_FILE_BYTES)) {
    throw new Error("A selected file exceeds the 10 MB limit.");
  }
  if (files.reduce((total, file) => total + file.size, 0) > OCR_MAX_FILE_BYTES) {
    throw new Error("The combined scan photos exceed the 10 MB limit.");
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(`Could not verify your session: ${sessionError.message}`);
  if (!session?.access_token) throw new Error("Sign in before using OCR.");

  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));

  const response = await fetch("/api/ocr/recognize", {
    method: "POST",
    headers: { authorization: `Bearer ${session.access_token}` },
    body,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The OCR service returned an invalid response.");
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "OCR processing failed.";
    throw new Error(message);
  }
  if (!isOcrResult(payload)) throw new Error("The OCR service returned an unexpected result.");
  return payload;
}

export async function recognizeWithPaddleOcr(file: File): Promise<OcrResult> {
  return recognizeMultipleWithPaddleOcr([file]);
}
