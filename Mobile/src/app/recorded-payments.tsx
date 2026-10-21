import { Text } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import {
  formatCurrency,
  getRecordedPayments,
  PAYMENT_COLORS,
  type DailyPaymentGroup,
  type PaymentTotal,
} from '@/lib/recorded-payments';
import { useAuth } from '@/providers/AuthProvider';

const CHART_DOT_COUNT = 56;
const CHART_SIZE = 164;
const CHART_DOT_SIZE = 8;

function PaymentCircleChart({ totals, total }: { totals: PaymentTotal[]; total: number }) {
  const dots = useMemo(() => {
    const radius = CHART_SIZE / 2 - CHART_DOT_SIZE / 2;
    const segments: { start: number; end: number; color: string }[] = [];
    let accumulated = 0;

    if (total > 0) {
      totals.forEach((payment, index) => {
        const start = accumulated / total;
        accumulated += payment.amount;
        segments.push({
          start,
          end: accumulated / total,
          color: PAYMENT_COLORS[index % PAYMENT_COLORS.length],
        });
      });
    }

    return Array.from({ length: CHART_DOT_COUNT }, (_, index) => {
      const fraction = index / CHART_DOT_COUNT;
      const angle = fraction * Math.PI * 2 - Math.PI / 2;
      const segment = segments.find(({ start, end }) => fraction >= start && fraction < end);
      return {
        key: index,
        color: segment?.color ?? '#e8eee9',
        left: CHART_SIZE / 2 + Math.cos(angle) * radius - CHART_DOT_SIZE / 2,
        top: CHART_SIZE / 2 + Math.sin(angle) * radius - CHART_DOT_SIZE / 2,
      };
    });
  }, [total, totals]);

  return (
    <View accessibilityLabel="Recorded payments circular chart" style={styles.chart}>
      {dots.map((dot) => (
        <View
          key={dot.key}
          style={[
            styles.chartDot,
            { backgroundColor: dot.color, left: dot.left, top: dot.top },
          ]}
        />
      ))}
      <View style={styles.chartCenter}>
        <Text style={styles.chartCaption}>Recorded</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.chartAmount}>
          {formatCurrency(total)}
        </Text>
      </View>
    </View>
  );
}

export default function RecordedPaymentsScreen() {
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [totals, setTotals] = useState<PaymentTotal[]>([]);
  const [dailyGroups, setDailyGroups] = useState<DailyPaymentGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const total = totals.reduce((sum, payment) => sum + payment.amount, 0);
  const recentDailyPayments = dailyGroups
    .flatMap((group) => group.payments.map((payment) => ({
      ...payment,
      dateKey: group.dateKey,
      dateLabel: group.dateLabel,
    })));

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    async function loadRecordedPayments() {
      if (!supabase || !session) {
        setError('Recorded payments are unavailable. Check your account connection.');
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
        const nextPayments = getRecordedPayments(result.data?.payload ?? []);
        if (active) {
          setTotals(nextPayments.totals);
          setDailyGroups(nextPayments.dailyGroups);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load recorded payments.',
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadRecordedPayments();
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
          <Text style={styles.headerSubtitle}>Dashboard payments</Text>
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
        <Text style={styles.title}>Recorded payments</Text>
        <Text style={styles.subtitle}>
          All-time paid amounts saved on sales invoices; not account balances.
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
          <View style={styles.card}>
            <PaymentCircleChart totals={totals} total={total} />
            <View style={styles.totalRow}>
              <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
              <Text style={styles.recordedLabel}>recorded</Text>
            </View>
            <View style={styles.separator} />
            {totals.length > 0 ? totals.map((payment, index) => (
              <View key={payment.name} style={styles.paymentRow}>
                <View style={styles.paymentName}>
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: PAYMENT_COLORS[index % PAYMENT_COLORS.length] },
                    ]}
                  />
                  <Text style={styles.methodName}>{payment.name}</Text>
                </View>
                <Text style={styles.paymentAmount}>{formatCurrency(payment.amount)}</Text>
              </View>
            )) : (
              <Text style={styles.emptyText}>No recorded payments yet.</Text>
            )}
          </View>
        )}
        {!error && !isLoading ? (
          <View style={styles.dailySection}>
            <Text style={styles.dailySectionTitle}>Recent sales · Last 10 days</Text>
            <View style={styles.dailyList}>
              {recentDailyPayments.length > 0 ? recentDailyPayments.map((payment, index) => (
                <View
                  key={`${payment.dateKey}-${payment.name}`}
                  style={[
                    styles.dailyPaymentRow,
                    index === 0 && styles.dailyPaymentRowFirst,
                  ]}>
                  <Text numberOfLines={1} style={styles.dailyDate}>{payment.dateLabel}</Text>
                  <Text numberOfLines={1} style={styles.dailyMethod}>{payment.name}</Text>
                  <Text style={styles.dailyAmount}>{formatCurrency(payment.amount)}</Text>
                </View>
              )) : (
                <Text style={styles.dailyEmpty}>No recorded sales in the last 10 days.</Text>
              )}
            </View>
          </View>
        ) : null}
        {!error && !isLoading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View total payment history"
            onPress={() => router.push('/recorded-payments-history')}
            style={styles.historyButton}>
            <SymbolView
              name={{ ios: 'arrow.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }}
              size={20}
              tintColor="#17664f"
            />
          </Pressable>
        ) : null}
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
  card: {
    alignItems: 'center',
    padding: 18,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  chart: {
    width: CHART_SIZE,
    height: CHART_SIZE,
    alignSelf: 'center',
    marginVertical: 4,
  },
  chartDot: {
    position: 'absolute',
    width: CHART_DOT_SIZE,
    height: CHART_DOT_SIZE,
    borderRadius: CHART_DOT_SIZE / 2,
  },
  chartCenter: {
    position: 'absolute',
    top: 42,
    right: 30,
    bottom: 42,
    left: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartCaption: {
    color: '#849188',
    fontSize: 10,
  },
  chartAmount: {
    maxWidth: '100%',
    marginTop: 4,
    color: '#203128',
    fontSize: 14,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 12,
  },
  totalAmount: {
    color: '#203128',
    fontSize: 25,
    fontWeight: '700',
  },
  recordedLabel: {
    color: '#849188',
    fontSize: 11,
  },
  separator: {
    width: '100%',
    height: 1,
    marginVertical: 16,
    backgroundColor: '#edf0ed',
  },
  paymentRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 13,
  },
  paymentName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  methodName: {
    flexShrink: 1,
    color: '#65746b',
    fontSize: 12,
  },
  paymentAmount: {
    color: '#293a30',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    alignSelf: 'flex-start',
    color: '#87938c',
    fontSize: 12,
  },
  dailySection: {
    marginTop: 18,
    gap: 10,
  },
  dailySectionTitle: {
    color: '#203128',
    fontSize: 15,
    fontWeight: '700',
  },
  dailyList: {
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e3e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  dailyDate: {
    flex: 1,
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  dailyPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  dailyPaymentRowFirst: {
    borderTopWidth: 0,
  },
  dailyMethod: {
    width: 76,
    color: '#65746b',
    fontSize: 11,
  },
  dailyAmount: {
    minWidth: 86,
    textAlign: 'right',
    color: '#293a30',
    fontSize: 11,
    fontWeight: '600',
  },
  dailyEmpty: {
    paddingVertical: 12,
    color: '#87938c',
    fontSize: 11,
  },
  historyButton: {
    width: 42,
    height: 42,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#d9e8df',
    borderRadius: 21,
    backgroundColor: '#fff',
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
});
