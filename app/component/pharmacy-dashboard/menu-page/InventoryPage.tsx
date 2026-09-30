import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Monitor stock levels, expiry dates, and inventory movement.",
  action: "Adjust stock",
  metrics: [
    { label: "Items in stock", value: "1,248", detail: "36 products need attention" },
    { label: "Low stock", value: "18", detail: "Below reorder level" },
    { label: "Expiring soon", value: "7", detail: "Next 90 days" },
  ],
  columns: ["Product", "Batch", "Expiry date", "Available", "Reorder level", "Status"],
  rows: [
    ["Napa 500mg", "NP-26-041", "Aug 2028", "240", "50", "Healthy"],
    ["Seclo 20mg", "SC-25-117", "Dec 2026", "18", "40", "Low stock"],
    ["Histacin 10mg", "HS-26-008", "Jan 2028", "0", "25", "Out of stock"],
    ["Ceevit 250mg", "CV-25-331", "Nov 2026", "64", "30", "Expiring soon"],
  ],
};

export default function InventoryPage() {
  return <DashboardSectionPage sectionSlug="inventory" data={pageData} />;
}