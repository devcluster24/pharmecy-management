import { Text } from '@/providers/LanguageProvider';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  loadPharmacySubscriptionOptions,
  type PharmacySubscriptionOptions,
} from '@/lib/pharmacy-subscription';
import { getCurrencySymbol } from '@/lib/currency';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type BillingProfile = {
  fullName: string;
  email: string;
  storeName: string;
  accountCreatedAt: string;
};

type SubscriptionPayment = {
  id: string;
  invoice_number: string;
  plan_name: string;
  amount: number;
  payment_method: string;
  status: 'Active' | 'Inactive' | 'Past Due';
  occurred_at: string;
  expires_at: string | null;
};

const PAYMENT_HISTORY_PER_PAGE = 10;

function isPaymentHistory(value: unknown): value is SubscriptionPayment[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const payment = entry as Record<string, unknown>;
    return typeof payment.id === 'string'
      && typeof payment.invoice_number === 'string'
      && typeof payment.plan_name === 'string'
      && typeof payment.amount === 'number'
      && Number.isFinite(payment.amount)
      && typeof payment.payment_method === 'string'
      && ['Active', 'Inactive', 'Past Due'].includes(String(payment.status))
      && typeof payment.occurred_at === 'string'
      && (payment.expires_at === null || typeof payment.expires_at === 'string');
  });
}

function formatDate(value: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAmount(value: number) {
  return `${getCurrencySymbol()} ${value.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

function formatRemaining(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function getBillingPeriod(period: string, interval: number) {
  if (period === 'one-time') return 'one-time';
  const unit = period === 'minutes'
    ? 'minute'
    : period === 'days'
      ? 'day'
      : period === 'year'
        ? 'year'
        : 'month';
  return `${interval} ${unit}${interval === 1 ? '' : 's'}`;
}

function getNextPlan(
  options: PharmacySubscriptionOptions | null,
  payments: SubscriptionPayment[],
) {
  const currentPlanName = options?.plan?.name.trim().toLowerCase() ?? '';
  const hasPurchasedOneTimeSetup = payments.some(
    (payment) => payment.plan_name.trim().toLowerCase() === 'one-time setup',
  );
  const nextPlanName = hasPurchasedOneTimeSetup
    ? ['starter access', 'extended access', 'one-time setup', 'standard subscription'].includes(currentPlanName)
      ? 'standard subscription'
      : ''
    : ['starter access', 'extended access'].includes(currentPlanName)
      ? 'one-time setup'
      : ['one-time setup', 'standard subscription'].includes(currentPlanName)
        ? 'standard subscription'
        : '';
  return options?.plans.find((plan) => plan.name.trim().toLowerCase() === nextPlanName) ?? null;
}

export default function SubscriptionBillingScreen() {
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
  } = useAuth();
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [options, setOptions] = useState<PharmacySubscriptionOptions | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [paymentHistoryPage, setPaymentHistoryPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentHistoryError, setPaymentHistoryError] = useState('');
  const [isClaimingExtendedAccess, setIsClaimingExtendedAccess] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [now] = useState(() => Date.now());

  const nextPlan = useMemo(() => getNextPlan(options, payments), [options, payments]);
  const pageCount = Math.max(1, Math.ceil(payments.length / PAYMENT_HISTORY_PER_PAGE));
  const safePage = Math.min(paymentHistoryPage, pageCount);
  const visiblePayments = payments.slice(
    (safePage - 1) * PAYMENT_HISTORY_PER_PAGE,
    safePage * PAYMENT_HISTORY_PER_PAGE,
  );
  const currentPlanExpired = Boolean(
    options?.expires_at && Date.parse(options.expires_at) <= now,
  );
  const planName = options?.plan?.name.trim().toLowerCase() ?? '';
  const canClaimExtendedAccess = options?.is_assigned === true && planName === 'starter access';
  const canChooseNextPlan = options?.is_assigned === true
    && !canClaimExtendedAccess
    && ['extended access', 'one-time setup', 'standard subscription'].includes(planName);

  useFocusEffect(useCallback(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner' || !session || !supabase) return;
    const currentSession = session;
    const client = supabase;

    let active = true;
    async function loadBillingDetails() {
      setIsLoading(true);
      setIsHistoryLoading(true);
      setError('');
      setPaymentHistoryError('');
      if (retryKey > 0) {
        setPayments([]);
        setPaymentHistoryPage(1);
      }

      try {
        const [profileResult, pharmacyResult, loadedOptions] = await Promise.all([
          client
            .from('user_profiles')
            .select('full_name, email, created_at')
            .eq('id', currentSession.user.id)
            .maybeSingle(),
          client
            .from('pharmacies')
            .select('store_name')
            .eq('owner_user_id', currentSession.user.id)
            .maybeSingle(),
          loadPharmacySubscriptionOptions(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (!profileResult.data) throw new Error('Your pharmacy account information could not be found.');
        if (pharmacyResult.error) throw pharmacyResult.error;

        if (active) {
          setProfile({
            fullName: profileResult.data.full_name || 'Pharmacy Owner',
            email: profileResult.data.email || currentSession.user.email || '',
            storeName: pharmacyResult.data?.store_name || 'Pharmacy account',
            accountCreatedAt: profileResult.data.created_at,
          });
          setOptions(loadedOptions);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load billing information.');
        }
      } finally {
        if (active) setIsLoading(false);
      }

      try {
        const { data, error: historyError } = await client.rpc(
          'get_my_pharmacy_subscription_payment_history',
        );
        if (historyError) throw historyError;
        if (!isPaymentHistory(data)) {
          throw new Error('Supabase returned invalid payment history data.');
        }
        if (active) {
          setPayments(data);
          setPaymentHistoryPage(1);
        }
      } catch (historyLoadError) {
        if (active) {
          setPaymentHistoryError(
            `${historyLoadError instanceof Error ? historyLoadError.message : 'Could not load payment history.'} Apply all subscription migrations through 20261012040000_subscription_payment_invoice_details.sql in Supabase, then retry.`,
          );
        }
      } finally {
        if (active) setIsHistoryLoading(false);
      }
    }

    void loadBillingDetails();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, retryKey, session]));

  async function claimExtendedAccess() {
    if (!supabase || isClaimingExtendedAccess) return;
    setIsClaimingExtendedAccess(true);
    setError('');
    try {
      const { error: claimError } = await supabase.rpc('claim_my_pharmacy_extended_access');
      if (claimError) throw claimError;
      setRetryKey((value) => value + 1);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Could not activate Extended Access.');
    } finally {
      setIsClaimingExtendedAccess(false);
    }
  }

  if (isAuthLoading || profileLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </View>
    );
  }

  if (dashboardRole !== 'owner') {
    return (
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
        <Text style={styles.error}>Subscription billing is available to pharmacy owners only.</Text>
      </ScrollView>
    );
  }

  if (!supabase || !session) {
    return (
      <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
        <Text style={styles.error}>
          {!supabase ? 'Supabase is not configured.' : 'Sign in to view subscription billing.'}
        </Text>
      </ScrollView>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </View>
    );
  }

  const lastPayment = payments[0];
  const expiryTime = options?.expires_at ? Date.parse(options.expires_at) : Number.NaN;
  const hasValidExpiry = Number.isFinite(expiryTime);

  return (
    <ScrollView style={styles.pageContent} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Subscription &amp; Billing</Text>
      <Text style={styles.subtitle}>Manage your subscription plan and view your payment history.</Text>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {!isLoading && options && !options.plan ? (
        <Text style={styles.error}>The Starter Access plan is not available yet. Please contact your administrator.</Text>
      ) : null}

      <View style={styles.topCards}>
        <View style={[styles.card, styles.currentPlanCard]}>
          <View style={styles.cardHeading}>
            <Text style={styles.cardLabel}>Current Plan</Text>
            <Text style={[
              styles.statusBadge,
              currentPlanExpired ? styles.expiredBadge : options?.is_assigned ? styles.activeBadge : styles.availableBadge,
            ]}>
              {currentPlanExpired ? 'Expired' : options?.is_assigned ? 'Active' : 'Available'}
            </Text>
          </View>
          <Text style={styles.planName}>{options?.plan?.name ?? 'Plan not available'}</Text>
          <Text style={styles.muted}>{profile?.storeName ?? 'Your pharmacy account'}</Text>
          <Text style={styles.description}>
            {options?.plan?.description || 'Your Starter Access plan is ready to view.'}
          </Text>
          {options?.plan ? (
            <View style={styles.feeDetails}>
              <Text style={styles.detailText}>
                {options.plan.setup_fee_label}: <Text style={styles.detailStrong}>{formatAmount(options.plan.setup_fee)}</Text>
              </Text>
              <Text style={styles.detailText}>
                {options.plan.billing_period === 'minutes'
                  ? 'Per-minute Fee'
                  : options.plan.billing_period === 'days'
                    ? 'Daily Fee'
                    : options.plan.billing_period === 'year'
                      ? 'Yearly Fee'
                      : 'Monthly Fee'}:{' '}
                <Text style={styles.detailStrong}>{formatAmount(options.plan.recurring_fee)}</Text>
              </Text>
              <Text style={styles.planTotal}>
                {formatAmount(options.plan.setup_fee + options.plan.recurring_fee)}
                <Text style={styles.period}> / {getBillingPeriod(options.plan.billing_period, options.plan.billing_interval)}</Text>
              </Text>
            </View>
          ) : null}
          {options?.is_assigned && options.plan ? (
            <Text style={[styles.expiryText, currentPlanExpired && styles.expiryTextAlert]}>
              {options.expires_at === null
                ? 'This plan does not expire.'
                : currentPlanExpired
                  ? 'This plan has expired. Choose a new plan to restore dashboard actions.'
                  : hasValidExpiry
                    ? `Expires in ${formatRemaining(expiryTime - now)}`
                    : 'Checking plan expiry...'}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <Text style={styles.muted}>
              {options?.is_assigned ? 'Your current subscription plan.' : 'Choose a plan for your pharmacy account.'}
            </Text>
            {canClaimExtendedAccess ? (
              <Pressable
                accessibilityRole="button"
                disabled={isClaimingExtendedAccess}
                onPress={() => void claimExtendedAccess()}
                style={[styles.primaryButton, isClaimingExtendedAccess && styles.disabledButton]}>
                <Text style={styles.primaryButtonText}>
                  {isClaimingExtendedAccess ? 'Activating...' : 'Claim Extended Access'}
                </Text>
              </Pressable>
            ) : canChooseNextPlan ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/subscription-setup')}
                style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Choose New Plan</Text>
              </Pressable>
            ) : (
              <View style={styles.disabledPlanButton}>
                <Text style={styles.disabledPlanButtonText}>Change Plan</Text>
              </View>
            )}
          </View>
        </View>

        <View style={[styles.card, styles.nextPaymentCard]}>
          <Text style={styles.cardLabel}>Next Payment</Text>
          <Text style={styles.nextPaymentAmount}>
            {isHistoryLoading
              ? 'Loading...'
              : paymentHistoryError
                ? 'Not available'
                : nextPlan
                  ? formatAmount(nextPlan.setup_fee + nextPlan.recurring_fee)
                  : 'Not available'}
          </Text>
          <Text style={styles.muted}>
            {isHistoryLoading
              ? 'Checking your next plan'
              : paymentHistoryError
                ? 'Could not verify previous plan purchases'
                : nextPlan
                  ? `Next plan: ${nextPlan.name} · ${getBillingPeriod(nextPlan.billing_period, nextPlan.billing_interval)}`
                  : 'No next plan is configured for this subscription'}
          </Text>
        </View>
      </View>

      <View style={styles.accountCards}>
        {[
          { label: 'Store Owner', value: profile?.fullName || 'Not available', detail: profile?.storeName || '' },
          { label: 'Billing Email', value: profile?.email || 'Not available', detail: 'Account email' },
          { label: 'Payment Method', value: lastPayment?.payment_method || 'Not added', detail: lastPayment ? 'Current subscription' : 'No billing method on file' },
          { label: 'Account Created', value: profile ? formatDate(profile.accountCreatedAt) : 'Not available', detail: 'Pharmacy account' },
        ].map((item) => (
          <View key={item.label} style={styles.accountCard}>
            <Text style={styles.accountCardLabel}>{item.label}</Text>
            <Text style={styles.accountCardValue}>{item.value}</Text>
            {item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}
          </View>
        ))}
      </View>

      <View style={styles.historyCard}>
        <View style={styles.historyHeader}>
          <View>
            <Text style={styles.historyTitle}>Payment History</Text>
            <Text style={styles.muted}>Subscription invoices and payment status.</Text>
          </View>
          <Text style={styles.historyCount}>{payments.length} {payments.length === 1 ? 'payment' : 'payments'}</Text>
        </View>

        {paymentHistoryError ? (
          <View style={styles.errorCard}>
            <Text style={styles.error}>{paymentHistoryError}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : isHistoryLoading ? (
          <ActivityIndicator size="small" color="#17664f" style={styles.historyLoader} />
        ) : visiblePayments.length > 0 ? (
          <View style={styles.historyList}>
            {visiblePayments.map((payment) => {
              const paymentExpiry = payment.expires_at ? Date.parse(payment.expires_at) : Number.NaN;
              const paymentExpired = Number.isFinite(paymentExpiry) && paymentExpiry <= now;
              return (
                <View key={payment.id} style={styles.paymentRow}>
                  <View style={styles.paymentRowHeading}>
                    <Text style={styles.paymentDate}>{formatDate(payment.occurred_at)}</Text>
                    <Text style={[
                      styles.statusBadge,
                      payment.status === 'Active' && !paymentExpired
                        ? styles.activeBadge
                        : payment.status === 'Past Due'
                          ? styles.expiredBadge
                          : styles.availableBadge,
                    ]}>
                      {payment.status}
                    </Text>
                  </View>
                  <View style={styles.paymentMain}>
                    <View style={styles.paymentDetails}>
                      <Text style={styles.paymentPlan}>{payment.plan_name}</Text>
                      <Text style={styles.paymentMeta}>Invoice {payment.invoice_number}</Text>
                      <Text style={styles.paymentMeta}>{payment.payment_method || '—'}</Text>
                    </View>
                    <View style={styles.paymentAmountGroup}>
                      <Text style={styles.paymentAmount}>{formatAmount(payment.amount)}</Text>
                      <Text style={[styles.paymentMeta, paymentExpired && styles.expiryTextAlert]}>
                        {!payment.expires_at ? '—' : paymentExpired ? 'Expired' : `Expires ${formatDate(payment.expires_at)}`}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyText}>No payment history is available.</Text>
        )}

        <View style={styles.pagination}>
          <Text style={styles.muted}>
            {isHistoryLoading
              ? 'Showing — payment history entries'
              : payments.length === 0
                ? 'Showing 0 payment history entries'
                : `Showing ${(safePage - 1) * PAYMENT_HISTORY_PER_PAGE + 1}-${Math.min(safePage * PAYMENT_HISTORY_PER_PAGE, payments.length)} of ${payments.length} payment history entries`}
          </Text>
          <View style={styles.paginationControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous payment history page"
              disabled={isHistoryLoading || safePage <= 1}
              onPress={() => setPaymentHistoryPage(safePage - 1)}
              style={[styles.pageButton, (isHistoryLoading || safePage <= 1) && styles.disabledButton]}>
              <Text style={styles.pageButtonText}>Previous</Text>
            </Pressable>
            <Text style={styles.pageIndicator}>Page {safePage} of {pageCount}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next payment history page"
              disabled={isHistoryLoading || safePage >= pageCount}
              onPress={() => setPaymentHistoryPage(safePage + 1)}
              style={[styles.pageButton, (isHistoryLoading || safePage >= pageCount) && styles.disabledButton]}>
              <Text style={styles.pageButtonText}>Next</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f8f5',
  },
  pageContent: {
    flex: 1,
    backgroundColor: '#f4f8f5',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    color: '#203128',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 5,
    marginBottom: 16,
    color: '#718078',
    fontSize: 12,
    lineHeight: 18,
  },
  topCards: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e9e3',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  currentPlanCard: {
    borderColor: '#cce9d8',
    backgroundColor: '#f7fcf8',
  },
  nextPaymentCard: {
    minHeight: 125,
    justifyContent: 'center',
    borderColor: '#d5e8dc',
    backgroundColor: '#fbfdfb',
  },
  cardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardLabel: {
    color: '#16845f',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadge: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    fontSize: 10,
    fontWeight: '700',
  },
  activeBadge: {
    backgroundColor: '#e8f6ee',
    color: '#18794e',
  },
  expiredBadge: {
    backgroundColor: '#fff2dd',
    color: '#9b6412',
  },
  availableBadge: {
    backgroundColor: '#f0f3f1',
    color: '#65746b',
  },
  planName: {
    marginTop: 12,
    color: '#203128',
    fontSize: 19,
    fontWeight: '700',
  },
  muted: {
    color: '#718078',
    fontSize: 11,
    lineHeight: 16,
  },
  description: {
    marginTop: 12,
    color: '#687871',
    fontSize: 12,
    lineHeight: 18,
  },
  feeDetails: {
    gap: 5,
    marginTop: 12,
  },
  detailText: {
    color: '#687871',
    fontSize: 11,
  },
  detailStrong: {
    color: '#34453b',
    fontWeight: '700',
  },
  planTotal: {
    color: '#203128',
    fontSize: 16,
    fontWeight: '800',
  },
  period: {
    color: '#718078',
    fontSize: 10,
    fontWeight: '500',
  },
  expiryText: {
    marginTop: 12,
    color: '#526158',
    fontSize: 11,
    fontWeight: '600',
  },
  expiryTextAlert: {
    color: '#ad4b43',
  },
  actionRow: {
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e7f0ea',
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledPlanButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#dce8e0',
    borderRadius: 8,
    backgroundColor: '#f8fbf9',
  },
  disabledPlanButtonText: {
    color: '#819087',
    fontSize: 12,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  nextPaymentAmount: {
    marginTop: 12,
    color: '#203128',
    fontSize: 24,
    fontWeight: '800',
  },
  accountCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  accountCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 145,
    minHeight: 88,
    padding: 13,
    borderWidth: 1,
    borderColor: '#e0e9e3',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  accountCardLabel: {
    color: '#718078',
    fontSize: 10,
  },
  accountCardValue: {
    marginTop: 6,
    marginBottom: 3,
    color: '#34453b',
    fontSize: 12,
    fontWeight: '700',
  },
  historyCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e0e9e3',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ee',
  },
  historyTitle: {
    marginBottom: 4,
    color: '#26352f',
    fontSize: 14,
    fontWeight: '700',
  },
  historyCount: {
    color: '#718078',
    fontSize: 10,
    fontWeight: '600',
  },
  historyLoader: {
    margin: 24,
  },
  historyList: {
    paddingHorizontal: 12,
  },
  paymentRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ee',
  },
  paymentRowHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  paymentDate: {
    color: '#526158',
    fontSize: 10,
  },
  paymentMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentDetails: {
    flex: 1,
    gap: 3,
  },
  paymentPlan: {
    color: '#34453b',
    fontSize: 12,
    fontWeight: '700',
  },
  paymentMeta: {
    color: '#718078',
    fontSize: 10,
  },
  paymentAmountGroup: {
    alignItems: 'flex-end',
    gap: 4,
  },
  paymentAmount: {
    color: '#203128',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    padding: 18,
    color: '#718078',
    fontSize: 12,
    textAlign: 'center',
  },
  pagination: {
    gap: 10,
    padding: 13,
    borderTopWidth: 1,
    borderTopColor: '#edf1ee',
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
    borderColor: '#dce8e0',
    borderRadius: 7,
    backgroundColor: '#f8fbf9',
  },
  pageButtonText: {
    color: '#526158',
    fontSize: 10,
    fontWeight: '600',
  },
  pageIndicator: {
    color: '#718078',
    fontSize: 10,
  },
  errorCard: {
    gap: 8,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0d3cf',
    borderRadius: 8,
    backgroundColor: '#fff8f7',
  },
  error: {
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  retryText: {
    color: '#17664f',
    fontSize: 11,
    fontWeight: '700',
  },
});
