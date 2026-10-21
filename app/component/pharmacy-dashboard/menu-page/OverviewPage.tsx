'use client';

import { Fragment, useState, useSyncExternalStore } from "react";
import { getCurrencySymbol } from "@/lib/currency";
import Sidebar from "../components/Sidebar";
import PharmacyProfileMenu from "../components/PharmacyProfileMenu";
import DashboardLanguageMenu from "../components/DashboardLanguageMenu";
import PharmacyDashboardBrand, { usePharmacyStoreName } from "../components/PharmacyDashboardBrand";
import {
  emptyExpensesSnapshot,
  getExpensesSnapshot,
  subscribeToExpenses,
} from "./expensesStorage";
import {
  emptyLowStockThresholdSnapshot,
  getLowStockThresholdSnapshot,
  subscribeToLowStockThreshold,
} from "./lowStockStorage";
import {
  emptyPurchaseListSnapshot,
  getAvailablePurchaseQuantity,
  getPurchaseListSnapshot,
  subscribeToPurchaseList,
  type PurchaseListRow,
} from "./purchaseStorage";
import {
  emptySalesListSnapshot,
  getSalesListSnapshot,
  subscribeToSalesList,
} from "./salesStorage";
import { isInventoryItemExpired } from "./inventoryExpiry";

const periods = ["Daily", "Weekly", "Monthly"] as const;
type Period = (typeof periods)[number];

type ChartPoint = { label: string; sales: number; purchases: number };

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getLocalDateKey(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? toDateKey(new Date(timestamp)) : null;
}

function getDateFromKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function formatCurrency(amount: number) {
  return `${getCurrencySymbol()}${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(amount: number) {
  return amount.toLocaleString("en-BD", { maximumFractionDigits: 4 });
}

function getPurchaseAmount(row: PurchaseListRow) {
  const amount = Number(row.totalPrice);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function getUnitPurchaseCost(value?: string) {
  if (!value?.trim() || value.trim() === "-") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function isExpiringWithinThreeMonths(expDate: string, now: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(expDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
  const expirationMonth = year * 12 + month;
  const monthsUntilExpiry = expirationMonth - currentMonth;
  return monthsUntilExpiry >= 0 && monthsUntilExpiry <= 3;
}

function makeChartData(period: Period, now: Date, sales: ReturnType<typeof getSalesListSnapshot>["rows"], purchases: PurchaseListRow[]): ChartPoint[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: { start: Date; end: Date; label: string }[] = [];
  if (period === "Daily") {
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      buckets.push({
        start: date,
        end: new Date(date),
        label: date.toLocaleDateString("en-BD", { weekday: "short", day: "numeric" }),
      });
    }
  } else if (period === "Weekly") {
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(currentWeekStart);
      start.setDate(currentWeekStart.getDate() - offset * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      if (end > today) end.setTime(today.getTime());
      buckets.push({
        start,
        end,
        label: start.toLocaleDateString("en-BD", { day: "numeric", month: "short" }),
      });
    }
  } else {
    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      if (end > today) end.setTime(today.getTime());
      buckets.push({
        start,
        end,
        label: start.toLocaleDateString("en-BD", { month: "short" }),
      });
    }
  }

  return buckets.map(({ start, end, label }) => {
    const startKey = toDateKey(start);
    const endKey = toDateKey(end);
    const inBucket = (value: string) => {
      const dateKey = getLocalDateKey(value);
      return dateKey !== null && dateKey >= startKey && dateKey <= endKey;
    };
    return {
      label,
      sales: sales.filter((sale) => inBucket(sale.createdAt))
        .reduce((total, sale) => total + sale.amount, 0),
      purchases: purchases.filter((row) => inBucket(row.orderDate))
        .reduce((total, row) => total + getPurchaseAmount(row), 0),
    };
  });
}

function getStockCost(row: PurchaseListRow) {
  return getUnitPurchaseCost(row.unitPurchasePrice);
}

function getProductIdentity(brand: string, details: string) {
  return `${brand.trim().toLocaleLowerCase()}\u0000${details.trim().toLocaleLowerCase()}`;
}

function getBatchIdentity(brand: string, batchNumber: string) {
  return `${brand.trim().toLocaleLowerCase()}\u0000${batchNumber.trim().toLocaleLowerCase()}`;
}

function ProductTable({
  title,
  subtitle,
  columns,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const renderHeader = () => (
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column} style={{ padding: "10px 14px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#78857e", fontSize: 10, fontWeight: 650, whiteSpace: "nowrap" }}>{column}</th>
        ))}
      </tr>
    </thead>
  );
  const renderRow = (row: string[], rowIndex: number) => (
    <tr
      className={expandedRow === rowIndex ? "overview-product-row is-expanded" : "overview-product-row"}
      tabIndex={0}
      aria-expanded={expandedRow === rowIndex}
      onClick={() => {
        if (!window.matchMedia("(max-width: 767px)").matches) return;
        setExpandedRow((current) => current === rowIndex ? null : rowIndex);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (!window.matchMedia("(max-width: 767px)").matches) return;
          event.preventDefault();
          setExpandedRow((current) => current === rowIndex ? null : rowIndex);
        }
      }}
    >
      {row.map((cell, index) => (
        <td key={`${index}-${cell}`} style={{ padding: "12px 14px", borderBottom: "1px solid #f0f2f0", color: index === 0 ? "#26372f" : "#64736b", fontSize: 11, fontWeight: index === 0 ? 600 : 400, whiteSpace: "nowrap" }}>{cell}</td>
      ))}
    </tr>
  );
  const renderDetailsPanel = (row: string[]) => (
    <div
      className="overview-product-details-panel"
      role="button"
      tabIndex={0}
      aria-label={`Collapse details for ${row[0]}`}
      onClick={() => setExpandedRow(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpandedRow(null);
        }
      }}
    >
      <div className="overview-product-details">
        {row.map((cell, index) => (
          <span
            className="overview-product-detail-value"
            data-column={columns[index]}
            key={`${columns[index]}-${cell}`}
          >
            {cell}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <section className="overview-product-table" style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid #edf0ed" }}>
        <h2 className="overview-table-title" style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>{title}</h2>
        <p className="overview-table-subtitle" style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>{subtitle}</p>
      </div>
      <div
        className="overview-product-table-scroll"
        style={{ overflowX: "auto" }}
      >
        <table className="overview-product-table-grid" style={{ width: "100%", minWidth: 430, borderCollapse: "collapse", textAlign: "left" }}>
          {renderHeader()}
          <tbody>
            {rows.length > 0
              ? rows.map((row, rowIndex) => <Fragment key={row[0]}>{renderRow(row, rowIndex)}</Fragment>)
              : <tr><td colSpan={columns.length} style={{ padding: "18px 14px", color: "#87938c", fontSize: 11 }}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="overview-mobile-product-list">
        <div className="overview-mobile-product-header">
          <table className="overview-product-table-grid" style={{ width: "100%", minWidth: 430, borderCollapse: "collapse", textAlign: "left" }}>
            {renderHeader()}
          </table>
        </div>
        {rows.length > 0
          ? rows.map((row, rowIndex) => (
            <Fragment key={`mobile-${row[0]}`}>
              <div className="overview-mobile-product-row">
                <table className="overview-product-table-grid" style={{ width: "100%", minWidth: 430, borderCollapse: "collapse", textAlign: "left" }}>
                  <tbody>{renderRow(row, rowIndex)}</tbody>
                </table>
              </div>
              {expandedRow === rowIndex && renderDetailsPanel(row)}
            </Fragment>
          ))
          : <div className="overview-mobile-product-empty">{emptyMessage}</div>}
      </div>
      <div style={{ padding: "10px 14px", color: "#87938c", fontSize: 10 }}>Showing {rows.length} products</div>
    </section>
  );
}

export default function OverviewPage() {
  const storeName = usePharmacyStoreName();
  const [period, setPeriod] = useState<Period>("Daily");
  const salesSnapshot = useSyncExternalStore(subscribeToSalesList, getSalesListSnapshot, () => emptySalesListSnapshot);
  const purchaseSnapshot = useSyncExternalStore(subscribeToPurchaseList, getPurchaseListSnapshot, () => emptyPurchaseListSnapshot);
  const expensesSnapshot = useSyncExternalStore(subscribeToExpenses, getExpensesSnapshot, () => emptyExpensesSnapshot);
  const lowStockSnapshot = useSyncExternalStore(
    subscribeToLowStockThreshold,
    getLowStockThresholdSnapshot,
    () => emptyLowStockThresholdSnapshot,
  );
  const now = new Date();
  const todayKey = toDateKey(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const receivedPurchases = purchaseSnapshot.rows.filter((row) => row.status !== "Placed");
  const salesToday = salesSnapshot.rows.filter((sale) => getLocalDateKey(sale.createdAt) === todayKey);
  const purchasesToday = receivedPurchases.filter((row) => getLocalDateKey(row.orderDate) === todayKey);
  const expensesToday = expensesSnapshot.rows.filter((expense) => expense.date === todayKey);
  const salesTotal = salesToday.reduce((total, sale) => total + sale.amount, 0);
  const purchaseTotal = purchasesToday.reduce((total, row) => total + getPurchaseAmount(row), 0);
  const expenseTotal = expensesToday.reduce((total, expense) => total + expense.amount, 0);
  const todayPurchaseOrders = new Set(purchasesToday.map((row) => row.order)).size;

  const purchaseCostsByBatch = new Map<string, PurchaseListRow[]>();
  for (const row of receivedPurchases) {
    const key = getBatchIdentity(row.brand, row.batchNumber);
    purchaseCostsByBatch.set(key, [...(purchaseCostsByBatch.get(key) ?? []), row]);
  }
  let cogsTotal = 0;
  let costedLines = 0;
  let missingLines = 0;
  let missingInvoiceDetails = 0;
  for (const sale of salesToday) {
    for (const line of sale.lines ?? []) {
      let unitCost = line.unitPurchasePrice ?? null;
      if (unitCost === null) {
        const saleDateKey = getLocalDateKey(sale.createdAt);
        const possibleCosts = (purchaseCostsByBatch.get(getBatchIdentity(line.brand, line.batchNumber)) ?? [])
          .filter((row) => {
            const purchaseDateKey = getLocalDateKey(row.orderDate);
            return saleDateKey !== null && purchaseDateKey !== null && purchaseDateKey < saleDateKey;
          })
          .map((row) => getStockCost(row))
          .filter((cost): cost is number => cost !== null);
        const uniqueCosts = new Map(possibleCosts.map((cost) => [cost.toFixed(4), cost]));
        if (uniqueCosts.size === 1) unitCost = [...uniqueCosts.values()][0];
      }
      if (unitCost === null) {
        missingLines += 1;
      } else {
        costedLines += 1;
        cogsTotal += unitCost * line.quantity;
      }
    }
    if (!sale.lines?.length && sale.items > 0) missingInvoiceDetails += 1;
  }
  cogsTotal = Number(cogsTotal.toFixed(2));
  const netSalesBeforeReturns = salesToday.reduce((total, sale) => {
    const netAmount = sale.subtotalAmount !== undefined
      ? sale.subtotalAmount - (sale.discountAmount ?? 0)
      : sale.amount - (sale.taxAmount ?? 0) - (sale.cashRoundingAmount ?? 0) - (sale.discountAmount ?? 0);
    return total + netAmount;
  }, 0);
  const grossProfit = Number((netSalesBeforeReturns - cogsTotal).toFixed(2));

  const customerDueByIdentity = new Map<string, number>();
  for (const sale of salesSnapshot.rows) {
    const due = Math.max(0, sale.dueAmount ?? sale.amount - (sale.paidAmount ?? sale.amount));
    if (due <= 0) continue;
    const phone = sale.phone?.replace(/\D/g, "") ?? "";
    const key = `${sale.customer.trim().toLocaleLowerCase()}\u0000${phone}`;
    const existing = customerDueByIdentity.get(key);
    customerDueByIdentity.set(key, (existing ?? 0) + due);
  }
  const totalCustomerDue = [...customerDueByIdentity.values()].reduce((total, due) => total + due, 0);

  const threshold = Number(lowStockSnapshot.threshold);
  const lowStockEnabled = Number.isInteger(threshold) && threshold > 0;
  let lowStockCount = 0;
  let expiringCount = 0;
  let expiredCount = 0;
  let totalStockValue = 0;
  let stockValueCoverage = 0;
  const productCount = new Set<string>();
  const activeStockRows = receivedPurchases.filter((row) => {
    const quantity = getAvailablePurchaseQuantity(row);
    return quantity !== null && quantity > 0;
  });
  for (const row of activeStockRows) {
    const quantity = getAvailablePurchaseQuantity(row);
    if (quantity === null) continue;
    productCount.add(getProductIdentity(row.brand, `${row.genericName} ${row.strength} ${row.dosageForm}`));
    if (lowStockEnabled && quantity <= threshold) lowStockCount += 1;
    if (isInventoryItemExpired(row.expDate, now)) expiredCount += 1;
    else if (isExpiringWithinThreeMonths(row.expDate, now)) expiringCount += 1;
    const unitCost = getStockCost(row);
    if (unitCost !== null) {
      totalStockValue += quantity * unitCost;
      stockValueCoverage += 1;
    }
  }
  totalStockValue = Number(totalStockValue.toFixed(2));
  const stockValueIsComplete = stockValueCoverage === activeStockRows.length;

  const chartData = makeChartData(period, now, salesSnapshot.rows, receivedPurchases);
  const maxValue = Math.max(1, ...chartData.flatMap((item) => [item.sales, item.purchases]));

  const customerPaymentTotals = new Map<string, number>();
  for (const sale of salesSnapshot.rows) {
    const payments = sale.payments?.length
      ? sale.payments
      : (sale.paidAmount ?? sale.amount) > 0
        ? [{ methodName: sale.paymentMethodName?.trim() || "Cash", amount: sale.paidAmount ?? sale.amount }]
        : [];
    for (const payment of payments) {
      customerPaymentTotals.set(
        payment.methodName,
        (customerPaymentTotals.get(payment.methodName) ?? 0) + payment.amount,
      );
    }
  }
  const recordedPaymentTotal = [...customerPaymentTotals.values()].reduce((total, amount) => total + amount, 0);
  const visiblePaymentTotals = [...customerPaymentTotals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);

  const fastMovingProductsByKey = new Map<string, { product: string; brand: string; quantity: number; sales: number }>();
  for (const sale of salesToday) {
    for (const line of sale.lines ?? []) {
      const product = line.details.trim() || line.brand.trim() || "Unknown product";
      const key = getProductIdentity(line.brand, product);
      const existing = fastMovingProductsByKey.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.sales += line.totalPrice;
      } else {
        fastMovingProductsByKey.set(key, {
          product,
          brand: line.brand.trim() || "—",
          quantity: line.quantity,
          sales: line.totalPrice,
        });
      }
    }
  }
  const fastMovingProducts = [...fastMovingProductsByKey.values()]
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 4)
    .map((item) => [item.product, item.brand, `${formatQuantity(item.quantity)} units`, formatCurrency(item.sales)]);

  const latestSaleByBatch = new Map<string, string>();
  for (const sale of salesSnapshot.rows) {
    const saleDateKey = getLocalDateKey(sale.createdAt);
    if (!saleDateKey) continue;
    for (const line of sale.lines ?? []) {
      const key = getBatchIdentity(line.brand, line.batchNumber);
      const latest = latestSaleByBatch.get(key);
      if (!latest || saleDateKey > latest) latestSaleByBatch.set(key, saleDateKey);
    }
  }
  const deadStockByBatch = new Map<string, { product: string; quantity: number; days: number; value: number | null }>();
  for (const row of activeStockRows) {
    const quantity = getAvailablePurchaseQuantity(row);
    if (quantity === null || quantity <= 0) continue;
    const key = getBatchIdentity(row.brand, row.batchNumber);
    const lastSaleKey = latestSaleByBatch.get(key);
    const receivedDateKey = getLocalDateKey(row.orderDate);
    const lastActivityKey = lastSaleKey && receivedDateKey
      ? (lastSaleKey > receivedDateKey ? lastSaleKey : receivedDateKey)
      : lastSaleKey ?? receivedDateKey;
    const lastActivityDate = lastActivityKey ? getDateFromKey(lastActivityKey) : null;
    if (!lastActivityDate) continue;
    const daysSinceActivity = Math.floor((todayStart.getTime() - lastActivityDate.getTime()) / 86_400_000);
    if (daysSinceActivity < 60) continue;
    const identity = `${key}\u0000${row.genericName}\u0000${row.strength}`;
    const previous = deadStockByBatch.get(identity);
    const value = getStockCost(row);
    if (previous) {
      previous.quantity += quantity;
      previous.days = Math.max(previous.days, daysSinceActivity);
      previous.value = previous.value === null || value === null ? null : previous.value + quantity * value;
    } else {
      deadStockByBatch.set(identity, {
        product: [row.brand, row.strength].filter(Boolean).join(" ") || row.genericName || "Unknown product",
        quantity,
        days: daysSinceActivity,
        value: value === null ? null : quantity * value,
      });
    }
  }
  const deadStock = [...deadStockByBatch.values()]
    .sort((left, right) => right.days - left.days)
    .slice(0, 4)
    .map((item) => [
      item.product,
      `${formatQuantity(item.quantity)} units`,
      `${item.days} days`,
      item.value === null ? "Cost unavailable" : formatCurrency(item.value),
    ]);
  const storageErrors = [
    salesSnapshot.error,
    purchaseSnapshot.error,
    expensesSnapshot.error,
    lowStockSnapshot.error,
  ].filter(Boolean);
  const dateLabel = now.toLocaleDateString("en-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const metrics = [
    { label: "Today's Sales", value: formatCurrency(salesTotal), note: `${salesToday.length} invoices`, icon: "↗", color: "#16865f", background: "#e8f7ef" },
    { label: "Today's Purchase", value: formatCurrency(purchaseTotal), note: `${todayPurchaseOrders} received orders`, icon: "↙", color: "#2476a5", background: "#eaf4fa" },
    { label: "Est. Gross Profit", value: missingLines > 0 || missingInvoiceDetails > 0 ? `Partial ${formatCurrency(grossProfit)}` : formatCurrency(grossProfit), note: `${costedLines} of ${costedLines + missingLines} saved lines costed${missingInvoiceDetails > 0 ? ` · ${missingInvoiceDetails} invoice(s) lack product details` : ""}; before returns`, icon: "⌁", color: "#9a6a11", background: "#fbf3df" },
    { label: "Customer Due", value: formatCurrency(totalCustomerDue), note: `${customerDueByIdentity.size} customers with due`, icon: "৳", color: "#9a5411", background: "#fff0e1" },
    { label: "Today's Expenses", value: formatCurrency(expenseTotal), note: `${expensesToday.length} recorded expenses`, icon: "−", color: "#ae4545", background: "#fceeee" },
    { label: "Total Stock Value", value: stockValueIsComplete ? formatCurrency(totalStockValue) : `Partial ${formatCurrency(totalStockValue)}`, note: `${productCount.size} products · ${stockValueCoverage}/${activeStockRows.length} batches valued`, icon: "▤", color: "#6254a0", background: "#f0edfa" },
    { label: "Low Stock", value: lowStockEnabled ? `${lowStockCount} batches` : "Not set", note: lowStockEnabled ? `At or below ${formatQuantity(threshold)} units` : "Set a threshold in inventory settings", icon: "!", color: "#a15c12", background: "#fff2e5" },
    { label: "Near Expiry", value: `${expiringCount} batches`, note: "Expiring within 3 months", icon: "◷", color: "#a15c12", background: "#fff2e5" },
    { label: "Expired Stock", value: `${expiredCount} batches`, note: "Remove from sale", icon: "×", color: "#ae4545", background: "#fceeee" },
  ];
  const chartPeriodDescription = period === "Daily"
    ? "Daily totals for the last 7 days"
    : period === "Weekly"
      ? "Weekly totals for the last 6 weeks"
      : "Monthly totals for the last 6 months";

  return (
    <div className="dashboard-overview-page" style={{ minHeight: "100vh", background: "#f5f7f5", color: "#1f2d26", fontFamily: "Inter, Arial, sans-serif" }}>
      <header className="dashboard-navbar" style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #e6ebe7" }}>
        <PharmacyDashboardBrand />
        <div className="dashboard-navbar-actions" style={{ display: "flex", alignItems: "center", gap: 12, color: "#66756d", fontSize: 12 }}>
          <DashboardLanguageMenu />
          <span className="dashboard-navbar-store-name">{storeName || "Pharmacy Cluster"}</span>
          <PharmacyProfileMenu />
        </div>
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 62px)" }}>
        <Sidebar />
        <main className="dashboard-overview" style={{ flex: 1, minWidth: 0, padding: "28px clamp(16px, 3vw, 38px) 44px" }}>
          <div className="overview-heading-row" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
            <div>
              <div style={{ color: "#78867f", fontSize: 11, marginBottom: 6 }}>{dateLabel}</div>
              <h1 className="overview-heading" style={{ margin: 0, color: "#1d2c25", fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Overview</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#627168", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#23a876" }} />
              Live data from this browser
            </div>
          </div>

          {storageErrors.length > 0 && (
            <div role="alert" style={{ marginBottom: 14, padding: "11px 14px", border: "1px solid #f0c9c5", borderRadius: 7, background: "#fff5f4", color: "#9e3e35", fontSize: 12 }}>
              Some dashboard data could not be loaded: {storageErrors.join(" ")}
            </div>
          )}

          <section className="overview-metrics" aria-label="Today's business metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 18 }}>
            {metrics.map((metric) => (
              <article className="overview-metric-card" key={metric.label} style={{ minWidth: 0, minHeight: 112, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 15px", border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span className="overview-metric-label" style={{ color: "#68776f", fontSize: 11, fontWeight: 550 }}>{metric.label}</span>
                  <span className="overview-metric-icon" style={{ width: 25, height: 25, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 6, background: metric.background, color: metric.color, fontSize: 13, fontWeight: 700 }}>{metric.icon}</span>
                </div>
                <div className="overview-metric-value" style={{ marginTop: 11, color: "#203128", fontSize: 20, fontWeight: 720 }}>{metric.value}</div>
                <div className="overview-metric-note" style={{ marginTop: 4, color: metric.label === "Expired Stock" || metric.label === "Low Stock" ? "#a15c12" : "#89958e", fontSize: 10 }}>{metric.note}</div>
              </article>
            ))}
          </section>

          <section className="overview-sales-payments" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(250px, 0.9fr)", gap: 14, marginBottom: 18 }}>
            <article className="overview-sales-card" style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", padding: "16px 18px 12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 className="overview-section-title" style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Sales &amp; Purchase</h2>
                  <p style={{ margin: "5px 0 0", color: "#7a8981", fontSize: 11 }}>{chartPeriodDescription}</p>
                </div>
                <div aria-label="Chart period" style={{ display: "inline-flex", padding: 3, borderRadius: 6, background: "#f1f4f1", gap: 2 }}>
                  {periods.map((option) => (
                    <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)} style={{ border: 0, borderRadius: 4, padding: "6px 9px", background: period === option ? "#fff" : "transparent", color: period === option ? "#226d4e" : "#718078", boxShadow: period === option ? "0 1px 3px rgba(20,40,28,0.12)" : "none", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>{option}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 16, color: "#68776f", fontSize: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#27a879" }} />Sales</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "#9ccfba" }} />Purchase</span>
              </div>
              <div aria-label={`${period} sales and purchase bar chart`} role="img" style={{ height: 158, display: "flex", alignItems: "stretch", gap: 8, marginTop: 6, padding: "8px 4px 0", borderBottom: "1px solid #edf0ed", backgroundImage: "linear-gradient(to bottom, transparent 32%, #f0f3f0 32%, #f0f3f0 33%, transparent 33%, transparent 65%, #f0f3f0 65%, #f0f3f0 66%, transparent 66%)" }}>
                {chartData.map((item) => (
                  <div key={item.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
                    <div style={{ width: "100%", height: 124, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
                      <div title={`Sales ${formatCurrency(item.sales)}`} style={{ width: "min(22px, 38%)", height: `${Math.max(item.sales > 0 ? 4 : 0, (item.sales / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#27a879" }} />
                      <div title={`Purchase ${formatCurrency(item.purchases)}`} style={{ width: "min(22px, 38%)", height: `${Math.max(item.purchases > 0 ? 4 : 0, (item.purchases / maxValue) * 100)}%`, borderRadius: "3px 3px 0 0", background: "#9ccfba" }} />
                    </div>
                    <span style={{ minHeight: 16, color: "#87938c", fontSize: 9, whiteSpace: "nowrap" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="overview-payments-card" style={{ minWidth: 0, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff", padding: "16px 18px" }}>
              <h2 className="overview-section-title" style={{ margin: 0, color: "#20312a", fontSize: 15, fontWeight: 700 }}>Recorded payments</h2>
              <p style={{ margin: "5px 0 16px", color: "#7a8981", fontSize: 11 }}>All-time paid amounts saved on sales invoices; not account balances</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, paddingBottom: 15, borderBottom: "1px solid #edf0ed" }}>
                <span style={{ color: "#203128", fontSize: 27, fontWeight: 750 }}>{formatCurrency(recordedPaymentTotal)}</span>
                <span style={{ color: "#849188", fontSize: 10 }}>recorded</span>
              </div>
              <div style={{ display: "grid", gap: 13, paddingTop: 15 }}>
                {visiblePaymentTotals.length > 0 ? visiblePaymentTotals.map(([name, amount], index) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#65746b" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: ["#27a879", "#dc6695", "#4387ad", "#9a6a11"][index] }} />{name}</span>
                    <strong style={{ color: "#293a30", fontWeight: 650 }}>{formatCurrency(amount)}</strong>
                  </div>
                )) : <p style={{ margin: 0, paddingTop: 2, color: "#87938c", fontSize: 11 }}>No recorded payments yet.</p>}
              </div>
            </article>
          </section>

          <section className="overview-product-tables" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 390px), 1fr))", gap: 14 }}>
            <ProductTable title="Fast-moving products" subtitle="Top products by units sold today" columns={["Product", "Brand", "Units sold", "Sales"]} rows={fastMovingProducts} emptyMessage="No saved product-line sales for today." />
            <ProductTable title="Dead stock" subtitle="Available batches with no recorded sale for 60+ days; old invoice batch details may be incomplete" columns={["Product", "On hand", "No sale for", "Stock value"]} rows={deadStock} emptyMessage="No qualifying dead-stock batches found in available records." />
          </section>
        </main>
      </div>
    </div>
  );
}