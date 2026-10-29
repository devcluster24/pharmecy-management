import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
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

function formatAmount(value: number) {
  return `${getCurrencySymbol()} ${value.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

function formatFeeLabel(plan: PharmacySubscriptionPlan) {
  if (plan.billing_period === 'minutes') return 'Per-minute Fee';
  if (plan.billing_period === 'days') return 'Daily Fee';
  if (plan.billing_period === 'year') return 'Yearly Fee';
  return 'Monthly Fee';
}

export default function SubscriptionSetupScreen() {
  const { alert } = useLocalizedAlert();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, storeName } = useAuth();
  const [options, setOptions] = useState<PharmacySubscriptionOptions | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycles, setBillingCycles] = useState(1);
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
        if (!active) return;
        const availablePlans = getAllowedPharmacyPlans(loadedOptions);
        if (availablePlans.length === 0) {
          const currentPlanName = loadedOptions.plan?.name ?? '';
          throw new Error(
            currentPlanName.trim().toLowerCase() === 'starter access'
              ? 'Claim Extended Access from Settings → Subscription & Billing before choosing a paid plan.'
              : 'No next subscription plan is available for this account.',
          );
        }
        setOptions(loadedOptions);
        setSelectedPlanId(availablePlans[0].id);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load subscription plans.');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading]);

  const availablePlans = useMemo(
    () => options ? getAllowedPharmacyPlans(options) : [],
    [options],
  );
  const selectedPlan = availablePlans.find((plan) => plan.id === selectedPlanId) ?? null;
  const standardPlan = options?.plans.find(
    (plan) => plan.name.trim().toLowerCase() === 'standard subscription',
  ) ?? null;
  const selectedPlanName = selectedPlan?.name.trim().toLowerCase() ?? '';
  const canChangeCycles = selectedPlanName === 'one-time setup'
    || selectedPlanName === 'standard subscription';
  let amountDue = 0;
  let amountError = '';
  if (selectedPlan && options) {
    try {
      amountDue = getPlanBillingAmount(
        selectedPlan,
        standardPlan,
        billingCycles,
        options.expires_at,
      );
    } catch (amountCalculationError) {
      amountError = amountCalculationError instanceof Error
        ? amountCalculationError.message
        : 'Could not calculate the selected plan amount.';
    }
  }

  async function continueWithPlan() {
    if (!selectedPlan || amountError || !options || !supabase) {
      const message = amountError || 'Could not connect to the subscription service.';
      setError(message);
      alert('Error', message);
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      if (amountDue > 0) {
        setIsSubmitting(false);
        router.push(
          `/subscription-payment?planId=${encodeURIComponent(selectedPlan.id)}&billingCycles=${billingCycles}`,
        );
        return;
      }
      const { error: activationError } = await supabase.rpc('complete_my_pharmacy_demo_subscription', {
        target_plan_id: selectedPlan.id,
        requested_payment_method: '',
        requested_billing_cycles: billingCycles,
      });
      if (activationError) throw activationError;
      alert(
        'Subscription activated',
        'Your subscription plan has been updated.',
        [{
          text: 'Continue',
          onPress: () => router.replace({ pathname: '/dashboard/menu/[slug]', params: { slug: 'subscription' } }),
        }],
      );
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Could not continue with the selected plan.';
      setError(message);
      alert('Error', message);
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
          <Text style={styles.headerSubtitle}>Choose your plan</Text>
        </View>
        <Text style={styles.stepBadge}>3 of 3</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Choose a subscription plan</Text>
        <Text style={styles.subtitle}>
          Select a plan to continue. You can review payment details on the next screen.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {isLoading ? (
          <ActivityIndicator size="large" color="#16845d" style={styles.loader} />
        ) : availablePlans.length > 0 ? (
          <View style={styles.planList}>
            {availablePlans.map((plan) => {
              const selected = plan.id === selectedPlanId;
              const planName = plan.name.trim().toLowerCase();
              const usesStandardRate = planName === 'one-time setup';
              const recurringPlan = usesStandardRate ? standardPlan : plan;
              const canCalculatePlanAmount = planName !== 'one-time setup' || Boolean(standardPlan);
              const planAmount = options && canCalculatePlanAmount
                ? getPlanBillingAmount(plan, standardPlan, billingCycles, options.expires_at)
                : null;
              const advanceDiscount = options
                ? getPlanAdvancePaymentDiscount(plan, options.expires_at)
                : null;
              return (
                <Pressable
                  key={plan.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setSelectedPlanId(plan.id)}
                  style={[styles.planCard, selected && styles.planCardSelected]}>
                  <View style={styles.planCardHeader}>
                    <View style={styles.planText}>
                      <Text style={styles.planName}>{plan.name}</Text>
                      <Text style={styles.planDescription}>
                        {plan.description || 'Subscription plan for your pharmacy account.'}
                      </Text>
                    </View>
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                  </View>

                  {selected && canChangeCycles && planName === selectedPlanName ? (
                    <View style={styles.cyclePicker}>
                      <Text style={styles.cycleLabel}>
                        Billing period · {formatPharmacyPlanPeriod(recurringPlan ?? plan, billingCycles)}
                      </Text>
                      <View style={styles.cycleControls}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Reduce billing periods"
                          disabled={billingCycles <= 1}
                          onPress={() => setBillingCycles((value) => Math.max(1, value - 1))}
                          style={[styles.cycleButton, billingCycles <= 1 && styles.cycleButtonDisabled]}>
                          <Text style={styles.cycleButtonText}>−</Text>
                        </Pressable>
                        <Text style={styles.cycleValue}>{billingCycles}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Add billing period"
                          disabled={billingCycles >= 12}
                          onPress={() => setBillingCycles((value) => Math.min(12, value + 1))}
                          style={[styles.cycleButton, billingCycles >= 12 && styles.cycleButtonDisabled]}>
                          <Text style={styles.cycleButtonText}>+</Text>
                        </Pressable>
                      </View>
                      {usesStandardRate ? (
                        <Text style={styles.cycleNote}>
                          Setup fee is charged once; subscription charges use the Standard Subscription rate.
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.feeList}>
                    {planName === 'one-time setup' ? (
                      <>
                        <Text style={styles.feeText}>
                          {plan.setup_fee_label} · one-time: {formatAmount(plan.setup_fee)}
                        </Text>
                        <Text style={styles.feeText}>
                          {recurringPlan ? formatFeeLabel(recurringPlan) : 'Standard Subscription unavailable'}
                          {' · '}{recurringPlan ? formatPharmacyPlanPeriod(recurringPlan, billingCycles) : ''}
                          {': '}{formatAmount((recurringPlan?.recurring_fee ?? 0) * billingCycles)}
                        </Text>
                      </>
                    ) : planName === 'standard subscription' ? (
                      <>
                        <Text style={styles.feeText}>
                          {formatFeeLabel(plan)} · {formatPharmacyPlanPeriod(plan, billingCycles)}
                          {': '}{formatAmount(plan.recurring_fee * billingCycles)}
                        </Text>
                        {advanceDiscount ? (
                          <Text style={styles.discountText}>
                            Advance payment discount: −{formatAmount(advanceDiscount.discount_amount * billingCycles)}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Text style={styles.feeText}>
                          {formatFeeLabel(plan)} · {formatPharmacyPlanPeriod(plan)}: {formatAmount(plan.recurring_fee)}
                        </Text>
                        <Text style={styles.feeText}>
                          {plan.setup_fee_label} · one-time: {formatAmount(plan.setup_fee)}
                        </Text>
                      </>
                    )}
                  </View>
                  <View style={styles.planTotal}>
                    <Text style={styles.totalLabel}>Total due now</Text>
                    <Text style={styles.totalAmount}>
                      {planAmount === null ? 'Unavailable' : formatAmount(planAmount)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyText}>No subscription plans are available.</Text>
        )}

        {!isLoading && availablePlans.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={!selectedPlan || Boolean(amountError) || isSubmitting}
            onPress={() => void continueWithPlan()}
            style={[
              styles.continueButton,
              (!selectedPlan || Boolean(amountError) || isSubmitting) && styles.buttonDisabled,
            ]}>
            <Text style={styles.continueButtonText}>
              {isSubmitting
                ? 'Continuing…'
                : amountDue > 0 ? 'Continue to payment' : 'Confirm free plan and continue'}
            </Text>
          </Pressable>
        ) : null}
        {amountError ? <Text style={styles.error}>{amountError}</Text> : null}
        <Text style={styles.footerNote}>
          Your dashboard plan changes only after a successful confirmation.
        </Text>
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
  stepBadge: {
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#dff5e9',
    color: '#1d7059',
    fontSize: 10,
    fontWeight: '700',
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
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 16,
    color: '#59706d',
    fontSize: 12,
    lineHeight: 18,
  },
  loader: {
    marginTop: 44,
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
  planList: {
    gap: 12,
  },
  planCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dce8e0',
    borderRadius: 15,
    backgroundColor: '#fff',
  },
  planCardSelected: {
    borderWidth: 2,
    borderColor: '#16845d',
    backgroundColor: '#f5fbf7',
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  planText: {
    flex: 1,
  },
  planName: {
    color: '#18362f',
    fontSize: 16,
    fontWeight: '800',
  },
  planDescription: {
    marginTop: 5,
    color: '#718078',
    fontSize: 11,
    lineHeight: 16,
  },
  radio: {
    width: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#bac8bf',
    borderRadius: 11,
  },
  radioSelected: {
    borderColor: '#16845d',
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#16845d',
  },
  cyclePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginHorizontal: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e4efe8',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  cycleLabel: {
    flex: 1,
    minWidth: 125,
    color: '#526158',
    fontSize: 10,
    fontWeight: '600',
  },
  cycleControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cycleButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#e8f5ed',
  },
  cycleButtonDisabled: {
    opacity: 0.45,
  },
  cycleButtonText: {
    color: '#17664f',
    fontSize: 19,
    fontWeight: '700',
  },
  cycleValue: {
    minWidth: 18,
    color: '#203128',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  cycleNote: {
    width: '100%',
    color: '#718078',
    fontSize: 10,
    lineHeight: 15,
  },
  feeList: {
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  feeText: {
    color: '#65766b',
    fontSize: 10,
    lineHeight: 15,
  },
  discountText: {
    color: '#16845d',
    fontSize: 10,
    lineHeight: 15,
  },
  planTotal: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e4efe8',
    backgroundColor: '#fbfdfb',
  },
  totalLabel: {
    color: '#526158',
    fontSize: 11,
    fontWeight: '600',
  },
  totalAmount: {
    color: '#16845d',
    fontSize: 17,
    fontWeight: '800',
  },
  emptyText: {
    paddingVertical: 20,
    color: '#718078',
    fontSize: 12,
    textAlign: 'center',
  },
  continueButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    borderRadius: 12,
    backgroundColor: '#16845d',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  footerNote: {
    marginTop: 14,
    color: '#718078',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
});
