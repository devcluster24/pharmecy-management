import type { ReactNode } from "react";
import DashboardAccessGate from "../component/auth/DashboardAccessGate";
import { DashboardLanguageProvider } from "../component/pharmacy-dashboard/components/DashboardLanguageProvider";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardAccessGate requiredRole="pharmacy_user">
      <DashboardLanguageProvider>{children}</DashboardLanguageProvider>
    </DashboardAccessGate>
  );
}