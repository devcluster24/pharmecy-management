import { Text, TextInput, useLocalizedAlert } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { Camera, CameraView } from 'expo-camera';
import { SymbolView } from 'expo-symbols';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { getCurrencySymbol } from '@/lib/currency';
import { getInventoryUnitPrice } from '@/lib/inventory-pricing';
import {
  cachePharmacySearchData,
  clearCachedPharmacySearchData,
  getCachedPharmacySearchData,
  loadPharmacyProductCatalog,
  loadPharmacySearchPayloads,
  readCachedPharmacySearchData,
} from '@/lib/pharmacy-search-cache';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

const PURCHASE_KEY = 'pharmacy-purchase-list-v1';
const PLACE_ORDER_KEY = 'pharmacy-place-order-list-v1';
const PAYMENT_METHODS_KEY = 'pharmacy-payment-methods-v1';
const PURCHASE_SEARCH_CACHE = 'purchase-search-data';
const PRODUCT_SEARCH_CACHE = 'purchase-product-catalog';
const SCAN_FRAME_INTERVAL_MS = 100;
const SCAN_TIMEOUT_MS = 1000;
const BATCH_SCAN_TIMEOUT_MS = 8000;

type PurchaseRow = {
  id: string;
  order: string;
  supplier: string;
  supplierContactName?: string;
  supplierPhone?: string;
  orderDate: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp?: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
  status: string;
  quantity?: string;
  availableQuantity?: string;
  totalPrice?: string;
  unitPurchasePrice?: string;
  productId?: string;
  productPackPrice?: string;
  orderPaidAmount?: string;
  orderDueAmount?: string;
  orderPaymentMethod?: string;
  placedAt?: string;
  updatedAt?: string;
  receivedAt?: string;
};

type Product = {
  id: string;
  brand: string;
  medicine_name: string;
  generic_name: string;
  manufacturer: string;
  strength: string;
  dosage_form: string;
  pack_size: string;
  unit_price: string;
  pack_price: string;
};
type PaymentMethodOption = { id: string; label: string };

type OrderGroup = { order: string; rows: PurchaseRow[]; dateValue: string };
type OrderLine = {
  product?: Product;
  brand: string;
  packPrice: string;
  packSize: string;
  quantity: string;
  price: string;
};
type BatchDraft = {
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp: string;
  packSize: string;
  quantity: string;
  price: string;
};
type ReceiveListItem = {
  id: string;
  company: string;
  brand: string;
  product?: Product;
  batch: BatchDraft;
  sourceRowId?: string;
};
type BatchField = 'batchNumber' | 'packSize' | 'mfgDate' | 'expDate' | 'mrp' | 'quantity' | 'price';
type SupplierField = 'name' | 'phone';
type FormState = {
  supplier: string;
  contact: string;
  phone: string;
  productId: string;
  brandName: string;
  quantity: string;
  packPrice: string;
  price: string;
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp: string;
  packSize: string;
};
type ListType = 'place' | 'receive';
type ScannerMode = 'product' | 'batch';
type ScannedBatchDetails = Pick<FormState, 'batchNumber' | 'mfgDate' | 'expDate'>;

const emptyForm: FormState = {
  supplier: '',
  contact: '',
  phone: '',
  productId: '',
  brandName: '',
  quantity: '',
  packPrice: '',
  price: '',
  batchNumber: '',
  mfgDate: '',
  expDate: '',
  mrp: '',
  packSize: '',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRows(value: unknown, source: string): PurchaseRow[] {
  if (!Array.isArray(value)) throw new Error(`Saved ${source} data has an invalid format.`);
  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.order !== 'string'
      || typeof item.supplier !== 'string'
      || typeof item.orderDate !== 'string'
      || typeof item.brand !== 'string'
      || typeof item.genericName !== 'string'
      || typeof item.strength !== 'string'
      || typeof item.dosageForm !== 'string'
      || typeof item.batchNumber !== 'string'
      || typeof item.mfgDate !== 'string'
      || typeof item.expDate !== 'string'
      || typeof item.packSize !== 'string'
      || typeof item.unitPrice !== 'string'
      || typeof item.packPrice !== 'string'
      || typeof item.status !== 'string'
    ) {
      throw new Error(`Saved ${source} data contains an invalid order row.`);
    }
    return item as unknown as PurchaseRow;
  });
}

function money(value: number) {
  return `${getCurrencySymbol()}${value.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function orderAmount(rows: PurchaseRow[]) {
  return rows.reduce((total, row) => {
    const amount = Number(row.totalPrice);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}

function getGroups(rows: PurchaseRow[], listType: ListType): OrderGroup[] {
  const grouped = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    if (listType === 'place' && row.status.toLowerCase() === 'received') continue;
    if (listType === 'receive' && row.status.toLowerCase() !== 'received') continue;
    grouped.set(row.order, [...(grouped.get(row.order) ?? []), row]);
  }
  return [...grouped].map(([order, orderRows]) => ({
    order,
    rows: orderRows,
    dateValue: orderRows.reduce((latest, row) => {
      const value = listType === 'receive'
        ? row.receivedAt ?? row.updatedAt ?? row.orderDate
        : row.placedAt ?? row.updatedAt ?? row.orderDate;
      return Date.parse(value) > Date.parse(latest) ? value : latest;
    }, orderRows[0]?.orderDate ?? ''),
  })).sort((left, right) => {
    const leftDate = Date.parse(left.dateValue);
    const rightDate = Date.parse(right.dateValue);
    return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function unitPurchasePrice(packSize: string, price: number, quantity: number) {
  const sizes = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((part) => Number(part.replace(/,/g, ''))) ?? [];
  if (!sizes.length || sizes.some((size) => !Number.isFinite(size) || size <= 0)) return '-';
  const multiplier = sizes.reduce((total, size) => total * size, 1);
  return String(Number((price / quantity / multiplier).toFixed(4)));
}

function availableQuantity(packSize: string, quantity: number) {
  const sizes = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((part) => Number(part.replace(/,/g, ''))) ?? [];
  if (!sizes.length || sizes.some((size) => !Number.isFinite(size) || size <= 0)) return String(quantity);
  return String(Number((quantity * sizes.reduce((total, size) => total * size, 1)).toFixed(4)));
}

function productName(product: Product | undefined, fallback = 'Medicine') {
  if (!product) return fallback;
  const name = product.brand.trim() || product.medicine_name.trim();
  return `${name}${product.strength.trim() ? ` · ${product.strength.trim()}` : ''}`;
}

function formatMonthYearInput(value: string, currentValue: string) {
  let digits = value.replace(/\D/g, '').slice(0, 4);
  const currentDigits = currentValue.replace(/\D/g, '');
  if (currentValue.endsWith('/') && digits === currentDigits && currentDigits.length === 2) {
    digits = digits.slice(0, -1);
  }
  if (digits.length < 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function getBrandWords(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{M}]+/gu) ?? [];
}

function getBrandMatchScore(brand: string, scannedText: string) {
  const scannedWords = new Set(getBrandWords(scannedText));
  return new Set(getBrandWords(brand).filter((word) => scannedWords.has(word))).size;
}

function formatScannedMonthYear(month: string, year: string) {
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const yearDigits = year.length > 2 ? year.slice(-2) : year.padStart(2, '0');
  return `${String(monthNumber).padStart(2, '0')}/${yearDigits}`;
}

const MONTH_NUMBERS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function findScannedMonthYear(text: string) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US');
  const namedMonthPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[,\s./-]*(\d{2}|\d{4})\b|\b(\d{2}|\d{4})[,\s./-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.exec(normalized);
  if (namedMonthPattern) {
    const monthName = namedMonthPattern[1] ?? namedMonthPattern[4];
    const year = namedMonthPattern[2] ?? namedMonthPattern[3];
    const month = monthName ? MONTH_NUMBERS[monthName.slice(0, 3)] : null;
    return month && year ? formatScannedMonthYear(month, year) : null;
  }

  const match = /(?:\b([0-3]?\d)\s*[./-]\s*([01]?\d)\s*[./-]\s*(\d{2}|\d{4})\b|\b([01]?\d)\s*[./-]\s*(\d{2}|\d{4})\b|\b(20\d{2})\s*[./-]\s*([01]?\d)\b)/.exec(normalized);
  if (!match) return null;
  if (match[1]) {
    const month = Number(match[1]) > 12 ? match[2] : match[1];
    return formatScannedMonthYear(month, match[3]);
  }
  return match[4]
    ? formatScannedMonthYear(match[4], match[5])
    : formatScannedMonthYear(match[7], match[6]);
}

function extractScannedBatchDetails(text: string): ScannedBatchDetails {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const batchNumber = lines
    .map((line) => /(?:\bbatch\b|\blot\b|\bb\.?\s*no\.?)\s*(?:no\.?|number|#)?\s*[:#.-]?\s*([a-z0-9][a-z0-9/-]{1,})/i.exec(line)?.[1])
    .find(Boolean)
    ?.toLocaleUpperCase('en-US') ?? '';
  const monthName = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const datePattern = `(?:[0-3]?\\d\\s*[./-]\\s*[01]?\\d\\s*[./-]\\s*\\d{2,4}|[01]?\\d\\s*[./-]\\s*\\d{2,4}|20\\d{2}\\s*[./-]\\s*[01]?\\d|${monthName}[,\\s./-]*\\d{2,4}|\\d{2,4}[,\\s./-]*${monthName})`;
  const mfgMatch = new RegExp(`(?:\\bmfg\\b|\\bmfd\\b|\\bmanufactured\\b|\\bmanufacturing\\b)[^\\d]{0,20}(${datePattern})`, 'i').exec(text);
  const expMatch = new RegExp(`(?:\\bexp\\b|\\bexpiry\\b|\\bexpires\\b|\\buse\\s*by\\b|\\bbest\\s*before\\b)[^\\d]{0,20}(${datePattern})`, 'i').exec(text);
  const mfgDate = mfgMatch ? findScannedMonthYear(mfgMatch[1]) : null;
  const expDate = expMatch ? findScannedMonthYear(expMatch[1]) : null;
  const unlabeledDates = lines
    .filter((line) => !/\b(?:mfg|mfd|manufactured|manufacturing|exp|expiry|expires|use\s*by|best\s*before)\b/i.test(line))
    .map(findScannedMonthYear)
    .filter((date): date is string => Boolean(date));

  return {
    batchNumber,
    mfgDate: mfgDate ?? unlabeledDates[0] ?? '',
    expDate: expDate ?? unlabeledDates[1] ?? '',
  };
}

export default function PurchaseScreen() {
  const alert = useLocalizedAlert();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [listType, setListType] = useState<ListType>('place');
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRow[]>([]);
  const [placeRows, setPlaceRows] = useState<PurchaseRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchaseDataFresh, setIsPurchaseDataFresh] = useState(false);
  const [isCatalogFresh, setIsCatalogFresh] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [isPlaceModalOpen, setIsPlaceModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<OrderGroup | null>(null);
  const [pendingReceiveRow, setPendingReceiveRow] = useState<PurchaseRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [receiveItems, setReceiveItems] = useState<ReceiveListItem[]>([]);
  const [receiveStep, setReceiveStep] = useState<'batch' | 'summary'>('batch');
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [discountValue, setDiscountValue] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [focusedSupplierField, setFocusedSupplierField] = useState<SupplierField | null>(null);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>('product');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRecognizingFrame, setIsRecognizingFrame] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [scannedProductMatches, setScannedProductMatches] = useState<Product[]>([]);
  const cameraRef = useRef<CameraView | null>(null);
  const expDateInputRef = useRef<TextInput>(null);
  const batchInputRefs = useRef<Record<BatchField, TextInput | null>>({
    batchNumber: null,
    packSize: null,
    mfgDate: null,
    expDate: null,
    mrp: null,
    quantity: null,
    price: null,
  });
  const doneButtonRef = useRef<View>(null);

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      return;
    }
    const client = supabase;
    const currentSession = session;
    if (!client || !currentSession) return;
    const purchaseClient = client;
    const purchaseSession = currentSession;
    let active = true;
    let hasCachedData = false;

    function applyPurchaseData(cached: unknown, isFresh = false) {
      if (!isRecord(cached)) throw new Error('Cached purchase data has an invalid format.');
      const nextPurchaseRows = parseRows(cached.purchaseRows ?? [], 'purchase');
      const nextPlaceRows = parseRows(cached.placeRows ?? [], 'place order');
      const savedMethods = cached.paymentMethods;
      if (savedMethods !== undefined && savedMethods !== null && !Array.isArray(savedMethods)) {
        throw new Error('Saved payment methods have an invalid format.');
      }
      const nextPaymentMethods = (savedMethods ?? []).map((method: unknown): PaymentMethodOption => {
        if (
          !isRecord(method)
          || typeof method.id !== 'string'
          || (method.type !== 'mobile' && method.type !== 'bank')
          || (method.type === 'mobile' && typeof method.name !== 'string')
          || (method.type === 'bank' && typeof method.bankName !== 'string')
        ) {
          throw new Error('Saved payment methods contain an invalid entry.');
        }
        return {
          id: `${method.type}:${method.id}`,
          label: method.type === 'mobile' ? method.name as string : method.bankName as string,
        };
      });
      if (active) {
        setPurchaseRows(nextPurchaseRows);
        setPlaceRows(nextPlaceRows);
        setPaymentMethods(nextPaymentMethods);
        hasCachedData = true;
        setIsPurchaseDataFresh(isFresh);
        setIsLoading(false);
      }
    }

    async function loadPurchaseData() {
      const cachedInMemory = getCachedPharmacySearchData<unknown>(purchaseSession.user.id, PURCHASE_SEARCH_CACHE);
      if (cachedInMemory !== undefined) {
        try {
          applyPurchaseData(cachedInMemory);
        } catch (cacheError) {
          console.warn('Ignoring invalid cached Purchase data.', cacheError);
          await clearCachedPharmacySearchData(purchaseSession.user.id, PURCHASE_SEARCH_CACHE);
        }
      }
      if (!hasCachedData) setIsLoading(true);
      setError('');
      try {
        if (!hasCachedData) {
          const cachedOnDisk = await readCachedPharmacySearchData<unknown>(purchaseSession.user.id, PURCHASE_SEARCH_CACHE);
          if (cachedOnDisk !== undefined) {
            try {
              applyPurchaseData(cachedOnDisk);
            } catch (cacheError) {
              console.warn('Ignoring invalid cached Purchase data.', cacheError);
              await clearCachedPharmacySearchData(purchaseSession.user.id, PURCHASE_SEARCH_CACHE);
            }
          }
        }
        if (!hasCachedData) setIsLoading(true);
        const payloads = await loadPharmacySearchPayloads(purchaseSession.user.id, [
          PURCHASE_KEY,
          PLACE_ORDER_KEY,
          PAYMENT_METHODS_KEY,
        ]);
        const nextData = {
          purchaseRows: payloads.get(PURCHASE_KEY) ?? [],
          placeRows: payloads.get(PLACE_ORDER_KEY) ?? [],
          paymentMethods: payloads.get(PAYMENT_METHODS_KEY),
        };
        applyPurchaseData(nextData, true);
        if (active) {
          void cachePharmacySearchData(purchaseSession.user.id, PURCHASE_SEARCH_CACHE, nextData);
        }
      } catch (loadError) {
        if (active) {
          if (hasCachedData) {
            console.error('Could not refresh Purchase data; showing the saved search cache.', loadError);
          } else {
            setError(loadError instanceof Error ? loadError.message : 'Could not load purchase data.');
          }
        }
      } finally {
        if (active && !hasCachedData) setIsLoading(false);
      }
    }
    void loadPurchaseData();
    const channel = purchaseClient
      .channel(`purchase-page-${purchaseSession.user.id}-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pharmacy_app_data',
        filter: `owner_user_id=eq.${purchaseSession.user.id}`,
      }, (change) => {
        const row = change.eventType === 'DELETE' ? change.old : change.new;
        if (row.data_key === PURCHASE_KEY || row.data_key === PLACE_ORDER_KEY || row.data_key === PAYMENT_METHODS_KEY) {
          void loadPurchaseData();
        }
      })
      .subscribe();
    return () => {
      active = false;
      void purchaseClient.removeChannel(channel);
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retry, session]);

  useEffect(() => {
    if (isAuthLoading || profileLoading || dashboardRole !== 'owner') return;
    const client = supabase;
    const currentSession = session;
    if (!client || !currentSession) return;
    const catalogSession = currentSession;
    let active = true;
    let hasCachedCatalog = false;

    function applyCatalogData(cached: unknown, isFresh = false) {
      if (!isRecord(cached) || !Array.isArray(cached.products)) {
        throw new Error('Cached product catalog has an invalid format.');
      }
      const nextProducts = cached.products.map((value): Product => {
        if (
          !isRecord(value)
          || ['id', 'brand', 'medicine_name', 'generic_name', 'manufacturer', 'strength', 'dosage_form', 'pack_size', 'unit_price', 'pack_price']
            .some((field) => typeof value[field] !== 'string')
        ) {
          throw new Error('Cached product catalog contains an invalid product.');
        }
        return value as Product;
      });
      const companyNames = new Set(nextProducts
        .map(({ manufacturer }) => manufacturer.trim())
        .filter((name) => name && name !== '-'));
      if (active) {
        setProducts(nextProducts);
        setCompanyNames([...companyNames].sort((left, right) => left.localeCompare(right)));
        hasCachedCatalog = true;
        setIsCatalogFresh(isFresh);
        setIsCatalogLoading(false);
      }
    }

    const cachedInMemory = getCachedPharmacySearchData<unknown>(catalogSession.user.id, PRODUCT_SEARCH_CACHE);
    if (cachedInMemory !== undefined) {
      try {
        applyCatalogData(cachedInMemory);
      } catch (cacheError) {
        console.warn('Ignoring invalid cached Purchase product catalog.', cacheError);
        void clearCachedPharmacySearchData(catalogSession.user.id, PRODUCT_SEARCH_CACHE);
      }
    }

    async function loadCatalog() {
      if (!hasCachedCatalog) setIsCatalogLoading(true);
      setCatalogError('');
      try {
        if (!hasCachedCatalog) {
          const cachedOnDisk = await readCachedPharmacySearchData<unknown>(catalogSession.user.id, PRODUCT_SEARCH_CACHE);
          if (cachedOnDisk !== undefined) {
            try {
              applyCatalogData(cachedOnDisk);
            } catch (cacheError) {
              console.warn('Ignoring invalid cached Purchase product catalog.', cacheError);
              await clearCachedPharmacySearchData(catalogSession.user.id, PRODUCT_SEARCH_CACHE);
            }
          }
        }
        if (!hasCachedCatalog) setIsCatalogLoading(true);
        const nextProducts = await loadPharmacyProductCatalog(catalogSession.user.id);
        if (!active) return;
        applyCatalogData({ products: nextProducts }, true);
      } catch (loadError) {
        if (active) {
          if (hasCachedCatalog) {
            console.error('Could not refresh the Purchase product catalog; showing the saved search cache.', loadError);
          } else {
            setCatalogError(loadError instanceof Error ? loadError.message : 'Could not load the product list.');
          }
        }
      } finally {
        if (active && !hasCachedCatalog) setIsCatalogLoading(false);
      }
    }
    void loadCatalog();
    return () => {
      active = false;
    };
  }, [catalogRetry, dashboardRole, isAuthLoading, profileLoading, session]);

  useEffect(() => {
    if (!pendingReceiveRow || selectedGroup) return;
    const row = pendingReceiveRow;
    const timeout = setTimeout(() => {
      setForm({
        ...emptyForm,
        supplier: row.supplier,
        contact: row.supplierContactName ?? '',
        phone: row.supplierPhone ?? '',
        productId: row.productId ?? '',
        brandName: row.brand,
        quantity: row.quantity ?? '',
        price: row.packPrice,
        mrp: row.productPackPrice ?? '',
        packSize: row.packSize,
      });
      setSelectedSourceId(row.id);
      setReceiveItems([]);
      setReceiveStep('batch');
      setDiscountType('flat');
      setDiscountValue('');
      setTaxRate('0');
      setPaymentAmount('');
      setPaymentMethod('cash');
      setSaveError('');
      setIsReceiveModalOpen(true);
      setPendingReceiveRow(null);
    }, 350);
    return () => clearTimeout(timeout);
  }, [pendingReceiveRow, selectedGroup]);

  const groups = useMemo(() => getGroups(
    listType === 'place' ? placeRows : purchaseRows,
    listType,
  ), [listType, placeRows, purchaseRows]);
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return groups;
    return groups.filter((group) => [
      group.order,
      ...group.rows.flatMap((row) => [
        row.supplier,
        row.supplierContactName ?? '',
        row.supplierPhone ?? '',
        row.brand,
      ]),
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [groups, search]);
  const companySuggestions = useMemo(() => {
    const query = form.supplier.trim().toLocaleLowerCase();
    if (!query) return [];
    return companyNames.filter((company) => company.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [companyNames, form.supplier]);
  const placeOrderProducts = useMemo(() => {
    if (form.productId) return [];
    const query = form.brandName.trim().toLocaleLowerCase();
    const addedBrands = new Set(orderLines.map((line) => line.brand.trim().toLocaleLowerCase()));
    return products.filter((product) => (
      product.manufacturer.trim().toLocaleLowerCase() === form.supplier.trim().toLocaleLowerCase()
      && !addedBrands.has((product.brand.trim() || product.medicine_name.trim()).toLocaleLowerCase())
      && (!query || [
        product.brand,
        product.medicine_name,
        product.generic_name,
        product.strength,
      ].some((value) => value.toLocaleLowerCase().includes(query)))
    ));
  }, [form.brandName, form.productId, form.supplier, orderLines, products]);
  const receiveCompanySuggestions = useMemo(() => {
    const query = form.supplier.trim().toLocaleLowerCase();
    const hasBrandQuery = form.brandName.trim().length > 0;
    if (!query || hasBrandQuery) return [];
    return companyNames.filter((company) => company.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [companyNames, form.brandName, form.supplier]);
  const receiveBrandProducts = useMemo(() => {
    if (form.productId) return [];
    const company = form.supplier.trim().toLocaleLowerCase();
    const query = form.brandName.trim().toLocaleLowerCase();
    const addedBrands = new Set(receiveItems.map((item) =>
      `${(item.product?.manufacturer.trim() || item.company).toLocaleLowerCase()}\u0000${item.brand.toLocaleLowerCase()}`));
    return products.filter((product) => {
      const brand = product.brand.trim() || product.medicine_name.trim();
      const manufacturer = product.manufacturer.trim().toLocaleLowerCase();
      const matchesCompany = !company || manufacturer === company;
      const matchesBrandQuery = !query || [product.brand, product.medicine_name, product.generic_name, product.strength]
        .some((value) => value.toLocaleLowerCase().includes(query));
      const addedKey = `${manufacturer}\u0000${brand.toLocaleLowerCase()}`;
      return matchesCompany && !addedBrands.has(addedKey) && matchesBrandQuery;
    }).slice(0, 12);
  }, [form.brandName, form.productId, form.supplier, products, receiveItems]);

  useEffect(() => {
    if (!isScannerOpen || !isCameraReady) return;
    let active = true;
    let complete = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let bestBatchDetails: ScannedBatchDetails = { batchNumber: '', mfgDate: '', expDate: '' };
    const scanStartedAt = Date.now();
    const scanTimeoutMs = scannerMode === 'batch' ? BATCH_SCAN_TIMEOUT_MS : SCAN_TIMEOUT_MS;

    function finishBatchScan(message: string) {
      setForm((current) => ({
        ...current,
        batchNumber: bestBatchDetails.batchNumber || current.batchNumber,
        mfgDate: bestBatchDetails.mfgDate || current.mfgDate,
        expDate: bestBatchDetails.expDate || current.expDate,
      }));
      setScannerMessage(message);
      setIsScannerOpen(false);
    }

    async function scanFrame() {
      if (!active || complete) return;
      let frameUri: string | undefined;
      setIsRecognizingFrame(true);
      try {
        const frame = await cameraRef.current?.takePictureAsync({
          quality: 0.4,
          shutterSound: false,
        });
        if (!frame) throw new Error('The camera could not provide a scan frame.');
        frameUri = frame.uri;
        const recognized = await TextRecognition.recognize(frameUri);
        if (!active) return;

        if (scannerMode === 'product') {
          const matches = products
            .map((product) => ({
              product,
              score: getBrandMatchScore(product.brand.trim() || product.medicine_name, recognized.text),
            }))
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score)
            .filter(({ score }, _index, allMatches) => score === allMatches[0]?.score)
            .map(({ product }) => product);
          if (matches.length > 0) {
            complete = true;
            setScannedProductMatches(matches.slice(0, 10));
            selectScannedProduct(matches[0]);
            setScannerMessage('');
            setIsScannerOpen(false);
          } else if (Date.now() - scanStartedAt >= scanTimeoutMs) {
            complete = true;
            setScannedProductMatches([]);
            setScannerMessage('Not Found');
            setIsScannerOpen(false);
          }
        } else {
          const detected = extractScannedBatchDetails(recognized.text);
          bestBatchDetails = {
            batchNumber: detected.batchNumber || bestBatchDetails.batchNumber,
            mfgDate: detected.mfgDate || bestBatchDetails.mfgDate,
            expDate: detected.expDate || bestBatchDetails.expDate,
          };
          if (bestBatchDetails.batchNumber && bestBatchDetails.mfgDate && bestBatchDetails.expDate) {
            complete = true;
            finishBatchScan('');
          } else if (Date.now() - scanStartedAt >= scanTimeoutMs) {
            complete = true;
            const foundAnyDetail = Object.values(bestBatchDetails).some(Boolean);
            finishBatchScan(foundAnyDetail
              ? 'Some batch details were not recognized. Review the fields and scan again if needed.'
              : 'Batch details not found. Try scanning again.');
          }
        }
      } catch (scanError) {
        complete = true;
        if (active) {
          alert.alert(
            'Camera scan failed',
            scanError instanceof Error ? scanError.message : 'Could not read text from the camera.',
          );
          setIsScannerOpen(false);
        }
      } finally {
        if (frameUri) {
          try {
            await FileSystem.deleteAsync(frameUri, { idempotent: true });
          } catch (cleanupError) {
            complete = true;
            if (active) {
              alert.alert(
                'Scan cleanup failed',
                cleanupError instanceof Error
                  ? cleanupError.message
                  : 'Could not remove the temporary scan frame.',
              );
              setIsScannerOpen(false);
            }
          }
        }
        if (active) setIsRecognizingFrame(false);
      }

      if (active && !complete) {
        timeout = setTimeout(() => void scanFrame(), SCAN_FRAME_INTERVAL_MS);
      }
    }

    void scanFrame();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [alert, isCameraReady, isScannerOpen, products, scannerMode]);

  const matchingPlaceOrderRows = useMemo(() => {
    const company = form.supplier.trim().toLocaleLowerCase();
    const brand = form.brandName.trim().toLocaleLowerCase();
    if (!company) return [];
    const receivedSourceIds = new Set(receiveItems.map((item) => item.sourceRowId).filter(Boolean));
    return placeRows.filter((row) => row.status.toLocaleLowerCase() !== 'received'
      && row.id !== selectedSourceId
      && !receivedSourceIds.has(row.id)
      && row.supplier.trim().toLocaleLowerCase() === company
      && (!brand || row.brand.trim().toLocaleLowerCase().includes(brand))).slice(0, 8);
  }, [form.brandName, form.supplier, placeRows, receiveItems, selectedSourceId]);
  const savedSupplierContacts = useMemo(() => {
    const seen = new Set<string>();
    return [...purchaseRows, ...placeRows]
      .map((row) => ({
        name: row.supplierContactName?.trim() || `${row.supplier.trim()} Distributor`,
        phone: row.supplierPhone?.trim() ?? '',
      }))
      .filter((contact) => {
        const key = `${contact.name.toLocaleLowerCase()}\u0000${contact.phone.replace(/\D/g, '')}`;
        if (!contact.name.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [placeRows, purchaseRows]);
  const supplierQuery = focusedSupplierField === 'phone'
    ? form.phone.replace(/\D/g, '')
    : form.contact.trim().toLocaleLowerCase();
  const supplierSuggestions = focusedSupplierField && supplierQuery
    ? savedSupplierContacts.filter((contact) => focusedSupplierField === 'phone'
      ? contact.phone.replace(/\D/g, '').includes(supplierQuery)
      : contact.name.toLocaleLowerCase().includes(supplierQuery))
    : [];
  const defaultSupplierContactName = form.supplier.trim()
    ? `${form.supplier.trim()} Distributor`
    : '';
  const isReceiveSupplierMissing = receiveItems.some((item) => !item.company.trim())
    && !form.contact.trim();
  const batchTotal = receiveItems.reduce(
    (total, item) => total + (Number(item.batch.quantity) * Number(item.batch.price)),
    0,
  );
  const parsedDiscount = discountValue.trim() ? Number(discountValue) : 0;
  const validDiscount = Number.isFinite(parsedDiscount)
    && parsedDiscount >= 0
    && (discountType === 'percent' ? parsedDiscount <= 100 : parsedDiscount <= batchTotal);
  const discountAmount = validDiscount
    ? Number((discountType === 'percent' ? batchTotal * parsedDiscount / 100 : parsedDiscount).toFixed(2))
    : 0;
  const parsedTaxRate = taxRate.trim() ? Number(taxRate) : 0;
  const validTaxRate = Number.isFinite(parsedTaxRate) && parsedTaxRate >= 0 && parsedTaxRate <= 100;
  const taxAmount = validTaxRate
    ? Number(((batchTotal - discountAmount) * parsedTaxRate / 100).toFixed(2))
    : 0;
  const billSubtotal = Number((batchTotal - discountAmount + taxAmount).toFixed(2));
  const parsedPayment = paymentAmount.trim() ? Number(paymentAmount) : 0;
  const validPayment = Number.isFinite(parsedPayment) && parsedPayment >= 0 && parsedPayment <= billSubtotal;
  const paidAmount = validPayment ? Number(parsedPayment.toFixed(2)) : 0;
  const dueAmount = validPayment ? Number((billSubtotal - paidAmount).toFixed(2)) : billSubtotal;
  const paymentOptions = [{ id: 'cash', label: 'Cash' }, ...paymentMethods];
  const effectivePaymentMethod = paymentOptions.some((option) => option.id === paymentMethod)
    ? paymentMethod
    : 'cash';

  function updateForm(field: keyof FormState, value: string) {
    setForm((current) => {
      if (field === 'brandName') {
        const match = products.find((product) =>
          product.manufacturer.trim().toLocaleLowerCase() === current.supplier.trim().toLocaleLowerCase()
          && (product.brand.trim() || product.medicine_name.trim()).toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
        );
        return {
          ...current,
          brandName: value,
          productId: match?.id ?? '',
          packPrice: match?.pack_price.trim() === '-' ? '' : match?.pack_price.trim() ?? '',
          packSize: match?.pack_size.trim() ?? '',
          ...(!match ? { price: '' } : {}),
        };
      }
      if (field === 'batchNumber') {
        return { ...current, batchNumber: value.replace(/[^a-zA-Z0-9/-]/g, '') };
      }
      if (field === 'mfgDate' || field === 'expDate') {
        return { ...current, [field]: formatMonthYearInput(value, current[field]) };
      }
      return { ...current, [field]: value };
    });
    setSaveError('');
  }

  function updateReceiveCompany(value: string) {
    setForm((current) => ({
      ...current,
      supplier: value,
      contact: value.trim() === current.supplier.trim() ? current.contact : '',
      phone: value.trim() === current.supplier.trim() ? current.phone : '',
      productId: '',
      brandName: '',
      quantity: '',
      price: '',
      packPrice: '',
      packSize: '',
      batchNumber: '',
      mfgDate: '',
      expDate: '',
      mrp: '',
    }));
    setSelectedSourceId('');
    setScannedProductMatches([]);
    setScannerMessage('');
    setSaveError('');
  }

  function selectScannedProduct(product: Product) {
    const brandName = product.brand.trim() || product.medicine_name.trim();
    const packPrice = product.pack_price.trim() === '-' ? '' : product.pack_price.trim();
    setForm((current) => ({
      ...current,
      productId: product.id,
      brandName,
      mrp: packPrice,
      packSize: product.pack_size.trim(),
      price: packPrice,
      batchNumber: '',
      mfgDate: '',
      expDate: '',
    }));
    setSelectedSourceId('');
    setScannerMessage('');
    setSaveError('');
  }

  async function startCameraScan(mode: ScannerMode) {
    if (Platform.OS === 'web') {
      alert.alert('Camera scan unavailable', 'Medicine scanning is available in the Android and iOS app.');
      return;
    }
    if (mode === 'product' && isCatalogLoading) {
      alert.alert('Product list is loading', 'Wait for the Product Management list to finish loading, then scan again.');
      return;
    }
    setScannerMode(mode);
    setScannerMessage('');
    if (mode === 'product') setScannedProductMatches([]);
    setIsCameraReady(false);
    try {
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        alert.alert('Camera permission required', 'Allow camera access to scan medicine labels.');
        return;
      }
      Keyboard.dismiss();
      setIsScannerOpen(true);
    } catch (permissionError) {
      alert.alert(
        'Camera permission failed',
        permissionError instanceof Error ? permissionError.message : 'Could not request camera access.',
      );
    }
  }

  function closeCameraScanner() {
    setIsScannerOpen(false);
    setIsCameraReady(false);
    setIsRecognizingFrame(false);
  }

  function updateOrderCompany(value: string) {
    setForm((current) => ({
      ...current,
      supplier: value,
      productId: '',
      brandName: '',
      packPrice: '',
      quantity: '',
      price: '',
      packSize: '',
    }));
    setOrderLines([]);
    setSaveError('');
  }

  function selectOrderBrand(product: Product) {
    setForm((current) => ({
      ...current,
      brandName: product.brand.trim() || product.medicine_name.trim(),
      productId: product.id,
      packPrice: product.pack_price.trim() === '-' ? '' : product.pack_price.trim(),
      packSize: product.pack_size.trim(),
    }));
    setSaveError('');
  }

  function focusSupplierField(field: SupplierField) {
    setFocusedSupplierField(field);
    if (field === 'name' && form.contact.trim() === defaultSupplierContactName) {
      setForm((current) => ({ ...current, contact: '' }));
    }
  }

  function selectSupplierContact(contact: { name: string; phone: string }) {
    setForm((current) => ({
      ...current,
      contact: contact.name,
      phone: contact.phone,
    }));
    setFocusedSupplierField(null);
  }

  function focusNextBatchField(field: BatchField, fieldValue = form[field]) {
    const values: Record<BatchField, string> = {
      batchNumber: form.batchNumber,
      packSize: form.packSize,
      mfgDate: form.mfgDate,
      expDate: form.expDate,
      mrp: form.mrp,
      quantity: form.quantity,
      price: form.price,
      [field]: fieldValue,
    };
    const orderedFields: BatchField[] = [
      'batchNumber',
      'packSize',
      'mfgDate',
      'expDate',
      'mrp',
      'quantity',
      'price',
    ];
    const currentIndex = orderedFields.indexOf(field);
    const nextField = orderedFields.slice(currentIndex + 1).find((item) => !values[item].trim())
      ?? orderedFields.find((item) => !values[item].trim());
    requestAnimationFrame(() => {
      if (nextField) batchInputRefs.current[nextField]?.focus();
      else doneButtonRef.current?.focus();
    });
  }

  function closePlaceForm() {
    setIsPlaceModalOpen(false);
    setForm(emptyForm);
    setOrderLines([]);
    setSaveError('');
  }

  function closeReceiveForm() {
    setIsReceiveModalOpen(false);
    setForm(emptyForm);
    setSelectedSourceId('');
    setReceiveItems([]);
    setReceiveStep('batch');
    setDiscountType('flat');
    setDiscountValue('');
    setTaxRate('0');
    setPaymentAmount('');
    setPaymentMethod('cash');
    setFocusedSupplierField(null);
    setScannedProductMatches([]);
    setScannerMessage('');
    setSaveError('');
  }

  function addOrderLine() {
    const product = products.find((item) => item.id === form.productId);
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    const supplier = form.supplier.trim();
    const brand = form.brandName.trim();
    if (!supplier || !brand || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
      setSaveError('Enter a company and brand name, then enter a valid box quantity and purchase price.');
      return;
    }
    if (product && product.manufacturer.trim().toLocaleLowerCase() !== supplier.toLocaleLowerCase()) {
      setSaveError('Select a brand from the chosen company.');
      return;
    }
    setOrderLines((current) => [...current, {
      product,
      brand,
      packPrice: form.packPrice.trim(),
      packSize: form.packSize.trim() || product?.pack_size.trim() || '',
      quantity: String(quantity),
      price: String(price),
    }]);
    setForm((current) => ({
      ...current,
      productId: '',
      brandName: '',
      quantity: '',
      packPrice: '',
      price: '',
      packSize: '',
    }));
    setSaveError('');
  }

  async function persistRows(key: string, rows: PurchaseRow[]) {
    if (!supabase || !session) throw new Error('Sign in to save purchase orders.');
    const client = supabase;
    const ownerId = session.user.id;
    const existing = await client.from('pharmacy_app_data')
      .select('data_key')
      .eq('owner_user_id', ownerId)
      .eq('data_key', key)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const result = existing.data
      ? await client.from('pharmacy_app_data')
        .update({ payload: rows, updated_at: new Date().toISOString() })
        .eq('owner_user_id', ownerId)
        .eq('data_key', key)
        .select('data_key')
        .maybeSingle()
      : await client.from('pharmacy_app_data')
        .insert({
          owner_user_id: ownerId,
          data_key: key,
          payload: rows,
          updated_at: new Date().toISOString(),
        })
        .select('data_key')
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Could not save the purchase order. Please try again.');
    const cachedData = getCachedPharmacySearchData<unknown>(ownerId, PURCHASE_SEARCH_CACHE);
    if (isRecord(cachedData)) {
      void cachePharmacySearchData(ownerId, PURCHASE_SEARCH_CACHE, {
        ...cachedData,
        [key === PURCHASE_KEY ? 'purchaseRows' : 'placeRows']: rows,
      });
    }
  }

  async function savePlaceOrder() {
    if (!isPurchaseDataFresh || !isCatalogFresh) {
      setSaveError('Updating purchase and product data. Please wait a moment and try again.');
      return;
    }
    const supplier = form.supplier.trim();
    if (!supplier || orderLines.length === 0) {
      setSaveError('Select a company and add at least one brand to the order list.');
      return;
    }
    const nextNumber = placeRows.reduce((max, row) => {
      const match = /^PO-(\d+)$/.exec(row.order);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const order = `PO-${String(nextNumber).padStart(4, '0')}`;
    const now = new Date();
    const orderDate = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    const rows = orderLines.map(({ product, brand, packPrice, packSize, quantity, price }, index): PurchaseRow => ({
      id: `${order}-${index}`,
      order,
      supplier,
      orderDate,
      brand,
      genericName: product?.generic_name.trim() || '-',
      strength: product?.strength.trim() || '-',
      dosageForm: product?.dosage_form.trim() || '-',
      batchNumber: '-',
      mfgDate: '',
      expDate: '',
      packSize: packSize || '-',
      unitPrice: product?.unit_price.trim() || '-',
      packPrice: price,
      productPackPrice: packPrice || '-',
      quantity,
      totalPrice: String(Number((Number(quantity) * Number(price)).toFixed(2))),
      unitPurchasePrice: unitPurchasePrice(packSize, Number(quantity) * Number(price), Number(quantity)),
      ...(product ? { productId: product.id } : {}),
      placedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'Placed',
    }));
    setIsSaving(true);
    setSaveError('');
    try {
      const nextRows = [...rows, ...placeRows];
      await persistRows(PLACE_ORDER_KEY, nextRows);
      setPlaceRows(nextRows);
      closePlaceForm();
    } catch (saveIssue) {
      setSaveError(saveIssue instanceof Error ? saveIssue.message : 'Could not place the order.');
    } finally {
      setIsSaving(false);
    }
  }

  function selectSourceOrder(row: PurchaseRow) {
    setSelectedSourceId(row.id);
    setReceiveStep('batch');
    setForm((current) => ({
      ...current,
      supplier: row.supplier,
      contact: row.supplierContactName ?? '',
      phone: row.supplierPhone ?? '',
      productId: row.productId ?? '',
      brandName: row.brand,
      quantity: row.quantity ?? '',
      price: row.packPrice,
      mrp: row.productPackPrice ?? '',
      packSize: row.packSize,
      batchNumber: '',
      mfgDate: '',
      expDate: '',
    }));
  }

  function addReceiveBatch() {
    const batchNumber = form.batchNumber.trim();
    const mfg = /^(\d{2})\/(\d{2})$/.exec(form.mfgDate.trim());
    const exp = /^(\d{2})\/(\d{2})$/.exec(form.expDate.trim());
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    const monthDate = (value: RegExpExecArray) => `${2000 + Number(value[2])}-${value[1]}`;
    if (
      !form.brandName.trim()
      || !batchNumber || !mfg || !exp || !form.mrp.trim()
      || !form.packSize.trim() || !form.quantity.trim() || !form.price.trim()
    ) {
      setSaveError('Complete all batch fields, including Batch Number, Box MRP, quantity, and Mfg/Exp dates.');
      return;
    }
    if (
      Number(mfg[1]) < 1 || Number(mfg[1]) > 12
      || Number(exp[1]) < 1 || Number(exp[1]) > 12
      || Number(mfg[2]) < 18
      || Number(exp[2]) < 18
      || monthDate(exp) <= monthDate(mfg)
    ) {
      setSaveError('Enter valid Mfg/Exp dates and make sure Exp Date is after Mfg Date.');
      return;
    }
    if (
      !Number.isFinite(Number(form.mrp)) || Number(form.mrp) < 0
      || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(price) || price < 0
    ) {
      setSaveError('Enter a valid Box MRP, a box quantity greater than zero, and a valid purchase price.');
      return;
    }
    const product = products.find((item) => item.id === form.productId);
    const sourceRow = placeRows.find((row) => row.id === selectedSourceId);
    const batch = {
      batchNumber,
      mfgDate: monthDate(mfg),
      expDate: monthDate(exp),
      mrp: form.mrp.trim() || '-',
      packSize: form.packSize.trim(),
      quantity: String(quantity),
      price: String(price),
    };
    setReceiveItems((current) => [...current, {
      id: `${Date.now()}-${current.length}`,
      company: form.supplier.trim(),
      brand: product?.brand.trim() || product?.medicine_name.trim() || form.brandName.trim(),
      ...(product ? { product } : {}),
      batch,
      ...(sourceRow ? { sourceRowId: sourceRow.id } : {}),
    }]);
    setForm((current) => ({
      ...current,
      productId: '',
      brandName: '',
      quantity: '',
      price: '',
      packPrice: '',
      packSize: '',
      batchNumber: '',
      mfgDate: '',
      expDate: '',
      mrp: '',
    }));
    setSelectedSourceId('');
    setSaveError('');
  }

  async function saveReceiveOrder() {
    if (!isPurchaseDataFresh) {
      setSaveError('Updating purchase data. Please wait a moment and try again.');
      return;
    }
    if (receiveItems.length === 0) {
      setSaveError('Add at least one batch to the Receive List before continuing.');
      return;
    }
    if (isReceiveSupplierMissing) {
      setSaveError('Enter a Supplier Name before receiving brands without a Company Name.');
      return;
    }
    if (!validDiscount) {
      setSaveError('Enter a valid discount amount.');
      return;
    }
    if (!validTaxRate) {
      setSaveError('Enter a VAT/Tax rate between 0 and 100.');
      return;
    }
    if (!validPayment) {
      setSaveError('Enter a payment amount between zero and the subtotal.');
      return;
    }
    const nextNumber = purchaseRows.reduce((max, row) => {
      const match = /^PO-RC-(\d+)$/.exec(row.order);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const order = `PO-RC-${String(nextNumber).padStart(4, '0')}`;
    const now = new Date();
    const orderDate = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    const rows = receiveItems.map((item, index): PurchaseRow => {
      const { batch, product } = item;
      const quantity = Number(batch.quantity);
      const totalPrice = Number((quantity * Number(batch.price)).toFixed(2));
      const sourceRow = item.sourceRowId
        ? placeRows.find((row) => row.id === item.sourceRowId)
        : undefined;
      const inventoryUnitPrice = getInventoryUnitPrice(batch.mrp, batch.packSize);
      return {
        ...(sourceRow ?? {}),
        id: `${order}-${item.id}-${index}`,
        order,
        supplier: item.company,
        supplierContactName: form.contact.trim() || (item.company.trim() ? `${item.company} Distributor` : ''),
        supplierPhone: form.phone.trim(),
        orderDate,
        brand: item.brand,
        genericName: product?.generic_name.trim() || sourceRow?.genericName || '-',
        strength: product?.strength.trim() || sourceRow?.strength || '-',
        dosageForm: product?.dosage_form.trim() || sourceRow?.dosageForm || '-',
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expDate: batch.expDate,
        mrp: batch.mrp,
        packSize: batch.packSize,
        unitPrice: inventoryUnitPrice === null ? '-' : String(inventoryUnitPrice),
        packPrice: batch.price,
        productPackPrice: product?.pack_price.trim() || sourceRow?.productPackPrice || '-',
        quantity: batch.quantity,
        availableQuantity: availableQuantity(batch.packSize, quantity),
        totalPrice: String(totalPrice),
        unitPurchasePrice: unitPurchasePrice(batch.packSize, totalPrice, quantity),
        ...(product || sourceRow?.productId
          ? { productId: product?.id ?? sourceRow?.productId }
          : {}),
        orderPaidAmount: String(paidAmount),
        orderDueAmount: String(dueAmount),
        orderPaymentMethod: paymentMethod,
        receivedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        status: 'Received',
      };
    });
    const receivedSources = new Map<string, ReceiveListItem[]>();
    receiveItems.forEach((item) => {
      if (!item.sourceRowId) return;
      receivedSources.set(item.sourceRowId, [...(receivedSources.get(item.sourceRowId) ?? []), item]);
    });
    const nextPlaceRows = placeRows.map((row) => {
      const receivedItems = receivedSources.get(row.id);
      if (!receivedItems) return row;
      const quantity = receivedItems.reduce((sum, item) => sum + Number(item.batch.quantity), 0);
      const totalPrice = receivedItems.reduce((sum, item) =>
        sum + Number(item.batch.quantity) * Number(item.batch.price), 0);
      return {
        ...row,
        quantity: String(quantity),
        totalPrice: String(Number(totalPrice.toFixed(2))),
        status: 'Received',
        updatedAt: now.toISOString(),
      };
    });
    setIsSaving(true);
    setSaveError('');
    try {
      const nextPurchaseRows = [...rows, ...purchaseRows];
      await persistRows(PURCHASE_KEY, nextPurchaseRows);
      if (receivedSources.size > 0) await persistRows(PLACE_ORDER_KEY, nextPlaceRows);
      setPurchaseRows(nextPurchaseRows);
      if (receivedSources.size > 0) setPlaceRows(nextPlaceRows);
      closeReceiveForm();
    } catch (saveIssue) {
      setSaveError(saveIssue instanceof Error ? saveIssue.message : 'Could not receive the order.');
    } finally {
      setIsSaving(false);
    }
  }

  function startReceive() {
    setForm(emptyForm);
    setSelectedSourceId('');
    setReceiveItems([]);
    setReceiveStep('batch');
    setDiscountType('flat');
    setDiscountValue('');
    setTaxRate('0');
    setPaymentAmount('');
    setPaymentMethod('cash');
    setFocusedSupplierField(null);
    setSaveError('');
    setSelectedGroup(null);
    setIsReceiveModalOpen(true);
  }

  function requestReceive(row: PurchaseRow) {
    setSelectedGroup(null);
    setPendingReceiveRow(row);
  }

  if (isAuthLoading || profileLoading) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color="#17664f" /></SafeAreaView>;
  }

  if (dashboardRole !== 'owner') {
    return (
      <SafeAreaView style={styles.page}>
        <DashboardSubpageHeader subtitle="Purchase" onBack={() => router.replace('/dashboard')} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Purchase is available to store owners.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!supabase || !session) {
    return (
      <SafeAreaView style={styles.page}>
        <DashboardSubpageHeader subtitle="Purchase" onBack={() => router.replace('/dashboard')} />
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Purchase data is unavailable. Check your account connection.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <DashboardSubpageHeader subtitle="Purchase" onBack={() => router.replace('/dashboard')} />
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Purchase</Text>
            <Text style={styles.subtitle}>Manage supplier orders and received stock</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <Pressable style={[styles.actionButton, styles.placeButton]} onPress={() => {
            setForm(emptyForm);
            setOrderLines([]);
            setSaveError('');
            setIsPlaceModalOpen(true);
          }}>
            <Text style={styles.placeButtonText}>＋ Place Order</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.receiveButton]} onPress={() => startReceive()}>
            <Text style={styles.receiveButtonText}>＋ Receive Order</Text>
          </Pressable>
        </View>
        <View style={styles.listTabs}>
          {([
            ['place', 'Place Order List'],
            ['receive', 'Receive Order List'],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: listType === value }}
              onPress={() => setListType(value)}
              style={[styles.listTab, listType === value && styles.listTabActive]}>
              <Text style={[styles.listTabText, listType === value && styles.listTabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search supplier, order number, or medicine"
          placeholderTextColor="#8a958f"
          style={styles.search}
        />
        {isLoading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator size="small" color="#17664f" />
            <Text style={styles.catalogStatus}>Loading purchase orders…</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setRetry((value) => value + 1)} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {!isLoading && !error && visibleGroups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No {listType === 'place' ? 'placed' : 'received'} orders yet</Text>
            <Text style={styles.emptyText}>Orders you create will appear here.</Text>
          </View>
        ) : null}
        {visibleGroups.map((group) => {
          const first = group.rows[0];
          return (
            <Pressable key={group.order} onPress={() => setSelectedGroup(group)} style={styles.orderCard}>
              <View style={styles.orderCardTop}>
                <Text style={styles.orderNumber}>{group.order}</Text>
                <Text style={[styles.status, listType === 'receive' ? styles.receivedStatus : styles.placedStatus]}>
                  {listType === 'receive' ? 'Received' : 'Placed'}
                </Text>
              </View>
              <Text style={styles.supplierName}>{first.supplier}</Text>
              <Text style={styles.contactLine}>
                {first.supplierPhone || 'No phone number'}{first.supplierContactName ? ` · ${first.supplierContactName}` : ''}
              </Text>
              <View style={styles.orderCardBottom}>
                <Text style={styles.orderDate}>{formatDate(group.dateValue)}</Text>
                <Text style={styles.amount}>{money(orderAmount(group.rows))}</Text>
              </View>
              <Text style={styles.itemsCount}>{group.rows.length} {group.rows.length === 1 ? 'item' : 'items'} · Tap to view details</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={isPlaceModalOpen} animationType="slide" onRequestClose={closePlaceForm}>
        <SafeAreaView style={styles.modalPage}>
          <ModalHeader title="Place Order" onClose={closePlaceForm} />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalSubtitle}>Select a company and one or more brands to place an order.</Text>
            {isCatalogLoading ? <Text style={styles.catalogStatus}>Loading company and brand suggestions…</Text> : null}
            {catalogError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{catalogError}</Text>
                <Pressable onPress={() => setCatalogRetry((value) => value + 1)} style={styles.retryButton}>
                  <Text style={styles.retryText}>Retry loading products</Text>
                </Pressable>
              </View>
            ) : null}
            <Field
              label="Company Name"
              value={form.supplier}
              onChangeText={updateOrderCompany}
              placeholder="Type or select a company"
            />
            {companySuggestions.length > 0 ? (
              <View style={styles.productOptions}>
                {companySuggestions.map((company) => (
                  <Pressable key={company} onPress={() => updateOrderCompany(company)} style={styles.productOption}>
                    <Text style={styles.productOptionName}>{company}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {form.supplier ? (
              <>
                <Field
                  label="Brand Name"
                  value={form.brandName}
                  onChangeText={(value) => updateForm('brandName', value)}
                  placeholder="Search or type a brand name"
                />
                {placeOrderProducts.length > 0 ? (
                  <View style={styles.productOptions}>
                    {placeOrderProducts.slice(0, 12).map((product) => (
                      <Pressable key={product.id} onPress={() => selectOrderBrand(product)} style={styles.productOption}>
                        <Text style={styles.productOptionName}>{productName(product)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {form.brandName.trim() ? (
                  <>
                    <View style={styles.rowFields}>
                      <Field label="Pack Price" value={form.packPrice} onChangeText={(value) => updateForm('packPrice', value)} placeholder="0.00" keyboardType="decimal-pad" style={styles.halfField} />
                      <Field label="Box Quantity" value={form.quantity} onChangeText={(value) => updateForm('quantity', value)} placeholder="0" keyboardType="decimal-pad" style={styles.halfField} />
                    </View>
                    <View style={styles.rowFields}>
                      <Field label="Pack Size" value={form.packSize} onChangeText={(value) => updateForm('packSize', value)} placeholder="e.g. 10" style={styles.halfField} />
                      <Field label="Purchase Price (Box)" value={form.price} onChangeText={(value) => updateForm('price', value)} placeholder="0.00" keyboardType="decimal-pad" style={styles.halfField} />
                    </View>
                    {isReceiveSupplierMissing ? (
                      <Text style={styles.formError}>Add a Supplier Name to receive brands without a Company Name.</Text>
                    ) : null}
                    <Pressable onPress={addOrderLine} style={styles.addLineButton}><Text style={styles.addLineText}>Add</Text></Pressable>
                  </>
                ) : null}
              </>
            ) : null}
            {orderLines.map((line, index) => (
              <View key={`${line.product?.id ?? line.brand}-${index}`} style={styles.lineCard}>
                <View style={styles.lineText}>
                  <Text style={styles.lineName}>{line.brand}{line.product?.strength ? ` · ${line.product.strength}` : ''}</Text>
                  <Text style={styles.lineMeta}>Pack Price: {line.packPrice || '-'} · Pack Size: {line.packSize || '-'} · Box Qty: {line.quantity}</Text>
                  <Text style={styles.lineMeta}>Purchase Price (Box): {money(Number(line.price))} · Unit Purchase Price: {unitPurchasePrice(line.packSize, Number(line.quantity) * Number(line.price), Number(line.quantity))}</Text>
                </View>
                <Text style={styles.lineAmount}>{money(Number(line.quantity) * Number(line.price))}</Text>
                <Pressable accessibilityLabel="Remove order item" onPress={() => setOrderLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>
                  <Text style={styles.removeLine}>×</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.placeOrderTotal}>
              <Text style={styles.placeOrderTotalText}>
                Total Order Price: {money(orderLines.reduce((total, line) => total + Number(line.quantity) * Number(line.price), 0))}
              </Text>
            </View>
            {saveError ? <Text style={styles.formError}>{saveError}</Text> : null}
            <View style={styles.modalFooter}>
              <Pressable onPress={closePlaceForm} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={isSaving || !form.supplier}
                onPress={() => void savePlaceOrder()}
                style={[styles.submitButton, styles.placeOrderSubmit, (isSaving || !form.supplier) && styles.disabledButton]}>
                {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Place Order</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={isReceiveModalOpen} animationType="slide" onRequestClose={closeReceiveForm}>
        <SafeAreaView style={styles.modalPage}>
          <ModalHeader
            title={receiveStep === 'summary' ? 'Bill Summary' : 'Receive Order'}
            onClose={receiveStep === 'summary' ? () => setReceiveStep('batch') : closeReceiveForm}
          />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {receiveStep === 'batch' ? (
              <>
                {isCatalogLoading ? <Text style={styles.catalogStatus}>Loading company and brand suggestions…</Text> : null}
                {catalogError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{catalogError}</Text>
                    <Pressable onPress={() => setCatalogRetry((value) => value + 1)} style={styles.retryButton}>
                      <Text style={styles.retryText}>Retry loading products</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.scannerFieldRow}>
                  <Field
                    label="Company Name (Optional)"
                    value={form.supplier}
                    onChangeText={updateReceiveCompany}
                    placeholder="Optional; filter products by company"
                    style={styles.scannerField}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Scan brand name"
                    onPress={() => void startCameraScan('product')}
                    style={styles.scanButton}>
                    <SymbolView
                      name={{ ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' }}
                      size={20}
                      tintColor="#17664f"
                    />
                  </Pressable>
                </View>
                {scannerMessage === 'Not Found' ? (
                  <View style={styles.scanMessageRow}>
                    <Text style={styles.scanNotFound}>Not Found</Text>
                    <Pressable onPress={() => void startCameraScan('product')}>
                      <Text style={styles.retryText}>New Search</Text>
                    </Pressable>
                  </View>
                ) : null}
                {scannedProductMatches.length > 1 ? (
                  <View style={styles.productOptions}>
                    {scannedProductMatches.map((product) => (
                      <Pressable
                        key={product.id}
                        onPress={() => selectScannedProduct(product)}
                        style={styles.productOption}>
                        <Text style={styles.productOptionName}>
                          {productName(product)} · {product.manufacturer}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {receiveCompanySuggestions.length > 0 ? (
                  <View style={styles.productOptions}>
                    {receiveCompanySuggestions.map((company) => (
                      <Pressable key={company} onPress={() => updateReceiveCompany(company)} style={styles.productOption}>
                        <Text style={styles.productOptionName}>{company}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Field
                  label="Brand Name"
                  value={form.brandName}
                  onChangeText={(value) => {
                    updateForm('brandName', value);
                    setSelectedSourceId('');
                  }}
                  placeholder={form.supplier.trim() ? 'Search, select, or type a brand' : 'Type or scan a brand name'}
                />
                {receiveBrandProducts.length > 0 ? (
                  <View style={styles.productOptions}>
                    {receiveBrandProducts.map((product) => (
                      <Pressable key={product.id} onPress={() => {
                        setForm((current) => ({
                          ...current,
                          brandName: product.brand.trim() || product.medicine_name.trim(),
                          productId: product.id,
                          mrp: product.pack_price.trim() === '-' ? '' : product.pack_price.trim(),
                          packSize: product.pack_size.trim(),
                          price: product.pack_price.trim() === '-' ? '' : product.pack_price.trim(),
                        }));
                      }} style={styles.productOption}>
                        <Text style={styles.productOptionName}>{productName(product)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {form.supplier.trim() ? (
                  <>
                    <Text style={styles.sectionLabel}>Place Order List</Text>
                    {matchingPlaceOrderRows.length > 0 ? (
                      <View style={styles.productOptions}>
                        {matchingPlaceOrderRows.map((row) => (
                          <Pressable key={row.id} onPress={() => selectSourceOrder(row)} style={styles.productOption}>
                            <Text style={styles.productOptionName}>{row.brand}</Text>
                            <Text style={styles.productOptionMeta}>{row.order} · {row.quantity ?? '—'} box · {money(Number(row.totalPrice ?? 0))}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.catalogStatus}>
                        {form.brandName.trim()
                          ? 'No matching placed brand. You can add this brand as a new receive.'
                          : 'No pending placed brands for this company. Type a brand name to add a new receive.'}
                      </Text>
                    )}
                  </>
                ) : null}
                {form.brandName.trim() ? (
                  <>
                    <View style={styles.batchScanHeader}>
                      <Text style={styles.sectionLabel}>Add Batch Details</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Scan batch number and dates"
                        onPress={() => void startCameraScan('batch')}
                        style={styles.scanButton}>
                        <SymbolView
                          name={{ ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' }}
                          size={20}
                          tintColor="#17664f"
                        />
                      </Pressable>
                    </View>
                    {scannerMessage && scannerMessage !== 'Not Found' ? (
                      <Text style={styles.scanMessage}>{scannerMessage}</Text>
                    ) : null}
                <View style={styles.rowFields}>
                  <Field ref={(node) => { batchInputRefs.current.batchNumber = node; }} label="Batch Number" value={form.batchNumber} onChangeText={(value) => updateForm('batchNumber', value)} onSubmitEditing={() => focusNextBatchField('batchNumber')} returnKeyType="next" placeholder="Batch/lot number" keyboardType="default" style={styles.halfField} />
                  <Field ref={(node) => { batchInputRefs.current.packSize = node; }} label="Pack Size" value={form.packSize} onChangeText={(value) => updateForm('packSize', value)} onSubmitEditing={() => focusNextBatchField('packSize')} returnKeyType="next" placeholder="e.g. 10" style={styles.halfField} />
                </View>
                <View style={styles.rowFields}>
                  <Field ref={(node) => { batchInputRefs.current.mfgDate = node; }} label="Mfg Date (MM/YY)" value={form.mfgDate} onChangeText={(value) => {
                    updateForm('mfgDate', value);
                    if (
                      form.mfgDate.replace(/\D/g, '').length < 4
                      && value.replace(/\D/g, '').length === 4
                    ) {
                      focusNextBatchField('mfgDate', formatMonthYearInput(value, form.mfgDate));
                    }
                  }} onSubmitEditing={() => focusNextBatchField('mfgDate')} returnKeyType="next" placeholder="MM/YY" keyboardType="number-pad" maxLength={5} style={styles.halfField} />
                  <Field ref={(node) => {
                    expDateInputRef.current = node;
                    batchInputRefs.current.expDate = node;
                  }} label="Exp Date (MM/YY)" value={form.expDate} onChangeText={(value) => {
                    updateForm('expDate', value);
                    if (
                      form.expDate.replace(/\D/g, '').length < 4
                      && value.replace(/\D/g, '').length === 4
                    ) {
                      focusNextBatchField('expDate', formatMonthYearInput(value, form.expDate));
                    }
                  }} onSubmitEditing={() => focusNextBatchField('expDate')} returnKeyType="next" placeholder="MM/YY" keyboardType="number-pad" maxLength={5} style={styles.halfField} />
                </View>
                <View style={styles.rowFields}>
                  <Field ref={(node) => { batchInputRefs.current.mrp = node; }} label="Box MRP" value={form.mrp} onChangeText={(value) => updateForm('mrp', value)} onSubmitEditing={() => focusNextBatchField('mrp')} returnKeyType="next" placeholder="0.00" keyboardType="decimal-pad" style={styles.halfField} />
                  <Field ref={(node) => { batchInputRefs.current.quantity = node; }} label="Box Quantity" value={form.quantity} onChangeText={(value) => updateForm('quantity', value)} onSubmitEditing={() => focusNextBatchField('quantity')} returnKeyType="next" placeholder="0" keyboardType="decimal-pad" style={styles.halfField} />
                </View>
                <Field ref={(node) => { batchInputRefs.current.price = node; }} label="Purchase Price (Box)" value={form.price} onChangeText={(value) => updateForm('price', value)} onSubmitEditing={() => focusNextBatchField('price')} returnKeyType="done" placeholder="0.00" keyboardType="decimal-pad" />
                {form.quantity && form.price ? (
                  <View style={styles.batchTotalCard}>
                    <Text style={styles.batchTotalLabel}>Total Purchase Price</Text>
                    <Text style={styles.batchTotalValue}>{money(Number(form.quantity) * Number(form.price))}</Text>
                  </View>
                ) : null}
                {saveError ? <Text style={styles.formError}>{saveError}</Text> : null}
                <Pressable ref={doneButtonRef} onPress={addReceiveBatch} style={styles.submitButton}>
                  <Text style={styles.submitText}>Add to Receive List</Text>
                </Pressable>
              </>
            ) : null}
              </>
            ) : null}
            {receiveStep === 'batch' && receiveItems.length > 0 ? (
              <View style={styles.stagedBatchList}>
                <Text style={styles.sectionLabel}>Receive List</Text>
                {receiveItems.map((item) => (
                  <View key={item.id} style={styles.stagedBatch}>
                    <View style={styles.lineText}>
                      <Text style={styles.lineName}>{item.brand}</Text>
                      <Text style={styles.lineMeta}>{item.company} · Batch {item.batch.batchNumber} · {item.batch.packSize}</Text>
                      <Text style={styles.lineMeta}>
                        Mfg {item.batch.mfgDate} · Exp {item.batch.expDate} · {item.batch.quantity} box
                      </Text>
                    </View>
                    <Text style={styles.lineAmount}>{money(Number(item.batch.quantity) * Number(item.batch.price))}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.brand} batch ${item.batch.batchNumber}`}
                      onPress={() => setReceiveItems((current) => current.filter((draft) => draft.id !== item.id))}>
                      <Text style={styles.removeLine}>×</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open purchase summary"
                  onPress={() => {
                    setReceiveStep('summary');
                    setSaveError('');
                  }}
                  style={styles.receiveTotalLink}>
                  <View style={styles.lineText}>
                    <Text style={styles.receiveTotalLabel}>Total Amount</Text>
                    <Text style={styles.receiveTotalAmount}>{money(batchTotal)}</Text>
                  </View>
                  <Text style={styles.receiveTotalArrow}>›</Text>
                </Pressable>
              </View>
            ) : null}
            {receiveStep === 'summary' ? (
              <>
                <View style={styles.detailSummary}>
                  <Text style={styles.supplierName}>
                    {[...new Set(receiveItems.map((item) => item.company))].join(', ')}
                  </Text>
                  <Text style={styles.contactLine}>{form.contact || 'Supplier'} · {form.phone || 'No phone number'}</Text>
                </View>
                <View style={styles.billSummary}>
                  <SummaryRow label="Total Company" value={String(new Set(receiveItems.map((item) => item.company.trim().toLocaleLowerCase()).filter(Boolean)).size)} />
                  <SummaryRow label="Brands" value={String(new Set(receiveItems.map((item) => `${item.company.toLocaleLowerCase()}\u0000${item.brand.toLocaleLowerCase()}`)).size)} />
                  <SummaryRow
                    label="Box Quantity"
                    value={String(receiveItems.reduce((total, item) => total + Number(item.batch.quantity), 0))}
                  />
                  <SummaryRow label="Total Purchase Price" value={money(batchTotal)} emphasized />
                  <View style={styles.discountControlRow}>
                    <Text style={styles.summaryLabel}>Discount</Text>
                    <View style={styles.discountTabs}>
                      {(['flat', 'percent'] as const).map((type) => (
                        <Pressable
                          key={type}
                          accessibilityRole="button"
                          accessibilityState={{ selected: discountType === type }}
                          onPress={() => {
                            setDiscountType(type);
                            setDiscountValue('');
                          }}
                          style={[styles.discountTab, discountType === type && styles.discountTabActive]}>
                          <Text style={[styles.discountTabText, discountType === type && styles.discountTabTextActive]}>
                            {type === 'flat' ? 'Flat ৳' : '%'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      accessibilityLabel={discountType === 'flat' ? 'Discount amount' : 'Discount percentage'}
                      value={discountValue}
                      onChangeText={setDiscountValue}
                      keyboardType="decimal-pad"
                      placeholder={discountType === 'flat' ? 'Discount amount' : 'Discount %'}
                      placeholderTextColor="#8a958f"
                      style={styles.discountInput}
                    />
                    <Text style={styles.summaryValue}>−{money(discountAmount)}</Text>
                  </View>
                  {!validDiscount ? <Text style={styles.formError}>Discount cannot exceed the total purchase price.</Text> : null}
                  <View style={styles.summaryInputRow}>
                    <Text style={styles.summaryLabel}>VAT/Tax (%)</Text>
                    <TextInput
                      accessibilityLabel="VAT/Tax percentage"
                      value={taxRate}
                      onChangeText={setTaxRate}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#8a958f"
                      style={styles.taxInput}
                    />
                    <Text style={styles.summaryValue}>+{money(taxAmount)}</Text>
                  </View>
                  {!validTaxRate ? <Text style={styles.formError}>VAT/Tax must be between zero and 100%.</Text> : null}
                  <SummaryRow label="Sub Total" value={money(billSubtotal)} emphasized />
                  <View style={styles.paymentMethodRow}>
                    <Text style={styles.summaryLabel}>Payment Method</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentMethodOptions}>
                      {paymentOptions.map((option) => (
                        <Pressable
                          key={option.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: effectivePaymentMethod === option.id }}
                          onPress={() => setPaymentMethod(option.id)}
                          style={[
                            styles.discountTab,
                            effectivePaymentMethod === option.id && styles.discountTabActive,
                          ]}>
                          <Text style={[
                            styles.discountTabText,
                            effectivePaymentMethod === option.id && styles.discountTabTextActive,
                          ]}>{option.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={styles.paymentInputRow}>
                    <Text style={styles.summaryLabel}>Payment</Text>
                    <TextInput
                      accessibilityLabel="Payment amount"
                      value={paymentAmount}
                      onChangeText={setPaymentAmount}
                      keyboardType="decimal-pad"
                      placeholder="Payment amount"
                      placeholderTextColor="#8a958f"
                      style={styles.paymentInput}
                    />
                  </View>
                  {!validPayment ? <Text style={styles.formError}>Payment cannot exceed the subtotal.</Text> : null}
                  <SummaryRow label="Paid" value={money(paidAmount)} />
                  <SummaryRow label="Due" value={money(dueAmount)} emphasized />
                  <View style={styles.supplierSummaryFields}>
                    <View style={styles.supplierSummaryField}>
                      <Text style={styles.supplierFieldLabel}>Supplier Name</Text>
                      <TextInput
                        accessibilityLabel="Supplier Name"
                        value={focusedSupplierField === 'name' || form.contact.trim()
                          ? form.contact
                          : defaultSupplierContactName}
                        onFocus={() => focusSupplierField('name')}
                        onBlur={() => setTimeout(() => setFocusedSupplierField((current) => current === 'name' ? null : current), 200)}
                        onChangeText={(value) => updateForm('contact', value)}
                        placeholder="Supplier name"
                        placeholderTextColor="#8a958f"
                        style={styles.input}
                      />
                    </View>
                    {focusedSupplierField === 'name' && supplierSuggestions.length > 0 ? (
                      <View style={styles.supplierSuggestions}>
                        {supplierSuggestions.slice(0, 5).map((contact, index) => (
                          <Pressable
                            key={`${contact.name}-${contact.phone}-${index}`}
                            onPress={() => selectSupplierContact(contact)}
                            style={styles.supplierSuggestion}>
                            <Text style={styles.supplierSuggestionName}>{contact.name}</Text>
                            <Text style={styles.supplierSuggestionPhone}>{contact.phone || 'No phone number'}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.supplierSummaryField}>
                      <Text style={styles.supplierFieldLabel}>Phone Number</Text>
                      <TextInput
                        accessibilityLabel="Supplier Phone Number"
                        value={form.phone}
                        onFocus={() => focusSupplierField('phone')}
                        onBlur={() => setTimeout(() => setFocusedSupplierField((current) => current === 'phone' ? null : current), 200)}
                        onChangeText={(value) => updateForm('phone', value)}
                        keyboardType="phone-pad"
                        placeholder="Phone number"
                        placeholderTextColor="#8a958f"
                        style={styles.input}
                      />
                    </View>
                    {focusedSupplierField === 'phone' && supplierSuggestions.length > 0 ? (
                      <View style={styles.supplierSuggestions}>
                        {supplierSuggestions.slice(0, 5).map((contact, index) => (
                          <Pressable
                            key={`${contact.name}-${contact.phone}-${index}`}
                            onPress={() => selectSupplierContact(contact)}
                            style={styles.supplierSuggestion}>
                            <Text style={styles.supplierSuggestionName}>{contact.name}</Text>
                            <Text style={styles.supplierSuggestionPhone}>{contact.phone || 'No phone number'}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text style={styles.sectionLabel}>Receive List</Text>
                {receiveItems.map((item) => (
                  <View key={item.id} style={styles.stagedBatch}>
                    <View style={styles.lineText}>
                      <Text style={styles.lineName}>{item.brand} · {item.batch.batchNumber}</Text>
                      <Text style={styles.lineMeta}>
                        {item.company} · {item.batch.packSize} · Mfg {item.batch.mfgDate} · Exp {item.batch.expDate} · {item.batch.quantity} box
                      </Text>
                    </View>
                    <Text style={styles.lineAmount}>{money(Number(item.batch.quantity) * Number(item.batch.price))}</Text>
                  </View>
                ))}
                {saveError ? <Text style={styles.formError}>{saveError}</Text> : null}
                <Pressable
                  disabled={isSaving || receiveItems.length === 0 || isReceiveSupplierMissing}
                  onPress={() => void saveReceiveOrder()}
                  style={[styles.submitButton, (isSaving || receiveItems.length === 0 || isReceiveSupplierMissing) && styles.disabledButton]}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Received</Text>}
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={selectedGroup !== null} animationType="slide" onRequestClose={() => setSelectedGroup(null)}>
        <SafeAreaView style={styles.modalPage}>
          <ModalHeader title={selectedGroup?.order ?? 'Order details'} onClose={() => setSelectedGroup(null)} />
          {selectedGroup ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.detailSummary}>
                <Text style={styles.supplierName}>{selectedGroup.rows[0]?.supplier}</Text>
                <Text style={styles.contactLine}>
                  {selectedGroup.rows[0]?.supplierContactName || 'Supplier'} · {selectedGroup.rows[0]?.supplierPhone || 'No phone number'}
                </Text>
                <Text style={styles.orderDate}>{formatDate(selectedGroup.dateValue)}</Text>
              </View>
              {selectedGroup.rows.map((row) => (
                <View key={row.id} style={styles.detailItem}>
                  <Text style={styles.lineName}>{row.brand}{row.strength && row.strength !== '-' ? ` · ${row.strength}` : ''}</Text>
                  <Text style={styles.lineMeta}>{row.genericName} · {row.packSize} · {row.quantity ?? '—'} box</Text>
                  {listType === 'receive' ? (
                    <Text style={styles.lineMeta}>Batch {row.batchNumber} · Mfg {row.mfgDate || '—'} · Exp {row.expDate || '—'}</Text>
                  ) : null}
                  <Text style={styles.lineAmount}>{money(Number(row.totalPrice ?? 0))}</Text>
                  {listType === 'place' ? (
                    <Pressable onPress={() => requestReceive(row)} style={styles.receiveThisButton}>
                      <Text style={styles.receiveThisText}>Receive this item</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Text style={styles.totalLabel}>
                {listType === 'place' ? 'Total Order Price' : 'Total Purchase Amount'}: {money(orderAmount(selectedGroup.rows))}
              </Text>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
      <Modal
        visible={isScannerOpen}
        animationType="slide"
        onRequestClose={closeCameraScanner}
        statusBarTranslucent>
        <View style={styles.scannerModal}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setIsCameraReady(true)}
            onMountError={(event) => {
              alert.alert('Camera unavailable', event.message);
              closeCameraScanner();
            }}
            animateShutter={false}
          />
          <View pointerEvents="box-none" style={styles.scannerOverlay}>
            <View style={styles.scannerHeader}>
              <Text style={styles.scannerTitle}>
                {scannerMode === 'product' ? 'Scan product brand' : 'Scan batch details'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close scanner"
                onPress={closeCameraScanner}
                style={styles.scannerCloseButton}>
                <Text style={styles.scannerCloseText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.scannerGuide}>
              <View style={styles.scannerTarget} />
              <View style={styles.scannerHint}>
                {isRecognizingFrame ? <ActivityIndicator color="#fff" /> : null}
                <Text style={styles.scannerHintText}>
                  {scannerMode === 'product'
                    ? 'Point the camera at the brand name'
                    : 'Frame the batch number, MFG date and EXP date'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
        <Text style={styles.closeText}>‹</Text>
      </Pressable>
      <Text style={styles.modalTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad';
  returnKeyType?: 'done' | 'next';
  maxLength?: number;
  style?: object;
};

const Field = forwardRef<TextInput, FieldProps>(function Field({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  placeholder,
  keyboardType,
  returnKeyType,
  maxLength,
  style,
}, ref) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor="#8a958f"
        keyboardType={keyboardType ?? 'default'}
        returnKeyType={returnKeyType}
        maxLength={maxLength}
        style={styles.input}
      />
    </View>
  );
});

function SummaryRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, emphasized && styles.summaryEmphasized]}>{label}</Text>
      <Text style={[styles.summaryValue, emphasized && styles.summaryEmphasized]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#145642' },
  pageContent: { flex: 1, backgroundColor: '#f4f6f2' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6f2' },
  content: { padding: 16, paddingBottom: 36, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleGroup: { flex: 1 },
  title: { color: '#193c30', fontSize: 23, fontWeight: '800' },
  subtitle: { marginTop: 3, color: '#728078', fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  placeButton: { backgroundColor: '#17664f' },
  receiveButton: { backgroundColor: '#c8f36c' },
  placeButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  receiveButtonText: { color: '#173c2c', fontSize: 13, fontWeight: '800' },
  listTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#dfe6df' },
  listTab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  listTabActive: { borderBottomColor: '#17664f' },
  listTabText: { color: '#75827b', fontSize: 12, fontWeight: '700' },
  listTabTextActive: { color: '#17664f' },
  search: { minHeight: 44, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 11, paddingHorizontal: 12, color: '#20342a', backgroundColor: '#fff', fontSize: 13 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  orderCard: { padding: 14, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 15, backgroundColor: '#fff' },
  orderCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderNumber: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  status: { overflow: 'hidden', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '700' },
  placedStatus: { color: '#8e6715', backgroundColor: '#fff3cf' },
  receivedStatus: { color: '#17664f', backgroundColor: '#e0f3e8' },
  supplierName: { marginTop: 11, color: '#21392e', fontSize: 15, fontWeight: '800' },
  contactLine: { marginTop: 3, color: '#748078', fontSize: 11 },
  orderCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13 },
  orderDate: { color: '#758078', fontSize: 11 },
  amount: { color: '#193c30', fontSize: 15, fontWeight: '800' },
  itemsCount: { marginTop: 9, color: '#8a958f', fontSize: 10 },
  emptyCard: { alignItems: 'center', padding: 24, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 15, backgroundColor: '#fff' },
  emptyTitle: { color: '#30463b', fontSize: 14, fontWeight: '700' },
  emptyText: { marginTop: 5, color: '#7d8982', fontSize: 12 },
  errorBox: { padding: 14, borderRadius: 12, backgroundColor: '#fff0ed' },
  errorText: { color: '#a63e34', fontSize: 13, lineHeight: 19 },
  catalogStatus: { color: '#748078', fontSize: 11 },
  retryButton: { alignSelf: 'flex-start', marginTop: 8 },
  retryText: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalPage: { flex: 1, backgroundColor: '#f4f6f2' },
  modalHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#dfe6df', backgroundColor: '#fff' },
  closeButton: { width: 40, alignItems: 'flex-start', justifyContent: 'center' },
  closeText: { color: '#17664f', fontSize: 34, lineHeight: 38 },
  modalTitle: { flex: 1, color: '#193c30', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  headerSpacer: { width: 40 },
  modalContent: { padding: 16, paddingBottom: 40, gap: 12 },
  modalSubtitle: { marginTop: -4, color: '#77857d', fontSize: 12, lineHeight: 17 },
  field: { gap: 5 },
  fieldLabel: { color: '#40564a', fontSize: 11, fontWeight: '700' },
  input: { minHeight: 42, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 9, backgroundColor: '#fff', color: '#24382e', fontSize: 13 },
  scannerFieldRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  scannerField: { flex: 1 },
  scanButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cfe5d7', borderRadius: 9, backgroundColor: '#eef8f2' },
  scanMessageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scanNotFound: { color: '#a63e34', fontSize: 12, fontWeight: '700' },
  scanMessage: { color: '#78847d', fontSize: 11, lineHeight: 16 },
  batchScanHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scannerModal: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingTop: 54, paddingBottom: 38 },
  scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  scannerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  scannerCloseButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)' },
  scannerCloseText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  scannerGuide: { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: 24 },
  scannerTarget: { width: '100%', height: 180, borderWidth: 2, borderColor: '#42e6a3', borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.08)' },
  scannerHint: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)' },
  scannerHintText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sectionLabel: { marginTop: 4, color: '#193c30', fontSize: 14, fontWeight: '800' },
  productOptions: { borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 10, backgroundColor: '#fff' },
  companyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
  companyOption: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff' },
  companyOptionSelected: { borderColor: '#17664f', backgroundColor: '#e8f3eb' },
  companyOptionText: { color: '#526158', fontSize: 11, fontWeight: '600' },
  companyOptionTextSelected: { color: '#17664f', fontWeight: '800' },
  productOption: { paddingHorizontal: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#edf1ed' },
  productOptionName: { color: '#2b4035', fontSize: 12, fontWeight: '700' },
  productOptionMeta: { marginTop: 2, color: '#78847d', fontSize: 10 },
  mutedText: { padding: 10, color: '#78847d', fontSize: 12 },
  selectedProduct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 9, backgroundColor: '#e6f2e9' },
  selectedProductText: { flex: 1, color: '#24503d', fontSize: 12, fontWeight: '700' },
  clearSelection: { color: '#17664f', fontSize: 11, fontWeight: '800' },
  addLineButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#17664f', borderRadius: 10 },
  addLineText: { color: '#17664f', fontSize: 12, fontWeight: '800' },
  lineCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 10, backgroundColor: '#fff' },
  lineText: { flex: 1 },
  lineName: { color: '#294136', fontSize: 12, fontWeight: '700' },
  lineMeta: { marginTop: 3, color: '#78847d', fontSize: 10 },
  lineAmount: { color: '#1f4434', fontSize: 12, fontWeight: '800' },
  placeOrderTotal: { alignItems: 'flex-end', padding: 14, borderRadius: 8, backgroundColor: '#f4f7f5' },
  placeOrderTotalText: { color: '#20342a', fontSize: 13, fontWeight: '800' },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e9eeea' },
  cancelButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: '#dce5df', borderRadius: 8, backgroundColor: '#fff' },
  cancelText: { color: '#526158', fontSize: 12, fontWeight: '700' },
  placeOrderSubmit: { flex: 0, minWidth: 130, paddingHorizontal: 16 },
  removeLine: { color: '#a63e34', fontSize: 21, paddingHorizontal: 3 },
  totalLabel: { paddingVertical: 10, color: '#193c30', fontSize: 14, fontWeight: '800', textAlign: 'right' },
  formError: { color: '#a63e34', fontSize: 12, lineHeight: 18 },
  submitButton: { minHeight: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#17664f' },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.65 },
  sourceOrder: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 10, backgroundColor: '#fff' },
  sourceOrderSelected: { borderColor: '#17664f', backgroundColor: '#e8f3eb' },
  sourceAmount: { color: '#1f4434', fontSize: 11, fontWeight: '800' },
  clearSource: { alignSelf: 'flex-end', padding: 3 },
  rowFields: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  detailSummary: { padding: 14, borderRadius: 12, backgroundColor: '#fff' },
  batchTotalCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: '#e8f3eb' },
  batchTotalLabel: { color: '#526158', fontSize: 12, fontWeight: '700' },
  batchTotalValue: { color: '#17664f', fontSize: 14, fontWeight: '800' },
  stagedBatchList: { gap: 8 },
  stagedBatch: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 10, backgroundColor: '#fff' },
  receiveTotalLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 13, borderWidth: 1, borderColor: '#dce5df', borderRadius: 11, backgroundColor: '#e8f3eb' },
  receiveTotalLabel: { color: '#40564a', fontSize: 12, fontWeight: '700' },
  receiveTotalAmount: { marginTop: 3, color: '#17664f', fontSize: 15, fontWeight: '800', textAlign: 'right' },
  receiveTotalArrow: { color: '#17664f', fontSize: 30, fontWeight: '600' },
  billSummary: { gap: 10, padding: 14, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 12, backgroundColor: '#fbfcfb' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  summaryLabel: { color: '#526158', fontSize: 12 },
  summaryValue: { color: '#32483c', fontSize: 12, fontWeight: '700' },
  summaryEmphasized: { color: '#17664f', fontWeight: '800' },
  supplierSummaryFields: { gap: 9, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5ebe7' },
  supplierSummaryField: { gap: 4 },
  supplierFieldLabel: { color: '#40564a', fontSize: 11, fontWeight: '700' },
  supplierSuggestions: { overflow: 'hidden', borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff' },
  supplierSuggestion: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#edf1ed' },
  supplierSuggestionName: { flex: 1, color: '#294136', fontSize: 11, fontWeight: '700' },
  supplierSuggestionPhone: { color: '#78847d', fontSize: 10 },
  discountControlRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  discountTabs: { flexDirection: 'row', gap: 3 },
  discountTab: { paddingHorizontal: 7, paddingVertical: 6, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 7, backgroundColor: '#fff' },
  discountTabActive: { borderColor: '#17664f', backgroundColor: '#e8f3eb' },
  discountTabText: { color: '#526158', fontSize: 10, fontWeight: '700' },
  discountTabTextActive: { color: '#17664f' },
  paymentMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paymentMethodOptions: { alignItems: 'center', gap: 6 },
  paymentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paymentInput: { flex: 1, minHeight: 39, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff', color: '#24382e', fontSize: 12, textAlign: 'right' },
  discountInput: { flex: 1, minWidth: 50, minHeight: 37, paddingHorizontal: 7, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 7, backgroundColor: '#fff', color: '#24382e', fontSize: 11 },
  summaryInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryInput: { flex: 1, minHeight: 39, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff', color: '#24382e', fontSize: 12 },
  taxInput: { width: 70, minHeight: 39, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff', color: '#24382e', fontSize: 12, textAlign: 'right' },
  detailItem: { padding: 13, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 11, backgroundColor: '#fff' },
  receiveThisButton: { alignSelf: 'flex-start', marginTop: 9, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: '#17664f' },
  receiveThisText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
