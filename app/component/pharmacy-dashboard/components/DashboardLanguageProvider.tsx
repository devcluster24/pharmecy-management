"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type DashboardLanguage = "en" | "bn";

type DashboardLanguageContextValue = {
  language: DashboardLanguage;
  setLanguage: (language: DashboardLanguage) => void;
};

const STORAGE_KEY = "pharmacy-dashboard-language";

const translations: Record<string, string> = {
  "Cluster Menu": "ক্লাস্টার মেনু",
  "Overview": "সারসংক্ষেপ",
  "Product Management": "পণ্য ব্যবস্থাপনা",
  "Sales": "বিক্রয়",
  "Invoice": "ইনভয়েস",
  "Currency": "মুদ্রা",
  "Taka": "টাকা",
  "Indian Rupee": "ভারতীয় রুপি",
  "Purchase": "ক্রয়",
  "Inventory": "ইনভেন্টরি",
  "Return System": "ফেরত ব্যবস্থাপনা",
  "Customer Management": "গ্রাহক ব্যবস্থাপনা",
  "Supplier Management": "সরবরাহকারী ব্যবস্থাপনা",
  "Expenses": "খরচ",
  "Setting": "সেটিংস",
  "Subscription": "সাবস্ক্রিপশন",
  "Documents": "ডকুমেন্ট",
  "Profile": "প্রোফাইল",
  "Staff Management": "স্টাফ ব্যবস্থাপনা",
  "Logout": "লগ আউট",
  "Logging out...": "লগ আউট হচ্ছে...",
  "Pharmacy Cluster": "ফার্মেসি ক্লাস্টার",
  "Today's Sales": "আজকের বিক্রয়",
  "Today's Purchase": "আজকের ক্রয়",
  "Est. Gross Profit": "আনুমানিক মোট মুনাফা",
  "Customer Due": "গ্রাহকের বকেয়া",
  "Today's Expenses": "আজকের খরচ",
  "Total Stock Value": "মোট স্টকের মূল্য",
  "Low Stock": "কম স্টক",
  "Near Expiry": "মেয়াদ শেষের কাছাকাছি",
  "Expired Stock": "মেয়াদোত্তীর্ণ স্টক",
  "Live data from this browser": "এই ব্রাউজারের লাইভ তথ্য",
  "Daily": "দৈনিক",
  "Weekly": "সাপ্তাহিক",
  "Monthly": "মাসিক",
  "Sales & Purchase": "বিক্রয় ও ক্রয়",
  "Total Sales": "মোট বিক্রয়",
  "Total Purchase": "মোট ক্রয়",
  "Total Expenses": "মোট খরচ",
  "Gross Profit": "মোট মুনাফা",
  "Net Profit": "নিট মুনাফা",
  "Today": "আজ",
  "This Week": "এই সপ্তাহ",
  "This Month": "এই মাস",
  "This Year": "এই বছর",
  "Quick Access": "দ্রুত অ্যাক্সেস",
  "Favourites": "পছন্দের",
  "Notifications": "বিজ্ঞপ্তি",
  "You’re all caught up": "আপনি সব আপডেট দেখে ফেলেছেন",
  "You're all caught up": "আপনি সব আপডেট দেখে ফেলেছেন",
  "New pharmacy updates will appear here.": "ফার্মেসির নতুন আপডেট এখানে দেখা যাবে।",
  "Try again": "আবার চেষ্টা করুন",
  "Search": "খুঁজুন",
  "Search products": "পণ্য খুঁজুন",
  "Search customers": "গ্রাহক খুঁজুন",
  "Search suppliers": "সরবরাহকারী খুঁজুন",
  "Search invoices": "ইনভয়েস খুঁজুন",
  "Search staff": "স্টাফ খুঁজুন",
  "Search by name, brand, or company": "নাম, ব্র্যান্ড অথবা কোম্পানি দিয়ে খুঁজুন",
  "Add New Product": "নতুন পণ্য যোগ করুন",
  "Add New": "নতুন যোগ করুন",
  "Edit": "সম্পাদনা",
  "Delete": "মুছুন",
  "Save": "সংরক্ষণ করুন",
  "Cancel": "বাতিল",
  "Close": "বন্ধ করুন",
  "Update": "আপডেট",
  "Status": "অবস্থা",
  "Active": "সক্রিয়",
  "Inactive": "নিষ্ক্রিয়",
  "Name": "নাম",
  "Email": "ইমেইল",
  "Phone": "ফোন",
  "Address": "ঠিকানা",
  "Date": "তারিখ",
  "Date & time": "তারিখ ও সময়",
  "Actions": "কার্যক্রম",
  "Quantity": "পরিমাণ",
  "Price": "মূল্য",
  "Total": "মোট",
  "Paid": "পরিশোধিত",
  "Due": "বকেয়া",
  "Payment": "পেমেন্ট",
  "Payment Method": "পেমেন্টের পদ্ধতি",
  "Payment Status": "পেমেন্টের অবস্থা",
  "Cash": "নগদ",
  "Select": "নির্বাচন করুন",
  "Previous": "আগেরটি",
  "Next": "পরবর্তী",
  "Page": "পৃষ্ঠা",
  "Loading...": "লোড হচ্ছে...",
  "Loading…": "লোড হচ্ছে…",
  "No data available.": "কোনো তথ্য নেই।",
  "No products found.": "কোনো পণ্য পাওয়া যায়নি।",
  "No customers found.": "কোনো গ্রাহক পাওয়া যায়নি।",
  "No suppliers found.": "কোনো সরবরাহকারী পাওয়া যায়নি।",
  "No invoices found.": "কোনো ইনভয়েস পাওয়া যায়নি।",
  "No staff found.": "কোনো স্টাফ পাওয়া যায়নি।",
  "Product Name": "পণ্যের নাম",
  "Brand Name": "ব্র্যান্ডের নাম",
  "Generic Name": "জেনেরিক নাম",
  "Company": "কোম্পানি",
  "Manufacturer": "প্রস্তুতকারক",
  "Category": "ক্যাটাগরি",
  "Strength": "শক্তি",
  "Dosage Form": "ঔষধের ধরন",
  "Batch Number": "ব্যাচ নম্বর",
  "Expiry Date": "মেয়াদ শেষের তারিখ",
  "Stock": "স্টক",
  "Unit Price": "একক মূল্য",
  "Purchase Price": "ক্রয়মূল্য",
  "Selling Price": "বিক্রয়মূল্য",
  "Customer Name": "গ্রাহকের নাম",
  "Supplier Name": "সরবরাহকারীর নাম",
  "Invoice Number": "ইনভয়েস নম্বর",
  "Order Number": "অর্ডার নম্বর",
  "Create Sale": "বিক্রয় তৈরি করুন",
  "New Sale": "নতুন বিক্রয়",
  "Record Return": "ফেরত রেকর্ড করুন",
  "Create Purchase": "ক্রয় তৈরি করুন",
  "Place Order": "অর্ডার দিন",
  "Receive Order": "অর্ডার গ্রহণ করুন",
  "Print Invoice": "ইনভয়েস প্রিন্ট করুন",
  "Download": "ডাউনলোড",
  "Upload": "আপলোড",
  "Import": "ইমপোর্ট",
  "Export": "এক্সপোর্ট",
  "Reports": "রিপোর্ট",
  "Sales Report": "বিক্রয় রিপোর্ট",
  "Purchase Report": "ক্রয় রিপোর্ট",
  "Inventory Report": "ইনভেন্টরি রিপোর্ট",
  "Expenses Report": "খরচের রিপোর্ট",
  "Overview Dashboard": "সারসংক্ষেপ ড্যাশবোর্ড",
  "Dashboard": "ড্যাশবোর্ড",
  "Welcome": "স্বাগতম",
  "View": "দেখুন",
  "See all": "সব দেখুন",
  "Mark as read": "পঠিত হিসেবে চিহ্নিত করুন",
  "No notifications yet.": "এখনও কোনো বিজ্ঞপ্তি নেই।",
  "Current Plan": "বর্তমান প্ল্যান",
  "Choose New Plan": "নতুন প্ল্যান বেছে নিন",
  "Subscription payment": "সাবস্ক্রিপশন পেমেন্ট",
  "Total Purchase Price": "মোট ক্রয়মূল্য",
  "Total Amount": "মোট পরিমাণ",
  "Subtotal": "উপমোট",
  "Discount": "ছাড়",
  "VAT/Tax": "ভ্যাট/ট্যাক্স",
  "Grand Total": "সর্বমোট",
  "Paid Amount": "পরিশোধিত পরিমাণ",
  "Total Due": "মোট বকেয়া",
  "Supplier Due": "সরবরাহকারীর বকেয়া",
  "Return": "ফেরত",
  "Returns": "ফেরত",
  "Expired": "মেয়াদোত্তীর্ণ",
  "Staff role": "স্টাফের ভূমিকা",
  "Full name": "পুরো নাম",
  "Email address": "ইমেইল ঠিকানা",
  "Login access": "লগইন অ্যাক্সেস",
  "Approved": "অনুমোদিত",
  "Pending": "অপেক্ষমাণ",
  "Rejected": "প্রত্যাখ্যাত",
  "Suspended": "স্থগিত",
  "Manager": "ম্যানেজার",
  "Pharmacist": "ফার্মাসিস্ট",
  "Cashier": "ক্যাশিয়ার",
  "Inventory Staff": "ইনভেন্টরি স্টাফ",
  "Sales Staff": "বিক্রয় স্টাফ",
  "Staff": "স্টাফ",
  "Store name": "দোকানের নাম",
  "Pharmacy": "ফার্মেসি",
  "Settings": "সেটিংস",
  "Profile Settings": "প্রোফাইল সেটিংস",
  "Save Changes": "পরিবর্তন সংরক্ষণ করুন",
  "Update Profile": "প্রোফাইল আপডেট করুন",
  "Profile photo": "প্রোফাইল ছবি",
  "Upload photo": "ছবি আপলোড করুন",
  "Remove photo": "ছবি সরান",
  "Low stock": "কম স্টক",
  "Near expiry": "মেয়াদ শেষের কাছাকাছি",
  "Expired batches": "মেয়াদোত্তীর্ণ ব্যাচ",
  "Available": "উপলভ্য",
  "Unavailable": "অনুপলভ্য",
  "Today’s Sales": "আজকের বিক্রয়",
  "Today’s Purchase": "আজকের ক্রয়",
  "View details": "বিস্তারিত দেখুন",
  "Details": "বিস্তারিত",
  "Confirm": "নিশ্চিত করুন",
  "Are you sure?": "আপনি কি নিশ্চিত?",
  "Retry": "আবার চেষ্টা করুন",
  "Clear": "মুছুন",
  "Filter": "ফিল্টার",
  "Sort": "সাজান",
  'Add': 'যোগ করুন',
  'Add Batch Details': 'ব্যাচের তথ্য যোগ করুন',
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
  'Brand Name / Supplier': 'ব্র্যান্ডের নাম / সরবরাহকারী',
  'Choose a subscription plan': 'একটি সাবস্ক্রিপশন প্ল্যান বেছে নিন',
  'Choose bKash or Nagad to continue with the subscription.': 'সাবস্ক্রিপশন চালিয়ে যেতে বিকাশ অথবা নগদ বেছে নিন।',
  'Choose your plan': 'আপনার প্ল্যান বেছে নিন',
  'Create a unique URL for one staff signup. The link expires after 30 days.': 'একজন স্টাফের সাইনআপের জন্য আলাদা লিংক তৈরি করুন। লিংকটি ৩০ দিন পর মেয়াদোত্তীর্ণ হবে।',
  'Create an account': 'অ্যাকাউন্ট তৈরি করুন',
  'Create staff signup link': 'স্টাফ সাইনআপ লিংক তৈরি করুন',
  'Current plan is not available.': 'বর্তমান প্ল্যান পাওয়া যায়নি।',
  'Customer name *': 'গ্রাহকের নাম *',
  'Customers': 'গ্রাহক',
  'Dashboard access unavailable': 'ড্যাশবোর্ডে প্রবেশ করা যাচ্ছে না',
  'Dashboard payments': 'ড্যাশবোর্ডের পেমেন্ট',
  'Dead stock': 'অচল স্টক',
  'Demo checkout': 'ডেমো চেকআউট',
  'Demo payment only': 'শুধু ডেমো পেমেন্ট',
  'Discount cannot exceed the total purchase price.': 'ছাড় মোট ক্রয়মূল্যের বেশি হতে পারে না।',
  'Enter any two values to calculate the third price.': 'তৃতীয় মূল্য গণনা করতে যেকোনো দুটি মান লিখুন।',
  'Fast-moving products': 'দ্রুত বিক্রি হওয়া পণ্য',
  'Find medicine': 'ওষুধ খুঁজুন',
  'Good care starts with a better-organized pharmacy.': 'সুশৃঙ্খল ফার্মেসি থেকেই উন্নত সেবার শুরু।',
  'Import company products': 'কোম্পানির পণ্য ইমপোর্ট করুন',
  'Import one manufacturer or every product from the shared catalog.': 'শেয়ার করা ক্যাটালগ থেকে একটি প্রস্তুতকারকের অথবা সব পণ্য ইমপোর্ট করুন।',
  'Import product data': 'পণ্যের তথ্য ইমপোর্ট করুন',
  'Invoice history': 'ইনভয়েসের ইতিহাস',
  'Invoices': 'ইনভয়েস',
  'Items': 'আইটেম',
  'Low Stock Not Working: enter and save a threshold greater than 0 in Settings.': 'কম স্টকের সতর্কতা কাজ করছে না: সেটিংসে ০-এর বেশি সীমা লিখে সংরক্ষণ করুন।',
  'Manage each staff member’s role, menu access, and login status.': 'প্রতিটি স্টাফের ভূমিকা, মেনু অ্যাক্সেস এবং লগইন অবস্থা পরিচালনা করুন।',
  'Manage supplier contacts, received orders, purchase totals and outstanding dues.': 'সরবরাহকারীর যোগাযোগ, গৃহীত অর্ডার, ক্রয়ের মোট এবং বকেয়া পরিচালনা করুন।',
  'Manage supplier orders and received stock': 'সরবরাহকারীর অর্ডার এবং গৃহীত স্টক পরিচালনা করুন',
  'Manage your pharmacy catalog, prices, and product availability.': 'আপনার ফার্মেসির ক্যাটালগ, মূল্য এবং পণ্যের প্রাপ্যতা পরিচালনা করুন।',
  'Manufacturer / company': 'প্রস্তুতকারক / কোম্পানি',
  'Month': 'মাস',
  'Net Refund Amount': 'নিট ফেরতের পরিমাণ',
  'New to Pharmacy Cluster?': 'Pharmacy Cluster-এ নতুন?',
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
  'ONE PLACE FOR YOUR PHARMACY': 'আপনার ফার্মেসির সবকিছু এক জায়গায়',
  'Open shortcuts from Quick Access to add them here.': 'এখানে শর্টকাট যোগ করতে Quick Access থেকে খুলুন।',
  'Order summary': 'অর্ডারের সারাংশ',
  'Orders': 'অর্ডার',
  'Orders you create will appear here.': 'আপনার তৈরি করা অর্ডার এখানে দেখা যাবে।',
  'PHARMACY CLUSTER': 'ফার্মেসি ক্লাস্টার',
  'PHARMACY WORKSPACE': 'ফার্মেসি ওয়ার্কস্পেস',
  'Pack & pricing': 'প্যাক ও মূল্য',
  'Pay amount': 'পরিশোধের পরিমাণ',
  'Payment cannot exceed the subtotal.': 'পেমেন্ট উপমোটের বেশি হতে পারে না।',
  'Payment details could not be loaded.': 'পেমেন্টের তথ্য লোড করা যায়নি।',
  'Payment gateway credentials are not configured. Continuing simulates a successful payment and activates the selected plan; no money is charged.': 'পেমেন্ট গেটওয়ের তথ্য সেট করা নেই। চালিয়ে গেলে সফল পেমেন্টের অনুকরণ হবে এবং নির্বাচিত প্ল্যান চালু হবে; কোনো টাকা কাটা হবে না।',
  'Payment history': 'পেমেন্টের ইতিহাস',
  'Payment method': 'পেমেন্টের পদ্ধতি',
  'Permission': 'অনুমতি',
  'Phone Number': 'ফোন নম্বর',
  'Phone number (optional)': 'ফোন নম্বর (ঐচ্ছিক)',
  'Place Order List': 'অর্ডারের তালিকা',
  'Previous due adjustments': 'আগের বকেয়া সমন্বয়',
  'Previous payments': 'আগের পেমেন্ট',
  'Product details': 'পণ্যের বিবরণ',
  'Purchase data is unavailable. Check your account connection.': 'ক্রয়ের তথ্য পাওয়া যাচ্ছে না। আপনার অ্যাকাউন্টের সংযোগ পরীক্ষা করুন।',
  'Purchase is available to store owners.': 'ক্রয় সুবিধাটি শুধু দোকানের মালিকদের জন্য।',
  'Receive List': 'গ্রহণের তালিকা',
  'Receive this item': 'এই আইটেমটি গ্রহণ করুন',
  'Received': 'গৃহীত',
  'Recent sales · Last 10 days': 'সাম্প্রতিক বিক্রয় · গত ১০ দিন',
  'Record a return to add it to the Return System.': 'ফেরত সিস্টেমে যোগ করতে একটি ফেরত রেকর্ড করুন।',
  'Recorded': 'রেকর্ড করা হয়েছে',
  'Recorded payments': 'রেকর্ড করা পেমেন্ট',
  'Recorded sale payments by date and payment method.': 'তারিখ এবং পেমেন্ট পদ্ধতি অনুযায়ী রেকর্ড করা বিক্রয় পেমেন্ট।',
  'Remove': 'সরান',
  'Retry loading products': 'পণ্য লোড করতে আবার চেষ্টা করুন',
  'Return Invoice': 'ফেরত ইনভয়েস',
  'Return Method': 'ফেরতের পদ্ধতি',
  'Return Qty': 'ফেরতের পরিমাণ',
  'Return data is unavailable. Check your account connection.': 'ফেরতের তথ্য পাওয়া যাচ্ছে না। আপনার অ্যাকাউন্টের সংযোগ পরীক্ষা করুন।',
  'Returns are available to store owners.': 'ফেরত সুবিধাটি শুধু দোকানের মালিকদের জন্য।',
  'Review customer invoices and outstanding balances.': 'গ্রাহকের ইনভয়েস এবং বকেয়া ব্যালেন্স দেখুন।',
  'Review refund details before recording this return.': 'ফেরত রেকর্ড করার আগে রিফান্ডের বিবরণ যাচাই করুন।',
  'Review returned products and record invoice returns.': 'ফেরত পণ্য দেখুন এবং ইনভয়েস ফেরত রেকর্ড করুন।',
  'SALES INVOICE': 'বিক্রয় ইনভয়েস',
  'STAY UP TO DATE': 'সর্বশেষ তথ্য জানুন',
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
  'Suppliers': 'সরবরাহকারী',
  'Tap the link to open the signup page in this app.': 'এই অ্যাপে সাইনআপ পেজ খুলতে লিংকে ট্যাপ করুন।',
  'Thank you for your purchase.': 'আপনার কেনাকাটার জন্য ধন্যবাদ।',
  'This payment will increase Paid Amount and reduce Total Due Amount.': 'এই পেমেন্ট পরিশোধিত পরিমাণ বাড়াবে এবং মোট বকেয়া কমাবে।',
  'This staff signup link is invalid. Ask your pharmacy owner to create a new one.': 'স্টাফ সাইনআপ লিংকটি সঠিক নয়। নতুন লিংকের জন্য ফার্মেসির মালিককে বলুন।',
  'Top products by units sold today': 'আজ বিক্রি হওয়া ইউনিট অনুযায়ী শীর্ষ পণ্য',
  'Total History': 'সম্পূর্ণ ইতিহাস',
  'Total due amount': 'মোট বকেয়া',
  'Total due now': 'এখন মোট বকেয়া',
  'Total purchase': 'মোট ক্রয়',
  'VAT/TAX %': 'ভ্যাট/ট্যাক্স %',
  'VAT/TAX must be between 0 and 100%.': 'ভ্যাট/ট্যাক্স ০ থেকে ১০০%-এর মধ্যে হতে হবে।',
  'VAT/Tax (%)': 'ভ্যাট/ট্যাক্স (%)',
  'VAT/Tax must be between zero and 100%.': 'ভ্যাট/ট্যাক্স ০ থেকে ১০০-এর মধ্যে হতে হবে।',
  'Year': 'বছর',
  'Your dashboard plan changes only after a successful confirmation.': 'সফলভাবে নিশ্চিত হওয়ার পরেই আপনার ড্যাশবোর্ড প্ল্যান পরিবর্তিত হবে।',
  'recorded': 'রেকর্ড করা হয়েছে',
  'Supplier': 'সরবরাহকারী',
  'Home': 'হোম',
  'Menu': 'মেনু',
  'Language': 'ভাষা',
  'BackUp File': 'ব্যাকআপ ফাইল',
  'Pharmacy Setup': 'ফার্মেসি সেটআপ',
  'Vat/Tax': 'ভ্যাট/ট্যাক্স',
  'Payment Methord': 'পেমেন্ট পদ্ধতি',
  'Return Management': 'ফেরত ব্যবস্থাপনা',
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
  'Search customer, phone or invoice': 'গ্রাহক, ফোন অথবা ইনভয়েস খুঁজুন',
  'Search invoice, customer, phone or payment': 'ইনভয়েস, গ্রাহক, ফোন অথবা পেমেন্ট খুঁজুন',
  'Search supplier name or phone': 'সরবরাহকারীর নাম অথবা ফোন খুঁজুন',
  'Search staff…': 'স্টাফ খুঁজুন…',
  'Search products…': 'পণ্য খুঁজুন…',
  'Search inventory brand or generic name': 'ইনভেন্টরিতে ব্র্যান্ড অথবা জেনেরিক নাম খুঁজুন',
  'Create staff account': 'স্টাফ অ্যাকাউন্ট তৈরি করুন',
  'Continue with Google': 'Google দিয়ে চালিয়ে যান',
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
  'Add billing period': 'বিলিং সময় যোগ করুন',
  'Active suppliers': 'সক্রিয় সরবরাহকারী',
  'Amount to add to invoice': 'ইনভয়েসে যোগ করার পরিমাণ',
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
  'Date and time': 'তারিখ ও সময়',
  'Discount amount or percentage': 'ছাড়ের পরিমাণ অথবা শতাংশ',
  'Enter amount': 'পরিমাণ লিখুন',
  'Enter paid amount': 'পরিশোধিত পরিমাণ লিখুন',
  'Enter payment amount': 'পেমেন্টের পরিমাণ লিখুন',
  'Enter phone number': 'ফোন নম্বর লিখুন',
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
  'Phone (optional)': 'ফোন (ঐচ্ছিক)',
  'Phone number': 'ফোন নম্বর',
  'Purchase Price (Box)': 'ক্রয়মূল্য (বক্স)',
  'Reduce billing periods': 'বিলিং সময় কমান',
  'Sale': 'বিক্রয়',
  'Search batch, brand, or company': 'ব্যাচ, ব্র্যান্ড অথবা কোম্পানি খুঁজুন',
  'Search invoice products by invoice number or brand name': 'ইনভয়েস নম্বর অথবা ব্র্যান্ডের নামে ইনভয়েস পণ্য খুঁজুন',
  'Search inventory by batch number, brand name, or company name': 'ব্যাচ নম্বর, ব্র্যান্ড অথবা কোম্পানির নামে ইনভেন্টরি খুঁজুন',
  'Search or type a brand name': 'ব্র্যান্ডের নাম খুঁজুন অথবা লিখুন',
  'Search return ID, invoice, brand or batch': 'ফেরত আইডি, ইনভয়েস, ব্র্যান্ড অথবা ব্যাচ খুঁজুন',
  'Search returns': 'ফেরত খুঁজুন',
  'Search supplier, order number, or medicine': 'সরবরাহকারী, অর্ডার নম্বর অথবা ওষুধ খুঁজুন',
  'Search, select, or type a brand': 'ব্র্যান্ড খুঁজুন, বেছে নিন অথবা লিখুন',
  'Sub Total': 'উপমোট',
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
  'Payment amount': 'পেমেন্টের পরিমাণ',
  'Payment status': 'পেমেন্টের অবস্থা',
  'Pharmacy Cluster icon': 'ফার্মেসি ক্লাস্টার আইকন',
  'Recorded payments circular chart': 'রেকর্ড করা পেমেন্টের বৃত্তাকার চার্ট',
  'Remove order item': 'অর্ডারের আইটেম সরান',
  'Report Dashboard': 'রিপোর্ট ড্যাশবোর্ড',
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

const context = createContext<DashboardLanguageContextValue>({
  language: "en",
  setLanguage: () => {},
});

let fallbackLanguage: DashboardLanguage = "en";

const textTranslations = new WeakMap<CharacterData, { original: string; translated: string }>();
const attributeTranslations = new WeakMap<Element, Map<string, { original: string; translated: string }>>();

function getStoredLanguage(): DashboardLanguage {
  if (typeof window === "undefined") return "en";
  try {
    fallbackLanguage = window.localStorage.getItem(STORAGE_KEY) === "bn" ? "bn" : "en";
  } catch (error) {
    console.error("Could not read the dashboard language preference.", error);
  }
  return fallbackLanguage;
}

function subscribeToLanguage(callback: () => void) {
  window.addEventListener("dashboard-language-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("dashboard-language-change", callback);
    window.removeEventListener("storage", callback);
  };
}

function localizeTextNode(node: CharacterData, language: DashboardLanguage) {
  const currentValue = node.textContent ?? "";
  const previous = textTranslations.get(node);
  const original = previous?.translated === currentValue ? previous.original : currentValue;
  const trimmed = original.trim();
  const translation = language === "bn" ? translations[trimmed] : undefined;
  const translated = translation ? original.replace(trimmed, translation) : original;
  textTranslations.set(node, { original, translated });
  if (translated !== currentValue) node.textContent = translated;
}

function localizeAttribute(element: Element, attribute: string, language: DashboardLanguage) {
  const value = element.getAttribute(attribute);
  if (value === null) return;
  let trackedAttributes = attributeTranslations.get(element);
  if (!trackedAttributes) {
    trackedAttributes = new Map();
    attributeTranslations.set(element, trackedAttributes);
  }
  const previous = trackedAttributes.get(attribute);
  const original = previous?.translated === value ? previous.original : value;
  const trimmed = original.trim();
  const translation = language === "bn" ? translations[trimmed] : undefined;
  const translated = translation ? original.replace(trimmed, translation) : original;
  trackedAttributes.set(attribute, { original, translated });
  if (translated !== value) element.setAttribute(attribute, translated);
}

function localizeNode(node: Node, language: DashboardLanguage) {
  if (node.nodeType === Node.TEXT_NODE) {
    localizeTextNode(node as CharacterData, language);
    return;
  }
  if (!(node instanceof Element)) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest("script, style, textarea, [contenteditable='true']")) continue;
    localizeTextNode(textNode as CharacterData, language);
  }

  const elements = [node, ...node.querySelectorAll("*")];
  for (const element of elements) {
    if (element.matches("[contenteditable='true']")) continue;
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      localizeAttribute(element, attribute, language);
    }
  }
}

export function DashboardLanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore<DashboardLanguage>(
    subscribeToLanguage,
    getStoredLanguage,
    () => "en",
  );

  const setLanguage = useCallback((nextLanguage: DashboardLanguage) => {
    fallbackLanguage = nextLanguage;
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch (error) {
      console.error("Could not save the dashboard language preference.", error);
    }
    window.dispatchEvent(new Event("dashboard-language-change"));
  }, []);

  useEffect(() => {
    const root = document.getElementById("dashboard-language-root");
    if (!root) return;
    document.documentElement.lang = language === "bn" ? "bn" : "en";
    localizeNode(root, language);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && record.target.parentElement?.closest("script, style, textarea, [contenteditable='true']")) {
          continue;
        }
        if (record.type === "attributes" && record.target instanceof Element) {
          localizeAttribute(record.target, record.attributeName ?? "", language);
          continue;
        }
        for (const node of record.addedNodes) localizeNode(node, language);
        if (record.type === "characterData") localizeNode(record.target, language);
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
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return (
    <context.Provider value={value}>
      <div id="dashboard-language-root" style={{ display: "contents" }}>
        {children}
      </div>
    </context.Provider>
  );
}

export function useDashboardLanguage() {
  return useContext(context);
}
