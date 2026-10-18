import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/recorded-payments';
import { useAuth } from '@/providers/AuthProvider';

const PURCHASE_KEY = 'pharmacy-purchase-list-v1';
const PAYMENT_METHODS_KEY = 'pharmacy-payment-methods-v1';
const SUPPLIER_STATUS_KEY = 'pharmacy-supplier-status-v1';
const DUE_ADJUSTMENTS_KEY = 'pharmacy-supplier-due-adjustments-v1';
const DUE_PAYMENTS_KEY = 'pharmacy-supplier-due-payments-v1';
const SUPPLIERS_PER_PAGE = 10;

type PurchaseRow = {
  id: string;
  order: string;
  supplier: string;
  supplierContactName?: string;
  supplierPhone?: string;
  orderDate: string;
  updatedAt?: string;
  totalPrice?: string;
  orderPaidAmount?: string;
};

type DueEntry = {
  amount: number;
  createdAt: string;
  paymentMethod?: string;
};

type PaymentMethodOption = { id: string; label: string };
type SupplierOrder = { order: string; date: string; purchase: number; paid: number; due: number };
type Supplier = {
  key: string;
  name: string;
  phone: string;
  orders: SupplierOrder[];
  purchaseAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: 'Active' | 'Inactive';
  dueAdjustments: DueEntry[];
  duePayments: DueEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePurchaseRows(value: unknown): PurchaseRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Saved purchase data has an invalid format.');
  }
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('Saved purchase data contains an invalid order.');
    if (
      typeof item.id !== 'string'
      || typeof item.order !== 'string'
      || typeof item.supplier !== 'string'
      || typeof item.orderDate !== 'string'
      || (item.supplierContactName !== undefined && typeof item.supplierContactName !== 'string')
      || (item.supplierPhone !== undefined && typeof item.supplierPhone !== 'string')
      || (item.updatedAt !== undefined && typeof item.updatedAt !== 'string')
      || (item.totalPrice !== undefined && typeof item.totalPrice !== 'string')
      || (item.orderPaidAmount !== undefined && typeof item.orderPaidAmount !== 'string')
    ) {
      throw new Error('Saved purchase data contains an invalid order.');
    }
    return {
      id: item.id,
      order: item.order,
      supplier: item.supplier,
      orderDate: item.orderDate,
      ...(typeof item.supplierContactName === 'string'
        ? { supplierContactName: item.supplierContactName } : {}),
      ...(typeof item.supplierPhone === 'string' ? { supplierPhone: item.supplierPhone } : {}),
      ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
      ...(typeof item.totalPrice === 'string' ? { totalPrice: item.totalPrice } : {}),
      ...(typeof item.orderPaidAmount === 'string' ? { orderPaidAmount: item.orderPaidAmount } : {}),
    };
  });
}

function parseLedger(value: unknown, label: string): Record<string, DueEntry[]> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`Saved supplier ${label} are invalid.`);
  const ledger: Record<string, DueEntry[]> = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) throw new Error(`Saved supplier ${label} are invalid.`);
    ledger[key] = entries.map((entry) => {
      if (
        !isRecord(entry)
        || typeof entry.amount !== 'number'
        || !Number.isFinite(entry.amount)
        || entry.amount <= 0
        || typeof entry.createdAt !== 'string'
        || !Number.isFinite(Date.parse(entry.createdAt))
        || (entry.paymentMethod !== undefined && typeof entry.paymentMethod !== 'string')
      ) {
        throw new Error(`Saved supplier ${label} are invalid.`);
      }
      return {
        amount: entry.amount,
        createdAt: entry.createdAt,
        ...(typeof entry.paymentMethod === 'string' ? { paymentMethod: entry.paymentMethod } : {}),
      };
    });
  }
  return ledger;
}

function parseStatuses(value: unknown): Record<string, 'Active' | 'Inactive'> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Saved supplier statuses are invalid.');
  const statuses: Record<string, 'Active' | 'Inactive'> = {};
  for (const [key, status] of Object.entries(value)) {
    if (status !== 'Active' && status !== 'Inactive') {
      throw new Error('Saved supplier statuses are invalid.');
    }
    statuses[key] = status;
  }
  return statuses;
}

function parsePaymentMethods(value: unknown): PaymentMethodOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Saved payment methods have an invalid format.');
  return value.map((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || (entry.type !== 'mobile' && entry.type !== 'bank')
      || (entry.type === 'mobile' && typeof entry.name !== 'string')
      || (entry.type === 'bank' && typeof entry.bankName !== 'string')
    ) {
      throw new Error('Saved payment methods contain an invalid entry.');
    }
    return {
      id: `${entry.type}:${entry.id}`,
      label: entry.type === 'mobile' ? entry.name as string : entry.bankName as string,
    };
  });
}

function parsePrice(value?: string) {
  if (!value?.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getSupplierIdentity(name: string, phone: string) {
  return JSON.stringify([name.trim().toLocaleLowerCase(), phone.replace(/\D/g, '')]);
}

function buildSuppliers(
  rows: PurchaseRow[],
  adjustments: Record<string, DueEntry[]>,
  payments: Record<string, DueEntry[]>,
  statuses: Record<string, 'Active' | 'Inactive'>,
): Supplier[] {
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const name = row.supplierContactName?.trim() || `${row.supplier.trim()} Distributor`;
    if (!name.trim()) continue;
    const phone = row.supplierPhone?.trim() ?? '';
    const key = getSupplierIdentity(name, phone);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, supplierRows]) => {
    const first = supplierRows[0];
    const name = first.supplierContactName?.trim() || `${first.supplier.trim()} Distributor`;
    const phone = first.supplierPhone?.trim() ?? '';
    const orderGroups = new Map<string, PurchaseRow[]>();
    for (const row of supplierRows) {
      orderGroups.set(row.order, [...(orderGroups.get(row.order) ?? []), row]);
    }
    const orders = [...orderGroups.entries()].map(([order, orderRows]) => {
      const purchase = orderRows.reduce(
        (total, row) => total + (parsePrice(row.totalPrice) ?? 0),
        0,
      );
      const paid = orderRows
        .map((row) => parsePrice(row.orderPaidAmount))
        .find((amount) => amount !== null) ?? 0;
      return {
        order,
        date: orderRows[0].updatedAt || orderRows[0].orderDate,
        purchase,
        paid,
        due: Math.max(0, purchase - paid),
      };
    }).sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    const dueAdjustments = adjustments[key] ?? [];
    const duePayments = payments[key] ?? [];
    const purchaseAmount = orders.reduce((total, order) => total + order.purchase, 0);
    const baseDue = orders.reduce((total, order) => total + order.due, 0);
    const dueAdded = dueAdjustments.reduce((total, entry) => total + entry.amount, 0);
    const duePaid = duePayments.reduce((total, entry) => total + entry.amount, 0);
    return {
      key,
      name,
      phone,
      orders,
      purchaseAmount,
      paidAmount: orders.reduce((total, order) => total + order.paid, 0) + duePaid,
      dueAmount: Math.max(0, baseDue + dueAdded - duePaid),
      status: statuses[key] ?? 'Active',
      dueAdjustments,
      duePayments,
    };
  }).sort((first, second) => first.name.localeCompare(second.name));
}

export default function SupplierScreen() {
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
  } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [duePaymentsLedger, setDuePaymentsLedger] = useState<Record<string, DueEntry[]>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([
    { id: 'cash', label: 'Cash' },
  ]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedDueSupplier, setSelectedDueSupplier] = useState<Supplier | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    async function loadSuppliers() {
      setIsLoading(true);
      setError('');
      try {
        if (!supabase || !session) {
          throw new Error('Supplier data is unavailable. Check your account connection.');
        }
        const result = await supabase
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', session.user.id)
          .in('data_key', [
            PURCHASE_KEY,
            PAYMENT_METHODS_KEY,
            SUPPLIER_STATUS_KEY,
            DUE_ADJUSTMENTS_KEY,
            DUE_PAYMENTS_KEY,
          ]);
        if (result.error) throw result.error;
        const payloads = new Map((result.data ?? []).map((row) => [row.data_key, row.payload]));
        const adjustments = parseLedger(payloads.get(DUE_ADJUSTMENTS_KEY), 'due adjustments');
        const payments = parseLedger(payloads.get(DUE_PAYMENTS_KEY), 'due payments');
        const nextSuppliers = buildSuppliers(
          parsePurchaseRows(payloads.get(PURCHASE_KEY) ?? []),
          adjustments,
          payments,
          parseStatuses(payloads.get(SUPPLIER_STATUS_KEY)),
        );
        const nextPaymentMethods = parsePaymentMethods(payloads.get(PAYMENT_METHODS_KEY));
        if (active) {
          setSuppliers(nextSuppliers);
          setDuePaymentsLedger(payments);
          setPaymentMethods([{ id: 'cash', label: 'Cash' }, ...nextPaymentMethods]);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load suppliers.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadSuppliers();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  const filteredSuppliers = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase();
    const phoneQuery = searchValue.replace(/\D/g, '');
    return suppliers.filter((supplier) =>
      !query
      || supplier.name.toLocaleLowerCase().includes(query)
      || supplier.phone.toLocaleLowerCase().includes(query)
      || (phoneQuery.length > 0 && supplier.phone.replace(/\D/g, '').includes(phoneQuery)),
    );
  }, [searchValue, suppliers]);
  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / SUPPLIERS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageSuppliers = filteredSuppliers.slice(
    (safeCurrentPage - 1) * SUPPLIERS_PER_PAGE,
    safeCurrentPage * SUPPLIERS_PER_PAGE,
  );
  const activeSupplierCount = suppliers.filter((supplier) => supplier.status === 'Active').length;
  const totalPurchase = suppliers.reduce((total, supplier) => total + supplier.purchaseAmount, 0);
  const totalDue = suppliers.reduce((total, supplier) => total + supplier.dueAmount, 0);
  const enteredPaymentAmount = Number(paymentAmount);
  const duePaymentPreview = selectedDueSupplier
    && Number.isFinite(enteredPaymentAmount)
    && enteredPaymentAmount >= 0
    && enteredPaymentAmount <= selectedDueSupplier.dueAmount
    ? enteredPaymentAmount
    : 0;

  function openDueAdjustment(supplier: Supplier) {
    setSelectedDueSupplier(supplier);
    setPaymentAmount('');
    setSelectedPaymentMethod('cash');
    setPaymentError('');
  }

  async function saveDuePayment() {
    setPaymentError('');
    const amount = Number(paymentAmount);
    if (paymentAmount.trim() === '' || !Number.isFinite(amount) || amount < 0.01) {
      setPaymentError('Enter an amount greater than 0.');
      return;
    }
    if (!selectedDueSupplier) return;
    if (amount > selectedDueSupplier.dueAmount) {
      setPaymentError('Payment amount cannot be greater than the current due.');
      return;
    }
    const paymentMethod = paymentMethods.find(
      (method) => method.id === selectedPaymentMethod,
    )?.label;
    if (!paymentMethod) {
      setPaymentError('Choose a valid payment method.');
      return;
    }
    if (!supabase || !session) {
      setPaymentError('Supplier data is unavailable. Check your account connection.');
      return;
    }

    const client = supabase;
    const ownerId = session.user.id;
    const supplier = selectedDueSupplier;
    const nextEntry: DueEntry = {
      amount: Number(amount.toFixed(2)),
      createdAt: new Date().toISOString(),
      paymentMethod,
    };
    const nextLedger = {
      ...duePaymentsLedger,
      [supplier.key]: [...supplier.duePayments, nextEntry],
    };

    setIsSavingPayment(true);
    try {
      const existing = await client
        .from('pharmacy_app_data')
        .select('data_key')
        .eq('owner_user_id', ownerId)
        .eq('data_key', DUE_PAYMENTS_KEY)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const saved = existing.data
        ? await client
          .from('pharmacy_app_data')
          .update({ payload: nextLedger, updated_at: new Date().toISOString() })
          .eq('owner_user_id', ownerId)
          .eq('data_key', DUE_PAYMENTS_KEY)
          .select('data_key')
          .maybeSingle()
        : await client
          .from('pharmacy_app_data')
          .insert({
            owner_user_id: ownerId,
            data_key: DUE_PAYMENTS_KEY,
            payload: nextLedger,
            updated_at: new Date().toISOString(),
          })
          .select('data_key')
          .maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data) throw new Error('Supplier due payment could not be saved.');

      const updatedSupplier: Supplier = {
        ...supplier,
        duePayments: [...supplier.duePayments, nextEntry],
        paidAmount: supplier.paidAmount + nextEntry.amount,
        dueAmount: Math.max(0, supplier.dueAmount - nextEntry.amount),
      };
      setSuppliers((current) => current.map(
        (item) => item.key === updatedSupplier.key ? updatedSupplier : item,
      ));
      setDuePaymentsLedger(nextLedger);
      setSelectedSupplier((current) => current?.key === updatedSupplier.key
        ? updatedSupplier
        : current);
      setSelectedDueSupplier(null);
      setPaymentAmount('');
    } catch (saveError) {
      setPaymentError(saveError instanceof Error
        ? saveError.message
        : 'Supplier due adjustment could not be saved.');
    } finally {
      setIsSavingPayment(false);
    }
  }

  if (isAuthLoading || profileLoading || dashboardRole !== 'owner') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#145642" />
      <DashboardSubpageHeader
        subtitle="Supplier management"
        onBack={() => router.replace('/dashboard')}
      />
      <ScrollView
        style={styles.pageContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text style={styles.title}>Suppliers</Text>
        <Text style={styles.subtitle}>
          Manage supplier contacts, received orders, purchase totals and outstanding dues.
        </Text>

        {!error && !isLoading ? (
          <View style={styles.metrics}>
            <Metric label="Active suppliers" value={String(activeSupplierCount)} />
            <Metric label="Inactive suppliers" value={String(suppliers.length - activeSupplierCount)} />
            <Metric label="Total purchase" value={formatCurrency(totalPurchase)} />
            <Metric label="Total due" value={formatCurrency(totalDue)} due={totalDue > 0} />
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search suppliers"
          autoCapitalize="none"
          onChangeText={(value) => {
            setSearchValue(value);
            setCurrentPage(1);
          }}
          placeholder="Search supplier name or phone"
          placeholderTextColor="#87928d"
          returnKeyType="search"
          style={styles.searchInput}
          value={searchValue}
        />

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRetryKey((previous) => previous + 1)}
              style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : isLoading ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : pageSuppliers.length > 0 ? pageSuppliers.map((supplier) => (
          <View key={supplier.key} style={styles.supplierCard}>
            <View style={styles.supplierHeading}>
              <View style={styles.supplierIdentity}>
                <Text numberOfLines={1} style={styles.supplierName}>{supplier.name}</Text>
                <Text numberOfLines={1} style={styles.supplierPhone}>
                  {supplier.phone || 'No phone number'}
                </Text>
              </View>
              <Text style={[
                styles.statusBadge,
                supplier.status === 'Active' ? styles.activeBadge : styles.inactiveBadge,
              ]}>
                {supplier.status}
              </Text>
            </View>
            <View style={styles.supplierStats}>
              <View style={styles.supplierStat}>
                <Text style={styles.statLabel}>Orders</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectedSupplier(supplier)}
                  style={styles.orderButton}>
                  <Text style={styles.orderButtonText}>View ({supplier.orders.length})</Text>
                </Pressable>
              </View>
              <View style={styles.supplierStat}>
                <Text style={styles.statLabel}>Total purchase</Text>
                <Text style={styles.statValue}>{formatCurrency(supplier.purchaseAmount)}</Text>
              </View>
              <View style={styles.supplierStat}>
                <Text style={styles.statLabel}>Total due amount</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Adjust supplier due ${formatCurrency(supplier.dueAmount)} for ${supplier.name}`}
                  onPress={() => openDueAdjustment(supplier)}
                  style={styles.dueButton}>
                  <Text style={[styles.dueValue, supplier.dueAmount <= 0 && styles.paidValue]}>
                    {formatCurrency(supplier.dueAmount)}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {searchValue.trim() ? 'No matching suppliers' : 'No suppliers yet'}
            </Text>
            <Text style={styles.emptyText}>
              {searchValue.trim()
                ? 'Try another supplier name or phone number.'
                : 'Supplier information from received purchase orders will appear here.'}
            </Text>
          </View>
        )}

        {!error && !isLoading ? (
          <View style={styles.pagination}>
            <Text style={styles.paginationLabel}>
              {filteredSuppliers.length === 0
                ? 'Showing 0 suppliers'
                : `Showing ${(safeCurrentPage - 1) * SUPPLIERS_PER_PAGE + 1}-${Math.min(
                  safeCurrentPage * SUPPLIERS_PER_PAGE,
                  filteredSuppliers.length,
                )} of ${filteredSuppliers.length} suppliers`}
            </Text>
            <View style={styles.paginationControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: safeCurrentPage <= 1 }}
                disabled={safeCurrentPage <= 1}
                onPress={() => setCurrentPage(safeCurrentPage - 1)}
                style={[styles.pageButton, safeCurrentPage <= 1 && styles.pageButtonDisabled]}>
                <Text style={styles.pageButtonText}>Previous</Text>
              </Pressable>
              <Text style={styles.pageNumber}>Page {safeCurrentPage} of {totalPages}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: safeCurrentPage >= totalPages }}
                disabled={safeCurrentPage >= totalPages}
                onPress={() => setCurrentPage(safeCurrentPage + 1)}
                style={[styles.pageButton, safeCurrentPage >= totalPages && styles.pageButtonDisabled]}>
                <Text style={styles.pageButtonText}>Next</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedSupplier(null)}
        visible={selectedSupplier !== null}>
        {selectedSupplier ? (
          <SafeAreaView style={styles.modalSafeArea}>
            <ModalHeader
              title="Supplier order history"
              subtitle={`${selectedSupplier.name} · ${selectedSupplier.phone || 'No phone number'}`}
              onClose={() => setSelectedSupplier(null)}
            />
            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets>
              <View style={styles.detailsSummary}>
                <Metric label="Total purchase" value={formatCurrency(selectedSupplier.purchaseAmount)} />
                <Metric label="Total due" value={formatCurrency(selectedSupplier.dueAmount)} due />
              </View>
              {selectedSupplier.orders.map((order) => (
                <View key={order.order} style={styles.orderCard}>
                  <Text style={styles.orderName}>{order.order}</Text>
                  <Text style={styles.orderDate}>
                    {Number.isFinite(Date.parse(order.date))
                      ? new Date(order.date).toLocaleDateString('en-BD')
                      : order.date}
                  </Text>
                  <View style={styles.orderAmounts}>
                    <Text style={styles.orderAmount}>Purchase {formatCurrency(order.purchase)}</Text>
                    <Text style={styles.orderAmount}>Paid {formatCurrency(order.paid)}</Text>
                    <Text style={[styles.orderAmount, order.due > 0 && styles.dueValue]}>
                      Due {formatCurrency(order.due)}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedDueSupplier(null)}
        visible={selectedDueSupplier !== null}>
        {selectedDueSupplier ? (
          <SafeAreaView style={styles.modalSafeArea}>
            <ModalHeader
              title="Adjust Supplier Due"
              subtitle={`${selectedDueSupplier.name} · ${selectedDueSupplier.phone || 'No phone number'}`}
              onClose={() => setSelectedDueSupplier(null)}
            />
            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.adjustModalBody}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets>
              <View style={styles.dueSummary}>
                <SummaryLine
                  label="Current Total Due"
                  value={formatCurrency(
                    selectedDueSupplier.dueAmount - duePaymentPreview,
                  )}
                />
                <SummaryLine
                  label="Paid Amount"
                  value={formatCurrency(
                    selectedDueSupplier.paidAmount + duePaymentPreview,
                  )}
                />
                <SummaryLine
                  label="Current Total Purchase"
                  value={formatCurrency(selectedDueSupplier.purchaseAmount)}
                />
              </View>
              <Text style={styles.fieldLabel}>Adjustment amount</Text>
              <TextInput
                accessibilityLabel="Supplier due payment amount"
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setPaymentAmount(value);
                  setPaymentError('');
                }}
                placeholder="Enter payment amount"
                placeholderTextColor="#87928d"
                style={styles.amountInput}
                value={paymentAmount}
              />

              {paymentAmount.trim() ? (
                <>
                  <Text style={styles.fieldLabel}>Payment method</Text>
                  <View style={styles.paymentMethods}>
                    {paymentMethods.map((method) => (
                      <Pressable
                        key={method.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: selectedPaymentMethod === method.id }}
                        onPress={() => setSelectedPaymentMethod(method.id)}
                        style={[
                          styles.paymentMethodButton,
                          selectedPaymentMethod === method.id && styles.paymentMethodButtonSelected,
                        ]}>
                        <Text style={[
                          styles.paymentMethodText,
                          selectedPaymentMethod === method.id && styles.paymentMethodTextSelected,
                        ]}>
                          {method.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.modalHint}>
                This payment will increase Paid Amount and reduce Total Due Amount.
              </Text>
              {selectedDueSupplier.duePayments.length > 0 ? (
                <View style={styles.historySection}>
                  <Text style={styles.historyHeading}>Previous payments</Text>
                  {[...selectedDueSupplier.duePayments].reverse().map((payment, index) => (
                    <HistoryLine
                      key={`${payment.createdAt}-${index}`}
                      label={`${new Date(payment.createdAt).toLocaleString()} · ${payment.paymentMethod || 'Not recorded'}`}
                      value={formatCurrency(payment.amount)}
                    />
                  ))}
                </View>
              ) : null}
              {selectedDueSupplier.dueAdjustments.length > 0 ? (
                <View style={styles.historySection}>
                  <Text style={styles.historyHeading}>Previous due adjustments</Text>
                  {[...selectedDueSupplier.dueAdjustments].reverse().map((adjustment, index) => (
                    <HistoryLine
                      key={`${adjustment.createdAt}-${index}`}
                      label={new Date(adjustment.createdAt).toLocaleString()}
                      value={formatCurrency(adjustment.amount)}
                    />
                  ))}
                </View>
              ) : null}

              {paymentError ? <Text style={styles.paymentError}>{paymentError}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: isSavingPayment || selectedDueSupplier.dueAmount <= 0,
                }}
                disabled={isSavingPayment || selectedDueSupplier.dueAmount <= 0}
                onPress={() => void saveDuePayment()}
                style={[
                  styles.submitButton,
                  (isSavingPayment || selectedDueSupplier.dueAmount <= 0)
                    && styles.submitButtonDisabled,
                ]}>
                <Text style={styles.submitButtonText}>
                  {isSavingPayment ? 'Saving…' : 'Save Adjustment'}
                </Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function Metric({ label, value, due = false }: { label: string; value: string; due?: boolean }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.metricValue, due && styles.dueValue]}>
        {value}
      </Text>
    </View>
  );
}

function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.modalHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.modalBackButton}>
        <Text style={styles.modalBackText}>‹</Text>
      </Pressable>
      <View style={styles.modalHeaderText}>
        <Text numberOfLines={1} style={styles.modalTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.modalSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function HistoryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.historyLine}>
      <Text style={styles.historyLabel}>{label}</Text>
      <Text style={styles.historyValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#145642' },
  pageContent: { flex: 1, backgroundColor: '#f4f8f5' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f8f5',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 32,
  },
  title: { color: '#102d2a', fontSize: 22, fontWeight: '800' },
  subtitle: { marginTop: 6, marginBottom: 16, color: '#59706d', fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 14 },
  metricCard: {
    flex: 1,
    minWidth: '46%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  metricLabel: { color: '#7b8981', fontSize: 10 },
  metricValue: { marginTop: 5, color: '#203128', fontSize: 14, fontWeight: '800' },
  dueValue: { color: '#ad4b43' },
  searchInput: {
    minHeight: 46,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dfe8e1',
    borderRadius: 12,
    backgroundColor: '#fff',
    color: '#203128',
    fontSize: 13,
  },
  loader: { marginTop: 40 },
  errorCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0d3cd',
    borderRadius: 14,
    backgroundColor: '#fff8f6',
  },
  errorText: { color: '#a63e34', fontSize: 13, lineHeight: 19 },
  retryButton: { alignSelf: 'flex-start', marginTop: 10 },
  retryText: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  supplierCard: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  supplierHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  supplierIdentity: { flex: 1 },
  supplierName: { color: '#26352f', fontSize: 14, fontWeight: '800' },
  supplierPhone: { marginTop: 4, color: '#77857d', fontSize: 11 },
  statusBadge: { overflow: 'hidden', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, fontSize: 10, fontWeight: '700' },
  activeBadge: { color: '#17704e', backgroundColor: '#e6f5ee' },
  inactiveBadge: { color: '#8e514a', backgroundColor: '#f2eded' },
  supplierStats: { gap: 9, marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#edf0ed' },
  supplierStat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statLabel: { color: '#7b8981', fontSize: 11 },
  statValue: { color: '#34453b', fontSize: 12, fontWeight: '700' },
  orderButton: { borderWidth: 1, borderColor: '#cde9dd', borderRadius: 7, backgroundColor: '#f2faf6', paddingHorizontal: 10, paddingVertical: 6 },
  orderButtonText: { color: '#17704e', fontSize: 11, fontWeight: '700' },
  dueButton: { paddingHorizontal: 4, paddingVertical: 5 },
  paidValue: { color: '#17704e' },
  dueAmount: { color: '#ad4b43', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  emptyCard: { marginTop: 12, padding: 18, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 14, backgroundColor: '#fff' },
  emptyTitle: { color: '#203128', fontSize: 14, fontWeight: '700' },
  emptyText: { marginTop: 6, color: '#7b8981', fontSize: 12, lineHeight: 18 },
  pagination: { gap: 10, marginTop: 16 },
  paginationLabel: { color: '#7b8981', fontSize: 11 },
  paginationControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageButton: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#dce5df', borderRadius: 8, backgroundColor: '#fff' },
  pageButtonDisabled: { opacity: 0.45 },
  pageButtonText: { color: '#34453b', fontSize: 11, fontWeight: '600' },
  pageNumber: { color: '#627169', fontSize: 11 },
  modalSafeArea: { flex: 1, backgroundColor: '#f4f8f5' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#286b55', backgroundColor: '#145642' },
  modalBackButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalBackText: { color: '#fffdf7', fontSize: 32, lineHeight: 36 },
  modalHeaderText: { flex: 1 },
  modalTitle: { color: '#fffdf7', fontSize: 15, fontWeight: '800' },
  modalSubtitle: { marginTop: 3, color: '#c2d8ce', fontSize: 11 },
  modalContent: { flex: 1 },
  modalBody: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 10, padding: 18, paddingBottom: 32 },
  detailsSummary: { flexDirection: 'row', gap: 8 },
  orderCard: { padding: 14, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 12, backgroundColor: '#fff' },
  orderName: { color: '#26352f', fontSize: 13, fontWeight: '800' },
  orderDate: { marginTop: 4, color: '#7b8981', fontSize: 11 },
  orderAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  orderAmount: { color: '#526158', fontSize: 11 },
  adjustModalBody: { width: '100%', maxWidth: 540, alignSelf: 'center', gap: 14, padding: 18, paddingBottom: 32 },
  dueSummary: { gap: 11, padding: 15, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 12, backgroundColor: '#fff' },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  summaryLabel: { color: '#526158', fontSize: 12 },
  summaryValue: { color: '#34453b', fontSize: 12, fontWeight: '700' },
  fieldLabel: { marginBottom: -8, color: '#526158', fontSize: 12, fontWeight: '600' },
  amountInput: { minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce5df', borderRadius: 9, backgroundColor: '#fff', color: '#203128', fontSize: 14 },
  paymentMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentMethodButton: { paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: '#dce5df', borderRadius: 8, backgroundColor: '#fff' },
  paymentMethodButtonSelected: { borderColor: '#179c70', backgroundColor: '#eef8f2' },
  paymentMethodText: { color: '#526158', fontSize: 12 },
  paymentMethodTextSelected: { color: '#17704e', fontWeight: '700' },
  modalHint: { color: '#77857d', fontSize: 11, lineHeight: 17 },
  historySection: { gap: 8, borderTopWidth: 1, borderTopColor: '#edf0ed', paddingTop: 12 },
  historyHeading: { color: '#42524b', fontSize: 11, fontWeight: '800' },
  historyLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  historyLabel: { flex: 1, color: '#77857d', fontSize: 10 },
  historyValue: { color: '#26352f', fontSize: 11, fontWeight: '700' },
  paymentError: { color: '#ad4b43', fontSize: 12, lineHeight: 18 },
  submitButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 8, backgroundColor: '#16845f' },
  submitButtonDisabled: { opacity: 0.55 },
  submitButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
