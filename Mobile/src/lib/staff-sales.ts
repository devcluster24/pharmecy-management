export type StaffSale = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  amount: number;
  customer: string;
};

export function parseStaffSales(value: unknown, staffUserId: string): StaffSale[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Saved sales data has an invalid format.');

  const sales: StaffSale[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }

    const row = item as Record<string, unknown>;
    if (
      typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
      || typeof row.createdAt !== 'string'
      || Number.isNaN(Date.parse(row.createdAt))
      || (row.createdByUserId !== undefined && typeof row.createdByUserId !== 'string')
      || (row.invoice !== undefined && typeof row.invoice !== 'string')
      || (row.id !== undefined && typeof row.id !== 'string')
      || (row.customer !== undefined && typeof row.customer !== 'string')
    ) {
      throw new Error('Saved sales data contains an invalid invoice.');
    }

    if (row.createdByUserId !== staffUserId) continue;

    const invoiceNumber = typeof row.invoice === 'string' && row.invoice.trim()
      ? row.invoice.trim()
      : typeof row.id === 'string' && row.id.trim()
        ? row.id.trim()
        : '';
    if (!invoiceNumber) throw new Error('A staff sale is missing its invoice number.');

    sales.push({
      id: invoiceNumber,
      invoiceNumber,
      createdAt: row.createdAt,
      amount: row.amount,
      customer: typeof row.customer === 'string' ? row.customer : 'Customer',
    });
  }

  return sales.sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
}

export function getStaffSaleDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatStaffSaleCurrency(amount: number) {
  return `${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
