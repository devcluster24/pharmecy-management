import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Manage supplier contacts, orders, and outstanding balances.",
  action: "Add supplier",
  metrics: [
    { label: "Active suppliers", value: "32", detail: "Approved vendors" },
    { label: "Open orders", value: "3", detail: "Awaiting delivery" },
    { label: "Outstanding", value: "৳42,800", detail: "Across 8 suppliers" },
  ],
  columns: ["Supplier", "Contact", "Products", "Outstanding", "Last order", "Status"],
  rows: [
    ["Square Pharmaceuticals", "+880 2-8189000", "184", "৳12,400", "Sep 29, 2026", "Active"],
    ["Incepta Pharmaceuticals", "+880 2-8870613", "142", "৳8,600", "Sep 28, 2026", "Active"],
    ["Beximco Pharma", "+880 2-58611001", "96", "৳0", "Sep 26, 2026", "Active"],
  ],
};

export default function SupplierManagementPage() {
  return <DashboardSectionPage sectionSlug="suppliers" data={pageData} />;
}