"use client";

import { useState } from "react";
import AdminDashboardShell from "./AdminDashboardShell";

const metrics = [
  { label: "Total pharmacies", value: "128", note: "+12 this month", icon: "▦", color: "#16865f", background: "#e8f7ef" },
  { label: "Monthly revenue", value: "৳18,42,650", note: "+8.6% from last month", icon: "৳", color: "#2476a5", background: "#eaf4fa" },
  { label: "Active staff", value: "486", note: "Across all pharmacies", icon: "◉", color: "#9a6a11", background: "#fbf3df" },
  { label: "Pending requests", value: "7", note: "Needs your attention", icon: "!", color: "#ae4545", background: "#fceeee" },
];

const periods = ["Monthly", "Quarterly", "Yearly"] as const;
type Period = (typeof periods)[number];

const revenueData: Record<Period, { label: string; revenue: number; expenses: number }[]> = {
  Monthly: [
    { label: "May", revenue: 48, expenses: 31 },
    { label: "Jun", revenue: 62, expenses: 38 },
    { label: "Jul", revenue: 55, expenses: 35 },
    { label: "Aug", revenue: 76, expenses: 48 },
    { label: "Sep", revenue: 68, expenses: 42 },
    { label: "Oct", revenue: 91, expenses: 54 },
  ],
  Quarterly: [
    { label: "Q1", revenue: 58, expenses: 39 },
    { label: "Q2", revenue: 69, expenses: 43 },
    { label: "Q3", revenue: 82, expenses: 51 },
    { label: "Q4", revenue: 91, expenses: 54 },
  ],
  Yearly: [
    { label: "2022", revenue: 45, expenses: 34 },
    { label: "2023", revenue: 61, expenses: 40 },
    { label: "2024", revenue: 73, expenses: 47 },
    { label: "2025", revenue: 91, expenses: 54 },
  ],
};

const pharmacies = [
  { name: "Green Valley Pharmacy", location: "Dhaka · Dhanmondi", sales: "৳3,42,800", status: "Active", initials: "GV", color: "#e7f5ed" },
  { name: "Care Point Pharmacy", location: "Chattogram · Agrabad", sales: "৳2,86,450", status: "Active", initials: "CP", color: "#eaf3f8" },
  { name: "LifeLine Medical Hall", location: "Sylhet · Zindabazar", sales: "৳1,94,200", status: "Review", initials: "LL", color: "#fff2df" },
  { name: "City Drug House", location: "Rajshahi · Shaheb Bazar", sales: "৳1,76,900", status: "Active", initials: "CD", color: "#f1edfa" },
];

const activity = [
  { title: "New pharmacy registered", detail: "MediCare Plus · Khulna", time: "12 min ago", color: "#27a879" },
  { title: "License review requested", detail: "LifeLine Medical Hall", time: "48 min ago", color: "#d69b31" },
  { title: "Monthly report generated", detail: "September 2026 · All branches", time: "2 hours ago", color: "#4387ad" },
  { title: "Staff account approved", detail: "Nusrat Jahan · Care Point", time: "3 hours ago", color: "#8d7aba" },
];

const panelStyle = {
  minWidth: 0,
  border: "1px solid #e3e9e4",
  borderRadius: 8,
  background: "#fff",
} as const;

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<Period>("Monthly");
  const selectedData = revenueData[period];
  const maxRevenue = Math.max(...selectedData.map((item) => item.revenue));

  return (
    <AdminDashboardShell>
      <main id="overview" style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>Thursday, October 1, 2026</div>
            <h1 style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Admin overview</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#627168", fontSize: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#23a876" }} />
            Platform operational
            <span style={{ marginLeft: 8, padding: "7px 10px", border: "1px solid #e1e7e2", borderRadius: 6, background: "#fff" }}>October 2026</span>
          </div>
        </div>

        <section aria-label="Platform metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          {metrics.map((metric) => (
            <article key={metric.label} style={{ minWidth: 0, minHeight: 112, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#68776f", fontSize: 11, fontWeight: 550 }}>{metric.label}</span>
                <span style={{ width: 25, height: 25, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 6, background: metric.background, color: metric.color, fontSize: 13, fontWeight: 700 }}>{metric.icon}</span>
              </div>
              <div style={{ marginTop: 11, color: "#203128", fontSize: 20, fontWeight: 720 }}>{metric.value}</div>
              <div style={{ marginTop: 4, color: metric.label === "Pending requests" ? "#a15c12" : "#89958e", fontSize: 10 }}>{metric.note}</div>
            </article>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(260px, 0.9fr)", gap: 14, marginBottom: 18 }}>
          <article id="analytics" style={{ ...panelStyle, padding: "16px 18px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Revenue &amp; operating costs</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Platform-wide financial performance</p>
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
                    <div title={`Revenue ${item.revenue}`} style={{ width: "min(24px, 38%)", height: `${Math.max(8, (item.revenue / maxRevenue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#27a879" }} />
                    <div title={`Operating costs ${item.expenses}`} style={{ width: "min(24px, 38%)", height: `${Math.max(8, (item.expenses / maxRevenue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#9ccfba" }} />
                  </div>
                  <span style={{ minHeight: 16, color: "#87938c", fontSize: 9, whiteSpace: "nowrap" }}>{item.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article style={{ ...panelStyle, padding: "16px 18px" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Network snapshot</h2>
            <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Pharmacy account status</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, paddingBottom: 15, borderBottom: "1px solid #edf0ed" }}>
              <span style={{ color: "#203128", fontSize: 27, fontWeight: 750 }}>128</span>
              <span style={{ color: "#849188", fontSize: 10 }}>registered pharmacies</span>
            </div>
            <div style={{ display: "grid", gap: 14, paddingTop: 15 }}>
              {[
                { name: "Active", count: 112, color: "#27a879" },
                { name: "Under review", count: 9, color: "#d69b31" },
                { name: "Suspended", count: 7, color: "#d36b61" },
              ].map((item) => (
                <div key={item.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#65746b" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />{item.name}</span>
                  <strong style={{ color: "#293a30", fontWeight: 650 }}>{item.count}</strong>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(260px, 1fr)", gap: 14 }}>
          <article id="pharmacies" style={{ ...panelStyle, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
              <div>
                <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Top pharmacies</h2>
                <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>Ranked by sales this month</p>
              </div>
              <span style={{ color: "#267451", fontSize: 10, fontWeight: 650 }}>128 pharmacies</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 490, borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr>
                    {["Pharmacy", "Monthly sales", "Status"].map((column) => (
                      <th key={column} style={{ padding: "10px 14px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pharmacies.map((pharmacy) => (
                    <tr key={pharmacy.name}>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid #f0f2f0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 7, background: pharmacy.color, color: "#37634d", fontSize: 9, fontWeight: 700 }}>{pharmacy.initials}</span>
                          <span style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", color: "#26372f", fontSize: 11, fontWeight: 600 }}>{pharmacy.name}</strong>
                            <span style={{ display: "block", marginTop: 3, color: "#849188", fontSize: 9 }}>{pharmacy.location}</span>
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid #f0f2f0", color: "#43534a", fontSize: 11, whiteSpace: "nowrap" }}>{pharmacy.sales}</td>
                      <td style={{ padding: "11px 14px", borderBottom: "1px solid #f0f2f0" }}>
                        <span style={{ padding: "4px 7px", borderRadius: 12, background: pharmacy.status === "Active" ? "#e8f7ef" : "#fff2e5", color: pharmacy.status === "Active" ? "#267451" : "#9a6a11", fontSize: 9, fontWeight: 650 }}>{pharmacy.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article id="activity" style={{ ...panelStyle, padding: "16px 18px" }}>
            <h2 style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Recent activity</h2>
            <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>Latest platform updates</p>
            <div style={{ display: "grid" }}>
              {activity.map((item, index) => (
                <div key={item.title} style={{ display: "flex", gap: 10, padding: "11px 0", borderBottom: index === activity.length - 1 ? 0 : "1px solid #f0f2f0" }}>
                  <span style={{ width: 8, height: 8, marginTop: 4, flex: "0 0 auto", borderRadius: "50%", background: item.color }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#34453b", fontSize: 10, fontWeight: 650 }}>{item.title}</div>
                    <div style={{ marginTop: 4, color: "#7a8981", fontSize: 9 }}>{item.detail}</div>
                    <div style={{ marginTop: 5, color: "#9aa49e", fontSize: 9 }}>{item.time}</div>
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
