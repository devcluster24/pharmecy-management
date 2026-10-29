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
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';
import { useAuth } from '@/providers/AuthProvider';

const INVOICES_PER_PAGE = 10;

type InvoiceLine = {
  brand: string;
  details: string;
  batchNumber: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type SalesInvoice = {
  id: string;
  invoice: string;
  customer: string;
  phone?: string;
  items: number;
  time: string;
  amount: number;
  subtotalAmount?: number;
  discountAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  cashRoundingAmount?: number;
  paidAmount?: number;
  dueAmount?: number;
  payment: string;
  paymentMethodName?: string;
  createdAt: string;
  lines?: InvoiceLine[];
};

function optionalNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Saved sales data contains an invalid invoice amount.');
  }
  return value;
}

function parseInvoices(payload: unknown): SalesInvoice[] {
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
      || typeof row.items !== 'number'
      || !Number.isInteger(row.items)
      || typeof row.time !== 'string'
      || typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
      || typeof row.payment !== 'string'
      || typeof row.createdAt !== 'string'
      || Number.isNaN(new Date(row.createdAt).getTime())
      || (row.phone !== undefined && typeof row.phone !== 'string')
      || (row.paymentMethodName !== undefined && typeof row.paymentMethodName !== 'string')
    ) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }

    let lines: InvoiceLine[] | undefined;
    if (row.lines !== undefined) {
      if (!Array.isArray(row.lines)) {
        throw new Error('Saved sales data contains invalid invoice item details.');
      }
      lines = row.lines.map((lineValue) => {
        if (!lineValue || typeof lineValue !== 'object' || Array.isArray(lineValue)) {
          throw new Error('Saved sales data contains an invalid invoice line.');
        }
        const line = lineValue as Record<string, unknown>;
        if (
          typeof line.brand !== 'string'
          || typeof line.details !== 'string'
          || typeof line.batchNumber !== 'string'
          || typeof line.quantity !== 'number'
          || !Number.isFinite(line.quantity)
          || typeof line.unitPrice !== 'number'
          || !Number.isFinite(line.unitPrice)
          || typeof line.totalPrice !== 'number'
          || !Number.isFinite(line.totalPrice)
        ) {
          throw new Error('Saved sales data contains an invalid invoice line.');
        }
        return {
          brand: line.brand,
          details: line.details,
          batchNumber: line.batchNumber,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.totalPrice,
        };
      });
    }

    const subtotalAmount = optionalNumber(row, 'subtotalAmount');
    const discountAmount = optionalNumber(row, 'discountAmount');
    const taxRate = optionalNumber(row, 'taxRate');
    const taxAmount = optionalNumber(row, 'taxAmount');
    const cashRoundingAmount = optionalNumber(row, 'cashRoundingAmount');
    const paidAmount = optionalNumber(row, 'paidAmount');
    const dueAmount = optionalNumber(row, 'dueAmount');

    return {
      id: row.id,
      invoice: row.invoice,
      customer: row.customer,
      ...(typeof row.phone === 'string' ? { phone: row.phone } : {}),
      items: row.items,
      time: row.time,
      amount: row.amount,
      ...(subtotalAmount !== undefined ? { subtotalAmount } : {}),
      ...(discountAmount !== undefined ? { discountAmount } : {}),
      ...(taxRate !== undefined ? { taxRate } : {}),
      ...(taxAmount !== undefined ? { taxAmount } : {}),
      ...(cashRoundingAmount !== undefined ? { cashRoundingAmount } : {}),
      ...(paidAmount !== undefined ? { paidAmount } : {}),
      ...(dueAmount !== undefined ? { dueAmount } : {}),
      payment: row.payment,
      ...(typeof row.paymentMethodName === 'string'
        ? { paymentMethodName: row.paymentMethodName } : {}),
      createdAt: row.createdAt,
      ...(lines ? { lines } : {}),
    };
  });
}

export default function InvoiceScreen() {
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
    storeName,
  } = useAuth();
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null);
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
    async function loadInvoices() {
      setIsLoading(true);
      setError('');
      try {
        if (!supabase || !session) {
          throw new Error('Invoices are unavailable. Check your account connection.');
        }
        const result = await supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-sales-list-v1')
          .maybeSingle();
        if (result.error) throw result.error;
        const nextInvoices = parseInvoices(result.data?.payload ?? []);
        if (active) setInvoices(nextInvoices);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load invoices.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadInvoices();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLocaleLowerCase();
    return invoices.filter((invoice) =>
      !normalizedSearch
      || [
        invoice.invoice,
        invoice.customer,
        invoice.phone ?? '',
        invoice.payment,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    );
  }, [invoices, searchValue]);
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / INVOICES_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageInvoices = filteredInvoices.slice(
    (safeCurrentPage - 1) * INVOICES_PER_PAGE,
    safeCurrentPage * INVOICES_PER_PAGE,
  );

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
      <DashboardSubpageHeader subtitle="Dashboard invoice list" />
      <ScrollView
        style={styles.pageContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text style={styles.title}>Invoices</Text>
        <Text style={styles.subtitle}>Saved sales invoices from your pharmacy.</Text>

        <TextInput
          accessibilityLabel="Search invoices"
          autoCapitalize="none"
          onChangeText={(value) => {
            setSearchValue(value);
            setCurrentPage(1);
          }}
          placeholder="Search invoice, customer, phone or payment"
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
            {pageInvoices.length > 0 ? pageInvoices.map((invoice) => (
              <Pressable
                key={invoice.id}
                accessibilityRole="button"
                accessibilityLabel={`Open invoice ${invoice.invoice}`}
                onPress={() => setSelectedInvoice(invoice)}
                style={styles.invoiceCard}>
                <View style={styles.invoiceCardHeading}>
                  <View style={styles.invoiceMain}>
                    <Text numberOfLines={1} style={styles.invoiceNumber}>{invoice.invoice}</Text>
                    <Text numberOfLines={1} style={styles.customerName}>{invoice.customer}</Text>
                  </View>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.invoiceAmount}>
                    {formatCurrency(invoice.amount)}
                  </Text>
                </View>
                <Text style={styles.invoiceDate}>
                  {new Date(invoice.createdAt).toLocaleString('en-BD')}
                </Text>
                <View style={styles.invoiceCardFooter}>
                  <Text style={styles.invoiceMeta}>
                    {invoice.items} {invoice.items === 1 ? 'item' : 'items'}
                    {' · '}{invoice.payment}
                  </Text>
                  <Text style={styles.invoiceDue}>
                    Due {formatCurrency(invoice.dueAmount ?? 0)}
                  </Text>
                </View>
              </Pressable>
            )) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {searchValue.trim() ? 'No matching invoices' : 'No invoices yet'}
                </Text>
                <Text style={styles.emptyText}>
                  {searchValue.trim()
                    ? 'Try another invoice number, customer, phone or payment method.'
                    : 'Saved sales invoices will appear here.'}
                </Text>
              </View>
            )}

            <View style={styles.pagination}>
              <Text style={styles.paginationLabel}>
                {filteredInvoices.length === 0
                  ? 'Showing 0 invoices'
                  : `Showing ${(safeCurrentPage - 1) * INVOICES_PER_PAGE + 1}-${Math.min(
                    safeCurrentPage * INVOICES_PER_PAGE,
                    filteredInvoices.length,
                  )} of ${filteredInvoices.length} invoices`}
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
        onRequestClose={() => setSelectedInvoice(null)}
        visible={selectedInvoice !== null}>
        {selectedInvoice ? (
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close invoice details"
                onPress={() => setSelectedInvoice(null)}
                style={styles.modalBackButton}>
                <Text style={styles.modalBackText}>‹</Text>
              </Pressable>
              <View style={styles.modalHeaderText}>
                <Text numberOfLines={1} style={styles.modalBrand}>
                  {getPharmacyDisplayName(storeName)}
                </Text>
                <Text numberOfLines={1} style={styles.modalSubtitle}>
                  Sales Invoice · {selectedInvoice.invoice}
                </Text>
              </View>
            </View>
            <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalBody}>
              <View style={styles.detailsCard}>
                <InvoiceDetail label="Customer" value={selectedInvoice.customer} />
                {selectedInvoice.phone ? (
                  <InvoiceDetail label="Phone number" value={selectedInvoice.phone} />
                ) : null}
                {selectedInvoice.paymentMethodName ? (
                  <InvoiceDetail label="Payment method" value={selectedInvoice.paymentMethodName} />
                ) : null}
                <InvoiceDetail
                  label="Date & time"
                  value={new Date(selectedInvoice.createdAt).toLocaleString('en-BD')}
                />
                <InvoiceDetail label="Payment status" value={selectedInvoice.payment} />
              </View>

              <Text style={styles.sectionTitle}>Items</Text>
              {(selectedInvoice.lines ?? []).length > 0 ? (
                selectedInvoice.lines?.map((line, index) => (
                  <View key={`${line.batchNumber}-${index}`} style={styles.lineCard}>
                    <View style={styles.lineHeading}>
                      <Text style={styles.lineBrand}>{line.brand}</Text>
                      <Text style={styles.lineTotal}>{formatCurrency(line.totalPrice)}</Text>
                    </View>
                    <Text style={styles.lineDetails}>{line.details || 'No additional details'}</Text>
                    <Text style={styles.lineMeta}>
                      Batch {line.batchNumber || '—'} · Qty {line.quantity}
                      {' · '}{formatCurrency(line.unitPrice)} each
                    </Text>
                  </View>
                ))
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No item details are available for this invoice.</Text>
                </View>
              )}

              <View style={styles.totalsCard}>
                <MoneyRow
                  label="Subtotal"
                  value={formatCurrency(selectedInvoice.subtotalAmount ?? selectedInvoice.amount)}
                />
                {(selectedInvoice.discountAmount ?? 0) > 0 ? (
                  <MoneyRow
                    label="Discount"
                    value={`-${formatCurrency(selectedInvoice.discountAmount ?? 0)}`}
                  />
                ) : null}
                {(selectedInvoice.taxAmount ?? 0) > 0 ? (
                  <MoneyRow
                    label={`VAT/TAX (${selectedInvoice.taxRate ?? 0}%)`}
                    value={formatCurrency(selectedInvoice.taxAmount ?? 0)}
                  />
                ) : null}
                {(selectedInvoice.cashRoundingAmount ?? 0) !== 0 ? (
                  <MoneyRow
                    label="Cash rounding"
                    value={formatCurrency(selectedInvoice.cashRoundingAmount ?? 0)}
                  />
                ) : null}
                <MoneyRow
                  emphasized
                  label="Grand total"
                  value={formatCurrency(selectedInvoice.amount)}
                />
                <MoneyRow
                  label="Paid"
                  value={formatCurrency(selectedInvoice.paidAmount ?? selectedInvoice.amount)}
                />
                <MoneyRow label="Due" value={formatCurrency(selectedInvoice.dueAmount ?? 0)} />
              </View>
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function InvoiceDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.invoiceDetail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function MoneyRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <View style={[styles.moneyRow, emphasized && styles.moneyRowEmphasized]}>
      <Text style={[styles.moneyLabel, emphasized && styles.moneyLabelEmphasized]}>{label}</Text>
      <Text style={[styles.moneyValue, emphasized && styles.moneyValueEmphasized]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f8f5',
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
  searchInput: {
    minHeight: 46,
    marginBottom: 12,
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
  invoiceCard: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  invoiceCardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  invoiceMain: {
    flex: 1,
  },
  invoiceNumber: {
    color: '#16845f',
    fontSize: 15,
    fontWeight: '800',
  },
  customerName: {
    marginTop: 4,
    color: '#37483f',
    fontSize: 13,
    fontWeight: '600',
  },
  invoiceAmount: {
    maxWidth: '44%',
    color: '#173c2c',
    fontSize: 15,
    fontWeight: '800',
  },
  invoiceDate: {
    marginTop: 9,
    color: '#7a8980',
    fontSize: 11,
  },
  invoiceCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  invoiceMeta: {
    flex: 1,
    color: '#627169',
    fontSize: 11,
  },
  invoiceDue: {
    color: '#596a61',
    fontSize: 11,
    fontWeight: '700',
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
    color: '#7b8981',
    fontSize: 12,
    lineHeight: 18,
  },
  pagination: {
    gap: 10,
    marginTop: 16,
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
  modalBrand: {
    color: '#c2d8ce',
    fontSize: 11,
    fontWeight: '700',
  },
  modalSubtitle: {
    marginTop: 3,
    color: '#fffdf7',
    fontSize: 15,
    fontWeight: '800',
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
  detailsCard: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  invoiceDetail: {
    marginBottom: 12,
  },
  detailLabel: {
    color: '#87928d',
    fontSize: 11,
  },
  detailValue: {
    marginTop: 4,
    color: '#26352f',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 9,
    color: '#203128',
    fontSize: 15,
    fontWeight: '800',
  },
  lineCard: {
    marginBottom: 8,
    padding: 13,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  lineHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  lineBrand: {
    flex: 1,
    color: '#26352f',
    fontSize: 13,
    fontWeight: '700',
  },
  lineTotal: {
    color: '#16845f',
    fontSize: 13,
    fontWeight: '800',
  },
  lineDetails: {
    marginTop: 5,
    color: '#526158',
    fontSize: 12,
  },
  lineMeta: {
    marginTop: 7,
    color: '#7b8981',
    fontSize: 11,
  },
  totalsCard: {
    gap: 11,
    marginTop: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  moneyLabel: {
    flex: 1,
    color: '#526158',
    fontSize: 12,
  },
  moneyValue: {
    color: '#34453b',
    fontSize: 12,
    fontWeight: '600',
  },
  moneyRowEmphasized: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e9eeea',
  },
  moneyLabelEmphasized: {
    color: '#16845f',
    fontSize: 15,
    fontWeight: '800',
  },
  moneyValueEmphasized: {
    color: '#16845f',
    fontSize: 15,
    fontWeight: '800',
  },
});
