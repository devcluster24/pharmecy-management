"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getApplicableAdvancePaymentDiscount,
  type AdvancePaymentDiscount,
} from "@/lib/advance-payment-discounts";

type BillingPeriod = "minutes" | "days" | "month" | "year" | "one-time";
type PaymentPlan = {
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
type SubscriptionOptions = {
  plan: PaymentPlan | null;
  plans: PaymentPlan[];
  is_assigned: boolean;
  expires_at: string | null;
};
type PaymentMethod = "bKash" | "Nagad";

function isPaymentPlan(value: unknown): value is PaymentPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string"
    && typeof plan.name === "string"
    && typeof plan.setup_fee_label === "string"
    && typeof plan.setup_fee === "number"
    && typeof plan.recurring_fee === "number"
    && ["minutes", "days", "month", "year", "one-time"].includes(String(plan.billing_period))
    && typeof plan.billing_interval === "number"
    && typeof plan.description === "string"
    && Array.isArray(plan.advance_payment_discounts)
    && plan.advance_payment_discounts.every((discount) =>
      Boolean(discount)
      && typeof discount === "object"
      && Number.isInteger((discount as Record<string, unknown>).before_due)
      && typeof (discount as Record<string, unknown>).discount_amount === "number",
    );
}

function isSubscriptionOptions(value: unknown): value is SubscriptionOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Record<string, unknown>;
  return typeof options.is_assigned === "boolean"
    && (options.expires_at === null || typeof options.expires_at === "string")
    && (options.plan === null || isPaymentPlan(options.plan))
    && Array.isArray(options.plans)
    && options.plans.every(isPaymentPlan);
}

function formatAmount(value: number) {
  return `৳ ${Number(value).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function formatPeriod(plan: PaymentPlan) {
  if (plan.billing_period === "one-time") return "one-time";
  const unit = plan.billing_period === "minutes"
    ? "minute"
    : plan.billing_period === "days"
      ? "day"
      : plan.billing_period === "year"
        ? "year"
        : "month";
  return `${plan.billing_interval} ${unit}${plan.billing_interval === 1 ? "" : "s"}`;
}

export default function SubscriptionPaymentPage({
  planId,
  billingCycles,
}: {
  planId: string;
  billingCycles: number;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [standardSubscriptionPlan, setStandardSubscriptionPlan] = useState<PaymentPlan | null>(null);
  const [currentPlanExpiresAt, setCurrentPlanExpiresAt] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bKash");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPaymentPlan() {
      try {
        const { data, error: loadError } = await supabase.rpc("get_my_pharmacy_subscription_plan");
        if (loadError) throw loadError;
        if (!isSubscriptionOptions(data)) throw new Error("Supabase returned invalid subscription data.");
        if (!Number.isInteger(billingCycles) || billingCycles < 1 || billingCycles > 12) {
          throw new Error("Choose a billing period between 1 and 12 plan periods.");
        }
        const selectedPlan = data.plans.find((item) => item.id === planId) ?? null;
        if (!selectedPlan) {
          throw new Error("The selected subscription plan could not be found. Return to plan selection and choose a plan again.");
        }
        const standardPlan = data.plans.find(
          (item) => item.name.trim().toLowerCase() === "standard subscription",
        ) ?? null;
        const selectedPlanName = selectedPlan.name.trim().toLowerCase();
        const regularAmount = selectedPlanName === "one-time setup"
          ? standardPlan
            ? selectedPlan.setup_fee + standardPlan.recurring_fee * billingCycles
            : 0
          : selectedPlanName === "standard subscription"
            ? selectedPlan.recurring_fee * billingCycles
            : selectedPlan.setup_fee + selectedPlan.recurring_fee;
        const advanceDiscount = selectedPlanName === "standard subscription"
          ? getApplicableAdvancePaymentDiscount(
            selectedPlan.advance_payment_discounts,
            data.expires_at,
            selectedPlan.billing_period,
          )
          : null;
        const amount = Math.max(
          0,
          regularAmount - (advanceDiscount?.discount_amount ?? 0) * billingCycles,
        );
        if (selectedPlanName === "one-time setup" && !standardPlan) {
          throw new Error("Standard Subscription plan is required to calculate the One-Time Setup total.");
        }
        if (amount <= 0) {
          router.replace("/subscription-setup");
          return;
        }
        if (active) {
          setPlan(selectedPlan);
          setStandardSubscriptionPlan(standardPlan);
          setCurrentPlanExpiresAt(data.expires_at);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load payment details.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadPaymentPlan();
    return () => {
      active = false;
    };
  }, [billingCycles, planId, router]);

  async function simulateDemoPayment() {
    if (!plan) return;
    setIsSubmitting(true);
    setError("");
    try {
      const { error: paymentError } = await supabase.rpc("complete_my_pharmacy_demo_subscription", {
        target_plan_id: plan.id,
        requested_payment_method: paymentMethod,
        requested_billing_cycles: billingCycles,
      });
      if (paymentError) throw paymentError;
      router.replace("/dashboard");
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Could not complete the demo payment.");
      setIsSubmitting(false);
    }
  }

  const regularAmountDue = plan
    ? plan.name.trim().toLowerCase() === "one-time setup"
      ? plan.setup_fee + (standardSubscriptionPlan?.recurring_fee ?? 0) * billingCycles
      : plan.name.trim().toLowerCase() === "standard subscription"
        ? plan.recurring_fee * billingCycles
        : plan.setup_fee + plan.recurring_fee
    : 0;
  const advanceDiscount = plan?.name.trim().toLowerCase() === "standard subscription"
    ? getApplicableAdvancePaymentDiscount(
      plan.advance_payment_discounts,
      currentPlanExpiresAt,
      plan.billing_period,
    )
    : null;
  const amountDue = Math.max(0, regularAmountDue - (advanceDiscount?.discount_amount ?? 0) * billingCycles);
  const billingBasisPlan = plan?.name.trim().toLowerCase() === "one-time setup"
    ? standardSubscriptionPlan
    : plan;

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px", background: "#f4f8f5", color: "#122b2a", fontFamily: "Inter, Arial, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 1100, overflow: "hidden", border: "1px solid rgba(18,43,42,0.08)", borderRadius: 24, background: "#fff", boxShadow: "0 20px 60px rgba(17, 24, 39, 0.08)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "24px 32px", borderBottom: "1px solid rgba(18,43,42,0.06)", background: "linear-gradient(135deg, #eafaf4 0%, #f3fbf8 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #2ad49a, #1ac490)", color: "#fff", fontSize: 14, fontWeight: 800 }}>⚡</span>
            <div>
              <div style={{ color: "#102d2a", fontSize: 20, fontWeight: 700, letterSpacing: "-0.04em" }}>Pharmecy Cluster</div>
              <div style={{ color: "#5f7a73", fontSize: 12 }}>Subscription payment</div>
            </div>
          </div>
          <span style={{ border: "1px solid rgba(42,212,154,0.25)", borderRadius: 999, padding: "6px 12px", background: "rgba(42,212,154,0.11)", color: "#1d7059", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>DEMO</span>
        </header>

        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 580px", minWidth: 0, padding: "32px clamp(20px, 4vw, 38px)" }}>
            <h1 style={{ margin: 0, color: "#102d2a", fontSize: 24, fontWeight: 800, letterSpacing: "-0.05em" }}>Payment method</h1>
            <p style={{ margin: "10px 0 22px", color: "#59706d", fontSize: 12, lineHeight: 1.6 }}>
              Choose bKash or Nagad for the demo payment flow. No real payment will be processed.
            </p>

            <div role="note" style={{ marginBottom: 20, border: "1px solid #f1dfaa", borderRadius: 10, padding: "12px 14px", background: "#fffaf0", color: "#765b17", fontSize: 11, lineHeight: 1.55 }}>
              Demo only — payment gateway credentials are not configured. Continuing will simulate a successful payment and grant plan access; no money is charged.
            </div>

            {error && (
              <p role="alert" style={{ margin: "0 0 18px", padding: "11px 13px", border: "1px solid #f0d3cf", borderRadius: 8, background: "#fff8f7", color: "#ad4b43", fontSize: 12, lineHeight: 1.55 }}>
                {error}
              </p>
            )}

            {isLoading ? (
              <p role="status" style={{ margin: 0, padding: "25px 0", color: "#718078", fontSize: 13, textAlign: "center" }}>Loading payment details...</p>
            ) : plan ? (
              <fieldset disabled={isSubmitting} style={{ display: "grid", gap: 12, margin: 0, padding: 0, border: 0 }}>
                <legend style={{ marginBottom: 11, color: "#203128", fontSize: 13, fontWeight: 700 }}>Select payment method</legend>
                {(["bKash", "Nagad"] as const).map((method) => {
                  const selected = paymentMethod === method;
                  return (
                    <label key={method} style={{ display: "flex", alignItems: "center", gap: 13, padding: "16px", border: selected ? "2px solid #16845d" : "1px solid #dce8e0", borderRadius: 12, background: selected ? "#f3fbf6" : "#fff", cursor: "pointer" }}>
                      <input type="radio" name="payment-method" value={method} checked={selected} onChange={() => setPaymentMethod(method)} style={{ accentColor: "#16845d" }} />
                      <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 11, background: method === "bKash" ? "#fce9f0" : "#fff2e8", color: method === "bKash" ? "#c2185b" : "#d46a20", fontSize: 12, fontWeight: 800 }}>
                        {method === "bKash" ? "bKash" : "Nagad"}
                      </span>
                      <span>
                        <strong style={{ display: "block", color: "#203128", fontSize: 13 }}>{method}</strong>
                        <span style={{ display: "block", marginTop: 3, color: "#718078", fontSize: 10 }}>Demo checkout</span>
                      </span>
                      <span style={{ marginLeft: "auto", borderRadius: 20, padding: "4px 8px", background: "#fff4d8", color: "#8a6814", fontSize: 9, fontWeight: 750 }}>DEMO</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </div>

          <aside style={{ flex: "1 1 290px", boxSizing: "border-box", background: "linear-gradient(180deg, #0d2f2a 0%, #163d38 100%)", color: "#fff", padding: "32px clamp(22px, 4vw, 30px)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 28 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 20, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: "6px 12px", background: "rgba(255,255,255,0.08)", fontSize: 12, fontWeight: 700 }}>
                <span style={{ color: "#2ad49a" }}>▤</span> Order summary
              </div>
              <h2 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: "-0.05em" }}>{plan?.name ?? "Selected plan"}</h2>
              {plan?.description && <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 1.55 }}>{plan.description}</p>}
              {plan && (
                <div style={{ display: "grid", gap: 12, marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.15)", borderBottom: "1px solid rgba(255,255,255,0.15)", padding: "16px 0", color: "rgba(255,255,255,0.76)", fontSize: 11 }}>
                  {plan.name.trim().toLowerCase() === "one-time setup" && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>{plan.setup_fee_label} (one-time)</span>
                      <strong style={{ color: "#fff" }}>{formatAmount(plan.setup_fee)}</strong>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>Subscription · {billingBasisPlan ? formatPeriod({ ...billingBasisPlan, billing_interval: billingBasisPlan.billing_interval * billingCycles }) : "unavailable"}</span>
                    <strong style={{ color: "#fff" }}>{formatAmount(
                      plan.name.trim().toLowerCase() === "one-time setup"
                        ? (standardSubscriptionPlan?.recurring_fee ?? 0) * billingCycles
                        : plan.name.trim().toLowerCase() === "standard subscription"
                          ? plan.recurring_fee * billingCycles
                          : plan.recurring_fee,
                    )}</strong>
                  </div>
                  {advanceDiscount && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#77e2b8" }}>
                      <span>Advance payment discount · {advanceDiscount.lead_time_remaining} {advanceDiscount.lead_time_unit} before due × {billingCycles}</span>
                      <strong style={{ color: "#77e2b8" }}>−{formatAmount(advanceDiscount.discount_amount * billingCycles)}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 17 }}>
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>Total due now</span>
                <strong style={{ color: "#2ad49a", fontSize: 24 }}>{formatAmount(amountDue)}</strong>
              </div>
              <button
                type="button"
                disabled={!plan || isLoading || isSubmitting}
                onClick={() => void simulateDemoPayment()}
                style={{ width: "100%", border: 0, borderRadius: 12, padding: "12px 14px", background: !plan || isSubmitting ? "#7fb9a0" : "#2ad49a", color: "#072f2a", fontSize: 12, fontWeight: 750, cursor: !plan || isSubmitting ? "wait" : "pointer", opacity: !plan || isLoading || isSubmitting ? 0.7 : 1 }}
              >
                {isSubmitting ? "Simulating payment..." : `Simulate ${paymentMethod} payment`}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => router.replace("/subscription-setup")}
                style={{ width: "100%", marginTop: 10, border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: "10px 14px", background: "transparent", color: "#fff", fontSize: 11, fontWeight: 650, cursor: "pointer" }}
              >
                Back to plans
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
