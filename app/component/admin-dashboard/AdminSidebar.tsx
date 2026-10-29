"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MdDashboard, MdNotificationsActive } from "react-icons/md";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const adminNavItems = [
  { label: "Overview", icon: "◫", href: "/admin-dashboard/overview" },
  { label: "Analytics", icon: "▥", href: "/admin-dashboard/analytics" },
  { label: "Subscription", icon: "▤", href: "/admin-dashboard/subscription" },
  { label: "Expense", icon: "৳", href: "/admin-dashboard/expense" },
  { label: "Notification", icon: "notifications", href: "/admin-dashboard/notification" },
  { label: "Admin Management", icon: "♙", href: "/admin-dashboard/admin-management" },
] as const;

export default function AdminSidebar() {
  const [expanded, setExpanded] = useState(false);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (error || !data.user) return;
      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("role, approval_status")
        .eq("id", data.user.id)
        .maybeSingle();
      if (active && !profileError) {
        setHasAdminAccess(
          (profile?.role === "admin" || profile?.role === "superadmin")
          && profile.approval_status === "approved",
        );
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
        {adminNavItems.filter((item) => item.label !== "Admin Management" || hasAdminAccess).map((item) => {
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
                {item.label === "Overview" ? (
                  <MdDashboard size={18} color="#17664f" />
                ) : item.label === "Notification" ? (
                  <MdNotificationsActive size={18} color="#17664f" />
                ) : item.icon}
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