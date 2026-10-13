"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { downloadSubscriptionInvoicePdf, type SubscriptionInvoice } from "@/lib/subscriptionInvoicePdf";
import { usePharmacyStoreName } from "../components/PharmacyDashboardBrand";
import DashboardSectionInvoiceTable from "../DashboardSectionInvoiceTable";
import { usePharmacySubscriptionExpiry } from "../../auth/PharmacySubscriptionExpiry";

type BillingProfile = {
  fullName: string;
  email: string;
  phone: string;
  storeName: string;
  accountCreatedAt: string;
};

type BillingPlan = {
  id: string;
  name: string;
  setup_fee_label: string;
  setup_fee: number;
  recurring_fee: number;
  billing_period: "minutes" | "days" | "month" | "year" | "one-time";
  billing_interval: number;
  description: string;
};

type BillingSubscription = {
  plan: BillingPlan | null;
  plans: BillingPlan[];
  is_assigned: boolean;
  status: "Active" | "Inactive" | "Past Due" | null;
  payment_method: string;
  pay_amount: number;
  expires_at: string | null;
};

type PaymentHistoryEntry = {
  id: string;
  invoice_number: string;
  plan_name: string;
  amount: number;
  payment_method: string;
  account_number: string;
  status: "Active" | "Inactive" | "Past Due";
  occurred_at: string;
  expires_at: string | null;
  billing_period: BillingPlan["billing_period"];
  billing_interval: number;
};

const PAYMENT_HISTORY_PER_PAGE = 10;

const cardStyle = {
  border: "1px solid #e0e9e3",
  borderRadius: 10,
  background: "#fff",
  boxShadow: "0 3px 12px rgba(26, 54, 39, 0.035)",
} as const;

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(value: number) {
  return `৳ ${Number(value).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function formatRemaining(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

function formatBillingPeriod(period: Pick<BillingPlan, "billing_period" | "billing_interval">) {
  if (period.billing_period === "one-time") return "one-time";
  const unit = period.billing_period === "minutes"
    ? "minute"
    : period.billing_period === "days"
      ? "day"
      : period.billing_period === "year"
        ? "year"
        : "month";
  return `${period.billing_interval} ${unit}${period.billing_interval === 1 ? "" : "s"}`;
}

function recurringFeeLabel(plan: BillingPlan) {
  if (plan.billing_period === "minutes") return "Per-minute Fee";
  if (plan.billing_period === "days") return "Daily Fee";
  if (plan.billing_period === "year") return "Yearly Fee";
  if (plan.billing_period === "one-time") return "Recurring Fee";
  return "Monthly Fee";
}

function isBillingPlan(value: unknown): value is BillingPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string"
    && typeof plan.name === "string"
    && typeof plan.setup_fee_label === "string"
    && typeof plan.setup_fee === "number"
    && typeof plan.recurring_fee === "number"
    && ["minutes", "days", "month", "year", "one-time"].includes(String(plan.billing_period))
    && typeof plan.billing_interval === "number"
    && typeof plan.description === "string";
}

function isBillingSubscription(value: unknown): value is BillingSubscription {
  if (!value || typeof value !== "object") return false;
  const subscription = value as Record<string, unknown>;
  if (
    typeof subscription.is_assigned !== "boolean"
    || (subscription.status !== null && typeof subscription.status !== "string")
    || typeof subscription.payment_method !== "string"
    || typeof subscription.pay_amount !== "number"
    || (subscription.expires_at !== null && typeof subscription.expires_at !== "string")
    || !Array.isArray(subscription.plans)
    || !subscription.plans.every(isBillingPlan)
  ) return false;
  return subscription.plan === null || isBillingPlan(subscription.plan);
}

function isPaymentHistory(value: unknown): value is PaymentHistoryEntry[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const history = entry as Record<string, unknown>;
    return typeof history.id === "string"
      && typeof history.invoice_number === "string"
      && typeof history.plan_name === "string"
      && typeof history.amount === "number"
      && typeof history.payment_method === "string"
      && typeof history.account_number === "string"
      && ["Active", "Inactive", "Past Due"].includes(String(history.status))
      && typeof history.occurred_at === "string"
      && (history.expires_at === null || typeof history.expires_at === "string")
      && ["minutes", "days", "month", "year", "one-time"].includes(String(history.billing_period))
      && typeof history.billing_interval === "number";
  });
}

export default function SubscriptionBillingSection() {
  const dashboardStoreName = usePharmacyStoreName();
  const router = useRouter();
  const { isExpired, remainingMs, now } = usePharmacySubscriptionExpiry();
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryEntry[]>([]);
  const [paymentHistoryPage, setPaymentHistoryPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<PaymentHistoryEntry | null>(null);
  const [invoiceActionError, setInvoiceActionError] = useState("");
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [paymentHistoryError, setPaymentHistoryError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isClaimingExtendedAccess, setIsClaimingExtendedAccess] = useState(false);
  const [error, setError] = useState("");
  const paymentHistoryPageCount = Math.max(1, Math.ceil(paymentHistory.length / PAYMENT_HISTORY_PER_PAGE));
  const safePaymentHistoryPage = Math.min(paymentHistoryPage, paymentHistoryPageCount);
  const visiblePaymentHistory = paymentHistory.slice(
    (safePaymentHistoryPage - 1) * PAYMENT_HISTORY_PER_PAGE,
    safePaymentHistoryPage * PAYMENT_HISTORY_PER_PAGE,
  );
  const mobilePaymentHistoryRows = visiblePaymentHistory.map((entry) => {
    const expiryTime = entry.expires_at ? Date.parse(entry.expires_at) : null;
    const hasValidExpiry = expiryTime !== null && Number.isFinite(expiryTime);
    const isExpired = hasValidExpiry && expiryTime <= now;
    const statusStyle = entry.status === "Active"
      ? { background: "#e8f6ee", color: "#18794e" }
      : entry.status === "Past Due"
        ? { background: "#fff2dd", color: "#9b6412" }
        : { background: "#f0f3f1", color: "#65746b" };

    return [
      formatDate(entry.occurred_at),
      <button
        key={`payment-invoice-${entry.id}`}
        type="button"
        onClick={() => { setSelectedInvoice(entry); setInvoiceActionError(""); }}
        style={{ border: 0, padding: 0, background: "transparent", color: "#16845d", fontSize: 9, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
      >
        {entry.invoice_number}
      </button>,
      entry.plan_name,
      formatAmount(entry.amount),
      entry.payment_method || "—",
      <span key={`payment-status-${entry.id}`} style={{ display: "inline-block", borderRadius: 999, padding: "3px 5px", ...statusStyle, fontSize: 8, fontWeight: 700 }}>
        {entry.status}
      </span>,
      !hasValidExpiry ? "—" : isExpired ? "Expired" : `Expires in ${formatRemaining(expiryTime - now)}`,
    ];
  });

  useEffect(() => {
    let isActive = true;

    async function loadBillingProfile() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Sign in to view billing information.");

        const { data, error: profileError } = await supabase
          .from("user_profiles")
          .select("full_name, email, phone, created_at")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!data) throw new Error("Your pharmacy account information could not be found.");

        const { data: pharmacy, error: pharmacyError } = await supabase
          .from("pharmacies")
          .select("store_name")
          .eq("owner_user_id", user.id)
          .maybeSingle();
        if (pharmacyError) throw pharmacyError;

        const { data: subscriptionData, error: subscriptionError } = await supabase.rpc("get_my_pharmacy_subscription_plan");
        if (subscriptionError) throw subscriptionError;
        if (!isBillingSubscription(subscriptionData)) {
          throw new Error("The subscription plan returned by Supabase is invalid.");
        }

        if (isActive) {
          setProfile({
            fullName: data.full_name || "Pharmacy Owner",
            email: data.email || user.email || "",
            phone: data.phone || "",
            storeName: pharmacy?.store_name || "Pharmacy account",
            accountCreatedAt: data.created_at,
          });
          setSubscription(subscriptionData);
        }

        try {
          const { data: historyData, error: historyError } = await supabase.rpc("get_my_pharmacy_subscription_payment_history");
          if (historyError) throw historyError;
          if (!isPaymentHistory(historyData)) {
            throw new Error("Supabase returned invalid payment history data.");
          }
          if (isActive) setPaymentHistory(historyData);
        } catch (historyLoadError) {
          if (isActive) {
            setPaymentHistoryError(
              `${historyLoadError instanceof Error ? historyLoadError.message : "Could not load payment history."} Apply all subscription migrations through supabase/migrations/20261012040000_subscription_payment_invoice_details.sql in Supabase, then retry.`,
            );
          }
        }
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : "Could not load billing information.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
          setIsHistoryLoading(false);
        }
      }
    }

    void loadBillingProfile();
    return () => {
      isActive = false;
    };
  }, []);

  const currentPlanName = subscription?.plan?.name.trim().toLowerCase() ?? "";
  const hasPurchasedOneTimeSetup = paymentHistory.some(
    (entry) => entry.plan_name.trim().toLowerCase() === "one-time setup",
  );
  const nextPlanName = hasPurchasedOneTimeSetup
    ? ["starter access", "extended access", "one-time setup", "standard subscription"].includes(currentPlanName)
      ? "Standard Subscription"
      : null
    : ["starter access", "extended access"].includes(currentPlanName)
      ? "One-Time Setup"
      : ["one-time setup", "standard subscription"].includes(currentPlanName)
        ? "Standard Subscription"
        : null;
  const nextPlan = nextPlanName
    ? subscription?.plans.find((plan) => plan.name.trim().toLowerCase() === nextPlanName.toLowerCase()) ?? null
    : null;
  const nextPaymentAmount = nextPlan ? nextPlan.setup_fee + nextPlan.recurring_fee : null;
  const currentPlanExpired = Boolean(subscription?.is_assigned && isExpired);
  const normalizedPlanName = subscription?.plan?.name.trim().toLowerCase() ?? "";
  const canClaimExtendedAccess = subscription?.is_assigned === true
    && normalizedPlanName === "starter access";
  const canChooseNextPlan = subscription?.is_assigned === true
    && !canClaimExtendedAccess
    && ["extended access", "one-time setup", "standard subscription"].includes(normalizedPlanName);

  async function claimExtendedAccess() {
    setIsClaimingExtendedAccess(true);
    setError("");
    try {
      const { error: claimError } = await supabase.rpc("claim_my_pharmacy_extended_access");
      if (claimError) throw claimError;
      window.location.reload();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Could not activate Extended Access.");
      setIsClaimingExtendedAccess(false);
    }
  }

  const actionStyle = {
    border: "1px solid #dce8e0",
    borderRadius: 7,
    background: "#f8fbf9",
    color: "#819087",
    padding: "9px 13px",
    fontSize: 12,
    fontWeight: 650,
    cursor: "not-allowed",
  } as const;

  return (
    <section className="dashboard-settings-billing" aria-labelledby="billing-title" style={{ color: "#26352f" }}>
      <header style={{ marginBottom: 20 }}>
        <h2 id="billing-title" style={{ margin: 0, color: "#203128", fontSize: 23, lineHeight: 1.25, fontWeight: 750, letterSpacing: "-0.03em" }}>
          Subscription &amp; Billing
        </h2>
        <p style={{ margin: "6px 0 0", color: "#718078", fontSize: 13 }}>
          Manage your subscription plan and view your payment history.
        </p>
      </header>

      {error && (
        <p role="alert" style={{ margin: "0 0 16px", border: "1px solid #f0d3cf", borderRadius: 7, background: "#fff8f7", padding: "10px 12px", color: "#ad4b43", fontSize: 12 }}>
          {error}
        </p>
      )}

      {subscription && !subscription.plan && (
        <p role="alert" style={{ margin: "0 0 16px", border: "1px solid #f0d3cf", borderRadius: 7, background: "#fff8f7", padding: "10px 12px", color: "#ad4b43", fontSize: 12 }}>
          The Starter Access plan is not available yet. Please contact your administrator.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.1fr) minmax(220px, 0.9fr)", gap: 14, marginBottom: 14 }}>
        <article style={{ ...cardStyle, minHeight: 206, boxSizing: "border-box", padding: "20px clamp(16px, 2.5vw, 25px)", borderColor: "#cce9d8", background: "linear-gradient(120deg, #f3fbf6, #fff 78%)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#16845f", fontSize: 12, fontWeight: 700 }}>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "#e3f5eb", fontSize: 15 }}>♛</span>
                Current Plan
              </div>
              <h3 style={{ margin: "13px 0 3px", color: "#203128", fontSize: 19, fontWeight: 750 }}>
                {isLoading ? "Loading plan..." : subscription?.plan?.name ?? "Plan not available"}
              </h3>
              <p style={{ margin: 0, color: "#718078", fontSize: 12 }}>
                {profile?.storeName ?? "Your pharmacy account"}
              </p>
            </div>
            <span style={{ borderRadius: 20, background: currentPlanExpired ? "#fff2dd" : subscription?.is_assigned ? "#e8f6ee" : "#eef4f0", color: currentPlanExpired ? "#9b6412" : subscription?.is_assigned ? "#18794e" : "#65746b", padding: "6px 10px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
              {isLoading ? "Loading" : currentPlanExpired ? "Expired" : subscription?.is_assigned ? subscription.status ?? "Assigned" : "Available"}
            </span>
          </div>

          <p style={{ margin: "16px 0 18px", color: "#687871", fontSize: 12, lineHeight: 1.6 }}>
            {subscription?.plan?.description || "Your Starter Access plan is ready to view."}
          </p>
          {subscription?.plan && (
            <div style={{ display: "grid", gap: 5, marginBottom: 17, color: "#687871", fontSize: 12 }}>
              <span>{subscription.plan.setup_fee_label}: <strong style={{ color: "#34453b" }}>{formatAmount(subscription.plan.setup_fee)}</strong></span>
              <span>{recurringFeeLabel(subscription.plan)}: <strong style={{ color: "#34453b" }}>{formatAmount(subscription.plan.recurring_fee)}</strong></span>
              <strong style={{ color: "#203128", fontSize: 17 }}>
                {formatAmount(subscription.plan.setup_fee + subscription.plan.recurring_fee)}
                <span style={{ marginLeft: 5, color: "#718078", fontSize: 11, fontWeight: 500 }}>/ {formatBillingPeriod(subscription.plan)}</span>
              </strong>
            </div>
          )}
          {subscription?.is_assigned && subscription.plan && (
            <p role={currentPlanExpired ? "alert" : "status"} style={{ margin: "0 0 16px", color: currentPlanExpired ? "#ad4b43" : "#526158", fontSize: 12, fontWeight: 650 }}>
              {subscription.expires_at === null
                ? "This plan does not expire."
                : currentPlanExpired
                  ? "This plan has expired. Choose a new plan to restore dashboard actions."
                  : remainingMs !== null
                    ? `Expires in ${formatRemaining(remainingMs)}`
                    : "Checking plan expiry..."}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid #e7f0ea", paddingTop: 14 }}>
            <p style={{ margin: 0, color: "#718078", fontSize: 11 }}>{subscription?.is_assigned ? "Your current subscription plan." : "Choose a plan for your pharmacy account."}</p>
            {canClaimExtendedAccess ? (
              <button
                type="button"
                disabled={isLoading || isClaimingExtendedAccess}
                onClick={() => void claimExtendedAccess()}
                title="Claim and activate Extended Access"
                style={{ ...actionStyle, background: "#179c70", borderColor: "#179c70", color: "#fff", cursor: isClaimingExtendedAccess ? "wait" : "pointer" }}
              >
                {isClaimingExtendedAccess ? "Activating..." : "Claim Extended Access"}
              </button>
            ) : canChooseNextPlan ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => router.push("/subscription-setup")}
                title="Choose your next subscription plan"
                style={{ ...actionStyle, background: "#179c70", borderColor: "#179c70", color: "#fff", cursor: "pointer" }}
              >
                Choose New Plan
              </button>
            ) : (
              <button type="button" disabled title="No plan change is available" style={actionStyle}>Change Plan</button>
            )}
          </div>
        </article>

        <article style={{ ...cardStyle, minHeight: 206, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 20, borderColor: "#d5e8dc", background: "#fbfdfb" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#16845f", fontSize: 12, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "#e8f5ed", fontSize: 14 }}>▣</span>
              Next Payment
            </div>
            <strong style={{ display: "block", marginTop: 13, color: "#203128", fontSize: nextPlan ? 24 : 28, letterSpacing: "-0.04em" }}>
              {isLoading || isHistoryLoading
                ? "Loading..."
                : paymentHistoryError
                  ? "Not available"
                  : nextPlan
                    ? formatAmount(nextPaymentAmount ?? 0)
                    : "Not available"}
            </strong>
            <p style={{ margin: "5px 0 0", color: "#718078", fontSize: 12 }}>
              {isLoading || isHistoryLoading
                ? "Checking your next plan"
                : paymentHistoryError
                  ? "Could not verify previous plan purchases"
                  : nextPlan
                  ? `Next plan: ${nextPlan.name} · ${formatBillingPeriod(nextPlan)}`
                  : "No next plan is configured for this subscription"}
            </p>
          </div>
        </article>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { icon: "⌂", label: "Store Owner", value: profile?.fullName || (isLoading ? "Loading..." : "Not available"), detail: profile?.storeName || "" },
          { icon: "✉", label: "Billing Email", value: profile?.email || (isLoading ? "Loading..." : "Not available"), detail: "Account email" },
          { icon: "▤", label: "Payment Method", value: subscription?.payment_method || "Not added", detail: subscription?.payment_method ? "Current subscription" : "No billing method on file" },
          { icon: "▣", label: "Account Created", value: profile ? formatDate(profile.accountCreatedAt) : (isLoading ? "Loading..." : "Not available"), detail: "Pharmacy account" },
        ].map((item) => (
          <article key={item.label} style={{ ...cardStyle, minHeight: 82, boxSizing: "border-box", display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 15px" }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", flex: "0 0 30px", height: 30, borderRadius: 8, background: "#e8f5ed", color: "#16845f", fontSize: 15 }}>{item.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#718078", fontSize: 10 }}>{item.label}</div>
              <strong style={{ display: "block", overflowWrap: "anywhere", marginTop: 5, color: "#34453b", fontSize: 12, fontWeight: 700 }}>{item.value}</strong>
              {item.detail && <div style={{ marginTop: 4, color: "#87938c", fontSize: 10 }}>{item.detail}</div>}
            </div>
          </article>
        ))}
      </div>

      <section className="dashboard-settings-payment-history" aria-labelledby="payment-history-title" style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "16px 18px", borderBottom: "1px solid #edf1ee" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: "#e8f5ed", color: "#16845f", fontSize: 15 }}>▤</span>
            <div>
              <h3 id="payment-history-title" style={{ margin: 0, color: "#26352f", fontSize: 14, fontWeight: 750 }}>Payment History</h3>
              <p style={{ margin: "4px 0 0", color: "#718078", fontSize: 11 }}>View your last payments and invoices.</p>
            </div>
          </div>
        </div>

        {paymentHistoryError && (
          <p role="alert" style={{ margin: 12, border: "1px solid #f0d3cf", borderRadius: 7, background: "#fff8f7", padding: "10px 12px", color: "#ad4b43", fontSize: 11 }}>
            {paymentHistoryError}
          </p>
        )}

        <div className="dashboard-settings-payment-history-desktop" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr>
                {["Date", "Invoice No.", "Plan", "Amount", "Payment Method", "Status", "Action"].map((heading) => (
                  <th key={heading} style={{ padding: "11px 14px", background: "#f7faf8", borderBottom: "1px solid #e9efeb", color: "#718078", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paymentHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "34px 16px", color: "#87938c", fontSize: 12, textAlign: "center" }}>
                    {isHistoryLoading ? "Loading payment history..." : "No payment history is available."}
                  </td>
                </tr>
              ) : visiblePaymentHistory.map((entry) => {
                const expiryTime = entry.expires_at ? Date.parse(entry.expires_at) : null;
                const hasValidExpiry = expiryTime !== null && Number.isFinite(expiryTime);
                const isExpired = hasValidExpiry && expiryTime <= now;

                return (
                  <tr key={entry.id}>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", color: "#526158", fontSize: 11, whiteSpace: "nowrap" }}>{formatDate(entry.occurred_at)}</td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedInvoice(entry); setInvoiceActionError(""); }}
                        style={{ border: 0, padding: 0, background: "transparent", color: "#16845d", fontSize: 10, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        {entry.invoice_number}
                      </button>
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", color: "#34453b", fontSize: 11, fontWeight: 650 }}>{entry.plan_name}</td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", color: "#203128", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{formatAmount(entry.amount)}</td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", color: "#526158", fontSize: 11 }}>{entry.payment_method || "—"}</td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", fontSize: 10, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", borderRadius: 999, padding: "5px 8px", background: entry.status === "Active" ? "#e8f6ee" : entry.status === "Past Due" ? "#fff2dd" : "#f0f3f1", color: entry.status === "Active" ? "#18794e" : entry.status === "Past Due" ? "#9b6412" : "#65746b", fontWeight: 700 }}>
                        {entry.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1ee", color: isExpired ? "#ad4b43" : "#87938c", fontSize: 10, fontWeight: isExpired ? 700 : 400, whiteSpace: "nowrap" }}>
                      {!hasValidExpiry
                        ? "—"
                        : isExpired
                          ? "Expired"
                          : `Expires in ${formatRemaining(expiryTime - now)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dashboard-settings-payment-history-mobile">
          {visiblePaymentHistory.length > 0 ? (
            <DashboardSectionInvoiceTable
              columns={["Date", "Invoice No.", "Plan", "Amount", "Payment", "Status", "Expiry"]}
              rows={mobilePaymentHistoryRows}
              rowKeys={visiblePaymentHistory.map((entry) => entry.id)}
              mobileOnly
              syncMobileScroll
            />
          ) : (
            <div className="dashboard-settings-payment-history-empty">
              {isHistoryLoading ? "Loading payment history..." : "No payment history is available."}
            </div>
          )}
        </div>
        <div className="dashboard-settings-payment-history-pagination" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid #edf1ee", padding: "12px 16px", color: "#87938c", fontSize: 10 }}>
          <span>
            {isHistoryLoading
              ? "Showing — payment history entries"
              : paymentHistory.length === 0
                ? "Showing 0 payment history entries"
                : `Showing ${(safePaymentHistoryPage - 1) * PAYMENT_HISTORY_PER_PAGE + 1}-${Math.min(safePaymentHistoryPage * PAYMENT_HISTORY_PER_PAGE, paymentHistory.length)} of ${paymentHistory.length} payment history entries`}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              aria-label="Previous payment history page"
              disabled={isHistoryLoading || safePaymentHistoryPage <= 1}
              onClick={() => setPaymentHistoryPage(safePaymentHistoryPage - 1)}
              style={{ border: "1px solid #dce8e0", borderRadius: 7, background: "#f8fbf9", color: "#526158", padding: "6px 9px", fontSize: 10, fontWeight: 650, cursor: isHistoryLoading || safePaymentHistoryPage <= 1 ? "not-allowed" : "pointer", opacity: isHistoryLoading || safePaymentHistoryPage <= 1 ? 0.5 : 1 }}
            >
              Previous
            </button>
            <span style={{ whiteSpace: "nowrap" }}>Page {safePaymentHistoryPage} of {paymentHistoryPageCount}</span>
            <button
              type="button"
              aria-label="Next payment history page"
              disabled={isHistoryLoading || safePaymentHistoryPage >= paymentHistoryPageCount}
              onClick={() => setPaymentHistoryPage(safePaymentHistoryPage + 1)}
              style={{ border: "1px solid #dce8e0", borderRadius: 7, background: "#f8fbf9", color: "#526158", padding: "6px 9px", fontSize: 10, fontWeight: 650, cursor: isHistoryLoading || safePaymentHistoryPage >= paymentHistoryPageCount ? "not-allowed" : "pointer", opacity: isHistoryLoading || safePaymentHistoryPage >= paymentHistoryPageCount ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {selectedInvoice && (
        <div
          role="presentation"
          className="dashboard-payment-invoice-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedInvoice(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", overflowY: "auto", padding: 16, background: "rgba(20, 35, 27, 0.48)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-invoice-title"
            className="dashboard-payment-invoice-dialog"
            style={{ width: "min(100%, 520px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", border: "1px solid #e3e9e4", borderRadius: 12, background: "#fff", boxShadow: "0 20px 60px rgba(20,35,27,0.22)" }}
          >
            <div className="dashboard-payment-invoice-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "18px 20px", borderBottom: "1px solid #edf0ed" }}>
              <div>
                <p style={{ margin: "0 0 5px", color: "#16845d", fontSize: 10, fontWeight: 750, letterSpacing: 0.8 }}>Pharmacy Cluster</p>
                <h2 id="payment-invoice-title" style={{ margin: 0, color: "#203128", fontSize: 17, fontWeight: 750 }}>Payment Invoice · {selectedInvoice.invoice_number}</h2>
              </div>
              <button type="button" aria-label="Close invoice" onClick={() => setSelectedInvoice(null)} style={{ alignSelf: "flex-start", border: 0, background: "transparent", color: "#718078", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            <div className="dashboard-payment-invoice-summary">
              <span>Amount paid</span>
              <strong>{formatAmount(selectedInvoice.amount)}</strong>
              <span>{formatDate(selectedInvoice.occurred_at)}</span>
            </div>
            <div className="dashboard-payment-invoice-details" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px", padding: 20, color: "#526158", fontSize: 11 }}>
              <div><span style={{ color: "#87928d" }}>Pharmacy</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{profile?.storeName || "Pharmacy account"}</div></div>
              <div><span style={{ color: "#87928d" }}>Plan</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedInvoice.plan_name}</div></div>
              <div><span style={{ color: "#87928d" }}>Account holder</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{profile?.fullName || "Pharmacy Owner"}</div></div>
              <div><span style={{ color: "#87928d" }}>Email</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650, overflowWrap: "anywhere" }}>{profile?.email || "—"}</div></div>
              <div><span style={{ color: "#87928d" }}>Phone number</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{profile?.phone || "—"}</div></div>
              <div className="dashboard-payment-invoice-mobile-extra"><span style={{ color: "#87928d" }}>Payment method</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedInvoice.payment_method || "—"}</div></div>
              <div className="dashboard-payment-invoice-mobile-extra"><span style={{ color: "#87928d" }}>Account number</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650, overflowWrap: "anywhere" }}>{selectedInvoice.account_number || "—"}</div></div>
              <div className="dashboard-payment-invoice-mobile-extra"><span style={{ color: "#87928d" }}>Billing period</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{formatBillingPeriod(selectedInvoice)}</div></div>
              <div className="dashboard-payment-invoice-mobile-extra"><span style={{ color: "#87928d" }}>Status</span><div style={{ marginTop: 4, color: "#26372f", fontWeight: 650 }}>{selectedInvoice.status}</div></div>
            </div>
            {invoiceActionError && <p className="dashboard-payment-invoice-error" role="alert" style={{ margin: "0 20px 14px", color: "#ad4b43", fontSize: 11 }}>{invoiceActionError}</p>}
            <div className="dashboard-payment-invoice-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>
              <button type="button" onClick={() => setSelectedInvoice(null)} style={{ border: "1px solid #dce8e0", borderRadius: 7, background: "#f8fbf9", color: "#66756d", padding: "8px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Close</button>
              <button type="button" onClick={() => {
                try {
                  const invoice: SubscriptionInvoice = {
                    invoice_number: selectedInvoice.invoice_number,
                    full_name: profile?.fullName || "Pharmacy Owner",
                    email: profile?.email || "",
                    phone: profile?.phone || "",
                    store_name: profile?.storeName || "Pharmacy account",
                    plan_name: selectedInvoice.plan_name,
                    amount: selectedInvoice.amount,
                    payment_method: selectedInvoice.payment_method,
                    account_number: selectedInvoice.account_number,
                    status: selectedInvoice.status,
                    occurred_at: selectedInvoice.occurred_at,
                    expires_at: selectedInvoice.expires_at,
                    billing_period: selectedInvoice.billing_period,
                    billing_interval: selectedInvoice.billing_interval,
                  };
                  const storeFileName = (dashboardStoreName || profile?.storeName || "Pharmacy account")
                    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
                    .replace(/[. ]+$/g, "")
                    .trim();
                  downloadSubscriptionInvoicePdf(invoice, "Pharmacy Cluster", `${storeFileName}_Payment Bill_${selectedInvoice.invoice_number}.pdf`);
                  setInvoiceActionError("");
                } catch (downloadError) {
                  setInvoiceActionError(downloadError instanceof Error ? downloadError.message : "Could not download payment invoice.");
                }
              }} style={{ border: 0, borderRadius: 7, background: "#16845d", color: "#fff", padding: "8px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Download Invoice</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
