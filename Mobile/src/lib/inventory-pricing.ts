export function getInventoryPackPrice(mrp?: string) {
  const parsedMrp = mrp?.trim();
  return parsedMrp && parsedMrp !== '-' ? parsedMrp : '-';
}

export function getInventoryUnitPrice(packPrice: string, packSize: string) {
  if (!packPrice.trim() || packPrice.trim() === '-' || !packSize.trim()) return null;
  const parsedPackPrice = Number(packPrice);
  const factors = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((factor) =>
    Number(factor.replace(/,/g, '')),
  ) ?? [];
  if (
    !Number.isFinite(parsedPackPrice)
    || parsedPackPrice < 0
    || factors.length === 0
    || factors.some((factor) => !Number.isFinite(factor) || factor <= 0)
  ) return null;
  const packMultiplier = factors.reduce((total, factor) => total * factor, 1);
  return Number.isFinite(packMultiplier) && packMultiplier > 0
    ? Number((parsedPackPrice / packMultiplier).toFixed(4))
    : null;
}
