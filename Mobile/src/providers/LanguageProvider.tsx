import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert as NativeAlert,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import {
  appCurrencyOptions,
  replaceCurrencySymbol,
  setActiveCurrency,
  type AppCurrency,
} from '@/lib/currency';

export type AppLanguage = 'en' | 'bn';
export type TextInput = NativeTextInput;
export { appCurrencyOptions };
export type { AppCurrency };

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  languageError: string;
  currency: AppCurrency;
  setCurrency: (currency: AppCurrency) => Promise<void>;
  currencyError: string;
};

const LANGUAGE_STORAGE_KEY = 'pharmacy-app-language';
const CURRENCY_STORAGE_KEY = 'pharmacy-app-currency';
const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: async () => {},
  languageError: '',
  currency: 'BDT',
  setCurrency: async () => {},
  currencyError: '',
});

const bengaliTranslations: Record<string, string> = {
  'Add': 'যোগ করুন',
  'Add Batch Details': 'ব্যাচের তথ্য যোগ করুন',
  'Add New Product': 'নতুন পণ্য যোগ করুন',
  'Add product details and pricing to your pharmacy list.': 'আপনার ফার্মেসির তালিকায় পণ্যের তথ্য ও মূল্য যোগ করুন।',
  'Add to Receive List': 'গ্রহণের তালিকায় যোগ করুন',
  'Add to return': 'ফেরতে যোগ করুন',
  'Adjust Amount': 'পরিমাণ সমন্বয়',
  'Adjustment amount': 'সমন্বয়ের পরিমাণ',
  'All Data Import': 'সব তথ্য ইমপোর্ট',
  'Already have an account?': 'ইতিমধ্যে অ্যাকাউন্ট আছে?',
  'Amount': 'পরিমাণ',
  'Back to Staff Management': 'স্টাফ ব্যবস্থাপনায় ফিরুন',
  'Back to plans': 'প্ল্যানে ফিরুন',
  'Batch': 'ব্যাচ',
  'Bill Summary': 'বিলের সারাংশ',
  'Bill summary': 'বিলের সারাংশ',
  'Brand Name': 'ব্র্যান্ডের নাম',
  'Brand Name / Supplier': 'ব্র্যান্ডের নাম / সরবরাহকারী',
  'Cancel': 'বাতিল',
  'Choose New Plan': 'নতুন প্ল্যান বেছে নিন',
  'Choose a subscription plan': 'একটি সাবস্ক্রিপশন প্ল্যান বেছে নিন',
  'Choose bKash or Nagad to continue with the subscription.': 'সাবস্ক্রিপশন চালিয়ে যেতে বিকাশ অথবা নগদ বেছে নিন।',
  'Choose your plan': 'আপনার প্ল্যান বেছে নিন',
  'Close': 'বন্ধ করুন',
  'Cluster Menu': 'ক্লাস্টার মেনু',
  'Company': 'কোম্পানি',
  'Create a unique URL for one staff signup. The link expires after 30 days.': 'একজন স্টাফের সাইনআপের জন্য আলাদা লিংক তৈরি করুন। লিংকটি ৩০ দিন পর মেয়াদোত্তীর্ণ হবে।',
  'Create an account': 'অ্যাকাউন্ট তৈরি করুন',
  'Create staff signup link': 'স্টাফ সাইনআপ লিংক তৈরি করুন',
  'Current Plan': 'বর্তমান প্ল্যান',
  'Current plan is not available.': 'বর্তমান প্ল্যান পাওয়া যায়নি।',
  'Customer name *': 'গ্রাহকের নাম *',
  'Customers': 'গ্রাহক',
  'Dashboard access unavailable': 'ড্যাশবোর্ডে প্রবেশ করা যাচ্ছে না',
  'Dashboard payments': 'ড্যাশবোর্ডের পেমেন্ট',
  'Dead stock': 'অচল স্টক',
  'Delete': 'মুছুন',
  'Demo checkout': 'ডেমো চেকআউট',
  'Demo payment only': 'শুধু ডেমো পেমেন্ট',
  'Discount': 'ছাড়',
  'Discount cannot exceed the total purchase price.': 'ছাড় মোট ক্রয়মূল্যের বেশি হতে পারে না।',
  'Edit': 'সম্পাদনা',
  'Email address': 'ইমেইল ঠিকানা',
  'Enter any two values to calculate the third price.': 'তৃতীয় মূল্য গণনা করতে যেকোনো দুটি মান লিখুন।',
  'Fast-moving products': 'দ্রুত বিক্রি হওয়া পণ্য',
  'Favourites': 'পছন্দের',
  'Find medicine': 'ওষুধ খুঁজুন',
  'Full name': 'পুরো নাম',
  'Generic Name': 'জেনেরিক নাম',
  'Good care starts with a better-organized pharmacy.': 'সুশৃঙ্খল ফার্মেসি থেকেই উন্নত সেবার শুরু।',
  'Import company products': 'কোম্পানির পণ্য ইমপোর্ট করুন',
  'Import one manufacturer or every product from the shared catalog.': 'শেয়ার করা ক্যাটালগ থেকে একটি প্রস্তুতকারকের অথবা সব পণ্য ইমপোর্ট করুন।',
  'Import product data': 'পণ্যের তথ্য ইমপোর্ট করুন',
  'Auto Sync': 'অটো সিঙ্ক',
  'New shared manufacturer products will be added to your product list automatically.': 'শেয়ার করা ক্যাটালগে নতুন প্রস্তুতকারকের পণ্য যোগ হলে স্বয়ংক্রিয়ভাবে আপনার পণ্যের তালিকায় যুক্ত হবে।',
  'Invoice history': 'ইনভয়েসের ইতিহাস',
  'Invoices': 'ইনভয়েস',
  'Items': 'আইটেম',
  'Login access': 'লগইন অ্যাক্সেস',
  'Enter a whole number equal to or greater than 0.': '০ অথবা তার বেশি একটি পূর্ণ সংখ্যা লিখুন।',
  'Low stock threshold saved.': 'কম স্টকের সীমা সংরক্ষিত হয়েছে।',
  'Could not save the low stock setting.': 'কম স্টকের সেটিং সংরক্ষণ করা যায়নি।',
  'Inventory settings are available to store owners.': 'ইনভেন্টরি সেটিং শুধু ফার্মেসির মালিকের জন্য।',
  'Low Stock Management': 'কম স্টক ব্যবস্থাপনা',
  'Set the quantity at which an item should be considered low in stock.': 'যে পরিমাণে পণ্যকে কম স্টক হিসেবে দেখানো হবে তা নির্ধারণ করুন।',
  'Loading inventory settings…': 'ইনভেন্টরি সেটিং লোড হচ্ছে…',
  'Low stock threshold (units)': 'কম স্টকের সীমা (ইউনিট)',
  'Enter quantity': 'পরিমাণ লিখুন',
  'Low Stock Monitoring Active': 'কম স্টক পর্যবেক্ষণ চালু',
  'Low Stock Not Working': 'কম স্টক পর্যবেক্ষণ বন্ধ',
  'Products with available stock at or below': 'যেসব পণ্যের মজুত',
  'units will appear in the Low Stock list.': 'ইউনিট বা তার কম, সেগুলো Low Stock তালিকায় দেখা যাবে।',
  'Enter and save a threshold greater than 0 to enable low stock monitoring.': 'কম স্টক পর্যবেক্ষণ চালু করতে ০-এর বেশি সীমা লিখে সংরক্ষণ করুন।',
  'Saving…': 'সংরক্ষণ হচ্ছে…',
  'Save': 'সংরক্ষণ',
  'VAT/TAX settings are available to store owners.': 'ভ্যাট/ট্যাক্স সেটিং শুধু ফার্মেসির মালিকের জন্য।',
  'Payment methods are available to store owners.': 'পেমেন্ট পদ্ধতি শুধু ফার্মেসির মালিকের জন্য।',
  'Add Payment Method': 'পেমেন্ট পদ্ধতি যোগ করুন',
  'Edit Payment Method': 'পেমেন্ট পদ্ধতি সম্পাদনা করুন',
  'Update Payment Method': 'পেমেন্ট পদ্ধতি হালনাগাদ করুন',
  'Payment type': 'পেমেন্টের ধরন',
  'Mobile Banking': 'মোবাইল ব্যাংকিং',
  'Bank Account': 'ব্যাংক অ্যাকাউন্ট',
  'Payment Method Name': 'পেমেন্ট পদ্ধতির নাম',
  'Select or enter a name': 'নাম নির্বাচন বা লিখুন',
  'Enter phone number': 'ফোন নম্বর লিখুন',
  'Bank Name': 'ব্যাংকের নাম',
  'Select bank': 'ব্যাংক নির্বাচন করুন',
  'Account Holder Name': 'অ্যাকাউন্টধারীর নাম',
  'Enter account holder name': 'অ্যাকাউন্টধারীর নাম লিখুন',
  'Account Number': 'অ্যাকাউন্ট নম্বর',
  'Enter account number': 'অ্যাকাউন্ট নম্বর লিখুন',
  'Branch': 'শাখা',
  'optional': 'ঐচ্ছিক',
  'Enter branch': 'শাখার নাম লিখুন',
  'District': 'জেলা',
  'Enter district': 'জেলার নাম লিখুন',
  'Enter a payment method name.': 'পেমেন্ট পদ্ধতির নাম লিখুন।',
  'Complete all required bank account fields.': 'ব্যাংক অ্যাকাউন্টের প্রয়োজনীয় সব তথ্য পূরণ করুন।',
  'This payment method name has already been added.': 'এই পেমেন্ট পদ্ধতির নাম ইতিমধ্যে যোগ করা হয়েছে।',
  'Payment method updated.': 'পেমেন্ট পদ্ধতি হালনাগাদ হয়েছে।',
  'Payment method saved.': 'পেমেন্ট পদ্ধতি সংরক্ষিত হয়েছে।',
  'Could not save payment methods.': 'পেমেন্ট পদ্ধতি সংরক্ষণ করা যায়নি।',
  'Payment method deleted.': 'পেমেন্ট পদ্ধতি মুছে ফেলা হয়েছে।',
  'Could not delete payment method.': 'পেমেন্ট পদ্ধতি মুছে ফেলা যায়নি।',
  'Delete payment method?': 'পেমেন্ট পদ্ধতি মুছবেন?',
  'This payment method will be deleted.': 'এই পেমেন্ট পদ্ধতিটি মুছে ফেলা হবে।',
  'Account Info': 'অ্যাকাউন্টের তথ্য',
  'Loading payment methods…': 'পেমেন্ট পদ্ধতি লোড হচ্ছে…',
  'No payment methods added yet.': 'এখনও কোনো পেমেন্ট পদ্ধতি যোগ করা হয়নি।',
  'Account Holder': 'অ্যাকাউন্টধারী',
  'VAT/TAX setup': 'ভ্যাট/ট্যাক্স সেটআপ',
  'The default is 0% until you set it. Applicable VAT and supplementary-duty rates depend on product classification and current NBR rules; confirm the correct rate for your products before applying it. You can change the rate on each sale.': 'আপনি সেট না করা পর্যন্ত ডিফল্ট হার ০% থাকবে। প্রযোজ্য ভ্যাট ও সম্পূরক শুল্ক পণ্যের শ্রেণি এবং বর্তমান NBR নিয়মের ওপর নির্ভর করে; প্রয়োগের আগে সঠিক হার নিশ্চিত করুন। প্রতিটি বিক্রয়ের সময় হার পরিবর্তন করা যাবে।',
  'Loading VAT/TAX settings…': 'ভ্যাট/ট্যাক্স সেটিং লোড হচ্ছে…',
  'Default VAT/TAX rate (%)': 'ডিফল্ট ভ্যাট/ট্যাক্স হার (%)',
  'VAT/TAX must be between 0 and 100%.': 'ভ্যাট/ট্যাক্স ০ থেকে ১০০%-এর মধ্যে হতে হবে।',
  'Default VAT/TAX rate saved.': 'ডিফল্ট ভ্যাট/ট্যাক্স হার সংরক্ষিত হয়েছে।',
  'Could not save VAT/TAX settings.': 'ভ্যাট/ট্যাক্স সেটিং সংরক্ষণ করা যায়নি।',
  'Per-sale adjustment': 'প্রতি বিক্রয়ে পরিবর্তন',
  'The saved rate is stored in this pharmacy’s Supabase account and prefilled for new sales on authorized devices. A cashier can adjust it for an individual sale without changing this default.': 'সংরক্ষিত হারটি ফার্মেসির Supabase অ্যাকাউন্টে রাখা হয় এবং অনুমোদিত ডিভাইসে নতুন বিক্রয়ের জন্য আগে থেকেই বসানো হয়। ক্যাশিয়ার ডিফল্ট পরিবর্তন না করেই একটি নির্দিষ্ট বিক্রয়ের হার বদলাতে পারবেন।',
  'Low Stock Not Working: enter and save a threshold greater than 0 in Settings.': 'কম স্টকের সতর্কতা কাজ করছে না: সেটিংসে ০-এর বেশি সীমা লিখে সংরক্ষণ করুন।',
  'Manage each staff member’s role, menu access, and login status.': 'প্রতিটি স্টাফের ভূমিকা, মেনু অ্যাক্সেস এবং লগইন অবস্থা পরিচালনা করুন।',
  'Manage supplier contacts, received orders, purchase totals and outstanding dues.': 'সরবরাহকারীর যোগাযোগ, গৃহীত অর্ডার, ক্রয়ের মোট এবং বকেয়া পরিচালনা করুন।',
  'Manage supplier orders and received stock': 'সরবরাহকারীর অর্ডার এবং গৃহীত স্টক পরিচালনা করুন',
  'Manage your pharmacy catalog, prices, and product availability.': 'আপনার ফার্মেসির ক্যাটালগ, মূল্য এবং পণ্যের প্রাপ্যতা পরিচালনা করুন।',
  'Manufacturer / company': 'প্রস্তুতকারক / কোম্পানি',
  'Month': 'মাস',
  'Net Refund Amount': 'নিট ফেরতের পরিমাণ',
  'New Sale': 'নতুন বিক্রয়',
  'New pharmacy updates will appear here.': 'ফার্মেসির নতুন আপডেট এখানে দেখা যাবে।',
  'New to Pharmacy Cluster?': 'Pharmacy Cluster-এ নতুন?',
  'Next': 'পরবর্তী',
  'No available inventory batches found.': 'কোনো উপলভ্য ইনভেন্টরি ব্যাচ পাওয়া যায়নি।',
  'No data': 'কোনো তথ্য নেই',
  'No favourites yet': 'এখনও কোনো পছন্দের আইটেম নেই',
  'No item details are available for this invoice.': 'এই ইনভয়েসের কোনো আইটেমের তথ্য নেই।',
  'No matching products found in saved sales invoices.': 'সংরক্ষিত বিক্রয় ইনভয়েসে মিলে যাওয়া পণ্য পাওয়া যায়নি।',
  'No new shared products available.': 'নতুন শেয়ার করা পণ্য নেই।',
  'No qualifying dead-stock batches found.': 'শর্ত পূরণ করে এমন কোনো অচল স্টক ব্যাচ পাওয়া যায়নি।',
  'No recorded payment history yet.': 'এখনও কোনো পেমেন্টের ইতিহাস নেই।',
  'No recorded payments yet.': 'এখনও কোনো পেমেন্ট রেকর্ড হয়নি।',
  'No recorded sales in the last 10 days.': 'গত ১০ দিনে কোনো বিক্রয় রেকর্ড হয়নি।',
  'No returns recorded': 'কোনো ফেরত রেকর্ড হয়নি',
  'No saved product-line sales for today.': 'আজকের কোনো পণ্যভিত্তিক বিক্রয় সংরক্ষিত নেই।',
  'No staff applications yet. Staff who sign up with your link will appear here.': 'এখনও কোনো স্টাফ আবেদন নেই। আপনার লিংক দিয়ে সাইন আপ করা স্টাফ এখানে দেখা যাবে।',
  'No staff members match this search.': 'এই অনুসন্ধানের সঙ্গে কোনো স্টাফ মেলেনি।',
  'No subscription plans are available.': 'কোনো সাবস্ক্রিপশন প্ল্যান উপলভ্য নেই।',
  'Notifications': 'বিজ্ঞপ্তি',
  'ONE PLACE FOR YOUR PHARMACY': 'আপনার ফার্মেসির সবকিছু এক জায়গায়',
  'Open shortcuts from Quick Access to add them here.': 'এখানে শর্টকাট যোগ করতে Quick Access থেকে খুলুন।',
  'Order summary': 'অর্ডারের সারাংশ',
  'Orders': 'অর্ডার',
  'Orders you create will appear here.': 'আপনার তৈরি করা অর্ডার এখানে দেখা যাবে।',
  'PHARMACY CLUSTER': 'ফার্মেসি ক্লাস্টার',
  'PHARMACY WORKSPACE': 'ফার্মেসি ওয়ার্কস্পেস',
  'Pack & pricing': 'প্যাক ও মূল্য',
  'Pay amount': 'পরিশোধের পরিমাণ',
  'Payment': 'পেমেন্ট',
  'Payment Method': 'পেমেন্টের পদ্ধতি',
  'Payment cannot exceed the subtotal.': 'পেমেন্ট উপমোটের বেশি হতে পারে না।',
  'Payment details could not be loaded.': 'পেমেন্টের তথ্য লোড করা যায়নি।',
  'Payment gateway credentials are not configured. Continuing simulates a successful payment and activates the selected plan; no money is charged.': 'পেমেন্ট গেটওয়ের তথ্য সেট করা নেই। চালিয়ে গেলে সফল পেমেন্টের অনুকরণ হবে এবং নির্বাচিত প্ল্যান চালু হবে; কোনো টাকা কাটা হবে না।',
  'Payment history': 'পেমেন্টের ইতিহাস',
  'Payment method': 'পেমেন্টের পদ্ধতি',
  'Permission': 'অনুমতি',
  'Pharmacy Cluster': 'ফার্মেসি ক্লাস্টার',
  'Phone Number': 'ফোন নম্বর',
  'Phone number (optional)': 'ফোন নম্বর (ঐচ্ছিক)',
  'Place Order': 'অর্ডার দিন',
  'Place Order List': 'অর্ডারের তালিকা',
  'Previous': 'আগেরটি',
  'Previous due adjustments': 'আগের বকেয়া সমন্বয়',
  'Previous payments': 'আগের পেমেন্ট',
  'Print Invoice': 'ইনভয়েস প্রিন্ট করুন',
  'Product Management': 'পণ্য ব্যবস্থাপনা',
  'Product details': 'পণ্যের বিবরণ',
  'Purchase': 'ক্রয়',
  'Purchase data is unavailable. Check your account connection.': 'ক্রয়ের তথ্য পাওয়া যাচ্ছে না। আপনার অ্যাকাউন্টের সংযোগ পরীক্ষা করুন।',
  'Purchase is available to store owners.': 'ক্রয় সুবিধাটি শুধু দোকানের মালিকদের জন্য।',
  'Quantity': 'পরিমাণ',
  'Quick Access': 'দ্রুত অ্যাক্সেস',
  'Receive List': 'গ্রহণের তালিকা',
  'Receive this item': 'এই আইটেমটি গ্রহণ করুন',
  'Received': 'গৃহীত',
  'Recent sales · Last 10 days': 'সাম্প্রতিক বিক্রয় · গত ১০ দিন',
  'Record Return': 'ফেরত রেকর্ড করুন',
  'Record a return to add it to the Return System.': 'ফেরত সিস্টেমে যোগ করতে একটি ফেরত রেকর্ড করুন।',
  'Recorded': 'রেকর্ড করা হয়েছে',
  'Recorded payments': 'রেকর্ড করা পেমেন্ট',
  'Recorded sale payments by date and payment method.': 'তারিখ এবং পেমেন্ট পদ্ধতি অনুযায়ী রেকর্ড করা বিক্রয় পেমেন্ট।',
  'Remove': 'সরান',
  'Retry': 'আবার চেষ্টা করুন',
  'Retry loading products': 'পণ্য লোড করতে আবার চেষ্টা করুন',
  'Return Invoice': 'ফেরত ইনভয়েস',
  'Return Method': 'ফেরতের পদ্ধতি',
  'Return Qty': 'ফেরতের পরিমাণ',
  'Return System': 'ফেরত ব্যবস্থা',
  'Return Deduction %': 'ফেরত কর্তনের হার %',
  'Saved Return Deduction': 'সংরক্ষিত ফেরত কর্তন',
  'Return deduction rate saved.': 'ফেরত কর্তনের হার সংরক্ষণ করা হয়েছে।',
  'Enter a return deduction rate between 0 and 100%.': 'ফেরত কর্তনের হার ০ থেকে ১০০ শতাংশের মধ্যে লিখুন।',
  'Return settings are available to store owners.': 'ফেরত সেটিংস শুধু স্টোর মালিকদের জন্য।',
  'Could not save the return deduction rate.': 'ফেরত কর্তনের হার সংরক্ষণ করা যায়নি।',
  'Loading return settings…': 'ফেরত সেটিংস লোড হচ্ছে…',
  'Total Return Amount': 'ফেরতের মোট পরিমাণ',
  'Deduction Amount': 'কর্তনের পরিমাণ',
  'Return': 'ফেরত',
  'Return data is unavailable. Check your account connection.': 'ফেরতের তথ্য পাওয়া যাচ্ছে না। আপনার অ্যাকাউন্টের সংযোগ পরীক্ষা করুন।',
  'Returns are available to store owners.': 'ফেরত সুবিধাটি শুধু দোকানের মালিকদের জন্য।',
  'Review customer invoices and outstanding balances.': 'গ্রাহকের ইনভয়েস এবং বকেয়া ব্যালেন্স দেখুন।',
  'Review refund details before recording this return.': 'ফেরত রেকর্ড করার আগে রিফান্ডের বিবরণ যাচাই করুন।',
  'Review returned products and record invoice returns.': 'ফেরত পণ্য দেখুন এবং ইনভয়েস ফেরত রেকর্ড করুন।',
  'SALES INVOICE': 'বিক্রয় ইনভয়েস',
  'STAY UP TO DATE': 'সর্বশেষ তথ্য জানুন',
  'Sales': 'বিক্রয়',
  'Sales & Purchase': 'বিক্রয় ও ক্রয়',
  'Saved sales invoices from your pharmacy.': 'আপনার ফার্মেসির সংরক্ষিত বিক্রয় ইনভয়েস।',
  'Search inventory and add a medicine to begin.': 'শুরু করতে ইনভেন্টরি খুঁজে একটি ওষুধ যোগ করুন।',
  'Search only products sold on saved invoices.': 'শুধু সংরক্ষিত ইনভয়েসে বিক্রি হওয়া পণ্য খুঁজুন।',
  'Select a company and one or more brands to place an order.': 'অর্ডার দিতে একটি কোম্পানি এবং এক বা একাধিক ব্র্যান্ড বেছে নিন।',
  'Select a plan to continue. You can review payment details on the next screen.': 'চালিয়ে যেতে একটি প্ল্যান বেছে নিন। পরের স্ক্রিনে পেমেন্টের তথ্য দেখতে পারবেন।',
  'Select available inventory and add items to the sale.': 'উপলভ্য ইনভেন্টরি বেছে নিয়ে বিক্রয়ে আইটেম যোগ করুন।',
  'Select payment method': 'পেমেন্টের পদ্ধতি বেছে নিন',
  'Setup fee is charged once; subscription charges use the Standard Subscription rate.': 'সেটআপ ফি একবার নেওয়া হয়; সাবস্ক্রিপশন ফি স্ট্যান্ডার্ড সাবস্ক্রিপশন হারে নেওয়া হয়।',
  'Share signup URL': 'সাইনআপ লিংক শেয়ার করুন',
  'Sign in': 'সাইন ইন',
  'Staff role': 'স্টাফের ভূমিকা',
  'Subscription payment': 'সাবস্ক্রিপশন পেমেন্ট',
  'Supplier Name': 'সরবরাহকারীর নাম',
  'Suppliers': 'সরবরাহকারী',
  'Tap the link to open the signup page in this app.': 'এই অ্যাপে সাইনআপ পেজ খুলতে লিংকে ট্যাপ করুন।',
  'Thank you for your purchase.': 'আপনার কেনাকাটার জন্য ধন্যবাদ।',
  'This payment will increase Paid Amount and reduce Total Due Amount.': 'এই পেমেন্ট পরিশোধিত পরিমাণ বাড়াবে এবং মোট বকেয়া কমাবে।',
  'This staff signup link is invalid. Ask your pharmacy owner to create a new one.': 'স্টাফ সাইনআপ লিংকটি সঠিক নয়। নতুন লিংকের জন্য ফার্মেসির মালিককে বলুন।',
  'Top products by units sold today': 'আজ বিক্রি হওয়া ইউনিট অনুযায়ী শীর্ষ পণ্য',
  'Total': 'মোট',
  'Total Amount': 'মোট পরিমাণ',
  'Total History': 'সম্পূর্ণ ইতিহাস',
  'Total Purchase Price': 'মোট ক্রয়মূল্য',
  'Total due amount': 'মোট বকেয়া',
  'Total due now': 'এখন মোট বকেয়া',
  'Total purchase': 'মোট ক্রয়',
  'Try again': 'আবার চেষ্টা করুন',
  'VAT/TAX %': 'ভ্যাট/ট্যাক্স %',
  'VAT/Tax (%)': 'ভ্যাট/ট্যাক্স (%)',
  'VAT/Tax must be between zero and 100%.': 'ভ্যাট/ট্যাক্স ০ থেকে ১০০-এর মধ্যে হতে হবে।',
  'Year': 'বছর',
  'Your dashboard plan changes only after a successful confirmation.': 'সফলভাবে নিশ্চিত হওয়ার পরেই আপনার ড্যাশবোর্ড প্ল্যান পরিবর্তিত হবে।',
  'recorded': 'রেকর্ড করা হয়েছে',
  'Expired': 'মেয়াদোত্তীর্ণ',
  'Subscription': 'সাবস্ক্রিপশন',
  'Overview': 'সারসংক্ষেপ',
  'Inventory': 'ইনভেন্টরি',
  'Supplier': 'সরবরাহকারী',
  'Home': 'হোম',
  'Menu': 'মেনু',
  'Logout': 'লগ আউট',
  'Staff Management': 'স্টাফ ব্যবস্থাপনা',
  'Setting': 'সেটিংস',
  'Language': 'ভাষা',
  'Currency': 'মুদ্রা',
  'Taka': 'টাকা',
  'Indian Rupee': 'ভারতীয় রুপি',
  'Where this currency is used': 'এই মুদ্রা যেসব জায়গায় ব্যবহৃত হবে',
  'Home dashboard': 'হোম ড্যাশবোর্ড',
  'Sales and invoices': 'বিক্রয় ও ইনভয়েস',
  'Purchases and inventory': 'ক্রয় ও ইনভেন্টরি',
  'Returns and customer balances': 'ফেরত ও গ্রাহকের বকেয়া',
  'Suppliers, expenses, and reports': 'সরবরাহকারী, খরচ ও রিপোর্ট',
  'Payments and subscription screens': 'পেমেন্ট ও সাবস্ক্রিপশন পেজ',
  'BackUp File': 'ব্যাকআপ ফাইল',
  'BackUp Setting': 'ব্যাকআপ সেটিংস',
  'Pharmacy Setup': 'ফার্মেসি সেটআপ',
  'Vat/Tax': 'ভ্যাট/ট্যাক্স',
  'Payment Methord': 'পেমেন্ট পদ্ধতি',
  'Return Management': 'ফেরত ব্যবস্থাপনা',
  'Documents': 'ডকুমেন্ট',
  'Profile': 'প্রোফাইল',
  'Today’s Sale': 'আজকের বিক্রয়',
  'Today\'s Sale': 'আজকের বিক্রয়',
  'Create account': 'অ্যাকাউন্ট তৈরি করুন',
  'Welcome back': 'আবারও স্বাগতম',
  'Start with your details': 'আপনার তথ্য দিয়ে শুরু করুন',
  'Create an account for your pharmacy workspace.': 'আপনার ফার্মেসি ওয়ার্কস্পেসের জন্য অ্যাকাউন্ট তৈরি করুন।',
  'Sign in to continue to your pharmacy dashboard.': 'ফার্মেসি ড্যাশবোর্ডে যেতে সাইন ইন করুন।',
  'Your full name': 'আপনার পুরো নাম',
  'At least 8 characters': 'কমপক্ষে ৮টি অক্ষর',
  'Enter your password': 'আপনার পাসওয়ার্ড লিখুন',
  'you@example.com': 'you@example.com',
  'Search customers': 'গ্রাহক খুঁজুন',
  'Search customer, phone or invoice': 'গ্রাহক, ফোন অথবা ইনভয়েস খুঁজুন',
  'Search invoices': 'ইনভয়েস খুঁজুন',
  'Search invoice, customer, phone or payment': 'ইনভয়েস, গ্রাহক, ফোন অথবা পেমেন্ট খুঁজুন',
  'Search suppliers': 'সরবরাহকারী খুঁজুন',
  'Search supplier name or phone': 'সরবরাহকারীর নাম অথবা ফোন খুঁজুন',
  'Search staff': 'স্টাফ খুঁজুন',
  'Search staff…': 'স্টাফ খুঁজুন…',
  'Search products…': 'পণ্য খুঁজুন…',
  'Search inventory brand or generic name': 'ইনভেন্টরিতে ব্র্যান্ড অথবা জেনেরিক নাম খুঁজুন',
  'Create staff account': 'স্টাফ অ্যাকাউন্ট তৈরি করুন',
  'Continue with Google': 'Google দিয়ে চালিয়ে যান',
  'Email': 'ইমেইল',
  'Password': 'পাসওয়ার্ড',
  'A clearer day, from the very first sign in.': 'প্রথম সাইন ইন থেকেই আরও গুছানো দিনের শুরু।',
  'A secure workspace for your pharmacy team': 'আপনার ফার্মেসি টিমের জন্য নিরাপদ ওয়ার্কস্পেস',
  'All-time paid amounts saved on sales invoices': 'বিক্রয় ইনভয়েসে সংরক্ষিত সর্বমোট পরিশোধিত অর্থ',
  'All-time paid amounts saved on sales invoices; not account balances.': 'বিক্রয় ইনভয়েসে সংরক্ষিত সর্বমোট পরিশোধিত অর্থ; অ্যাকাউন্ট ব্যালেন্স নয়।',
  'Available batches with no recorded sale for 60+ days': '৬০ দিন বা তার বেশি সময়ে বিক্রি হয়নি এমন ব্যাচ',
  '3 of 3': '৩টির মধ্যে ৩',
  'DEMO': 'ডেমো',
  'Destroying…': 'মুছে ফেলা হচ্ছে…',
  'Finishing Google signup…': 'Google সাইনআপ সম্পন্ন হচ্ছে…',
  'Loading company and brand suggestions…': 'কোম্পানি ও ব্র্যান্ডের পরামর্শ লোড হচ্ছে…',
  'Loading notifications…': 'বিজ্ঞপ্তি লোড হচ্ছে…',
  'Loading purchase orders…': 'ক্রয় অর্ডার লোড হচ্ছে…',
  'Loading return records…': 'ফেরতের রেকর্ড লোড হচ্ছে…',
  'You’re all caught up': 'আপনি সব আপডেট দেখে ফেলেছেন',
  'Add billing period': 'বিলিং সময় যোগ করুন',
  'Active suppliers': 'সক্রিয় সরবরাহকারী',
  'Amount to add to invoice': 'ইনভয়েসে যোগ করার পরিমাণ',
  'Batch Number': 'ব্যাচ নম্বর',
  'Box MRP': 'বক্সের সর্বোচ্চ খুচরা মূল্য',
  'Box Quantity': 'বক্সের পরিমাণ',
  'Brand Name *': 'ব্র্যান্ডের নাম *',
  'Brands': 'ব্র্যান্ড',
  'Cash rounding': 'নগদ রাউন্ডিং',
  'Change cash': 'ফেরত নগদ',
  'Company Name': 'কোম্পানির নাম',
  'Company Name *': 'কোম্পানির নাম *',
  'Current Total Due': 'বর্তমান মোট বকেয়া',
  'Current Total Purchase': 'বর্তমান মোট ক্রয়',
  'Customer': 'গ্রাহক',
  'Customer name': 'গ্রাহকের নাম',
  'Customer phone number': 'গ্রাহকের ফোন নম্বর',
  'Customer management': 'গ্রাহক ব্যবস্থাপনা',
  'Date & time': 'তারিখ ও সময়',
  'Date and time': 'তারিখ ও সময়',
  'Discount amount or percentage': 'ছাড়ের পরিমাণ অথবা শতাংশ',
  'Dosage Form': 'ঔষধের ধরন',
  'Due': 'বকেয়া',
  'Enter amount': 'পরিমাণ লিখুন',
  'Enter paid amount': 'পরিশোধিত পরিমাণ লিখুন',
  'Enter payment amount': 'পেমেন্টের পরিমাণ লিখুন',
  'File-based routing': 'ফাইলভিত্তিক রাউটিং',
  'Grand total': 'সর্বমোট',
  'ID Number': 'পরিচয়পত্র নম্বর',
  'Images': 'ছবি',
  'Inactive suppliers': 'নিষ্ক্রিয় সরবরাহকারী',
  'Inventory Dashboard': 'ইনভেন্টরি ড্যাশবোর্ড',
  'Invoice No.': 'ইনভয়েস নম্বর',
  'Invoice number or brand name': 'ইনভয়েস নম্বর অথবা ব্র্যান্ডের নাম',
  'Light and dark mode components': 'লাইট ও ডার্ক মোডের উপাদান',
  'Mfg Date (MM/YY)': 'উৎপাদনের তারিখ (মাস/বছর)',
  'MM/YY': 'মাস/বছর',
  'Net total': 'নিট মোট',
  'Pack Price': 'প্যাকের মূল্য',
  'Pack Size': 'প্যাকের আকার',
  'Paid': 'পরিশোধিত',
  'Paid Amount': 'পরিশোধিত পরিমাণ',
  'Phone (optional)': 'ফোন (ঐচ্ছিক)',
  'Phone number': 'ফোন নম্বর',
  'Profile photo': 'প্রোফাইল ছবি',
  'Purchase Price (Box)': 'ক্রয়মূল্য (বক্স)',
  'Reduce billing periods': 'বিলিং সময় কমান',
  'Sale': 'বিক্রয়',
  'Search batch, brand, or company': 'ব্যাচ, ব্র্যান্ড অথবা কোম্পানি খুঁজুন',
  'Search invoice products by invoice number or brand name': 'ইনভয়েস নম্বর অথবা ব্র্যান্ডের নামে ইনভয়েস পণ্য খুঁজুন',
  'Search inventory by batch number, brand name, or company name': 'ব্যাচ নম্বর, ব্র্যান্ড অথবা কোম্পানির নামে ইনভেন্টরি খুঁজুন',
  'Search or type a brand name': 'ব্র্যান্ডের নাম খুঁজুন অথবা লিখুন',
  'Search products': 'পণ্য খুঁজুন',
  'Search return ID, invoice, brand or batch': 'ফেরত আইডি, ইনভয়েস, ব্র্যান্ড অথবা ব্যাচ খুঁজুন',
  'Search returns': 'ফেরত খুঁজুন',
  'Search supplier, order number, or medicine': 'সরবরাহকারী, অর্ডার নম্বর অথবা ওষুধ খুঁজুন',
  'Search, select, or type a brand': 'ব্র্যান্ড খুঁজুন, বেছে নিন অথবা লিখুন',
  'Strength': 'শক্তি',
  'Sub Total': 'উপমোট',
  'Subtotal': 'উপমোট',
  'Supplier Phone Number': 'সরবরাহকারীর ফোন নম্বর',
  'Supplier due payment amount': 'সরবরাহকারীর বকেয়া পরিশোধের পরিমাণ',
  'Supplier management': 'সরবরাহকারী ব্যবস্থাপনা',
  'Supplier name': 'সরবরাহকারীর নাম',
  'Supplier order history': 'সরবরাহকারীর অর্ডারের ইতিহাস',
  'Total bill': 'মোট বিল',
  'Total due': 'মোট বকেয়া',
  'Total Company': 'মোট কোম্পানি',
  'Total units': 'মোট ইউনিট',
  'Type or select a company': 'কোম্পানির নাম লিখুন অথবা বেছে নিন',
  'Unit Price': 'একক মূল্য',
  'Username': 'ব্যবহারকারীর নাম',
  'VAT/TAX': 'ভ্যাট/ট্যাক্স',
  'VAT/TAX percentage': 'ভ্যাট/ট্যাক্সের শতাংশ',
  'VAT/Tax percentage': 'ভ্যাট/ট্যাক্সের শতাংশ',
  'Adjust Supplier Due': 'সরবরাহকারীর বকেয়া সমন্বয়',
  'Android, iOS, and web support': 'Android, iOS এবং ওয়েব সমর্থন',
  'Animations': 'অ্যানিমেশন',
  'Close invoice details': 'ইনভয়েসের বিবরণ বন্ধ করুন',
  'Close menu and return to Home': 'মেনু বন্ধ করে হোমে ফিরুন',
  'Close notifications': 'বিজ্ঞপ্তি বন্ধ করুন',
  'Dashboard invoice list': 'ড্যাশবোর্ড ইনভয়েসের তালিকা',
  'Exp Date (MM/YY)': 'মেয়াদোত্তীর্ণের তারিখ (মাস/বছর)',
  'Numbers only': 'শুধু সংখ্যা',
  'Open Bill Summary': 'বিলের সারাংশ খুলুন',
  'Open recorded payments': 'রেকর্ড করা পেমেন্ট খুলুন',
  'Open staff signup page in the app': 'অ্যাপে স্টাফ সাইনআপ পেজ খুলুন',
  'Overview Dashboard': 'সারসংক্ষেপ ড্যাশবোর্ড',
  'Payment amount': 'পেমেন্টের পরিমাণ',
  'Payment status': 'পেমেন্টের অবস্থা',
  'Pharmacy Cluster icon': 'ফার্মেসি ক্লাস্টার আইকন',
  'Recorded payments circular chart': 'রেকর্ড করা পেমেন্টের বৃত্তাকার চার্ট',
  'Remove order item': 'অর্ডারের আইটেম সরান',
  'Report Dashboard': 'রিপোর্ট ড্যাশবোর্ড',
  'Returns': 'ফেরত',
  'Rounded total': 'রাউন্ড করা মোট',
  'Sign up using your email and a password, or continue with Google. Your pharmacy owner shared this private invitation link with you.': 'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে সাইন আপ করুন অথবা Google দিয়ে চালিয়ে যান। আপনার ফার্মেসির মালিক এই ব্যক্তিগত আমন্ত্রণ লিংকটি দিয়েছেন।',
  'View total payment history': 'মোট পেমেন্টের ইতিহাস দেখুন',
  'Visits': 'ভিজিট',
  'e.g. 10': 'যেমন ১০',
  'Invoice downloaded': 'ইনভয়েস ডাউনলোড হয়েছে',
  'Could not activate Extended Access': 'Extended Access চালু করা যায়নি',
  'Could not destroy batch': 'ব্যাচটি বাতিল করা যায়নি',
  'Destroy expired batch?': 'মেয়াদোত্তীর্ণ ব্যাচটি বাতিল করবেন?',
  'Destroy': 'বাতিল করুন',
  'Login activity was not saved': 'লগইন কার্যকলাপ সংরক্ষণ করা যায়নি',
  'Logout activity was not saved': 'লগআউট কার্যকলাপ সংরক্ষণ করা যায়নি',
  'Could not record this login in the activity history.': 'কার্যকলাপের ইতিহাসে এই লগইন রেকর্ড করা যায়নি।',
  'Could not record this logout in the activity history.': 'কার্যকলাপের ইতিহাসে এই লগআউট রেকর্ড করা যায়নি।',
  'This private link accepts one staff application and expires in 30 days.': 'এই ব্যক্তিগত লিংকে একটি স্টাফ আবেদন করা যাবে এবং এটি ৩০ দিন পর মেয়াদোত্তীর্ণ হবে।',
  'Could not log out. Please try again.': 'লগ আউট করা যায়নি। আবার চেষ্টা করুন।',
  'Could not sign in. Please try again.': 'সাইন ইন করা যায়নি। আবার চেষ্টা করুন।',
  'Enter your email address and password.': 'আপনার ইমেইল ঠিকানা ও পাসওয়ার্ড লিখুন।',
  'Enter a valid email address.': 'সঠিক ইমেইল ঠিকানা লিখুন।',
  'Sign in did not complete. Please try again.': 'সাইন ইন সম্পন্ন হয়নি। আবার চেষ্টা করুন।',
  'Could not load the current plan.': 'বর্তমান প্ল্যান লোড করা যায়নি।',
  'Could not destroy this expired batch.': 'মেয়াদোত্তীর্ণ ব্যাচটি বাতিল করা যায়নি।',
  'Manager': 'ম্যানেজার',
  'Pharmacist': 'ফার্মাসিস্ট',
  'Cashier': 'ক্যাশিয়ার',
  'Inventory Staff': 'ইনভেন্টরি স্টাফ',
  'Sales Staff': 'বিক্রয় স্টাফ',
  'Staff': 'স্টাফ',
  'Approved': 'অনুমোদিত',
  'Pending': 'অপেক্ষমাণ',
  'Rejected': 'প্রত্যাখ্যাত',
  'Suspended': 'স্থগিত',
  'Welcome Dashboard': 'স্বাগতম ড্যাশবোর্ড',
  'Go back': 'ফিরে যান',
  'Go to Home': 'হোমে যান',
  'Close customer details': 'গ্রাহকের বিবরণ বন্ধ করুন',
  'Close amount adjustment': 'পরিমাণ সমন্বয় বন্ধ করুন',
  'Close date selector': 'তারিখ নির্বাচন বন্ধ করুন',
  'Select month': 'মাস বেছে নিন',
  'Select year': 'বছর বেছে নিন',
  '＋ Add New': '＋ নতুন যোগ করুন',
  '+ Add New': '+ নতুন যোগ করুন',
  '＋ Place Order': '＋ অর্ডার দিন',
  '＋ Receive Order': '＋ অর্ডার গ্রহণ করুন',
  '— or sign up with email —': '— অথবা ইমেইল দিয়ে সাইন আপ করুন —',
};

function formatCurrencySymbol(value: string, currency: AppCurrency): string {
  return replaceCurrencySymbol(value, currency);
}

function translate(value: string, language: AppLanguage, currency: AppCurrency): string {
  if (language === 'en') return formatCurrencySymbol(value, currency);
  const normalized = value.trim();
  const translated = bengaliTranslations[normalized];
  if (translated) return formatCurrencySymbol(value.replace(normalized, translated), currency);

  const pageMatch = normalized.match(/^Page (\d+) of (\d+)$/);
  if (pageMatch) return formatCurrencySymbol(value.replace(normalized, `পৃষ্ঠা ${pageMatch[1]} / ${pageMatch[2]}`), currency);
  const stepMatch = normalized.match(/^(\d+) of (\d+)$/);
  if (stepMatch) return formatCurrencySymbol(value.replace(normalized, `${stepMatch[1]}টির মধ্যে ${stepMatch[2]}`), currency);
  const viewCountMatch = normalized.match(/^View \((\d+)\)$/);
  if (viewCountMatch) return formatCurrencySymbol(value.replace(normalized, `দেখুন (${viewCountMatch[1]})`), currency);
  const welcomeMatch = normalized.match(/^Welcome (.+)$/);
  if (welcomeMatch) return formatCurrencySymbol(value.replace(normalized, `স্বাগতম ${welcomeMatch[1]}`), currency);
  const paidMatch = normalized.match(/^Paid (.+)$/);
  if (paidMatch) return formatCurrencySymbol(value.replace(normalized, `পরিশোধিত ${paidMatch[1]}`), currency);
  const loadingMatch = normalized.match(/^Loading (.+)…$/);
  if (loadingMatch) return formatCurrencySymbol(value.replace(normalized, `লোড হচ্ছে ${translate(loadingMatch[1], language, currency)}…`), currency);
  return formatCurrencySymbol(value, currency);
}

function translateNode(node: ReactNode, language: AppLanguage, currency: AppCurrency): ReactNode {
  if (typeof node === 'string') return translate(node, language, currency);
  if (Array.isArray(node)) {
    if (node.every((child) => typeof child === 'string' || typeof child === 'number')) {
      return translate(node.map(String).join(''), language, currency);
    }
    return node.map((child) => translateNode(child, language, currency));
  }
  return node;
}

function translateLabel(value: string | undefined, language: AppLanguage, currency: AppCurrency) {
  return value ? translate(value, language, currency) : value;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [languageError, setLanguageError] = useState('');
  const [currency, setCurrencyState] = useState<AppCurrency>('BDT');
  const [currencyError, setCurrencyError] = useState('');
  const hasSelectedLanguage = useRef(false);
  const hasSelectedCurrency = useRef(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((storedLanguage) => {
        if (!active) return;
        if (!hasSelectedLanguage.current && (storedLanguage === 'en' || storedLanguage === 'bn')) {
          setLanguageState(storedLanguage);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLanguageError(error instanceof Error ? error.message : 'Could not load language preference.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(CURRENCY_STORAGE_KEY)
      .then((storedCurrency) => {
        if (!active) return;
        const savedOption = appCurrencyOptions.find((option) => option.code === storedCurrency);
        if (!hasSelectedCurrency.current && savedOption) {
          setActiveCurrency(savedOption.code);
          setCurrencyState(savedOption.code);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCurrencyError(error instanceof Error ? error.message : 'Could not load currency preference.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    hasSelectedLanguage.current = true;
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
      setLanguageState(nextLanguage);
      setLanguageError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save language preference.';
      setLanguageError(message);
      throw new Error(message);
    }
  }, []);

  const setCurrency = useCallback(async (nextCurrency: AppCurrency) => {
    hasSelectedCurrency.current = true;
    try {
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, nextCurrency);
      setActiveCurrency(nextCurrency);
      setCurrencyState(nextCurrency);
      setCurrencyError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save currency preference.';
      setCurrencyError(message);
      throw new Error(message);
    }
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, languageError, currency, setCurrency, currencyError }),
    [language, setLanguage, languageError, currency, setCurrency, currencyError],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useTranslate() {
  const { language, currency } = useLanguage();
  return useCallback((value: string) => translate(value, language, currency), [language, currency]);
}

export function useLocalizedAlert() {
  const { language, currency } = useLanguage();
  return {
    alert: (...args: Parameters<typeof NativeAlert.alert>) => {
      const [title, message, buttons, options] = args;
      NativeAlert.alert(
        translate(title, language, currency),
        message ? translate(message, language, currency) : message,
        buttons?.map((button) => ({
          ...button,
          text: button.text ? translate(button.text, language, currency) : button.text,
        })),
        options,
      );
    },
  };
}

export const Text = forwardRef<NativeText, TextProps>(function LocalizedText(
  { children, accessibilityLabel, ...props },
  ref,
) {
  const { language, currency } = useLanguage();
  return (
    <NativeText
      {...props}
      accessibilityLabel={translateLabel(accessibilityLabel, language, currency)}
      ref={ref}>
      {translateNode(children, language, currency)}
    </NativeText>
  );
});

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function LocalizedTextInput(
  { accessibilityLabel, placeholder, ...props },
  ref,
) {
  const { language, currency } = useLanguage();
  return (
    <NativeTextInput
      {...props}
      accessibilityLabel={translateLabel(accessibilityLabel, language, currency)}
      placeholder={translateLabel(placeholder, language, currency)}
      ref={ref}
    />
  );
});
