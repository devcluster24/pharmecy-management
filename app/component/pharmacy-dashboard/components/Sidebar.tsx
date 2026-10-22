'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiFillProduct } from "react-icons/ai";
import { BiSolidPurchaseTag } from "react-icons/bi";
import { FaFileInvoiceDollar } from "react-icons/fa";
import { FaTruckMedical } from "react-icons/fa6";
import { GiReturnArrow } from "react-icons/gi";
import { GrDocumentStore } from "react-icons/gr";
import { MdCurrencyExchange, MdDashboard, MdOutlineInventory, MdPeopleAlt, MdSettings } from "react-icons/md";
import { RxPeople } from "react-icons/rx";
import { TbBusinessplan } from "react-icons/tb";
import { useState } from "react";
import type { IconType } from "react-icons";
import { canPharmacyStaffAccess } from "@/lib/pharmacy-staff-permissions";
import { dashboardNavItems } from "../navigation";

const sidebarIcons: Record<string, IconType> = {
  "": MdDashboard,
  "product-management": AiFillProduct,
  sales: MdCurrencyExchange,
  invoice: FaFileInvoiceDollar,
  purchase: BiSolidPurchaseTag,
  inventory: MdOutlineInventory,
  returns: GiReturnArrow,
  customers: MdPeopleAlt,
  suppliers: FaTruckMedical,
  reports: GrDocumentStore,
  expenses: TbBusinessplan,
  staff: RxPeople,
  settings: MdSettings,
};

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className="dashboard-sidebar"
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
      <div className="dashboard-sidebar-items" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {dashboardNavItems.filter((item) => canPharmacyStaffAccess(item.slug || "overview")).map((item) => {
          const isActive = pathname === item.href;
          const SidebarIcon = sidebarIcons[item.slug];

          return (
            <Link
              key={item.label}
              className="dashboard-sidebar-item"
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
                className="dashboard-sidebar-icon"
                style={{
                  width: 18,
                  minWidth: 18,
                  textAlign: "center",
                  fontSize: 15,
                  lineHeight: 1,
                  color: isActive ? "#111827" : "#2b2d31",
                }}
              >
                {SidebarIcon ? <SidebarIcon size={18} color="#17664f" /> : item.icon}
              </span>

              <span
                className="dashboard-sidebar-label"
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
        className="dashboard-sidebar-footer"
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
          className="dashboard-sidebar-footer-icon"
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
