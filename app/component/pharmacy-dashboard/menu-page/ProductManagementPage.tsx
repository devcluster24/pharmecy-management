import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

const pageData: SectionData = {
  description: "Manage your pharmacy catalog, prices, and product availability.",
  action: "Add product",
  metrics: [
    { label: "Total products", value: "1,284", detail: "Across 18 categories" },
    { label: "Low stock", value: "18", detail: "Needs restocking" },
    { label: "Expiring soon", value: "7", detail: "Within 90 days" },
  ],
  columns: ["Product", "SKU", "Category", "Stock", "Unit price", "Status"],
  rows: [
    ["Napa 500mg", "MED-1001", "Pain relief", "240", "৳12.00", "In stock"],
    ["Seclo 20mg", "MED-1002", "Gastric", "18", "৳7.00", "Low stock"],
    ["Napa Extra", "MED-1003", "Pain relief", "96", "৳15.00", "In stock"],
    ["Histacin 10mg", "MED-1004", "Allergy", "0", "৳2.00", "Out of stock"],
  ],
};

export default function ProductManagementPage() {
  return <DashboardSectionPage sectionSlug="product-management" data={pageData} />;
}