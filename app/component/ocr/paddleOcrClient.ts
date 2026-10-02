import { supabase } from "@/lib/supabase/client";
import { OCR_ACCEPTED_FILE_TYPES, OCR_MAX_FILE_BYTES } from "./constants";
import type { OcrResult } from "./types";

function isOcrResult(value: unknown): value is OcrResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<OcrResult>;
  return typeof result.text === "string"
    && Array.isArray(result.pages)
    && result.pages.every((page) => page
      && Number.isInteger(page.page)
      && Array.isArray(page.lines)
      && page.lines.every((line) => line
        && typeof line.text === "string"
        && (line.confidence === null || typeof line.confidence === "number")));
}

export async function recognizeWithPaddleOcr(file: File): Promise<OcrResult> {
  if (!OCR_ACCEPTED_FILE_TYPES.some((type) => type === file.type)) {
    throw new Error("Choose a JPEG, PNG, WEBP, BMP, TIFF, or PDF file.");
  }
  if (file.size > OCR_MAX_FILE_BYTES) {
    throw new Error("The selected file exceeds the 10 MB limit.");
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(`Could not verify your session: ${sessionError.message}`);
  if (!session?.access_token) throw new Error("Sign in before using OCR.");

  const body = new FormData();
  body.set("file", file, file.name);

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
