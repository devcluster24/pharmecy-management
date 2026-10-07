import { jsPDF } from "jspdf";
import type { SalesListRow } from "./salesStorage";

function formatAmount(amount: number) {
  return `BDT ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function downloadSaleInvoicePdf(sale: SalesListRow) {
  if (!sale.lines?.length) {
    throw new Error("This invoice does not contain item details to create a PDF.");
  }

  const document = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const left = 14;
  const right = pageWidth - left;
  const bottom = pageHeight - 16;
  const columns = {
    brand: left,
    batch: 87,
    quantity: 128,
    unitPrice: 145,
    total: 174,
  };
  document.setProperties({ title: `Invoice ${sale.invoice}`, subject: "Pharmacy sales invoice" });

  function drawTableHeader(y: number) {
    document.setFillColor(239, 247, 242);
    document.rect(left, y - 5, right - left, 9, "F");
    document.setFont("helvetica", "bold");
    document.setFontSize(8);
    document.text("Product", columns.brand + 2, y);
    document.text("Batch", columns.batch, y);
    document.text("Qty", columns.quantity, y);
    document.text("Unit price", columns.unitPrice, y);
    document.text("Total", columns.total, y);
    document.setFont("helvetica", "normal");
  }

  document.setFont("helvetica", "bold");
  document.setFontSize(19);
  document.setTextColor(23, 112, 78);
  document.text("Pharmecy Cluster", left, 21);
  document.setFontSize(14);
  document.setTextColor(38, 53, 47);
  document.text("SALES INVOICE", right, 21, { align: "right" });

  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(82, 97, 88);
  document.text(`Invoice: ${sale.invoice}`, left, 32);
  document.text(`Date: ${new Date(sale.createdAt).toLocaleString("en-BD")}`, left, 38);
  document.text(`Customer: ${sale.customer}`, left, 44);
  document.text(`Payment: ${sale.payment}`, right, 32, { align: "right" });

  let y = 56;
  drawTableHeader(y);
  y += 11;

  for (const line of sale.lines) {
    const productLines = document.splitTextToSize(
      [line.brand, line.details].filter(Boolean).join(" · "),
      columns.batch - columns.brand - 4,
    ) as string[];
    const batchLines = document.splitTextToSize(line.batchNumber || "-", columns.quantity - columns.batch - 3) as string[];
    const rowHeight = Math.max(productLines.length, batchLines.length, 1) * 4 + 5;

    if (y + rowHeight > bottom) {
      document.addPage();
      y = 20;
      drawTableHeader(y);
      y += 11;
    }

    document.setFontSize(8);
    document.setTextColor(38, 53, 47);
    document.text(productLines, columns.brand + 2, y);
    document.text(batchLines, columns.batch, y);
    document.text(String(line.quantity), columns.quantity, y);
    document.text(formatAmount(line.unitPrice), columns.unitPrice, y);
    document.text(formatAmount(line.totalPrice), columns.total, y);
    y += rowHeight;
    document.setDrawColor(232, 238, 234);
    document.line(left, y - 2, right, y - 2);
  }

  if (y + 25 > bottom) {
    document.addPage();
    y = 20;
  }
  document.setFont("helvetica", "bold");
  document.setFontSize(11);
  document.setTextColor(23, 112, 78);
  document.text(`Grand total: ${formatAmount(sale.amount)}`, right, y + 5, { align: "right" });
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(82, 97, 88);
  document.text(`Pay amount: ${formatAmount(sale.paidAmount ?? sale.amount)}`, right, y + 11, { align: "right" });
  document.setTextColor((sale.dueAmount ?? 0) > 0 ? 173 : 23, (sale.dueAmount ?? 0) > 0 ? 75 : 112, (sale.dueAmount ?? 0) > 0 ? 67 : 78);
  document.text(`Due: ${formatAmount(sale.dueAmount ?? 0)}`, right, y + 17, { align: "right" });
  document.save(`${sale.invoice}.pdf`);
}
