import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { supabase } from '@/lib/supabase';
import {
  formatCurrency,
  getRecordedPayments,
  PAYMENT_COLORS,
  type PaymentTotal,
} from '@/lib/recorded-payments';
import { useAuth } from '@/providers/AuthProvider';

type OverviewPeriod = 'Daily' | 'Weekly' | 'Monthly';
type SalesInvoice = {
  amount: number;
  createdAt: string;
  customer: string;
  phone?: string;
  paidAmount?: number;
  dueAmount?: number;
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  cashRoundingAmount?: number;
  lines?: Array<{
    quantity: number;
    unitPurchasePrice?: number;
    brand: string;
    details: string;
    batchNumber: string;
    totalPrice: number;
  }>;
};
type PurchaseRow = {
  order: string;
  orderDate: string;
  expDate: string;
  status: string;
  brand: string;
  genericName: string;
  strength: string;
  batchNumber: string;
  packSize: string;
  quantity?: string;
  availableQuantity?: string;
  totalPrice?: string;
  unitPurchasePrice?: string;
};
type ExpenseRow = { date: string; amount: number };
type OverviewData = {
  sales: SalesInvoice[];
  purchases: PurchaseRow[];
  expenses: ExpenseRow[];
  lowStockThreshold: number | null;
  paymentTotals: PaymentTotal[];
};
type Metric = {
  label: string;
  value: string;
  note: string;
  color: string;
  background: string;
};
type FastMovingProduct = {
  product: string;
  brand: string;
  quantity: number;
  sales: number;
};
type DeadStockProduct = {
  product: string;
  quantity: number;
  inactiveDays: number;
  stockValue: number | null;
};

const periods: OverviewPeriod[] = ['Daily', 'Weekly', 'Monthly'];

function getLocalDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readArray(value: unknown, name: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Saved ${name} data has an invalid format.`);
  return value;
}

function parseSales(value: unknown): SalesInvoice[] {
  return readArray(value, 'sales').map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
      || typeof row.createdAt !== 'string'
      || typeof row.customer !== 'string'
    ) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }
    return {
      amount: row.amount,
      createdAt: row.createdAt,
      customer: row.customer,
      ...(typeof row.phone === 'string' ? { phone: row.phone } : {}),
      ...(typeof row.paidAmount === 'number' ? { paidAmount: row.paidAmount } : {}),
      ...(typeof row.dueAmount === 'number' ? { dueAmount: row.dueAmount } : {}),
      ...(typeof row.subtotalAmount === 'number' ? { subtotalAmount: row.subtotalAmount } : {}),
      ...(typeof row.discountAmount === 'number' ? { discountAmount: row.discountAmount } : {}),
      ...(typeof row.taxAmount === 'number' ? { taxAmount: row.taxAmount } : {}),
      ...(typeof row.cashRoundingAmount === 'number' ? { cashRoundingAmount: row.cashRoundingAmount } : {}),
      ...(Array.isArray(row.lines) ? {
        lines: row.lines.map((lineValue) => {
          if (!lineValue || typeof lineValue !== 'object' || Array.isArray(lineValue)) {
            throw new Error('Saved sales data contains an invalid invoice line.');
          }
          const line = lineValue as Record<string, unknown>;
          if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity)) {
            throw new Error('Saved sales data contains an invalid invoice line.');
          }
          if (
            typeof line.brand !== 'string'
            || typeof line.details !== 'string'
            || typeof line.batchNumber !== 'string'
            || typeof line.totalPrice !== 'number'
            || !Number.isFinite(line.totalPrice)
          ) {
            throw new Error('Saved sales data contains an invalid invoice line.');
          }
          return {
            quantity: line.quantity,
            brand: line.brand,
            details: line.details,
            batchNumber: line.batchNumber,
            totalPrice: line.totalPrice,
            ...(typeof line.unitPurchasePrice === 'number'
              ? { unitPurchasePrice: line.unitPurchasePrice }
              : {}),
          };
        }),
      } : {}),
    };
  });
}

function parsePurchases(value: unknown): PurchaseRow[] {
  return readArray(value, 'purchase').map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved purchase data contains an invalid batch.');
    }
    const row = item as Record<string, unknown>;
    const requiredFields = [
      'order', 'orderDate', 'expDate', 'status', 'brand', 'genericName',
      'strength', 'batchNumber', 'packSize',
    ] as const;
    if (requiredFields.some((field) => typeof row[field] !== 'string')) {
      throw new Error('Saved purchase data contains an invalid batch.');
    }
    for (const field of ['quantity', 'availableQuantity', 'totalPrice', 'unitPurchasePrice']) {
      if (row[field] !== undefined && typeof row[field] !== 'string') {
        throw new Error('Saved purchase data contains an invalid batch quantity or price.');
      }
    }
    return row as unknown as PurchaseRow;
  });
}

function parseExpenses(value: unknown): ExpenseRow[] {
  return readArray(value, 'expense').map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved expense data contains an invalid record.');
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.date !== 'string'
      || typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
    ) {
      throw new Error('Saved expense data contains an invalid record.');
    }
    return { date: row.date, amount: row.amount };
  });
}

function getPackSizeMultiplier(packSize: string) {
  const normalized = packSize.trim().replace(/['’]s(?:\s+pack)?$/i, '');
  if (!normalized) return null;
  const factors = normalized.split(/\s*[xX×]\s*/);
  if (factors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))) return null;
  const multiplier = factors.reduce((total, factor) => total * Number(factor), 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function getAvailableQuantity(row: PurchaseRow) {
  if (row.availableQuantity !== undefined) {
    const quantity = Number(row.availableQuantity);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  }
  if (row.quantity === undefined) return null;
  const quantity = Number(row.quantity);
  const packMultiplier = getPackSizeMultiplier(row.packSize);
  if (!Number.isFinite(quantity) || quantity < 0 || packMultiplier === null) return null;
  return Number((quantity * packMultiplier).toFixed(4));
}

function getUnitCost(row: PurchaseRow) {
  if (!row.unitPurchasePrice?.trim() || row.unitPurchasePrice.trim() === '-') return null;
  const amount = Number(row.unitPurchasePrice);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getChartData(period: OverviewPeriod, now: Date, sales: SalesInvoice[], purchases: PurchaseRow[]) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: { start: Date; end: Date; label: string }[] = [];
  if (period === 'Daily') {
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      buckets.push({
        start: date,
        end: date,
        label: date.toLocaleDateString('en-BD', { weekday: 'short', day: 'numeric' }),
      });
    }
  } else if (period === 'Weekly') {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(weekStart);
      start.setDate(weekStart.getDate() - offset * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      if (end > today) end.setTime(today.getTime());
      buckets.push({
        start,
        end,
        label: start.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' }),
      });
    }
  } else {
    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      if (end > today) end.setTime(today.getTime());
      buckets.push({
        start,
        end,
        label: start.toLocaleDateString('en-BD', { month: 'short' }),
      });
    }
  }

  return buckets.map(({ start, end, label }) => {
    const startKey = getLocalDateKey(start) ?? '';
    const endKey = getLocalDateKey(end) ?? '';
    const inRange = (value: string) => {
      const key = getLocalDateKey(value);
      return key !== null && key >= startKey && key <= endKey;
    };
    return {
      label,
      sales: sales
        .filter((sale) => inRange(sale.createdAt))
        .reduce((sum, sale) => sum + sale.amount, 0),
      purchases: purchases
        .filter((purchase) => purchase.status !== 'Placed' && inRange(purchase.orderDate))
        .reduce((sum, purchase) => {
          const amount = Number(purchase.totalPrice);
          return sum + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
        }, 0),
    };
  });
}

function formatQuantity(amount: number) {
  return amount.toLocaleString('en-BD', { maximumFractionDigits: 4 });
}

export default function OverviewScreen() {
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [period, setPeriod] = useState<OverviewPeriod>('Daily');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [now] = useState(() => new Date());
  const todayKey = getLocalDateKey(now);

  useEffect(() => {
    if (isAuthLoading || profileLoading || dashboardRole !== 'owner') return;
    let active = true;
    async function loadOverview() {
      if (!supabase || !session) {
        setError('Overview data is unavailable. Check your account connection.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const { data: rows, error: queryError } = await supabase
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', session.user.id)
          .in('data_key', [
            'pharmacy-sales-list-v1',
            'pharmacy-purchase-list-v1',
            'pharmacy-expenses-v1',
            'pharmacy-low-stock-threshold-v1',
          ]);
        if (queryError) throw queryError;

        let salesPayload: unknown = [];
        let purchasePayload: unknown = [];
        let expensesPayload: unknown = [];
        let thresholdPayload: unknown = null;
        for (const row of rows ?? []) {
          if (row.data_key === 'pharmacy-sales-list-v1') salesPayload = row.payload;
          if (row.data_key === 'pharmacy-purchase-list-v1') purchasePayload = row.payload;
          if (row.data_key === 'pharmacy-expenses-v1') expensesPayload = row.payload;
          if (row.data_key === 'pharmacy-low-stock-threshold-v1') thresholdPayload = row.payload;
        }
        const sales = parseSales(salesPayload);
        const purchases = parsePurchases(purchasePayload);
        const expenses = parseExpenses(expensesPayload);
        const payments = getRecordedPayments(salesPayload, null);
        const thresholdNumber = typeof thresholdPayload === 'number'
          ? thresholdPayload
          : typeof thresholdPayload === 'string'
            ? Number(thresholdPayload)
            : Number.NaN;
        const lowStockThreshold = Number.isInteger(thresholdNumber) && thresholdNumber > 0
          ? thresholdNumber
          : null;
        if (active) {
          setData({
            sales,
            purchases,
            expenses,
            lowStockThreshold,
            paymentTotals: payments.totals,
          });
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load overview data.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadOverview();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  const metrics = useMemo(() => {
    if (!data || !todayKey) return [];
    const salesToday = data.sales.filter((sale) => getLocalDateKey(sale.createdAt) === todayKey);
    const receivedPurchases = data.purchases.filter((row) => row.status !== 'Placed');
    const purchasesToday = receivedPurchases.filter((row) => getLocalDateKey(row.orderDate) === todayKey);
    const expensesToday = data.expenses.filter((expense) => expense.date === todayKey);
    const salesTotal = salesToday.reduce((sum, sale) => sum + sale.amount, 0);
    const purchaseTotal = purchasesToday.reduce((sum, row) => {
      const amount = Number(row.totalPrice);
      return sum + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
    }, 0);
    const customerDueTotal = data.sales.reduce((sum, sale) => (
      sum + Math.max(0, sale.dueAmount ?? sale.amount - (sale.paidAmount ?? sale.amount))
    ), 0);
    const customersWithDue = new Set(
      data.sales
        .filter((sale) => (sale.dueAmount ?? sale.amount - (sale.paidAmount ?? sale.amount)) > 0)
        .map((sale) => `${sale.customer.trim().toLocaleLowerCase()}\u0000${sale.phone?.replace(/\D/g, '') ?? ''}`),
    );

    let cogsTotal = 0;
    let costedLines = 0;
    let missingLines = 0;
    for (const sale of salesToday) {
      for (const line of sale.lines ?? []) {
        if (line.unitPurchasePrice === undefined) {
          missingLines += 1;
        } else {
          cogsTotal += line.unitPurchasePrice * line.quantity;
          costedLines += 1;
        }
      }
    }
    const netSales = salesToday.reduce((sum, sale) => (
      sum + (sale.subtotalAmount !== undefined
        ? sale.subtotalAmount - (sale.discountAmount ?? 0)
        : sale.amount - (sale.taxAmount ?? 0) - (sale.cashRoundingAmount ?? 0) - (sale.discountAmount ?? 0))
    ), 0);
    const grossProfit = netSales - cogsTotal;

    const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
    let totalStockValue = 0;
    let valuedBatches = 0;
    let lowStockCount = 0;
    let expiredCount = 0;
    let expiringCount = 0;
    let activeBatchCount = 0;
    const productKeys = new Set<string>();
    for (const row of receivedPurchases) {
      const quantity = getAvailableQuantity(row);
      if (quantity === null || quantity <= 0) continue;
      activeBatchCount += 1;
      productKeys.add(`${row.brand.toLocaleLowerCase()}\u0000${`${row.genericName} ${row.strength}`.toLocaleLowerCase()}`);
      if (data.lowStockThreshold !== null && quantity <= data.lowStockThreshold) lowStockCount += 1;
      const expiry = /^(\d{4})-(\d{2})$/.exec(row.expDate);
      if (expiry) {
        const expiryYear = Number(expiry[1]);
        const expiryMonth = Number(expiry[2]);
        if (expiryMonth >= 1 && expiryMonth <= 12) {
          const expiryKey = expiryYear * 12 + expiryMonth;
          if (expiryKey < currentMonth) expiredCount += 1;
          else if (expiryKey - currentMonth <= 3) expiringCount += 1;
        }
      }
      const unitCost = getUnitCost(row);
      if (unitCost !== null) {
        totalStockValue += quantity * unitCost;
        valuedBatches += 1;
      }
    }

    return [
      {
        label: "Today's Sales",
        value: formatCurrency(salesTotal),
        note: `${salesToday.length} invoices`,
        color: '#16865f',
        background: '#e8f7ef',
      },
      {
        label: "Today's Purchase",
        value: formatCurrency(purchaseTotal),
        note: `${new Set(purchasesToday.map((row) => row.order)).size} received orders`,
        color: '#2476a5',
        background: '#eaf4fa',
      },
      {
        label: 'Est. Gross Profit',
        value: `${missingLines > 0 ? 'Partial ' : ''}${formatCurrency(grossProfit)}`,
        note: `${costedLines} saved lines costed; before returns`,
        color: '#9a6a11',
        background: '#fbf3df',
      },
      {
        label: 'Customer Due',
        value: formatCurrency(customerDueTotal),
        note: `${customersWithDue.size} customers with due`,
        color: '#9a5411',
        background: '#fff0e1',
      },
      {
        label: "Today's Expenses",
        value: formatCurrency(expensesToday.reduce((sum, expense) => sum + expense.amount, 0)),
        note: `${expensesToday.length} recorded expenses`,
        color: '#ae4545',
        background: '#fceeee',
      },
      {
        label: 'Total Stock Value',
        value: `${valuedBatches < activeBatchCount ? 'Partial ' : ''}${formatCurrency(totalStockValue)}`,
        note: `${productKeys.size} products · ${valuedBatches}/${activeBatchCount} batches valued`,
        color: '#6254a0',
        background: '#f0edfa',
      },
      {
        label: 'Low Stock',
        value: data.lowStockThreshold === null ? 'Not set' : `${lowStockCount} batches`,
        note: data.lowStockThreshold === null
          ? 'Set a threshold in inventory settings'
          : `At or below ${formatQuantity(data.lowStockThreshold)} units`,
        color: '#a15c12',
        background: '#fff2e5',
      },
      {
        label: 'Near Expiry',
        value: `${expiringCount} batches`,
        note: 'Expiring within 3 months',
        color: '#a15c12',
        background: '#fff2e5',
      },
      {
        label: 'Expired Stock',
        value: `${expiredCount} batches`,
        note: 'Remove from sale',
        color: '#ae4545',
        background: '#fceeee',
      },
    ] satisfies Metric[];
  }, [data, now, todayKey]);

  const chartData = useMemo(
    () => data ? getChartData(period, now, data.sales, data.purchases) : [],
    [data, now, period],
  );
  const chartMaximum = Math.max(
    1,
    ...chartData.flatMap((point) => [point.sales, point.purchases]),
  );
  const productSummaries = useMemo(() => {
    if (!data || !todayKey) return { fastMoving: [] as FastMovingProduct[], deadStock: [] as DeadStockProduct[] };
    const fastMovingByProduct = new Map<string, FastMovingProduct>();
    for (const sale of data.sales) {
      if (getLocalDateKey(sale.createdAt) !== todayKey) continue;
      for (const line of sale.lines ?? []) {
        const product = line.details.trim() || line.brand.trim() || 'Unknown product';
        const key = `${line.brand.trim().toLocaleLowerCase()}\u0000${product.toLocaleLowerCase()}`;
        const existing = fastMovingByProduct.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.sales += line.totalPrice;
        } else {
          fastMovingByProduct.set(key, {
            product,
            brand: line.brand.trim() || '—',
            quantity: line.quantity,
            sales: line.totalPrice,
          });
        }
      }
    }
    const fastMoving = [...fastMovingByProduct.values()]
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, 4);

    const latestSaleByBatch = new Map<string, string>();
    for (const sale of data.sales) {
      const saleDateKey = getLocalDateKey(sale.createdAt);
      if (!saleDateKey) continue;
      for (const line of sale.lines ?? []) {
        const key = `${line.brand.trim().toLocaleLowerCase()}\u0000${line.batchNumber.trim().toLocaleLowerCase()}`;
        const latest = latestSaleByBatch.get(key);
        if (!latest || saleDateKey > latest) latestSaleByBatch.set(key, saleDateKey);
      }
    }
    const deadStockByBatch = new Map<string, DeadStockProduct>();
    for (const row of data.purchases) {
      if (row.status === 'Placed') continue;
      const quantity = getAvailableQuantity(row);
      if (quantity === null || quantity <= 0) continue;
      const batchKey = `${row.brand.trim().toLocaleLowerCase()}\u0000${row.batchNumber.trim().toLocaleLowerCase()}`;
      const lastSaleKey = latestSaleByBatch.get(batchKey);
      const receivedKey = getLocalDateKey(row.orderDate);
      const lastActivityKey = lastSaleKey && receivedKey
        ? (lastSaleKey > receivedKey ? lastSaleKey : receivedKey)
        : lastSaleKey ?? receivedKey;
      if (!lastActivityKey) continue;
      const [year, month, day] = lastActivityKey.split('-').map(Number);
      const lastActivityDate = new Date(year, month - 1, day);
      const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const inactiveDays = Math.floor((todayDate.getTime() - lastActivityDate.getTime()) / 86_400_000);
      if (inactiveDays < 60) continue;
      const identity = `${batchKey}\u0000${row.genericName}\u0000${row.strength}`;
      const unitCost = getUnitCost(row);
      const previous = deadStockByBatch.get(identity);
      if (previous) {
        previous.quantity += quantity;
        previous.inactiveDays = Math.max(previous.inactiveDays, inactiveDays);
        previous.stockValue = previous.stockValue === null || unitCost === null
          ? null
          : previous.stockValue + quantity * unitCost;
      } else {
        deadStockByBatch.set(identity, {
          product: [row.brand, row.strength].filter(Boolean).join(' ') || row.genericName || 'Unknown product',
          quantity,
          inactiveDays,
          stockValue: unitCost === null ? null : quantity * unitCost,
        });
      }
    }
    const deadStock = [...deadStockByBatch.values()]
      .sort((left, right) => right.inactiveDays - left.inactiveDays)
      .slice(0, 4);
    return { fastMoving, deadStock };
  }, [data, now, todayKey]);

  if (isAuthLoading || profileLoading || dashboardRole !== 'owner') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <DashboardSubpageHeader subtitle="Overview Dashboard" />
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
        <Text style={styles.dateLabel}>
          {now.toLocaleDateString('en-BD', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRetryKey((previous) => previous + 1)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : isLoading || !data ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : (
          <>
            <View style={styles.metricsGrid}>
              {metrics.map((metric) => (
                <View key={metric.label} style={styles.metricCard}>
                  <View style={styles.metricLabelRow}>
                    <Text style={styles.metricLabel}>{metric.label}</Text>
                    <View style={[styles.metricAccent, { backgroundColor: metric.background }]}>
                      <View style={[styles.metricAccentDot, { backgroundColor: metric.color }]} />
                    </View>
                  </View>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>
                    {metric.value}
                  </Text>
                  <Text numberOfLines={2} style={styles.metricNote}>{metric.note}</Text>
                </View>
              ))}
            </View>

            <View style={styles.chartCard}>
              <Text style={styles.sectionTitle}>Sales &amp; Purchase</Text>
              <Text style={styles.sectionSubtitle}>
                {period === 'Daily'
                  ? 'Daily totals for the last 7 days'
                  : period === 'Weekly'
                    ? 'Weekly totals for the last 6 weeks'
                    : 'Monthly totals for the last 6 months'}
              </Text>
              <View style={styles.periodTabs}>
                {periods.map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected: period === option }}
                    onPress={() => setPeriod(option)}
                    style={[styles.periodTab, period === option && styles.periodTabSelected]}>
                    <Text style={[styles.periodTabText, period === option && styles.periodTabTextSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#27a879' }]} />
                  <Text style={styles.legendText}>Sales</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#9ccfba' }]} />
                  <Text style={styles.legendText}>Purchase</Text>
                </View>
              </View>
              <View style={styles.chart}>
                {chartData.map((point) => (
                  <View key={point.label} style={styles.chartBucket}>
                    <View style={styles.barArea}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(point.sales > 0 ? 3 : 0, point.sales / chartMaximum * 100)}%`,
                            backgroundColor: '#27a879',
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(point.purchases > 0 ? 3 : 0, point.purchases / chartMaximum * 100)}%`,
                            backgroundColor: '#9ccfba',
                          },
                        ]}
                      />
                    </View>
                    <Text numberOfLines={1} style={styles.chartLabel}>{point.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.paymentsCard}>
              <Text style={styles.sectionTitle}>Recorded payments</Text>
              <Text style={styles.sectionSubtitle}>
                All-time paid amounts saved on sales invoices
              </Text>
              {data.paymentTotals.length > 0 ? data.paymentTotals.slice(0, 4).map((payment, index) => (
                <View key={payment.name} style={styles.paymentRow}>
                  <View style={styles.paymentName}>
                    <View style={[styles.legendDot, { backgroundColor: PAYMENT_COLORS[index % PAYMENT_COLORS.length] }]} />
                    <Text style={styles.paymentMethod}>{payment.name}</Text>
                  </View>
                  <Text style={styles.paymentAmount}>{formatCurrency(payment.amount)}</Text>
                </View>
              )) : (
                <Text style={styles.emptyText}>No recorded payments yet.</Text>
              )}
            </View>
            <View style={styles.productCard}>
              <Text style={styles.sectionTitle}>Fast-moving products</Text>
              <Text style={styles.sectionSubtitle}>Top products by units sold today</Text>
              {productSummaries.fastMoving.length > 0 ? productSummaries.fastMoving.map((product) => (
                <View key={`${product.product}-${product.brand}`} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text numberOfLines={1} style={styles.productName}>{product.product}</Text>
                    <Text numberOfLines={1} style={styles.productDetail}>
                      {product.brand} · {formatQuantity(product.quantity)} units
                    </Text>
                  </View>
                  <Text style={styles.productSales}>{formatCurrency(product.sales)}</Text>
                </View>
              )) : (
                <Text style={styles.emptyText}>No saved product-line sales for today.</Text>
              )}
            </View>
            <View style={styles.productCard}>
              <Text style={styles.sectionTitle}>Dead stock</Text>
              <Text style={styles.sectionSubtitle}>
                Available batches with no recorded sale for 60+ days
              </Text>
              {productSummaries.deadStock.length > 0 ? productSummaries.deadStock.map((product, index) => (
                <View key={`${product.product}-${product.inactiveDays}-${index}`} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text numberOfLines={1} style={styles.productName}>{product.product}</Text>
                    <Text numberOfLines={1} style={styles.productDetail}>
                      {formatQuantity(product.quantity)} units · {product.inactiveDays} days
                    </Text>
                  </View>
                  <Text style={styles.productSales}>
                    {product.stockValue === null ? 'Cost unavailable' : formatCurrency(product.stockValue)}
                  </Text>
                </View>
              )) : (
                <Text style={styles.emptyText}>No qualifying dead-stock batches found.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#145642',
  },
  pageContent: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f7f5',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 16,
    paddingBottom: 30,
  },
  dateLabel: {
    marginBottom: 5,
    color: '#78867f',
    fontSize: 11,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 13,
  },
  metricCard: {
    width: '48%',
    minHeight: 112,
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  metricLabel: {
    flex: 1,
    color: '#68776f',
    fontSize: 10,
    fontWeight: '600',
  },
  metricAccent: {
    width: 25,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  metricAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metricValue: {
    marginTop: 8,
    color: '#203128',
    fontSize: 17,
    fontWeight: '700',
  },
  metricNote: {
    marginTop: 3,
    color: '#89958e',
    fontSize: 9,
    lineHeight: 13,
  },
  chartCard: {
    marginBottom: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    color: '#203128',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionSubtitle: {
    marginTop: 4,
    marginBottom: 11,
    color: '#7a8981',
    fontSize: 10,
  },
  periodTabs: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: 7,
    backgroundColor: '#f1f4f1',
  },
  periodTab: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 5,
  },
  periodTabSelected: {
    backgroundColor: '#fff',
  },
  periodTabText: {
    color: '#718078',
    fontSize: 10,
  },
  periodTabTextSelected: {
    color: '#226d4e',
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 3,
  },
  legendText: {
    color: '#68776f',
    fontSize: 10,
  },
  chart: {
    height: 150,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  chartBucket: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  barArea: {
    width: '100%',
    height: 122,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  bar: {
    width: 9,
    maxWidth: '42%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  chartLabel: {
    maxWidth: '100%',
    minHeight: 15,
    color: '#87938c',
    fontSize: 8,
  },
  paymentsCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  productCard: {
    marginTop: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  productDetail: {
    marginTop: 3,
    color: '#87938c',
    fontSize: 9,
  },
  productSales: {
    color: '#293a30',
    fontSize: 10,
    fontWeight: '600',
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  paymentName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentMethod: {
    color: '#65746b',
    fontSize: 11,
  },
  paymentAmount: {
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyText: {
    color: '#87938c',
    fontSize: 11,
  },
  loader: {
    marginTop: 34,
  },
  errorCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#f0d3cf',
    borderRadius: 10,
    backgroundColor: '#fff8f7',
  },
  errorText: {
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  retryText: {
    marginTop: 10,
    color: '#17664f',
    fontSize: 12,
    fontWeight: '700',
  },
});
