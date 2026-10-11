import { jsPDF } from "jspdf";

export type SubscriptionInvoice = {
  invoice_number: string;
  full_name: string;
  email: string;
  phone?: string;
  store_name?: string;
  pharmacy_name?: string;
  plan_name: string;
  amount: number;
  payment_method: string;
  account_number?: string;
  status: string;
  occurred_at: string;
  expires_at: string | null;
  billing_period: string;
  billing_interval: number;
};

const theme = {
  dark: [32, 49, 40] as const,
  green: [22, 132, 93] as const,
  lightGreen: [232, 246, 238] as const,
  text: [52, 69, 59] as const,
  muted: [113, 128, 120] as const,
  border: [220, 232, 224] as const,
  white: [255, 255, 255] as const,
};

function formatAmount(amount: number) {
  return `BDT ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-BD");
}

function getBillingPeriod(invoice: SubscriptionInvoice) {
  if (invoice.billing_period === "one-time") return "One-time";
  const unit = invoice.billing_period === "minutes"
    ? "minute"
    : invoice.billing_period === "days"
      ? "day"
      : invoice.billing_period === "year"
        ? "year"
        : "month";
  return `${invoice.billing_interval} ${unit}${invoice.billing_interval === 1 ? "" : "s"}`;
}

export function downloadSubscriptionInvoicePdf(
  invoice: SubscriptionInvoice,
  organizationName = "Pharmacy Cluster",
  fileName = `${invoice.invoice_number}.pdf`,
) {
  const document = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const left = 16;
  const right = pageWidth - left;
  const contentWidth = right - left;
  const topHeaderHeight = 34;

  document.setProperties({
    title: `Payment Invoice ${invoice.invoice_number}`,
    subject: "Pharmacy subscription payment invoice",
  });

  document.setFillColor(...theme.dark);
  document.rect(0, 0, pageWidth, topHeaderHeight, "F");
  document.setFillColor(...theme.green);
  document.rect(0, topHeaderHeight, pageWidth, 3, "F");
  document.setFont("helvetica", "bold");
  document.setFontSize(17);
  document.setTextColor(...theme.white);
  document.text(organizationName || "Pharmacy Cluster", left, 16);
  document.setFontSize(20);
  document.text("PAYMENT INVOICE", right, 24, { align: "right" });

  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(...theme.muted);
  document.text(`Invoice No. ${invoice.invoice_number}`, left, 45);
  document.text(`Payment date: ${formatDate(invoice.occurred_at)}`, right, 45, { align: "right" });

  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.setTextColor(...theme.green);
  document.text("INVOICE TO", left, 59);
  document.setFont("helvetica", "bold");
  document.setFontSize(12);
  document.setTextColor(...theme.dark);
  document.text(invoice.full_name || "Pharmacy Owner", left, 67);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(...theme.text);
  let invoiceToY = 73;
  const invoiceToRows = [
    invoice.store_name || invoice.pharmacy_name || "Pharmacy account",
    invoice.phone?.trim() ? `Phone: ${invoice.phone}` : "",
    invoice.email ? `Email: ${invoice.email}` : "",
  ].filter(Boolean);
  invoiceToRows.forEach((row) => {
    const lines = document.splitTextToSize(row, 95) as string[];
    document.text(lines, left, invoiceToY);
    invoiceToY += lines.length * 4.5 + 1;
  });

  const totalBoxX = 124;
  const totalBoxWidth = right - totalBoxX;
  document.setFillColor(...theme.lightGreen);
  document.roundedRect(totalBoxX, 55, totalBoxWidth, 34, 2, 2, "F");
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(...theme.muted);
  document.text("TOTAL PAID", totalBoxX + 5, 63);
  document.setFont("helvetica", "bold");
  document.setFontSize(17);
  document.setTextColor(...theme.green);
  document.text(formatAmount(invoice.amount), totalBoxX + 5, 72);
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.setTextColor(...theme.text);
  document.text(`Status: ${invoice.status}`, totalBoxX + 5, 82);

  const tableY = 101;
  const headerHeight = 10;
  const colWidths = [55, 43, 40, contentWidth - 138];
  const colX = [
    left,
    left + colWidths[0],
    left + colWidths[0] + colWidths[1],
    left + colWidths[0] + colWidths[1] + colWidths[2],
  ];
  document.setFillColor(...theme.dark);
  document.roundedRect(left, tableY, contentWidth, headerHeight, 1.5, 1.5, "F");
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.setTextColor(...theme.white);
  ["Plan Name", "Billing Period", "Payment Method", "Plan Expires"].forEach((heading, index) => {
    document.text(heading, colX[index] + 3, tableY + 6.5);
  });

  const rowY = tableY + headerHeight;
  const rowHeight = 17;
  document.setDrawColor(...theme.border);
  document.setFillColor(249, 252, 250);
  document.rect(left, rowY, contentWidth, rowHeight, "FD");
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.setTextColor(...theme.text);
  const rowValues = [
    invoice.plan_name,
    getBillingPeriod(invoice),
    invoice.payment_method || "N/A",
    formatDate(invoice.expires_at),
  ];
  rowValues.forEach((value, index) => {
    const lines = document.splitTextToSize(value, colWidths[index] - 6) as string[];
    document.text(lines, colX[index] + 3, rowY + 7);
  });
  colX.slice(1).forEach((x) => document.line(x, tableY, x, rowY + rowHeight));

  const paymentBoxY = 140;
  document.setFillColor(249, 252, 250);
  document.roundedRect(left, paymentBoxY, 86, 31, 2, 2, "F");
  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.setTextColor(...theme.green);
  document.text("PAYMENT METHOD", left + 5, paymentBoxY + 8);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(...theme.text);
  document.text(invoice.payment_method || "N/A", left + 5, paymentBoxY + 16);
  document.setFontSize(8);
  document.setTextColor(...theme.muted);
  document.text("Account Number", left + 5, paymentBoxY + 23);
  document.setTextColor(...theme.text);
  document.text(invoice.account_number || "Not configured", left + 30, paymentBoxY + 23);

  const termsY = 186;
  document.setFont("helvetica", "bold");
  document.setFontSize(10);
  document.setTextColor(...theme.dark);
  document.text("Terms & Conditions", left, termsY);
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.setTextColor(...theme.text);
  const terms = [
    "Payments are non-refundable unless otherwise required by applicable law.",
    "Software access may be restricted or suspended after subscription expiry.",
    "Services may be suspended for overdue payments.",
    "Payment constitutes acceptance of these Terms & Conditions.",
  ];
  let termsRowY = termsY + 8;
  terms.forEach((term) => {
    const lines = document.splitTextToSize(term, 112) as string[];
    document.setFillColor(...theme.green);
    document.circle(left + 1.5, termsRowY - 1, 0.7, "F");
    document.setTextColor(...theme.text);
    document.text(lines, left + 5, termsRowY);
    termsRowY += lines.length * 4 + 3;
  });

  document.setDrawColor(...theme.border);
  document.line(137, 234, right, 234);
  document.setFont("helvetica", "bold");
  document.setFontSize(10);
  document.setTextColor(...theme.green);
  document.text("Pharmacy Cluster", (137 + right) / 2, 241, { align: "center" });

  const footerY = pageHeight - 15;
  document.setDrawColor(...theme.border);
  document.line(0, footerY - 6, pageWidth, footerY - 6);
  document.setFont("helvetica", "bold");
  document.setFontSize(10);
  document.setTextColor(...theme.dark);
  document.text("Thank you for being with us.", right, footerY, { align: "right" });
  document.save(fileName);
}
