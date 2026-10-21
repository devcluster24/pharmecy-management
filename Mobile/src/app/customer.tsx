import { Text, TextInput } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/recorded-payments';
import { useAuth } from '@/providers/AuthProvider';

const CUSTOMERS_PER_PAGE = 10;
const SALES_DATA_KEY = 'pharmacy-sales-list-v1';
const PAYMENT_METHODS_DATA_KEY = 'pharmacy-payment-methods-v1';
type CustomerList = 'customers' | 'due';

type PaymentMethodOption = {
  id: string;
  label: string;
};

type CustomerInvoice = {
  id: string;
  invoice: string;
  customer: string;
  phone: string;
  items: number;
  amount: number;
  paymentMethodName?: string;
  payments?: { methodName: string; amount: number }[];
  paidAmount?: number;
  dueAmount?: number;
  payment: string;
  createdAt: string;
};

type CustomerGroup = {
  key: string;
  name: string;
  phone: string;
  invoices: CustomerInvoice[];
  lastInvoice: CustomerInvoice;
  totalAmount: number;
  totalPaid: number;
  totalDue: number;
};

function parseInvoices(payload: unknown): CustomerInvoice[] {
  if (!Array.isArray(payload)) {
    throw new Error('Saved sales data has an invalid format.');
  }
  return payload.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string'
      || typeof row.invoice !== 'string'
      || typeof row.customer !== 'string'
      || (row.phone !== undefined && typeof row.phone !== 'string')
      || typeof row.items !== 'number'
      || !Number.isInteger(row.items)
      || typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
      || (row.paidAmount !== undefined
        && (typeof row.paidAmount !== 'number' || !Number.isFinite(row.paidAmount)))
      || (row.dueAmount !== undefined
        && (typeof row.dueAmount !== 'number' || !Number.isFinite(row.dueAmount)))
      || (row.paymentMethodName !== undefined && typeof row.paymentMethodName !== 'string')
      || (row.payments !== undefined && (
        !Array.isArray(row.payments)
        || row.payments.some((payment) =>
          !payment || typeof payment !== 'object' || Array.isArray(payment)
          || typeof payment.methodName !== 'string'
          || typeof payment.amount !== 'number'
          || !Number.isFinite(payment.amount),
        )
      ))
      || typeof row.payment !== 'string'
      || typeof row.createdAt !== 'string'
      || Number.isNaN(new Date(row.createdAt).getTime())
    ) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }
    return {
      id: row.id,
      invoice: row.invoice,
      customer: row.customer,
      phone: typeof row.phone === 'string' ? row.phone : '',
      items: row.items,
      amount: row.amount,
      ...(typeof row.paymentMethodName === 'string'
        ? { paymentMethodName: row.paymentMethodName } : {}),
      ...(Array.isArray(row.payments)
        ? {
          payments: row.payments.map((payment) => ({
            methodName: payment.methodName as string,
            amount: payment.amount as number,
          })),
        } : {}),
      ...(typeof row.paidAmount === 'number' ? { paidAmount: row.paidAmount } : {}),
      ...(typeof row.dueAmount === 'number' ? { dueAmount: row.dueAmount } : {}),
      payment: row.payment,
      createdAt: row.createdAt,
    };
  });
}

function getInvoiceDue(invoice: CustomerInvoice) {
  return Math.max(0, invoice.dueAmount ?? invoice.amount - (invoice.paidAmount ?? invoice.amount));
}

function getCustomerKey(name: string, phone: string) {
  const normalizedPhone = phone.replace(/\D/g, '') || phone.toLocaleLowerCase();
  return `${name.toLocaleLowerCase()}\u0000${normalizedPhone}`;
}

export default function CustomerScreen() {
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
  } = useAuth();
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [activeList, setActiveList] = useState<CustomerList>('customers');
  const [searchValue, setSearchValue] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerGroup | null>(null);
  const [selectedDueCustomer, setSelectedDueCustomer] = useState<CustomerGroup | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoice | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([
    { id: 'cash', label: 'Cash' },
  ]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
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
    async function loadCustomers() {
      setIsLoading(true);
      setError('');
      try {
        if (!supabase || !session) {
          throw new Error('Customer data is unavailable. Check your account connection.');
        }
        const result = await supabase
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', session.user.id)
          .in('data_key', [SALES_DATA_KEY, PAYMENT_METHODS_DATA_KEY]);
        if (result.error) throw result.error;
        const rows = new Map((result.data ?? []).map((row) => [row.data_key, row.payload]));
        const nextInvoices = parseInvoices(rows.get(SALES_DATA_KEY) ?? []);
        const rawMethods = rows.get(PAYMENT_METHODS_DATA_KEY) ?? [];
        if (!Array.isArray(rawMethods)) {
          throw new Error('Saved payment methods have an invalid format.');
        }
        const nextMethods = rawMethods.map((value): PaymentMethodOption => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Saved payment methods contain an invalid entry.');
          }
          const method = value as Record<string, unknown>;
          if (
            typeof method.id !== 'string'
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
          setInvoices(nextInvoices);
          setPaymentMethods([{ id: 'cash', label: 'Cash' }, ...nextMethods]);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadCustomers();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  async function saveInvoicePayment() {
    setPaymentError('');
    const amount = Number(paymentAmount);
    if (paymentAmount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Enter an amount greater than 0.');
      return;
    }
    if (!selectedInvoice && !selectedDueCustomer) return;

    const paymentMethodName = paymentMethods.find(
      (method) => method.id === selectedPaymentMethod,
    )?.label;
    if (!paymentMethodName) {
      setPaymentError('Choose a valid payment method.');
      return;
    }
    if (!supabase || !session) {
      setPaymentError('Customer data is unavailable. Check your account connection.');
      return;
    }

    const targetInvoices = selectedDueCustomer
      ? [...selectedDueCustomer.invoices]
        .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
      : selectedInvoice ? [selectedInvoice] : [];
    if (targetInvoices.length === 0 || targetInvoices.some((invoice) =>
      !invoices.some((current) => current.id === invoice.id))) {
      setPaymentError('The selected customer invoices could not be found. Refresh and try again.');
      return;
    }
    let remainingPayment = Number(amount.toFixed(2));
    const allocations = targetInvoices.map((invoice) => {
      const allocation = Number(Math.min(getInvoiceDue(invoice), remainingPayment).toFixed(2));
      remainingPayment = Number(Math.max(0, remainingPayment - allocation).toFixed(2));
      return { id: invoice.id, allocation };
    });
    if (!allocations.some(({ allocation }) => allocation > 0)) {
      setPaymentError('The selected invoices have no outstanding due.');
      return;
    }
    if (remainingPayment > 0) {
      const firstDueAllocation = allocations.find(({ allocation }) => allocation > 0);
      if (!firstDueAllocation) {
        setPaymentError('The payment could not be assigned to an invoice.');
        return;
      }
      firstDueAllocation.allocation = Number(
        (firstDueAllocation.allocation + remainingPayment).toFixed(2),
      );
    }

    const updatedById = new Map<string, CustomerInvoice>();
    for (const { id, allocation } of allocations) {
      if (allocation <= 0) continue;
      const invoice = invoices.find((current) => current.id === id);
      if (!invoice) {
        setPaymentError('The selected invoice could not be found. Refresh and try again.');
        return;
      }
      const paidAmount = invoice.paidAmount ?? invoice.amount;
      const nextPaidAmount = Number((paidAmount + allocation).toFixed(2));
      if (!Number.isFinite(nextPaidAmount)) {
        setPaymentError('The payment amount is too large.');
        return;
      }
      const nextDueAmount = Number(Math.max(0, getInvoiceDue(invoice) - allocation).toFixed(2));
      const previousPayments = invoice.payments ?? (paidAmount > 0
        ? [{
          methodName: invoice.paymentMethodName?.trim() || 'Cash',
          amount: paidAmount,
        }]
        : []);
      updatedById.set(id, {
        ...invoice,
        paidAmount: nextPaidAmount,
        dueAmount: nextDueAmount,
        payment: nextDueAmount > 0 ? 'Due' : 'Paid',
        paymentMethodName,
        payments: [...previousPayments, { methodName: paymentMethodName, amount: allocation }],
      });
    }
    const updatedInvoices = invoices.map((invoice) => updatedById.get(invoice.id) ?? invoice);
    const updatedSelectedInvoice = selectedInvoice
      ? updatedById.get(selectedInvoice.id) ?? selectedInvoice
      : null;
    const updatedDueCustomer = selectedDueCustomer
      ? {
        ...selectedDueCustomer,
        invoices: selectedDueCustomer.invoices.map(
          (invoice) => updatedById.get(invoice.id) ?? invoice,
        ),
        totalPaid: selectedDueCustomer.totalPaid + amount,
        totalDue: Math.max(0, selectedDueCustomer.totalDue - amount),
      }
      : null;

    setIsSavingPayment(true);
    try {
      const result = await supabase
        .from('pharmacy_app_data')
        .update({ payload: updatedInvoices, updated_at: new Date().toISOString() })
        .eq('owner_user_id', session.user.id)
        .eq('data_key', SALES_DATA_KEY)
        .select('data_key')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        throw new Error('Could not save this payment. Check that you have permission to edit sales.');
      }
      setInvoices(updatedInvoices);
      if (updatedSelectedInvoice) setSelectedInvoice(updatedSelectedInvoice);
      if (updatedDueCustomer) {
        setSelectedDueCustomer(updatedDueCustomer);
        setSelectedCustomer(updatedDueCustomer);
      } else if (updatedSelectedInvoice) {
        setSelectedCustomer((current) => current ? {
          ...current,
          invoices: current.invoices.map(
            (item) => updatedById.get(item.id) ?? item,
          ),
          totalPaid: current.totalPaid + amount,
          totalDue: Math.max(0, current.totalDue - amount),
        } : current);
      }
      setPaymentAmount('');
      setPaymentError('');
      setPaymentMessage(selectedDueCustomer
        ? 'Payment added to the customer invoices.'
        : 'Payment added to the invoice.');
    } catch (saveError) {
      setPaymentError(saveError instanceof Error ? saveError.message : 'Could not save this payment.');
    } finally {
      setIsSavingPayment(false);
    }
  }

  function openAdjustAmount(invoice: CustomerInvoice) {
    setSelectedDueCustomer(null);
    setSelectedInvoice(invoice);
    setPaymentAmount('');
    setSelectedPaymentMethod('cash');
    setPaymentError('');
    setPaymentMessage('');
  }

  function openCustomerDuePayment(customer: CustomerGroup) {
    setSelectedInvoice(null);
    setSelectedDueCustomer(customer);
    setPaymentAmount('');
    setSelectedPaymentMethod('cash');
    setPaymentError('');
    setPaymentMessage('');
  }

  const customers = useMemo(() => {
    const groups = new Map<string, CustomerGroup>();
    for (const invoice of invoices) {
      const name = invoice.customer.trim() || 'Walk-in customer';
      const phone = invoice.phone.trim();
      const key = getCustomerKey(name, phone);
      const group = groups.get(key);
      if (group) {
        group.invoices.push(invoice);
        group.totalAmount += invoice.amount;
        group.totalPaid += invoice.paidAmount ?? invoice.amount;
        group.totalDue += getInvoiceDue(invoice);
        if (Date.parse(invoice.createdAt) > Date.parse(group.lastInvoice.createdAt)) {
          group.lastInvoice = invoice;
        }
      } else {
        groups.set(key, {
          key,
          name,
          phone,
          invoices: [invoice],
          lastInvoice: invoice,
          totalAmount: invoice.amount,
          totalPaid: invoice.paidAmount ?? invoice.amount,
          totalDue: getInvoiceDue(invoice),
        });
      }
    }
    return [...groups.values()];
  }, [invoices]);

  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const filteredInvoices = useMemo(() => invoices
    .filter((invoice) =>
      !normalizedSearch
      || [
        invoice.invoice,
        invoice.customer,
        invoice.phone,
        invoice.payment,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    ), [invoices, normalizedSearch]);
  const dueCustomers = useMemo(() => customers
    .filter((customer) => customer.totalDue > 0)
    .filter((customer) =>
      !normalizedSearch
      || [
        customer.name,
        customer.phone,
        ...customer.invoices.map((invoice) => invoice.invoice),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .sort((first, second) => second.totalDue - first.totalDue),
  [customers, normalizedSearch]);
  const visibleEntries = activeList === 'customers' ? filteredInvoices : dueCustomers;
  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / CUSTOMERS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageEntries = visibleEntries.slice(
    (safeCurrentPage - 1) * CUSTOMERS_PER_PAGE,
    safeCurrentPage * CUSTOMERS_PER_PAGE,
  );
  const totalDueAmount = dueCustomers.reduce((total, customer) => total + customer.totalDue, 0);

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
      <DashboardSubpageHeader subtitle="Customer management" />
      <ScrollView
        style={styles.pageContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text style={styles.title}>Customers</Text>
        <Text style={styles.subtitle}>Review customer invoices and outstanding balances.</Text>

        <View accessibilityRole="tablist" style={styles.listTabs}>
          {([
            ['customers', 'Customers'],
            ['due', `Due customers (${dueCustomers.length})`],
          ] as const).map(([listType, label]) => (
            <Pressable
              key={listType}
              accessibilityRole="button"
              accessibilityState={{ selected: activeList === listType }}
              onPress={() => {
                setActiveList(listType);
                setSearchValue('');
                setCurrentPage(1);
              }}
              style={[styles.listTab, activeList === listType && styles.listTabSelected]}>
              <Text style={[styles.listTabText, activeList === listType && styles.listTabTextSelected]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          accessibilityLabel="Search customers"
          autoCapitalize="none"
          onChangeText={(value) => {
            setSearchValue(value);
            setCurrentPage(1);
          }}
          placeholder="Search customer, phone or invoice"
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
        ) : (
          <>
            {activeList === 'customers'
              ? pageEntries.map((entry) => {
                const invoice = entry as CustomerInvoice;
                const due = getInvoiceDue(invoice);
                return (
                  <Pressable
                    key={invoice.id}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${invoice.customer} invoice ${invoice.invoice}`}
                    onPress={() => {
                      const customer = customers.find((group) => group.key === getCustomerKey(
                        invoice.customer.trim() || 'Walk-in customer',
                        invoice.phone.trim(),
                      ));
                      if (customer) setSelectedCustomer(customer);
                    }}
                    style={styles.customerCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.customerIdentity}>
                        <Text numberOfLines={1} style={styles.customerName}>{invoice.customer}</Text>
                        {invoice.phone ? (
                          <Text numberOfLines={1} style={styles.customerPhone}>{invoice.phone}</Text>
                        ) : null}
                      </View>
                      <Text numberOfLines={1} style={styles.invoiceAmount}>
                        {formatCurrency(invoice.amount)}
                      </Text>
                    </View>
                    <Text style={styles.invoiceDate}>
                      {invoice.invoice} · {new Date(invoice.createdAt).toLocaleString('en-BD')}
                    </Text>
                    <View style={styles.invoiceFooter}>
                      <Text style={styles.invoiceMeta}>
                        {invoice.items} {invoice.items === 1 ? 'item' : 'items'} · {invoice.payment}
                      </Text>
                      <Text style={[styles.invoiceDue, due > 0 && styles.dueText]}>
                        {due > 0 ? `Due ${formatCurrency(due)}` : 'Paid'}
                      </Text>
                    </View>
                    {due > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={(event) => {
                          event.stopPropagation();
                          openAdjustAmount(invoice);
                        }}
                        style={styles.adjustButton}>
                        <Text style={styles.adjustButtonText}>Adjust Amount</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })
              : pageEntries.map((entry) => {
                const customer = entry as CustomerGroup;
                return (
                  <Pressable
                    key={customer.key}
                    accessibilityRole="button"
                    accessibilityLabel={`View due details for ${customer.name}`}
                    onPress={() => setSelectedCustomer(customer)}
                    style={styles.customerCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.customerIdentity}>
                        <Text numberOfLines={1} style={styles.customerName}>{customer.name}</Text>
                        {customer.phone ? (
                          <Text numberOfLines={1} style={styles.customerPhone}>{customer.phone}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Adjust due amount ${formatCurrency(customer.totalDue)} for ${customer.name}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          openCustomerDuePayment(customer);
                        }}
                        style={styles.dueAmountButton}>
                        <Text style={styles.dueAmount}>{formatCurrency(customer.totalDue)}</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.invoiceDate}>
                      Last invoice {new Date(customer.lastInvoice.createdAt).toLocaleString('en-BD')}
                    </Text>
                    <View style={styles.invoiceFooter}>
                      <Text style={styles.invoiceMeta}>
                        {customer.invoices.length} {customer.invoices.length === 1 ? 'invoice' : 'invoices'}
                      </Text>
                      <Text style={styles.invoiceMeta}>
                        Bill {formatCurrency(customer.totalAmount)} · Paid {formatCurrency(customer.totalPaid)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

            {pageEntries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {activeList === 'due'
                    ? 'No customers have an outstanding due'
                    : normalizedSearch ? 'No matching customers' : 'No customer invoices yet'}
                </Text>
                <Text style={styles.emptyText}>
                  {normalizedSearch
                    ? 'Try another customer name, phone number or invoice.'
                    : 'Customer information from saved sales invoices will appear here.'}
                </Text>
              </View>
            ) : null}

            <View style={styles.pagination}>
              {activeList === 'due' ? (
                <Text style={styles.totalDue}>
                  Total due: {formatCurrency(totalDueAmount)}
                </Text>
              ) : null}
              <Text style={styles.paginationLabel}>
                {visibleEntries.length === 0
                  ? 'Showing 0 records'
                  : `Showing ${(safeCurrentPage - 1) * CUSTOMERS_PER_PAGE + 1}-${Math.min(
                    safeCurrentPage * CUSTOMERS_PER_PAGE,
                    visibleEntries.length,
                  )} of ${visibleEntries.length} records`}
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
                  style={[
                    styles.pageButton,
                    safeCurrentPage >= totalPages && styles.pageButtonDisabled,
                  ]}>
                  <Text style={styles.pageButtonText}>Next</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedCustomer(null)}
        visible={selectedCustomer !== null}>
        {selectedCustomer ? (
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close customer details"
                onPress={() => setSelectedCustomer(null)}
                style={styles.modalBackButton}>
                <Text style={styles.modalBackText}>‹</Text>
              </Pressable>
              <View style={styles.modalHeaderText}>
                <Text numberOfLines={1} style={styles.modalTitle}>{selectedCustomer.name}</Text>
                <Text numberOfLines={1} style={styles.modalSubtitle}>
                  {selectedCustomer.phone || 'Customer invoice history'}
                </Text>
              </View>
            </View>
            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets>
              <View style={styles.summaryCard}>
                <SummaryValue label="Total bill" value={formatCurrency(selectedCustomer.totalAmount)} />
                <SummaryValue label="Paid" value={formatCurrency(selectedCustomer.totalPaid)} />
                <SummaryValue
                  label="Due"
                  value={formatCurrency(selectedCustomer.totalDue)}
                  due={selectedCustomer.totalDue > 0}
                />
                <SummaryValue
                  label="Visits"
                  value={String(selectedCustomer.invoices.length)}
                />
              </View>
              <Text style={styles.historyTitle}>Invoice history</Text>
              {[...selectedCustomer.invoices]
                .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
                .map((invoice) => (
                  <View key={invoice.id} style={styles.historyCard}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.historyInvoice}>{invoice.invoice}</Text>
                      <Text style={styles.invoiceAmount}>{formatCurrency(invoice.amount)}</Text>
                    </View>
                    <Text style={styles.invoiceDate}>
                      {new Date(invoice.createdAt).toLocaleString('en-BD')}
                    </Text>
                    <View style={styles.invoiceFooter}>
                      <Text style={styles.invoiceMeta}>
                        {invoice.items} {invoice.items === 1 ? 'item' : 'items'} · {invoice.payment}
                      </Text>
                      <Text style={[styles.invoiceDue, getInvoiceDue(invoice) > 0 && styles.dueText]}>
                        {getInvoiceDue(invoice) > 0
                          ? `Due ${formatCurrency(getInvoiceDue(invoice))}`
                          : 'Paid'}
                      </Text>
                    </View>
                    {getInvoiceDue(invoice) > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={(event) => {
                          event.stopPropagation();
                          openAdjustAmount(invoice);
                        }}
                        style={styles.adjustButton}>
                        <Text style={styles.adjustButtonText}>Adjust Amount</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setSelectedInvoice(null);
          setSelectedDueCustomer(null);
        }}
        visible={selectedInvoice !== null || selectedDueCustomer !== null}>
        {selectedInvoice || selectedDueCustomer ? (
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close amount adjustment"
                onPress={() => {
                  setSelectedInvoice(null);
                  setSelectedDueCustomer(null);
                }}
                style={styles.modalBackButton}>
                <Text style={styles.modalBackText}>‹</Text>
              </Pressable>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Adjust Amount</Text>
                <Text numberOfLines={1} style={styles.modalSubtitle}>
                  {selectedDueCustomer
                    ? `${selectedDueCustomer.name} · Customer due`
                    : `${selectedInvoice?.invoice} · ${selectedInvoice?.customer}`}
                </Text>
              </View>
            </View>
            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.adjustModalBody}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets>
              <View style={styles.dueSummary}>
                <Text style={styles.dueSummaryLabel}>
                  {selectedDueCustomer ? 'Customer Outstanding Due' : 'Outstanding Due'}
                </Text>
                <Text style={styles.dueSummaryAmount}>
                  {formatCurrency(selectedDueCustomer
                    ? selectedDueCustomer.totalDue
                    : selectedInvoice ? getInvoiceDue(selectedInvoice) : 0)}
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                accessibilityLabel="Amount to add to invoice"
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setPaymentAmount(value);
                  setPaymentError('');
                  setPaymentMessage('');
                }}
                placeholder="Enter amount"
                placeholderTextColor="#87928d"
                style={styles.amountInput}
                value={paymentAmount}
              />

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
                    <Text
                      style={[
                        styles.paymentMethodText,
                        selectedPaymentMethod === method.id && styles.paymentMethodTextSelected,
                      ]}>
                      {method.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {paymentError ? <Text style={styles.paymentError}>{paymentError}</Text> : null}
              {paymentMessage ? (
                <Text style={styles.paymentMessage}>
                  {paymentMessage}
                </Text>
              ) : null}
              <View style={styles.adjustActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSavingPayment}
                  onPress={() => {
                    setSelectedInvoice(null);
                    setSelectedDueCustomer(null);
                  }}
                  style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Close</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: isSavingPayment
                      || (selectedDueCustomer?.totalDue ?? (
                        selectedInvoice ? getInvoiceDue(selectedInvoice) : 0
                      )) <= 0,
                  }}
                  disabled={isSavingPayment || (
                    (selectedDueCustomer?.totalDue ?? (
                      selectedInvoice ? getInvoiceDue(selectedInvoice) : 0
                    )) <= 0
                  )}
                  onPress={() => void saveInvoicePayment()}
                  style={[styles.submitButton, isSavingPayment && styles.submitButtonDisabled]}>
                  <Text style={styles.submitButtonText}>
                    {isSavingPayment
                      ? 'Saving…'
                      : selectedDueCustomer ? 'Add Payment' : 'Add to Invoice'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function SummaryValue({
  label,
  value,
  due = false,
}: {
  label: string;
  value: string;
  due?: boolean;
}) {
  return (
    <View style={styles.summaryValue}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryAmount, due && styles.dueText]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#145642',
  },
  pageContent: {
    flex: 1,
    backgroundColor: '#f4f8f5',
  },
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
  title: {
    color: '#102d2a',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 16,
    color: '#59706d',
    fontSize: 12,
    lineHeight: 18,
  },
  listTabs: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dce5df',
  },
  listTab: {
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  listTabSelected: {
    borderBottomColor: '#16845f',
  },
  listTabText: {
    color: '#687871',
    fontSize: 12,
    fontWeight: '600',
  },
  listTabTextSelected: {
    color: '#16845f',
    fontWeight: '800',
  },
  searchInput: {
    minHeight: 46,
    marginBottom: 4,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dfe8e1',
    borderRadius: 12,
    backgroundColor: '#fff',
    color: '#203128',
    fontSize: 13,
  },
  loader: {
    marginTop: 40,
  },
  errorCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0d3cd',
    borderRadius: 14,
    backgroundColor: '#fff8f6',
  },
  errorText: {
    color: '#a63e34',
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  retryText: {
    color: '#17664f',
    fontSize: 13,
    fontWeight: '800',
  },
  customerCard: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  customerIdentity: {
    flex: 1,
  },
  customerName: {
    color: '#203128',
    fontSize: 14,
    fontWeight: '800',
  },
  customerPhone: {
    marginTop: 4,
    color: '#7b8981',
    fontSize: 11,
  },
  invoiceAmount: {
    color: '#173c2c',
    fontSize: 14,
    fontWeight: '800',
  },
  invoiceDate: {
    marginTop: 9,
    color: '#7a8980',
    fontSize: 11,
    lineHeight: 16,
  },
  invoiceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  invoiceMeta: {
    color: '#627169',
    fontSize: 11,
  },
  invoiceDue: {
    color: '#596a61',
    fontSize: 11,
    fontWeight: '700',
  },
  dueText: {
    color: '#ad4b43',
  },
  dueAmount: {
    color: '#ad4b43',
    fontSize: 14,
    fontWeight: '800',
  },
  dueAmountButton: {
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  emptyCard: {
    marginTop: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  emptyTitle: {
    color: '#203128',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 6,
    color: '#7b8981',
    fontSize: 12,
    lineHeight: 18,
  },
  pagination: {
    gap: 10,
    marginTop: 16,
  },
  totalDue: {
    color: '#ad4b43',
    fontSize: 12,
    fontWeight: '800',
  },
  paginationLabel: {
    color: '#7b8981',
    fontSize: 11,
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pageButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  pageButtonDisabled: {
    opacity: 0.45,
  },
  pageButtonText: {
    color: '#34453b',
    fontSize: 11,
    fontWeight: '600',
  },
  pageNumber: {
    color: '#627169',
    fontSize: 11,
  },
  modalSafeArea: {
    flex: 1,
    backgroundColor: '#f4f8f5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#286b55',
    backgroundColor: '#145642',
  },
  modalBackButton: {
    width: 34,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackText: {
    color: '#fffdf7',
    fontSize: 32,
    lineHeight: 36,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    color: '#fffdf7',
    fontSize: 15,
    fontWeight: '800',
  },
  modalSubtitle: {
    marginTop: 3,
    color: '#c2d8ce',
    fontSize: 11,
  },
  modalContent: {
    flex: 1,
  },
  modalBody: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 32,
  },
  summaryCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  summaryValue: {
    minWidth: '43%',
    flexGrow: 1,
  },
  summaryLabel: {
    color: '#87928d',
    fontSize: 11,
  },
  summaryAmount: {
    marginTop: 4,
    color: '#26352f',
    fontSize: 14,
    fontWeight: '800',
  },
  historyTitle: {
    marginTop: 20,
    marginBottom: 2,
    color: '#203128',
    fontSize: 15,
    fontWeight: '800',
  },
  historyCard: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  historyInvoice: {
    color: '#16845f',
    fontSize: 14,
    fontWeight: '800',
  },
  adjustButton: {
    alignSelf: 'flex-start',
    marginTop: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#b9dfd0',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  adjustButtonText: {
    color: '#16845f',
    fontSize: 12,
    fontWeight: '700',
  },
  adjustModalBody: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
  dueSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#f0d3cd',
    borderRadius: 12,
    backgroundColor: '#fff8f6',
  },
  dueSummaryLabel: {
    color: '#526158',
    fontSize: 13,
  },
  dueSummaryAmount: {
    color: '#ad4b43',
    fontSize: 15,
    fontWeight: '800',
  },
  fieldLabel: {
    marginBottom: -8,
    color: '#34453b',
    fontSize: 12,
    fontWeight: '600',
  },
  amountInput: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 9,
    backgroundColor: '#fff',
    color: '#203128',
    fontSize: 14,
  },
  paymentMethods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paymentMethodButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  paymentMethodButtonSelected: {
    borderColor: '#179c70',
    backgroundColor: '#eef8f2',
  },
  paymentMethodText: {
    color: '#526158',
    fontSize: 12,
  },
  paymentMethodTextSelected: {
    color: '#17704e',
    fontWeight: '700',
  },
  paymentError: {
    color: '#b34b43',
    fontSize: 12,
    lineHeight: 18,
  },
  paymentMessage: {
    color: '#16845f',
    fontSize: 12,
    lineHeight: 18,
  },
  adjustActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 9,
    marginTop: 4,
  },
  cancelButton: {
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    color: '#526158',
    fontSize: 12,
    fontWeight: '600',
  },
  submitButton: {
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
