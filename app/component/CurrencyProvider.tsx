"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CURRENCY_STORAGE_KEY,
  currencyOptions,
  setActiveCurrency,
  type CurrencyCode,
} from "@/lib/currency";

export type { CurrencyCode };

type CurrencyContextValue = {
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencyError: string;
};

const CHANGE_EVENT = "pharmacy-currency-change";
const defaultCurrency: CurrencyCode = "BDT";
const context = createContext<CurrencyContextValue>({
  currency: defaultCurrency,
  setCurrency: () => {},
  currencyError: "",
});

let fallbackCurrency: CurrencyCode = defaultCurrency;

const textCurrency = new WeakMap<CharacterData, { original: string; rendered: string }>();
const attributeCurrency = new WeakMap<Element, Map<string, { original: string; rendered: string }>>();

function getStoredCurrency(): CurrencyCode {
  if (typeof window === "undefined") return defaultCurrency;

  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    fallbackCurrency = currencyOptions.find((option) => option.code === stored)?.code ?? defaultCurrency;
  } catch (error) {
    console.error("Could not read the currency preference.", error);
  }

  return fallbackCurrency;
}

function subscribeToCurrency(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function renderCurrencyText(node: CharacterData, currency: CurrencyCode) {
  const value = node.textContent ?? "";
  const previous = textCurrency.get(node);
  const original = previous?.rendered === value ? previous.original : value;
  const symbol = currencyOptions.find((option) => option.code === currency)?.symbol ?? "৳";
  const rendered = symbol === "৳" ? original : original.replaceAll("৳", symbol);
  textCurrency.set(node, { original, rendered });
  if (rendered !== value) node.textContent = rendered;
}

function renderCurrencyAttribute(element: Element, attribute: string, currency: CurrencyCode) {
  const value = element.getAttribute(attribute);
  if (value === null) return;

  let attributes = attributeCurrency.get(element);
  if (!attributes) {
    attributes = new Map();
    attributeCurrency.set(element, attributes);
  }

  const previous = attributes.get(attribute);
  const original = previous?.rendered === value ? previous.original : value;
  const symbol = currencyOptions.find((option) => option.code === currency)?.symbol ?? "৳";
  const rendered = symbol === "৳" ? original : original.replaceAll("৳", symbol);
  attributes.set(attribute, { original, rendered });
  if (rendered !== value) element.setAttribute(attribute, rendered);
}

function renderCurrencyNode(node: Node, currency: CurrencyCode) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = (node as CharacterData).parentElement;
    if (parent?.closest("script, style, textarea, [contenteditable='true']")) return;
    renderCurrencyText(node as CharacterData, currency);
    return;
  }
  if (!(node instanceof Element)) return;

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const parent = textNode.parentElement;
    if (parent?.closest("script, style, textarea, [contenteditable='true']")) continue;
    renderCurrencyText(textNode as CharacterData, currency);
  }

  for (const element of [node, ...node.querySelectorAll("*")]) {
    if (element.matches("[contenteditable='true']")) continue;
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      renderCurrencyAttribute(element, attribute, currency);
    }
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currencyError, setCurrencyError] = useState("");
  const currency = useSyncExternalStore<CurrencyCode>(
    subscribeToCurrency,
    getStoredCurrency,
    () => defaultCurrency,
  );

  const setCurrency = useCallback((nextCurrency: CurrencyCode) => {
    fallbackCurrency = nextCurrency;
    setActiveCurrency(nextCurrency);
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, nextCurrency);
      setCurrencyError("");
    } catch (error) {
      console.error("Could not save the currency preference.", error);
      setCurrencyError(error instanceof Error ? error.message : "Could not save the currency preference.");
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  useEffect(() => {
    setActiveCurrency(currency);
    const root = document.body;
    renderCurrencyNode(root, currency);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) {
          renderCurrencyAttribute(record.target, record.attributeName ?? "", currency);
          continue;
        }
        for (const node of record.addedNodes) renderCurrencyNode(node, currency);
        if (record.type === "characterData") renderCurrencyNode(record.target, currency);
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder"],
    });
    return () => observer.disconnect();
  }, [currency]);

  const value = useMemo(
    () => ({ currency, setCurrency, currencyError }),
    [currency, setCurrency, currencyError],
  );
  return <context.Provider value={value}>{children}</context.Provider>;
}

export function useCurrency() {
  return useContext(context);
}
