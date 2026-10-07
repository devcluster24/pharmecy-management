"use client";

import { useSyncExternalStore } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import SalesActions from "./SalesActions";
import {
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
} from "./salesStorage";

const pageData: SectionData = {
  description: "Review transactions, payments, and daily sales performance.",
  action: "New sale",
  metrics: [
    { label: "Today's sales", value: "৳24,580", detail: "Since store opening" },
    { label: "Transactions", value: "86", detail: "12 more than yesterday" },
    { label: "Average sale", value: "৳285.81", detail: "Per transaction" },
  ],
  columns: ["Invoice", "Customer", "Items", "Time", "Amount", "Payment"],
  rows: [
    ["INV-2086", "Walk-in customer", "3", "10:42 AM", "৳680", "Paid"],
    ["INV-2085", "Rahim Uddin", "2", "10:36 AM", "৳245", "Paid"],
    ["INV-2084", "Walk-in customer", "5", "10:18 AM", "৳1,120", "Paid"],
    ["INV-2083", "Nusrat Jahan", "1", "09:54 AM", "৳180", "Paid"],
  ],
};

export default function SalesPage() {
  const sales = useSyncExternalStore(
    subscribeToSalesList,
    getSalesListSnapshot,
    () => emptySalesListSnapshot,
  );
  const data: SectionData = {
    ...pageData,
    errorMessage: sales.error || undefined,
    rows: [
      ...sales.rows.map((sale) => [
        sale.invoice,
        sale.customer,
        String(sale.items),
        sale.time,
        `৳${sale.amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        sale.payment,
      ]),
      ...pageData.rows,
    ],
  };

  return <DashboardSectionPage sectionSlug="sales" data={data} actionContent={<SalesActions />} />;
}