import type { ReactNode } from "react";
import AdminSidebar from "./AdminSidebar";
import AdminProfileMenu from "./AdminProfileMenu";

export default function AdminDashboardShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f7f5", color: "#1f2d26", fontFamily: "Arial, sans-serif" }}>
      <header style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e6ebe7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 7, background: "#2ad49a", color: "#07372b", fontSize: 15 }}>✚</span>
          <span style={{ color: "#203128", fontSize: 14, fontWeight: 700 }}>Pharmecy Cluster</span>
          <span style={{ marginLeft: 5, padding: "4px 7px", borderRadius: 4, background: "#edf6f1", color: "#267451", fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>ADMIN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#66756d", fontSize: 12 }}>
          <span>Platform administrator</span>
          <AdminProfileMenu />
        </div>
      </header>
      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <AdminSidebar />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}