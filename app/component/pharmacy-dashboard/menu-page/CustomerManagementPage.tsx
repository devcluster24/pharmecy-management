import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Keep customer details and purchase history organized.",
  action: "Add customer",
  metrics: [
    { label: "Customers", value: "2,408", detail: "All registered customers" },
    { label: "New this month", value: "126", detail: "Since Sep 01" },
    { label: "Loyal customers", value: "84", detail: "5+ visits this month" },
  ],
  columns: ["Customer", "Phone", "Visits", "Last purchase", "Outstanding", "Status"],
  rows: [
    ["Rahim Uddin", "+880 1712-345678", "18", "Today", "৳0", "Active"],
    ["Nusrat Jahan", "+880 1812-345679", "12", "Today", "৳240", "Active"],
    ["Karim Ahmed", "+880 1912-345680", "7", "Sep 28, 2026", "৳0", "Active"],
  ],
};

export default function CustomerManagementPage() {
  return <DashboardSectionPage sectionSlug="customers" data={pageData} />;
}