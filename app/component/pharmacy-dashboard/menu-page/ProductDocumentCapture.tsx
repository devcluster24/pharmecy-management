"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { recognizeMultipleWithPaddleOcr, recognizeWithPaddleOcr } from "@/app/component/ocr/paddleOcrClient";
import { OCR_MAX_FILE_BYTES } from "@/app/component/ocr/constants";
import type { OcrResult } from "@/app/component/ocr/types";
import { extractProductInformation, extractProductInformationFromResults, type ProductInformation } from "@/lib/ocr/productInfoExtractor";
import { clearStoredScanPhotos, getStoredScanPhotos, storeScanPhotos } from "@/lib/ocr/scanPhotoStorage";
import type { ProductDocument } from "./productDocuments";

const SCAN_PHOTO_COUNT = 3;
const SCAN_PHOTO_INTERVAL_MS = 450;

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

function hasRecognizedText(results: OcrResult[]) {
  return results.some((result) => result.text.trim()
    || result.pages.some((page) => page.lines.some((line) => line.text.trim())));
}

function getFrameSignature(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not monitor the camera preview.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const signature = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < signature.length; index++) {
    const pixel = index * 4;
    signature[index] = Math.round((pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114) / 8);
  }
  return signature;
}

function getSignatureDifference(left: Uint8Array, right: Uint8Array) {
  let differentPixels = 0;
  for (let index = 0; index < left.length; index++) {
    if (Math.abs(left[index] - right[index]) >= 4) differentPixels++;
  }
  return differentPixels / left.length;
}

function createVideoFrame(video: HTMLVideoElement, name: string) {
  const scale = Math.min(1, 1280 / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Could not read a frame from the camera."));

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not prepare a camera frame for text recognition."));
        return;
      }
      resolve(new File([blob], name, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }));
    }, "image/jpeg", 0.85);
  });
}

export function ProductDocumentCapture({
  files,
  onFilesChange,
  onManualImport,
  onSaveProductInformation,
  saveError = "",
  disabled = false,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onManualImport: () => void;
  onSaveProductInformation: (information: ProductInformation) => Promise<void>;
  saveError?: string;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMountedRef = useRef(false);
  const completedFrameSignatureRef = useRef<Uint8Array | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [productInformation, setProductInformation] = useState<ProductInformation | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [capturedPhotoCount, setCapturedPhotoCount] = useState(0);
  const [isLiveScanEnabled, setIsLiveScanEnabled] = useState(false);
  const [isScanComplete, setIsScanComplete] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
    return () => cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    if (!cameraStream || !isLiveScanEnabled || disabled) return;

    let active = true;
    let timeout: number | undefined;

    async function scanNextFrame() {
      const video = videoRef.current;
      if (!video?.videoWidth || !video.videoHeight) {
        timeout = window.setTimeout(() => void scanNextFrame(), 250);
        return;
      }

      setIsRecognizing(true);
      setCapturedPhotoCount(0);
      setError("");
      let scanCompleted = false;
      try {
        const scanId = crypto.randomUUID();
        const photos: File[] = [];
        for (let index = 0; index < SCAN_PHOTO_COUNT; index++) {
          if (!active) return;
          if (index > 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, SCAN_PHOTO_INTERVAL_MS));
          }
          const currentVideo = videoRef.current;
          if (!currentVideo?.videoWidth || !currentVideo.videoHeight) {
            throw new Error("The camera stopped before all scan photos were captured.");
          }
          photos.push(await createVideoFrame(currentVideo, `scan-${scanId}-${index + 1}.jpg`));
          setCapturedPhotoCount(index + 1);
        }
        if (!active) return;

        await storeScanPhotos(scanId, photos);
        let result: OcrResult;
        try {
          const cachedPhotos = await getStoredScanPhotos(scanId);
          result = await recognizeMultipleWithPaddleOcr(cachedPhotos);
        } finally {
          await clearStoredScanPhotos(scanId);
        }
        if (!active) return;

        if (hasRecognizedText([result])) {
          const completedVideo = videoRef.current;
          if (completedVideo?.videoWidth && completedVideo.videoHeight) {
            completedFrameSignatureRef.current = getFrameSignature(completedVideo);
          }
          setProductInformation(extractProductInformation(result));
          setIsScanComplete(true);
          setIsLiveScanEnabled(false);
          scanCompleted = true;
        } else {
          setError("No text was recognized in these photos. Keep the label in view to retry.");
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not recognize text from the live camera.");
          setIsLiveScanEnabled(false);
        }
        return;
      } finally {
        if (active) setIsRecognizing(false);
      }

      if (active && !scanCompleted) timeout = window.setTimeout(() => void scanNextFrame(), 500);
    }

    void scanNextFrame();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (isMountedRef.current) setIsRecognizing(false);
    };
  }, [cameraStream, disabled, isLiveScanEnabled]);

  useEffect(() => {
    if (!cameraStream || !isScanComplete || !completedFrameSignatureRef.current || disabled) return;

    let timeout: number | undefined;
    let removedFrameSignature: Uint8Array | null = null;
    let removedFrameCount = 0;
    let returnedFrameCount = 0;

    function checkDocumentPresence() {
      const video = videoRef.current;
      const originalSignature = completedFrameSignatureRef.current;
      if (!video?.videoWidth || !video.videoHeight || !originalSignature) {
        timeout = window.setTimeout(checkDocumentPresence, 250);
        return;
      }

      try {
        const currentSignature = getFrameSignature(video);
        const referenceSignature = removedFrameSignature ?? originalSignature;
        const difference = getSignatureDifference(currentSignature, referenceSignature);

        if (!removedFrameSignature) {
          removedFrameCount = difference >= 0.38 ? removedFrameCount + 1 : 0;
          if (removedFrameCount >= 4) {
            removedFrameSignature = currentSignature;
            returnedFrameCount = 0;
          }
        } else {
          returnedFrameCount = difference >= 0.28 ? returnedFrameCount + 1 : 0;
          if (returnedFrameCount >= 2) {
            completedFrameSignatureRef.current = null;
            removedFrameSignature = null;
            setProductInformation(null);
            setIsScanComplete(false);
            setIsLiveScanEnabled(true);
            return;
          }
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not monitor the camera preview.");
      }

      timeout = window.setTimeout(checkDocumentPresence, 350);
    }

    timeout = window.setTimeout(checkDocumentPresence, 350);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [cameraStream, disabled, isScanComplete]);

  function addFiles(selectedFiles: File[]) {
    const supportedFiles = selectedFiles.filter(isSupportedFile);
    const rejectedCount = selectedFiles.length - supportedFiles.length;
    const newFiles = supportedFiles.filter((file, index) =>
      !files.some((existing) =>
        existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
      )
      && !supportedFiles.slice(0, index).some((existing) =>
        existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
      ),
    );
    setError(rejectedCount ? "Only JPG, PNG, WEBP, BMP, TIFF images and PDF documents are supported." : "");
    onFilesChange([...files, ...newFiles]);
    return newFiles;
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const newFiles = addFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
    if (newFiles.length) void recognizeSelectedDocuments(newFiles);
  }

  async function recognizeSelectedDocuments(selectedFiles: File[]) {
    const oversizedFile = selectedFiles.find((file) => file.size > OCR_MAX_FILE_BYTES);
    if (oversizedFile) {
      setError(`${oversizedFile.name} is larger than the 10 MB OCR file limit. The document was attached, but not scanned.`);
      return;
    }

    const scanId = crypto.randomUUID();
    setError("");
    setProductInformation(null);
    setIsRecognizing(true);
    try {
      await storeScanPhotos(scanId, selectedFiles);
      const storedFiles = await getStoredScanPhotos(scanId);
      const ocrResults: OcrResult[] = [];
      let batch: File[] = [];
      let batchSize = 0;

      async function recognizeBatch() {
        if (!batch.length) return;
        const result = batch.length === 1
          ? await recognizeWithPaddleOcr(batch[0])
          : await recognizeMultipleWithPaddleOcr(batch);
        ocrResults.push(result);
        batch = [];
        batchSize = 0;
      }

      for (const file of storedFiles) {
        if (batch.length === 3 || batchSize + file.size > OCR_MAX_FILE_BYTES) {
          await recognizeBatch();
        }
        batch.push(file);
        batchSize += file.size;
      }
      await recognizeBatch();

      if (!hasRecognizedText(ocrResults)) {
        setError("No text was recognized in the selected documents.");
        return;
      }
      setProductInformation(extractProductInformationFromResults(ocrResults));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not scan the selected documents.");
    } finally {
      try {
        await clearStoredScanPhotos(scanId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not clear temporary document copies.");
      }
      setIsRecognizing(false);
    }
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
        completedFrameSignatureRef.current = null;
        setProductInformation(null);
        setIsScanComplete(false);
        setIsLiveScanEnabled(true);
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

  function stopCamera() {
    setIsLiveScanEnabled(false);
    setIsScanComplete(false);
    setIsRecognizing(false);
    setCameraStream(null);
  }

  return (
    <section aria-label="Product documents" style={{ display: "grid", gap: 12, padding: "16px 24px", borderBottom: "1px solid #e9eeea", background: "#fbfcfb" }}>
      <div>
        <strong style={{ color: "#26352f", fontSize: 13 }}>Product images and documents</strong>
        <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 11 }}>Choose product images or documents to recognize all visible text, or scan live with the camera. Selected documents are temporarily stored in this browser and scanned automatically; temporary copies are removed after processing.</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          onChange={selectFiles}
          disabled={disabled || isRecognizing}
          style={{ display: "none" }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || isRecognizing} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}>
          {isRecognizing ? "Scanning documents..." : "Choose documents"}
        </button>
        <button type="button" onClick={onManualImport} disabled={disabled || isRecognizing} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}>
          Add Manual Import
        </button>
        {!cameraStream && (
          <button type="button" onClick={() => void openCamera()} disabled={disabled} style={{ border: 0, borderRadius: 6, background: "#e7f5ee", color: "#17704e", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled ? "not-allowed" : "pointer" }}>
            Open camera scanner
          </button>
        )}
      </div>

      {cameraStream && (
        <div style={{ display: "grid", justifyItems: "start", gap: 8 }}>
          <div style={{ position: "relative", width: "min(100%, 480px)", overflow: "hidden", borderRadius: 7, background: "#15221b" }}>
            <video ref={videoRef} autoPlay playsInline aria-label="Camera preview" style={{ display: "block", width: "100%", maxHeight: 300, objectFit: "contain" }} />
            {isLiveScanEnabled && (
              <>
                <style>{`@keyframes pharmacy-ocr-scan-line { from { top: 0; } to { top: calc(100% - 2px); } }`}</style>
                <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, height: 2, background: "#3cffae", boxShadow: "0 0 12px 3px rgba(60, 255, 174, 0.65)", animation: "pharmacy-ocr-scan-line 1.8s ease-in-out infinite alternate", pointerEvents: "none" }} />
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!isLiveScanEnabled && !isScanComplete && (
              <button type="button" onClick={() => { setError(""); setIsLiveScanEnabled(true); }} disabled={disabled} style={{ border: 0, borderRadius: 6, background: disabled ? "#aab7af" : "#179c70", color: "#fff", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled ? "not-allowed" : "pointer" }}>
                Resume live scan
              </button>
            )}
            {isLiveScanEnabled && !isScanComplete && (
              <button type="button" onClick={() => setIsLiveScanEnabled(false)} disabled={disabled} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer" }}>
                Pause scan
              </button>
            )}
            <button type="button" onClick={stopCamera} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close camera</button>
          </div>
        </div>
      )}

      {error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{error}</p>}
      {isRecognizing && !cameraStream && <p role="status" aria-live="polite" style={{ margin: 0, color: "#17704e", fontSize: 12 }}>Saving selected documents locally and recognizing text...</p>}
      {cameraStream && isLiveScanEnabled && <p role="status" aria-live="polite" style={{ margin: 0, color: "#17704e", fontSize: 12 }}>{isRecognizing ? capturedPhotoCount < SCAN_PHOTO_COUNT ? `Capturing scan photos (${capturedPhotoCount}/${SCAN_PHOTO_COUNT})...` : `Sending ${SCAN_PHOTO_COUNT} scan photos to OCR...` : "Live scanning is active. Keep the product label in view."}</p>}
      {cameraStream && isScanComplete && <p role="status" aria-live="polite" style={{ margin: 0, color: "#17704e", fontSize: 12 }}>Scan complete. Remove the product completely from the camera view, then show it again to scan another one.</p>}
      {productInformation && (
        <section aria-label="Extracted product information" style={{ display: "grid", gap: 10, padding: 12, border: "1px solid #dce5df", borderRadius: 6, background: "#fff" }}>
          <strong style={{ color: "#26352f", fontSize: 13 }}>Extracted product information</strong>
          {([
            ["pharmaceuticalCompany", "Pharmaceutical Company"],
            ["brandName", "Brand Name"],
            ["genericName", "Generic Name"],
            ["strength", "Strength"],
            ["dosageFormDescription", "Dosage Form / Description"],
            ["retailPrice", "Retail Price"],
          ] as const).map(([label, value]) => (
            <label key={label} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.4fr) minmax(0, 1fr)", alignItems: "center", gap: 10, color: "#405248", fontSize: 12, fontWeight: 600 }}>
              {value}
              <input
                value={productInformation[label] ?? ""}
                onChange={(event) => {
                  const inputValue = event.currentTarget.value;
                  setProductInformation((current) => current
                    ? { ...current, [label]: inputValue }
                    : current);
                }}
                placeholder="Not detected"
                disabled={disabled}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "8px 9px", color: "#26352f", fontSize: 12 }}
              />
            </label>
          ))}
          {saveError && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{saveError}</p>}
          {(!productInformation.brandName?.trim() || !productInformation.pharmaceuticalCompany?.trim()) && (
            <p style={{ margin: 0, color: "#77857d", fontSize: 11 }}>Pharmaceutical Company and Brand Name are required to save.</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => { if (productInformation) void onSaveProductInformation(productInformation); }}
              disabled={disabled || isRecognizing || !productInformation.brandName?.trim() || !productInformation.pharmaceuticalCompany?.trim()}
              style={{ border: 0, borderRadius: 6, background: disabled || isRecognizing ? "#aab7af" : "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: disabled || isRecognizing ? "not-allowed" : "pointer" }}
            >
              {disabled ? "Saving product..." : "Save product"}
            </button>
          </div>
        </section>
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
