import { Text, TextInput, useLocalizedAlert } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/recorded-payments';
import {
  loadInvoiceTemplateSettings,
  type InvoiceFieldKey,
  type InvoiceTemplateItem,
} from '@/lib/invoice-template-settings';
import { useAuth } from '@/providers/AuthProvider';

const PURCHASE_KEY = 'pharmacy-purchase-list-v1';
const SALES_KEY = 'pharmacy-sales-list-v1';
const PAYMENT_METHODS_KEY = 'pharmacy-payment-methods-v1';
const VAT_SETTINGS_KEY = 'pharmacy-vat-tax-settings-v1';
const SEARCH_RESULT_LIMIT = 30;
const WALK_IN_CUSTOMER = 'Walk-in Customer';

type InventoryRow = {
  id: string;
  order: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  batchNumber: string;
  expDate: string;
  packSize: string;
  mrp?: string;
  productPackPrice?: string;
  packPrice: string;
  unitPrice: string;
  quantity?: string;
  availableQuantity?: string;
  unitPurchasePrice?: string;
  status: string;
  [key: string]: unknown;
};

type SaleLine = {
  batchId: string;
  quantity: string;
};

type SaleInvoiceLine = {
  brand: string;
  details: string;
  batchNumber: string;
  packSize: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitPurchasePrice?: number;
};

type SaleInvoice = {
  id: string;
  invoice: string;
  customer: string;
  phone?: string;
  items: number;
  time: string;
  amount: number;
  subtotalAmount: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  cashRoundingAmount: number;
  paidAmount: number;
  dueAmount: number;
  payment: string;
  paymentMethodName: string;
  createdByUserId: string;
  payments: { methodName: string; amount: number }[];
  createdAt: string;
  lines: SaleInvoiceLine[];
};

type PaymentMethodOption = { id: string; label: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function getInvoiceHtml(
  invoice: SaleInvoice,
  storeName: string,
  settings: Awaited<ReturnType<typeof loadInvoiceTemplateSettings>>,
) {
  const template = settings.templates.find((item) => item.id === settings.activeTemplateId);
  if (!template) throw new Error('The active invoice template is not available.');
  const colors = {
    classic: { accent: '#17704e', pale: '#eff7f2', ink: '#26352f', muted: '#526158' },
    modern: { accent: '#247a78', pale: '#ebf6f5', ink: '#1f3133', muted: '#4e6363' },
    compact: { accent: '#566fa6', pale: '#eff2fa', ink: '#273043', muted: '#566075' },
    elegant: { accent: '#98714d', pale: '#f8f3ed', ink: '#382f28', muted: '#685b4d' },
  }[template.style];
  const date = new Date(invoice.createdAt).toLocaleString('en-BD');
  const fieldValues: Record<InvoiceFieldKey, string> = {
    storeName: storeName || 'Pharmacy Cluster',
    invoiceNumber: invoice.invoice,
    dateTime: date,
    customer: invoice.customer,
    phone: invoice.phone ?? '',
    paymentMethod: invoice.paymentMethodName,
    paymentStatus: invoice.payment,
  };
  function getItemValue(item: InvoiceTemplateItem) {
    if (item.type === 'text') return item.value.trim();
    const value = fieldValues[item.key];
    return item.key === 'storeName' ? value : `${item.label}: ${value}`;
  }
  const leftHeader = template.header
    .filter((item) => (item.align ?? 'left') === 'left')
    .map(getItemValue)
    .filter(Boolean);
  const rightHeader = template.header
    .filter((item) => item.align === 'right')
    .map(getItemValue)
    .filter(Boolean);
  const headerRows = Array.from(
    { length: Math.max(leftHeader.length, rightHeader.length) },
    (_, index) => `<div class="header-row">
      <span>${escapeHtml(leftHeader[index] ?? '')}</span>
      <span class="right">${escapeHtml(rightHeader[index] ?? '')}</span>
    </div>`,
  ).join('');
  const footerRows = template.footer
    .map(getItemValue)
    .filter(Boolean)
    .map((value) => `<div>${escapeHtml(value)}</div>`)
    .join('');
  const rows = invoice.lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.brand)}<small>${escapeHtml(line.details)} · Batch ${escapeHtml(line.batchNumber)}</small></td>
      <td class="number">${line.quantity}</td>
      <td class="number">${escapeHtml(formatCurrency(line.unitPrice))}</td>
      <td class="number">${escapeHtml(formatCurrency(line.totalPrice))}</td>
    </tr>`).join('');
  const hasDue = invoice.dueAmount > 0;
  const seal = hasDue
    ? settings.seals.due
      ? '<span class="seal due">DUE</span>'
      : ''
    : settings.seals.paid
      ? '<span class="seal paid">PAID</span>'
      : '';
  const signature = settings.signature.type === 'image' && settings.signature.imageDataUrl
    ? `<img class="signature-image" src="${escapeHtml(settings.signature.imageDataUrl)}" alt="Signature">`
    : settings.signature.text.trim()
      ? `<div class="signature-text">${escapeHtml(settings.signature.text.trim())}</div>`
      : '';
  const pageSize = settings.pageSize;
  const pageWidth = pageSize.format === 'a4' ? 210 : pageSize.format === 'a5' ? 148 : pageSize.widthMm;
  const pageHeight = pageSize.format === 'a4' ? 297 : pageSize.format === 'a5' ? 210 : pageSize.heightMm;
  const corner = template.style === 'modern'
    ? `<span class="modern-corner" style="border-top-color:${colors.accent}"></span>`
    : template.style === 'elegant'
      ? `<span class="elegant-mark" style="border-color:${colors.accent}"></span>`
      : '';
  const compactEdge = template.style === 'compact' ? `border-left:4px solid ${colors.accent};` : '';
  return `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 12mm; }
      * { box-sizing: border-box; }
      body { color: ${colors.ink}; font: 14px Arial, sans-serif; margin: 0 auto; max-width: 760px; padding: 0; position: relative; ${compactEdge} }
      header { border-bottom: 2px solid ${colors.accent}; padding: 0 0 12px; position: relative; }
      h1 { color: ${colors.accent}; font-size: 24px; margin: 0 0 6px; }
      .muted, small { color: ${colors.muted}; }
      .header-row { display:flex; justify-content:space-between; gap:12px; padding-top:5px; color:${colors.muted}; font-size:11px; }
      .right { text-align:right; }
      .section { border-bottom: 1px dashed #cbd5ce; padding: 12px 0; }
      .row { display: flex; justify-content: space-between; gap: 20px; padding: 5px 0; }
      table { border-collapse: collapse; margin-top: 14px; width: 100%; }
      th, td { border-bottom: 1px solid #e3e9e4; padding: 8px 5px; text-align: left; }
      th { background:${colors.pale}; color: ${colors.accent}; font-size: 11px; }
      .number { text-align: right; white-space: nowrap; }
      td small { display: block; font-size: 10px; margin-top: 4px; }
      .total { color: ${colors.accent}; font-size: 18px; font-weight: bold; }
      .bottom { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-top:18px; }
      .seal { display:inline-block; border:2px solid; border-radius:10px; padding:5px 12px; font-weight:900; font-size:18px; transform:rotate(-8deg); }
      .paid { color:#c91625; border-color:#c91625; } .due { color:#d45232; border-color:#d45232; }
      .signature { min-width:150px; margin-top:14px; color:${colors.muted}; font-size:10px; }
      .signature-text { color:${colors.ink}; font:italic 16px Georgia,serif; margin-bottom:4px; }
      .signature-image { display:block; object-fit:contain; object-position:left bottom; width:140px; height:42px; margin-bottom:4px; }
      .signature-line { border-top:1px solid #8e9992; padding-top:4px; }
      footer { color: ${colors.muted}; font-size: 11px; margin-top: 12px; text-align: center; }
      .modern-corner { position:absolute; top:-12px; right:-12px; width:0; height:0; border-top:28px solid; border-left:28px solid transparent; }
      .elegant-mark { position:absolute; top:0; right:0; width:12px; height:12px; border:1px solid; border-radius:50%; }
    </style></head><body>
      <header>${corner}<h1>SALES INVOICE</h1>
        <div class="muted">Date &amp; time: ${escapeHtml(date)}</div>${headerRows}</header>
      <table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Price</th><th class="number">Amount</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <section class="section">
        <div class="row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(invoice.subtotalAmount))}</span></div>
        <div class="row"><span>Discount</span><span>−${escapeHtml(formatCurrency(invoice.discountAmount))}</span></div>
        <div class="row"><span>VAT/TAX (${invoice.taxRate}%)</span><span>${escapeHtml(formatCurrency(invoice.taxAmount))}</span></div>
        <div class="row"><span>Cash rounding</span><span>${escapeHtml(formatCurrency(invoice.cashRoundingAmount))}</span></div>
        <div class="row total"><span>Total</span><span>${escapeHtml(formatCurrency(invoice.amount))}</span></div>
        <div class="row"><span>Paid</span><span>${escapeHtml(formatCurrency(invoice.paidAmount))}</span></div>
        <div class="row"><span>Due</span><span>${escapeHtml(formatCurrency(invoice.dueAmount))}</span></div>
        <div>${seal}</div>
      </section>
      ${signature ? `<div class="bottom"><div class="signature">${signature}<div class="signature-line">Signature</div></div></div>` : ''}
      <footer>${footerRows}</footer>
    </body></html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInventory(value: unknown): InventoryRow[] {
  if (!Array.isArray(value)) throw new Error('Saved inventory data has an invalid format.');
  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.order !== 'string'
      || typeof item.brand !== 'string'
      || typeof item.genericName !== 'string'
      || typeof item.strength !== 'string'
      || typeof item.dosageForm !== 'string'
      || typeof item.batchNumber !== 'string'
      || typeof item.expDate !== 'string'
      || typeof item.packSize !== 'string'
      || typeof item.packPrice !== 'string'
      || typeof item.unitPrice !== 'string'
      || typeof item.status !== 'string'
    ) {
      throw new Error('Saved inventory contains an invalid batch.');
    }
    for (const key of [
      'mrp', 'productPackPrice', 'quantity', 'availableQuantity', 'unitPurchasePrice',
    ]) {
      if (item[key] !== undefined && typeof item[key] !== 'string') {
        throw new Error('Saved inventory contains an invalid quantity or price.');
      }
    }
    return item as InventoryRow;
  });
}

function parsePaymentMethods(value: unknown): PaymentMethodOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Saved payment methods have an invalid format.');
  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.id !== 'string'
      || (item.type !== 'mobile' && item.type !== 'bank')
      || (item.type === 'mobile' && typeof item.name !== 'string')
      || (item.type === 'bank' && typeof item.bankName !== 'string')
    ) {
      throw new Error('Saved payment methods contain an invalid entry.');
    }
    return {
      id: `${item.type}:${item.id}`,
      label: item.type === 'mobile' ? item.name as string : item.bankName as string,
    };
  });
}

function getPackMultiplier(packSize: string) {
  const factors = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((factor) =>
    Number(factor.replace(/,/g, '')),
  ) ?? [];
  if (!factors.length || factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) {
    return null;
  }
  const multiplier = factors.reduce((total, factor) => total * factor, 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function getAvailableQuantity(row: InventoryRow) {
  if (row.availableQuantity !== undefined) {
    const value = Number(row.availableQuantity);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (!row.quantity?.trim()) return null;
  const quantity = Number(row.quantity);
  const multiplier = getPackMultiplier(row.packSize);
  if (!Number.isFinite(quantity) || quantity < 0 || multiplier === null) return null;
  return Number((quantity * multiplier).toFixed(4));
}

function getUnitPrice(value: string) {
  const amount = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function isExpired(row: InventoryRow, now: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(row.expDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  return year * 12 + month <= now.getFullYear() * 12 + now.getMonth() + 1;
}

function getCashRoundingAmount(amount: number) {
  return Number((Math.round(amount) - amount).toFixed(2));
}

function roundCurrency(amount: number) {
  return Number(amount.toFixed(2));
}

export default function SalesScreen() {
  const alert = useLocalizedAlert();
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
    storeName,
  } = useAuth();
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [salesPayload, setSalesPayload] = useState<Record<string, unknown>[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([
    { id: 'cash', label: 'Cash' },
  ]);
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [isBillSummaryOpen, setIsBillSummaryOpen] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState<SaleInvoice | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [customerName, setCustomerName] = useState(WALK_IN_CUSTOMER);
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const salesScrollRef = useRef<ScrollView>(null);
  const inputRefs = useRef(new Map<string, TextInput>());
  const focusedInputRef = useRef<TextInput | null>(null);
  const scrollOffsetRef = useRef(0);
  const scrollOffsetBeforeKeyboardRef = useRef(0);
  const keyboardVisibleRef = useRef(false);
  const keyboardTopRef = useRef<number | null>(null);

  function scrollFocusedInputIntoView() {
    const input = focusedInputRef.current;
    const scrollView = salesScrollRef.current;
    if (!input || !scrollView) return;
    const keyboardTop = keyboardTopRef.current;
    if (keyboardTop === null) return;

    input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
      const overlap = inputY + inputHeight + 24 - keyboardTop;
      if (overlap <= 0) return;
      const nextOffset = Math.max(0, scrollOffsetRef.current + overlap);
      scrollView.scrollTo({ y: nextOffset, animated: true });
    });
  }

  function focusSaleInput(inputName: string) {
    const input = inputRefs.current.get(inputName) ?? null;
    focusedInputRef.current = input;
    if (!keyboardVisibleRef.current) {
      scrollOffsetBeforeKeyboardRef.current = scrollOffsetRef.current;
      return;
    }
    scrollFocusedInputIntoView();
  }

  useEffect(() => {
    let keyboardShowTimeout: ReturnType<typeof setTimeout> | undefined;
    let keyboardShowRetryTimeout: ReturnType<typeof setTimeout> | undefined;
    let keyboardHideTimeout: ReturnType<typeof setTimeout> | undefined;
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardVisibleRef.current = true;
      keyboardTopRef.current = event.endCoordinates.screenY;
      setKeyboardHeight(event.endCoordinates.height);
      if (keyboardShowTimeout) clearTimeout(keyboardShowTimeout);
      if (keyboardShowRetryTimeout) clearTimeout(keyboardShowRetryTimeout);
      keyboardShowTimeout = setTimeout(() => {
        scrollFocusedInputIntoView();
      }, 120);
      keyboardShowRetryTimeout = setTimeout(() => {
        scrollFocusedInputIntoView();
      }, 300);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      keyboardTopRef.current = null;
      setKeyboardHeight(0);
      if (keyboardHideTimeout) clearTimeout(keyboardHideTimeout);
      keyboardHideTimeout = setTimeout(() => {
        salesScrollRef.current?.scrollTo({
          y: scrollOffsetBeforeKeyboardRef.current,
          animated: true,
        });
      }, 80);
    });
    return () => {
      if (keyboardShowTimeout) clearTimeout(keyboardShowTimeout);
      if (keyboardShowRetryTimeout) clearTimeout(keyboardShowRetryTimeout);
      if (keyboardHideTimeout) clearTimeout(keyboardHideTimeout);
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      router.replace('/dashboard');
      return;
    }
    let active = true;
    async function loadSaleData() {
      if (!supabase || !session) {
        setLoadError('Sales data is unavailable. Check your account connection.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setLoadError('');
      try {
        const result = await supabase
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', session.user.id)
          .in('data_key', [PURCHASE_KEY, SALES_KEY, PAYMENT_METHODS_KEY, VAT_SETTINGS_KEY]);
        if (result.error) throw result.error;
        const payloads = new Map((result.data ?? []).map((row) => [row.data_key, row.payload]));
        const nextInventory = parseInventory(payloads.get(PURCHASE_KEY) ?? []);
        const rawSales = payloads.get(SALES_KEY) ?? [];
        if (
          !Array.isArray(rawSales)
          || rawSales.some((sale) => !isRecord(sale))
        ) {
          throw new Error('Saved sales data has an invalid format.');
        }
        const methods = parsePaymentMethods(payloads.get(PAYMENT_METHODS_KEY));
        const vatValue = payloads.get(VAT_SETTINGS_KEY);
        let rate = 0;
        if (vatValue !== undefined && vatValue !== null) {
          if (
            !isRecord(vatValue)
            || typeof vatValue.defaultRate !== 'number'
            || !Number.isFinite(vatValue.defaultRate)
            || vatValue.defaultRate < 0
            || vatValue.defaultRate > 100
          ) {
            throw new Error('Saved VAT/TAX settings are invalid.');
          }
          rate = vatValue.defaultRate;
        }
        if (active) {
          setInventory(nextInventory);
          setSalesPayload(rawSales as Record<string, unknown>[]);
          setPaymentMethods([{ id: 'cash', label: 'Cash' }, ...methods]);
          setDefaultTaxRate(rate);
          setTaxRate(String(rate));
        }
      } catch (loadIssue) {
        if (active) {
          setLoadError(loadIssue instanceof Error ? loadIssue.message : 'Could not load sales data.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadSaleData();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  const availableInventory = useMemo(() => inventory.filter((row) =>
    row.status.toLocaleLowerCase() === 'received'
    && row.batchNumber.trim()
    && !isExpired(row, new Date())
    && (getAvailableQuantity(row) ?? 0) > 0
    && !lines.some((line) => line.batchId === row.id),
  ), [inventory, lines]);
  const filteredInventory = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase();
    if (!query) return [];
    return availableInventory.filter((row) =>
      row.brand.toLocaleLowerCase().includes(query)
      || row.genericName.toLocaleLowerCase().includes(query),
    ).slice(0, SEARCH_RESULT_LIMIT);
  }, [availableInventory, searchValue]);

  async function scanMedicine() {
    if (Platform.OS === 'web') {
      alert.alert('Camera scan unavailable', 'Medicine scanning is available in the Android and iOS app.');
      return;
    }

    setIsScanning(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        alert.alert('Camera permission required', 'Allow camera access to scan a medicine label.');
        return;
      }

      const capture = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (capture.canceled || !capture.assets[0]) return;

      const recognized = await TextRecognition.recognize(capture.assets[0].uri);
      const terms = [...new Set(
        recognized.text.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [],
      )].filter((term) => term.length >= 3);
      if (!terms.length) {
        alert.alert('No medicine text found', 'Try scanning the medicine name or generic name more clearly.');
        return;
      }

      const matches = availableInventory
        .map((batch) => {
          const brand = batch.brand.toLocaleLowerCase();
          const generic = batch.genericName.toLocaleLowerCase();
          const details = [batch.strength, batch.dosageForm, batch.packSize]
            .join(' ')
            .toLocaleLowerCase();
          const score = terms.reduce((total, term) => total
            + (brand.includes(term) ? 3 : 0)
            + (generic.includes(term) ? 2 : 0)
            + (details.includes(term) ? 1 : 0), 0);
          return { batch, score };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score);

      if (!matches.length) {
        setSearchValue(terms.join(' '));
        alert.alert(
          'No matching stock found',
          'The scanned text did not match available inventory. Check the search results or enter the medicine name manually.',
        );
        return;
      }

      setSearchValue(matches[0].batch.brand || matches[0].batch.genericName);
      setError('');
      Keyboard.dismiss();
    } catch (scanError) {
      alert.alert(
        'Medicine scan failed',
        scanError instanceof Error ? scanError.message : 'Could not read text from this image.',
      );
    } finally {
      setIsScanning(false);
    }
  }

  const selectedRows = lines.map((line) => ({
    line,
    batch: inventory.find((row) => row.id === line.batchId),
    quantity: Number.parseInt(line.quantity, 10),
  }));
  const totalUnits = selectedRows.reduce(
    (total, row) => total + (Number.isFinite(row.quantity) ? Math.max(0, row.quantity) : 0),
    0,
  );
  const totalPrice = selectedRows.reduce((total, selected) => {
    if (!selected.batch || !Number.isFinite(selected.quantity) || selected.quantity <= 0) return total;
    return total + roundCurrency(selected.quantity * getUnitPrice(selected.batch.unitPrice));
  }, 0);
  const parsedDiscount = discountValue.trim() ? Number(discountValue) : 0;
  const validDiscount = Number.isFinite(parsedDiscount)
    && parsedDiscount >= 0
    && (discountType === 'percent'
      ? parsedDiscount <= 100
      : parsedDiscount <= totalPrice);
  const discountAmount = validDiscount
    ? roundCurrency(discountType === 'percent'
      ? totalPrice * parsedDiscount / 100
      : parsedDiscount)
    : 0;
  const subtotalAfterDiscount = roundCurrency(Math.max(0, totalPrice - discountAmount));
  const parsedTax = taxRate.trim() ? Number(taxRate) : 0;
  const validTax = Number.isFinite(parsedTax) && parsedTax >= 0 && parsedTax <= 100;
  const taxAmount = validTax ? roundCurrency(subtotalAfterDiscount * parsedTax / 100) : 0;
  const netTotal = roundCurrency(subtotalAfterDiscount + taxAmount);
  const cashRoundingAmount = getCashRoundingAmount(netTotal);
  const roundedTotal = roundCurrency(netTotal + cashRoundingAmount);
  const hasPaymentAmount = paymentAmount.trim() !== '';
  const parsedPayment = hasPaymentAmount ? Number(paymentAmount) : 0;
  const validPayment = Number.isFinite(parsedPayment) && parsedPayment >= 0;
  const dueAmount = validPayment ? roundCurrency(Math.max(0, roundedTotal - parsedPayment)) : 0;
  const changeAmount = validPayment ? roundCurrency(Math.max(0, parsedPayment - roundedTotal)) : 0;

  function addBatchToSale(batch: InventoryRow) {
    setLines((current) => [...current, { batchId: batch.id, quantity: '1' }]);
    setSearchValue('');
    setError('');
  }

  async function saveSale() {
    setError('');
    if (!customerName.trim()) {
      setError('Customer Name is required.');
      return;
    }
    if (lines.length === 0 || selectedRows.some((row) =>
      !row.batch || !Number.isInteger(row.quantity) || row.quantity <= 0)) {
      setError('Add at least one product and enter a valid quantity.');
      return;
    }
    for (const selected of selectedRows) {
      const available = selected.batch ? getAvailableQuantity(selected.batch) : null;
      if (available === null || selected.quantity > available) {
        setError(`Not enough stock for ${selected.batch?.brand ?? 'the selected product'}.`);
        return;
      }
    }
    if (!validDiscount) {
      setError(discountType === 'percent'
        ? 'Discount must be between zero and 100%.'
        : 'Discount cannot exceed total price.');
      return;
    }
    if (!validTax) {
      setError('VAT/TAX must be between zero and 100%.');
      return;
    }
    if (!hasPaymentAmount || !validPayment) {
      setError('Pay amount must be zero or greater.');
      return;
    }
    const selectedMethod = paymentMethods.find((method) => method.id === paymentMethod);
    if (!selectedMethod) {
      setError('Choose a valid payment method.');
      return;
    }
    if (!supabase || !session) {
      setError('Sales data is unavailable. Check your account connection.');
      return;
    }

    const nextInventory = [...inventory];
    const now = new Date();
    const invoiceLines = selectedRows.map(({ batch, quantity }) => {
      if (!batch) throw new Error('A selected inventory batch could not be found.');
      const batchIndex = nextInventory.findIndex((row) => row.id === batch.id);
      if (batchIndex < 0) throw new Error(`Could not find ${batch.brand} in inventory.`);
      const available = getAvailableQuantity(batch);
      if (available === null || quantity > available) {
        throw new Error(`Not enough stock for ${batch.brand}, batch ${batch.batchNumber}.`);
      }
      const nextAvailable = Number((available - quantity).toFixed(4));
      const multiplier = getPackMultiplier(batch.packSize);
      nextInventory[batchIndex] = {
        ...nextInventory[batchIndex],
        availableQuantity: String(nextAvailable),
        ...(multiplier ? { quantity: String(Number((nextAvailable / multiplier).toFixed(4))) } : {}),
        updatedAt: now.toISOString(),
      };
      const unitPrice = getUnitPrice(batch.unitPrice);
      const purchasePrice = batch.unitPurchasePrice?.trim()
        ? Number(batch.unitPurchasePrice)
        : Number.NaN;
      return {
        brand: batch.brand,
        details: [batch.genericName, batch.strength, batch.dosageForm, batch.packSize]
          .filter(Boolean)
          .join(' · '),
        batchNumber: batch.batchNumber,
        packSize: batch.packSize || '-',
        quantity,
        unitPrice,
        totalPrice: roundCurrency(quantity * unitPrice),
        ...(Number.isFinite(purchasePrice) && purchasePrice >= 0
          ? { unitPurchasePrice: purchasePrice }
          : {}),
      };
    });
    const lastInvoiceNumber = salesPayload.reduce((highest, sale) => {
      const number = typeof sale.invoice === 'string'
        ? /^INV-(\d+)$/i.exec(sale.invoice)
        : null;
      return number ? Math.max(highest, Number(number[1])) : highest;
    }, 2086);
    const invoiceId = `INV-${lastInvoiceNumber + 1}`;
    const amount = roundCurrency(roundedTotal);
    const paidAmount = roundCurrency(parsedPayment);
    const due = roundCurrency(Math.max(0, amount - paidAmount));
    const invoice: SaleInvoice = {
      id: invoiceId,
      invoice: invoiceId,
      customer: customerName.trim(),
      ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}),
      items: invoiceLines.length,
      time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      amount,
      subtotalAmount: roundCurrency(totalPrice),
      discountAmount,
      taxRate: roundCurrency(parsedTax),
      taxAmount,
      cashRoundingAmount,
      paidAmount,
      dueAmount: due,
      payment: due > 0 ? 'Due' : 'Paid',
      paymentMethodName: selectedMethod.label,
      createdByUserId: session.user.id,
      payments: paidAmount > 0
        ? [{ methodName: selectedMethod.label, amount: paidAmount }]
        : [],
      createdAt: now.toISOString(),
      lines: invoiceLines,
    };
    const updatedSales = [invoice, ...salesPayload];

    setIsSaving(true);
    try {
      const client = supabase;
      const ownerId = session.user.id;
      const purchaseSaved = await client
        .from('pharmacy_app_data')
        .update({ payload: nextInventory, updated_at: now.toISOString() })
        .eq('owner_user_id', ownerId)
        .eq('data_key', PURCHASE_KEY)
        .select('data_key')
        .maybeSingle();
      if (purchaseSaved.error) throw purchaseSaved.error;
      if (!purchaseSaved.data) throw new Error('Could not update inventory stock for this sale.');

      const salesRecordExists = await client
        .from('pharmacy_app_data')
        .select('data_key')
        .eq('owner_user_id', ownerId)
        .eq('data_key', SALES_KEY)
        .maybeSingle();
      if (salesRecordExists.error) throw salesRecordExists.error;
      const salesSaved = salesRecordExists.data
        ? await client
          .from('pharmacy_app_data')
          .update({ payload: updatedSales, updated_at: now.toISOString() })
          .eq('owner_user_id', ownerId)
          .eq('data_key', SALES_KEY)
          .select('data_key')
          .maybeSingle()
        : await client
          .from('pharmacy_app_data')
          .insert({
            owner_user_id: ownerId,
            data_key: SALES_KEY,
            payload: updatedSales,
            updated_at: now.toISOString(),
          })
          .select('data_key')
          .maybeSingle();
      if (salesSaved.error) throw salesSaved.error;
      if (!salesSaved.data) {
        throw new Error('Inventory was updated, but the sale invoice could not be saved. Please contact support before retrying.');
      }

      setInventory(nextInventory);
      setSalesPayload(updatedSales);
      setSavedInvoice(invoice);
      setLines([]);
      setIsBillSummaryOpen(false);
      setSearchValue('');
      setCustomerName(WALK_IN_CUSTOMER);
      setCustomerPhone('');
      setPaymentAmount('');
      setDiscountType('percent');
      setDiscountValue('');
      setTaxRate(String(defaultTaxRate));
      setPaymentMethod('cash');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this sale.');
    } finally {
      setIsSaving(false);
    }
  }

  function startNewSale() {
    setSavedInvoice(null);
    setLines([]);
    setIsBillSummaryOpen(false);
    setSearchValue('');
    setCustomerName(WALK_IN_CUSTOMER);
    setCustomerPhone('');
    setPaymentAmount('');
    setDiscountType('percent');
    setDiscountValue('');
    setTaxRate(String(defaultTaxRate));
    setPaymentMethod('cash');
    setError('');
    setSalesScrollPositionToTop();
  }

  function setSalesScrollPositionToTop() {
    scrollOffsetRef.current = 0;
    scrollOffsetBeforeKeyboardRef.current = 0;
    salesScrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  async function downloadInvoicePdf() {
    if (!savedInvoice || isSaving) return;
    setIsSaving(true);
    try {
      if (!session) throw new Error('Sign in to load your invoice setup.');
      const invoiceSettings = await loadInvoiceTemplateSettings(session.user.id);
      const html = getInvoiceHtml(savedInvoice, storeName, invoiceSettings);
      const pdf = await Print.printToFileAsync({ html, base64: true });
      if (Platform.OS === 'android') {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
          FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download'),
        );
        if (!permission.granted) return;
        if (!pdf.base64) throw new Error('Could not prepare the invoice PDF for download.');
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          savedInvoice.invoice,
          'application/pdf',
        );
        await FileSystem.writeAsStringAsync(fileUri, pdf.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        alert.alert('Invoice downloaded', `${savedInvoice.invoice}.pdf`);
        return;
      }

      const cacheDirectory = FileSystem.cacheDirectory;
      if (!cacheDirectory) throw new Error('PDF storage is unavailable on this device.');
      const namedPdfUri = `${cacheDirectory}${savedInvoice.invoice}.pdf`;
      const existingPdf = await FileSystem.getInfoAsync(namedPdfUri);
      if (existingPdf.exists) await FileSystem.deleteAsync(namedPdfUri);
      await FileSystem.copyAsync({ from: pdf.uri, to: namedPdfUri });
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('PDF sharing is unavailable on this device.');
      }
      await Sharing.shareAsync(namedPdfUri, {
        UTI: 'com.adobe.pdf',
        mimeType: 'application/pdf',
        dialogTitle: `Save ${savedInvoice.invoice}.pdf`,
      });
    } catch (downloadError) {
      alert.alert(
        'Could not download invoice',
        downloadError instanceof Error ? downloadError.message : 'Please try downloading the PDF again.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function printInvoice() {
    if (!savedInvoice || isSaving) return;
    setIsSaving(true);
    try {
      if (!session) throw new Error('Sign in to load your invoice setup.');
      const invoiceSettings = await loadInvoiceTemplateSettings(session.user.id);
      await Print.printAsync({ html: getInvoiceHtml(savedInvoice, storeName, invoiceSettings) });
    } catch (printError) {
      alert.alert(
        'Could not print invoice',
        printError instanceof Error ? printError.message : 'Please try printing the invoice again.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isAuthLoading || profileLoading || dashboardRole !== 'owner') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </SafeAreaView>
    );
  }

  if (savedInvoice) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#145642" />
        <DashboardSubpageHeader subtitle={`Sales invoice · ${savedInvoice.invoice}`} />
        <ScrollView style={styles.pageContent} contentContainerStyle={styles.receiptContent}>
          <View style={styles.receiptCard}>
            <View style={styles.receiptBrand}>
              <Text style={styles.receiptStoreName}>{storeName || 'Pharmacy Cluster'}</Text>
              <Text style={styles.receiptType}>SALES INVOICE</Text>
            </View>
            <Text style={styles.receiptAmount}>{formatCurrency(savedInvoice.amount)}</Text>
            <Text style={styles.receiptStatus}>
              {savedInvoice.dueAmount > 0 ? 'PAYMENT DUE' : 'PAID'}
            </Text>
            <View style={styles.receiptSection}>
              <ReceiptRow label="Invoice No." value={savedInvoice.invoice} />
              <ReceiptRow label="Customer" value={savedInvoice.customer} />
              {savedInvoice.phone ? <ReceiptRow label="Phone number" value={savedInvoice.phone} /> : null}
              <ReceiptRow
                label="Date and time"
                value={new Date(savedInvoice.createdAt).toLocaleString('en-BD')}
              />
              <ReceiptRow label="Payment method" value={savedInvoice.paymentMethodName} />
            </View>
            <View style={styles.receiptSection}>
              <Text style={styles.receiptSectionTitle}>Items</Text>
              {savedInvoice.lines.map((line, index) => (
                <View key={`${line.batchNumber}-${index}`} style={styles.receiptItem}>
                  <View style={styles.receiptItemInfo}>
                    <Text style={styles.receiptItemName}>{line.brand}</Text>
                    <Text style={styles.receiptItemDetails}>
                      {line.details} · Batch {line.batchNumber}
                    </Text>
                    <Text style={styles.receiptItemDetails}>
                      {line.quantity} × {formatCurrency(line.unitPrice)}
                    </Text>
                  </View>
                  <Text style={styles.receiptItemAmount}>{formatCurrency(line.totalPrice)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.receiptSection}>
              <ReceiptRow label="Subtotal" value={formatCurrency(savedInvoice.subtotalAmount)} />
              <ReceiptRow label="Discount" value={`−${formatCurrency(savedInvoice.discountAmount)}`} />
              <ReceiptRow label={`VAT/TAX (${savedInvoice.taxRate}%)`} value={formatCurrency(savedInvoice.taxAmount)} />
              <ReceiptRow label="Cash rounding" value={formatCurrency(savedInvoice.cashRoundingAmount)} />
              <ReceiptRow label="Total" value={formatCurrency(savedInvoice.amount)} emphasized />
              <ReceiptRow label="Paid" value={formatCurrency(savedInvoice.paidAmount)} />
              <ReceiptRow label="Due" value={formatCurrency(savedInvoice.dueAmount)} />
            </View>
            <Text style={styles.receiptThankYou}>Thank you for your purchase.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
            disabled={isSaving}
            onPress={() => void downloadInvoicePdf()}
            style={[styles.receiptAction, isSaving && styles.buttonDisabled]}>
            <Text style={styles.receiptActionText}>
              {isSaving ? 'Preparing…' : 'Download PDF'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
            disabled={isSaving}
            onPress={() => void printInvoice()}
            style={[styles.receiptAction, styles.receiptPrintAction, isSaving && styles.buttonDisabled]}>
            <Text style={[styles.receiptActionText, styles.receiptPrintText]}>Print Invoice</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={startNewSale}
            style={[styles.receiptAction, styles.newSaleAction, isSaving && styles.buttonDisabled]}>
            <Text style={[styles.receiptActionText, styles.receiptPrintText]}>New Sale</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#145642" />
      <DashboardSubpageHeader
        subtitle={isBillSummaryOpen ? 'Bill summary' : 'New sale'}
        onBack={isBillSummaryOpen ? () => setIsBillSummaryOpen(false) : undefined}
      />
      <ScrollView
        ref={salesScrollRef}
        style={styles.pageContent}
        contentContainerStyle={[
          styles.content,
          keyboardHeight > 0 && { paddingBottom: keyboardHeight + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}>
        {!isBillSummaryOpen ? (
          <>
            <Text style={styles.title}>New Sale</Text>
            <Text style={styles.subtitle}>Select available inventory and add items to the sale.</Text>
          </>
        ) : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRetryKey((previous) => previous + 1)}
              style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : isLoading ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : (
          <>
            {!isBillSummaryOpen ? (
              <>
                <Text style={styles.fieldLabel}>Find medicine</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    ref={(input) => {
                      if (input) inputRefs.current.set('inventorySearch', input);
                      else inputRefs.current.delete('inventorySearch');
                    }}
                    accessibilityLabel="Search inventory brand or generic name"
                    autoCapitalize="none"
                    onChangeText={setSearchValue}
                    placeholder={`Search ${availableInventory.length} inventory batches`}
                    placeholderTextColor="#87928d"
                    onFocus={() => focusSaleInput('inventorySearch')}
                    returnKeyType="search"
                    style={styles.searchInput}
                    value={searchValue}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Scan medicine"
                    accessibilityState={{ disabled: isScanning }}
                    disabled={isScanning}
                    onPress={() => void scanMedicine()}
                    style={[styles.scanButton, isScanning && styles.buttonDisabled]}>
                    {isScanning ? (
                      <ActivityIndicator color="#17664f" />
                    ) : (
                      <SymbolView
                        name={{ ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' }}
                        size={20}
                        tintColor="#17664f"
                      />
                    )}
                  </Pressable>
                </View>
            {searchValue.trim() ? (
              <View style={styles.searchResults}>
                {filteredInventory.length > 0 ? filteredInventory.map((batch) => (
                  <Pressable
                    key={batch.id}
                    accessibilityRole="button"
                    onPress={() => addBatchToSale(batch)}
                    style={styles.productResult}>
                    <View style={styles.productResultInfo}>
                      <Text style={styles.productName}>{batch.brand}</Text>
                      <Text style={styles.productDetails}>
                        {[batch.genericName, batch.strength, batch.dosageForm, batch.packSize]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      <Text style={styles.productDetails}>
                        Batch {batch.batchNumber} · Stock {getAvailableQuantity(batch) ?? '—'}
                      </Text>
                    </View>
                    <Text style={styles.productPrice}>{formatCurrency(getUnitPrice(batch.unitPrice))}</Text>
                  </Pressable>
                )) : (
                  <Text style={styles.noResults}>No available inventory batches found.</Text>
                )}
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Sale items · {lines.length}</Text>
            {selectedRows.length > 0 ? selectedRows.map(({ line, batch }) => (
              <View key={line.batchId} style={styles.saleLine}>
                <View style={styles.lineHeading}>
                  <View style={styles.productResultInfo}>
                    <Text style={styles.productName}>{batch?.brand ?? 'Unknown product'}</Text>
                    <Text style={styles.productDetails}>
                      Batch {batch?.batchNumber ?? '—'} · {batch?.genericName ?? ''}
                      {batch?.strength ? ` · ${batch.strength}` : ''}
                    </Text>
                    <Text style={styles.productDetails}>
                      Unit price {formatCurrency(batch ? getUnitPrice(batch.unitPrice) : 0)}
                      {' · '}Available {batch ? getAvailableQuantity(batch) ?? '—' : '—'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${batch?.brand ?? 'product'}`}
                    onPress={() => {
                      setLines((current) => current.filter(
                        (item) => item.batchId !== line.batchId,
                      ));
                      if (lines.length === 1) setIsBillSummaryOpen(false);
                    }}
                    style={styles.removeButton}>
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </Pressable>
                </View>
                <View style={styles.quantityRow}>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    ref={(input) => {
                      if (input) inputRefs.current.set(line.batchId, input);
                      else inputRefs.current.delete(line.batchId);
                    }}
                    accessibilityLabel={`Quantity for ${batch?.brand ?? 'product'}`}
                    keyboardType="number-pad"
                    onFocus={() => {
                      focusSaleInput(line.batchId);
                      setLines((current) => current.map(
                        (item) => item.batchId === line.batchId
                          ? { ...item, quantity: '' }
                          : item,
                      ));
                    }}
                    onChangeText={(value) => setLines((current) => current.map(
                      (item) => item.batchId === line.batchId ? { ...item, quantity: value } : item,
                    ))}
                    style={styles.quantityInput}
                    value={line.quantity}
                  />
                  <Text style={styles.lineTotal}>
                    {formatCurrency(
                      (Number.parseInt(line.quantity, 10) || 0)
                      * (batch ? getUnitPrice(batch.unitPrice) : 0),
                    )}
                  </Text>
                </View>
              </View>
            )            ) : lines.length > 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Search inventory and add a medicine to begin.</Text>
              </View>
            ) : null}
              </>
            ) : null}

            {isBillSummaryOpen ? (
              <View style={[styles.card, styles.compactCard]}>
                <Text style={[styles.sectionTitle, styles.compactSectionTitle]}>Bill summary</Text>
                <SummaryLine label="Total units" value={String(totalUnits)} compact />
                <SummaryLine label="Subtotal" value={formatCurrency(totalPrice)} compact />
                <View style={[styles.inlineControls, styles.compactControls]}>
                <View style={styles.toggleGroup}>
                  {(['percent', 'flat'] as const).map((type) => (
                    <Pressable
                      key={type}
                      accessibilityRole="button"
                      accessibilityState={{ selected: discountType === type }}
                      onPress={() => {
                        setDiscountType(type);
                        setDiscountValue('');
                      }}
                      style={[
                        styles.toggleButton,
                        styles.compactToggleButton,
                        discountType === type && styles.toggleButtonSelected,
                      ]}>
                      <Text style={[
                        styles.toggleText,
                        styles.compactToggleText,
                        discountType === type && styles.toggleTextSelected,
                      ]}>
                        {type === 'percent' ? 'Discount %' : 'Flat ৳'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  ref={(input) => {
                    if (input) inputRefs.current.set('discount', input);
                    else inputRefs.current.delete('discount');
                  }}
                  accessibilityLabel="Discount amount or percentage"
                  keyboardType="decimal-pad"
                  onFocus={() => focusSaleInput('discount')}
                  onChangeText={setDiscountValue}
                  placeholder={discountType === 'percent' ? '%' : 'Amount'}
                  style={[styles.smallInput, styles.compactInput]}
                  value={discountValue}
                />
                </View>
                {!validDiscount ? (
                  <Text style={styles.inlineError}>
                  {discountType === 'percent'
                    ? 'Discount cannot exceed 100%.'
                    : 'Discount cannot exceed subtotal.'}
                  </Text>
                ) : null}
                <SummaryLine label="Discount" value={`−${formatCurrency(discountAmount)}`} compact />
                <View style={[styles.inlineControls, styles.compactControls]}>
                  <Text style={[styles.summaryLabel, styles.compactSummaryText]}>VAT/TAX %</Text>
                  <TextInput
                  ref={(input) => {
                    if (input) inputRefs.current.set('tax', input);
                    else inputRefs.current.delete('tax');
                  }}
                  accessibilityLabel="VAT/TAX percentage"
                  keyboardType="decimal-pad"
                  onFocus={() => {
                    focusSaleInput('tax');
                    setTaxRate('');
                  }}
                  onChangeText={setTaxRate}
                  style={[styles.smallInput, styles.compactInput]}
                  value={taxRate}
                  />
                </View>
                {!validTax ? <Text style={styles.inlineError}>VAT/TAX must be between 0 and 100%.</Text> : null}
                <SummaryLine label="VAT/TAX" value={`+${formatCurrency(taxAmount)}`} compact />
                <SummaryLine label="Net total" value={formatCurrency(netTotal)} compact />
                <SummaryLine
                  label="Cash rounding"
                  value={`${cashRoundingAmount > 0 ? '+' : ''}${formatCurrency(cashRoundingAmount)}`}
                  compact
                />
                <SummaryLine label="Rounded total" value={formatCurrency(roundedTotal)} emphasized compact />
                <View style={styles.paymentMethodRow}>
                  <Text style={[styles.fieldLabel, styles.compactFieldLabel, styles.paymentMethodLabel]}>
                    Payment method
                  </Text>
                  <View style={styles.paymentMethods}>
                {paymentMethods.map((method) => (
                  <Pressable
                    key={method.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: paymentMethod === method.id }}
                    onPress={() => setPaymentMethod(method.id)}
                    style={[
                      styles.paymentMethod,
                      styles.compactPaymentMethod,
                      paymentMethod === method.id && styles.paymentMethodSelected,
                    ]}>
                    <Text style={[
                      styles.paymentMethodText,
                      styles.compactPaymentMethodText,
                      paymentMethod === method.id && styles.paymentMethodTextSelected,
                    ]}>
                      {method.label}
                    </Text>
                  </Pressable>
                ))}
                  </View>
                </View>
                <Text style={[styles.fieldLabel, styles.compactFieldLabel]}>Pay amount</Text>
                <TextInput
                ref={(input) => {
                  if (input) inputRefs.current.set('paymentAmount', input);
                  else inputRefs.current.delete('paymentAmount');
                }}
                accessibilityLabel="Pay amount"
                keyboardType="decimal-pad"
                onFocus={() => focusSaleInput('paymentAmount')}
                onChangeText={setPaymentAmount}
                placeholder="Enter paid amount"
                style={[styles.amountInput, styles.compactAmountInput]}
                value={paymentAmount}
                />
                <SummaryLine label="Due" value={hasPaymentAmount && validPayment
                  ? formatCurrency(dueAmount)
                  : 'Enter pay amount'} due={dueAmount > 0} compact />
                <SummaryLine label="Change cash" value={hasPaymentAmount && validPayment
                  ? formatCurrency(changeAmount)
                  : 'Enter pay amount'} compact />
                <Text style={[styles.fieldLabel, styles.compactFieldLabel]}>Customer name *</Text>
                <TextInput
                  ref={(input) => {
                    if (input) inputRefs.current.set('customerName', input);
                    else inputRefs.current.delete('customerName');
                  }}
                  accessibilityLabel="Customer name"
                  onFocus={() => {
                    focusSaleInput('customerName');
                    if (customerName === WALK_IN_CUSTOMER) setCustomerName('');
                  }}
                  onBlur={() => {
                    if (!customerName.trim()) setCustomerName(WALK_IN_CUSTOMER);
                  }}
                  onChangeText={setCustomerName}
                  placeholder={WALK_IN_CUSTOMER}
                  style={[styles.amountInput, styles.compactAmountInput]}
                  value={customerName}
                />
                <Text style={[styles.fieldLabel, styles.compactFieldLabel]}>Phone number (optional)</Text>
                <TextInput
                  ref={(input) => {
                    if (input) inputRefs.current.set('customerPhone', input);
                    else inputRefs.current.delete('customerPhone');
                  }}
                  accessibilityLabel="Customer phone number"
                  keyboardType="phone-pad"
                  onFocus={() => focusSaleInput('customerPhone')}
                  onChangeText={setCustomerPhone}
                  placeholder="Enter phone number"
                  style={[styles.amountInput, styles.compactAmountInput]}
                  value={customerPhone}
                />
                {error ? <Text style={styles.inlineError}>{error}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSaving }}
                  disabled={isSaving}
                  onPress={() => void saveSale()}
                  style={[styles.saveButton, isSaving && styles.buttonDisabled]}>
                  <Text style={styles.saveButtonText}>
                    {isSaving ? 'Saving sale…' : 'Save Sale'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {!isBillSummaryOpen && !loadError && !isLoading && lines.length > 0 ? (
        <View style={styles.totalBar}>
          <View style={styles.totalBarText}>
            <Text style={styles.totalBarLabel}>Total Price</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.totalBarAmount}>
              {formatCurrency(roundedTotal)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open bill summary"
            onPress={() => setIsBillSummaryOpen(true)}
            style={styles.totalBarArrow}>
            <Text style={styles.totalBarArrowText}>→</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ReceiptRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <View style={styles.receiptRow}>
      <Text style={[styles.receiptLabel, emphasized && styles.receiptEmphasized]}>
        {label}
      </Text>
      <Text style={[styles.receiptValue, emphasized && styles.receiptEmphasized]}>
        {value}
      </Text>
    </View>
  );
}

function SummaryLine({
  label,
  value,
  emphasized = false,
  due = false,
  compact = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  due?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[styles.summaryLine, compact && styles.compactSummaryLine]}>
      <Text style={[
        styles.summaryLabel,
        compact && styles.compactSummaryText,
        emphasized && styles.emphasizedText,
      ]}>{label}</Text>
      <Text style={[
        styles.summaryValue,
        compact && styles.compactSummaryText,
        emphasized && styles.emphasizedText,
        due && styles.dueText,
      ]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#145642' },
  pageContent: { flex: 1, backgroundColor: '#f4f8f5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f8f5' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 18, paddingBottom: 32 },
  receiptContent: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 16,
    paddingBottom: 28,
    gap: 10,
  },
  receiptCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  receiptBrand: {
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#d8e1da',
  },
  receiptStoreName: { color: '#145642', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  receiptType: { marginTop: 4, color: '#738078', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  receiptAmount: { marginTop: 16, color: '#173c2c', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  receiptStatus: { marginTop: 4, color: '#17704e', fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  receiptSection: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e7ece8', gap: 9 },
  receiptSectionTitle: { marginBottom: 2, color: '#203128', fontSize: 13, fontWeight: '800' },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  receiptLabel: { flex: 1, color: '#758179', fontSize: 11 },
  receiptValue: { flex: 1, color: '#26352f', fontSize: 11, fontWeight: '600', textAlign: 'right' },
  receiptEmphasized: { color: '#145642', fontSize: 13, fontWeight: '800' },
  receiptItem: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#edf0ed' },
  receiptItemInfo: { flex: 1 },
  receiptItemName: { color: '#26352f', fontSize: 11, fontWeight: '700' },
  receiptItemDetails: { marginTop: 3, color: '#758179', fontSize: 9, lineHeight: 13 },
  receiptItemAmount: { color: '#26352f', fontSize: 11, fontWeight: '700' },
  receiptThankYou: { marginTop: 16, color: '#758179', fontSize: 10, textAlign: 'center' },
  receiptAction: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#179c70' },
  receiptActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  receiptPrintAction: { borderWidth: 1, borderColor: '#17664f', backgroundColor: '#fff' },
  receiptPrintText: { color: '#17664f' },
  newSaleAction: { backgroundColor: '#eef8f2', borderColor: '#cfe5d7' },
  title: { color: '#102d2a', fontSize: 22, fontWeight: '800' },
  subtitle: { marginTop: 6, marginBottom: 16, color: '#59706d', fontSize: 12, lineHeight: 18 },
  loader: { marginTop: 40 },
  errorCard: { padding: 16, borderWidth: 1, borderColor: '#f0d3cd', borderRadius: 14, backgroundColor: '#fff8f6' },
  errorText: { color: '#a63e34', fontSize: 13, lineHeight: 19 },
  retryButton: { alignSelf: 'flex-start', marginTop: 10 },
  retryButtonText: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  fieldLabel: { marginTop: 10, marginBottom: 6, color: '#526158', fontSize: 12, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce5df', borderRadius: 10, backgroundColor: '#fff', color: '#203128', fontSize: 13 },
  scanButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cfe5d7', borderRadius: 10, backgroundColor: '#eef8f2' },
  searchResults: { marginTop: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 10, backgroundColor: '#fff' },
  productResult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#edf0ed' },
  productResultInfo: { flex: 1 },
  productName: { color: '#26352f', fontSize: 13, fontWeight: '800' },
  productDetails: { marginTop: 4, color: '#77857d', fontSize: 10, lineHeight: 15 },
  productPrice: { color: '#17704e', fontSize: 12, fontWeight: '800' },
  noResults: { padding: 13, color: '#77857d', fontSize: 12 },
  sectionTitle: { marginTop: 18, marginBottom: 10, color: '#203128', fontSize: 15, fontWeight: '800' },
  saleLine: { marginTop: 9, padding: 13, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 12, backgroundColor: '#fff' },
  lineHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  removeButton: { paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#f0d3cd', borderRadius: 7 },
  removeButtonText: { color: '#a63e34', fontSize: 10, fontWeight: '700' },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#edf0ed' },
  quantityInput: { width: 72, minHeight: 38, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5df', borderRadius: 8, backgroundColor: '#fff', color: '#203128', textAlign: 'center' },
  lineTotal: { flex: 1, color: '#17704e', fontSize: 13, fontWeight: '800', textAlign: 'right' },
  emptyCard: { padding: 14, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 12, backgroundColor: '#fff' },
  emptyText: { color: '#7b8981', fontSize: 12 },
  card: { gap: 11, marginTop: 14, padding: 15, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 14, backgroundColor: '#fff' },
  compactCard: { gap: 6, padding: 11 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  compactSummaryLine: { minHeight: 18 },
  summaryLabel: { flex: 1, color: '#526158', fontSize: 12 },
  summaryValue: { color: '#34453b', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  compactSummaryText: { fontSize: 11 },
  compactSectionTitle: { marginTop: 0, marginBottom: 2, fontSize: 14 },
  emphasizedText: { color: '#17704e', fontSize: 14, fontWeight: '800' },
  dueText: { color: '#ad4b43' },
  inlineControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  compactControls: { gap: 7 },
  toggleGroup: { flexDirection: 'row', gap: 7 },
  toggleButton: { paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: '#dce5df', borderRadius: 7, backgroundColor: '#fff' },
  compactToggleButton: { paddingVertical: 5 },
  toggleButtonSelected: { borderColor: '#179c70', backgroundColor: '#eef8f2' },
  toggleText: { color: '#526158', fontSize: 10 },
  compactToggleText: { fontSize: 9 },
  toggleTextSelected: { color: '#17704e', fontWeight: '700' },
  smallInput: { width: 100, minHeight: 36, paddingHorizontal: 9, borderWidth: 1, borderColor: '#dce5df', borderRadius: 7, backgroundColor: '#fff', color: '#203128', textAlign: 'right' },
  compactInput: { minHeight: 28, paddingHorizontal: 7, fontSize: 11 },
  inlineError: { color: '#ad4b43', fontSize: 11, lineHeight: 16 },
  paymentMethods: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7 },
  paymentMethodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  paymentMethodLabel: { flexShrink: 0 },
  paymentMethod: { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#dce5df', borderRadius: 7, backgroundColor: '#fff' },
  compactPaymentMethod: { paddingVertical: 5 },
  paymentMethodSelected: { borderColor: '#179c70', backgroundColor: '#eef8f2' },
  paymentMethodText: { color: '#526158', fontSize: 11 },
  compactPaymentMethodText: { fontSize: 10 },
  paymentMethodTextSelected: { color: '#17704e', fontWeight: '700' },
  amountInput: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce5df', borderRadius: 8, backgroundColor: '#fff', color: '#203128', fontSize: 13 },
  compactAmountInput: { minHeight: 32, paddingHorizontal: 9, fontSize: 11 },
  compactFieldLabel: { marginTop: 4, marginBottom: 3, fontSize: 11 },
  saveButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 15, borderRadius: 11, backgroundColor: '#179c70' },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  totalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e3e9e4',
    backgroundColor: '#fff',
  },
  totalBarText: { flex: 1, alignItems: 'flex-start' },
  totalBarLabel: { color: '#687871', fontSize: 11, fontWeight: '600' },
  totalBarAmount: { marginTop: 3, color: '#173c2c', fontSize: 17, fontWeight: '800' },
  totalBarArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#17664f',
  },
  totalBarArrowText: { color: '#fff', fontSize: 27, fontWeight: '600', lineHeight: 32 },
});
