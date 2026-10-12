"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";
import { downloadSubscriptionInvoicePdf } from "@/lib/subscriptionInvoicePdf";

type SubscriptionStatus = "Active" | "Inactive" | "Past Due";
type BillingPeriod = "minutes" | "days" | "month" | "year" | "one-time";
type AdvancePaymentDiscount = {
  before_due: number;
  discount_amount: number;
};
type Plan = {
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
type PharmacySubscription = {
  owner_user_id: string;
  pharmacy_name: string;
  full_name: string;
  email: string;
  created_at: string;
  plan_id: string | null;
  plan_name: string | null;
  payment_method: string;
  pay_amount: number;
  status: SubscriptionStatus;
  is_suspended: boolean;
};
type SubscriptionPayment = {
  id: string;
  invoice_number: string;
  owner_user_id: string;
  pharmacy_name: string;
  full_name: string;
  email: string;
  plan_name: string;
  amount: number;
  payment_method: string;
  status: SubscriptionStatus;
  occurred_at: string;
  expires_at: string | null;
  billing_period: BillingPeriod;
  billing_interval: number;
};
type SubscriptionData = {
  plans: Plan[];
  owners: PharmacySubscription[];
  payments: SubscriptionPayment[];
};
type SubscriptionPaymentAccounts = {
  bkash: string;
  nagad: string;
};
type PlanDraft = {
  id: string | null;
  name: string;
  setupFeeLabel: string;
  setupFee: string;
  recurringFee: string;
  billingPeriod: BillingPeriod;
  billingInterval: string;
  description: string;
  advancePaymentDiscounts: { beforeDue: string; discountAmount: string }[];
};
type OwnerDraft = {
  ownerUserId: string;
  planId: string;
  paymentMethod: string;
  payAmount: string;
  status: SubscriptionStatus;
};

const SUBSCRIPTION_PAYMENTS_PER_PAGE = 10;
const PHARMACY_OWNERS_PER_PAGE = 10;

const blankPlan: PlanDraft = {
  id: null,
  name: "",
  setupFeeLabel: "Setup Fee",
  setupFee: "0",
  recurringFee: "0",
  billingPeriod: "month",
  billingInterval: "1",
  description: "",
  advancePaymentDiscounts: [],
};
const cardStyle = {
  border: "1px solid #e3e9e4",
  borderRadius: 9,
  background: "#fff",
  boxShadow: "0 3px 12px rgba(26, 54, 39, 0.035)",
} as const;
const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 10px",
  border: "1px solid #dce4de",
  borderRadius: 6,
  background: "#fff",
  color: "#34453b",
  fontSize: 12,
} as const;
const buttonStyle = {
  padding: "7px 10px",
  border: "1px solid #dce4de",
  borderRadius: 6,
  background: "#fff",
  color: "#267451",
  fontSize: 11,
  fontWeight: 650,
  cursor: "pointer",
} as const;

function formatAmount(value: number) {
  return `৳ ${Number(value).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function periodDescription(period: BillingPeriod, interval: number) {
  if (period === "one-time") return "one-time";
  const unit = period === "minutes" ? "minute" : period === "days" ? "day" : period === "year" ? "year" : "month";
  return `${interval} ${unit}${interval === 1 ? "" : "s"}`;
}

function recurringFeeLabel(period: BillingPeriod) {
  if (period === "minutes") return "Per-minute Fee";
  if (period === "days") return "Daily Fee";
  if (period === "year") return "Yearly Fee";
  if (period === "one-time") return "Recurring Fee";
  return "Monthly Fee";
}

function periodIntervalOptions(period: BillingPeriod) {
  const max = period === "year" ? 3 : 12;
  return Array.from({ length: max }, (_, index) => index + 1);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function isSubscriptionData(value: unknown): value is SubscriptionData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.plans)
    && data.plans.every((plan) => {
      if (!plan || typeof plan !== "object") return false;
      const item = plan as Record<string, unknown>;
      return typeof item.id === "string"
        && typeof item.name === "string"
        && typeof item.setup_fee_label === "string"
        && typeof item.setup_fee === "number"
        && typeof item.recurring_fee === "number"
        && ["minutes", "days", "month", "year", "one-time"].includes(String(item.billing_period))
        && typeof item.billing_interval === "number"
        && typeof item.description === "string"
        && Array.isArray(item.advance_payment_discounts)
        && item.advance_payment_discounts.every((discount) =>
          Boolean(discount)
          && typeof discount === "object"
          && Number.isInteger((discount as Record<string, unknown>).before_due)
          && typeof (discount as Record<string, unknown>).discount_amount === "number",
        );
    })
    && Array.isArray(data.owners)
    && Array.isArray(data.payments)
    && data.payments.every((payment) => {
      if (!payment || typeof payment !== "object") return false;
      const item = payment as Record<string, unknown>;
      return typeof item.id === "string"
        && typeof item.invoice_number === "string"
        && typeof item.owner_user_id === "string"
        && typeof item.pharmacy_name === "string"
        && typeof item.full_name === "string"
        && typeof item.email === "string"
        && typeof item.plan_name === "string"
        && typeof item.amount === "number"
        && typeof item.payment_method === "string"
        && ["Active", "Inactive", "Past Due"].includes(String(item.status))
        && typeof item.occurred_at === "string"
        && (item.expires_at === null || typeof item.expires_at === "string")
        && ["minutes", "days", "month", "year", "one-time"].includes(String(item.billing_period))
        && typeof item.billing_interval === "number";
    });
}

function isSubscriptionPaymentAccounts(value: unknown): value is SubscriptionPaymentAccounts {
  if (!value || typeof value !== "object") return false;
  const accounts = value as Record<string, unknown>;
  return typeof accounts.bkash === "string" && typeof accounts.nagad === "string";
}

export default function SubscriptionPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [owners, setOwners] = useState<PharmacySubscription[]>([]);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<SubscriptionPaymentAccounts>({ bkash: "", nagad: "" });
  const [paymentAccountsDraft, setPaymentAccountsDraft] = useState<SubscriptionPaymentAccounts>({ bkash: "", nagad: "" });
  const [isSavingPaymentAccounts, setIsSavingPaymentAccounts] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [ownerDraft, setOwnerDraft] = useState<OwnerDraft | null>(null);
  const [selectedPaymentInvoice, setSelectedPaymentInvoice] = useState<SubscriptionPayment | null>(null);
  const [invoiceActionError, setInvoiceActionError] = useState("");
  const [paymentPage, setPaymentPage] = useState(1);
  const [ownerPage, setOwnerPage] = useState(1);
  const [updatingOwnerId, setUpdatingOwnerId] = useState("");

  const loadSubscriptions = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [subscriptionsResult, accountsResult] = await Promise.all([
        supabase.rpc("admin_get_pharmacy_subscriptions"),
        supabase.rpc("admin_get_subscription_payment_accounts"),
      ]);
      const { data, error: loadError } = subscriptionsResult;
      if (loadError) throw loadError;
      if (!isSubscriptionData(data)) throw new Error("The subscription data returned by Supabase is invalid.");
      if (accountsResult.error) throw accountsResult.error;
      if (!isSubscriptionPaymentAccounts(accountsResult.data)) {
        throw new Error("The subscription payment accounts returned by Supabase are invalid.");
      }
      setPlans(data.plans);
      setOwners(data.owners);
      setPayments(data.payments);
      setPaymentAccounts(accountsResult.data);
      setPaymentAccountsDraft(accountsResult.data);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load pharmacy subscriptions."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function savePaymentAccounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingPaymentAccounts(true);
    setError("");
    setMessage("");
    try {
      const { error: saveError } = await supabase.rpc("admin_save_subscription_payment_accounts", {
        requested_bkash_account_number: paymentAccountsDraft.bkash.trim(),
        requested_nagad_account_number: paymentAccountsDraft.nagad.trim(),
      });
      if (saveError) throw saveError;
      setPaymentAccounts({
        bkash: paymentAccountsDraft.bkash.trim(),
        nagad: paymentAccountsDraft.nagad.trim(),
      });
      setMessage("Subscription payment account numbers saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save subscription payment account numbers."));
    } finally {
      setIsSavingPaymentAccounts(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadSubscriptions(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadSubscriptions]);

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!planDraft) return;
    const setupFee = Number(planDraft.setupFee);
    const recurringFee = Number(planDraft.recurringFee);
    const billingInterval = Number(planDraft.billingInterval);
    const advanceDiscounts = planDraft.advancePaymentDiscounts.map((discount) => ({
      beforeDue: Number(discount.beforeDue),
      discountAmount: Number(discount.discountAmount),
    }));
    const advanceDiscountThresholds = advanceDiscounts.map((discount) => discount.beforeDue);
    const maxAdvanceLeadTime = planDraft.billingPeriod === "minutes" ? 525600 : 365;
    const intervalIsValid = Number.isInteger(billingInterval)
      && (planDraft.billingPeriod === "minutes" || planDraft.billingPeriod === "days"
        ? billingInterval >= 1 && billingInterval <= 2147483647
        : planDraft.billingPeriod === "year"
          ? billingInterval >= 1 && billingInterval <= 3
          : billingInterval >= 1 && billingInterval <= 12);
    if (
      !planDraft.name.trim()
      || !planDraft.setupFeeLabel.trim()
      || planDraft.setupFeeLabel.trim().length > 40
      || !Number.isFinite(setupFee)
      || setupFee < 0
      || !Number.isFinite(recurringFee)
      || recurringFee < 0
      || !intervalIsValid
      || (planDraft.billingPeriod === "one-time" && advanceDiscounts.length > 0)
      || advanceDiscounts.length > 20
      || advanceDiscounts.some((discount) =>
        !Number.isInteger(discount.beforeDue)
        || discount.beforeDue < 1
        || discount.beforeDue > maxAdvanceLeadTime
        || !Number.isFinite(discount.discountAmount)
        || discount.discountAmount <= 0
        || Math.abs(discount.discountAmount * 100 - Math.round(discount.discountAmount * 100)) > 0.000001
        || discount.discountAmount > recurringFee,
      )
      || new Set(advanceDiscountThresholds).size !== advanceDiscountThresholds.length
    ) {
      setError(`Check the plan prices and billing period. Advance discounts need unique lead times (1–${maxAdvanceLeadTime} ${planDraft.billingPeriod === "minutes" ? "minutes" : "days"}) and an amount no greater than the recurring fee.`);
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: saveError } = await supabase.rpc("admin_save_pharmacy_subscription_plan", {
        target_plan_id: planDraft.id,
        requested_name: planDraft.name.trim(),
        requested_setup_fee_label: planDraft.setupFeeLabel.trim(),
        requested_setup_fee: setupFee,
        requested_recurring_fee: recurringFee,
        requested_billing_period: planDraft.billingPeriod,
        requested_billing_interval: billingInterval,
        requested_description: planDraft.description.trim(),
        requested_advance_payment_discounts: planDraft.billingPeriod === "one-time"
          ? []
          : advanceDiscounts.map((discount) => ({
            before_due: discount.beforeDue,
            discount_amount: discount.discountAmount,
          })),
      });
      if (saveError) throw saveError;
      setPlanDraft(null);
      setMessage("Subscription plan saved.");
      await loadSubscriptions();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save subscription plan."));
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePlan(plan: Plan) {
    if (!window.confirm(`Delete the ${plan.name} plan? Owners assigned to it will keep their subscription details, but the plan will be cleared.`)) return;
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.rpc("admin_delete_pharmacy_subscription_plan", {
        target_plan_id: plan.id,
      });
      if (deleteError) throw deleteError;
      setMessage(`${plan.name} plan deleted.`);
      await loadSubscriptions();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Could not delete subscription plan."));
    }
  }

  async function saveOwnerSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerDraft) return;
    const amount = Number(ownerDraft.payAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid non-negative payment amount.");
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: saveError } = await supabase.rpc("admin_save_pharmacy_subscription", {
        target_owner_user_id: ownerDraft.ownerUserId,
        requested_plan_id: ownerDraft.planId || null,
        requested_payment_method: ownerDraft.paymentMethod.trim(),
        requested_pay_amount: amount,
        requested_status: ownerDraft.status,
      });
      if (saveError) throw saveError;
      setOwnerDraft(null);
      setMessage("Pharmacy subscription updated.");
      await loadSubscriptions();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not update pharmacy subscription."));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteOwnerSubscription(owner: PharmacySubscription) {
    if (!window.confirm(`Delete the subscription record for ${owner.pharmacy_name}? The pharmacy owner account will remain.`)) return;
    setUpdatingOwnerId(owner.owner_user_id);
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.rpc("admin_delete_pharmacy_subscription", {
        target_owner_user_id: owner.owner_user_id,
      });
      if (deleteError) throw deleteError;
      setMessage("Subscription record deleted. The pharmacy owner account was not deleted.");
      await loadSubscriptions();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Could not delete subscription."));
    } finally {
      setUpdatingOwnerId("");
    }
  }

  async function toggleSuspended(owner: PharmacySubscription) {
    const shouldSuspend = !owner.is_suspended;
    const actionText = shouldSuspend ? "suspend" : "reactivate";
    if (!window.confirm(`${shouldSuspend ? "Suspend" : "Reactivate"} ${owner.pharmacy_name}'s pharmacy owner account?`)) return;
    setUpdatingOwnerId(owner.owner_user_id);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase.rpc("admin_set_pharmacy_account_suspended", {
        target_owner_user_id: owner.owner_user_id,
        should_suspend: shouldSuspend,
      });
      if (updateError) throw updateError;
      setMessage(`${owner.pharmacy_name} account ${shouldSuspend ? "suspended" : "reactivated"}.`);
      await loadSubscriptions();
    } catch (updateError) {
      setError(getErrorMessage(updateError, `Could not ${actionText} this account.`));
    } finally {
      setUpdatingOwnerId("");
    }
  }

  const paidUsers = owners.filter((owner) => owner.pay_amount > 0).length;
  const freeUsers = owners.length - paidUsers;
  const paymentPageCount = Math.max(1, Math.ceil(payments.length / SUBSCRIPTION_PAYMENTS_PER_PAGE));
  const safePaymentPage = Math.min(paymentPage, paymentPageCount);
  const ownerPageCount = Math.max(1, Math.ceil(owners.length / PHARMACY_OWNERS_PER_PAGE));
  const safeOwnerPage = Math.min(ownerPage, ownerPageCount);
  const visibleOwners = owners.slice(
    (safeOwnerPage - 1) * PHARMACY_OWNERS_PER_PAGE,
    safeOwnerPage * PHARMACY_OWNERS_PER_PAGE,
  );
  const visiblePayments = payments.slice(
    (safePaymentPage - 1) * SUBSCRIPTION_PAYMENTS_PER_PAGE,
    safePaymentPage * SUBSCRIPTION_PAYMENTS_PER_PAGE,
  );
  const metrics = [
    { label: "Total Account", value: owners.length, accent: "#267451", detail: "Pharmacy owner accounts" },
    { label: "Active Subscriptions", value: owners.filter((owner) => owner.status === "Active").length, accent: "#15805a", detail: "Currently active plans" },
    { label: "Paid User", value: paidUsers, accent: "#2563a8", detail: "Accounts with a paid amount" },
    { label: "Free User", value: freeUsers, accent: "#8a6418", detail: "Accounts with no payment amount" },
  ];

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1500, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <header style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Subscription</h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>Manage plans, pharmacy subscriptions and account access.</p>
        </header>

        {error && <p role="alert" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #f0d3cf", borderRadius: 7, background: "#fff8f7", color: "#ad4b43", fontSize: 12 }}>{error}</p>}
        {message && <p role="status" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #cae8d6", borderRadius: 7, background: "#f3fbf6", color: "#267451", fontSize: 12 }}>{message}</p>}

        <section aria-labelledby="subscription-payment-accounts-title" style={{ ...cardStyle, marginBottom: 20, padding: 17 }}>
          <div style={{ marginBottom: 13 }}>
            <h2 id="subscription-payment-accounts-title" style={{ margin: 0, color: "#203128", fontSize: 16, fontWeight: 750 }}>Subscription Payment Accounts</h2>
            <p style={{ margin: "5px 0 0", color: "#78867f", fontSize: 11 }}>These receiving account numbers appear on pharmacy owners&apos; subscription payment invoices.</p>
          </div>
          <form onSubmit={savePaymentAccounts} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", alignItems: "end", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>
              bKash account number
              <input maxLength={32} value={paymentAccountsDraft.bkash} onChange={(event) => setPaymentAccountsDraft({ ...paymentAccountsDraft, bkash: event.target.value })} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>
              Nagad account number
              <input maxLength={32} value={paymentAccountsDraft.nagad} onChange={(event) => setPaymentAccountsDraft({ ...paymentAccountsDraft, nagad: event.target.value })} style={inputStyle} />
            </label>
            <button type="submit" disabled={isSavingPaymentAccounts || isLoading} style={{ ...buttonStyle, border: 0, background: "#16845d", color: "#fff", padding: "9px 13px", cursor: isSavingPaymentAccounts || isLoading ? "wait" : "pointer", opacity: isSavingPaymentAccounts || isLoading ? 0.7 : 1 }}>
              {isSavingPaymentAccounts ? "Saving..." : "Save Payment Accounts"}
            </button>
          </form>
          <p style={{ margin: "8px 0 0", color: "#89958e", fontSize: 10 }}>
            Saved bKash: {paymentAccounts.bkash || "Not configured"} · Nagad: {paymentAccounts.nagad || "Not configured"}
          </p>
        </section>

        <section aria-labelledby="subscription-plans-title" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <h2 id="subscription-plans-title" style={{ margin: 0, color: "#203128", fontSize: 17, fontWeight: 750 }}>Subscription Plans</h2>
              <p style={{ margin: "4px 0 0", color: "#78867f", fontSize: 11 }}>Create and manage reusable pharmacy subscription plans.</p>
            </div>
            <button type="button" onClick={() => { setError(""); setPlanDraft({ ...blankPlan }); }} style={{ ...buttonStyle, border: 0, background: "#16845d", color: "#fff", padding: "9px 13px", fontSize: 12 }}>+ Add Subscription</button>
          </div>
          {isLoading ? (
            <p role="status" style={{ padding: 18, color: "#78867f", fontSize: 12 }}>Loading subscription plans...</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 12 }}>
              {plans.map((plan) => (
                <article key={plan.id} style={{ ...cardStyle, position: "relative", overflow: "hidden", padding: 17 }}>
                  <div aria-hidden="true" style={{ position: "absolute", inset: "0 0 auto", height: 3, background: "linear-gradient(90deg, #16845d, #54c990)" }} />
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginTop: 3 }}>
                    <div>
                      <span style={{ color: "#16845d", fontSize: 10, fontWeight: 750, letterSpacing: 0.5 }}>SUBSCRIPTION PLAN</span>
                      <h3 style={{ margin: "7px 0 0", color: "#203128", fontSize: 16, fontWeight: 750 }}>{plan.name}</h3>
                    </div>
                    <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 31, height: 31, borderRadius: 9, background: "#e8f5ed", color: "#16845d", fontSize: 16 }}>♛</span>
                  </div>
                  <div style={{ display: "grid", gap: 4, marginTop: 14, color: "#68776f", fontSize: 11 }}>
                    <span>{plan.setup_fee_label}: <strong style={{ color: "#34453b" }}>{formatAmount(plan.setup_fee)}</strong></span>
                    <span>{recurringFeeLabel(plan.billing_period)}: <strong style={{ color: "#34453b" }}>{formatAmount(plan.recurring_fee)}</strong></span>
                  </div>
                  <div style={{ marginTop: 8, color: "#203128", fontSize: 23, fontWeight: 750 }}>
                    {formatAmount(plan.setup_fee + plan.recurring_fee)}
                    <span style={{ marginLeft: 5, color: "#78867f", fontSize: 11, fontWeight: 500 }}>
                      / {periodDescription(plan.billing_period, plan.billing_interval)}
                    </span>
                  </div>
                  {plan.advance_payment_discounts.length > 0 && (
                    <p style={{ margin: "-2px 0 10px", color: "#267451", fontSize: 10 }}>
                      {plan.advance_payment_discounts.length} advance payment discount{plan.advance_payment_discounts.length === 1 ? "" : "s"} configured
                    </p>
                  )}
                  <p style={{ minHeight: 34, margin: "8px 0 16px", color: "#78867f", fontSize: 11, lineHeight: 1.55 }}>{plan.description || "No plan description."}</p>
                  <div style={{ display: "flex", gap: 7, borderTop: "1px solid #edf1ee", paddingTop: 12 }}>
                    <button type="button" onClick={() => { setError(""); setPlanDraft({ id: plan.id, name: plan.name, setupFeeLabel: plan.setup_fee_label, setupFee: String(plan.setup_fee), recurringFee: String(plan.recurring_fee), billingPeriod: plan.billing_period, billingInterval: String(plan.billing_interval), description: plan.description, advancePaymentDiscounts: plan.advance_payment_discounts.map((discount) => ({ beforeDue: String(discount.before_due), discountAmount: String(discount.discount_amount) })) }); }} style={buttonStyle}>Edit</button>
                    <button type="button" onClick={() => void deletePlan(plan)} style={{ ...buttonStyle, color: "#ad4b43" }}>Delete</button>
                  </div>
                </article>
              ))}
              {plans.length === 0 && <p style={{ gridColumn: "1 / -1", padding: 20, border: "1px dashed #ccd9d0", borderRadius: 8, color: "#78867f", fontSize: 12, textAlign: "center" }}>No subscription plans yet. Select Add Subscription to create one.</p>}
            </div>
          )}
        </section>

        <section aria-label="Subscription account metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 18 }}>
          {metrics.map((metric) => (
            <article key={metric.label} style={{ ...cardStyle, minHeight: 99, display: "grid", alignContent: "space-between", gap: 10, padding: "14px 16px" }}>
              <span style={{ color: "#68776f", fontSize: 11 }}>{metric.label}</span>
              <strong style={{ color: metric.accent, fontSize: 23, lineHeight: 1 }}>{isLoading ? "—" : metric.value}</strong>
              <span style={{ color: "#89958e", fontSize: 10 }}>{metric.detail}</span>
            </article>
          ))}
        </section>

        <section style={{ ...cardStyle, overflow: "hidden", marginBottom: 18 }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Pharmacy Owner Accounts</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Current subscription details and account suspension controls for pharmacy owners.</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1220, borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr>
                  {["Pharmacy Name", "User ID", "Full Name", "Email", "Plan", "Payment Method", "Pay Amount", "Status", "Actions", "Suspended Account"].map((column) => (
                    <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleOwners.map((owner) => {
                  const isUpdating = updatingOwnerId === owner.owner_user_id;
                  return (
                    <tr key={owner.owner_user_id}>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{owner.pharmacy_name}</td>
                      <td style={{ maxWidth: 150, padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#78867f", fontSize: 10, overflowWrap: "anywhere" }}>{owner.owner_user_id}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{owner.full_name}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11 }}>{owner.email}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{owner.plan_name || "No plan"}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11 }}>{owner.payment_method || "—"}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{formatAmount(owner.pay_amount)}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>
                        <span style={{ display: "inline-flex", borderRadius: 20, background: owner.status === "Active" ? "#e8f6ee" : owner.status === "Past Due" ? "#fff3e6" : "#f0f2f1", color: owner.status === "Active" ? "#18794e" : owner.status === "Past Due" ? "#a15c12" : "#68776f", padding: "5px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{owner.status}</span>
                      </td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>
                        <button type="button" disabled={isUpdating} onClick={() => setOwnerDraft({ ownerUserId: owner.owner_user_id, planId: owner.plan_id ?? "", paymentMethod: owner.payment_method, payAmount: String(owner.pay_amount), status: owner.status })} style={{ ...buttonStyle, opacity: isUpdating ? 0.6 : 1 }}>Edit</button>
                        <button type="button" disabled={isUpdating || (!owner.plan_id && !owner.payment_method && owner.pay_amount === 0 && owner.status === "Inactive")} onClick={() => void deleteOwnerSubscription(owner)} style={{ ...buttonStyle, marginLeft: 6, color: "#ad4b43", opacity: isUpdating || (!owner.plan_id && !owner.payment_method && owner.pay_amount === 0 && owner.status === "Inactive") ? 0.5 : 1 }}>Delete</button>
                      </td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={owner.is_suspended}
                          aria-label={`${owner.is_suspended ? "Reactivate" : "Suspend"} ${owner.pharmacy_name} account`}
                          disabled={isUpdating}
                          onClick={() => void toggleSuspended(owner)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 7, border: 0, background: "transparent", color: owner.is_suspended ? "#ad4b43" : "#267451", padding: 0, fontSize: 10, fontWeight: 700, cursor: isUpdating ? "wait" : "pointer", whiteSpace: "nowrap" }}
                        >
                          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: owner.is_suspended ? "flex-end" : "flex-start", width: 31, height: 18, borderRadius: 12, background: owner.is_suspended ? "#dca39c" : "#78c69b", padding: 2, boxSizing: "border-box" }}>
                            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px #0002" }} />
                          </span>
                          {owner.is_suspended ? "Suspended" : "Active"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && owners.length === 0 && (
                  <tr><td colSpan={10} style={{ padding: 28, color: "#87928d", fontSize: 12, textAlign: "center" }}>No pharmacy owner accounts found.</td></tr>
                )}
                {isLoading && (
                  <tr><td colSpan={10} style={{ padding: 28, color: "#87928d", fontSize: 12, textAlign: "center" }}>Loading pharmacy owner accounts...</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid #edf0ed", padding: "11px 15px", color: "#87928d", fontSize: 10 }}>
            <span>
              {isLoading
                ? "Showing — pharmacy owner accounts"
                : owners.length === 0
                  ? "Showing 0 pharmacy owner accounts"
                  : `Showing ${(safeOwnerPage - 1) * PHARMACY_OWNERS_PER_PAGE + 1}-${Math.min(safeOwnerPage * PHARMACY_OWNERS_PER_PAGE, owners.length)} of ${owners.length} pharmacy owner accounts`}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                aria-label="Previous pharmacy owner page"
                disabled={isLoading || safeOwnerPage <= 1}
                onClick={() => setOwnerPage(safeOwnerPage - 1)}
                style={{ ...buttonStyle, padding: "6px 9px", color: "#526158", cursor: isLoading || safeOwnerPage <= 1 ? "not-allowed" : "pointer", opacity: isLoading || safeOwnerPage <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ whiteSpace: "nowrap" }}>Page {safeOwnerPage} of {ownerPageCount}</span>
              <button
                type="button"
                aria-label="Next pharmacy owner page"
                disabled={isLoading || safeOwnerPage >= ownerPageCount}
                onClick={() => setOwnerPage(safeOwnerPage + 1)}
                style={{ ...buttonStyle, padding: "6px 9px", color: "#526158", cursor: isLoading || safeOwnerPage >= ownerPageCount ? "not-allowed" : "pointer", opacity: isLoading || safeOwnerPage >= ownerPageCount ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Pharmacy Owner Subscriptions</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Each successful subscription payment is listed separately. Select an invoice number to view or download its invoice.</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr>
                  {["Invoice Number", "Pharmacy Name", "Full Name", "Email", "Plan", "Payment Method", "Pay Amount", "Payment Date", "Expires At", "Status"].map((column) => (
                    <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map((payment) => (
                  <tr key={payment.id}>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedPaymentInvoice(payment); setInvoiceActionError(""); }}
                        style={{ border: 0, padding: 0, background: "transparent", color: "#16845d", fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        {payment.invoice_number}
                      </button>
                    </td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{payment.pharmacy_name}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{payment.full_name}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11 }}>{payment.email}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{payment.plan_name}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{payment.payment_method || "—"}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{formatAmount(payment.amount)}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(payment.occurred_at).toLocaleString("en-BD")}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{payment.expires_at ? new Date(payment.expires_at).toLocaleString("en-BD") : "—"}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>
                      <span style={{ display: "inline-flex", borderRadius: 20, background: payment.status === "Active" ? "#e8f6ee" : payment.status === "Past Due" ? "#fff3e6" : "#f0f2f1", color: payment.status === "Active" ? "#18794e" : payment.status === "Past Due" ? "#a15c12" : "#68776f", padding: "5px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{payment.status}</span>
                    </td>
                  </tr>
                ))}
                {!isLoading && payments.length === 0 && (
                  <tr><td colSpan={10} style={{ padding: 28, color: "#87928d", fontSize: 12, textAlign: "center" }}>No subscription payments have been recorded yet.</td></tr>
                )}
                {isLoading && (
                  <tr><td colSpan={10} style={{ padding: 28, color: "#87928d", fontSize: 12, textAlign: "center" }}>Loading subscription payments...</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid #edf0ed", padding: "11px 15px", color: "#87928d", fontSize: 10 }}>
            <span>
              {isLoading
                ? "Showing — payment invoices"
                : payments.length === 0
                  ? "Showing 0 payment invoices"
                  : `Showing ${(safePaymentPage - 1) * SUBSCRIPTION_PAYMENTS_PER_PAGE + 1}-${Math.min(safePaymentPage * SUBSCRIPTION_PAYMENTS_PER_PAGE, payments.length)} of ${payments.length} payment invoices`}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                aria-label="Previous subscription payment page"
                disabled={isLoading || safePaymentPage <= 1}
                onClick={() => setPaymentPage(safePaymentPage - 1)}
                style={{ ...buttonStyle, padding: "6px 9px", color: "#526158", cursor: isLoading || safePaymentPage <= 1 ? "not-allowed" : "pointer", opacity: isLoading || safePaymentPage <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ whiteSpace: "nowrap" }}>Page {safePaymentPage} of {paymentPageCount}</span>
              <button
                type="button"
                aria-label="Next subscription payment page"
                disabled={isLoading || safePaymentPage >= paymentPageCount}
                onClick={() => setPaymentPage(safePaymentPage + 1)}
                style={{ ...buttonStyle, padding: "6px 9px", color: "#526158", cursor: isLoading || safePaymentPage >= paymentPageCount ? "not-allowed" : "pointer", opacity: isLoading || safePaymentPage >= paymentPageCount ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {(planDraft || ownerDraft || selectedPaymentInvoice) && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) { setPlanDraft(null); setOwnerDraft(null); setSelectedPaymentInvoice(null); } }} style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", overflowY: "auto", padding: 16, background: "rgba(20, 35, 27, 0.48)" }}>
          <section role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title" style={{ width: "min(100%, 520px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", border: "1px solid #e3e9e4", borderRadius: 12, background: "#fff", boxShadow: "0 20px 60px rgba(20,35,27,0.22)" }}>
            {selectedPaymentInvoice && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "18px 20px", borderBottom: "1px solid #edf0ed" }}>
                  <div>
                    <p style={{ margin: "0 0 5px", color: "#16845d", fontSize: 10, fontWeight: 750, letterSpacing: 0.8 }}>PHARMACY CLUSTER</p>
                    <h2 id="subscription-dialog-title" style={{ margin: 0, color: "#203128", fontSize: 17, fontWeight: 750 }}>Payment Invoice · {selectedPaymentInvoice.invoice_number}</h2>
                  </div>
                  <button type="button" aria-label="Close invoice" onClick={() => setSelectedPaymentInvoice(null)} style={{ alignSelf: "flex-start", border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px", padding: 20, color: "#526158", fontSize: 11 }}>
                  <div><span style={{ color: "#87928d" }}>Pharmacy</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.pharmacy_name}</div></div>
                  <div><span style={{ color: "#87928d" }}>Plan</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.plan_name}</div></div>
                  <div><span style={{ color: "#87928d" }}>Account holder</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.full_name}</div></div>
                  <div><span style={{ color: "#87928d" }}>Email</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650, overflowWrap: "anywhere" }}>{selectedPaymentInvoice.email}</div></div>
                  <div><span style={{ color: "#87928d" }}>Payment method</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.payment_method || "—"}</div></div>
                  <div><span style={{ color: "#87928d" }}>Payment date</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{new Date(selectedPaymentInvoice.occurred_at).toLocaleString("en-BD")}</div></div>
                  <div><span style={{ color: "#87928d" }}>Billing period</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{periodDescription(selectedPaymentInvoice.billing_period, selectedPaymentInvoice.billing_interval)}</div></div>
                  <div><span style={{ color: "#87928d" }}>Expires at</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.expires_at ? new Date(selectedPaymentInvoice.expires_at).toLocaleString("en-BD") : "No expiry"}</div></div>
                  <div><span style={{ color: "#87928d" }}>Payment status</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedPaymentInvoice.status}</div></div>
                  <div><span style={{ color: "#87928d" }}>Amount paid</span><div style={{ marginTop: 4, color: "#16845d", fontSize: 18, fontWeight: 750 }}>{formatAmount(selectedPaymentInvoice.amount)}</div></div>
                </div>
                {invoiceActionError && <p role="alert" style={{ margin: "0 20px 14px", color: "#ad4b43", fontSize: 11 }}>{invoiceActionError}</p>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>
                  <button type="button" onClick={() => setSelectedPaymentInvoice(null)} style={{ ...buttonStyle, color: "#66756d" }}>Close</button>
                  <button type="button" onClick={() => {
                    try {
                      downloadSubscriptionInvoicePdf(selectedPaymentInvoice);
                      setInvoiceActionError("");
                    } catch (downloadError) {
                      setInvoiceActionError(getErrorMessage(downloadError, "Could not download payment invoice."));
                    }
                  }} style={{ ...buttonStyle, border: 0, background: "#16845d", color: "#fff", padding: "8px 13px" }}>Download Invoice</button>
                </div>
              </div>
            )}
            {planDraft && (
              <form onSubmit={savePlan}>
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #edf0ed" }}>
                  <h2 id="subscription-dialog-title" style={{ margin: 0, color: "#203128", fontSize: 17, fontWeight: 750 }}>{planDraft.id ? "Edit Subscription Plan" : "Add Subscription Plan"}</h2>
                  <p style={{ margin: "5px 0 0", color: "#78867f", fontSize: 11 }}>Set the plan name, setup fee, recurring fee and billing period.</p>
                </div>
                <div style={{ display: "grid", gap: 13, padding: 20 }}>
                  <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Plan name
                    <input required maxLength={80} value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} style={inputStyle} />
                  </label>
                  <p style={{ margin: 0, color: "#526158", fontSize: 11, fontWeight: 650 }}>Price</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Setup fee title
                      <input required maxLength={40} value={planDraft.setupFeeLabel} onChange={(event) => setPlanDraft({ ...planDraft, setupFeeLabel: event.target.value })} style={inputStyle} />
                    </label>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>{planDraft.setupFeeLabel.trim() || "Setup Fee"} (৳)
                      <input required type="number" min="0" step="0.01" value={planDraft.setupFee} onChange={(event) => setPlanDraft({ ...planDraft, setupFee: event.target.value })} style={inputStyle} />
                    </label>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>{recurringFeeLabel(planDraft.billingPeriod)} (৳)
                      <input required type="number" min="0" step="0.01" value={planDraft.recurringFee} onChange={(event) => setPlanDraft({ ...planDraft, recurringFee: event.target.value })} style={inputStyle} />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Billing Period
                      <select
                        value={planDraft.billingPeriod}
                        onChange={(event) => setPlanDraft({
                          ...planDraft,
                          billingPeriod: event.target.value as BillingPeriod,
                          billingInterval: "1",
                        })}
                        style={inputStyle}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="days">Days</option>
                        <option value="month">Monthly</option>
                        <option value="year">Yearly</option>
                        {planDraft.billingPeriod === "one-time" && <option value="one-time">One-time (legacy)</option>}
                      </select>
                    </label>
                    {planDraft.billingPeriod !== "one-time" && (
                      <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>
                        {planDraft.billingPeriod === "minutes"
                          ? "Number of Minutes"
                          : planDraft.billingPeriod === "days"
                            ? "Number of Days"
                            : planDraft.billingPeriod === "year"
                              ? "Number of Years"
                              : "Number of Months"}
                        {planDraft.billingPeriod === "minutes" || planDraft.billingPeriod === "days" ? (
                          <input
                            required
                            type="number"
                            min="1"
                            max="2147483647"
                            step="1"
                            value={planDraft.billingInterval}
                            onChange={(event) => setPlanDraft({ ...planDraft, billingInterval: event.target.value })}
                            style={inputStyle}
                          />
                        ) : (
                          <select
                            required
                            value={planDraft.billingInterval}
                            onChange={(event) => setPlanDraft({ ...planDraft, billingInterval: event.target.value })}
                            style={inputStyle}
                          >
                            {periodIntervalOptions(planDraft.billingPeriod).map((interval) => (
                              <option key={interval} value={interval}>
                                {interval} {planDraft.billingPeriod === "year" ? "year" : "month"}{interval === 1 ? "" : "s"}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    )}
                  </div>
                  {planDraft.billingPeriod !== "one-time" && (
                    <section aria-labelledby="advance-payment-title" style={{ display: "grid", gap: 10, padding: 13, border: "1px solid #dce9df", borderRadius: 8, background: "#f8fcf9" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div>
                          <h3 id="advance-payment-title" style={{ margin: 0, color: "#34453b", fontSize: 12, fontWeight: 700 }}>Advance Payment Discounts</h3>
                          <p style={{ margin: "4px 0 0", color: "#78867f", fontSize: 10, lineHeight: 1.5 }}>Set a discount for early payment. The before-due unit follows the billing period, and multi-period payments receive the discount for each period.</p>
                        </div>
                        <button
                          type="button"
                          disabled={planDraft.advancePaymentDiscounts.length >= 20}
                          onClick={() => setPlanDraft((current) => current
                            ? { ...current, advancePaymentDiscounts: [...current.advancePaymentDiscounts, { beforeDue: "", discountAmount: "" }] }
                            : current)}
                          style={{ ...buttonStyle, flex: "0 0 auto", opacity: planDraft.advancePaymentDiscounts.length >= 20 ? 0.5 : 1 }}
                        >
                          + Add tier
                        </button>
                      </div>
                      {planDraft.advancePaymentDiscounts.length === 0 ? (
                        <p style={{ margin: 0, color: "#87928d", fontSize: 10 }}>No advance payment discounts configured.</p>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {planDraft.advancePaymentDiscounts.map((discount, index) => (
                            <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", alignItems: "end", gap: 8 }}>
                              <label style={{ display: "grid", gap: 5, color: "#526158", fontSize: 10, fontWeight: 650 }}>
                                {planDraft.billingPeriod === "minutes" ? "Minutes before due" : "Days before due"}
                                <input
                                  required
                                  type="number"
                                  min="1"
                                  max={planDraft.billingPeriod === "minutes" ? 525600 : 365}
                                  step="1"
                                  value={discount.beforeDue}
                                  onChange={(event) => setPlanDraft((current) => current
                                    ? { ...current, advancePaymentDiscounts: current.advancePaymentDiscounts.map((item, itemIndex) => itemIndex === index ? { ...item, beforeDue: event.target.value } : item) }
                                    : current)}
                                  style={inputStyle}
                                />
                              </label>
                              <label style={{ display: "grid", gap: 5, color: "#526158", fontSize: 10, fontWeight: 650 }}>
                                Discount (৳)
                                <input
                                  required
                                  type="number"
                                  min="0.01"
                                  max={Number(planDraft.recurringFee)}
                                  step="0.01"
                                  value={discount.discountAmount}
                                  onChange={(event) => setPlanDraft((current) => current
                                    ? { ...current, advancePaymentDiscounts: current.advancePaymentDiscounts.map((item, itemIndex) => itemIndex === index ? { ...item, discountAmount: event.target.value } : item) }
                                    : current)}
                                  style={inputStyle}
                                />
                              </label>
                              <button
                                type="button"
                                aria-label={`Remove advance discount tier ${index + 1}`}
                                onClick={() => setPlanDraft((current) => current
                                  ? { ...current, advancePaymentDiscounts: current.advancePaymentDiscounts.filter((_, itemIndex) => itemIndex !== index) }
                                  : current)}
                                style={{ ...buttonStyle, color: "#ad4b43", marginBottom: 1 }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Description
                    <textarea rows={3} maxLength={500} value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>
                  <button type="button" disabled={isSaving} onClick={() => setPlanDraft(null)} style={{ ...buttonStyle, color: "#66756d" }}>Cancel</button>
                  <button type="submit" disabled={isSaving} style={{ ...buttonStyle, border: 0, background: "#16845d", color: "#fff", padding: "8px 13px" }}>{isSaving ? "Saving..." : "Save Plan"}</button>
                </div>
              </form>
            )}
            {ownerDraft && (
              <form onSubmit={saveOwnerSubscription}>
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #edf0ed" }}>
                  <h2 id="subscription-dialog-title" style={{ margin: 0, color: "#203128", fontSize: 17, fontWeight: 750 }}>Edit Pharmacy Subscription</h2>
                  <p style={{ margin: "5px 0 0", color: "#78867f", fontSize: 11 }}>Update plan, payment method, amount and subscription status.</p>
                </div>
                <div style={{ display: "grid", gap: 13, padding: 20 }}>
                  <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Subscription plan
                    <select value={ownerDraft.planId} onChange={(event) => setOwnerDraft({ ...ownerDraft, planId: event.target.value })} style={inputStyle}>
                      <option value="">No plan assigned</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — Setup {formatAmount(plan.setup_fee)} + {formatAmount(plan.recurring_fee)}
                          {plan.billing_period === "one-time" ? " one-time" : ` / ${periodDescription(plan.billing_period, plan.billing_interval)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Payment method
                    <input maxLength={100} placeholder="e.g. bKash, Visa, Bank transfer" value={ownerDraft.paymentMethod} onChange={(event) => setOwnerDraft({ ...ownerDraft, paymentMethod: event.target.value })} style={inputStyle} />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Pay amount (৳)
                      <input required type="number" min="0" step="0.01" value={ownerDraft.payAmount} onChange={(event) => setOwnerDraft({ ...ownerDraft, payAmount: event.target.value })} style={inputStyle} />
                    </label>
                    <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11, fontWeight: 650 }}>Status
                      <select value={ownerDraft.status} onChange={(event) => setOwnerDraft({ ...ownerDraft, status: event.target.value as SubscriptionStatus })} style={inputStyle}>
                        <option value="Active">Active</option><option value="Inactive">Inactive</option><option value="Past Due">Past Due</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>
                  <button type="button" disabled={isSaving} onClick={() => setOwnerDraft(null)} style={{ ...buttonStyle, color: "#66756d" }}>Cancel</button>
                  <button type="submit" disabled={isSaving} style={{ ...buttonStyle, border: 0, background: "#16845d", color: "#fff", padding: "8px 13px" }}>{isSaving ? "Saving..." : "Save Changes"}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </AdminDashboardShell>
  );
}
