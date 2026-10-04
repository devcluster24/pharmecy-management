"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  extractProductDetails,
  reconcilePackPriceDetails,
  type ExtractedProductDetails,
} from "@/lib/ocr/extractProductDetails";
import { recognizeProductImage } from "@/lib/ocr/recognizeProductImage";
import { ProductDocumentOcr, type ProductDocumentOcrState } from "./ProductDocumentOcr";

const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/gif",
  "image/tiff",
]);
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i;
const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff,image/jpeg,image/png,image/webp,image/bmp,image/gif,image/tiff";

function isSupportedFile(file: File) {
  return ACCEPTED_MIME_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.test(file.name);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function ProductDocumentUpload({
  files,
  onFilesChange,
  companyNames,
  companyNamesError,
  genericNames,
  genericNamesError,
  onSaveProduct,
  disabled = false,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  companyNames: string[];
  companyNamesError: string;
  genericNames: string[];
  genericNamesError: string;
  onSaveProduct: (details: ExtractedProductDetails) => Promise<void>;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(false);
  const scanningRef = useRef(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0, fileName: "" });
  const [ocrState, setOcrState] = useState<ProductDocumentOcrState>();
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!cameraStream) return;
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
    return () => cameraStream.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  function closeCamera() {
    setCameraStream(null);
    setIsCameraReady(false);
  }

  function updateProductDetail(
    field: Exclude<keyof ExtractedProductDetails, "packSizeNumberSuggestions">,
    value: string,
    selectedSuggestion = false,
    calculatePrices = false,
  ) {
    setOcrState((current) => {
      const details = current?.extractedDetails;
      if (!current || !details) return current;
      const nextDetails = { ...details, [field]: value };
      const isPriceField = field === "packSize" || field === "unitPrice" || field === "packPrice";
      const calculatedPrices = calculatePrices || selectedSuggestion
        ? isPriceField
          ? reconcilePackPriceDetails(nextDetails, field)
          : nextDetails
        : nextDetails;
      return {
        ...current,
        extractedDetails: {
          ...details,
          ...calculatedPrices,
          packSizeNumberSuggestions: selectedSuggestion ? [] : details.packSizeNumberSuggestions,
        },
      };
    });
  }

  async function scanImage(file: File) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setIsScanning(true);
    setScanProgress({ completed: 0, total: 1, fileName: file.name });
    setOcrState({
      status: "Scanning image...",
      error: "",
      extractedDetails: null,
      qualityMessage: "",
    });

    try {
      const scan = await recognizeProductImage(file, (status) => {
        setScanProgress({ completed: 0, total: 1, fileName: `${file.name} — ${status}` });
      });
      if (!scan.result.items.some((item) => item.text.trim())) {
        throw new Error("No readable English/Latin text was found. Try a sharper, well-lit image.");
      }
      if (mountedRef.current) {
        setOcrState({
          status: `Finished scanning ${file.name}.`,
          error: "",
          extractedDetails: extractProductDetails(scan.result, companyNames, genericNames),
          qualityMessage: scan.averageConfidence < 0.55
            ? "OCR confidence is low. Review each suggested detail carefully; retake unclear images in better light."
            : scan.averageConfidence < 0.75
              ? "Some extracted values may be inaccurate. Review the suggested details carefully."
              : "",
        });
      }
    } catch (cause) {
      if (mountedRef.current) {
        setOcrState({
          status: "",
          error: cause instanceof Error ? cause.message : "Could not scan this image.",
          extractedDetails: null,
          qualityMessage: "",
        });
      }
    } finally {
      scanningRef.current = false;
      if (mountedRef.current) setIsScanning(false);
    }
  }

  async function openCamera() {
    setError("");
    setIsOpeningCamera(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is unavailable in this browser. Use localhost or a secure HTTPS connection.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setIsCameraReady(false);
      setCameraStream(stream);
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : "Could not open the camera.");
      }
    } finally {
      if (mountedRef.current) setIsOpeningCamera(false);
    }
  }

  function attachFile(file: File | undefined) {
    if (!file) return;
    if (files.length) {
      setError("Only one image can be scanned at a time. Remove the current image first.");
      return;
    }
    if (!isSupportedFile(file)) {
      setError(`${file.name}: choose a JPEG, PNG, WEBP, BMP, GIF, or TIFF image.`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(`${file.name}: the image must be 10 MB or smaller.`);
      return;
    }
    onFilesChange([file]);
    setError("");
    void scanImage(file);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    attachFile(selectedFile);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError("The camera is not ready yet. Please wait and try again.");
      return;
    }

    const scale = Math.min(1, 1600 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture a photo from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("Could not prepare the captured photo."));
        }, "image/jpeg", 0.88);
      });
      attachFile(new File([blob], `product-photo-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }));
      closeCamera();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the captured photo.");
    }
  }

  return (
    <section aria-label="Product documents" style={{ display: "grid", gap: 12, padding: "16px 24px", borderBottom: "1px solid #e9eeea", background: "#fbfcfb" }}>
      <div>
        <strong style={{ color: "#26352f", fontSize: 13 }}>Product images and documents</strong>
        <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 11 }}>Choose or capture one image (up to 10 MB). Scanning starts automatically; remove the image before choosing another.</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={selectFile}
          disabled={disabled || isScanning || Boolean(files.length)}
          style={{ display: "none" }}
        />
        <button type="button" onClick={() => void openCamera()} disabled={disabled || isScanning || isOpeningCamera || Boolean(cameraStream) || Boolean(files.length)} style={{ border: 0, borderRadius: 6, background: "#e7f5ee", color: "#17704e", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled || isScanning || isOpeningCamera || cameraStream || files.length ? "not-allowed" : "pointer", opacity: disabled || isScanning || isOpeningCamera || cameraStream || files.length ? 0.65 : 1 }}>
          {isOpeningCamera ? "Opening camera..." : "Open Camera"}
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || isScanning || Boolean(files.length)} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: disabled || isScanning || files.length ? "not-allowed" : "pointer" }}>
          Choose image
        </button>
      </div>
      {isScanning && (
        <p role="status" aria-live="polite" style={{ margin: 0, color: "#47715b", fontSize: 11 }}>
          {scanProgress.fileName ? `Scanning: ${scanProgress.fileName}` : "Preparing to scan image..."}
        </p>
      )}
      {cameraStream && (
        <div style={{ display: "grid", justifyItems: "start", gap: 8 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Camera preview"
            onLoadedMetadata={() => setIsCameraReady(true)}
            style={{ display: "block", width: "min(100%, 480px)", maxHeight: 300, borderRadius: 7, background: "#15221b", objectFit: "contain" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => void capturePhoto()} disabled={disabled || isScanning || !isCameraReady || Boolean(files.length)} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: disabled || isScanning || !isCameraReady || files.length ? "not-allowed" : "pointer", opacity: disabled || isScanning || !isCameraReady || files.length ? 0.65 : 1 }}>
              Capture photo
            </button>
            <button type="button" onClick={closeCamera} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Close camera
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>{error}</p>}
      {files.map((file) => (
        <div key={getFileKey(file)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#526158", fontSize: 12 }}>
          <span>{file.name} ({formatFileSize(file.size)})</span>
          <button type="button" onClick={() => {
            const remainingFiles = files.filter((item) => item !== file);
            onFilesChange(remainingFiles);
            setOcrState(undefined);
            setError("");
          }} disabled={disabled || isScanning} style={{ border: 0, background: "transparent", color: "#ad4b43", cursor: disabled || isScanning ? "not-allowed" : "pointer" }}>
            Remove
          </button>
        </div>
      ))}
      {ocrState && (
        <ProductDocumentOcr
          scanState={ocrState}
          companyNames={companyNames}
          companyNamesError={companyNamesError}
          genericNames={genericNames}
          genericNamesError={genericNamesError}
          onDetailsChange={(field, value) => updateProductDetail(field, value)}
          onDetailsBlur={(field, value) => updateProductDetail(field, value, false, true)}
          onPackSizeSelect={(packSize) => updateProductDetail("packSize", packSize, true)}
          onSaveProduct={onSaveProduct}
        />
      )}
    </section>
  );
}
