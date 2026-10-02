export type ProductDocument = {
  id: string;
  productId: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  blob: Blob;
};

const DATABASE_NAME = "pharmacy-cluster-product-documents";
const STORE_NAME = "documents";
const PRODUCT_INDEX = "productId";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support local document storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(PRODUCT_INDEX, PRODUCT_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local document storage."));
    request.onblocked = () => reject(new Error("Local document storage is blocked by another browser tab. Close other tabs and retry."));
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });

  return databasePromise;
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local document storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local document storage was interrupted."));
  });
}

export async function saveProductDocuments(productId: string, files: File[]) {
  if (!files.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  for (const file of files) {
    const document: ProductDocument = {
      id: crypto.randomUUID(),
      productId,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      blob: file,
    };
    store.add(document);
  }

  await transactionComplete(transaction);
}

export async function getProductDocuments(productId: string): Promise<ProductDocument[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index(PRODUCT_INDEX).getAll(productId) as IDBRequest<ProductDocument[]>;
  const result = await new Promise<ProductDocument[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read locally saved documents."));
  });
  await transactionComplete(transaction);
  return result;
}

export async function deleteProductDocuments(productId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const index = transaction.objectStore(STORE_NAME).index(PRODUCT_INDEX);
  const request = index.openKeyCursor(IDBKeyRange.only(productId));

  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
      cursor.continue();
    }
  };

  await transactionComplete(transaction);
}
