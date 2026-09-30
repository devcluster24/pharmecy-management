import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Configure your store profile, receipt details, and preferences.",
  action: "Save changes",
  metrics: [
    { label: "Store status", value: "Open", detail: "Accepting sales" },
    { label: "Default currency", value: "BDT (৳)", detail: "Bangladeshi Taka" },
    { label: "Time zone", value: "Asia/Dhaka", detail: "UTC +06:00" },
  ],
  columns: ["Preference", "Current value", "Last updated", "Status"],
  rows: [
    ["Store name", "Pharmecy Cluster", "Sep 30, 2026", "Configured"],
    ["Receipt footer", "Thank you for your purchase", "Sep 28, 2026", "Configured"],
    ["Low-stock alerts", "Enabled", "Sep 28, 2026", "Active"],
  ],
};

export default function SettingPage() {
  return <DashboardSectionPage sectionSlug="settings" data={pageData} />;
}