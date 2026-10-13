"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getApplicableAdvancePaymentDiscount,
  type AdvancePaymentDiscount,
} from "@/lib/advance-payment-discounts";

type StarterPlan = {
  id: string;
  name: string;
  setup_fee_label: string;
  setup_fee: number;
  recurring_fee: number;
  billing_period: "minutes" | "days" | "month" | "year" | "one-time";
  billing_interval: number;
  description: string;
  advance_payment_discounts: AdvancePaymentDiscount[];
};

type StarterPlanResponse = {
  plan: StarterPlan | null;
  plans: StarterPlan[];
  is_assigned: boolean;
  expires_at: string | null;
};

function isStarterPlan(value: unknown): value is StarterPlan {
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

function isStarterPlanResponse(value: unknown): value is StarterPlanResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.is_assigned === "boolean"
    && (response.expires_at === null || typeof response.expires_at === "string")
    && (response.plan === null || isStarterPlan(response.plan))
    && Array.isArray(response.plans)
    && response.plans.every(isStarterPlan);
}

function formatAmount(value: number) {
  return `৳ ${Number(value).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function formatPeriod(plan: StarterPlan) {
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

function formatBillingTerm(plan: StarterPlan, cycleCount: number) {
  const interval = plan.billing_interval * cycleCount;
  if (plan.billing_period === "one-time") return "one-time";
  const unit = plan.billing_period === "minutes"
    ? "minute"
    : plan.billing_period === "days"
      ? "day"
      : plan.billing_period === "year"
        ? "year"
        : "month";
  return `${interval} ${unit}${interval === 1 ? "" : "s"}`;
}

function recurringFeeLabel(plan: StarterPlan) {
  if (plan.billing_period === "minutes") return "Per-minute Fee";
  if (plan.billing_period === "days") return "Daily Fee";
  if (plan.billing_period === "year") return "Yearly Fee";
  return "Monthly Fee";
}

export default function SubscriptionSetupPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<StarterPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [billingCycles, setBillingCycles] = useState(1);
  const [currentPlanName, setCurrentPlanName] = useState<string | null>(null);
  const [currentPlanExpiresAt, setCurrentPlanExpiresAt] = useState<string | null>(null);
  const [hasAssignedPlan, setHasAssignedPlan] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSetup() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("user_profiles")
          .select("role, approval_status")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error("Your account profile could not be found.");
        if (profile.role !== "pharmacy_user") {
          router.replace(profile.role === "admin" || profile.role === "superadmin" ? "/admin-dashboard" : "/dashboard");
          return;
        }
        if (profile.approval_status !== "approved") {
          throw new Error("Your pharmacy account is not approved yet.");
        }

        const { data: pharmacy, error: pharmacyError } = await supabase
          .from("pharmacies")
          .select("id")
          .eq("owner_user_id", user.id)
          .maybeSingle();
        if (pharmacyError) throw pharmacyError;
        if (!pharmacy) {
          router.replace("/shop-setup");
          return;
        }

        const { data, error: planError } = await supabase.rpc("get_my_pharmacy_subscription_plan");
        if (planError) throw planError;
        if (!isStarterPlanResponse(data)) {
          throw new Error("Supabase returned invalid subscription plan data.");
        }
        if (data.plans.length === 0) {
          throw new Error("No subscription plans are available. Ask an administrator to add one on the subscription page.");
        }
        const planName = data.is_assigned ? data.plan?.name.trim().toLowerCase() ?? "" : null;
        const nextPlanName = planName === "extended access"
          ? "one-time setup"
          : planName === "one-time setup" || planName === "standard subscription"
            ? "standard subscription"
            : null;
        const allowedPlans = data.is_assigned
          ? nextPlanName
            ? data.plans.filter((item) => item.name.trim().toLowerCase() === nextPlanName)
            : []
          : data.plans.filter((item) =>
            ["starter access", "one-time setup"].includes(item.name.trim().toLowerCase()));
        const initialPlan = allowedPlans[0] ?? null;
        if (!initialPlan) {
          throw new Error(data.is_assigned
            ? planName === "starter access"
              ? "Claim Extended Access from Settings → Subscription & Billing before choosing a paid plan."
              : `No next plan is available for your current plan${planName ? ` (${data.plan?.name})` : ""}. Contact an administrator.`
            : "No Starter Access or One-Time Setup plan is available. Ask an administrator to add one.");
        }
        if (active) {
          setPlans(data.plans);
          setCurrentPlanName(planName);
          setCurrentPlanExpiresAt(data.expires_at);
          setHasAssignedPlan(data.is_assigned);
          setSelectedPlanId(initialPlan.id);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the Starter Access plan.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadSetup();
    return () => {
      active = false;
    };
  }, [router]);

  const selectedPlan = plans.find((item) => item.id === selectedPlanId) ?? null;
  const standardSubscriptionPlan = plans.find(
    (item) => item.name.trim().toLowerCase() === "standard subscription",
  ) ?? null;
  const selectedPlanName = selectedPlan?.name.trim().toLowerCase() ?? "";
  const regularAmountDue = selectedPlanName === "one-time setup"
    ? selectedPlan?.setup_fee !== undefined && standardSubscriptionPlan
      ? selectedPlan.setup_fee + standardSubscriptionPlan.recurring_fee * billingCycles
      : 0
    : selectedPlanName === "standard subscription"
      ? (selectedPlan?.recurring_fee ?? 0) * billingCycles
      : selectedPlan
        ? selectedPlan.setup_fee + selectedPlan.recurring_fee
        : 0;
  const selectedAdvanceDiscount = selectedPlanName === "standard subscription" && selectedPlan
    ? getApplicableAdvancePaymentDiscount(
      selectedPlan.advance_payment_discounts,
      currentPlanExpiresAt,
      selectedPlan.billing_period,
    )
    : null;
  const amountDue = Math.max(
    0,
    regularAmountDue - (selectedAdvanceDiscount?.discount_amount ?? 0) * billingCycles,
  );
  const canCalculateTotal = selectedPlanName !== "one-time setup" || Boolean(standardSubscriptionPlan);
  const nextPlanName = currentPlanName === "extended access"
    ? "one-time setup"
    : currentPlanName === "one-time setup" || currentPlanName === "standard subscription"
      ? "standard subscription"
      : null;
  const displayedPlans = hasAssignedPlan
    ? nextPlanName
      ? plans.filter((item) => item.name.trim().toLowerCase() === nextPlanName)
      : []
    : plans.filter((item) => ["starter access", "one-time setup"].includes(item.name.trim().toLowerCase()));
  async function continueWithPlan() {
    if (!selectedPlan || !canCalculateTotal) {
      setError("Standard Subscription plan is required to calculate the One-Time Setup total.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      if (amountDue > 0) {
        router.push(`/dashboard/paymnet?planId=${encodeURIComponent(selectedPlan.id)}&billingCycles=${billingCycles}`);
        return;
      }
      const { error: setupError } = await supabase.rpc("complete_my_pharmacy_demo_subscription", {
        target_plan_id: selectedPlan.id,
        requested_payment_method: "",
        requested_billing_cycles: billingCycles,
      });
      if (setupError) throw setupError;
      router.replace("/dashboard");
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Could not continue with the selected plan.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="subscription-setup-page" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px", background: "#f4f8f5", color: "#122b2a", fontFamily: "Inter, Arial, sans-serif" }}>
      <section className="subscription-setup-card" style={{ width: "100%", maxWidth: 1100, overflow: "hidden", border: "1px solid rgba(18,43,42,0.08)", borderRadius: 24, background: "#fff", boxShadow: "0 20px 60px rgba(17, 24, 39, 0.08)" }}>
        <header className="subscription-setup-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "24px 32px", borderBottom: "1px solid rgba(18,43,42,0.06)", background: "linear-gradient(135deg, #eafaf4 0%, #f3fbf8 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #2ad49a, #1ac490)", color: "#fff", fontSize: 14, fontWeight: 800 }}>⚡</span>
            <div>
              <div style={{ color: "#102d2a", fontSize: 20, fontWeight: 700, letterSpacing: "-0.04em" }}>Pharmacy Cluster</div>
              <div style={{ color: "#5f7a73", fontSize: 12 }}>Choose your plan</div>
            </div>
          </div>
          <span style={{ border: "1px solid rgba(42,212,154,0.25)", borderRadius: 999, padding: "6px 12px", background: "rgba(42,212,154,0.11)", color: "#1d7059", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>3 of 3</span>
        </header>

        <div className="subscription-setup-content" style={{ display: "flex", flexWrap: "wrap" }}>
          <div className="subscription-setup-plans" style={{ flex: "1 1 600px", minWidth: 0, padding: "32px clamp(20px, 4vw, 38px)" }}>
            <h1 className="subscription-setup-title" style={{ margin: 0, color: "#102d2a", fontSize: 24, fontWeight: 800, letterSpacing: "-0.05em" }}>Choose a subscription plan</h1>
            <p className="subscription-setup-description" style={{ margin: "10px 0 24px", color: "#59706d", fontSize: 12, lineHeight: 1.6 }}>
              Select a plan to continue. Free plans open the dashboard directly; paid plans continue to the demo payment page.
            </p>

            {error && (
              <p role="alert" style={{ margin: "0 0 18px", padding: "11px 13px", border: "1px solid #f0d3cf", borderRadius: 8, background: "#fff8f7", color: "#ad4b43", fontSize: 12, lineHeight: 1.55 }}>
                {error}
              </p>
            )}

            {isLoading ? (
              <p role="status" style={{ margin: 0, padding: "25px 0", color: "#718078", fontSize: 13, textAlign: "center" }}>Loading subscription plans...</p>
            ) : displayedPlans.length > 0 ? (
              <div className="subscription-setup-plan-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", alignItems: "stretch", gap: 14 }}>
                {displayedPlans.map((item) => {
                  const isSelected = item.id === selectedPlanId;
                  const itemName = item.name.trim().toLowerCase();
                  const usesSubscriptionBillingPeriod = itemName === "standard subscription" || itemName === "one-time setup";
                  const billingPlan = itemName === "one-time setup" ? standardSubscriptionPlan : item;
                  const regularTotalForPlan = itemName === "one-time setup"
                    ? billingPlan
                      ? item.setup_fee + billingPlan.recurring_fee * billingCycles
                      : 0
                    : itemName === "standard subscription"
                      ? item.recurring_fee * billingCycles
                      : item.setup_fee + item.recurring_fee;
                  const advanceDiscount = itemName === "standard subscription"
                    ? getApplicableAdvancePaymentDiscount(
                      item.advance_payment_discounts,
                      currentPlanExpiresAt,
                      item.billing_period,
                    )
                    : null;
                  const totalForPlan = Math.max(
                    0,
                    regularTotalForPlan - (advanceDiscount?.discount_amount ?? 0) * billingCycles,
                  );
                  return (
                    <article
                      key={item.id}
                      className="subscription-setup-plan-card"
                      style={{ position: "relative", display: "flex", width: "100%", minWidth: 0, minHeight: 246, flexDirection: "column", overflow: "hidden", padding: 0, border: isSelected ? "2px solid #16845d" : "1px solid #dce8e0", borderRadius: 16, background: isSelected ? "linear-gradient(145deg, #f1fbf6, #fff 75%)" : "#fff", textAlign: "left", boxShadow: isSelected ? "0 10px 26px rgba(22,132,93,0.12)" : "0 5px 16px rgba(18,43,42,0.04)", transition: "border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease" }}
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedPlanId(item.id)}
                        style={{ display: "flex", flex: 1, width: "100%", flexDirection: "column", padding: 0, border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}
                      >
                      <span aria-hidden="true" style={{ position: "absolute", inset: "0 0 auto", height: 5, background: isSelected ? "linear-gradient(90deg, #16845d, #54c990)" : "#e5eee8" }} />
                      <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, padding: "20px 16px 10px" }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "4px 8px", background: isSelected ? "#dff5e9" : "#eef5f0", color: "#16845d", fontSize: 9, fontWeight: 800, letterSpacing: 0.5 }}>PHARMACY PLAN</span>
                          <strong style={{ display: "block", marginTop: 9, color: "#18362f", fontSize: 19, lineHeight: 1.2 }}>{item.name}</strong>
                        </span>
                        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", flex: "0 0 22px", width: 22, height: 22, marginTop: 2, border: isSelected ? "6px solid #16845d" : "2px solid #bac8bf", borderRadius: "50%", background: "#fff" }} />
                      </span>
                      <span style={{ display: "block", minHeight: 34, padding: "0 16px 12px", color: "#718078", fontSize: 11, lineHeight: 1.5 }}>
                        {item.description || (item.name.toLowerCase() === "starter access" ? "Get started with the essentials for your pharmacy." : "A one-time setup option for your pharmacy account.")}
                      </span>
                      </button>
                      {usesSubscriptionBillingPeriod && (
                        <label style={{ display: "grid", gap: 6, margin: "0 16px 12px", color: "#526158", fontSize: 10, fontWeight: 650 }}>
                          Billing Period
                          <select
                            value={billingCycles}
                            disabled={!billingPlan}
                            onChange={(event) => setBillingCycles(Number(event.currentTarget.value))}
                            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce8e0", borderRadius: 7, background: "#fff", color: "#203128", padding: "8px 9px", fontSize: 11 }}
                          >
                            {Array.from({ length: 12 }, (_, index) => index + 1).map((cycleCount) => (
                              <option key={cycleCount} value={cycleCount}>
                                {cycleCount} × {billingPlan ? formatPeriod(billingPlan) : "billing period"}
                                {billingPlan ? ` (${formatBillingTerm(billingPlan, cycleCount)})` : ""}
                              </option>
                            ))}
                          </select>
                          {itemName === "one-time setup" && billingPlan && (
                            <span style={{ fontWeight: 400 }}>
                              Setup fee is charged once; subscription charges use the Standard Subscription rate.
                            </span>
                          )}
                        </label>
                      )}
                      <span style={{ display: "grid", gap: 9, margin: "0 16px 14px", padding: "12px 11px", border: "1px solid #e4efe8", borderRadius: 11, background: "rgba(255,255,255,0.82)" }}>
                        {itemName === "one-time setup" ? (
                          <>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#65766b", fontSize: 10 }}>{item.setup_fee_label} · one-time</span>
                              <strong style={{ color: "#203128", fontSize: 13, whiteSpace: "nowrap" }}>{formatAmount(item.setup_fee)}</strong>
                            </span>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#65766b", fontSize: 10 }}>{billingPlan ? `${recurringFeeLabel(billingPlan)} · ${formatBillingTerm(billingPlan, billingCycles)}` : "Standard Subscription unavailable"}</span>
                              <strong style={{ color: "#203128", fontSize: 13, whiteSpace: "nowrap" }}>{formatAmount((billingPlan?.recurring_fee ?? 0) * billingCycles)}</strong>
                            </span>
                          </>
                        ) : itemName === "standard subscription" ? (
                          <>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#65766b", fontSize: 10 }}>{recurringFeeLabel(item)} · {formatBillingTerm(item, billingCycles)}</span>
                              <strong style={{ color: "#203128", fontSize: 13, whiteSpace: "nowrap" }}>{formatAmount(item.recurring_fee * billingCycles)}</strong>
                            </span>
                            {advanceDiscount && (
                              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#16845d" }}>
                                <span style={{ fontSize: 10 }}>Advance payment discount · {advanceDiscount.lead_time_remaining} {advanceDiscount.lead_time_unit} before due × {billingCycles}</span>
                                <strong style={{ fontSize: 13, whiteSpace: "nowrap" }}>−{formatAmount(advanceDiscount.discount_amount * billingCycles)}</strong>
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#65766b", fontSize: 10, lineHeight: 1.3 }}>{recurringFeeLabel(item)} · {formatPeriod(item)}</span>
                              <strong style={{ color: "#203128", fontSize: 13, whiteSpace: "nowrap" }}>{formatAmount(item.recurring_fee)}</strong>
                            </span>
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#65766b", fontSize: 10, lineHeight: 1.3 }}>{item.setup_fee_label} · one-time</span>
                              <strong style={{ color: "#203128", fontSize: 13, whiteSpace: "nowrap" }}>{formatAmount(item.setup_fee)}</strong>
                            </span>
                          </>
                        )}
                      </span>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: "auto", borderTop: "1px solid #e4efe8", padding: "12px 16px", background: isSelected ? "rgba(232,245,237,0.65)" : "#fbfdfb" }}>
                        <span style={{ color: "#526158", fontSize: 10, fontWeight: 650 }}>Total due now</span>
                        <strong style={{ color: "#16845d", fontSize: 17, whiteSpace: "nowrap" }}>{formatAmount(totalForPlan)}</strong>
                      </span>
                    </article>
                  );
                })}
              </div>
            ) : (
              !error && <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>No subscription plans are available. Ask an administrator to add one.</p>
            )}
          </div>

          <aside className="subscription-setup-summary" style={{ flex: "1 1 270px", boxSizing: "border-box", background: "linear-gradient(180deg, #0d2f2a 0%, #163d38 100%)", color: "#fff", padding: "32px clamp(22px, 4vw, 30px)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 28 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 20, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: "6px 12px", background: "rgba(255,255,255,0.08)", fontSize: 12, fontWeight: 700 }}>
                <span style={{ color: "#2ad49a" }}>✓</span> Ready to launch
              </div>
              <h2 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: "-0.05em" }}>Your growth starts here</h2>
              <div style={{ display: "grid", gap: 15, marginTop: 24 }}>
                {["Choose a subscription plan", "Review setup and recurring prices", "Dashboard access starts after payment or free-plan confirmation"].map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: 11, color: "rgba(255,255,255,0.86)", fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ display: "inline-flex", flex: "0 0 21px", alignItems: "center", justifyContent: "center", width: 21, height: 21, borderRadius: "50%", background: "#2ad49a", color: "#072f2a", fontSize: 11, fontWeight: 900 }}>✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              {selectedPlan && (
                <div style={{ marginBottom: 17, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 15 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "rgba(255,255,255,0.72)", fontSize: 11 }}>
                    <span>{selectedPlan.name} · first payment</span>
                    <strong style={{ color: "#fff", fontSize: 15 }}>{formatAmount(amountDue)}</strong>
                  </div>
                  <p style={{ margin: "9px 0 0", color: "rgba(255,255,255,0.62)", fontSize: 10, lineHeight: 1.5 }}>
                    {amountDue === 0 ? "No payment is due. Confirm to activate your plan." : "Demo only: choose bKash or Nagad on the next page. No real payment is collected."}
                  </p>
                </div>
              )}
              <button
                type="button"
                disabled={!selectedPlan || !canCalculateTotal || isLoading || isSubmitting}
                onClick={() => void continueWithPlan()}
                className="subscription-setup-continue"
                style={{ width: "100%", border: 0, borderRadius: 12, padding: "12px 14px", background: !selectedPlan || !canCalculateTotal || isSubmitting ? "#7fb9a0" : "#2ad49a", color: "#072f2a", fontSize: 12, fontWeight: 750, cursor: !selectedPlan || !canCalculateTotal || isSubmitting ? "wait" : "pointer", opacity: !selectedPlan || !canCalculateTotal || isLoading || isSubmitting ? 0.7 : 1 }}
              >
                {isSubmitting ? "Continuing..." : amountDue === 0 ? "Confirm free plan and continue" : "Continue to payment"}
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
