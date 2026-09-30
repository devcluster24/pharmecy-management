import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Explore sales, stock, and business performance at a glance.",
  action: "Export report",
  metrics: [
    { label: "Revenue this month", value: "৳684,250", detail: "Up 8.4% from August" },
    { label: "Gross profit", value: "৳126,780", detail: "18.5% margin" },
    { label: "Units sold", value: "8,492", detail: "Across 2,180 sales" },
  ],
  columns: ["Report", "Period", "Generated", "Prepared by", "Format", "Action"],
  rows: [
    ["Monthly sales summary", "Sep 2026", "Sep 30, 2026", "Admin", "PDF", "View"],
    ["Inventory valuation", "Sep 2026", "Sep 30, 2026", "Admin", "CSV", "View"],
    ["Top selling products", "Last 30 days", "Sep 30, 2026", "Admin", "PDF", "View"],
  ],
};

export default function ReportsPage() {
  return <DashboardSectionPage sectionSlug="reports" data={pageData} />;
}