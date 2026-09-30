'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { dashboardNavItems } from "../navigation";

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  return (
    <aside
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
        padding: "18px 12px 12px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {dashboardNavItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 40,
                padding: "0 12px",
                borderRadius: 10,
                background: isActive ? "rgba(42, 212, 154, 0.12)" : "transparent",
                color: "#2b2d31",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.2s ease",
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  width: 18,
                  minWidth: 18,
                  textAlign: "center",
                  fontSize: 15,
                  lineHeight: 1,
                  color: isActive ? "#111827" : "#2b2d31",
                }}
              >
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
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 14,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
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
      </div>
    </aside>
  );
}
