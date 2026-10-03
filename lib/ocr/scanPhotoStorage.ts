const DATABASE_NAME = "pharmacy-ocr-scan-cache";
const STORE_NAME = "scan-photos";
const SCAN_INDEX = "scanId";

type StoredScanPhoto = {
  id: string;
  scanId: string;
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support local scan-photo storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(SCAN_INDEX, SCAN_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local scan-photo storage."));
    request.onblocked = () => reject(new Error("Local scan-photo storage is blocked by another browser tab."));
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });

  return databasePromise;
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not store scan photos locally."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local scan-photo storage was interrupted."));
  });
}

export async function storeScanPhotos(scanId: string, files: File[]) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  files.forEach((file, index) => {
    const photo: StoredScanPhoto = {
      id: `${scanId}:${String(index).padStart(4, "0")}`,
      scanId,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      blob: file,
    };
    store.put(photo);
  });

  await waitForTransaction(transaction);
}

export async function getStoredScanPhotos(scanId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index(SCAN_INDEX).getAll(scanId) as IDBRequest<StoredScanPhoto[]>;
  const photos = await new Promise<StoredScanPhoto[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read locally stored scan photos."));
  });
  await waitForTransaction(transaction);

  return photos
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((photo) => new File([photo.blob], photo.name, {
      type: photo.type,
      lastModified: photo.lastModified,
    }));
}

export async function clearStoredScanPhotos(scanId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const index = transaction.objectStore(STORE_NAME).index(SCAN_INDEX);
  const request = index.openKeyCursor(IDBKeyRange.only(scanId));

  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
      cursor.continue();
    }
  };

  await waitForTransaction(transaction);
}
