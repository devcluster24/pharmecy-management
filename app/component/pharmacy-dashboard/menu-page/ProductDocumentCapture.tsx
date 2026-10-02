"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { recognizeWithPaddleOcr } from "@/app/component/ocr/paddleOcrClient";
import type { OcrResult } from "@/app/component/ocr/types";
import type { ProductDocument } from "./productDocuments";

const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
]);
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp|tiff?)$/i;
const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf,application/pdf";

function isSupportedFile(file: File) {
  return ACCEPTED_MIME_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.test(file.name) || /\.pdf$/i.test(file.name);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProductDocumentCapture({
  files,
  onFilesChange,
  onOcrResult,
  disabled = false,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onOcrResult: (result: OcrResult) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMountedRef = useRef(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
    return () => cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  function addFiles(selectedFiles: File[]) {
    const supportedFiles = selectedFiles.filter(isSupportedFile);
    const rejectedCount = selectedFiles.length - supportedFiles.length;
    setError(rejectedCount ? "Only JPG, PNG, WEBP, BMP, TIFF images and PDF documents are supported." : "");
    onFilesChange([...files, ...supportedFiles.filter((file) =>
      !files.some((existing) =>
        existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
      ),
    )]);
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }

  async function openCamera() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser. Choose an image file instead.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (isMountedRef.current) {
        setCameraStream(stream);
      } else {
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (cause) {
      if (isMountedRef.current) {
        setError(cause instanceof Error ? cause.message : "Could not open the camera.");
      }
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera is not ready yet. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture an image from the camera.");
      return;
    }

    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        if (isMountedRef.current) setError("Could not create the captured image.");
        return;
      }
      if (!isMountedRef.current) return;
      const image = new File([blob], `product-photo-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      addFiles([image]);
      setOcrResult(null);
      setIsRecognizing(true);
      void recognizeWithPaddleOcr(image)
        .then((result) => {
          if (!isMountedRef.current) return;
          setOcrResult(result);
          onOcrResult(result);
          if (!result.text.trim()) setError("No text was detected. Try another photo with the product label in focus.");
        })
        .catch((cause: unknown) => {
          if (isMountedRef.current) {
            setError(cause instanceof Error ? cause.message : "Could not recognize text in the captured photo.");
          }
        })
        .finally(() => {
          if (isMountedRef.current) setIsRecognizing(false);
        });
      setCameraStream(null);
    }, "image/jpeg", 0.92);
  }

  function stopCamera() {
    setCameraStream(null);
  }

  return (
    <section aria-label="Product documents" style={{ display: "grid", gap: 12, padding: "16px 24px", borderBottom: "1px solid #e9eeea", background: "#fbfcfb" }}>
      <div>
        <strong style={{ color: "#26352f", fontSize: 13 }}>Product images and documents</strong>
          <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 11 }}>Capture a clear photo of the product label to recognize its text and fill matching fields below, or select JPG, PNG, WEBP, BMP, TIFF, or PDF files. Attachments are saved only in this browser.</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          onChange={selectFiles}
          disabled={disabled}
          style={{ display: "none" }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || isRecognizing} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}>
          Choose documents
        </button>
        {!cameraStream && (
          <button type="button" onClick={() => void openCamera()} disabled={disabled || isRecognizing} style={{ border: 0, borderRadius: 6, background: "#e7f5ee", color: "#17704e", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}>
            Open camera
          </button>
        )}
      </div>

      {cameraStream && (
        <div style={{ display: "grid", justifyItems: "start", gap: 8 }}>
          <video ref={videoRef} autoPlay playsInline aria-label="Camera preview" style={{ width: "min(100%, 480px)", maxHeight: 300, borderRadius: 7, background: "#15221b", objectFit: "contain" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={capturePhoto} disabled={disabled || isRecognizing} style={{ border: 0, borderRadius: 6, background: disabled || isRecognizing ? "#aab7af" : "#179c70", color: "#fff", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}>{isRecognizing ? "Recognizing text..." : "Capture & recognize"}</button>
            <button type="button" onClick={stopCamera} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close camera</button>
          </div>
        </div>
      )}

      {error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{error}</p>}
      {isRecognizing && <p role="status" aria-live="polite" style={{ margin: 0, color: "#17704e", fontSize: 12 }}>Reading product label and filling matching fields...</p>}
      {ocrResult && (
        <div aria-live="polite" style={{ display: "grid", gap: 5, padding: 10, borderRadius: 6, background: "#eff8f3" }}>
          <strong style={{ color: "#26352f", fontSize: 12 }}>Recognized text</strong>
          <p style={{ margin: 0, color: "#526158", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ocrResult.text || "No text found."}</p>
          <span style={{ color: "#77857d", fontSize: 11 }}>Review the fields below and correct any OCR mistakes before saving.</span>
        </div>
      )}
      {files.length > 0 && (
        <ul style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 10px", border: "1px solid #e5ebe6", borderRadius: 6, background: "#fff" }}>
              <span style={{ minWidth: 0, color: "#405248", fontSize: 12, overflowWrap: "anywhere" }}>{file.name} <span style={{ color: "#87938d" }}>({formatFileSize(file.size)})</span></span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))} disabled={disabled} style={{ flexShrink: 0, border: 0, background: "transparent", color: "#ad4b43", fontSize: 12, cursor: disabled ? "not-allowed" : "pointer" }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProductDocumentLinks({ documents }: { documents: ProductDocument[] }) {
  return (
    <ul style={{ display: "grid", gap: 7, margin: 0, padding: 0, listStyle: "none" }}>
      {documents.map((document) => (
        <li key={document.id}>
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault();
              const url = URL.createObjectURL(document.blob);
              const opened = window.open(url, "_blank");
              if (opened) {
                opened.opener = null;
              } else {
                const download = window.document.createElement("a");
                download.href = url;
                download.download = document.name;
                download.click();
              }
              window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }}
            style={{ color: "#17704e", fontSize: 12, overflowWrap: "anywhere" }}
          >
            {document.name}
          </a>
          <span style={{ marginLeft: 8, color: "#87938d", fontSize: 11 }}>{formatFileSize(document.size)}</span>
        </li>
      ))}
    </ul>
  );
}
