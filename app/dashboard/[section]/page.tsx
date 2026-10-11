import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import CustomerManagementPage from "../../component/pharmacy-dashboard/menu-page/CustomerManagementPage";
import DashboardProfilePage from "../../component/pharmacy-dashboard/menu-page/DashboardProfilePage";
import ExpensesPage from "../../component/pharmacy-dashboard/menu-page/ExpensesPage";
import InvoicePage from "../../component/pharmacy-dashboard/menu-page/InvoicePage";
import InventoryPage from "../../component/pharmacy-dashboard/menu-page/InventoryPage";
import ProductManagementPage from "../../component/pharmacy-dashboard/menu-page/ProductManagementPage";
import PurchasePage from "../../component/pharmacy-dashboard/menu-page/PurchasePage";
import ReportsPage from "../../component/pharmacy-dashboard/menu-page/ReportsPage";
import ReturnSystemPage from "../../component/pharmacy-dashboard/menu-page/ReturnSystemPage";
import SalesPage from "../../component/pharmacy-dashboard/menu-page/SalesPage";
import SettingPage from "../../component/pharmacy-dashboard/menu-page/SettingPage";
import StaffManagementPage from "../../component/pharmacy-dashboard/menu-page/StaffManagementPage";
import SupplierManagementPage from "../../component/pharmacy-dashboard/menu-page/SupplierManagementPage";
import { dashboardNavItems } from "../../component/pharmacy-dashboard/navigation";

const sectionPages: Record<string, ComponentType> = {
  "product-management": ProductManagementPage,
  sales: SalesPage,
  invoice: InvoicePage,
  purchase: PurchasePage,
  inventory: InventoryPage,
  returns: ReturnSystemPage,
  customers: CustomerManagementPage,
  suppliers: SupplierManagementPage,
  reports: ReportsPage,
  expenses: ExpensesPage,
  staff: StaffManagementPage,
  settings: SettingPage,
  profile: DashboardProfilePage,
};

export function generateStaticParams(): { section: string }[] {
  return [
    ...dashboardNavItems
      .filter((item) => item.slug !== "")
      .map((item) => ({ section: item.slug })),
    { section: "Profile" },
  ];
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const normalizedSection = section.toLocaleLowerCase();

  const SectionPage = sectionPages[normalizedSection];

  if (!SectionPage || (normalizedSection !== "profile" && !dashboardNavItems.some((item) => item.slug === normalizedSection))) {
    notFound();
  }

  return <SectionPage />;
}
