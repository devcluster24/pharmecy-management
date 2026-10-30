import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCurrencySymbol } from '@/lib/currency';
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';
import {
  formatStaffSaleCurrency,
  parseStaffSales,
  type StaffSale,
} from '@/lib/staff-sales';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { Text } from '@/providers/LanguageProvider';

type DateSelector = 'month' | 'year' | null;

const monthOptions = Array.from({ length: 12 }, (_, month) => ({
  value: month,
  label: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2026, month, 1)),
}));

function formatCurrency(amount: number) {
  return `${getCurrencySymbol()}${formatStaffSaleCurrency(amount)}`;
}

export default function StaffSalesHistoryScreen() {
  const { dashboardRole, profileLoading, pharmacyOwnerId, session, storeName, staffPermissions } = useAuth();
  const [sales, setSales] = useState<StaffSale[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [activeDateSelector, setActiveDateSelector] = useState<DateSelector>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const hasSalesAccess = staffPermissions.sales === true;
  const currentYear = new Date().getFullYear();
  const selectedMonthLabel = monthOptions[selectedMonth]?.label ?? '';
  const years = useMemo(() => {
    const earliestYear = Math.min(
      currentYear,
      ...sales.map((sale) => new Date(sale.createdAt).getFullYear()),
    );
    return Array.from({ length: currentYear - earliestYear + 1 }, (_, index) => currentYear - index);
  }, [currentYear, sales]);
  const selectedSales = useMemo(
    () => sales.filter((sale) => {
      const date = new Date(sale.createdAt);
      return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
    }),
    [sales, selectedMonth, selectedYear],
  );
  const selectedTotal = selectedSales.reduce((total, sale) => total + sale.amount, 0);

  useEffect(() => {
    if (profileLoading) return;
    if (dashboardRole !== 'staff' || !hasSalesAccess) {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    async function loadSalesHistory() {
      if (!supabase || !session || !pharmacyOwnerId) {
        setError('Sales history is unavailable. Check your account connection.');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError('');
      try {
        const { data, error: queryError } = await supabase.rpc('get_my_pharmacy_staff_sales');
        if (queryError) throw queryError;
        const staffSales = parseStaffSales(data, session.user.id);
        if (active) setSales(staffSales);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load your sales history.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadSalesHistory();
    return () => {
      active = false;
    };
  }, [dashboardRole, hasSalesAccess, pharmacyOwnerId, profileLoading, retryKey, session]);

  if (profileLoading || dashboardRole !== 'staff' || !hasSalesAccess) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </SafeAreaView>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#145642" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.headerButton}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={20}
              tintColor="#fffdf7"
            />
          </Pressable>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.storeName}>
              {getPharmacyDisplayName(storeName)}
            </Text>
            <Text style={styles.headerSubtitle}>My sales history</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to Home"
            onPress={() => router.replace('/dashboard')}
            style={styles.headerButton}>
            <SymbolView
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              size={19}
              tintColor="#fffdf7"
            />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>My Sale History</Text>
          <Text style={styles.subtitle}>Only invoices created by your staff account are shown.</Text>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : isLoading ? (
            <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
          ) : (
            <>
              <View style={styles.selectors}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select month"
                  onPress={() => setActiveDateSelector('month')}
                  style={styles.selector}>
                  <Text style={styles.selectorLabel}>Month</Text>
                  <View style={styles.selectorValueRow}>
                    <Text style={styles.selectorValue}>{selectedMonthLabel}</Text>
                    <SymbolView
                      name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                      size={16}
                      tintColor="#17664f"
                    />
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select year"
                  onPress={() => setActiveDateSelector('year')}
                  style={styles.selector}>
                  <Text style={styles.selectorLabel}>Year</Text>
                  <View style={styles.selectorValueRow}>
                    <Text style={styles.selectorValue}>{selectedYear}</Text>
                    <SymbolView
                      name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                      size={16}
                      tintColor="#17664f"
                    />
                  </View>
                </Pressable>
              </View>

              <View style={styles.summaryCard}>
                <View>
                  <Text style={styles.summaryLabel}>{selectedMonthLabel} {selectedYear}</Text>
                  <Text style={styles.summaryCount}>{selectedSales.length} invoices</Text>
                </View>
                <Text style={styles.summaryTotal}>{formatCurrency(selectedTotal)}</Text>
              </View>

              <View style={styles.listCard}>
                {selectedSales.length ? selectedSales.map((sale, index) => (
                  <View
                    key={sale.id}
                    style={[styles.saleRow, index === 0 && styles.saleRowFirst]}>
                    <View style={styles.saleDetails}>
                      <Text style={styles.invoiceNumber}>{sale.invoiceNumber}</Text>
                      <Text style={styles.saleMeta}>
                        {sale.customer} · {new Date(sale.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <Text style={styles.saleAmount}>{formatCurrency(sale.amount)}</Text>
                  </View>
                )) : (
                  <Text style={styles.emptyText}>No sales for this month.</Text>
                )}
              </View>
            </>
          )}
        </ScrollView>

        <Modal
          animationType="fade"
          onRequestClose={() => setActiveDateSelector(null)}
          transparent
          visible={activeDateSelector !== null}>
          <Pressable style={styles.modalBackdrop} onPress={() => setActiveDateSelector(null)}>
            <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
              <Text style={styles.modalTitle}>
                Select {activeDateSelector === 'month' ? 'month' : 'year'}
              </Text>
              <ScrollView style={styles.optionList} showsVerticalScrollIndicator={false}>
                {(activeDateSelector === 'month'
                  ? monthOptions
                  : years.map((year) => ({ value: year, label: String(year) }))
                ).map((option) => {
                  const selected = activeDateSelector === 'month'
                    ? option.value === selectedMonth
                    : option.value === selectedYear;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (activeDateSelector === 'month') setSelectedMonth(option.value);
                        else setSelectedYear(option.value);
                        setActiveDateSelector(null);
                      }}
                      style={[styles.option, selected && styles.optionSelected]}>
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f2f4ef' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f4ef' },
  header: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    backgroundColor: '#145642',
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  storeName: { color: '#fffdf7', fontSize: 14, fontWeight: '800' },
  headerSubtitle: { marginTop: 2, color: '#d9ebe1', fontSize: 11 },
  content: { padding: 18, paddingBottom: 28 },
  title: { color: '#183c31', fontSize: 22, fontWeight: '800' },
  subtitle: { marginTop: 5, color: '#758078', fontSize: 12, lineHeight: 18 },
  selectors: { flexDirection: 'row', gap: 10, marginTop: 18 },
  selector: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 13,
    backgroundColor: '#fffefa',
  },
  selectorLabel: { color: '#758078', fontSize: 10, fontWeight: '600' },
  selectorValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  selectorValue: { color: '#183c31', fontSize: 13, fontWeight: '700' },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#eaf4e5',
  },
  summaryLabel: { color: '#315b47', fontSize: 12, fontWeight: '700' },
  summaryCount: { marginTop: 3, color: '#758078', fontSize: 11 },
  summaryTotal: { color: '#183c31', fontSize: 16, fontWeight: '800' },
  listCard: {
    marginTop: 12,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 14,
    backgroundColor: '#fffefa',
  },
  saleRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e8e2',
  },
  saleRowFirst: { borderTopWidth: 0 },
  saleDetails: { flex: 1, minWidth: 0 },
  invoiceNumber: { color: '#183c31', fontSize: 12, fontWeight: '700' },
  saleMeta: { marginTop: 4, color: '#758078', fontSize: 10 },
  saleAmount: { color: '#17664f', fontSize: 12, fontWeight: '800' },
  emptyText: { paddingVertical: 24, color: '#758078', fontSize: 12, textAlign: 'center' },
  errorCard: {
    alignItems: 'center',
    gap: 9,
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff3f0',
  },
  errorText: { color: '#a63e34', fontSize: 12, textAlign: 'center' },
  retryText: { color: '#17664f', fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 32 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  modalCard: {
    maxHeight: '75%',
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#fffefa',
  },
  modalTitle: { marginBottom: 8, color: '#183c31', fontSize: 16, fontWeight: '800' },
  optionList: { flexGrow: 0 },
  option: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 9 },
  optionSelected: { backgroundColor: '#eaf4e5' },
  optionText: { color: '#315b47', fontSize: 13 },
  optionTextSelected: { color: '#17664f', fontWeight: '800' },
});
