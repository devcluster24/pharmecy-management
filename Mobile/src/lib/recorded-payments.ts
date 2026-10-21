import { getCurrencySymbol } from '@/lib/currency';

export const PAYMENT_COLORS = ['#27a879', '#dc6695', '#4387ad', '#9a6a11'];
export const DAILY_SUMMARY_DAYS = 10;

export type PaymentTotal = {
  name: string;
  amount: number;
};

export type DailyPaymentGroup = {
  dateKey: string;
  dateLabel: string;
  payments: PaymentTotal[];
};

export function formatCurrency(amount: number) {
  return `${getCurrencySymbol()}${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRecordedPayments(
  payload: unknown,
  days: number | null = DAILY_SUMMARY_DAYS,
  now = new Date(),
): { totals: PaymentTotal[]; dailyGroups: DailyPaymentGroup[] } {
  if (days !== null && (!Number.isInteger(days) || days < 1)) {
    throw new Error('The payment history period must be a positive number of days.');
  }
  if (!Array.isArray(payload)) throw new Error('Saved sales data has an invalid format.');

  const totals = new Map<string, number>();
  const dailyTotals = new Map<string, Map<string, number>>();
  const includedDateKeys = days === null ? null : new Set<string>();
  if (days !== null && includedDateKeys) {
    for (let daysAgo = 0; daysAgo < days; daysAgo += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
      includedDateKeys.add(getLocalDateKey(date));
    }
  }

  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }

    const invoice = item as Record<string, unknown>;
    if (typeof invoice.amount !== 'number' || !Number.isFinite(invoice.amount)) {
      throw new Error('Saved sales data contains an invalid invoice amount.');
    }
    const createdAt = typeof invoice.createdAt === 'string'
      ? new Date(invoice.createdAt)
      : null;
    const dateKey = createdAt && !Number.isNaN(createdAt.getTime())
      ? getLocalDateKey(createdAt)
      : null;
    const addPayment = (methodName: string, amount: number) => {
      totals.set(methodName, (totals.get(methodName) ?? 0) + amount);
      if (
        dateKey
        && (includedDateKeys === null || includedDateKeys.has(dateKey))
        && amount > 0
      ) {
        const dateTotals = dailyTotals.get(dateKey) ?? new Map<string, number>();
        dateTotals.set(methodName, (dateTotals.get(methodName) ?? 0) + amount);
        dailyTotals.set(dateKey, dateTotals);
      }
    };

    const payments = invoice.payments;
    if (Array.isArray(payments) && payments.length > 0) {
      for (const payment of payments) {
        if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
          throw new Error('Saved sales data contains an invalid payment.');
        }
        const record = payment as Record<string, unknown>;
        if (
          typeof record.methodName !== 'string'
          || typeof record.amount !== 'number'
          || !Number.isFinite(record.amount)
        ) {
          throw new Error('Saved sales data contains an invalid payment.');
        }
        addPayment(record.methodName, record.amount);
      }
      continue;
    }

    const paidAmount = invoice.paidAmount ?? invoice.amount;
    if (typeof paidAmount !== 'number' || !Number.isFinite(paidAmount)) {
      throw new Error('Saved sales data contains an invalid paid amount.');
    }
    if (paidAmount > 0) {
      const paymentMethodName = typeof invoice.paymentMethodName === 'string'
        ? invoice.paymentMethodName.trim()
        : '';
      addPayment(paymentMethodName || 'Cash', paidAmount);
    }
  }

  const formatDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const dateKeys = days === null
    ? [...dailyTotals.keys()].sort((left, right) => right.localeCompare(left))
    : Array.from({ length: days }, (_, daysAgo) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
      return getLocalDateKey(date);
    });
  const dailyGroups = dateKeys.map((dateKey) => {
    const dateTotals = dailyTotals.get(dateKey) ?? new Map<string, number>();
    const payments = [...dateTotals.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((left, right) => right.amount - left.amount);
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return { dateKey, dateLabel: formatDate.format(date), payments };
  });

  return {
    totals: [...totals.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((left, right) => right.amount - left.amount),
    dailyGroups,
  };
}
