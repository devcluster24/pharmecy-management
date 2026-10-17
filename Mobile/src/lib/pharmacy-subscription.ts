import { supabase } from '@/lib/supabase';

export type BillingPeriod = 'minutes' | 'days' | 'month' | 'year' | 'one-time';

export type AdvancePaymentDiscount = {
  before_due: number;
  discount_amount: number;
};

export type PharmacySubscriptionPlan = {
  id: string;
  name: string;
  setup_fee_label: string;
  setup_fee: number;
  recurring_fee: number;
  billing_period: BillingPeriod;
  billing_interval: number;
  description: string;
  advance_payment_discounts: AdvancePaymentDiscount[];
};

export type PharmacySubscriptionOptions = {
  plan: PharmacySubscriptionPlan | null;
  plans: PharmacySubscriptionPlan[];
  is_assigned: boolean;
  expires_at: string | null;
};

function isPlan(value: unknown): value is PharmacySubscriptionPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === 'string'
    && typeof plan.name === 'string'
    && typeof plan.setup_fee_label === 'string'
    && typeof plan.setup_fee === 'number'
    && Number.isFinite(plan.setup_fee)
    && typeof plan.recurring_fee === 'number'
    && Number.isFinite(plan.recurring_fee)
    && ['minutes', 'days', 'month', 'year', 'one-time'].includes(String(plan.billing_period))
    && typeof plan.billing_interval === 'number'
    && Number.isInteger(plan.billing_interval)
    && typeof plan.description === 'string'
    && Array.isArray(plan.advance_payment_discounts)
    && plan.advance_payment_discounts.every((discount) =>
      Boolean(discount)
      && typeof discount === 'object'
      && Number.isInteger((discount as Record<string, unknown>).before_due)
      && typeof (discount as Record<string, unknown>).discount_amount === 'number'
      && Number.isFinite((discount as Record<string, unknown>).discount_amount),
    );
}

function isSubscriptionOptions(value: unknown): value is PharmacySubscriptionOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return typeof response.is_assigned === 'boolean'
    && (response.expires_at === null
      || (typeof response.expires_at === 'string' && Number.isFinite(Date.parse(response.expires_at))))
    && (response.plan === null || isPlan(response.plan))
    && Array.isArray(response.plans)
    && response.plans.every(isPlan);
}

export async function loadPharmacySubscriptionOptions(): Promise<PharmacySubscriptionOptions> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_my_pharmacy_subscription_plan');
  if (error) throw error;
  if (!isSubscriptionOptions(data)) {
    throw new Error('Supabase returned invalid subscription plan data.');
  }
  return data;
}

export function getPlanAdvancePaymentDiscount(
  plan: PharmacySubscriptionPlan,
  currentPlanExpiresAt: string | null,
  now = Date.now(),
) {
  if (plan.name.trim().toLowerCase() !== 'standard subscription' || !currentPlanExpiresAt) return null;
  const expiryTimestamp = Date.parse(currentPlanExpiresAt);
  if (!Number.isFinite(expiryTimestamp) || expiryTimestamp <= now) return null;

  const leadTimeUnit = plan.billing_period === 'minutes' ? 60_000 : 86_400_000;
  const leadTimeRemaining = Math.floor((expiryTimestamp - now) / leadTimeUnit);
  return plan.advance_payment_discounts
    .filter((rule) => rule.before_due <= leadTimeRemaining)
    .reduce<AdvancePaymentDiscount | null>(
      (best, rule) => !best || rule.discount_amount > best.discount_amount ? rule : best,
      null,
    );
}

export function getPlanBillingAmount(
  plan: PharmacySubscriptionPlan,
  standardSubscriptionPlan: PharmacySubscriptionPlan | null,
  billingCycles: number,
  currentPlanExpiresAt: string | null,
  now = Date.now(),
) {
  const normalizedName = plan.name.trim().toLowerCase();
  let amount: number;
  if (normalizedName === 'one-time setup') {
    if (!standardSubscriptionPlan) {
      throw new Error('Standard Subscription plan is required to calculate the One-Time Setup total.');
    }
    amount = plan.setup_fee + standardSubscriptionPlan.recurring_fee * billingCycles;
  } else if (normalizedName === 'standard subscription') {
    amount = plan.recurring_fee * billingCycles;
    const discount = getPlanAdvancePaymentDiscount(plan, currentPlanExpiresAt, now);
    if (discount) amount -= discount.discount_amount * billingCycles;
  } else {
    amount = plan.setup_fee + plan.recurring_fee;
  }

  if (!Number.isFinite(amount)) throw new Error('The selected plan amount is invalid.');
  return Math.max(0, amount);
}

export function getAllowedPharmacyPlans(options: PharmacySubscriptionOptions) {
  if (!options.is_assigned) {
    return options.plans.filter((plan) =>
      ['starter access', 'one-time setup'].includes(plan.name.trim().toLowerCase()),
    );
  }

  const currentName = options.plan?.name.trim().toLowerCase() ?? '';
  const nextName = currentName === 'extended access'
    ? 'one-time setup'
    : currentName === 'one-time setup' || currentName === 'standard subscription'
      ? 'standard subscription'
      : null;
  return nextName
    ? options.plans.filter((plan) => plan.name.trim().toLowerCase() === nextName)
    : [];
}

export function formatPharmacyPlanPeriod(
  plan: PharmacySubscriptionPlan,
  billingCycles = 1,
) {
  if (plan.billing_period === 'one-time') return 'one-time';
  const interval = plan.billing_interval * billingCycles;
  const unit = plan.billing_period === 'minutes'
    ? 'minute'
    : plan.billing_period === 'days'
      ? 'day'
      : plan.billing_period === 'year'
        ? 'year'
        : 'month';
  return `${interval} ${unit}${interval === 1 ? '' : 's'}`;
}
