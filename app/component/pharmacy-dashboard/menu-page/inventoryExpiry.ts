export function isInventoryItemExpired(expDate: string, now = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(expDate);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;

  const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
  const expirationMonth = year * 12 + month;
  return expirationMonth < currentMonth;
}
