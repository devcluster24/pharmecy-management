import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Review returned products and keep return adjustments traceable.",
  action: "Record return",
  metrics: [
    { label: "Returns this month", value: "24", detail: "4.2% of transactions" },
    { label: "Awaiting review", value: "3", detail: "Needs a decision" },
    { label: "Refunded", value: "৳8,460", detail: "This month" },
  ],
  columns: ["Return ID", "Invoice", "Product", "Date", "Reason", "Status"],
  rows: [
    ["RET-0124", "INV-2058", "Napa 500mg", "Sep 30, 2026", "Wrong item", "Reviewed"],
    ["RET-0123", "INV-2041", "Seclo 20mg", "Sep 29, 2026", "Damaged pack", "Pending"],
    ["RET-0122", "INV-2019", "Ceevit 250mg", "Sep 28, 2026", "Customer changed mind", "Refunded"],
  ],
};

export default function ReturnSystemPage() {
  return <DashboardSectionPage sectionSlug="returns" data={pageData} />;
}