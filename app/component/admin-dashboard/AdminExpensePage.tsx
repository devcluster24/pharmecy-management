"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import AdminDashboardShell from "./AdminDashboardShell";
import { supabase } from "@/lib/supabase/client";

type OperatingExpense = {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string;
  created_at: string;
};

const expenseCategories = [
  "Rent",
  "Salary",
  "Electricity",
  "Utilities",
  "Transport",
  "Maintenance",
  "Office supplies",
  "Marketing",
  "Software",
  "Other",
];
const paymentMethods = ["Cash", "Bank transfer", "bKash", "Nagad", "Card", "Other"];
const panelStyle = {
  minWidth: 0,
  border: "1px solid #e3e9e4",
  borderRadius: 8,
  background: "#fff",
} as const;
const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "9px 10px",
  fontSize: 12,
} as const;

function getToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatAmount(amount: number) {
  return `৳ ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("en-BD") : date;
}

function isExpense(value: unknown): value is OperatingExpense {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
    && typeof row.category === "string"
    && typeof row.description === "string"
    && typeof row.amount === "number"
    && Number.isFinite(row.amount)
    && typeof row.payment_method === "string"
    && typeof row.created_at === "string";
}

async function loadOperatingExpenses() {
  const { data, error } = await supabase.rpc("admin_get_operating_expenses");
  if (error) throw error;
  if (!Array.isArray(data) || !data.every(isExpense)) {
    throw new Error("The admin expense data returned by Supabase is invalid.");
  }
  return data;
}

function buildLastSixMonths(expenses: OperatingExpense[]) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: monthKey(date),
      label: date.toLocaleDateString("en-BD", { month: "short", year: "numeric" }),
      amount: 0,
    };
  });
  const totals = new Map(months.map((month) => [month.key, month]));
  for (const expense of expenses) {
    const month = totals.get(expense.date.slice(0, 7));
    if (month) month.amount += expense.amount;
  }
  return months;
}

export default function AdminExpensePage() {
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [date, setDate] = useState(getToday);
  const [category, setCategory] = useState(expenseCategories[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadOperatingExpenses()
      .then((rows) => {
        if (active) setExpenses(rows);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load admin expenses.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const monthlyExpenses = useMemo(() => buildLastSixMonths(expenses), [expenses]);
  const totalExpense = expenses.reduce((total, expense) => total + expense.amount, 0);
  const thisMonthExpense = expenses
    .filter((expense) => expense.date.startsWith(monthKey(new Date())))
    .reduce((total, expense) => total + expense.amount, 0);
  const lastSixMonthsExpense = monthlyExpenses.reduce((total, month) => total + month.amount, 0);
  const maxMonthAmount = Math.max(1, ...monthlyExpenses.map((month) => month.amount));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const numericAmount = Number(amount);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Select a valid expense date.");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!description.trim()) {
      setError("Enter an expense description.");
      return;
    }

    setIsSaving(true);
    try {
      const { error: saveError } = await supabase.rpc("admin_add_operating_expense", {
        requested_date: date,
        requested_category: category,
        requested_description: description.trim(),
        requested_amount: numericAmount,
        requested_payment_method: paymentMethod,
      });
      if (saveError) throw saveError;
      const refreshedExpenses = await loadOperatingExpenses();
      setExpenses(refreshedExpenses);
      setDate(getToday());
      setCategory(expenseCategories[0]);
      setDescription("");
      setAmount("");
      setPaymentMethod(paymentMethods[0]);
      setMessage("Expense added successfully.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this expense.");
    } finally {
      setIsSaving(false);
    }
  }

  const sortedExpenses = [...expenses].sort((left, right) =>
    right.date.localeCompare(left.date) || right.created_at.localeCompare(left.created_at),
  );

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Pharmacy Cluster Expense</h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>Record and review platform operating expenses.</p>
        </div>

        {error && <p role="alert" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #f0c7c4", borderRadius: 7, background: "#fff4f3", color: "#9b3630", fontSize: 12 }}>{error}</p>}
        {message && <p role="status" style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid #cce8d8", borderRadius: 7, background: "#f1faf5", color: "#267451", fontSize: 12 }}>{message}</p>}

        <section aria-label="Expense totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[
            { label: "Total Expense", value: totalExpense, detail: "All recorded operating expenses", color: "#16865f", background: "#e8f7ef" },
            { label: "This month expense", value: thisMonthExpense, detail: "Expenses recorded this month", color: "#2476a5", background: "#eaf4fa" },
            { label: "Last 6 month Expense", value: lastSixMonthsExpense, detail: "Current month and previous five months", color: "#9a6a11", background: "#fbf3df" },
          ].map((metric) => (
            <article key={metric.label} style={{ ...panelStyle, minHeight: 108, display: "grid", alignContent: "space-between", gap: 10, padding: "14px 15px" }}>
              <span style={{ color: "#68776f", fontSize: 11 }}>{metric.label}</span>
              <strong style={{ color: metric.color, fontSize: 20 }}>{isLoading ? "—" : formatAmount(metric.value)}</strong>
              <span style={{ color: "#89958e", fontSize: 10 }}>{metric.detail}</span>
            </article>
          ))}
        </section>

        <section style={{ ...panelStyle, marginBottom: 18, padding: 16 }}>
          <h2 style={{ margin: "0 0 14px", color: "#26352f", fontSize: 15, fontWeight: 700 }}>Add expense</h2>
          <form onSubmit={(event) => void handleSubmit(event)} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", alignItems: "end", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Date
              <input aria-label="Expense date" type="date" required value={date} onChange={(event) => setDate(event.currentTarget.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Category
              <select aria-label="Expense category" value={category} onChange={(event) => setCategory(event.currentTarget.value)} style={inputStyle}>
                {expenseCategories.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Description
              <input aria-label="Expense description" required maxLength={160} value={description} onChange={(event) => setDescription(event.currentTarget.value)} style={inputStyle} placeholder="Expense details" />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Amount (৳)
              <input aria-label="Expense amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.currentTarget.value)} style={inputStyle} placeholder="0.00" />
            </label>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Payment method
              <select aria-label="Expense payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.currentTarget.value)} style={inputStyle}>
                {paymentMethods.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <button type="submit" disabled={isSaving} style={{ minHeight: 36, padding: "8px 14px", border: 0, borderRadius: 6, background: "#18845d", color: "#fff", fontSize: 12, fontWeight: 700, cursor: isSaving ? "wait" : "pointer", opacity: isSaving ? 0.65 : 1 }}>
              {isSaving ? "Saving..." : "Add expense"}
            </button>
          </form>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.9fr)", gap: 14 }}>
          <article style={{ ...panelStyle, overflow: "hidden" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Expense list</h2>
              <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>All Pharmacy Cluster expenses</p>
            </div>
            <div style={{ maxHeight: 470, overflow: "auto" }}>
              <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", textAlign: "left" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>{["Date", "Category", "Description", "Payment method", "Amount"].map((column) => <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {sortedExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 10, whiteSpace: "nowrap" }}>{formatDate(expense.date)}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 10, whiteSpace: "nowrap" }}>{expense.category}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 10 }}>{expense.description}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#526158", fontSize: 10, whiteSpace: "nowrap" }}>{expense.payment_method}</td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{formatAmount(expense.amount)}</td>
                    </tr>
                  ))}
                  {!isLoading && expenses.length === 0 && <tr><td colSpan={5} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>No expenses have been recorded yet.</td></tr>}
                  {isLoading && <tr><td colSpan={5} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>Loading expenses...</td></tr>}
                </tbody>
              </table>
            </div>
          </article>

          <article style={{ ...panelStyle, padding: "16px 18px" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Monthly expense</h2>
            <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Expense totals by month · last six months</p>
            <div style={{ display: "grid", gap: 14 }}>
              {monthlyExpenses.map((month) => (
                <div key={month.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, color: "#526158", fontSize: 10 }}>
                    <span>{month.label}</span>
                    <strong style={{ color: "#26372f", fontWeight: 650 }}>{formatAmount(month.amount)}</strong>
                  </div>
                  <div role="img" aria-label={`${month.label}: ${formatAmount(month.amount)}`} style={{ height: 8, overflow: "hidden", borderRadius: 8, background: "#edf2ee" }}>
                    <div style={{ width: `${month.amount === 0 ? 0 : Math.max(2, (month.amount / maxMonthAmount) * 100)}%`, height: "100%", borderRadius: 8, background: "#27a879", transition: "width 0.2s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </AdminDashboardShell>
  );
}
