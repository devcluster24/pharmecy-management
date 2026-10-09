import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import SalesActions from "./SalesActions";

const pageData: SectionData = {
  description: "",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

export default function SalesPage() {
  return (
    <DashboardSectionPage
      sectionSlug="sales"
      data={pageData}
      hideAction
      content={<SalesActions />}
    />
  );
}