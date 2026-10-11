import { jsPDF } from "jspdf";
import { formatPharmacyStoreName } from "@/lib/pharmacy-dashboard-identity";
import type { InvoiceTemplateItem } from "./invoiceTemplateStorage";
import { getInvoiceTemplateSettings } from "./invoiceTemplateStorage";
import type { SalesListRow } from "./salesStorage";

type RGB = [number, number, number];

const templateColors: Record<string, { accent: RGB; light: RGB; text: RGB; muted: RGB }> = {
  classic: { accent: [23, 112, 78], light: [239, 247, 242], text: [38, 53, 47], muted: [82, 97, 88] },
  modern: { accent: [36, 122, 120], light: [235, 246, 245], text: [31, 49, 51], muted: [78, 99, 99] },
  compact: { accent: [86, 111, 166], light: [239, 242, 250], text: [39, 48, 67], muted: [86, 96, 117] },
  elegant: { accent: [152, 113, 77], light: [248, 243, 237], text: [56, 47, 40], muted: [104, 91, 77] },
};

function formatAmount(amount: number) {
  return `BDT ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getItemValue(item: InvoiceTemplateItem, sale: SalesListRow, storeName: string) {
  if (item.type === "text") return item.value.trim();

  switch (item.key) {
    case "storeName":
      return formatPharmacyStoreName(storeName) || "Pharmacy Cluster";
    case "invoiceNumber":
      return sale.invoice;
    case "dateTime":
      return new Date(sale.createdAt).toLocaleString("en-BD");
    case "customer":
      return sale.customer;
    case "phone":
      return sale.phone ?? "";
    case "paymentMethod":
      return sale.paymentMethodName ?? "Cash";
    case "paymentStatus":
      return sale.payment;
  }
}

function getItemLines(document: jsPDF, item: InvoiceTemplateItem, sale: SalesListRow, storeName: string, width: number) {
  const value = getItemValue(item, sale, storeName);
  if (!value) return [];
  const text = item.type === "field" ? `${item.label}: ${value}` : value;
  return document.splitTextToSize(text, width) as string[];
}

function createSaleInvoicePdf(sale: SalesListRow, storeName: string) {
  if (!sale.lines?.length) {
    throw new Error("This invoice does not contain item details to create a PDF.");
  }

  const settings = getInvoiceTemplateSettings();
  const template = settings.templates.find((item) => item.id === settings.activeTemplateId);
  if (!template) throw new Error("The active invoice template is not available.");
  const templateStyle = template.style;
  const colors = templateColors[templateStyle] ?? templateColors.classic;
  const pageSize = settings.pageSize ?? { format: "a4" as const, widthMm: 210, heightMm: 297 };
  const pageFormat = pageSize.format === "custom"
    ? [pageSize.widthMm, pageSize.heightMm] as [number, number]
    : pageSize.format;
  const document = new jsPDF({ unit: "mm", format: pageFormat });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const left = Math.min(14, pageWidth * 0.06);
  const right = pageWidth - left;
  const contentWidth = right - left;
  const productColumn = left + 2;
  const batchColumn = left + contentWidth * 0.46;
  const quantityColumn = left + contentWidth * 0.66;
  const unitPriceColumn = left + contentWidth * 0.84;
  const totalColumn = right - 2;
  const productWidth = batchColumn - productColumn - 4;
  const batchWidth = quantityColumn - batchColumn - 4;
  const unitPriceWidth = totalColumn - unitPriceColumn - 4;
  const headerLeftWidth = contentWidth * 0.47;
  const headerRightWidth = contentWidth * 0.43;
  const columns = {
    brand: productColumn,
    batch: batchColumn,
    quantity: quantityColumn,
    unitPrice: unitPriceColumn,
    total: totalColumn,
  };
  const formattedDateTime = new Date(sale.createdAt).toLocaleString("en-BD");
  const leftHeaderLines = template.header
    .filter((item) => (item.align ?? "left") === "left")
    .flatMap((item) => getItemLines(document, item, sale, storeName, headerLeftWidth));
  const rightHeaderLines = template.header
    .filter((item) => item.align === "right")
    .flatMap((item) => getItemLines(document, item, sale, storeName, headerRightWidth));
  const headerLineCount = Math.max(leftHeaderLines.length, rightHeaderLines.length);
  const headerBottom = 32 + headerLineCount * 4;
  const footerLines = template.footer.flatMap((item) => getItemLines(document, item, sale, storeName, right - left));
  const hasSignature = settings.signature.type === "image"
    ? Boolean(settings.signature.imageDataUrl)
    : Boolean(settings.signature.text.trim());
  const hasOutstandingDue = (sale.dueAmount ?? 0) > 0 || /due|partial|unpaid/i.test(sale.payment);
  const showPaidSeal = !hasOutstandingDue && settings.seals.paid;
  const showDueSeal = hasOutstandingDue && settings.seals.due;
  const footerTop = pageHeight - (footerLines.length * 4 + 11);
  const bodyBottom = footerTop - (hasSignature ? 29 : 17);
  const fontSize = pageWidth < 170 ? 6.5 : 8;
  document.setProperties({ title: `Invoice ${sale.invoice}`, subject: "Pharmacy sales invoice" });

  function drawTableHeader(y: number) {
    document.setFillColor(...colors.light);
    document.rect(left, y - 5, right - left, 9, "F");
    document.setTextColor(...colors.accent);
    document.setFont("helvetica", "bold");
    document.setFontSize(fontSize);
    document.text("Product", columns.brand + 2, y);
    document.text("Batch", columns.batch, y);
    document.text("Qty", columns.quantity, y);
    document.text("Unit price", columns.unitPrice, y, { align: "right" });
    document.text("Total", columns.total, y, { align: "right" });
    document.setTextColor(...colors.text);
    document.setFont("helvetica", "normal");
  }

  function drawPaymentSeal(centerX: number, centerY: number, status: "PAID" | "DUE", width: number) {
    const color: RGB = status === "PAID" ? [201, 22, 37] : [212, 82, 50];
    const height = width * 0.46;
    document.setDrawColor(...color);
    document.setTextColor(...color);
    document.setLineWidth(2.2);
    document.roundedRect(centerX - width / 2, centerY - height / 2, width, height, height * 0.24, height * 0.24, "S");
    document.setLineWidth(0.45);
    document.roundedRect(centerX - width / 2 + 1.6, centerY - height / 2 + 1.6, width - 3.2, height - 3.2, height * 0.19, height * 0.19, "S");
    document.setFont("helvetica", "bold");
    document.setFontSize(pageWidth < 170 ? 15 : 19);
    document.text(status, centerX, centerY + (pageWidth < 170 ? 4.2 : 5), { align: "center" });
  }

  function drawTemplateShape() {
    if (templateStyle === "modern") {
      document.setFillColor(...colors.accent);
      document.triangle(pageWidth - 23, 0, pageWidth, 0, pageWidth, 23, "F");
      document.setFillColor(255, 255, 255);
      document.triangle(pageWidth - 7, 0, pageWidth, 0, pageWidth, 7, "F");
    } else if (templateStyle === "compact") {
      document.setFillColor(...colors.accent);
      document.rect(0, 0, Math.min(3, pageWidth * 0.015), pageHeight, "F");
    } else if (templateStyle === "elegant") {
      document.setDrawColor(...colors.accent);
      document.setLineWidth(0.45);
      document.circle(right - 5, 13, 4.5, "S");
      document.circle(right - 5, 13, 2.5, "S");
    }
  }

  function drawInvoiceHeading() {
    document.setFont("helvetica", "bold");
    document.setFontSize(pageWidth < 170 ? 14 : templateStyle === "compact" ? 16 : 19);
    document.setTextColor(...colors.accent);
    document.text("SALES INVOICE", left, 20);
    document.setFont("helvetica", "normal");
    document.setFontSize(pageWidth < 170 ? 6.5 : 8);
    document.setTextColor(...colors.muted);
    document.text(`Date & time: ${formattedDateTime}`, right, 20, { align: "right" });
    document.setDrawColor(...colors.accent);
    document.setLineWidth(templateStyle === "elegant" ? 0.8 : 0.45);
    document.line(left, 25, right, 25);

    document.setFont("helvetica", "normal");
    document.setFontSize(fontSize);
    document.setTextColor(...colors.muted);
    const rows = Math.max(leftHeaderLines.length, rightHeaderLines.length);
    for (let index = 0; index < rows; index += 1) {
      const lineY = 32 + index * 4;
      const leftLine = leftHeaderLines[index];
      const rightLine = rightHeaderLines[index];
      if (leftLine) document.text(leftLine, left, lineY);
      if (rightLine) document.text(rightLine, right, lineY, { align: "right" });
    }
  }

  function drawFirstPageHeader() {
    drawTemplateShape();
    drawInvoiceHeading();
    return headerBottom;
  }

  function drawAdditionalPageHeader() {
    drawTemplateShape();
    drawTableHeader(20);
  }

  const headerEnd = drawFirstPageHeader();
  const columnsStart = headerEnd + 5;
  drawTableHeader(columnsStart);
  let y = columnsStart + 11;

  const subtotal = sale.subtotalAmount ?? sale.amount;
  const discount = sale.discountAmount ?? 0;
  const taxAmount = sale.taxAmount ?? 0;
  const cashRoundingAmount = sale.cashRoundingAmount ?? 0;
  const paidAmount = sale.paidAmount ?? sale.amount;
  const changeCash = Math.max(0, paidAmount - sale.amount);
  const summaryRows: { label: string; amount: number; color: RGB; emphasis?: boolean }[] = [
    ...(discount > 0 || taxAmount > 0 ? [{ label: "Subtotal", amount: subtotal, color: colors.muted }] : []),
    ...(discount > 0 ? [{ label: "Discount", amount: -discount, color: colors.muted }] : []),
    ...(taxAmount > 0 ? [{ label: `VAT/TAX (${sale.taxRate ?? 0}%)`, amount: taxAmount, color: colors.muted }] : []),
    ...(cashRoundingAmount !== 0 ? [{ label: "Cash rounding", amount: cashRoundingAmount, color: colors.muted }] : []),
    { label: "Grand total", amount: sale.amount, color: colors.accent, emphasis: true },
    { label: "Pay amount", amount: paidAmount, color: colors.muted },
    { label: "Due", amount: sale.dueAmount ?? 0, color: (sale.dueAmount ?? 0) > 0 ? [173, 75, 67] : colors.accent },
    ...(changeCash > 0 ? [{ label: "Change cash", amount: changeCash, color: colors.accent }] : []),
  ];
  const summaryHeight = summaryRows.length * 6;
  const summaryTextWidth = Math.max(...summaryRows.map((row) => {
    document.setFont("helvetica", row.emphasis ? "bold" : "normal");
    document.setFontSize(row.emphasis ? (pageWidth < 170 ? 9 : 11) : (pageWidth < 170 ? 7 : 9));
    const amount = row.amount < 0
      ? `-${formatAmount(Math.abs(row.amount))}`
      : formatAmount(row.amount);
    return document.getTextWidth(`${row.label}: ${amount}`);
  }));
  const sealAvailableWidth = Math.max(0, contentWidth - summaryTextWidth - 4);
  const sealWidth = Math.min(40, pageWidth * 0.25, sealAvailableWidth);
  const sealHeight = sealWidth * 0.46;
  const summaryBlockHeight = Math.max(summaryHeight, showPaidSeal || showDueSeal ? sealHeight : 0);

  for (const [index, line] of sale.lines.entries()) {
    const productLines = document.splitTextToSize(
      [line.brand, line.details].filter(Boolean).join(" · "),
      productWidth,
    ) as string[];
    const batchLines = document.splitTextToSize(line.batchNumber || "-", batchWidth) as string[];
    const rowHeight = Math.max(productLines.length, batchLines.length, 1) * 4 + 5;

    const reservedSummaryHeight = index === sale.lines.length - 1 ? summaryBlockHeight + 8 : 0;
    if (y + rowHeight + reservedSummaryHeight > bodyBottom) {
      document.addPage();
      drawAdditionalPageHeader();
      y = 31;
    }

    document.setFontSize(fontSize);
    document.setTextColor(...colors.text);
    document.text(productLines, columns.brand + 2, y);
    document.text(batchLines, columns.batch, y);
    document.text(String(line.quantity), columns.quantity, y);
    document.text(document.splitTextToSize(formatAmount(line.unitPrice), unitPriceWidth) as string[], columns.unitPrice, y, { align: "right" });
    document.text(document.splitTextToSize(formatAmount(line.totalPrice), pageWidth * 0.14) as string[], columns.total, y, { align: "right" });
    y += rowHeight;
    document.setDrawColor(232, 238, 234);
    document.line(left, y - 2, right, y - 2);
  }

  summaryRows.forEach((row, index) => {
    document.setFont("helvetica", row.emphasis ? "bold" : "normal");
    document.setFontSize(row.emphasis ? (pageWidth < 170 ? 9 : 11) : (pageWidth < 170 ? 7 : 9));
    document.setTextColor(...row.color);
    const amount = row.amount < 0
      ? `-${formatAmount(Math.abs(row.amount))}`
      : formatAmount(row.amount);
    document.text(`${row.label}: ${amount}`, right, y + 5 + index * 6, { align: "right" });
  });
  if (showPaidSeal || showDueSeal) {
    drawPaymentSeal(
      left + sealAvailableWidth / 2,
      y + Math.max(summaryHeight, sealHeight) / 2 + 2,
      showPaidSeal ? "PAID" : "DUE",
      sealWidth,
    );
  }

  const totalPages = document.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    document.setPage(page);
    if (page > 1) drawTemplateShape();
    if (hasSignature) {
      if (settings.signature.type === "image" && settings.signature.imageDataUrl) {
        const imageFormat = settings.signature.imageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        document.addImage(settings.signature.imageDataUrl, imageFormat, left, footerTop - 24, 38, 12, undefined, "FAST");
      } else if (settings.signature.type === "text" && settings.signature.text.trim()) {
        document.setFont("times", "italic");
        document.setFontSize(12);
        document.setTextColor(...colors.text);
        document.text(settings.signature.text, left, footerTop - 15);
      }
      document.setDrawColor(142, 153, 146);
      document.line(left, footerTop - 5, left + 45, footerTop - 5);
      document.setFont("helvetica", "normal");
      document.setFontSize(7);
      document.setTextColor(...colors.muted);
      document.text("Signature", left, footerTop - 2);
    }
    document.setDrawColor(...colors.accent);
    document.setLineWidth(0.35);
    document.line(left, footerTop, right, footerTop);
    let footerY = footerTop + 6;
    document.setFont("helvetica", "normal");
    document.setFontSize(fontSize);
    document.setTextColor(...colors.muted);
    for (const line of footerLines) {
      document.text(line, left, footerY);
      footerY += 4;
    }
  }

  return document;
}

export function downloadSaleInvoicePdf(sale: SalesListRow, storeName = "Pharmacy Cluster") {
  createSaleInvoicePdf(sale, storeName).save(`${sale.invoice}.pdf`);
}

export function printSaleInvoicePdf(sale: SalesListRow, storeName = "Pharmacy Cluster") {
  const document = createSaleInvoicePdf(sale, storeName);
  document.autoPrint({ variant: "javascript" });
  const printWindow = window.open(document.output("bloburl").toString(), "_blank");
  if (!printWindow) {
    throw new Error("The invoice print window was blocked. Allow pop-ups and try again.");
  }
}
