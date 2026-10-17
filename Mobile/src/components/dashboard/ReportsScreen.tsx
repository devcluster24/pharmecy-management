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
import { useAuth } from '@/providers/AuthProvider';

type ReportTab = 'sales' | 'customers' | 'suppliers' | 'stock' | 'returns' | 'profit';
type ReportPeriod = 'today' | 'this-week' | 'this-month' | 'last-month';
type StockFilter = 'all' | 'low' | 'out' | 'expiring' | 'expired';
type DateRange = { start: Date; end: Date };
type RawRecord = Record<string, unknown>;
type SaleLine = { brand: string; batchNumber: string; quantity: number; totalPrice: number; unitPurchasePrice?: number };
type SalesRecord = {
  id: string;
  invoice: string;
  customer: string;
  phone: string;
  items: number;
  amount: number;
  discountAmount: number;
  taxAmount: number;
  paidAmount?: number;
  dueAmount?: number;
  payment: string;
  paymentMethodName: string;
  payments: { methodName: string; amount: number }[];
  createdAt: string;
  lines: SaleLine[];
};
type PurchaseRecord = {
  id: string;
  order: string;
  supplier: string;
  supplierContactName: string;
  supplierPhone: string;
  orderDate: string;
  brand: string;
  genericName: string;
  batchNumber: string;
  expDate: string;
  packSize: string;
  quantity: string;
  availableQuantity?: string;
  totalPrice: string;
  unitPurchasePrice?: string;
  orderPaidAmount?: string;
  status: string;
};
type ReturnRecord = {
  id: string;
  returnId: string;
  invoice: string;
  product: string;
  brand: string;
  batchNumber: string;
  quantity: number;
  amount: number;
  netRefundAmount?: number;
  customer: string;
  returnMethod: string;
  date: string;
  reason: string;
};
type ExpenseRecord = { id: string; date: string; category: string; description: string; amount: number; paymentMethod: string };
type DueEntry = { amount: number };
type ReportData = {
  sales: SalesRecord[];
  purchases: PurchaseRecord[];
  returns: ReturnRecord[];
  expenses: ExpenseRecord[];
  lowStockThreshold: number | null;
  supplierAdjustments: Record<string, DueEntry[]>;
  supplierPayments: Record<string, DueEntry[]>;
};
type ReportMetric = { label: string; value: string; detail: string };
type ReportRow = { id: string; title: string; subtitle: string; value: string; detail?: string };
type ReportSection = { title: string; emptyMessage: string; rows: ReportRow[] };
type ReportContent = { metrics: ReportMetric[]; sections: ReportSection[] };

const REPORT_DATA_KEYS = [
  'pharmacy-sales-list-v1',
  'pharmacy-purchase-list-v1',
  'pharmacy-return-records-v1',
  'pharmacy-expenses-v1',
  'pharmacy-low-stock-threshold-v1',
  'pharmacy-supplier-due-adjustments-v1',
  'pharmacy-supplier-due-payments-v1',
] as const;
const REPORT_PAGE_SIZE = 10;
const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'customers', label: 'Customer Due' },
  { id: 'suppliers', label: 'Purchase & Supplier' },
  { id: 'stock', label: 'Stock & Expiry' },
  { id: 'returns', label: 'Returns' },
  { id: 'profit', label: 'Profit & Loss' },
];
const REPORT_PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'this-week', label: 'This week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
];
const STOCK_FILTERS: { id: StockFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'low', label: 'Low' },
  { id: 'out', label: 'Out' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'expired', label: 'Expired' },
];
const emptyReportData: ReportData = {
  sales: [], purchases: [], returns: [], expenses: [], lowStockThreshold: null,
  supplierAdjustments: {}, supplierPayments: {},
};

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readRecordArray(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Saved ${label} data has an invalid format.`);
  return value.filter(isRecord);
}

function parseDueLedger(value: unknown) {
  if (!isRecord(value)) return {};
  const ledger: Record<string, DueEntry[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    ledger[key] = Array.isArray(entries)
      ? entries.filter(isRecord).map((entry) => ({ amount: numberValue(entry.amount) }))
      : [];
  }
  return ledger;
}

function parseReportData(rows: { data_key: string; payload: unknown }[]): ReportData {
  const payloads = new Map(rows.map((row) => [row.data_key, row.payload]));
  const sales = readRecordArray(payloads.get('pharmacy-sales-list-v1'), 'sales').map((row) => ({
    id: stringValue(row.id),
    invoice: stringValue(row.invoice),
    customer: stringValue(row.customer, 'Walk-in customer'),
    phone: stringValue(row.phone),
    items: numberValue(row.items),
    amount: numberValue(row.amount),
    discountAmount: numberValue(row.discountAmount),
    taxAmount: numberValue(row.taxAmount),
    paidAmount: optionalNumber(row.paidAmount),
    dueAmount: optionalNumber(row.dueAmount),
    payment: stringValue(row.payment),
    paymentMethodName: stringValue(row.paymentMethodName, 'Cash'),
    payments: Array.isArray(row.payments)
      ? row.payments.filter(isRecord).map((payment) => ({
        methodName: stringValue(payment.methodName, 'Cash'),
        amount: numberValue(payment.amount),
      }))
      : [],
    createdAt: stringValue(row.createdAt),
    lines: Array.isArray(row.lines)
      ? row.lines.filter(isRecord).map((line) => ({
        brand: stringValue(line.brand),
        batchNumber: stringValue(line.batchNumber),
        quantity: numberValue(line.quantity),
        totalPrice: numberValue(line.totalPrice),
        unitPurchasePrice: optionalNumber(line.unitPurchasePrice),
      }))
      : [],
  }));
  const purchases = readRecordArray(payloads.get('pharmacy-purchase-list-v1'), 'purchase').map((row) => ({
    id: stringValue(row.id),
    order: stringValue(row.order),
    supplier: stringValue(row.supplier),
    supplierContactName: stringValue(row.supplierContactName),
    supplierPhone: stringValue(row.supplierPhone),
    orderDate: stringValue(row.orderDate),
    brand: stringValue(row.brand),
    genericName: stringValue(row.genericName),
    batchNumber: stringValue(row.batchNumber),
    expDate: stringValue(row.expDate),
    packSize: stringValue(row.packSize),
    quantity: stringValue(row.quantity),
    availableQuantity: typeof row.availableQuantity === 'string' ? row.availableQuantity : undefined,
    totalPrice: stringValue(row.totalPrice),
    unitPurchasePrice: typeof row.unitPurchasePrice === 'string' ? row.unitPurchasePrice : undefined,
    orderPaidAmount: typeof row.orderPaidAmount === 'string' ? row.orderPaidAmount : undefined,
    status: stringValue(row.status),
  }));
  const returns = readRecordArray(payloads.get('pharmacy-return-records-v1'), 'return').map((row) => ({
    id: stringValue(row.id),
    returnId: stringValue(row.returnId, stringValue(row.id)),
    invoice: stringValue(row.invoice),
    product: stringValue(row.product),
    brand: stringValue(row.brand),
    batchNumber: stringValue(row.batchNumber),
    quantity: numberValue(row.quantity),
    amount: numberValue(row.amount),
    netRefundAmount: optionalNumber(row.netRefundAmount),
    customer: stringValue(row.customer, 'Walk-in customer'),
    returnMethod: stringValue(row.returnMethod, 'Cash Return'),
    date: stringValue(row.date),
    reason: stringValue(row.reason),
  }));
  const expenses = readRecordArray(payloads.get('pharmacy-expenses-v1'), 'expense').map((row) => ({
    id: stringValue(row.id),
    date: stringValue(row.date),
    category: stringValue(row.category),
    description: stringValue(row.description),
    amount: numberValue(row.amount),
    paymentMethod: stringValue(row.paymentMethod),
  }));
  const thresholdValue = Number(payloads.get('pharmacy-low-stock-threshold-v1'));

  return {
    sales,
    purchases,
    returns,
    expenses,
    lowStockThreshold: Number.isInteger(thresholdValue) && thresholdValue > 0 ? thresholdValue : null,
    supplierAdjustments: parseDueLedger(payloads.get('pharmacy-supplier-due-adjustments-v1')),
    supplierPayments: parseDueLedger(payloads.get('pharmacy-supplier-due-payments-v1')),
  };
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPeriodRange(period: ReportPeriod, now: Date): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return { start: today, end: today };
  if (period === 'this-week') {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { start, end: today };
  }
  if (period === 'last-month') {
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: today };
}

function getDateValueKey(value: string) {
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (dateOnly) return dateOnly[1];
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? dateKey(new Date(timestamp)) : null;
}

function isInRange(value: string, range: DateRange) {
  const key = getDateValueKey(value);
  return key !== null && key >= dateKey(range.start) && key <= dateKey(range.end);
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(amount: number) {
  return amount.toLocaleString('en-BD', { maximumFractionDigits: 4 });
}

function formatDateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })
    : value || '—';
}

function getPackSizeMultiplier(packSize: string) {
  const factors = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((factor) => Number(factor.replace(/,/g, ''))) ?? [];
  if (!factors.length || factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;
  const multiplier = factors.reduce((total, factor) => total * factor, 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function getAvailableQuantity(row: PurchaseRecord) {
  if (row.availableQuantity !== undefined) {
    const savedQuantity = Number(row.availableQuantity);
    if (Number.isFinite(savedQuantity) && savedQuantity >= 0) return savedQuantity;
  }
  if (!row.quantity.trim()) return null;
  const boxQuantity = Number(row.quantity);
  const multiplier = getPackSizeMultiplier(row.packSize);
  if (!Number.isFinite(boxQuantity) || boxQuantity < 0 || multiplier === null) return null;
  return Number((boxQuantity * multiplier).toFixed(4));
}

function getSaleDue(sale: SalesRecord) {
  return Math.max(0, sale.dueAmount ?? sale.amount - (sale.paidAmount ?? sale.amount));
}

function getPurchaseAmount(row: PurchaseRecord) {
  const amount = Number(row.totalPrice);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function getStockStatus(row: PurchaseRecord, threshold: number | null, now: Date) {
  const quantity = getAvailableQuantity(row);
  if (quantity === null) return 'Unknown quantity';
  if (quantity === 0) return 'Out of stock';
  const match = /^(\d{4})-(\d{2})$/.exec(row.expDate);
  if (match) {
    const expiryKey = Number(match[1]) * 12 + Number(match[2]);
    const currentKey = now.getFullYear() * 12 + now.getMonth() + 1;
    if (expiryKey < currentKey) return 'Expired';
    if (expiryKey - currentKey <= 3) return 'Expiring soon';
  }
  if (threshold !== null && quantity <= threshold) return 'Low stock';
  return 'In stock';
}

function supplierIdentity(name: string, phone: string) {
  return JSON.stringify([name.trim().toLocaleLowerCase(), phone.replace(/\D/g, '')]);
}

function buildReportContent(data: ReportData, tab: ReportTab, period: ReportPeriod, stockFilter: StockFilter, now: Date): ReportContent {
  const range = getPeriodRange(period, now);
  const selectedSales = data.sales.filter((sale) => isInRange(sale.createdAt, range));
  const salesTotal = selectedSales.reduce((total, sale) => total + sale.amount, 0);
  const selectedPaid = selectedSales.reduce((total, sale) => total + (sale.paidAmount ?? sale.amount), 0);
  const selectedDue = selectedSales.reduce((total, sale) => total + getSaleDue(sale), 0);
  const selectedDiscount = selectedSales.reduce((total, sale) => total + sale.discountAmount, 0);
  const selectedTax = selectedSales.reduce((total, sale) => total + sale.taxAmount, 0);
  const receivedPurchases = data.purchases.filter((row) => row.status !== 'Placed');
  const periodPurchases = receivedPurchases.filter((row) => isInRange(row.orderDate, range));
  const periodPurchaseTotal = periodPurchases.reduce((total, row) => total + getPurchaseAmount(row), 0);
  const periodExpenses = data.expenses.filter((expense) => isInRange(expense.date, range));
  const periodExpenseTotal = periodExpenses.reduce((total, expense) => total + expense.amount, 0);

  const returnGroups = new Map<string, ReturnRecord[]>();
  for (const record of data.returns.filter((item) => isInRange(item.date, range))) {
    const id = record.returnId || record.id;
    returnGroups.set(id, [...(returnGroups.get(id) ?? []), record]);
  }
  const reportReturns = [...returnGroups.entries()].map(([id, records]) => ({
    id,
    records,
    customer: records[0]?.customer || 'Walk-in customer',
    reason: [...new Set(records.map((record) => record.reason).filter(Boolean))].join(', ') || '—',
    method: records[0]?.returnMethod || 'Cash Return',
    quantity: records.reduce((total, record) => total + record.quantity, 0),
    grossAmount: records.reduce((total, record) => total + record.amount, 0),
    refundAmount: records.find((record) => record.netRefundAmount !== undefined)?.netRefundAmount
      ?? records.reduce((total, record) => total + record.amount, 0),
  }));
  const returnAmount = reportReturns.reduce((total, record) => total + record.refundAmount, 0);

  const customers = new Map<string, { name: string; phone: string; count: number; bill: number; paid: number; due: number; latest: string }>();
  for (const sale of data.sales) {
    const name = sale.customer.trim() || 'Walk-in customer';
    const normalizedPhone = sale.phone.replace(/\D/g, '') || sale.phone.toLocaleLowerCase();
    const key = `${name.toLocaleLowerCase()}\u0000${normalizedPhone}`;
    const customer = customers.get(key) ?? { name, phone: sale.phone, count: 0, bill: 0, paid: 0, due: 0, latest: '' };
    customer.count += 1;
    customer.bill += sale.amount;
    customer.paid += sale.paidAmount ?? sale.amount;
    customer.due += getSaleDue(sale);
    if (sale.createdAt > customer.latest) customer.latest = sale.createdAt;
    customers.set(key, customer);
  }
  const dueCustomers = [...customers.values()].filter((customer) => customer.due > 0).sort((a, b) => b.due - a.due);
  const customerDueTotal = dueCustomers.reduce((total, customer) => total + customer.due, 0);

  const supplierGroups = new Map<string, { name: string; phone: string; orders: Map<string, PurchaseRecord[]> }>();
  for (const row of receivedPurchases) {
    const name = row.supplierContactName.trim() || `${row.supplier.trim()} Distributor`;
    if (!name.trim()) continue;
    const key = supplierIdentity(name, row.supplierPhone);
    const supplier = supplierGroups.get(key) ?? { name, phone: row.supplierPhone, orders: new Map<string, PurchaseRecord[]>() };
    supplier.orders.set(row.order, [...(supplier.orders.get(row.order) ?? []), row]);
    supplierGroups.set(key, supplier);
  }
  const supplierSummaries = [...supplierGroups.entries()].map(([key, supplier]) => {
    const orders = [...supplier.orders.entries()].map(([order, rows]) => {
      const purchase = rows.reduce((total, row) => total + getPurchaseAmount(row), 0);
      const paid = rows.map((row) => Number(row.orderPaidAmount)).find(Number.isFinite) ?? 0;
      return { order, rows, purchase, paid, due: Math.max(0, purchase - paid) };
    });
    const periodOrders = orders.filter(({ rows }) => isInRange(rows[0]?.orderDate ?? '', range));
    const adjustments = (data.supplierAdjustments[key] ?? []).reduce((total, entry) => total + entry.amount, 0);
    const payments = (data.supplierPayments[key] ?? []).reduce((total, entry) => total + entry.amount, 0);
    const currentDue = Math.max(0, orders.reduce((total, order) => total + order.due, 0) + adjustments - payments);
    return {
      ...supplier,
      key,
      periodOrders,
      periodPurchase: periodOrders.reduce((total, order) => total + order.purchase, 0),
      periodDue: periodOrders.reduce((total, order) => total + order.due, 0),
      currentDue,
    };
  }).sort((a, b) => b.currentDue - a.currentDue || a.name.localeCompare(b.name));

  const stockStatuses = receivedPurchases.map((row) => ({ row, quantity: getAvailableQuantity(row), status: getStockStatus(row, data.lowStockThreshold, now) }));
  const stockCounts = {
    low: stockStatuses.filter(({ status }) => status === 'Low stock').length,
    out: stockStatuses.filter(({ status }) => status === 'Out of stock').length,
    expiring: stockStatuses.filter(({ status }) => status === 'Expiring soon').length,
    expired: stockStatuses.filter(({ status }) => status === 'Expired').length,
  };
  const stockRows = stockStatuses.filter(({ status }) => {
    if (stockFilter === 'low') return status === 'Low stock';
    if (stockFilter === 'out') return status === 'Out of stock';
    if (stockFilter === 'expiring') return status === 'Expiring soon';
    if (stockFilter === 'expired') return status === 'Expired';
    return true;
  }).sort((a, b) => {
    const priority = (status: string) => status === 'Expired' ? 0 : status === 'Out of stock' ? 1 : status === 'Expiring soon' ? 2 : status === 'Low stock' ? 3 : 4;
    return priority(a.status) - priority(b.status) || a.row.brand.localeCompare(b.row.brand);
  });

  const metrics: ReportMetric[] = [];
  const sections: ReportSection[] = [];
  if (tab === 'sales') {
    const paymentMethods = new Map<string, number>();
    const topProducts = new Map<string, { quantity: number; sales: number }>();
    for (const sale of selectedSales) {
      const payments = sale.payments.length ? sale.payments : [{ methodName: sale.paymentMethodName || 'Cash', amount: sale.paidAmount ?? sale.amount }];
      for (const payment of payments) paymentMethods.set(payment.methodName || 'Cash', (paymentMethods.get(payment.methodName || 'Cash') ?? 0) + payment.amount);
      for (const line of sale.lines) {
        const name = line.brand.trim() || 'Unspecified product';
        const product = topProducts.get(name) ?? { quantity: 0, sales: 0 };
        product.quantity += line.quantity;
        product.sales += line.totalPrice;
        topProducts.set(name, product);
      }
    }
    metrics.push(
      { label: 'Total sales', value: formatCurrency(salesTotal), detail: `${selectedSales.length} invoices in selected period` },
      { label: 'Discount given', value: formatCurrency(selectedDiscount), detail: 'Discount recorded on invoices' },
      { label: 'VAT / TAX', value: formatCurrency(selectedTax), detail: 'Tax recorded on invoices' },
      { label: 'Paid to date', value: formatCurrency(selectedPaid), detail: 'Payments recorded on invoices' },
      { label: 'Still due', value: formatCurrency(selectedDue), detail: 'Outstanding balance in period' },
    );
    sections.push(
      { title: 'Payment method summary', emptyMessage: 'No recorded payments for this period.', rows: [...paymentMethods.entries()].sort((a, b) => b[1] - a[1]).map(([method, amount]) => ({ id: method, title: method, subtitle: 'Recorded paid amount', value: formatCurrency(amount) })) },
      { title: 'Top selling brands', emptyMessage: 'No saved product-level sales details in this period.', rows: [...topProducts.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 10).map(([brand, product]) => ({ id: brand, title: brand, subtitle: `${formatQuantity(product.quantity)} sold`, value: formatCurrency(product.sales) })) },
      { title: 'Invoice details', emptyMessage: 'No invoices in this date range.', rows: [...selectedSales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((sale) => ({ id: sale.id || sale.invoice, title: sale.invoice, subtitle: `${sale.customer} · ${formatDateValue(sale.createdAt)} · ${sale.items} items`, value: formatCurrency(sale.amount), detail: `Paid ${formatCurrency(sale.paidAmount ?? sale.amount)} · Due ${formatCurrency(getSaleDue(sale))} · ${sale.payment || '—'}` })) },
    );
  } else if (tab === 'customers') {
    metrics.push(
      { label: 'Customers with due', value: String(dueCustomers.length), detail: 'All customers with outstanding balance' },
      { label: 'Total customer due', value: formatCurrency(customerDueTotal), detail: 'Current balance across all dates' },
      { label: 'Largest customer due', value: formatCurrency(dueCustomers[0]?.due ?? 0), detail: dueCustomers[0]?.name ?? 'No outstanding customers' },
    );
    sections.push({ title: 'Customer due list', emptyMessage: 'No customers have an outstanding due.', rows: dueCustomers.map((customer) => ({ id: `${customer.name}-${customer.phone}`, title: customer.name, subtitle: `${customer.phone || 'No phone'} · ${customer.count} invoices · Last ${formatDateValue(customer.latest)}`, value: formatCurrency(customer.due), detail: `Bill ${formatCurrency(customer.bill)} · Paid ${formatCurrency(customer.paid)}` })) });
  } else if (tab === 'suppliers') {
    const totalSupplierDue = supplierSummaries.reduce((total, supplier) => total + supplier.currentDue, 0);
    const purchaseOrders = new Map<string, { order: string; supplier: string; date: string; purchase: number; paid: number; due: number }>();
    for (const row of periodPurchases) {
      const order = purchaseOrders.get(row.order) ?? { order: row.order, supplier: row.supplierContactName.trim() || `${row.supplier.trim()} Distributor`, date: row.orderDate, purchase: 0, paid: Number(row.orderPaidAmount) || 0, due: 0 };
      order.purchase += getPurchaseAmount(row);
      purchaseOrders.set(row.order, order);
    }
    for (const order of purchaseOrders.values()) order.due = Math.max(0, order.purchase - order.paid);
    metrics.push(
      { label: 'Purchases received', value: formatCurrency(periodPurchaseTotal), detail: `${periodPurchases.length} received product entries` },
      { label: 'Suppliers', value: String(supplierSummaries.length), detail: 'Suppliers with received stock' },
      { label: 'Current supplier due', value: formatCurrency(totalSupplierDue), detail: 'All dates, including adjustments and payments' },
    );
    sections.push(
      { title: 'Supplier summary', emptyMessage: 'No received supplier purchases.', rows: supplierSummaries.map((supplier) => ({ id: supplier.key, title: supplier.name, subtitle: `${supplier.phone || 'No phone'} · ${supplier.periodOrders.length} orders in period`, value: formatCurrency(supplier.currentDue), detail: `Period purchase ${formatCurrency(supplier.periodPurchase)} · Period due ${formatCurrency(supplier.periodDue)}` })) },
      { title: 'Purchase order details', emptyMessage: 'No received orders in this date range.', rows: [...purchaseOrders.values()].sort((a, b) => b.date.localeCompare(a.date)).map((order) => ({ id: order.order, title: order.order, subtitle: `${order.supplier} · ${formatDateValue(order.date)}`, value: formatCurrency(order.purchase), detail: `Paid ${formatCurrency(order.paid)} · Due ${formatCurrency(order.due)}` })) },
    );
  } else if (tab === 'stock') {
    metrics.push(
      { label: 'Received batches', value: String(receivedPurchases.length), detail: 'Current inventory rows' },
      { label: 'Low stock', value: data.lowStockThreshold === null ? 'Not set' : String(stockCounts.low), detail: data.lowStockThreshold === null ? 'Set a threshold in Settings' : `At or below ${formatQuantity(data.lowStockThreshold)} units` },
      { label: 'Out of stock', value: String(stockCounts.out), detail: 'Batches with zero quantity' },
      { label: 'Expiring within 3 months', value: String(stockCounts.expiring), detail: 'Based on batch expiry month' },
      { label: 'Expired', value: String(stockCounts.expired), detail: 'Expiry month before current month' },
    );
    sections.push({ title: 'Stock and expiry details', emptyMessage: stockFilter === 'low' && data.lowStockThreshold === null ? 'Configure a low-stock threshold in Settings.' : 'No stock records match this filter.', rows: stockRows.map(({ row, quantity, status }) => ({ id: row.id, title: row.brand || '—', subtitle: `${row.batchNumber || '—'} · ${row.supplierContactName || row.supplier || '—'}`, value: quantity === null ? 'Unknown' : formatQuantity(quantity), detail: `${row.genericName || '—'} · Exp ${row.expDate || '—'} · ${status}` })) });
  } else if (tab === 'returns') {
    const returnedQuantity = reportReturns.reduce((total, record) => total + record.quantity, 0);
    const cashRefund = reportReturns.filter((record) => record.method === 'Cash Return').reduce((total, record) => total + record.refundAmount, 0);
    const adjustedCount = reportReturns.filter((record) => record.method === 'Product Adjust').length;
    metrics.push(
      { label: 'Return transactions', value: String(reportReturns.length), detail: 'Grouped by return transaction ID' },
      { label: 'Returned quantity', value: formatQuantity(returnedQuantity), detail: 'Total units returned in period' },
      { label: 'Cash refund', value: formatCurrency(cashRefund), detail: 'Recorded cash return amount' },
      { label: 'Product adjustments', value: String(adjustedCount), detail: 'Product instead of cash' },
      { label: 'Total refund amount', value: formatCurrency(returnAmount), detail: 'Net refund where recorded' },
    );
    sections.push({ title: 'Return details', emptyMessage: 'No returns in this date range.', rows: reportReturns.map((record) => ({ id: record.id, title: record.id, subtitle: `${record.customer} · ${formatDateValue(record.records[0]?.date ?? '')}`, value: formatCurrency(record.refundAmount), detail: `${record.records.map((item) => `${item.brand || item.product}${item.quantity ? ` × ${item.quantity}` : ''}`).join(', ')} · ${formatQuantity(record.quantity)} · ${record.method} · ${record.reason}` })) });
  } else {
    const purchaseCostsByBatch = new Map<string, PurchaseRecord[]>();
    for (const row of receivedPurchases) {
      const key = `${row.brand.trim().toLocaleLowerCase()}\u0000${row.batchNumber.trim().toLocaleLowerCase()}`;
      if (row.brand.trim() && row.batchNumber.trim()) purchaseCostsByBatch.set(key, [...(purchaseCostsByBatch.get(key) ?? []), row]);
    }
    let cogsTotal = 0;
    let costedLines = 0;
    let missingLines = 0;
    let missingInvoices = 0;
    const cogsRows: ReportRow[] = [];
    for (const sale of selectedSales) {
      if (!sale.lines.length) {
        missingInvoices += 1;
        cogsRows.push({ id: `${sale.id}-missing`, title: sale.invoice, subtitle: 'Product details not saved', value: 'Not available' });
        continue;
      }
      for (const [index, line] of sale.lines.entries()) {
        let unitCost = line.unitPurchasePrice;
        if (unitCost === undefined) {
          const saleDate = getDateValueKey(sale.createdAt);
          const key = `${line.brand.trim().toLocaleLowerCase()}\u0000${line.batchNumber.trim().toLocaleLowerCase()}`;
          const earlierCosts = (purchaseCostsByBatch.get(key) ?? []).filter((row) => {
            const purchaseDate = getDateValueKey(row.orderDate);
            return purchaseDate !== null && saleDate !== null && purchaseDate < saleDate;
          }).map((row) => optionalNumber(row.unitPurchasePrice)).filter((cost): cost is number => cost !== undefined && cost >= 0);
          const distinctCosts = [...new Map(earlierCosts.map((cost) => [cost.toFixed(4), cost])).values()];
          if (distinctCosts.length === 1) unitCost = distinctCosts[0];
        }
        const lineCost = unitCost === undefined ? null : Number((unitCost * line.quantity).toFixed(2));
        if (lineCost === null) missingLines += 1;
        else {
          costedLines += 1;
          cogsTotal += lineCost;
        }
        cogsRows.push({ id: `${sale.id}-${index}`, title: `${sale.invoice} · ${line.brand || '—'}`, subtitle: `Batch ${line.batchNumber || '—'} · Qty ${formatQuantity(line.quantity)}`, value: lineCost === null ? 'Not available' : formatCurrency(lineCost), detail: unitCost === undefined ? 'Unit purchase cost unavailable' : `Unit cost ${formatCurrency(unitCost)}` });
      }
    }
    cogsTotal = Number(cogsTotal.toFixed(2));
    const cogsComplete = missingLines === 0 && missingInvoices === 0;
    const coverage = `${costedLines} of ${costedLines + missingLines} product lines costed${missingInvoices ? ` · ${missingInvoices} invoice(s) have no product details` : ''}`;
    const estimatedProfit = Number((salesTotal - returnAmount - cogsTotal - periodExpenseTotal).toFixed(2));
    const cogsValue = `${cogsComplete ? '' : 'Partial '}${formatCurrency(cogsTotal)}`;
    const profitValue = `${cogsComplete ? '' : 'Partial '}${formatCurrency(estimatedProfit)}`;
    metrics.push(
      { label: 'Sales revenue', value: formatCurrency(salesTotal), detail: `${selectedSales.length} invoices in period` },
      { label: 'Customer returns', value: formatCurrency(returnAmount), detail: 'Net refund where recorded' },
      { label: 'Purchases received', value: formatCurrency(periodPurchaseTotal), detail: 'Purchases are not COGS' },
      { label: 'Cost of goods sold', value: cogsValue, detail: coverage },
      { label: 'Shop expenses', value: formatCurrency(periodExpenseTotal), detail: `${periodExpenses.length} recorded expenses` },
      { label: 'Estimated net profit / loss', value: profitValue, detail: 'Sales less returns, COGS, and recorded expenses' },
    );
    sections.push(
      { title: 'Profit & Loss summary', emptyMessage: 'No report data for this period.', rows: [
        { id: 'sales', title: 'Sales revenue', subtitle: `${selectedSales.length} invoices`, value: formatCurrency(salesTotal) },
        { id: 'returns', title: 'Customer returns', subtitle: 'Net refund where recorded', value: formatCurrency(returnAmount) },
        { id: 'purchases', title: 'Purchases received', subtitle: 'Not the same as cost of goods sold', value: formatCurrency(periodPurchaseTotal) },
        { id: 'cogs', title: 'Cost of goods sold', subtitle: coverage, value: cogsValue },
        { id: 'expenses', title: 'Shop expenses', subtitle: `${periodExpenses.length} recorded expenses`, value: formatCurrency(periodExpenseTotal) },
        { id: 'profit', title: 'Estimated net profit / loss', subtitle: 'Sales less returns, COGS, and expenses', value: profitValue },
      ] },
      { title: 'Cost of goods sold details', emptyMessage: 'No sales in this date range.', rows: cogsRows },
      { title: 'Recorded shop expenses', emptyMessage: 'No shop expenses in this date range.', rows: [...periodExpenses].sort((a, b) => b.date.localeCompare(a.date)).map((expense) => ({ id: expense.id, title: expense.category, subtitle: `${formatDateValue(expense.date)} · ${expense.description}`, value: formatCurrency(expense.amount), detail: expense.paymentMethod })) },
    );
  }

  return { metrics, sections };
}

function ReportList({ section }: { section: ReportSection }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(section.rows.length / REPORT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = section.rows.slice((currentPage - 1) * REPORT_PAGE_SIZE, currentPage * REPORT_PAGE_SIZE);

  return (
    <View style={styles.listPanel}>
      <Text style={styles.panelTitle}>{section.title}</Text>
      {pageRows.length ? pageRows.map((row, index) => (
        <View key={row.id} style={[styles.reportRow, index === pageRows.length - 1 && styles.reportRowLast]}>
          <View style={styles.reportRowText}>
            <Text style={styles.reportRowTitle}>{row.title}</Text>
            <Text style={styles.reportRowSubtitle}>{row.subtitle}</Text>
            {row.detail ? <Text style={styles.reportRowDetail}>{row.detail}</Text> : null}
          </View>
          <Text style={styles.reportRowValue}>{row.value}</Text>
        </View>
      )) : <Text style={styles.emptyText}>{section.emptyMessage}</Text>}
      <View style={styles.pagination}>
        <Text style={styles.paginationLabel}>{section.rows.length === 0 ? 'Showing 0 records' : `Showing ${(currentPage - 1) * REPORT_PAGE_SIZE + 1}-${Math.min(currentPage * REPORT_PAGE_SIZE, section.rows.length)} of ${section.rows.length}`}</Text>
        <View style={styles.paginationControls}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: currentPage <= 1 }} disabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)} style={[styles.pageButton, currentPage <= 1 && styles.pageButtonDisabled]}>
            <Text style={styles.pageButtonText}>Previous</Text>
          </Pressable>
          <Text style={styles.pageNumber}>Page {currentPage} of {totalPages}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: currentPage >= totalPages }} disabled={currentPage >= totalPages} onPress={() => setPage(currentPage + 1)} style={[styles.pageButton, currentPage >= totalPages && styles.pageButtonDisabled]}>
            <Text style={styles.pageButtonText}>Next</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [reportData, setReportData] = useState<ReportData>(emptyReportData);
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<ReportPeriod>('this-month');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (isAuthLoading || profileLoading || dashboardRole !== 'owner') return;
    const client = supabase;
    const currentSession = session;
    if (!client || !currentSession) return;
    let active = true;
    let latestRequest = 0;

    async function loadReports(
      reportsClient: NonNullable<typeof supabase>,
      reportsSession: NonNullable<typeof session>,
      showLoading = false,
    ) {
      const requestId = ++latestRequest;
      if (showLoading) setIsLoading(true);
      setError('');
      try {
        const { data, error: queryError } = await reportsClient
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', reportsSession.user.id)
          .in('data_key', [...REPORT_DATA_KEYS]);
        if (queryError) throw queryError;
        const nextData = parseReportData((data ?? []) as { data_key: string; payload: unknown }[]);
        if (active && requestId === latestRequest) setReportData(nextData);
      } catch (loadError) {
        if (active && requestId === latestRequest) setError(loadError instanceof Error ? loadError.message : 'Could not load reports.');
      } finally {
        if (active && requestId === latestRequest) setIsLoading(false);
      }
    }

    void loadReports(client, currentSession, true);
    const channel = client
      .channel(`reports-updates-${currentSession.user.id}-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pharmacy_app_data',
        filter: `owner_user_id=eq.${currentSession.user.id}`,
      }, (change) => {
        const row = change.eventType === 'DELETE' ? change.old : change.new;
        if ((REPORT_DATA_KEYS as readonly string[]).includes(row.data_key)) void loadReports(client, currentSession);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadReports(client, currentSession);
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  const reportContent = useMemo(
    () => buildReportContent(reportData, activeTab, period, stockFilter, new Date()),
    [activeTab, period, reportData, stockFilter],
  );
  const displayError = error
    || (!supabase
      ? 'Reports are unavailable. Check your account connection.'
      : !session
        ? 'Sign in to view reports.'
        : dashboardRole !== 'owner'
          ? 'Reports are available to store owners.'
          : '');
  const selectedRange = getPeriodRange(period, new Date());

  if (isAuthLoading || profileLoading) {
    return <SafeAreaView style={styles.centered}><ActivityIndicator size="large" color="#17664f" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <DashboardSubpageHeader subtitle="Report Dashboard" />
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodTabs}>
          {REPORT_PERIODS.map((option) => (
            <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: period === option.id }} onPress={() => setPeriod(option.id)} style={[styles.periodButton, period === option.id && styles.periodButtonSelected]}>
              <Text style={[styles.periodText, period === option.id && styles.periodTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.rangeLabel}>Selected period: {selectedRange.start.toLocaleDateString('en-BD')} – {selectedRange.end.toLocaleDateString('en-BD')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reportTabs}>
          {REPORT_TABS.map((tab) => (
            <Pressable key={tab.id} accessibilityRole="button" accessibilityState={{ selected: activeTab === tab.id }} onPress={() => setActiveTab(tab.id)} style={[styles.reportTab, activeTab === tab.id && styles.reportTabSelected]}>
              <Text style={[styles.reportTabText, activeTab === tab.id && styles.reportTabTextSelected]}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {displayError ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>{displayError}</Text>
            {error && supabase && session && dashboardRole === 'owner' ? <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
          </View>
        ) : isLoading ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : (
          <View style={styles.reportContent}>
            {activeTab === 'stock' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stockFilters}>
                {STOCK_FILTERS.map((filter) => (
                  <Pressable key={filter.id} accessibilityRole="button" accessibilityState={{ selected: stockFilter === filter.id }} onPress={() => setStockFilter(filter.id)} style={[styles.filterButton, stockFilter === filter.id && styles.filterButtonSelected]}>
                    <Text style={[styles.filterText, stockFilter === filter.id && styles.filterTextSelected]}>{filter.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.metricsGrid}>
              {reportContent.metrics.map((metric) => (
                <View key={metric.label} style={styles.metricCard}>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <Text style={styles.metricValue}>{metric.value}</Text>
                  <Text style={styles.metricDetail}>{metric.detail}</Text>
                </View>
              ))}
            </View>
            {reportContent.sections.map((section) => <ReportList key={section.title} section={section} />)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#145642' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f4ef' },
  pageContent: { flex: 1, backgroundColor: '#f2f4ef' },
  content: { paddingTop: 14, paddingBottom: 28 },
  periodTabs: { gap: 7, paddingHorizontal: 17, paddingVertical: 5 },
  periodButton: { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#dce5df', borderRadius: 6, backgroundColor: '#fff' },
  periodButtonSelected: { borderColor: '#179c70', backgroundColor: '#eef8f2' },
  periodText: { color: '#526158', fontSize: 11, fontWeight: '600' },
  periodTextSelected: { color: '#17704e' },
  rangeLabel: { paddingHorizontal: 17, paddingTop: 4, paddingBottom: 11, color: '#687871', fontSize: 10 },
  reportTabs: { gap: 17, paddingHorizontal: 17, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8e2' },
  reportTab: { paddingVertical: 7 },
  reportTabSelected: { borderBottomWidth: 2, borderBottomColor: '#16845f' },
  reportTabText: { color: '#687871', fontSize: 11, fontWeight: '600' },
  reportTabTextSelected: { color: '#16845f', fontWeight: '700' },
  reportContent: { gap: 12, paddingHorizontal: 13, paddingTop: 12 },
  stockFilters: { gap: 7 },
  filterButton: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#dce5df', borderRadius: 5, backgroundColor: '#fff' },
  filterButtonSelected: { borderColor: '#179c70', backgroundColor: '#eef8f2' },
  filterText: { color: '#526158', fontSize: 10, fontWeight: '600' },
  filterTextSelected: { color: '#17704e' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 9 },
  metricCard: { width: '48.5%', minHeight: 92, padding: 11, borderWidth: 1, borderColor: '#e4e9e5', borderRadius: 7, backgroundColor: '#fff' },
  metricLabel: { color: '#687871', fontSize: 10 },
  metricValue: { marginTop: 6, color: '#172622', fontSize: 17, fontWeight: '700' },
  metricDetail: { marginTop: 4, color: '#85918c', fontSize: 9, lineHeight: 13 },
  listPanel: { overflow: 'hidden', borderWidth: 1, borderColor: '#e4e9e5', borderRadius: 8, backgroundColor: '#fff' },
  panelTitle: { paddingHorizontal: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#edf0ed', color: '#26352f', fontSize: 13, fontWeight: '700' },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f0f2f0' },
  reportRowLast: { borderBottomWidth: 0 },
  reportRowText: { flex: 1, gap: 3 },
  reportRowTitle: { color: '#26352f', fontSize: 11, fontWeight: '700' },
  reportRowSubtitle: { color: '#687871', fontSize: 10, lineHeight: 14 },
  reportRowDetail: { color: '#87938c', fontSize: 9, lineHeight: 13 },
  reportRowValue: { maxWidth: '42%', color: '#17664f', fontSize: 11, fontWeight: '700', textAlign: 'right' },
  emptyText: { paddingHorizontal: 13, paddingVertical: 18, color: '#87938c', fontSize: 11, textAlign: 'center' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#edf0ed' },
  paginationLabel: { flex: 1, color: '#87938c', fontSize: 9 },
  paginationControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageButton: { paddingHorizontal: 7, paddingVertical: 6, borderWidth: 1, borderColor: '#dce5df', borderRadius: 5, backgroundColor: '#fff' },
  pageButtonDisabled: { opacity: 0.45 },
  pageButtonText: { color: '#34453b', fontSize: 9, fontWeight: '600' },
  pageNumber: { color: '#687871', fontSize: 9 },
  errorPanel: { margin: 14, padding: 14, borderWidth: 1, borderColor: '#f0d3cf', borderRadius: 9, backgroundColor: '#fff8f7' },
  errorText: { color: '#ad4b43', fontSize: 12, lineHeight: 18 },
  retryText: { marginTop: 10, color: '#17664f', fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 30 },
});