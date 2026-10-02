export type AnalyticsProductRecord = {
  id: string;
  [field: string]: string;
};

const databaseName = "pharmacy-cluster-admin-analytics";
const databaseVersion = 1;
const productStoreName = "products";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(productStoreName)) {
          database.createObjectStore(productStoreName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the local product database."));
      request.onblocked = () => reject(new Error("The local product database is busy in another tab. Close other app tabs and retry."));
    });
  }
  return databasePromise;
}

export async function loadAnalyticsProducts<T extends AnalyticsProductRecord>() {
  const database = await openDatabase();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = database.transaction(productStoreName, "readonly");
    const request = transaction.objectStore(productStoreName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read local products."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Reading local products failed."));
  });
}

export async function saveAnalyticsProducts(products: AnalyticsProductRecord[]) {
  if (products.length === 0) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(productStoreName, "readwrite");
    const store = transaction.objectStore(productStoreName);
    for (const product of products) store.put(product);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save imported products."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving imported products failed."));
  });
}

export async function deleteAnalyticsProduct(productId: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(productStoreName, "readwrite");
    transaction.objectStore(productStoreName).delete(productId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete this product."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Deleting this product failed."));
  });
}
