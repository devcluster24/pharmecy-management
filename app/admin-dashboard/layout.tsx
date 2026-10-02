import type { ReactNode } from "react";
import DashboardAccessGate from "../component/auth/DashboardAccessGate";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardAccessGate requiredRole="admin">{children}</DashboardAccessGate>;
}