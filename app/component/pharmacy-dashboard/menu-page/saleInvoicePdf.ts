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
  if (sale.phone) document.text(`Phone: ${sale.phone}`, left, 50);
  document.text(`Payment method: ${sale.paymentMethodName ?? "Cash"}`, left, sale.phone ? 56 : 50);
  document.text(`Status: ${sale.payment}`, right, 32, { align: "right" });

  let y = sale.phone ? 68 : 62;
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

  const subtotal = sale.subtotalAmount ?? sale.amount;
  const discount = sale.discountAmount ?? 0;
  const taxAmount = sale.taxAmount ?? 0;
  const cashRoundingAmount = sale.cashRoundingAmount ?? 0;
  const paidAmount = sale.paidAmount ?? sale.amount;
  const changeCash = Math.max(0, paidAmount - sale.amount);
  const summaryRows = [
    ...(discount > 0 || taxAmount > 0 ? [{ label: "Subtotal", amount: subtotal, color: [82, 97, 88] }] : []),
    ...(discount > 0 ? [{ label: "Discount", amount: -discount, color: [82, 97, 88] }] : []),
    ...(taxAmount > 0 ? [{ label: `VAT/TAX (${sale.taxRate ?? 0}%)`, amount: taxAmount, color: [82, 97, 88] }] : []),
    ...(cashRoundingAmount !== 0 ? [{ label: "Cash rounding", amount: cashRoundingAmount, color: [82, 97, 88] }] : []),
    { label: "Grand total", amount: sale.amount, color: [23, 112, 78] },
    { label: "Pay amount", amount: paidAmount, color: [82, 97, 88] },
    { label: "Due", amount: sale.dueAmount ?? 0, color: (sale.dueAmount ?? 0) > 0 ? [173, 75, 67] : [23, 112, 78] },
    ...(changeCash > 0 ? [{ label: "Change cash", amount: changeCash, color: [23, 112, 78] }] : []),
  ];
  if (y + summaryRows.length * 6 + 8 > bottom) {
    document.addPage();
    y = 20;
  }
  summaryRows.forEach((row, index) => {
    const isGrandTotal = row.label === "Grand total";
    document.setFont("helvetica", isGrandTotal ? "bold" : "normal");
    document.setFontSize(isGrandTotal ? 11 : 9);
    document.setTextColor(row.color[0], row.color[1], row.color[2]);
    const amount = row.amount < 0
      ? `-${formatAmount(Math.abs(row.amount))}`
      : formatAmount(row.amount);
    document.text(`${row.label}: ${amount}`, right, y + 5 + index * 6, { align: "right" });
  });
  document.save(`${sale.invoice}.pdf`);
}
