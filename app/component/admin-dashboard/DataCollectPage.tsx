"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import AdminDashboardShell from "./AdminDashboardShell";

type ProductRecord = {
  id: string;
  brandName: string;
  genericName: string;
  companyManufacturer: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
  sourceUrl: string;
  collectedAt: string;
};

type CollectionProgress = {
  startUrl: string;
  listingUrl: string;
  visitedListingUrls: string[];
  totalListingPages?: number;
  skippedListingUrls?: string[];
  skippedProductCount?: number;
};

type ActivePageProgress = {
  pageNumber: number;
  totalProducts: number;
  processedProducts: number;
};

type MedexPage = {
  html: string;
  finalUrl: string;
};

type ProductStorageManifest = {
  version: number;
  recordCount: number;
  chunkCount: number;
};

class ProductPageRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProductPageRequestError";
  }
}

class ProductCollectionAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductCollectionAccessError";
  }
}

const PRODUCT_STORAGE_KEY = "pharmecy-medex-collected-products";
const PRODUCT_CHUNK_SIZE = 250;
const PROGRESS_STORAGE_KEY = "pharmecy-medex-collection-progress";
const MAX_UNKNOWN_LISTING_PAGE_FAILURES = 3;

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  fontSize: 13,
};

const buttonStyle = {
  border: 0,
  borderRadius: 6,
  padding: "10px 15px",
  background: "#18845d",
  color: "#fff",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
};

function normalizeListingUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid supported product listing page URL.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname !== "medex.com.bd" ||
    url.pathname !== "/brands" ||
    url.username ||
    url.password
  ) {
    throw new Error("This listing page is not supported. Enter a valid product listing URL.");
  }

  url.protocol = "https:";
  url.hash = "";
  return url.href;
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function createDom(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

function isCollectionProgress(value: unknown): value is CollectionProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.startUrl === "string" &&
    typeof candidate.listingUrl === "string" &&
    Array.isArray(candidate.visitedListingUrls) &&
    candidate.visitedListingUrls.every((url) => typeof url === "string");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function compressJson(value: unknown) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support compressed local storage. Update to a current browser and try again.");
  }
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return `gzip:${bytesToBase64(compressed)}`;
}

async function readStoredJson<T>(key: string, fallback: T): Promise<T> {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  if (!stored.startsWith("gzip:")) return JSON.parse(stored) as T;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open the compressed saved data. Update to a current browser.");
  }

  const binary = atob(stored.slice(5));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as T;
}

function getListingProducts(document: Document, pageUrl: string) {
  const page = new URL(pageUrl);
  const links = new Set<string>();

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/brands/"]')) {
    const url = new URL(anchor.getAttribute("href") ?? anchor.href, page);
    if (
      url.hostname === "medex.com.bd" &&
      /^\/brands\/\d+\/[a-z0-9-]+$/i.test(url.pathname)
    ) {
      url.protocol = "https:";
      url.search = "";
      url.hash = "";
      links.add(url.href);
    }
  }

  return [...links];
}

function getNextListingPage(document: Document, currentPageUrl: string) {
  const current = new URL(currentPageUrl);
  const currentPage = Number(current.searchParams.get("page") ?? "1");
  const candidates = new Map<number, string>();

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="page="]')) {
    const url = new URL(anchor.getAttribute("href") ?? anchor.href, current);
    const pageNumber = Number(url.searchParams.get("page"));
    if (
      url.hostname !== "medex.com.bd" ||
      url.pathname !== "/brands" ||
      !Number.isInteger(pageNumber) ||
      pageNumber <= currentPage
    ) {
      continue;
    }

    url.protocol = "https:";
    candidates.set(pageNumber, url.href);
  }

  const nextPage = Math.min(...candidates.keys());
  return Number.isFinite(nextPage) ? candidates.get(nextPage) ?? null : null;
}

function getTotalListingPages(document: Document, currentPageUrl: string) {
  const current = new URL(currentPageUrl);
  let totalPages = Number(current.searchParams.get("page") ?? "1");

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="page="]')) {
    const url = new URL(anchor.getAttribute("href") ?? anchor.href, current);
    const pageNumber = Number(url.searchParams.get("page"));
    if (url.hostname === "medex.com.bd" && url.pathname === "/brands" && Number.isInteger(pageNumber)) {
      totalPages = Math.max(totalPages, pageNumber);
    }
  }

  return totalPages;
}

function getPageNumber(url: string) {
  return Number(new URL(url).searchParams.get("page") ?? "1");
}

function getNextListingPageAfterFailure(currentPageUrl: string) {
  const next = new URL(currentPageUrl);
  next.protocol = "https:";
  next.searchParams.set("page", String(getPageNumber(currentPageUrl) + 1));
  return next.href;
}

function getBrandName(document: Document) {
  const heading = document.querySelector<HTMLElement>(".brand-header h1.page-heading-1-l.brand");
  if (!heading) return "";
  const clonedHeading = heading.cloneNode(true) as HTMLElement;
  clonedHeading.querySelectorAll("small").forEach((element) => element.remove());
  return cleanText(clonedHeading.textContent);
}

function getProductRecords(document: Document, sourceUrl: string, firstId: number): ProductRecord[] {
  const brandName = getBrandName(document);
  const header = document.querySelector(".brand-header");
  const genericName = cleanText(header?.querySelector('[title="Generic Name"]')?.textContent) || "-";
  const companyManufacturer = cleanText(
    header?.querySelector('[title="Manufactured by"] a')?.textContent,
  ) || "-";
  const strength = cleanText(header?.querySelector('[title="Strength"]')?.textContent) || "-";
  const dosageForm = cleanText(
    document.querySelector(".brand-header h1.page-heading-1-l.brand small[title='Dosage Form']")?.textContent,
  ) || "-";

  const packageContainers = [...document.querySelectorAll<HTMLElement>(".packages-wrapper .package-container")];
  const packages = packageContainers.length > 0 ? packageContainers : [null];

  return packages.map((container, index) => {
    const unitPriceLabel = container
      ? [...container.querySelectorAll<HTMLElement>("span")]
        .find((element) => cleanText(element.textContent).toLowerCase() === "unit price:")
      : null;
    const unitPrice = cleanText(unitPriceLabel?.nextElementSibling?.textContent) || "-";
    const packInfo = cleanText(container?.querySelector(".pack-size-info")?.textContent)
      .replace(/^\(|\)$/g, "");
    const separator = packInfo.indexOf(":");
    const packSize = (separator >= 0 ? cleanText(packInfo.slice(0, separator)) : packInfo) || "-";
    const packPrice = (separator >= 0 ? cleanText(packInfo.slice(separator + 1)) : "") || "-";

    return {
      id: `MED-${String(firstId + index).padStart(7, "0")}`,
      brandName: brandName || "-",
      genericName,
      companyManufacturer,
      strength,
      dosageForm,
      packSize,
      unitPrice,
      packPrice,
      sourceUrl,
      collectedAt: new Date().toISOString(),
    };
  });
}

function createMissingProductRecord(sourceUrl: string, idNumber: number): ProductRecord {
  return {
    id: `MED-${String(idNumber).padStart(7, "0")}`,
    brandName: "-",
    genericName: "-",
    companyManufacturer: "-",
    strength: "-",
    dosageForm: "-",
    packSize: "-",
    unitPrice: "-",
    packPrice: "-",
    sourceUrl,
    collectedAt: new Date().toISOString(),
  };
}

function getNextId(records: ProductRecord[]) {
  return records.reduce((max, record) => {
    const match = /^MED-(\d+)$/i.exec(record.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

async function saveLocalState(records: ProductRecord[], progress: CollectionProgress | null) {
  const manifestValue = localStorage.getItem(PRODUCT_STORAGE_KEY);
  let manifest: ProductStorageManifest | null = null;
  if (manifestValue) {
    try {
      const parsed: unknown = JSON.parse(manifestValue);
      if (
        parsed &&
        typeof parsed === "object" &&
        "version" in parsed &&
        parsed.version === 1 &&
        "recordCount" in parsed &&
        typeof parsed.recordCount === "number" &&
        "chunkCount" in parsed &&
        typeof parsed.chunkCount === "number"
      ) {
        manifest = parsed as ProductStorageManifest;
      }
    } catch {
      // A prior release may have stored the whole product list directly.
    }
  }

  const persistedCount = manifest?.recordCount ?? 0;
  if (records.length < persistedCount) {
    throw new Error("Saved collection data changed unexpectedly. Reload the page before continuing.");
  }

  let chunksWritten = 0;
  const startingChunkIndex = Math.floor(persistedCount / PRODUCT_CHUNK_SIZE);
  const chunkStart = startingChunkIndex * PRODUCT_CHUNK_SIZE;
  const unpersistedRecords = records.slice(chunkStart);
  for (let offset = 0; offset < unpersistedRecords.length; offset += PRODUCT_CHUNK_SIZE) {
    const chunk = unpersistedRecords.slice(offset, offset + PRODUCT_CHUNK_SIZE);
    localStorage.setItem(
      `${PRODUCT_STORAGE_KEY}:chunk:${startingChunkIndex + chunksWritten}`,
      await compressJson(chunk),
    );
    chunksWritten++;
  }

  const chunkCount = Math.max(Math.ceil(records.length / PRODUCT_CHUNK_SIZE), manifest?.chunkCount ?? 0);
  localStorage.setItem(
    PRODUCT_STORAGE_KEY,
    JSON.stringify({ version: 1, recordCount: records.length, chunkCount }),
  );
  const savedProgress = progress ? await compressJson(progress) : null;
  if (savedProgress) {
    localStorage.setItem(PROGRESS_STORAGE_KEY, savedProgress);
  } else {
    localStorage.removeItem(PROGRESS_STORAGE_KEY);
  }
}

function escapeCsvCell(value: string) {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

async function fetchMedexPage(url: string, signal: AbortSignal): Promise<MedexPage> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new ProductCollectionAccessError(error.message);
  if (!session) throw new ProductCollectionAccessError("Sign in again before collecting product data.");

  const response = await fetch(`/api/data-collect/medex?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal,
    cache: "no-store",
  });

  const payload = await response.json() as MedexPage & { error?: string };
  if (!response.ok) {
    if ([401, 403, 503].includes(response.status)) {
      throw new ProductCollectionAccessError(
        payload.error ?? "Product collection is unavailable because server access or configuration failed.",
      );
    }
    throw new ProductPageRequestError(
      payload.error ?? `Could not load the product page (HTTP ${response.status}).`,
      response.status,
    );
  }
  if (typeof payload.html !== "string" || typeof payload.finalUrl !== "string") {
    throw new Error("The product data service returned an invalid page.");
  }
  return payload;
}

export default function DataCollectPage() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [progress, setProgress] = useState<CollectionProgress | null>(null);
  const [activePageProgress, setActivePageProgress] = useState<ActivePageProgress | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [hasSavedData, setHasSavedData] = useState(false);
  const [status, setStatus] = useState("");
  const stopRequested = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const productsRef = useRef<ProductRecord[]>([]);
  const progressRef = useRef<CollectionProgress | null>(null);
  const nextIdRef = useRef(1);
  const totalListingPages = progress?.totalListingPages ?? 0;
  const completedListingPages = Math.min(progress?.visitedListingUrls.length ?? 0, totalListingPages);
  const activePageFraction = activePageProgress
    ? activePageProgress.processedProducts / activePageProgress.totalProducts
    : 0;
  const progressPercent = totalListingPages
    ? Math.min(100, Math.round(((completedListingPages + activePageFraction) / totalListingPages) * 100))
    : 0;

  useEffect(() => {
    let active = true;

    async function loadSavedData() {
      try {
        setHasSavedData(
          localStorage.getItem(PRODUCT_STORAGE_KEY) !== null ||
          localStorage.getItem(PROGRESS_STORAGE_KEY) !== null ||
          Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .some((key) => key?.startsWith(`${PRODUCT_STORAGE_KEY}:chunk:`)),
        );
        const productManifestValue = localStorage.getItem(PRODUCT_STORAGE_KEY);
        let parsedProducts: unknown;
        let productManifest: ProductStorageManifest | null = null;
        if (productManifestValue) {
          try {
            const manifest: unknown = JSON.parse(productManifestValue);
            if (
              manifest &&
              typeof manifest === "object" &&
              "version" in manifest &&
              manifest.version === 1 &&
              "recordCount" in manifest &&
              typeof manifest.recordCount === "number" &&
              Number.isInteger(manifest.recordCount) &&
              manifest.recordCount >= 0 &&
              "chunkCount" in manifest &&
              typeof manifest.chunkCount === "number" &&
              Number.isInteger(manifest.chunkCount) &&
              manifest.chunkCount >= 0
            ) {
              productManifest = manifest as ProductStorageManifest;
            }
          } catch {
            // A prior release may have stored the whole product list directly.
          }
        }

        if (productManifest) {
          const productChunks = await Promise.all(
            Array.from({ length: productManifest.chunkCount }, (_, index) =>
              readStoredJson<unknown>(`${PRODUCT_STORAGE_KEY}:chunk:${index}`, []),
            ),
          );
          parsedProducts = productChunks.flat();
          if ((parsedProducts as unknown[]).length !== productManifest.recordCount) {
            throw new Error("Saved product data is incomplete. Export is unavailable until the browser data is restored.");
          }
        } else {
          const [legacyProducts] = await Promise.all([
            readStoredJson<unknown>(PRODUCT_STORAGE_KEY, []),
          ]);
          parsedProducts = legacyProducts;
        }
        const parsedProgress = await readStoredJson<unknown>(PROGRESS_STORAGE_KEY, null);

        if (
          !Array.isArray(parsedProducts) ||
          parsedProducts.some((record) => !record || typeof record.id !== "string")
        ) {
          throw new Error("Saved product data is invalid. Export or clear the browser storage before continuing.");
        }
        if (parsedProgress !== null && !isCollectionProgress(parsedProgress)) {
          throw new Error("Saved collection progress is invalid. Remove the saved progress and start again.");
        }

        const savedProducts = parsedProducts as ProductRecord[];
        const savedProgress = parsedProgress as CollectionProgress | null;
        productsRef.current = savedProducts;
        progressRef.current = savedProgress;
        nextIdRef.current = getNextId(savedProducts);
        if (active) {
          setProducts(savedProducts);
          setProgress(savedProgress);
          setHasSavedData(savedProducts.length > 0 || savedProgress !== null);
          setStatus(savedProducts.length ? `${savedProducts.length.toLocaleString()} product package(s) saved in this browser.` : "");
          setStorageReady(true);
        }
      } catch (error) {
        if (active) {
          setHasSavedData(
            localStorage.getItem(PRODUCT_STORAGE_KEY) !== null ||
            localStorage.getItem(PROGRESS_STORAGE_KEY) !== null ||
            Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
              .some((key) => key?.startsWith(`${PRODUCT_STORAGE_KEY}:chunk:`)),
          );
          setStatus(error instanceof Error ? error.message : "Could not read saved browser data.");
        }
      }
    }

    void loadSavedData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function persist(records: ProductRecord[], nextProgress: CollectionProgress | null) {
    await saveLocalState(records, nextProgress);
    productsRef.current = records;
    progressRef.current = nextProgress;
    setProducts(records);
    setProgress(nextProgress);
  }

  async function startCollection() {
    if (!storageReady) {
      setStatus("Saved browser data is not ready. Resolve the storage message before starting a collection.");
      return;
    }

    let normalizedSource: string;
    try {
      normalizedSource = normalizeListingUrl(sourceUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Enter a valid product listing URL.");
      return;
    }

    stopRequested.current = false;
    setIsCollecting(true);
    setStatus("Starting product collection...");

    let currentProgress = progressRef.current?.startUrl === normalizedSource
      && progressRef.current.listingUrl
      ? progressRef.current
      : { startUrl: normalizedSource, listingUrl: normalizedSource, visitedListingUrls: [] };

    try {
      await persist(productsRef.current, currentProgress);
      const collectedDetailUrls = new Set(productsRef.current.map((record) => record.sourceUrl));
      let totalProductsAdded = 0;
      let skippedProductCount = currentProgress.skippedProductCount ?? 0;
      let consecutiveListingFailures = 0;

      while (currentProgress.listingUrl && !stopRequested.current) {
        const listingUrl = currentProgress.listingUrl;
        setStatus(`Reading listing page ${new URL(listingUrl).searchParams.get("page") ?? "1"}...`);
        const listingController = new AbortController();
        activeRequest.current = listingController;
        let listing: MedexPage;
        try {
          listing = await fetchMedexPage(listingUrl, listingController.signal);
        } catch (error) {
          if (stopRequested.current) break;
          if (error instanceof ProductCollectionAccessError) {
            throw error;
          }

          consecutiveListingFailures++;
          const pageNumber = getPageNumber(listingUrl);
          const totalPages = currentProgress.totalListingPages ?? 0;
          const nextListingUrl = totalPages > 0
            ? pageNumber < totalPages ? getNextListingPageAfterFailure(listingUrl) : ""
            : consecutiveListingFailures < MAX_UNKNOWN_LISTING_PAGE_FAILURES
              ? getNextListingPageAfterFailure(listingUrl)
              : "";
          currentProgress = {
            ...currentProgress,
            listingUrl: nextListingUrl,
            visitedListingUrls: [...new Set([...currentProgress.visitedListingUrls, listingUrl])],
            skippedListingUrls: [...new Set([...(currentProgress.skippedListingUrls ?? []), listingUrl])],
            skippedProductCount,
          };
          setActivePageProgress(null);
          await persist(productsRef.current, currentProgress);

          if (nextListingUrl) {
            setStatus(`Could not read listing page ${pageNumber}; skipped it and continuing to the next page.`);
            continue;
          }

          const skippedPages = currentProgress.skippedListingUrls?.length ?? 0;
          const summary = skippedProductCount
            ? ` ${skippedProductCount.toLocaleString()} product(s) also had no readable data.`
            : "";
          setStatus(
            `Collection finished. ${productsRef.current.length.toLocaleString()} package(s) saved; ${skippedPages.toLocaleString()} listing page(s) skipped.${summary}`,
          );
          return;
        }
        if (stopRequested.current) break;
        if (currentProgress.visitedListingUrls.includes(listing.finalUrl)) {
          throw new Error("Pagination returned to a listing page that was already collected.");
        }
        consecutiveListingFailures = 0;

        const listingDocument = createDom(listing.html);
        const productUrls = getListingProducts(listingDocument, listing.finalUrl);
        currentProgress = {
          ...currentProgress,
          totalListingPages: Math.max(
            currentProgress.totalListingPages ?? 0,
            getTotalListingPages(listingDocument, listing.finalUrl),
          ),
        };
        setActivePageProgress(productUrls.length ? {
          pageNumber: Number(new URL(listing.finalUrl).searchParams.get("page") ?? "1"),
          totalProducts: productUrls.length,
          processedProducts: 0,
        } : null);
        await persist(productsRef.current, currentProgress);
        if (!productUrls.length) {
          setStatus("No products found on this listing page; continuing to the next page.");
        }

        for (let index = 0; index < productUrls.length; index++) {
          if (stopRequested.current) break;
          setActivePageProgress({
            pageNumber: Number(new URL(listing.finalUrl).searchParams.get("page") ?? "1"),
            totalProducts: productUrls.length,
            processedProducts: index,
          });
          const productUrl = productUrls[index];
          if (collectedDetailUrls.has(productUrl)) {
            setActivePageProgress({
              pageNumber: Number(new URL(listing.finalUrl).searchParams.get("page") ?? "1"),
              totalProducts: productUrls.length,
              processedProducts: index + 1,
            });
            continue;
          }

          setStatus(
            `Listing page ${new URL(listingUrl).searchParams.get("page") ?? "1"} · Product ${index + 1}/${productUrls.length} · ${totalProductsAdded.toLocaleString()} new package(s)`,
          );
          const detailController = new AbortController();
          activeRequest.current = detailController;
          let records: ProductRecord[];
          try {
            const detail = await fetchMedexPage(productUrl, detailController.signal);
            if (stopRequested.current) break;
            records = getProductRecords(createDom(detail.html), detail.finalUrl, nextIdRef.current);
          } catch (error) {
            if (stopRequested.current) break;
            if (error instanceof ProductCollectionAccessError) {
              throw error;
            }
            if (error instanceof ProductPageRequestError) {
              console.warn(`Skipping product page after HTTP ${error.status}: ${productUrl}`);
            } else {
              console.warn(`Skipping product page that could not be read: ${productUrl}`, error);
            }
            records = [createMissingProductRecord(productUrl, nextIdRef.current)];
            skippedProductCount++;
            setStatus(`Product ${index + 1} had no readable data; saved "-" values and continuing.`);
          }
          nextIdRef.current += records.length;
          const updatedRecords = [...productsRef.current, ...records];
          productsRef.current = updatedRecords;
          setProducts(updatedRecords);
          collectedDetailUrls.add(productUrl);
          totalProductsAdded += records.length;
          await persist(updatedRecords, currentProgress);
          setActivePageProgress({
            pageNumber: Number(new URL(listing.finalUrl).searchParams.get("page") ?? "1"),
            totalProducts: productUrls.length,
            processedProducts: index + 1,
          });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        }

        if (stopRequested.current) {
          await persist(productsRef.current, currentProgress);
          break;
        }
        const nextListingUrl = getNextListingPage(listingDocument, listing.finalUrl);
        const visitedListingUrls = [...new Set([...currentProgress.visitedListingUrls, listing.finalUrl])];
        currentProgress = {
          ...currentProgress,
          listingUrl: nextListingUrl ?? "",
          visitedListingUrls,
          skippedProductCount,
        };
        setActivePageProgress(null);
        await persist(productsRef.current, currentProgress);

        if (!nextListingUrl) {
          const skippedPages = currentProgress.skippedListingUrls?.length ?? 0;
          const skippedSummary = skippedProductCount
            ? ` ${skippedProductCount.toLocaleString()} product page(s) had no readable data and were saved with "-".`
            : "";
          const skippedPageSummary = skippedPages
            ? ` ${skippedPages.toLocaleString()} listing page(s) were skipped.`
            : "";
          setStatus(`Collection complete: ${totalProductsAdded.toLocaleString()} new package(s) collected; ${productsRef.current.length.toLocaleString()} saved.${skippedPageSummary}${skippedSummary}`);
          return;
        }
      }

      setStatus(
        `Collection stopped. ${productsRef.current.length.toLocaleString()} package(s) are saved in this browser. Press Import Data to resume.`,
      );
    } catch (error) {
      try {
        await persist(productsRef.current, currentProgress);
      } catch (storageError) {
        setStatus(storageError instanceof Error ? storageError.message : "Could not save the collected data to this browser.");
        setIsCollecting(false);
        return;
      }
      if (stopRequested.current && error instanceof Error && error.name === "AbortError") {
        setStatus(`Collection stopped. ${productsRef.current.length.toLocaleString()} package(s) are saved in this browser. Press Import Data to resume.`);
      } else {
        setStatus(error instanceof Error ? error.message : "Product collection failed.");
      }
    } finally {
      activeRequest.current = null;
      setIsCollecting(false);
    }
  }

  function stopCollection() {
    stopRequested.current = true;
    activeRequest.current?.abort();
  }

  function clearSavedData() {
    if (isCollecting) return;
    if (!window.confirm("Clear all product data and collection progress saved in this browser?")) return;

    try {
      const chunkKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null && key.startsWith(`${PRODUCT_STORAGE_KEY}:chunk:`));
      chunkKeys.forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem(PRODUCT_STORAGE_KEY);
      localStorage.removeItem(PROGRESS_STORAGE_KEY);

      productsRef.current = [];
      progressRef.current = null;
      nextIdRef.current = 1;
      setProducts([]);
      setProgress(null);
      setActivePageProgress(null);
      setHasSavedData(false);
      setStatus("All locally saved product data and collection progress have been cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear locally saved product data.");
    }
  }

  function exportCsv() {
    const columns: { key: keyof ProductRecord; label: string }[] = [
      { key: "id", label: "ID Number" },
      { key: "brandName", label: "Brand Name" },
      { key: "genericName", label: "Generic Name" },
      { key: "companyManufacturer", label: "Company / Manufacturer" },
      { key: "strength", label: "Strength" },
      { key: "dosageForm", label: "Dosage Form" },
      { key: "packSize", label: "Pack Size" },
      { key: "unitPrice", label: "Unit Price" },
      { key: "packPrice", label: "Pack Price" },
    ];
    const csv = [
      columns.map((column) => escapeCsvCell(column.label)).join(","),
      ...products.map((record) => columns.map((column) => escapeCsvCell(record[column.key] ?? "")).join(",")),
    ].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `product-data-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>
            Data Collect
          </h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>
            Collect medicine product details from a listing page and save them in this browser.
          </p>
        </div>

        <section aria-label="Product data collection" style={{ maxWidth: 900, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Product data</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>
              Each listing page is checked once; product detail pages are opened one at a time, then collection continues to the next listing page.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12, padding: 18 }}>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>
              Listing page URL
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                disabled={isCollecting}
                style={fieldStyle}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <button type="button" onClick={() => void startCollection()} disabled={isCollecting || !storageReady} style={{ ...buttonStyle, opacity: isCollecting || !storageReady ? 0.55 : 1 }}>
                {progress?.startUrl === sourceUrl && progress.listingUrl ? "Resume Import" : "Import Data"}
              </button>
              {isCollecting && (
                <button type="button" onClick={stopCollection} style={{ ...buttonStyle, background: "#fff", border: "1px solid #e3bcbc", color: "#a13d3d" }}>
                  Stop
                </button>
              )}
              <button type="button" onClick={exportCsv} disabled={!storageReady || !products.length} style={{ ...buttonStyle, background: "#fff", border: "1px solid #dce5df", color: "#267451", opacity: storageReady && products.length ? 1 : 0.5 }}>
                Export CSV ({products.length.toLocaleString()})
              </button>
              <button type="button" onClick={clearSavedData} disabled={isCollecting || !hasSavedData} style={{ ...buttonStyle, background: "#fff", border: "1px solid #e3bcbc", color: "#a13d3d", opacity: !isCollecting && hasSavedData ? 1 : 0.5 }}>
                Clear Data
              </button>
            </div>

            {(progress || isCollecting) && (
              <div aria-label="Collection progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progressPercent} role="progressbar">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, color: "#68776f", fontSize: 11 }}>
                  <span>
                    {activePageProgress
                      ? `Page ${activePageProgress.pageNumber} of ${totalListingPages.toLocaleString()} · Product ${Math.min(activePageProgress.processedProducts + (isCollecting ? 1 : 0), activePageProgress.totalProducts).toLocaleString()} of ${activePageProgress.totalProducts.toLocaleString()}`
                      : `${completedListingPages.toLocaleString()} of ${totalListingPages.toLocaleString()} pages collected`}
                  </span>
                  <strong style={{ color: "#267451" }}>{progressPercent}%</strong>
                </div>
                <div style={{ height: 9, overflow: "hidden", borderRadius: 99, background: "#e8eee9" }}>
                  <div style={{ width: `${progressPercent}%`, height: "100%", borderRadius: 99, background: "#18845d", transition: "width 180ms ease" }} />
                </div>
              </div>
            )}

            <div aria-live="polite" role="status" style={{ minHeight: 18, color: /failed|Could not|invalid|HTTP \d|unsupported/i.test(status) ? "#a13d3d" : "#68776f", fontSize: 11 }}>
              {status}
            </div>

            <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f5f8f5", color: "#68776f", fontSize: 10, lineHeight: 1.6 }}>
              {products.length.toLocaleString()} product package(s) saved in this browser. Collected fields: Brand Name, Generic Name, Company / Manufacturer, Strength, Dosage Form, Pack Size, Unit Price and Pack Price.
            </div>
          </div>
        </section>
      </main>
    </AdminDashboardShell>
  );
}
