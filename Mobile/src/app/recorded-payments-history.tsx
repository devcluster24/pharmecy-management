import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import {
  formatCurrency,
  getRecordedPayments,
  type DailyPaymentGroup,
} from '@/lib/recorded-payments';
import { useAuth } from '@/providers/AuthProvider';

type DateSelector = 'month' | 'year' | null;

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, month) => ({
  value: month,
  label: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2026, month, 1)),
}));

export default function RecordedPaymentsHistoryScreen() {
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [history, setHistory] = useState<DailyPaymentGroup[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [activeDateSelector, setActiveDateSelector] = useState<DateSelector>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: Math.max(1, currentYear - Math.min(
      currentYear,
      ...history.map((group) => Number(group.dateKey.slice(0, 4))),
    ) + 1) },
    (_, index) => currentYear - index,
  );
  const selectedMonthHistory = history.filter((group) => (
    Number(group.dateKey.slice(0, 4)) === selectedYear
    && Number(group.dateKey.slice(5, 7)) === selectedMonth + 1
  ));
  const selectedMonthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' })
    .format(new Date(selectedYear, selectedMonth, 1));

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    async function loadPaymentHistory() {
      if (!supabase || !session) {
        setError('Payment history is unavailable. Check your account connection.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError('');
      try {
        const result = await supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-sales-list-v1')
          .maybeSingle();
        if (result.error) throw result.error;
        const payments = getRecordedPayments(result.data?.payload ?? [], null);
        if (active) setHistory(payments.dailyGroups);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load total payment history.',
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadPaymentHistory();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]);

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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.brand}>Pharmacy Cluster</Text>
          <Text style={styles.headerSubtitle}>Payment history</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to Home"
          onPress={() => router.replace('/dashboard')}
          style={styles.homeButton}>
          <SymbolView
            name={{ ios: 'house.fill', android: 'home', web: 'home' }}
            size={19}
            tintColor="#fffdf7"
          />
        </Pressable>
      </View>

      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Total History</Text>
        <Text style={styles.subtitle}>
          Recorded sale payments by date and payment method.
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
        ) : isLoading ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : (
          <>
            <View style={styles.periodSelectors}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select month"
                onPress={() => setActiveDateSelector('month')}
                style={styles.periodSelector}>
                <Text style={styles.periodSelectorLabel}>Month</Text>
                <Text style={styles.periodSelectorValue}>{selectedMonthLabel}</Text>
                <SymbolView
                  name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                  size={15}
                  tintColor="#17664f"
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select year"
                onPress={() => setActiveDateSelector('year')}
                style={styles.periodSelector}>
                <Text style={styles.periodSelectorLabel}>Year</Text>
                <Text style={styles.periodSelectorValue}>{selectedYear}</Text>
                <SymbolView
                  name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
                  size={15}
                  tintColor="#17664f"
                />
              </Pressable>
            </View>
            <View style={styles.historyList}>
            {selectedMonthHistory.length > 0 ? selectedMonthHistory.flatMap((group) => group.payments.map((payment) => ({
              ...payment,
              dateKey: group.dateKey,
              dateLabel: group.dateLabel,
            }))).map((payment, index) => (
              <View
                key={`${payment.dateKey}-${payment.name}`}
                style={[
                  styles.historyRow,
                  index === 0 && styles.historyRowFirst,
                ]}>
                <Text numberOfLines={1} style={styles.date}>
                  {payment.dateLabel}
                </Text>
                <Text numberOfLines={1} style={styles.method}>
                  {payment.name}
                </Text>
                <Text style={styles.amount}>
                  {formatCurrency(payment.amount)}
                </Text>
              </View>
            )) : (
              <Text style={styles.emptyText}>No recorded payment history yet.</Text>
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Select {activeDateSelector === 'month' ? 'Month' : 'Year'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close date selector"
                onPress={() => setActiveDateSelector(null)}
                style={styles.modalClose}>
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.optionsList}>
              {(activeDateSelector === 'month' ? MONTH_OPTIONS : years.map((year) => ({
                value: year,
                label: String(year),
              }))).map((option) => {
                const isSelected = activeDateSelector === 'month'
                  ? option.value === selectedMonth
                  : option.value === selectedYear;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      if (activeDateSelector === 'month') setSelectedMonth(option.value);
                      else setSelectedYear(option.value);
                      setActiveDateSelector(null);
                    }}
                    style={[styles.option, isSelected && styles.optionSelected]}>
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                    {isSelected ? (
                      <SymbolView
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={16}
                        tintColor="#17664f"
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    backgroundColor: '#f4f8f5',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f8f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#286b55',
    backgroundColor: '#145642',
  },
  backButton: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#fffdf7',
    fontSize: 32,
    lineHeight: 36,
  },
  headerText: {
    flex: 1,
  },
  brand: {
    color: '#fffdf7',
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#c2d8ce',
    fontSize: 10,
  },
  homeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#5d927c',
    borderRadius: 12,
    backgroundColor: '#1c654d',
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
    marginTop: 8,
    marginBottom: 16,
    color: '#59706d',
    fontSize: 12,
    lineHeight: 18,
  },
  periodSelectors: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  periodSelector: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce8e0',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  periodSelectorLabel: {
    color: '#87938c',
    fontSize: 10,
  },
  periodSelectorValue: {
    flex: 1,
    color: '#203128',
    fontSize: 12,
    fontWeight: '700',
  },
  historyList: {
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  historyRowFirst: {
    borderTopWidth: 0,
  },
  date: {
    flex: 1,
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  method: {
    width: 76,
    color: '#65746b',
    fontSize: 11,
  },
  amount: {
    minWidth: 86,
    textAlign: 'right',
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyText: {
    paddingVertical: 12,
    color: '#87938c',
    fontSize: 11,
  },
  loader: {
    marginTop: 32,
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(15, 35, 27, 0.42)',
  },
  modalCard: {
    maxHeight: '75%',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  modalTitle: {
    color: '#203128',
    fontSize: 16,
    fontWeight: '700',
  },
  modalClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#65746b',
    fontSize: 28,
    lineHeight: 32,
  },
  optionsList: {
    paddingHorizontal: 12,
  },
  option: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f3f0',
  },
  optionSelected: {
    backgroundColor: '#f0f8f3',
  },
  optionText: {
    color: '#526158',
    fontSize: 13,
  },
  optionTextSelected: {
    color: '#17664f',
    fontWeight: '700',
  },
});
