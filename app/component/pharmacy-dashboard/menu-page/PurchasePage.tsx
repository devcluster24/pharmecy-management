import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Track purchase orders and incoming stock from your suppliers.",
  action: "Create purchase",
  metrics: [
    { label: "This month's purchases", value: "৳186,400", detail: "Across 24 orders" },
    { label: "Awaiting delivery", value: "3", detail: "Purchase orders" },
    { label: "Received this month", value: "21", detail: "Orders completed" },
  ],
  columns: ["Order", "Supplier", "Order date", "Expected", "Total", "Status"],
  rows: [
    ["PO-0325", "Square Pharmaceuticals", "Sep 29, 2026", "Oct 02, 2026", "৳18,450", "In transit"],
    ["PO-0324", "Incepta Pharmaceuticals", "Sep 28, 2026", "Oct 01, 2026", "৳12,800", "Pending"],
    ["PO-0323", "Beximco Pharma", "Sep 26, 2026", "Sep 30, 2026", "৳24,100", "Received"],
  ],
};

export default function PurchasePage() {
  return <DashboardSectionPage sectionSlug="purchase" data={pageData} />;
}