export function getPharmacyDisplayName(storeName: string) {
  const name = storeName.trim();
  if (!name) return 'Pharmacy';
  return /pharmacy/i.test(name) ? name : `${name} Pharmacy`;
}
