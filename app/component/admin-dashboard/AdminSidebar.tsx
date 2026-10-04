"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const adminNavItems = [
  { label: "Overview", icon: "◫", href: "/admin-dashboard/overview" },
  { label: "Analytics", icon: "▥", href: "/admin-dashboard/analytics" },
  { label: "Data Collect", icon: "⇧", href: "/admin-dashboard/data-collect" },
  { label: "Subscription", icon: "▤", href: "/admin-dashboard/subscription" },
  { label: "User Management", icon: "♙", href: "/admin-dashboard/user-management" },
] as const;

export default function AdminSidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      aria-label="Admin menu"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width: expanded ? 220 : 76,
        minWidth: expanded ? 220 : 76,
        background: "#f7f7f5",
        borderRight: "1px solid #e8e8e6",
        position: "relative",
        transition: "width 0.2s ease",
        overflow: "hidden",
        padding: "18px 12px 52px",
        boxSizing: "border-box",
      }}
    >
      <nav aria-label="Admin sections" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {adminNavItems.map((item) => {
          const isActive = pathname === item.href || (pathname === "/admin-dashboard" && item.label === "Overview");

          return (
            <Link
              key={item.label}
              href={item.href}
              title={expanded ? undefined : item.label}
              aria-current={isActive ? "location" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 40,
                padding: "0 12px",
                borderRadius: 8,
                background: isActive ? "rgba(42, 212, 154, 0.12)" : "transparent",
                color: "#2b2d31",
                whiteSpace: "nowrap",
                transition: "all 0.2s ease",
                textDecoration: "none",
              }}
            >
              <span style={{ width: 18, minWidth: 18, textAlign: "center", fontSize: 15, lineHeight: 1 }}>
                {item.icon}
              </span>
              <span
                style={{
                  opacity: expanded ? 1 : 0,
                  transform: expanded ? "translateX(0)" : "translateX(-10px)",
                  width: expanded ? "auto" : 0,
                  overflow: "hidden",
                  transition: "all 0.18s ease",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#20232b",
                }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 14,
          margin: "auto",
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#fff",
          color: "#6b7280",
          fontSize: 12,
        }}
      >
        ◌
      </span>
    </aside>
  );
}