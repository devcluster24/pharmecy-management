'use client';

import { useState } from "react";
import Sidebar from "../components/Sidebar";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";

const metrics = [
  { label: "Today's Sales", value: "৳24,580", note: "+8.4% vs yesterday", icon: "↗", color: "#16865f", background: "#e8f7ef" },
  { label: "Today's Purchase", value: "৳12,840", note: "8 purchase orders", icon: "↙", color: "#2476a5", background: "#eaf4fa" },
  { label: "Gross Profit", value: "৳6,240", note: "25.4% gross margin", icon: "⌁", color: "#9a6a11", background: "#fbf3df" },
  { label: "Due Collection", value: "৳8,750", note: "12 customers due", icon: "৳", color: "#9a5411", background: "#fff0e1" },
  { label: "Total Stock Value", value: "৳8,42,600", note: "1,248 products", icon: "▤", color: "#6254a0", background: "#f0edfa" },
  { label: "Low Stock", value: "18 items", note: "Restock recommended", icon: "!", color: "#a15c12", background: "#fff2e5" },
  { label: "Near Expiry", value: "7 items", note: "Expiring within 90 days", icon: "◷", color: "#a15c12", background: "#fff2e5" },
  { label: "Expired Stock", value: "2 items", note: "Remove from sale", icon: "×", color: "#ae4545", background: "#fceeee" },
];

const periods = ["Daily", "Weekly", "Monthly"] as const;
type Period = (typeof periods)[number];

const chartData: Record<Period, { label: string; sales: number; purchases: number }[]> = {
  Daily: [
    { label: "8 AM", sales: 22, purchases: 11 },
    { label: "10 AM", sales: 48, purchases: 22 },
    { label: "12 PM", sales: 37, purchases: 16 },
    { label: "2 PM", sales: 66, purchases: 30 },
    { label: "4 PM", sales: 52, purchases: 18 },
    { label: "6 PM", sales: 86, purchases: 34 },
    { label: "8 PM", sales: 72, purchases: 20 },
  ],
  Weekly: [
    { label: "Mon", sales: 42, purchases: 28 },
    { label: "Tue", sales: 58, purchases: 34 },
    { label: "Wed", sales: 49, purchases: 25 },
    { label: "Thu", sales: 74, purchases: 38 },
    { label: "Fri", sales: 65, purchases: 31 },
    { label: "Sat", sales: 90, purchases: 45 },
    { label: "Sun", sales: 54, purchases: 20 },
  ],
  Monthly: [
    { label: "Week 1", sales: 52, purchases: 35 },
    { label: "Week 2", sales: 68, purchases: 40 },
    { label: "Week 3", sales: 59, purchases: 28 },
    { label: "Week 4", sales: 88, purchases: 44 },
  ],
};

const fastMovingProducts = [
  ["Napa 500mg", "Beximco", "184 packs", "৳2,208"],
  ["Seclo 20mg", "Square", "126 strips", "৳1,008"],
  ["Ace 500mg", "Square", "98 packs", "৳1,176"],
  ["Ceevit 250mg", "Square", "84 strips", "৳840"],
];

const deadStock = [
  ["Doxiva 200mg", "32 units", "148 days", "৳1,920"],
  ["Antazol eye drops", "14 units", "121 days", "৳1,260"],
  ["Calbo-D", "26 units", "96 days", "৳2,340"],
  ["Amodis 400mg", "18 units", "82 days", "৳1,080"],
];

function ProductTable({
  title,
  subtitle,
  columns,
  rows,
}: {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
        <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>{title}</h2>
        <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>{subtitle}</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 430, borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} style={{ padding: "10px 14px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={cell} style={{ padding: "12px 14px", borderBottom: "1px solid #f0f2f0", color: index === 0 ? "#26372f" : "#64736b", fontSize: 11, fontWeight: index === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 14px", color: "#87938c", fontSize: 10 }}>Showing {rows.length} products</div>
    </section>
  );
}

export default function OverviewPage() {
  const [period, setPeriod] = useState<Period>("Daily");
  const selectedData = chartData[period];
  const maxValue = Math.max(...selectedData.flatMap((item) => [item.sales, item.purchases]));

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7f5", color: "#1f2d26", fontFamily: "Inter, Arial, sans-serif" }}>
      <header style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e6ebe7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "#2ad49a", color: "#07372b", fontSize: 14 }}>✚</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Pharmecy Cluster</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#66756d", fontSize: 12 }}>
          <span>Green Valley Pharmacy</span>
          <PharmacyProfileMenu />
        </div>
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
            <div>
              <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Wednesday, September 30, 2026</div>
              <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Overview</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#627168", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#23a876" }} />
              Store open
              <span style={{ marginLeft: 8, padding: "7px 10px", border: "1px solid #e1e7e2", borderRadius: 6, background: "#fff" }}>Today ▾</span>
            </div>
          </div>

          <section aria-label="Today's business metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 18 }}>
            {metrics.map((metric) => (
              <article key={metric.label} style={{ minWidth: 0, minHeight: 112, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "#68776f", fontSize: 11, fontWeight: 550 }}>{metric.label}</span>
                  <span style={{ width: 25, height: 25, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 6, background: metric.background, color: metric.color, fontSize: 13, fontWeight: 700 }}>{metric.icon}</span>
                </div>
                <div style={{ marginTop: 11, color: "#203128", fontSize: 20, fontWeight: 720 }}>{metric.value}</div>
                <div style={{ marginTop: 4, color: metric.label === "Expired Stock" || metric.label === "Low Stock" ? "#a15c12" : "#89958e", fontSize: 10 }}>{metric.note}</div>
              </article>
            ))}
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(250px, 0.9fr)", gap: 14, marginBottom: 18 }}>
            <article style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", padding: "16px 18px 12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Sales &amp; Purchase</h2>
                  <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Compare revenue and purchase spend</p>
                </div>
                <div aria-label="Chart period" style={{ display: "inline-flex", padding: 3, borderRadius: 6, background: "#f1f4f1", gap: 2 }}>
                  {periods.map((option) => (
                    <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)} style={{ border: 0, borderRadius: 4, padding: "6px 9px", background: period === option ? "#fff" : "transparent", color: period === option ? "#226d4e" : "#718078", boxShadow: period === option ? "0 1px 3px rgba(20,40,28,0.12)" : "none", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>{option}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 16, color: "#68776f", fontSize: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#27a879" }} />Sales</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#9ccfba" }} />Purchase</span>
              </div>
              <div aria-label={`${period} sales and purchase bar chart`} role="img" style={{ height: 158, display: "flex", alignItems: "stretch", gap: 8, marginTop: 6, padding: "8px 4px 0", borderBottom: "1px solid #edf0ed", backgroundImage: "linear-gradient(to bottom, transparent 32%, #f0f3f0 32%, #f0f3f0 33%, transparent 33%, transparent 65%, #f0f3f0 65%, #f0f3f0 66%, transparent 66%)" }}>
                {selectedData.map((item) => (
                  <div key={item.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
                    <div style={{ width: "100%", height: 124, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
                      <div title={`Sales ${item.sales}`} style={{ width: "min(22px, 38%)", height: `${Math.max(8, (item.sales / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#27a879" }} />
                      <div title={`Purchase ${item.purchases}`} style={{ width: "min(22px, 38%)", height: `${Math.max(8, (item.purchases / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#9ccfba" }} />
                    </div>
                    <span style={{ minHeight: 16, color: "#87938c", fontSize: 9, whiteSpace: "nowrap" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </article>

            <article style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", padding: "16px 18px" }}>
              <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Cash position</h2>
              <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Available balances across payment methods</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, paddingBottom: 15, borderBottom: "1px solid #edf0ed" }}>
                <span style={{ color: "#203128", fontSize: 27, fontWeight: 750 }}>৳86,450</span>
                <span style={{ color: "#849188", fontSize: 10 }}>total</span>
              </div>
              <div style={{ display: "grid", gap: 13, paddingTop: 15 }}>
                {[
                  { name: "Cash in drawer", amount: "৳48,250", color: "#27a879" },
                  { name: "bKash", amount: "৳22,600", color: "#dc6695" },
                  { name: "Bank & card", amount: "৳15,600", color: "#4387ad" },
                ].map((item) => (
                  <div key={item.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#65746b" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />{item.name}</span>
                    <strong style={{ color: "#293a30", fontWeight: 650 }}>{item.amount}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 390px), 1fr))", gap: 14 }}>
            <ProductTable title="Fast-moving products" subtitle="Top products by units sold today" columns={["Product", "Brand", "Units sold", "Sales"]} rows={fastMovingProducts} />
            <ProductTable title="Dead stock" subtitle="No sales recorded in the last 60 days" columns={["Product", "On hand", "No sale for", "Stock value"]} rows={deadStock} />
          </section>
        </main>
      </div>
    </div>
  );
}