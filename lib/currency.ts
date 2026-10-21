export type CurrencyCode = "BDT" | "USD" | "INR" | "EUR";

export const CURRENCY_STORAGE_KEY = "pharmacy-currency";

export const currencyOptions: {
  code: CurrencyCode;
  label: string;
  symbol: string;
}[] = [
  { code: "BDT", label: "Taka", symbol: "৳" },
  { code: "USD", label: "USD", symbol: "$" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "EUR", label: "Euro", symbol: "€" },
];

let activeCurrency: CurrencyCode = currencyOptions[0].code;

export function setActiveCurrency(currency: CurrencyCode) {
  activeCurrency = currency;
}

export function getCurrencySymbol(): string {
  return currencyOptions.find((option) => option.code === activeCurrency)?.symbol ?? currencyOptions[0].symbol;
}
