"use client";

import { useState } from "react";
import AdminDashboardShell from "./AdminDashboardShell";

type Subscription = {
  id: number;
  pharmacy: string;
  plan: string;
  renewalDate: string;
  amount: string;
  status: "Active" | "Past due";
};

const initialSubscriptions: Subscription[] = [
  { id: 1, pharmacy: "Green Valley Pharmacy", plan: "Business", renewalDate: "2026-10-18", amount: "5000", status: "Active" },
  { id: 2, pharmacy: "Care Point Pharmacy", plan: "Growth", renewalDate: "2026-10-12", amount: "3500", status: "Active" },
  { id: 3, pharmacy: "LifeLine Medical Hall", plan: "Starter", renewalDate: "2026-10-08", amount: "1500", status: "Past due" },
  { id: 4, pharmacy: "City Drug House", plan: "Business", renewalDate: "2026-10-24", amount: "5000", status: "Active" },
];

const inputStyle = { width: "100%", minWidth: 100, padding: "7px 8px", border: "1px solid #dce4de", borderRadius: 5, background: "#fff", color: "#34453b", fontSize: 10 } as const;
const buttonStyle = { padding: "6px 9px", border: "1px solid #dce4de", borderRadius: 5, background: "#fff", color: "#267451", fontSize: 10, fontWeight: 650, cursor: "pointer" } as const;

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

export default function SubscriptionPage() {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [editing, setEditing] = useState<Subscription | null>(null);

  function saveSubscription() {
    if (!editing) return;
    setSubscriptions((current) => current.map((item) => item.id === editing.id ? editing : item));
    setEditing(null);
  }

  return (
    <AdminDashboardShell>
      <main style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Admin workspace</div>
          <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Subscription</h1>
          <p style={{ margin: "7px 0 0", color: "#78867f", fontSize: 12 }}>Plans, renewals and pharmacy billing</p>
        </div>

        <section aria-label="Subscription metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[["Monthly recurring revenue", "৳4,86,000"], ["Active subscriptions", "112"], ["Renewals due", "9"], ["Past due", "3"]].map(([label, value]) => (
            <article key={label} style={{ minHeight: 95, display: "grid", alignContent: "space-between", gap: 12, padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
              <span style={{ color: "#68776f", fontSize: 11 }}>{label}</span>
              <strong style={{ color: "#203128", fontSize: 20 }}>{value}</strong>
            </article>
          ))}</section>

        <section style={{ border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Pharmacy subscriptions</h2>
            <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Select Edit to update a plan, renewal, amount or status</p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr>{["Pharmacy", "Plan", "Renewal date", "Amount (৳)", "Status", "Actions"].map((column) => <th key={column} style={{ padding: "10px 12px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>)}</tr></thead>
              <tbody>
                {subscriptions.map((item) => {
                  const isEditing = editing?.id === item.id;
                  const current = isEditing ? editing : item;
                  return (
                    <tr key={item.id}>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", color: "#26372f", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{item.pharmacy}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>{isEditing ? <select aria-label="Plan" value={current.plan} onChange={(event) => setEditing({ ...current, plan: event.target.value })} style={inputStyle}><option>Starter</option><option>Growth</option><option>Business</option></select> : <span style={{ color: "#64736b", fontSize: 11 }}>{item.plan}</span>}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>{isEditing ? <input aria-label="Renewal date" type="date" value={current.renewalDate} onChange={(event) => setEditing({ ...current, renewalDate: event.target.value })} style={inputStyle} /> : <span style={{ color: "#64736b", fontSize: 11, whiteSpace: "nowrap" }}>{formatDate(item.renewalDate)}</span>}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>{isEditing ? <input aria-label="Amount" type="number" min="0" value={current.amount} onChange={(event) => setEditing({ ...current, amount: event.target.value })} style={inputStyle} /> : <span style={{ color: "#64736b", fontSize: 11 }}>৳{Number(item.amount).toLocaleString("en-BD")}</span>}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0" }}>{isEditing ? <select aria-label="Status" value={current.status} onChange={(event) => setEditing({ ...current, status: event.target.value as Subscription["status"] })} style={inputStyle}><option>Active</option><option>Past due</option></select> : <span style={{ color: item.status === "Active" ? "#267451" : "#a15c12", fontSize: 10, fontWeight: 650 }}>{item.status}</span>}</td>
                      <td style={{ padding: "12px", borderBottom: "1px solid #f0f2f0", whiteSpace: "nowrap" }}>{isEditing ? <span style={{ display: "inline-flex", gap: 5 }}><button type="button" onClick={saveSubscription} style={buttonStyle}>Save</button><button type="button" onClick={() => setEditing(null)} style={{ ...buttonStyle, color: "#66756d" }}>Cancel</button></span> : <button type="button" onClick={() => setEditing({ ...item })} style={buttonStyle}>Edit</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AdminDashboardShell>
  );
}