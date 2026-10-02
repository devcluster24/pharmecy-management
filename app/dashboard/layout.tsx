import type { ReactNode } from "react";
import DashboardAccessGate from "../component/auth/DashboardAccessGate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardAccessGate requiredRole="pharmacy_user">{children}</DashboardAccessGate>;
}