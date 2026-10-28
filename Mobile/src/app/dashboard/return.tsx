import { Text, TextInput, useLocalizedAlert } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { Camera, CameraView } from 'expo-camera';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

const SALES_KEY = 'pharmacy-sales-list-v1';
const PURCHASE_KEY = 'pharmacy-purchase-list-v1';
const RETURNS_KEY = 'pharmacy-return-records-v1';
const RETURN_DEDUCTION_SETTINGS_KEY = 'pharmacy-return-deduction-settings-v1';
const WALK_IN_CUSTOMER = 'Walk-in customer';
const SCAN_FRAME_INTERVAL_MS = 100;
const SCAN_TIMEOUT_MS = 1000;

type SaleLine = {
  brand: string;
  details: string;
  batchNumber: string;
  packSize: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type SaleInvoice = {
  id: string;
  invoice: string;
  customer: string;
  phone?: string;
  createdAt: string;
  lines: SaleLine[];
};

type ReturnRecord = {
  id: string;
  returnId: string;
  invoice: string;
  reInvoice: string;
  reBatch: string;
  product: string;
  brand: string;
  batchNumber: string;
  quantity: number;
  amount: number;
  netRefundAmount?: number;
  customer: string;
  phone: string;
  returnMethod: 'Cash Return' | 'Product Adjust';
  date: string;
  reason: string;
  status: string;
};

type SelectedReturnItem = {
  key: string;
  invoice: SaleInvoice;
  line: SaleLine;
  quantity: string;
};

type PurchaseRow = {
  id: string;
  brand: string;
  batchNumber: string;
  packSize: string;
  status: string;
  quantity?: string;
  availableQuantity?: string;
  updatedAt?: string;
};

type Screen = 'list' | 'record' | 'summary';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInvoices(value: unknown): SaleInvoice[] {
  if (!Array.isArray(value)) throw new Error('Saved sales data has an invalid format.');
  return value.flatMap((entry): SaleInvoice[] => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.invoice !== 'string'
      || typeof entry.customer !== 'string'
      || typeof entry.createdAt !== 'string'
      || !Array.isArray(entry.lines)
    ) return [];
    const lines = entry.lines.flatMap((line): SaleLine[] => {
      if (
        !isRecord(line)
        || typeof line.brand !== 'string'
        || typeof line.details !== 'string'
        || typeof line.batchNumber !== 'string'
        || typeof line.packSize !== 'string'
        || typeof line.quantity !== 'number'
        || typeof line.unitPrice !== 'number'
        || typeof line.totalPrice !== 'number'
      ) return [];
      return [{
        brand: line.brand,
        details: line.details,
        batchNumber: line.batchNumber,
        packSize: line.packSize,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
      }];
    });
    return [{
      id: entry.id,
      invoice: entry.invoice,
      customer: entry.customer,
      ...(typeof entry.phone === 'string' ? { phone: entry.phone } : {}),
      createdAt: entry.createdAt,
      lines,
    }];
  });
}

function parseReturns(value: unknown): ReturnRecord[] {
  if (!Array.isArray(value)) throw new Error('Saved return records have an invalid format.');
  return value.map((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.invoice !== 'string'
      || typeof entry.product !== 'string'
      || typeof entry.date !== 'string'
    ) throw new Error('Saved return records contain an invalid entry.');
    return {
      id: entry.id,
      returnId: typeof entry.returnId === 'string' ? entry.returnId : entry.id,
      invoice: entry.invoice,
      reInvoice: typeof entry.reInvoice === 'string' ? entry.reInvoice : '',
      reBatch: typeof entry.reBatch === 'string' ? entry.reBatch : '',
      product: entry.product,
      brand: typeof entry.brand === 'string' ? entry.brand : '',
      batchNumber: typeof entry.batchNumber === 'string' ? entry.batchNumber : '',
      quantity: typeof entry.quantity === 'number' ? entry.quantity : 0,
      amount: typeof entry.amount === 'number' ? entry.amount : 0,
      ...(typeof entry.netRefundAmount === 'number' ? { netRefundAmount: entry.netRefundAmount } : {}),
      customer: typeof entry.customer === 'string' ? entry.customer : WALK_IN_CUSTOMER,
      phone: typeof entry.phone === 'string' ? entry.phone : '',
      returnMethod: entry.returnMethod === 'Product Adjust' ? 'Product Adjust' : 'Cash Return',
      date: entry.date,
      reason: typeof entry.reason === 'string' ? entry.reason : 'Product return',
      status: typeof entry.status === 'string' ? entry.status : 'Pending',
    };
  });
}

function money(value: number) {
  return `${getCurrencySymbol()}${value.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function returnInvoice(invoice: string) {
  const number = /(\d+)$/.exec(invoice)?.[1];
  return `RET-${number ?? invoice}`;
}

function returnBatch(batch: string) {
  return `Re-${batch || 'N/A'}`;
}

function returnKey(invoice: SaleInvoice, line: SaleLine, index: number) {
  return `${invoice.id}-${line.batchNumber}-${index}`;
}

function getBrandWords(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{M}]+/gu) ?? [];
}

function getBrandMatchScore(brand: string, scannedText: string) {
  const scannedWords = new Set(getBrandWords(scannedText));
  return new Set(getBrandWords(brand).filter((word) => scannedWords.has(word))).size;
}

async function persistPayload(
  client: NonNullable<typeof supabase>,
  ownerId: string,
  key: string,
  payload: unknown[],
) {
  const existing = await client.from('pharmacy_app_data')
    .select('data_key')
    .eq('owner_user_id', ownerId)
    .eq('data_key', key)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const result = existing.data
    ? await client.from('pharmacy_app_data')
      .update({ payload, updated_at: new Date().toISOString() })
      .eq('owner_user_id', ownerId)
      .eq('data_key', key)
      .select('data_key')
      .maybeSingle()
    : await client.from('pharmacy_app_data')
      .insert({ owner_user_id: ownerId, data_key: key, payload, updated_at: new Date().toISOString() })
      .select('data_key')
      .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Could not save return data.');
}

export default function ReturnScreen() {
  const alert = useLocalizedAlert();
  const { dashboardRole, isLoading: authLoading, profileLoading, session } = useAuth();
  const [screen, setScreen] = useState<Screen>('list');
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRow[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedReturnItem[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [returnMethod, setReturnMethod] = useState<'Cash Return' | 'Product Adjust'>('Cash Return');
  const [defaultReturnDeductionRate, setDefaultReturnDeductionRate] = useState(0);
  const [returnDeductionRate, setReturnDeductionRate] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRecognizingFrame, setIsRecognizingFrame] = useState(false);
  const [scanNotFound, setScanNotFound] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  const quantitiesAlreadyReturned = (invoice: string, line: SaleLine) => returns
    .filter((record) => record.invoice === invoice
      && record.brand.toLocaleLowerCase() === line.brand.toLocaleLowerCase()
      && record.batchNumber === line.batchNumber)
    .reduce((total, record) => total + record.quantity, 0);
  const availableQuantity = (invoice: string, line: SaleLine) =>
    Math.max(0, line.quantity - quantitiesAlreadyReturned(invoice, line));

  useEffect(() => {
    if (authLoading || profileLoading || dashboardRole !== 'owner' || !session || !supabase) return;
    let active = true;
    const client = supabase;
    const ownerId = session.user.id;

    async function loadData() {
      setLoading(true);
      setError('');
      try {
        const result = await client.from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', ownerId)
          .in('data_key', [SALES_KEY, PURCHASE_KEY, RETURNS_KEY, RETURN_DEDUCTION_SETTINGS_KEY]);
        if (result.error) throw result.error;
        const payloads = new Map((result.data ?? []).map((row) => [row.data_key, row.payload]));
        const nextInvoices = parseInvoices(payloads.get(SALES_KEY) ?? []);
        const nextReturns = parseReturns(payloads.get(RETURNS_KEY) ?? []);
        const nextPurchaseRows = payloads.get(PURCHASE_KEY) ?? [];
        const deductionSettings = payloads.get(RETURN_DEDUCTION_SETTINGS_KEY);
        let nextDeductionRate = 0;
        if (deductionSettings !== undefined && deductionSettings !== null) {
          if (!isRecord(deductionSettings)
            || typeof deductionSettings.defaultRate !== 'number'
            || !Number.isFinite(deductionSettings.defaultRate)
            || deductionSettings.defaultRate < 0
            || deductionSettings.defaultRate > 100) {
            throw new Error('Saved return deduction settings are invalid. Update the rate in Pharmacy Setup.');
          }
          nextDeductionRate = deductionSettings.defaultRate;
        }
        if (!Array.isArray(nextPurchaseRows) || nextPurchaseRows.some((row) =>
          !isRecord(row)
          || typeof row.id !== 'string'
          || typeof row.brand !== 'string'
          || typeof row.batchNumber !== 'string'
          || typeof row.packSize !== 'string'
          || typeof row.status !== 'string'
        )) throw new Error('Saved purchase inventory has an invalid format.');
        if (active) {
          setInvoices(nextInvoices);
          setReturns(nextReturns);
          setPurchaseRows(nextPurchaseRows as PurchaseRow[]);
          setDefaultReturnDeductionRate(nextDeductionRate);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load return data.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadData();
    return () => {
      active = false;
    };
  }, [authLoading, dashboardRole, profileLoading, retry, session]);

  const query = searchValue.trim().toLocaleLowerCase();
  const matchingItems = useMemo(() => {
    if (!query) return [];
    const invoiceMatches = invoices.filter((invoice) => invoice.invoice.toLocaleLowerCase().includes(query));
    const selectedKeys = new Set(selectedItems.map((item) => item.key));
    return invoices.flatMap((invoice) => (invoice.lines ?? []).flatMap((line, index) => {
      const key = returnKey(invoice, line, index);
      const matchesInvoice = invoiceMatches.some((match) => match.id === invoice.id);
      const matchesBrand = `${line.brand} ${line.details}`.toLocaleLowerCase().includes(query);
      const alreadyReturned = returns
        .filter((record) => record.invoice === invoice.invoice
          && record.brand.toLocaleLowerCase() === line.brand.toLocaleLowerCase()
          && record.batchNumber === line.batchNumber)
        .reduce((total, record) => total + record.quantity, 0);
      if ((!matchesInvoice && !matchesBrand)
        || selectedKeys.has(key)
        || line.quantity - alreadyReturned < 1) return [];
      return [{ key, invoice, line, index }];
    })).slice(0, 20);
  }, [invoices, query, returns, selectedItems]);

  useEffect(() => {
    if (!isScannerOpen || !isCameraReady) return;
    let active = true;
    let complete = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scanStartedAt = Date.now();
    const brands = [...new Set([
      ...returns.map((record) => record.brand),
      ...invoices.flatMap((invoice) => invoice.lines.map((line) => line.brand)),
    ].map((brand) => brand.trim()).filter(Boolean))];

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

        const matches = brands
          .map((brand) => ({ brand, score: getBrandMatchScore(brand, recognized.text) }))
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score);
        const bestScore = matches[0]?.score ?? 0;
        if (bestScore > 0) {
          complete = true;
          setSearchValue(matches[0].brand);
          setScanNotFound(false);
          setError('');
          setIsScannerOpen(false);
          Keyboard.dismiss();
        } else if (Date.now() - scanStartedAt >= SCAN_TIMEOUT_MS) {
          complete = true;
          setScanNotFound(true);
          setIsScannerOpen(false);
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
  }, [alert, invoices, isCameraReady, isScannerOpen, returns]);

  async function startCameraScan() {
    if (Platform.OS === 'web') {
      alert.alert('Camera scan unavailable', 'Medicine scanning is available in the Android and iOS app.');
      return;
    }
    setSearchValue('');
    setScanNotFound(false);
    setIsCameraReady(false);
    try {
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        alert.alert('Camera permission required', 'Allow camera access to scan a medicine brand.');
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

  const returnTotal = selectedItems.reduce(
    (total, item) => total + item.line.unitPrice * (Number(item.quantity) || 0),
    0,
  );
  const deductionRate = Number(returnDeductionRate) || 0;
  const returnDeductionAmount = Number((returnTotal * deductionRate / 100).toFixed(2));
  const netRefundAmount = Math.max(0, Number((returnTotal - returnTotal * deductionRate / 100).toFixed(2)));

  function openRecordReturn() {
    setSelectedItems([]);
    setSearchValue('');
    setReturnMethod('Cash Return');
    setReturnDeductionRate(String(defaultReturnDeductionRate));
    setError('');
    setScreen('record');
  }

  function addItem(invoice: SaleInvoice, line: SaleLine, index: number) {
    const key = returnKey(invoice, line, index);
    if (availableQuantity(invoice.invoice, line) < 1) {
      setError('This invoice item has already been fully returned.');
      return;
    }
    setSelectedItems((current) => current.some((item) => item.key === key)
      ? current
      : [...current, { key, invoice, line, quantity: '1' }]);
    setSearchValue('');
    setError('');
  }

  function updateQuantity(key: string, value: string, maximum: number) {
    const digits = value.replace(/\D/g, '');
    const quantity = Number(digits);
    const boundedValue = digits && quantity > maximum ? String(maximum) : digits;
    setSelectedItems((current) => current.map((item) =>
      item.key === key ? { ...item, quantity: boundedValue } : item));
  }

  function adjustInventory(lines: SelectedReturnItem[]) {
    const nextRows = [...purchaseRows];
    lines.forEach(({ line, quantity }) => {
      const rowIndex = nextRows.findIndex((row) =>
        row.brand.trim().toLocaleLowerCase() === line.brand.trim().toLocaleLowerCase()
        && row.batchNumber.trim() === line.batchNumber.trim());
      if (rowIndex < 0) {
        throw new Error(`Could not find ${line.brand}, batch ${line.batchNumber} in inventory.`);
      }
      const row = nextRows[rowIndex];
      const packFactors = row.packSize.match(/\d[\d,]*(?:\.\d+)?/g)
        ?.map((part) => Number(part.replace(/,/g, ''))) ?? [];
      const multiplier = packFactors.length > 0
        ? packFactors.reduce((total, factor) => total * factor, 1)
        : 0;
      const returned = Number(quantity);
      const oldAvailable = row.availableQuantity !== undefined
        ? Number(row.availableQuantity)
        : Number(row.quantity ?? '') * multiplier;
      if (
        !Number.isFinite(multiplier) || multiplier <= 0
        || !Number.isFinite(oldAvailable) || oldAvailable < 0
      ) {
        throw new Error(`Could not determine inventory quantity for ${row.brand}, batch ${row.batchNumber}.`);
      }
      const nextAvailable = Number((oldAvailable + returned).toFixed(4));
      nextRows[rowIndex] = {
        ...row,
        availableQuantity: String(nextAvailable),
        ...(multiplier > 0 ? { quantity: String(Number((nextAvailable / multiplier).toFixed(4))) } : {}),
        updatedAt: new Date().toISOString(),
      };
    });
    return nextRows;
  }

  async function recordReturn() {
    if (!supabase || !session) {
      setError('Return data is unavailable. Check your account connection.');
      return;
    }
    if (selectedItems.length === 0) {
      setError('Search and add at least one invoice product.');
      return;
    }
    const invalidItem = selectedItems.find((item) => {
      const quantity = Number(item.quantity);
      return !Number.isInteger(quantity)
        || quantity < 1
        || quantity > availableQuantity(item.invoice.invoice, item.line);
    });
    if (invalidItem) {
      setError(`Return quantity must be between 1 and ${availableQuantity(invalidItem.invoice.invoice, invalidItem.line)} for ${invalidItem.line.brand}.`);
      setScreen('record');
      return;
    }
    const parsedDeductionRate = Number(returnDeductionRate);
    if (returnDeductionRate.trim() === ''
      || !Number.isFinite(parsedDeductionRate)
      || parsedDeductionRate < 0
      || parsedDeductionRate > 100) {
      setError('Return deduction must be between 0 and 100%.');
      setScreen('summary');
      return;
    }
    const timestamp = new Date();
    const returnIdNumber = returns.reduce((highest, row) => {
      const match = /^RE-ID-(\d+)$/i.exec(row.returnId);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
    const recordIdNumber = returns.reduce((highest, row) => {
      const match = /^RET-(\d+)$/i.exec(row.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 124) + 1;
    const returnId = `RE-ID-${String(returnIdNumber).padStart(4, '0')}`;
    const date = timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const records = selectedItems.map((item, index): ReturnRecord => {
      const quantity = Number(item.quantity);
      return {
        id: `RET-${String(recordIdNumber + index).padStart(4, '0')}`,
        returnId,
        invoice: item.invoice.invoice,
        reInvoice: returnInvoice(item.invoice.invoice),
        reBatch: returnBatch(item.line.batchNumber),
        product: `${item.line.brand} · Qty ${quantity} · Batch ${item.line.batchNumber || '-'}`,
        brand: item.line.brand,
        batchNumber: item.line.batchNumber,
        quantity,
        amount: Number((item.line.unitPrice * quantity).toFixed(2)),
        ...(index === 0 ? { netRefundAmount: returnMethod === 'Cash Return' ? netRefundAmount : 0 } : {}),
        customer: item.invoice.customer.trim() || WALK_IN_CUSTOMER,
        phone: item.invoice.phone ?? '',
        returnMethod,
        date,
        reason: 'Product return',
        status: 'Pending',
      };
    });
    const nextReturns = [...records, ...returns];
    setSaving(true);
    setError('');
    try {
      const client = supabase;
      const ownerId = session.user.id;
      const nextPurchase = adjustInventory(selectedItems);
      const purchaseChanged = nextPurchase.some((row, index) => row !== purchaseRows[index]);
      if (purchaseChanged) {
        await persistPayload(client, ownerId, PURCHASE_KEY, nextPurchase);
      }
      try {
        await persistPayload(client, ownerId, RETURNS_KEY, nextReturns);
      } catch (returnSaveError) {
        if (purchaseChanged) {
          try {
            await persistPayload(client, ownerId, PURCHASE_KEY, purchaseRows);
          } catch (rollbackError) {
            throw new Error(
              `Could not save return records, and inventory rollback failed: ${rollbackError instanceof Error ? rollbackError.message : 'unknown error'}`,
            );
          }
        }
        throw returnSaveError;
      }
      setReturns(nextReturns);
      setPurchaseRows(nextPurchase);
      setScreen('list');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this return.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || profileLoading) {
    return <SafeAreaView edges={['top', 'left', 'right']} style={styles.center}><ActivityIndicator size="large" color="#17664f" /></SafeAreaView>;
  }
  if (dashboardRole !== 'owner') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
        <DashboardSubpageHeader subtitle="Returns" onBack={() => router.replace('/dashboard')} />
        <View style={styles.center}><Text style={styles.error}>Returns are available to store owners.</Text></View>
      </SafeAreaView>
    );
  }
  if (!supabase || !session) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
        <DashboardSubpageHeader subtitle="Returns" onBack={() => router.replace('/dashboard')} />
        <View style={styles.center}><Text style={styles.error}>Return data is unavailable. Check your account connection.</Text></View>
      </SafeAreaView>
    );
  }

  const headerTitle = screen === 'list' ? 'Return System' : screen === 'record' ? 'Record Return' : 'Bill Summary';
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
      <DashboardSubpageHeader
        subtitle={headerTitle}
        onBack={() => {
          if (screen === 'summary') setScreen('record');
          else if (screen === 'record') setScreen('list');
          else router.replace('/dashboard');
        }}
      />
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {screen === 'list' ? (
          <>
            <View style={styles.headingRow}>
              <View style={styles.flex}>
                <Text style={styles.title}>Return System</Text>
                <Text style={styles.subtitle}>Review returned products and record invoice returns.</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={openRecordReturn} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Record Return</Text>
              </Pressable>
            </View>
            <View style={styles.searchRow}>
              <TextInput
                accessibilityLabel="Search returns"
                value={searchValue}
                onChangeText={(value) => {
                  setSearchValue(value);
                  setScanNotFound(false);
                }}
                placeholder="Search return ID, invoice, brand or batch"
                placeholderTextColor="#87928d"
                style={styles.search}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan product brand"
                onPress={() => void startCameraScan()}
                style={styles.scanButton}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' }}
                  size={20}
                  tintColor="#17664f"
                />
              </Pressable>
            </View>
            {scanNotFound ? (
              <View style={styles.scanMessageRow}>
                <Text style={styles.scanNotFound}>Not Found</Text>
                <Pressable onPress={() => void startCameraScan()}>
                  <Text style={styles.link}>New Search</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.error}>{error}</Text>
                <Pressable onPress={() => setRetry((value) => value + 1)}>
                  <Text style={styles.link}>Retry</Text>
                </Pressable>
              </View>
            ) : loading ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="small" color="#17664f" />
                <Text style={styles.subtitle}>Loading return records…</Text>
              </View>
            ) : (
              returns
                .filter((record) => !searchValue.trim() || [
                  record.returnId, record.invoice, record.brand, record.batchNumber,
                ].some((value) => value.toLocaleLowerCase().includes(searchValue.trim().toLocaleLowerCase())))
                .map((record) => (
                  <View key={record.id} style={styles.card}>
                    <View style={styles.headingRow}>
                      <Text style={styles.cardTitle}>{record.returnId}</Text>
                      <Text style={styles.status}>{record.returnMethod}</Text>
                    </View>
                    <Text style={styles.primaryText}>{record.product}</Text>
                    <Text style={styles.muted}>{record.invoice} · {record.customer}</Text>
                    {record.phone ? <Text style={styles.muted}>{record.phone}</Text> : null}
                    <View style={styles.headingRow}>
                      <Text style={styles.muted}>{record.date}</Text>
                      <Text style={styles.amount}>{money(record.amount)}</Text>
                    </View>
                  </View>
                ))
            )}
            {!loading && !error && returns.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.cardTitle}>No returns recorded</Text>
                <Text style={styles.muted}>Record a return to add it to the Return System.</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {screen === 'record' ? (
          <>
            <Text style={styles.title}>Record Return</Text>
            <Text style={styles.subtitle}>Search only products sold on saved invoices.</Text>
            <View style={styles.searchRow}>
              <TextInput
                accessibilityLabel="Search invoice products by invoice number or brand name"
                autoCapitalize="none"
                value={searchValue}
                onChangeText={(value) => {
                  setSearchValue(value);
                  setScanNotFound(false);
                  setError('');
                }}
                placeholder="Invoice number or brand name"
                placeholderTextColor="#87928d"
                style={styles.search}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan product brand"
                onPress={() => void startCameraScan()}
                style={styles.scanButton}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' }}
                  size={20}
                  tintColor="#17664f"
                />
              </Pressable>
            </View>
            {scanNotFound ? (
              <View style={styles.scanMessageRow}>
                <Text style={styles.scanNotFound}>Not Found</Text>
                <Pressable onPress={() => void startCameraScan()}>
                  <Text style={styles.link}>New Search</Text>
                </Pressable>
              </View>
            ) : null}
            {matchingItems.map(({ key, invoice, line, index }) => (
              <Pressable key={key} onPress={() => addItem(invoice, line, index)} style={styles.card}>
                <Text style={styles.cardTitle}>{line.brand}</Text>
                <Text style={styles.muted}>Invoice: {invoice.invoice} · Sold: {line.quantity} · Batch: {line.batchNumber || '-'}</Text>
                <Text style={styles.muted}>Unit price: {money(line.unitPrice)} · Total: {money(line.totalPrice)}</Text>
                <Text style={styles.link}>Add to return</Text>
              </Pressable>
            ))}
            {query && matchingItems.length === 0 ? (
              <Text style={styles.muted}>No matching products found in saved sales invoices.</Text>
            ) : null}
            <Text style={styles.sectionTitle}>Return Invoice ({selectedItems.length})</Text>
            {selectedItems.map((item) => {
              const maximum = availableQuantity(item.invoice.invoice, item.line);
              return (
                <View key={item.key} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.line.brand}</Text>
                  <Text style={styles.muted}>Invoice: {item.invoice.invoice} · Batch: {item.line.batchNumber || '-'}</Text>
                  <Text style={styles.muted}>Sold {item.line.quantity} · Returnable {maximum} · Unit price {money(item.line.unitPrice)}</Text>
                  <View style={styles.headingRow}>
                    <Text style={styles.label}>Return Qty</Text>
                    <TextInput
                      accessibilityLabel={`Return quantity for ${item.line.brand}`}
                      keyboardType="number-pad"
                      value={item.quantity}
                      onChangeText={(value) => updateQuantity(item.key, value, maximum)}
                      style={styles.quantityInput}
                    />
                    <Pressable onPress={() => setSelectedItems((current) => current.filter((entry) => entry.key !== item.key))}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                    <Text style={styles.amount}>{money(item.line.unitPrice * (Number(item.quantity) || 0))}</Text>
                  </View>
                </View>
              );
            })}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              disabled={selectedItems.length === 0}
              onPress={() => {
                if (selectedItems.length === 0) {
                  setError('Search and add at least one invoice product.');
                  return;
                }
                setError('');
                setScreen('summary');
              }}
              style={[styles.totalLink, selectedItems.length === 0 && styles.disabled]}>
              <View style={styles.flex}>
                <Text style={styles.label}>Total Amount</Text>
                <Text style={styles.amount}>{money(netRefundAmount)}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </>
        ) : null}

        {screen === 'summary' ? (
          <>
            <Text style={styles.title}>Bill Summary</Text>
            <Text style={styles.subtitle}>Review refund details before recording this return.</Text>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Return Invoice</Text>
              {selectedItems.map((item) => (
                <View key={item.key} style={styles.summaryLine}>
                  <Text style={styles.primaryText}>{item.line.brand} · Qty {item.quantity}</Text>
                  <Text style={styles.amount}>{money(item.line.unitPrice * Number(item.quantity || 0))}</Text>
                </View>
              ))}
              <View style={styles.separator} />
              <View style={styles.summaryLine}>
                <Text style={styles.label}>Total Return Amount</Text>
                <Text style={styles.amount}>{money(returnTotal)}</Text>
              </View>
              <View style={styles.summaryLine}>
                <Text style={styles.label}>Return Deduction %</Text>
                <TextInput
                  accessibilityLabel="Return Deduction percentage"
                  keyboardType="decimal-pad"
                  onChangeText={(value) => {
                    if (!/^\d*\.?\d*$/.test(value)) return;
                    const parsedValue = Number(value);
                    setReturnDeductionRate(value !== '' && parsedValue > 100 ? '100' : value);
                    setError('');
                  }}
                  value={returnDeductionRate}
                  style={styles.deductionInput}
                />
              </View>
              <View style={styles.summaryLine}>
                <Text style={styles.label}>Deduction Amount</Text>
                <Text style={styles.amount}>{money(returnDeductionAmount)}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.summaryLine}>
                <Text style={styles.label}>Net Refund Amount</Text>
                <Text style={styles.amount}>{money(returnMethod === 'Cash Return' ? netRefundAmount : 0)}</Text>
              </View>
            </View>
            <Text style={styles.label}>Return Method</Text>
            <View style={styles.methodRow}>
              {(['Cash Return', 'Product Adjust'] as const).map((method) => (
                <Pressable
                  key={method}
                  accessibilityRole="button"
                  accessibilityState={{ selected: returnMethod === method }}
                  onPress={() => setReturnMethod(method)}
                  style={[styles.methodButton, returnMethod === method && styles.methodButtonSelected]}>
                  <Text style={[styles.methodText, returnMethod === method && styles.methodTextSelected]}>{method}</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable disabled={saving} onPress={() => void recordReturn()} style={[styles.primaryButton, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Record Return</Text>}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
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
              <Text style={styles.scannerTitle}>Scan product brand</Text>
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
                <Text style={styles.scannerHintText}>Point the camera at the brand name</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#145642' },
  pageContent: { flex: 1, backgroundColor: '#f4f6f2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#f4f6f2' },
  content: { padding: 16, paddingBottom: 36, gap: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  flex: { flex: 1 },
  title: { color: '#193c30', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#728078', fontSize: 12, lineHeight: 17 },
  primaryButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17664f' },
  primaryButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 10, backgroundColor: '#fff', color: '#20342a', fontSize: 13 },
  scanButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cfe5d7', borderRadius: 10, backgroundColor: '#eef8f2' },
  scanMessageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scanNotFound: { color: '#a63e34', fontSize: 12, fontWeight: '700' },
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
  inlineLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  errorCard: { padding: 12, gap: 8, borderRadius: 10, backgroundColor: '#fff0ed' },
  error: { color: '#a63e34', fontSize: 12, lineHeight: 18 },
  link: { color: '#17664f', fontSize: 12, fontWeight: '700' },
  card: { gap: 7, padding: 13, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 12, backgroundColor: '#fff' },
  emptyCard: { alignItems: 'center', gap: 6, padding: 24, borderWidth: 1, borderColor: '#e2e9e2', borderRadius: 12, backgroundColor: '#fff' },
  cardTitle: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  primaryText: { color: '#24382e', fontSize: 12, fontWeight: '700' },
  muted: { color: '#78847d', fontSize: 11, lineHeight: 16 },
  status: { color: '#17664f', fontSize: 10, fontWeight: '700' },
  amount: { color: '#17664f', fontSize: 13, fontWeight: '800', textAlign: 'right' },
  sectionTitle: { color: '#34453b', fontSize: 14, fontWeight: '800' },
  label: { color: '#526158', fontSize: 12, fontWeight: '700' },
  quantityInput: { width: 72, minHeight: 37, paddingHorizontal: 9, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff', color: '#24382e', textAlign: 'center' },
  deductionInput: { width: 90, minHeight: 37, paddingHorizontal: 9, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 8, backgroundColor: '#fff', color: '#24382e', textAlign: 'right' },
  remove: { color: '#a63e34', fontSize: 11, fontWeight: '700' },
  totalLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderWidth: 1, borderColor: '#dce5df', borderRadius: 11, backgroundColor: '#e8f3eb' },
  arrow: { color: '#17664f', fontSize: 30, fontWeight: '600' },
  disabled: { opacity: 0.55 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  separator: { height: 1, backgroundColor: '#e5ebe7' },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4dc', borderRadius: 9, backgroundColor: '#fff' },
  methodButtonSelected: { borderColor: '#17664f', backgroundColor: '#e8f3eb' },
  methodText: { color: '#526158', fontSize: 11, fontWeight: '700' },
  methodTextSelected: { color: '#17664f' },
});
