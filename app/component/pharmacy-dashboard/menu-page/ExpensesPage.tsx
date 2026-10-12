"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import { confirmDelete } from "@/lib/confirmDelete";
import {
  addExpense,
  deleteExpense,
  emptyExpensesSnapshot,
  getExpensesSnapshot,
  subscribeToExpenses,
  type ExpenseRecord,
} from "./expensesStorage";
import {
  emptyPaymentMethodsSnapshot,
  getPaymentMethodsSnapshot,
  subscribeToPaymentMethods,
} from "./paymentMethodsStorage";

const EXPENSES_PER_PAGE = 10;
const expenseCategories = [
  "Rent",
  "Salary",
  "Electricity",
  "Utilities",
  "Transport",
  "Maintenance",
  "Office supplies",
  "Other",
];
const pageData: SectionData = {
  description: "Record and review day-to-day pharmacy expenses.",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #dce5df",
  borderRadius: 6,
  background: "#fff",
  color: "#26352f",
  padding: "9px 10px",
  fontSize: 12,
};

function todayInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatExpenseDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("en-BD") : date;
}

export default function ExpensesPage() {
  const expenses = useSyncExternalStore(
    subscribeToExpenses,
    getExpensesSnapshot,
    () => emptyExpensesSnapshot,
  );
  const paymentMethodsSnapshot = useSyncExternalStore(
    subscribeToPaymentMethods,
    getPaymentMethodsSnapshot,
    () => emptyPaymentMethodsSnapshot,
  );
  const [date, setDate] = useState(todayInputValue);
  const [category, setCategory] = useState(expenseCategories[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const paymentMethodOptions = [
    { value: "cash", label: "Cash" },
    ...paymentMethodsSnapshot.rows.map((method) => ({
      value: `${method.type}:${method.id}`,
      label: method.type === "mobile" ? method.name : method.bankName,
    })),
  ];
  const effectivePaymentMethod = paymentMethodOptions.some((option) => option.value === paymentMethod)
    ? paymentMethod
    : "cash";

  const currentMonth = todayInputValue().slice(0, 7);
  const monthlyTotal = expenses.rows
    .filter((expense) => expense.date.startsWith(currentMonth))
    .reduce((total, expense) => total + expense.amount, 0);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredExpenses = useMemo(() => expenses.rows
    .filter((expense) => !normalizedSearch || [
      expense.date,
      expense.category,
      expense.description,
      expense.paymentMethod,
      String(expense.amount),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)),
  [expenses.rows, normalizedSearch]);
  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const visibleExpenses = filteredExpenses.slice(
    (safePage - 1) * EXPENSES_PER_PAGE,
    safePage * EXPENSES_PER_PAGE,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setActionError("");
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    try {
      const paymentMethodName = paymentMethodOptions.find((option) => option.value === effectivePaymentMethod)?.label ?? "Cash";
      addExpense({ date, category, description, amount: parsedAmount, paymentMethod: paymentMethodName });
      setDate(todayInputValue());
      setCategory(expenseCategories[0]);
      setDescription("");
      setAmount("");
      setPaymentMethod("cash");
      setCurrentPage(1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this expense.");
    }
  }

  async function handleDelete(expense: ExpenseRecord) {
    if (!await confirmDelete(`Delete the expense "${expense.description}"?`)) return;
    setActionError("");
    try {
      deleteExpense(expense.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this expense.");
    }
  }

  return (
    <DashboardSectionPage
      sectionSlug="expenses"
      data={pageData}
      hideAction
      content={(
        <div style={{ display: "grid", gap: 18 }}>
          {(expenses.error || paymentMethodsSnapshot.error) && (
            <p role="alert" style={{ margin: 0, color: "#ad4b43", fontSize: 12 }}>
              {[expenses.error, paymentMethodsSnapshot.error].filter(Boolean).join(" ")}
            </p>
          )}
          <section aria-label="Expense totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              { label: "This month", value: formatCurrency(monthlyTotal), detail: "Expenses recorded in the current month" },
              { label: "All expenses", value: String(expenses.rows.length), detail: "Total saved expense records" },
            ].map((metric) => (
              <article key={metric.label} style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", padding: "15px 17px" }}>
                <div style={{ color: "#687871", fontSize: 11 }}>{metric.label}</div>
                <div style={{ marginTop: 7, color: "#172622", fontSize: 21, fontWeight: 700 }}>{metric.value}</div>
                <div style={{ marginTop: 4, color: "#85918c", fontSize: 10 }}>{metric.detail}</div>
              </article>
            ))}
          </section>

          <section style={{ border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff", padding: 16 }}>
            <h2 style={{ margin: "0 0 14px", color: "#26352f", fontSize: 15 }}>Add expense</h2>
            <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", alignItems: "end", gap: 12 }}>
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
                <input aria-label="Expense description" required maxLength={160} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="e.g. Shop rent" style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
                Amount
                <input aria-label="Expense amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
                Payment method
                <select aria-label="Expense payment method" value={effectivePaymentMethod} onChange={(event) => setPaymentMethod(event.currentTarget.value)} style={inputStyle}>
                  {paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button type="submit" style={{ minHeight: 36, border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 14px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>Save expense</button>
            </form>
            {formError && <p role="alert" style={{ margin: "11px 0 0", color: "#ad4b43", fontSize: 11 }}>{formError}</p>}
          </section>

          <section style={{ overflow: "hidden", border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
            <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid #edf0ed" }}>
              <div>
                <h2 style={{ margin: 0, color: "#26352f", fontSize: 15 }}>Expense list</h2>
                <p style={{ margin: "4px 0 0", color: "#77857d", fontSize: 10 }}>Search by date, category, description, payment method, or amount.</p>
              </div>
              <input aria-label="Search expenses" value={search} onChange={(event) => { setSearch(event.currentTarget.value); setCurrentPage(1); }} placeholder="Search expenses..." style={{ ...inputStyle, width: 240, maxWidth: "100%" }} />
            </header>
            {actionError && <p role="alert" style={{ margin: 0, padding: "10px 16px", color: "#ad4b43", fontSize: 11 }}>{actionError}</p>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>{["Date", "Category", "Description", "Payment method", "Amount", "Action"].map((column) => <th key={column} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {visibleExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11, whiteSpace: "nowrap" }}>{formatExpenseDate(expense.date)}</td>
                      <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11 }}>{expense.category}</td>
                      <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11 }}>{expense.description}</td>
                      <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11 }}>{expense.paymentMethod}</td>
                      <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#26352f", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{formatCurrency(expense.amount)}</td>
                      <td style={{ padding: "8px 13px", borderBottom: "1px solid #f0f2f0" }}>
                        <button type="button" onClick={() => handleDelete(expense)} aria-label={`Delete expense ${expense.description}`} style={{ border: "1px solid #f0d5d3", borderRadius: 5, background: "#fff", color: "#ad4b43", padding: "6px 8px", fontSize: 10, cursor: "pointer" }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {visibleExpenses.length === 0 && <tr><td colSpan={6} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>{normalizedSearch ? "No expenses match this search." : "No expenses have been added yet."}</td></tr>}
                </tbody>
              </table>
            </div>
            <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 13px", color: "#87928d", fontSize: 10 }}>
              <span>{filteredExpenses.length === 0 ? "Showing 0 expenses" : `Showing ${(safePage - 1) * EXPENSES_PER_PAGE + 1}-${Math.min(safePage * EXPENSES_PER_PAGE, filteredExpenses.length)} of ${filteredExpenses.length} expenses`}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <button type="button" disabled={safePage <= 1} onClick={() => setCurrentPage(safePage - 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "5px 8px", fontSize: 10, cursor: safePage <= 1 ? "not-allowed" : "pointer", opacity: safePage <= 1 ? 0.5 : 1 }}>Previous</button>
                <span>Page {safePage} of {totalPages}</span>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setCurrentPage(safePage + 1)} style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#34453b", padding: "5px 8px", fontSize: 10, cursor: safePage >= totalPages ? "not-allowed" : "pointer", opacity: safePage >= totalPages ? 0.5 : 1 }}>Next</button>
              </div>
            </footer>
          </section>
        </div>
      )}
    />
  );
}
