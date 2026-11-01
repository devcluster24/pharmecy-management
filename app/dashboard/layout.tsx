import type { ReactNode } from "react";
import DashboardAccessGate from "../component/auth/DashboardAccessGate";
import { DashboardLanguageProvider } from "../component/pharmacy-dashboard/components/DashboardLanguageProvider";
import ProductCatalogAutoSync from "../component/pharmacy-dashboard/menu-page/ProductCatalogAutoSync";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardAccessGate requiredRole="pharmacy_user">
      <DashboardLanguageProvider>
        <ProductCatalogAutoSync />
        {children}
      </DashboardLanguageProvider>
    </DashboardAccessGate>
  );
}