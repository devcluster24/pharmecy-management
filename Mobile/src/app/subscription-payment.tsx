import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatPharmacyPlanPeriod,
  getAllowedPharmacyPlans,
  getPlanAdvancePaymentDiscount,
  getPlanBillingAmount,
  loadPharmacySubscriptionOptions,
  type PharmacySubscriptionOptions,
  type PharmacySubscriptionPlan,
} from '@/lib/pharmacy-subscription';
import { getCurrencySymbol } from '@/lib/currency';
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type PaymentMethod = 'bKash' | 'Nagad';

function formatAmount(value: number) {
  return `${getCurrencySymbol()} ${value.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

function formatFeeLabel(plan: PharmacySubscriptionPlan) {
  if (plan.billing_period === 'minutes') return 'Per-minute Fee';
  if (plan.billing_period === 'days') return 'Daily Fee';
  if (plan.billing_period === 'year') return 'Yearly Fee';
  return 'Monthly Fee';
}

export default function SubscriptionPaymentScreen() {
  const { alert } = useLocalizedAlert();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, storeName } = useAuth();
  const { planId: planIdParam, billingCycles: billingCyclesParam } = useLocalSearchParams<{
    planId?: string | string[];
    billingCycles?: string | string[];
  }>();
  const planId = Array.isArray(planIdParam) ? planIdParam[0] : planIdParam;
  const billingCycles = Number(Array.isArray(billingCyclesParam)
    ? billingCyclesParam[0]
    : billingCyclesParam);
  const [options, setOptions] = useState<PharmacySubscriptionOptions | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bKash');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;
    if (dashboardRole !== 'owner') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    void loadPharmacySubscriptionOptions()
      .then((loadedOptions) => {
        if (!Number.isInteger(billingCycles) || billingCycles < 1 || billingCycles > 12) {
          throw new Error('Choose a billing period between 1 and 12 plan periods.');
        }
        const selectedPlan = getAllowedPharmacyPlans(loadedOptions)
          .find((plan) => plan.id === planId);
        if (!selectedPlan) {
          throw new Error('The selected subscription plan could not be found. Return to plans and choose again.');
        }
        const paymentAmount = getPlanBillingAmount(
          selectedPlan,
          loadedOptions.plans.find((plan) => plan.name.trim().toLowerCase() === 'standard subscription') ?? null,
          billingCycles,
          loadedOptions.expires_at,
        );
        if (paymentAmount <= 0) {
          throw new Error('This plan does not require payment. Return to plan selection to confirm it.');
        }
        if (active) setOptions(loadedOptions);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load payment details.');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [billingCycles, dashboardRole, isAuthLoading, planId, profileLoading]);

  const selectedPlan = useMemo(
    () => options
      ? getAllowedPharmacyPlans(options).find((plan) => plan.id === planId) ?? null
      : null,
    [options, planId],
  );
  const standardPlan = options?.plans.find(
    (plan) => plan.name.trim().toLowerCase() === 'standard subscription',
  ) ?? null;
  const amountDue = selectedPlan && options
    ? getPlanBillingAmount(selectedPlan, standardPlan, billingCycles, options.expires_at)
    : 0;
  const advanceDiscount = selectedPlan && options
    ? getPlanAdvancePaymentDiscount(selectedPlan, options.expires_at)
    : null;
  const billingBasisPlan = selectedPlan?.name.trim().toLowerCase() === 'one-time setup'
    ? standardPlan
    : selectedPlan;

  async function completePayment() {
    if (!selectedPlan || !supabase) {
      const message = 'The selected plan or subscription service is unavailable.';
      setError(message);
      alert('Error', message);
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const { error: paymentError } = await supabase.rpc('complete_my_pharmacy_demo_subscription', {
        target_plan_id: selectedPlan.id,
        requested_payment_method: paymentMethod,
        requested_billing_cycles: billingCycles,
      });
      if (paymentError) throw paymentError;
      alert(
        'Payment successful',
        'Your subscription plan has been updated.',
        [{
          text: 'Continue',
          onPress: () => router.replace({ pathname: '/dashboard/menu/[slug]', params: { slug: 'subscription' } }),
        }],
      );
    } catch (paymentError) {
      const message = paymentError instanceof Error ? paymentError.message : 'Could not complete subscription payment.';
      setError(message);
      alert('Payment failed', message);
      setIsSubmitting(false);
    }
  }

  if (isAuthLoading || profileLoading || dashboardRole !== 'owner') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#16845d" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.brand}>{getPharmacyDisplayName(storeName)}</Text>
          <Text style={styles.headerSubtitle}>Subscription payment</Text>
        </View>
        <Text style={styles.demoBadge}>DEMO</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Payment method</Text>
        <Text style={styles.subtitle}>
          Choose bKash or Nagad to continue with the subscription.
        </Text>

        <View style={styles.demoNotice}>
          <Text style={styles.demoNoticeTitle}>Demo payment only</Text>
          <Text style={styles.demoNoticeText}>
            Payment gateway credentials are not configured. Continuing simulates a successful payment
            and activates the selected plan; no money is charged.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {isLoading ? (
          <ActivityIndicator size="large" color="#16845d" style={styles.loader} />
        ) : selectedPlan ? (
          <>
            <Text style={styles.sectionLabel}>Select payment method</Text>
            {(['bKash', 'Nagad'] as const).map((method) => {
              const selected = paymentMethod === method;
              return (
                <Pressable
                  key={method}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  disabled={isSubmitting}
                  onPress={() => setPaymentMethod(method)}
                  style={[styles.paymentMethod, selected && styles.paymentMethodSelected]}>
                  <View style={[
                    styles.methodMark,
                    method === 'bKash' ? styles.bkashMark : styles.nagadMark,
                  ]}>
                    <Text style={[
                      styles.methodMarkText,
                      method === 'bKash' ? styles.bkashText : styles.nagadText,
                    ]}>
                      {method}
                    </Text>
                  </View>
                  <View style={styles.methodDetails}>
                    <Text style={styles.methodName}>{method}</Text>
                    <Text style={styles.methodDescription}>Demo checkout</Text>
                  </View>
                  <Text style={styles.methodDemo}>DEMO</Text>
                </Pressable>
              );
            })}

            <View style={styles.orderSummary}>
              <View style={styles.summaryPill}>
                <Text style={styles.summaryPillText}>Order summary</Text>
              </View>
              <Text style={styles.planName}>{selectedPlan.name}</Text>
              {selectedPlan.description ? (
                <Text style={styles.planDescription}>{selectedPlan.description}</Text>
              ) : null}
              <View style={styles.summaryLines}>
                {selectedPlan.name.trim().toLowerCase() === 'one-time setup' ? (
                  <View style={styles.summaryLine}>
                    <Text style={styles.summaryLabel}>{selectedPlan.setup_fee_label} · one-time</Text>
                    <Text style={styles.summaryValue}>{formatAmount(selectedPlan.setup_fee)}</Text>
                  </View>
                ) : null}
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>
                    Subscription · {billingBasisPlan
                      ? `${formatFeeLabel(billingBasisPlan)} · ${formatPharmacyPlanPeriod(billingBasisPlan, billingCycles)}`
                      : 'unavailable'}
                  </Text>
                  <Text style={styles.summaryValue}>
                    {formatAmount(
                      selectedPlan.name.trim().toLowerCase() === 'one-time setup'
                        ? (standardPlan?.recurring_fee ?? 0) * billingCycles
                        : selectedPlan.name.trim().toLowerCase() === 'standard subscription'
                          ? selectedPlan.recurring_fee * billingCycles
                          : selectedPlan.recurring_fee,
                    )}
                  </Text>
                </View>
                {advanceDiscount ? (
                  <View style={styles.discountLine}>
                    <Text style={styles.discountLabel}>Advance payment discount · {billingCycles} period(s)</Text>
                    <Text style={styles.discountAmount}>
                      −{formatAmount(advanceDiscount.discount_amount * billingCycles)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Total due now</Text>
                <Text style={styles.totalAmount}>{formatAmount(amountDue)}</Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void completePayment()}
              style={[styles.payButton, isSubmitting && styles.payButtonDisabled]}>
              <Text style={styles.payButtonText}>
                {isSubmitting ? 'Activating plan…' : `Simulate ${paymentMethod} payment`}
              </Text>
            </Pressable>
          </>
        ) : !error ? (
          <Text style={styles.error}>Payment details could not be loaded.</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => router.replace('/subscription-setup')}
          style={styles.backToPlansButton}>
          <Text style={styles.backToPlansText}>Back to plans</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
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
    borderBottomColor: '#e2ece6',
    backgroundColor: '#eff9f4',
  },
  backButton: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#17664f',
    fontSize: 32,
    lineHeight: 36,
  },
  headerText: {
    flex: 1,
  },
  brand: {
    color: '#102d2a',
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#5f7a73',
    fontSize: 10,
  },
  demoBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#f1dfaa',
    borderRadius: 20,
    backgroundColor: '#fffaf0',
    color: '#8a6814',
    fontSize: 9,
    fontWeight: '800',
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
  demoNotice: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1dfaa',
    borderRadius: 10,
    backgroundColor: '#fffaf0',
  },
  demoNoticeTitle: {
    color: '#765b17',
    fontSize: 11,
    fontWeight: '800',
  },
  demoNoticeText: {
    marginTop: 5,
    color: '#765b17',
    fontSize: 10,
    lineHeight: 15,
  },
  error: {
    marginBottom: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: '#f0d3cf',
    borderRadius: 8,
    backgroundColor: '#fff8f7',
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  loader: {
    marginTop: 30,
    marginBottom: 25,
  },
  sectionLabel: {
    marginBottom: 10,
    color: '#203128',
    fontSize: 13,
    fontWeight: '700',
  },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: '#dce8e0',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  paymentMethodSelected: {
    borderWidth: 2,
    borderColor: '#16845d',
    backgroundColor: '#f3fbf6',
  },
  methodMark: {
    minWidth: 48,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  bkashMark: {
    backgroundColor: '#fce9f0',
  },
  nagadMark: {
    backgroundColor: '#fff2e8',
  },
  methodMarkText: {
    fontSize: 10,
    fontWeight: '800',
  },
  bkashText: {
    color: '#c2185b',
  },
  nagadText: {
    color: '#d46a20',
  },
  methodDetails: {
    flex: 1,
  },
  methodName: {
    color: '#203128',
    fontSize: 12,
    fontWeight: '700',
  },
  methodDescription: {
    marginTop: 3,
    color: '#718078',
    fontSize: 9,
  },
  methodDemo: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#fff4d8',
    color: '#8a6814',
    fontSize: 8,
    fontWeight: '800',
  },
  orderSummary: {
    marginTop: 10,
    padding: 15,
    borderRadius: 15,
    backgroundColor: '#12352f',
  },
  summaryPill: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  summaryPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  planName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  planDescription: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    lineHeight: 15,
  },
  summaryLines: {
    gap: 10,
    marginTop: 15,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.76)',
    fontSize: 10,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  discountLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  discountLabel: {
    flex: 1,
    color: '#77e2b8',
    fontSize: 10,
  },
  discountAmount: {
    color: '#77e2b8',
    fontSize: 10,
    fontWeight: '700',
  },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
  },
  totalAmount: {
    color: '#2ad49a',
    fontSize: 22,
    fontWeight: '800',
  },
  payButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#2ad49a',
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: '#072f2a',
    fontSize: 12,
    fontWeight: '800',
  },
  backToPlansButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#dce8e0',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  backToPlansText: {
    color: '#526158',
    fontSize: 11,
    fontWeight: '600',
  },
});
