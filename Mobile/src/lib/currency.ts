export type AppCurrency = 'BDT' | 'USD' | 'INR' | 'EUR';

export const appCurrencyOptions: { code: AppCurrency; label: string; symbol: string }[] = [
  { code: 'BDT', label: 'Taka', symbol: '৳' },
  { code: 'USD', label: 'USD', symbol: '$' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
];

let activeCurrency: AppCurrency = 'BDT';

export function setActiveCurrency(currency: AppCurrency) {
  activeCurrency = currency;
}

export function getCurrencySymbol() {
  return appCurrencyOptions.find((option) => option.code === activeCurrency)?.symbol ?? '৳';
}

export function replaceCurrencySymbol(value: string, currency = activeCurrency) {
  const symbol = appCurrencyOptions.find((option) => option.code === currency)?.symbol ?? '৳';
  return symbol === '৳' ? value : value.replaceAll('৳', symbol);
}
