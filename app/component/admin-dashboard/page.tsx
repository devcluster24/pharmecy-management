"use client";

import { useEffect, useState } from "react";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";

type SubscriptionStatus = "Active" | "Inactive" | "Past Due";
type BillingPeriod = "minutes" | "days" | "month" | "year" | "one-time";
type PharmacyOwner = {
  owner_user_id: string;
  pharmacy_name: string;
  full_name: string;
  status: SubscriptionStatus;
};
type SubscriptionPayment = {
  id: string;
  owner_user_id: string;
  pharmacy_name: string;
  full_name: string;
  plan_name: string;
  amount: number;
  payment_method: string;
  status: SubscriptionStatus;
  occurred_at: string;
  expires_at: string | null;
  billing_period: BillingPeriod;
  billing_interval: number;
};
type MonthlyExpense = { month: string; amount: number };
type DashboardData = {
  owners: PharmacyOwner[];
  payments: SubscriptionPayment[];
  expenses: MonthlyExpense[];
};
type ChartPoint = { label: string; revenue: number; expenses: number };
type Period = "Monthly" | "Quarterly" | "Yearly";

const periods: Period[] = ["Monthly", "Quarterly", "Yearly"];
const panelStyle = {
  minWidth: 0,
  border: "1px solid #e3e9e4",
  borderRadius: 8,
  background: "#fff",
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStatus(value: unknown): value is SubscriptionStatus {
  return value === "Active" || value === "Inactive" || value === "Past Due";
}

function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "minutes"
    || value === "days"
    || value === "month"
    || value === "year"
    || value === "one-time";
}

function isDashboardData(value: unknown): value is { owners: PharmacyOwner[]; payments: SubscriptionPayment[] } {
  if (!isObject(value) || !Array.isArray(value.owners) || !Array.isArray(value.payments)) return false;
  const validOwners = value.owners.every((owner) =>
    isObject(owner)
    && typeof owner.owner_user_id === "string"
    && typeof owner.pharmacy_name === "string"
    && typeof owner.full_name === "string"
    && isStatus(owner.status),
  );
  const validPayments = value.payments.every((payment) =>
    isObject(payment)
    && typeof payment.id === "string"
    && typeof payment.owner_user_id === "string"
    && typeof payment.pharmacy_name === "string"
    && typeof payment.full_name === "string"
    && typeof payment.plan_name === "string"
    && typeof payment.amount === "number"
    && Number.isFinite(payment.amount)
    && typeof payment.payment_method === "string"
    && isStatus(payment.status)
    && typeof payment.occurred_at === "string"
    && Number.isFinite(Date.parse(payment.occurred_at))
    && (payment.expires_at === null || (typeof payment.expires_at === "string" && Number.isFinite(Date.parse(payment.expires_at))))
    && isBillingPeriod(payment.billing_period)
    && typeof payment.billing_interval === "number"
    && Number.isFinite(payment.billing_interval),
  );
  return validOwners && validPayments;
}

function isMonthlyExpenses(value: unknown): value is MonthlyExpense[] {
  return Array.isArray(value) && value.every((expense) =>
    isObject(expense)
    && typeof expense.month === "string"
    && /^\d{4}-\d{2}$/.test(expense.month)
    && typeof expense.amount === "number"
    && Number.isFinite(expense.amount),
  );
}

function formatAmount(value: number) {
  return `৳ ${value.toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function periodDescription(period: BillingPeriod, interval: number) {
  if (period === "one-time") return "One-time";
  const unit = period === "minutes" ? "minute" : period === "days" ? "day" : period === "year" ? "year" : "month";
  return `${interval} ${unit}${interval === 1 ? "" : "s"}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getLatestPayments(payments: SubscriptionPayment[]) {
  const latest = new Map<string, SubscriptionPayment>();
  for (const payment of [...payments].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))) {
    if (!latest.has(payment.owner_user_id)) latest.set(payment.owner_user_id, payment);
  }
  return latest;
}

function buildChartData(period: Period, payments: SubscriptionPayment[], expenses: MonthlyExpense[]): ChartPoint[] {
  const now = new Date();
  const points: { key: string; label: string; start: Date }[] = [];
  const count = period === "Monthly" ? 6 : 4;

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    if (period === "Monthly") {
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      points.push({ key: monthKey(start), label: start.toLocaleDateString("en", { month: "short" }), start });
    } else if (period === "Quarterly") {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), currentQuarter * 3 - offset * 3, 1);
      const quarter = Math.floor(start.getMonth() / 3) + 1;
      points.push({ key: `${start.getFullYear()}-Q${quarter}`, label: `Q${quarter} ${String(start.getFullYear()).slice(-2)}`, start });
    } else {
      const start = new Date(now.getFullYear() - offset, 0, 1);
      points.push({ key: String(start.getFullYear()), label: String(start.getFullYear()), start });
    }
  }

  const totals = new Map(points.map((point) => [point.key, { revenue: 0, expenses: 0 }]));
  for (const payment of payments) {
    if (payment.status !== "Active") continue;
    const date = new Date(payment.occurred_at);
    const key = period === "Monthly"
      ? monthKey(date)
      : period === "Quarterly"
        ? `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
        : String(date.getFullYear());
    const total = totals.get(key);
    if (total) total.revenue += payment.amount;
  }
  for (const expense of expenses) {
    const [yearText, monthText] = expense.month.split("-");
    const date = new Date(Number(yearText), Number(monthText) - 1, 1);
    const key = period === "Monthly"
      ? expense.month
      : period === "Quarterly"
        ? `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
        : String(date.getFullYear());
    const total = totals.get(key);
    if (total) total.expenses += expense.amount;
  }

  return points.map((point) => ({
    label: point.label,
    ...(totals.get(point.key) ?? { revenue: 0, expenses: 0 }),
  }));
}

function isCurrentlyActive(owner: PharmacyOwner, latestPayment: SubscriptionPayment | undefined, now: number) {
  return owner.status === "Active"
    && latestPayment?.status === "Active"
    && (latestPayment.expires_at === null || Date.parse(latestPayment.expires_at) > now);
}

async function fetchDashboardData(): Promise<DashboardData> {
  const [subscriptionsResult, expensesResult] = await Promise.all([
    supabase.rpc("admin_get_pharmacy_subscriptions"),
    supabase.rpc("admin_get_dashboard_expenses"),
  ]);
  if (subscriptionsResult.error) throw subscriptionsResult.error;
  if (expensesResult.error) throw expensesResult.error;
  if (!isDashboardData(subscriptionsResult.data)) {
    throw new Error("The pharmacy subscription data returned by Supabase is invalid.");
  }
  if (!isMonthlyExpenses(expensesResult.data)) {
    throw new Error("The pharmacy expense data returned by Supabase is invalid.");
  }
  return {
    owners: subscriptionsResult.data.owners,
    payments: subscriptionsResult.data.payments,
    expenses: expensesResult.data,
  };
}

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<Period>("Monthly");
  const [dashboardData, setDashboardData] = useState<DashboardData>({ owners: [], payments: [], expenses: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchDashboardData()
      .then((data) => {
        if (active) setDashboardData(data);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load admin overview data.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const now = new Date();
  const currentMonth = monthKey(now);
  const latestPayments = getLatestPayments(dashboardData.payments);
  const successfulPayments = dashboardData.payments.filter((payment) => payment.status === "Active");
  const activeStores = dashboardData.owners.filter((owner) =>
    isCurrentlyActive(owner, latestPayments.get(owner.owner_user_id), now.getTime()),
  ).length;
  const expiredPayments = dashboardData.owners
    .map((owner) => ({ owner, payment: latestPayments.get(owner.owner_user_id) }))
    .filter(({ payment }) => payment?.status === "Active" && payment.expires_at !== null && Date.parse(payment.expires_at) <= now.getTime())
    .sort((left, right) => Date.parse(right.payment!.expires_at!) - Date.parse(left.payment!.expires_at!));
  const currentMonthRevenue = successfulPayments
    .filter((payment) => monthKey(new Date(payment.occurred_at)) === currentMonth)
    .reduce((total, payment) => total + payment.amount, 0);
  const currentMonthExpenses = dashboardData.expenses
    .find((expense) => expense.month === currentMonth)?.amount ?? 0;
  const accounts = successfulPayments.reduce((totals, payment) => {
    const method = payment.payment_method.trim().toLowerCase();
    if (method === "bkash") totals.bkash += payment.amount;
    if (method === "nagad") totals.nagad += payment.amount;
    return totals;
  }, { bkash: 0, nagad: 0 });
  const selectedData = buildChartData(period, dashboardData.payments, dashboardData.expenses);
  const maxValue = Math.max(1, ...selectedData.flatMap((item) => [item.revenue, item.expenses]));
  const metrics = [
    { label: "Total Pharmacy", value: dashboardData.owners.length.toLocaleString("en-BD"), note: "Registered pharmacy stores", icon: "▦", color: "#16865f", background: "#e8f7ef" },
    { label: "Monthly Subscription", value: formatAmount(currentMonthRevenue), note: "Subscription payments this month", icon: "৳", color: "#2476a5", background: "#eaf4fa" },
    { label: "Active Store", value: activeStores.toLocaleString("en-BD"), note: "Stores with a current plan", icon: "◉", color: "#9a6a11", background: "#fbf3df" },
    { label: "Expired Store", value: expiredPayments.length.toLocaleString("en-BD"), note: "Latest subscription has expired", icon: "!", color: "#ae4545", background: "#fceeee" },
    { label: "Pharmacy Cluster Expense", value: formatAmount(currentMonthExpenses), note: "Reported pharmacy expenses this month", icon: "↗", color: "#7652a5", background: "#f1edfa" },
  ];
  const displayPayments = [...successfulPayments]
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))
    .slice(0, 5);
  const displayedExpired = expiredPayments.slice(0, 5);

  return (
    <AdminDashboardShell>
      <main id="overview" style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>{now.toLocaleDateString("en-BD", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Admin overview</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#627168", fontSize: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#23a876" }} />
            Platform operational
            <span style={{ marginLeft: 8, padding: "7px 10px", border: "1px solid #e1e7e2", borderRadius: 6, background: "#fff" }}>{now.toLocaleDateString("en", { month: "long", year: "numeric" })}</span>
          </div>
        </div>

        {error && <p role="alert" style={{ margin: "0 0 16px", padding: "11px 13px", border: "1px solid #f0c7c4", borderRadius: 7, background: "#fff4f3", color: "#9b3630", fontSize: 12 }}>{error}</p>}

        <section aria-label="Platform metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12, marginBottom: 18 }}>
          {metrics.map((metric) => (
            <article key={metric.label} style={{ minWidth: 0, minHeight: 112, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#68776f", fontSize: 11, fontWeight: 550 }}>{metric.label}</span>
                <span style={{ width: 25, height: 25, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 6, background: metric.background, color: metric.color, fontSize: 13, fontWeight: 700 }}>{metric.icon}</span>
              </div>
              <div style={{ marginTop: 11, color: "#203128", fontSize: 20, fontWeight: 720 }}>{isLoading ? "—" : error ? "—" : metric.value}</div>
              <div style={{ marginTop: 4, color: "#89958e", fontSize: 10 }}>{isLoading ? "Loading..." : metric.note}</div>
            </article>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(260px, 0.9fr)", gap: 14, marginBottom: 18 }}>
          <article id="analytics" style={{ ...panelStyle, padding: "16px 18px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Revenue &amp; operating costs</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Live subscription payments and pharmacy expense reports</p>
              </div>
              <div aria-label="Chart period" style={{ display: "inline-flex", padding: 3, borderRadius: 6, background: "#f1f4f1", gap: 2 }}>
                {periods.map((option) => (
                  <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)} style={{ border: 0, borderRadius: 4, padding: "6px 9px", background: period === option ? "#fff" : "transparent", color: period === option ? "#226d4e" : "#718078", boxShadow: period === option ? "0 1px 3px rgba(20,40,28,0.12)" : "none", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>{option}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 16, color: "#68776f", fontSize: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#27a879" }} />Revenue</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#9ccfba" }} />Operating costs</span>
            </div>
            <div aria-label={`${period} revenue and operating costs bar chart`} role="img" style={{ height: 166, display: "flex", alignItems: "stretch", gap: 8, marginTop: 6, padding: "8px 4px 0", borderBottom: "1px solid #edf0ed", backgroundImage: "linear-gradient(to bottom, transparent 32%, #f0f3f0 32%, #f0f3f0 33%, transparent 33%, transparent 65%, #f0f3f0 65%, #f0f3f0 66%, transparent 66%)" }}>
              {selectedData.map((item) => (
                <div key={item.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
                  <div style={{ width: "100%", height: 132, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
                    <div title={`Revenue ${formatAmount(item.revenue)}`} style={{ width: "min(24px, 38%)", height: `${Math.max(4, (item.revenue / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#27a879" }} />
                    <div title={`Operating costs ${formatAmount(item.expenses)}`} style={{ width: "min(24px, 38%)", height: `${Math.max(4, (item.expenses / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#9ccfba" }} />
                  </div>
                  <span style={{ minHeight: 16, color: "#87938c", fontSize: 9, whiteSpace: "nowrap" }}>{item.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article style={{ ...panelStyle, padding: "16px 18px" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Accounts</h2>
            <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Subscription payments received by account</p>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { name: "bKash", amount: accounts.bkash, color: "#d84a78", background: "#fff0f5" },
                { name: "Nagad", amount: accounts.nagad, color: "#e56a35", background: "#fff3ec" },
              ].map((account) => (
                <div key={account.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 11px", border: "1px solid #edf0ed", borderRadius: 7 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#34453b", fontSize: 11, fontWeight: 650 }}>
                    <i style={{ width: 8, height: 8, borderRadius: "50%", background: account.color }} />
                    {account.name}
                  </span>
                  <strong style={{ color: account.color, fontSize: 14, fontWeight: 750 }}>{isLoading || error ? "—" : formatAmount(account.amount)}</strong>
                </div>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", color: "#89958e", fontSize: 10 }}>Total recorded subscription payments</p>
          </article>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(260px, 1fr)", gap: 14 }}>
          <article id="pharmacies" style={{ ...panelStyle, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <div>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Latest plan purchases</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Most recent subscription payments</p>
              </div>
              <span style={{ color: "#267451", fontSize: 10, fontWeight: 650 }}>{isLoading ? "Loading..." : `${dashboardData.owners.length} pharmacies`}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Store & owner", "Payment method", "Package", "Duration", "Paid", "Purchase date"].map((column) => (
                      <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0" }}>
                        <strong style={{ display: "block", color: "#26372f", fontSize: 11, fontWeight: 650 }}>{payment.pharmacy_name}</strong>
                        <span style={{ display: "block", marginTop: 3, color: "#849188", fontSize: 10 }}>{payment.full_name || "Owner name not provided"}</span>
                      </td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#43534a", fontSize: 10, whiteSpace: "nowrap" }}>{payment.payment_method || "—"}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#43534a", fontSize: 10, whiteSpace: "nowrap" }}>{payment.plan_name}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#43534a", fontSize: 10, whiteSpace: "nowrap" }}>{periodDescription(payment.billing_period, payment.billing_interval)}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{formatAmount(payment.amount)}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 10, whiteSpace: "nowrap" }}>{new Date(payment.occurred_at).toLocaleDateString("en-BD")}</td>
                    </tr>
                  ))}
                  {!isLoading && !error && displayPayments.length === 0 && <tr><td colSpan={6} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>No subscription payments have been recorded yet.</td></tr>}
                  {isLoading && <tr><td colSpan={6} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>Loading recent plan purchases...</td></tr>}
                </tbody>
              </table>
            </div>
          </article>

          <article id="activity" style={{ ...panelStyle, padding: "16px 18px" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Recent activity</h2>
            <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Recently expired pharmacy plans</p>
            <div style={{ display: "grid" }}>
              {displayedExpired.map(({ owner, payment }, index) => payment && (
                <div key={owner.owner_user_id} style={{ display: "flex", gap: 10, padding: "11px 0", borderBottom: index === displayedExpired.length - 1 ? 0 : "1px solid #f0f2f0" }}>
                  <span style={{ width: 8, height: 8, marginTop: 4, flex: "0 0 auto", borderRadius: "50%", background: "#d36b61" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#34453b", fontSize: 10, fontWeight: 650 }}>{owner.pharmacy_name} · {owner.full_name || "Owner name not provided"}</div>
                    <div style={{ marginTop: 4, color: "#7a8981", fontSize: 9 }}>{payment.plan_name} · Expired {new Date(payment.expires_at!).toLocaleDateString("en-BD")}</div>
                  </div>
                </div>
              ))}
              {!isLoading && !error && displayedExpired.length === 0 && <p style={{ margin: 0, padding: "12px 0", color: "#87928d", fontSize: 11 }}>No expired pharmacy plans to show.</p>}
              {isLoading && <p style={{ margin: 0, padding: "12px 0", color: "#87928d", fontSize: 11 }}>Loading expired plans...</p>}
            </div>
          </article>
        </section>
      </main>
    </AdminDashboardShell>
  );
}
