"use client";

import { useState, type ChangeEvent } from "react";
import { OCR_ACCEPT_ATTRIBUTE, OCR_MAX_FILE_BYTES } from "./constants";
import { recognizeWithPaddleOcr } from "./paddleOcrClient";
import type { OcrResult } from "./types";

type PaddleOcrUploadProps = {
  onResult?: (result: OcrResult) => void;
};

export default function PaddleOcrUpload({ onResult }: PaddleOcrUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResult(null);
    setError("");
  }

  async function processFile() {
    if (!file || isProcessing) return;
    setIsProcessing(true);
    setError("");
    setResult(null);
    try {
      const ocrResult = await recognizeWithPaddleOcr(file);
      setResult(ocrResult);
      onResult?.(ocrResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OCR processing failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 12, padding: 16, border: "1px solid #e1e9e3", borderRadius: 8, background: "#fff" }}>
      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 600 }}>
        Select an image or PDF
        <input type="file" accept={OCR_ACCEPT_ATTRIBUTE} onChange={selectFile} disabled={isProcessing} />
        <span style={{ color: "#7a8980", fontSize: 11, fontWeight: 400 }}>Maximum file size: {OCR_MAX_FILE_BYTES / (1024 * 1024)} MB. Files are processed temporarily and not stored.</span>
      </label>
      <button type="button" onClick={() => void processFile()} disabled={!file || isProcessing} style={{ justifySelf: "start", border: 0, borderRadius: 6, background: !file || isProcessing ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: !file || isProcessing ? "not-allowed" : "pointer" }}>
        {isProcessing ? "Recognizing text..." : "Recognize text"}
      </button>
      {error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{error}</p>}
      {result && (
        <div aria-live="polite" style={{ display: "grid", gap: 8 }}>
          <strong style={{ color: "#26352f", fontSize: 12 }}>Recognized text</strong>
          {result.pages.map((page) => (
            <div key={page.page} style={{ display: "grid", gap: 6, padding: 10, borderRadius: 6, background: "#f8faf8" }}>
              {result.pages.length > 1 && <strong style={{ color: "#526158", fontSize: 11 }}>Page {page.page}</strong>}
              {page.lines.length ? page.lines.map((line, index) => (
                <p key={`${page.page}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, margin: 0, color: "#26352f", fontSize: 12 }}>
                  <span>{line.text}</span>
                  {line.confidence !== null && <span style={{ flexShrink: 0, color: "#7a8980" }}>{Math.round(line.confidence * 100)}%</span>}
                </p>
              )) : <p style={{ margin: 0, color: "#7a8980", fontSize: 12 }}>No text found on this page.</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
