import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text, TextInput, useLocalizedAlert, useTranslate } from '@/providers/LanguageProvider';
import { getCurrencySymbol } from '@/lib/currency';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

const EXPENSES_KEY = 'pharmacy-expenses-v1';
const PAYMENT_METHODS_KEY = 'pharmacy-payment-methods-v1';
const EXPENSES_PER_PAGE = 10;
const EXPENSE_CATEGORIES = [
  'Rent',
  'Salary',
  'Electricity',
  'Utilities',
  'Transport',
  'Maintenance',
  'Office supplies',
  'Other',
] as const;

type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
type ExpenseRecord = {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  createdAt: string;
};
type PaymentMethod = {
  id: string;
  type: 'mobile' | 'bank';
  name: string;
};
type PickerType = 'category' | 'payment' | null;

function todayInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function isExpenseRecord(value: unknown): value is ExpenseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && row.id.length > 0
    && typeof row.date === 'string'
    && isValidDate(row.date)
    && typeof row.category === 'string'
    && row.category.trim().length > 0
    && typeof row.description === 'string'
    && row.description.trim().length > 0
    && typeof row.amount === 'number'
    && Number.isFinite(row.amount)
    && (row.amount > 0 || (row.amount === 0 && row.category === 'Destroy' && row.paymentMethod === ''))
    && typeof row.paymentMethod === 'string'
    && typeof row.createdAt === 'string'
    && Number.isFinite(Date.parse(row.createdAt));
}

function readPaymentMethods(value: unknown): PaymentMethod[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Saved payment methods are invalid. Update them in Settings.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Saved payment methods are invalid. Update them in Settings.');
    }
    const row = entry as Record<string, unknown>;
    if (row.type === 'mobile' && typeof row.id === 'string' && typeof row.name === 'string') {
      return { id: row.id, type: 'mobile', name: row.name };
    }
    if (row.type === 'bank' && typeof row.id === 'string' && typeof row.bankName === 'string') {
      return { id: row.id, type: 'bank', name: row.bankName };
    }
    throw new Error('Saved payment methods are invalid. Update them in Settings.');
  });
}

function formatCurrency(amount: number) {
  return `${getCurrencySymbol()}${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatExpenseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })
    : value;
}

function escapeCsvCell(value: string | number) {
  let text = String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function ExpensesScreen() {
  const t = useTranslate();
  const { alert } = useLocalizedAlert();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [date, setDate] = useState(todayInputValue);
  const [category, setCategory] = useState<ExpenseCategory>('Rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pickerType, setPickerType] = useState<PickerType>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  useFocusEffect(useCallback(() => {
    if (isAuthLoading || profileLoading) return;
    if (!session || dashboardRole !== 'owner') {
      setError('Expenses are available to pharmacy owners.');
      setIsLoading(false);
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured.');
      setIsLoading(false);
      return;
    }

    const client = supabase;
    const ownerId = session.user.id;
    const requestId = retryKey;
    let active = true;
    async function loadData() {
      setIsLoading(true);
      setError('');
      try {
        const [expensesResult, paymentMethodsResult] = await Promise.all([
          client.from('pharmacy_app_data')
            .select('payload')
            .eq('owner_user_id', ownerId)
            .eq('data_key', EXPENSES_KEY)
            .maybeSingle(),
          client.from('pharmacy_app_data')
            .select('payload')
            .eq('owner_user_id', ownerId)
            .eq('data_key', PAYMENT_METHODS_KEY)
            .maybeSingle(),
        ]);
        if (expensesResult.error) throw expensesResult.error;
        if (paymentMethodsResult.error) throw paymentMethodsResult.error;
        if (!active || requestId !== retryKey) return;
        const expensePayload = expensesResult.data?.payload;
        if (
          expensePayload !== null
          && expensePayload !== undefined
          && (!Array.isArray(expensePayload) || !expensePayload.every(isExpenseRecord))
        ) {
          throw new Error('Saved expense data is invalid.');
        }
        const loadedPaymentMethods = readPaymentMethods(paymentMethodsResult.data?.payload);
        if (!active) return;
        setExpenses((expensePayload ?? []) as ExpenseRecord[]);
        setPaymentMethods(loadedPaymentMethods);
      } catch (loadError) {
        if (active && requestId === retryKey) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load expenses.');
        }
      } finally {
        if (active && requestId === retryKey) setIsLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]));

  const paymentOptions = useMemo(
    () => [{ id: 'cash', label: 'Cash' }, ...paymentMethods.map((method) => ({
      id: `${method.type}:${method.id}`,
      label: method.name,
    }))],
    [paymentMethods],
  );
  const effectivePaymentMethod = paymentOptions.some((option) => option.id === paymentMethod)
    ? paymentMethod
    : 'cash';
  const currentMonth = todayInputValue().slice(0, 7);
  const monthlyTotal = expenses
    .filter((expense) => expense.date.startsWith(currentMonth))
    .reduce((total, expense) => total + expense.amount, 0);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredExpenses = useMemo(() => expenses
    .filter((expense) => !normalizedSearch || [
      expense.date,
      expense.category,
      expense.description,
      expense.paymentMethod,
      String(expense.amount),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) =>
      right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)),
  [expenses, normalizedSearch]);
  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const visibleExpenses = filteredExpenses.slice(
    (safePage - 1) * EXPENSES_PER_PAGE,
    safePage * EXPENSES_PER_PAGE,
  );
  const selectedPaymentLabel = paymentOptions.find((option) => option.id === effectivePaymentMethod)?.label ?? 'Cash';

  async function persistExpenses(nextExpenses: ExpenseRecord[]) {
    if (!supabase || !session || dashboardRole !== 'owner') {
      throw new Error('Expenses are available to pharmacy owners.');
    }
    const client = supabase;
    const ownerId = session.user.id;
    const existing = await client.from('pharmacy_app_data')
      .select('data_key')
      .eq('owner_user_id', ownerId)
      .eq('data_key', EXPENSES_KEY)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const updatedAt = new Date().toISOString();
    const result = existing.data
      ? await client.from('pharmacy_app_data')
        .update({ payload: nextExpenses, updated_at: updatedAt })
        .eq('owner_user_id', ownerId)
        .eq('data_key', EXPENSES_KEY)
        .select('data_key')
        .maybeSingle()
      : await client.from('pharmacy_app_data')
        .insert({
          owner_user_id: ownerId,
          data_key: EXPENSES_KEY,
          payload: nextExpenses,
          updated_at: updatedAt,
        })
        .select('data_key')
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Could not save expenses. Check your account permissions and try again.');
    setExpenses(nextExpenses);
  }

  async function saveExpense() {
    setFormError('');
    setActionError('');
    setMessage('');
    const parsedAmount = Number(amount);
    if (!isValidDate(date)) {
      const message = 'Enter a valid date in YYYY-MM-DD format.';
      setFormError(message);
      alert('Check your input', message);
      return;
    }
    if (!description.trim() || description.trim().length > 160) {
      const message = 'Enter a description up to 160 characters.';
      setFormError(message);
      alert('Check your input', message);
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      const message = 'Enter an amount greater than zero.';
      setFormError(message);
      alert('Check your input', message);
      return;
    }
    if (isSaving) return;

    const expense: ExpenseRecord = {
      id: Crypto.randomUUID(),
      date,
      category,
      description: description.trim(),
      amount: Number(parsedAmount.toFixed(2)),
      paymentMethod: selectedPaymentLabel,
      createdAt: new Date().toISOString(),
    };
    setIsSaving(true);
    try {
      await persistExpenses([expense, ...expenses]);
      setDate(todayInputValue());
      setCategory('Rent');
      setDescription('');
      setAmount('');
      setPaymentMethod('cash');
      setCurrentPage(1);
      setMessage('Expense saved.');
      alert('Success', 'Expense saved.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save this expense.';
      setFormError(message);
      alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDelete(expense: ExpenseRecord) {
    alert(
      'Delete expense?',
      `Delete the expense "${expense.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteExpense(expense);
          },
        },
      ],
    );
  }

  async function deleteExpense(expense: ExpenseRecord) {
    setActionError('');
    setMessage('');
    setDeletingId(expense.id);
    try {
      await persistExpenses(expenses.filter((row) => row.id !== expense.id));
      setMessage('Expense deleted.');
      alert('Success', 'Expense deleted.');
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Could not delete this expense.';
      setActionError(message);
      alert('Error', message);
    } finally {
      setDeletingId('');
    }
  }

  async function exportExpenses() {
    setActionError('');
    setIsExporting(true);
    try {
      if (!await Sharing.isAvailableAsync()) {
        throw new Error('Expense export is not available on this device.');
      }
      const csv = [
        ['Date', 'Category', 'Description', 'Payment Method', 'Amount'],
        ...filteredExpenses.map((expense) => [
          expense.date,
          expense.category,
          expense.description,
          expense.paymentMethod,
          expense.amount.toFixed(2),
        ]),
      ].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
      const file = new File(Paths.cache, `Expenses-${Crypto.randomUUID()}.csv`);
      file.write(`\uFEFF${csv}`);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: t('Export expenses'),
        UTI: 'public.comma-separated-values-text',
      });
      alert('Success', 'Expense export is ready to share.');
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Could not export expenses.';
      setActionError(message);
      alert('Error', message);
    } finally {
      setIsExporting(false);
    }
  }

  function openPicker(type: Exclude<PickerType, null>) {
    setPickerType(type);
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>{t('Expenses')}</Text>
      <Text style={styles.subtitle}>{t('Record and review day-to-day pharmacy expenses.')}</Text>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{t(error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)} style={styles.retryButton}>
            <Text style={styles.retryText}>{t('Retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#17664f" />
          <Text style={styles.loadingText}>{t('Loading expenses...')}</Text>
        </View>
      ) : !error ? (
        <>
          <View style={styles.metrics}>
            <Metric label="This month" value={formatCurrency(monthlyTotal)} detail="Expenses recorded in the current month" />
            <Metric label="All expenses" value={String(expenses.length)} detail="Total saved expense records" />
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{t('Add expense')}</Text>
            <Text style={styles.fieldLabel}>{t('Date')}</Text>
            <TextInput
              accessibilityLabel={t('Expense date')}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#87928d"
              style={styles.input}
              value={date}
            />

            <Text style={styles.fieldLabel}>{t('Category')}</Text>
            <PickerButton label={t(category)} onPress={() => openPicker('category')} />

            <Text style={styles.fieldLabel}>{t('Description')}</Text>
            <TextInput
              accessibilityLabel={t('Expense description')}
              maxLength={160}
              onChangeText={setDescription}
              placeholder={t('e.g. Shop rent')}
              placeholderTextColor="#87928d"
              style={styles.input}
              value={description}
            />

            <Text style={styles.fieldLabel}>{t('Amount')}</Text>
            <TextInput
              accessibilityLabel={t('Expense amount')}
              keyboardType="decimal-pad"
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#87928d"
              style={styles.input}
              value={amount}
            />

            <Text style={styles.fieldLabel}>{t('Payment method')}</Text>
            <PickerButton label={t(selectedPaymentLabel)} onPress={() => openPicker('payment')} />

            {formError ? <Text accessibilityRole="alert" style={styles.errorText}>{t(formError)}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => void saveExpense()}
              style={[styles.primaryButton, isSaving && styles.disabledButton]}>
              {isSaving ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text style={styles.primaryButtonText}>{t(isSaving ? 'Saving...' : 'Save expense')}</Text>
            </Pressable>
          </View>

          <View style={styles.listPanel}>
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>{t('Expense list')}</Text>
              <Text style={styles.helperText}>
                {t('Search by date, category, description, payment method, or amount.')}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isExporting || filteredExpenses.length === 0}
                onPress={() => void exportExpenses()}
                style={[styles.exportButton, (isExporting || filteredExpenses.length === 0) && styles.disabledButton]}>
                {isExporting ? <ActivityIndicator size="small" color="#17664f" /> : null}
                <Text style={styles.exportButtonText}>{t(isExporting ? 'Exporting...' : 'Export CSV')}</Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={t('Search expenses')}
              autoCapitalize="none"
              onChangeText={(value) => {
                setSearch(value);
                setCurrentPage(1);
              }}
              placeholder={t('Search expenses...')}
              placeholderTextColor="#87928d"
              returnKeyType="search"
              style={styles.searchInput}
              value={search}
            />
            {actionError ? <Text accessibilityRole="alert" style={styles.errorText}>{t(actionError)}</Text> : null}
            {message ? <Text style={styles.successText}>{t(message)}</Text> : null}

            {visibleExpenses.map((expense) => (
              <View key={expense.id} style={styles.expenseCard}>
                <View style={styles.expenseHeader}>
                  <View style={styles.expenseTitleWrap}>
                    <Text style={styles.expenseCategory}>{t(expense.category)}</Text>
                    <Text style={styles.expenseDate}>{formatExpenseDate(expense.date)}</Text>
                  </View>
                  <Text style={styles.expenseAmount}>{formatCurrency(expense.amount)}</Text>
                </View>
                <Text style={styles.expenseDescription}>{expense.description}</Text>
                <View style={styles.expenseFooter}>
                  <Text style={styles.expensePayment}>{t(expense.paymentMethod)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('Delete expense')} ${expense.description}`}
                    disabled={deletingId === expense.id}
                    onPress={() => confirmDelete(expense)}
                    style={[styles.deleteButton, deletingId === expense.id && styles.disabledButton]}>
                    <Text style={styles.deleteText}>
                      {deletingId === expense.id ? t('Deleting...') : t('Delete')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {visibleExpenses.length === 0 ? (
              <Text style={styles.emptyText}>
                {normalizedSearch ? t('No expenses match this search.') : t('No expenses have been added yet.')}
              </Text>
            ) : null}

            <View style={styles.pagination}>
              <Text style={styles.paginationText}>
                {filteredExpenses.length === 0
                  ? t('Showing 0 expenses')
                  : `${t('Showing')} ${(safePage - 1) * EXPENSES_PER_PAGE + 1}-${Math.min(safePage * EXPENSES_PER_PAGE, filteredExpenses.length)} ${t('of')} ${filteredExpenses.length} ${t('expenses')}`}
              </Text>
              <View style={styles.pageControls}>
                <Pressable
                  accessibilityRole="button"
                  disabled={safePage <= 1}
                  onPress={() => setCurrentPage(safePage - 1)}
                  style={[styles.pageButton, safePage <= 1 && styles.disabledButton]}>
                  <Text style={styles.pageButtonText}>{t('Previous')}</Text>
                </Pressable>
                <Text style={styles.paginationText}>{t('Page')} {safePage} {t('of')} {totalPages}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={safePage >= totalPages}
                  onPress={() => setCurrentPage(safePage + 1)}
                  style={[styles.pageButton, safePage >= totalPages && styles.disabledButton]}>
                  <Text style={styles.pageButtonText}>{t('Next')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setPickerType(null)}
        transparent
        visible={pickerType !== null}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerType(null)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sectionTitle}>
              {t(pickerType === 'category' ? 'Choose category' : 'Choose payment method')}
            </Text>
            <ScrollView style={styles.optionList} keyboardShouldPersistTaps="handled">
              {(pickerType === 'category'
                ? EXPENSE_CATEGORIES.map((option) => ({ id: option, label: option }))
                : paymentOptions).map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: pickerType === 'category' ? category === option.id : effectivePaymentMethod === option.id,
                  }}
                  onPress={() => {
                    if (pickerType === 'category') setCategory(option.id as ExpenseCategory);
                    else setPaymentMethod(option.id);
                    setPickerType(null);
                  }}
                  style={styles.option}>
                  <Text style={styles.optionText}>{t(option.label)}</Text>
                  {(pickerType === 'category' ? category === option.id : effectivePaymentMethod === option.id)
                    ? <Text style={styles.selectedMark}>✓</Text>
                    : null}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={() => setPickerType(null)} style={styles.cancelButton}>
              <Text style={styles.cancelText}>{t('Cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  const t = useTranslate();
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{t(label)}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{t(detail)}</Text>
    </View>
  );
}

function PickerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pickerButton}>
      <Text style={styles.pickerText}>{label}</Text>
      <Text style={styles.pickerChevron}>⌄</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f8f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  title: {
    color: '#203128',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: -8,
    color: '#718078',
    fontSize: 13,
    lineHeight: 19,
  },
  metrics: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    padding: 13,
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  metricLabel: {
    color: '#687871',
    fontSize: 11,
  },
  metricValue: {
    marginTop: 6,
    color: '#172622',
    fontSize: 19,
    fontWeight: '800',
  },
  metricDetail: {
    marginTop: 4,
    color: '#85918c',
    fontSize: 9,
    lineHeight: 13,
  },
  panel: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    color: '#26352f',
    fontSize: 15,
    fontWeight: '800',
  },
  fieldLabel: {
    marginTop: 12,
    marginBottom: 6,
    color: '#526158',
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 13,
  },
  pickerButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  pickerText: {
    color: '#26352f',
    fontSize: 13,
  },
  pickerChevron: {
    color: '#718078',
    fontSize: 18,
  },
  primaryButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.55,
  },
  listPanel: {
    overflow: 'hidden',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  listHeader: {
    marginBottom: 12,
  },
  helperText: {
    marginTop: 4,
    color: '#77857d',
    fontSize: 10,
    lineHeight: 15,
  },
  exportButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#cddfd3',
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  exportButtonText: {
    color: '#246548',
    fontSize: 11,
    fontWeight: '700',
  },
  searchInput: {
    minHeight: 42,
    marginBottom: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 13,
  },
  expenseCard: {
    marginBottom: 9,
    padding: 12,
    borderWidth: 1,
    borderColor: '#edf0ed',
    borderRadius: 9,
    backgroundColor: '#fbfcfb',
  },
  expenseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  expenseTitleWrap: {
    flex: 1,
  },
  expenseCategory: {
    color: '#26352f',
    fontSize: 13,
    fontWeight: '800',
  },
  expenseDate: {
    marginTop: 3,
    color: '#849189',
    fontSize: 10,
  },
  expenseAmount: {
    color: '#17664f',
    fontSize: 13,
    fontWeight: '800',
  },
  expenseDescription: {
    marginTop: 9,
    color: '#42524b',
    fontSize: 12,
  },
  expenseFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  expensePayment: {
    color: '#77857d',
    fontSize: 10,
  },
  deleteButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#f0d5d3',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  deleteText: {
    color: '#ad4b43',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyText: {
    paddingVertical: 20,
    color: '#87928d',
    fontSize: 12,
    textAlign: 'center',
  },
  pagination: {
    gap: 10,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  paginationText: {
    color: '#87928d',
    fontSize: 10,
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 7,
  },
  pageButton: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  pageButtonText: {
    color: '#34453b',
    fontSize: 10,
    fontWeight: '700',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: {
    color: '#718078',
    fontSize: 13,
  },
  errorCard: {
    padding: 13,
    borderWidth: 1,
    borderColor: '#f0d5d3',
    borderRadius: 9,
    backgroundColor: '#fff8f7',
  },
  errorText: {
    marginTop: 10,
    color: '#ad4b43',
    fontSize: 11,
    lineHeight: 16,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  retryText: {
    color: '#17664f',
    fontSize: 11,
    fontWeight: '700',
  },
  successText: {
    marginBottom: 8,
    color: '#18794e',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(16, 32, 23, 0.48)',
  },
  modalCard: {
    maxHeight: '78%',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  optionList: {
    marginTop: 10,
  },
  option: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  optionText: {
    color: '#26352f',
    fontSize: 13,
  },
  selectedMark: {
    color: '#17664f',
    fontSize: 16,
    fontWeight: '800',
  },
  cancelButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 7,
    backgroundColor: '#f1f5f2',
  },
  cancelText: {
    color: '#526158',
    fontSize: 12,
    fontWeight: '700',
  },
});
