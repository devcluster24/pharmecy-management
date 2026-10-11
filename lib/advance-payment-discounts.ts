export type AdvancePaymentDiscount = {
  before_due: number;
  discount_amount: number;
};

export type ApplicableAdvancePaymentDiscount = AdvancePaymentDiscount & {
  lead_time_remaining: number;
  lead_time_unit: "minutes" | "days";
};

export function getApplicableAdvancePaymentDiscount(
  discounts: AdvancePaymentDiscount[],
  expiresAt: string | null,
  billingPeriod: "minutes" | "days" | "month" | "year" | "one-time",
  now = Date.now(),
): ApplicableAdvancePaymentDiscount | null {
  if (!expiresAt) return null;

  const expiryTimestamp = Date.parse(expiresAt);
  if (!Number.isFinite(expiryTimestamp) || expiryTimestamp <= now) return null;

  const leadTimeUnit = billingPeriod === "minutes" ? "minutes" : "days";
  const leadTimeRemaining = Math.floor(
    (expiryTimestamp - now) / (leadTimeUnit === "minutes" ? 60_000 : 86_400_000),
  );
  const eligibleDiscounts = discounts.filter(
    (discount) => discount.before_due <= leadTimeRemaining,
  );
  const bestDiscount = eligibleDiscounts.reduce<AdvancePaymentDiscount | null>(
    (best, discount) => !best || discount.discount_amount > best.discount_amount
      ? discount
      : best,
    null,
  );

  return bestDiscount
    ? { ...bestDiscount, lead_time_remaining: leadTimeRemaining, lead_time_unit: leadTimeUnit }
    : null;
}
