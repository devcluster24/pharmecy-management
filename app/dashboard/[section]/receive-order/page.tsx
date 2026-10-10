import { notFound } from "next/navigation";
import DashboardSectionPage, { type SectionData } from "../../../component/pharmacy-dashboard/DashboardSectionPage";
import PurchaseCreateAction from "../../../component/pharmacy-dashboard/menu-page/PurchaseCreateAction";

const pageData: SectionData = {
  description: "Receive stock from your suppliers and record invoice details.",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

export default async function ReceiveOrderPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section !== "purchase") notFound();

  return (
    <DashboardSectionPage
      sectionSlug="purchase"
      data={pageData}
      hideAction
      hidePageHeader
      content={<PurchaseCreateAction standalone />}
    />
  );
}
