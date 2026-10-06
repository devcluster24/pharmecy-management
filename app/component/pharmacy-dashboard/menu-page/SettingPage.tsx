"use client";

import { useState } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const settingsMenus = [
  {
    id: "pharmacy-store",
    label: "Pharmacy Store",
    data: {
      description: "Configure your store profile, receipt details, and preferences.",
      action: "Save changes",
      metrics: [
        { label: "Store status", value: "Open", detail: "Accepting sales" },
        { label: "Default currency", value: "BDT (৳)", detail: "Bangladeshi Taka" },
        { label: "Time zone", value: "Asia/Dhaka", detail: "UTC +06:00" },
      ],
      columns: ["Preference", "Current value", "Last updated", "Status"],
      rows: [
        ["Store name", "Pharmecy Cluster", "Sep 30, 2026", "Configured"],
        ["Receipt footer", "Thank you for your purchase", "Sep 28, 2026", "Configured"],
        ["Low-stock alerts", "Enabled", "Sep 28, 2026", "Active"],
      ],
    },
  },
  {
    id: "subscription-bill",
    label: "Subcription & Bill",
    data: {
      description: "View your subscription plan and billing history.",
      action: "Manage subscription",
      metrics: [],
      columns: ["Plan", "Billing cycle", "Amount", "Status"],
      rows: [],
    },
  },
  {
    id: "documents-invoice",
    label: "Documents & Invoice",
    data: {
      description: "Access store documents and invoices.",
      action: "Add document",
      metrics: [],
      columns: ["Document", "Invoice Number", "Date", "Status"],
      rows: [],
    },
  },
  {
    id: "store-bill-payment",
    label: "Store Bill Payment",
    data: {
      description: "Review payments made for your store bills.",
      action: "Make payment",
      metrics: [],
      columns: ["Payment Date", "Payment Method", "Amount", "Reference", "Status"],
      rows: [],
    },
  },
  {
    id: "profile",
    label: "Profile",
    data: {
      description: "Manage your account profile.",
      action: "Save profile",
      metrics: [],
      columns: ["Name", "Email", "Phone", "Role"],
      rows: [],
    },
  },
] satisfies { id: string; label: string; data: SectionData }[];

export default function SettingPage() {
  const [activeMenu, setActiveMenu] = useState(settingsMenus[0].id);
  const activeSettings = settingsMenus.find((menu) => menu.id === activeMenu) ?? settingsMenus[0];

  return (
    <DashboardSectionPage
      sectionSlug="settings"
      data={activeSettings.data}
      listTitle=""
      listNavigation={
        <div role="group" aria-label="Settings menu" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          {settingsMenus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              aria-pressed={activeMenu === menu.id}
              onClick={() => setActiveMenu(menu.id)}
              style={{ border: 0, background: "transparent", color: activeMenu === menu.id ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: activeMenu === menu.id ? "underline" : "none", textUnderlineOffset: 4, cursor: "pointer" }}
            >
              {menu.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
