"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  LOW_STOCK_THRESHOLD_STORAGE_KEY,
  saveLowStockThreshold as persistLowStockThreshold,
} from "./lowStockStorage";
import {
  getVatTaxSettingsSnapshot,
  saveVatTaxDefaultRate,
} from "./vatTaxStorage";
import {
  getPaymentMethodsSnapshot,
  savePaymentMethods,
  type PaymentMethod,
} from "./paymentMethodsStorage";
import {
  getReturnDeductionSettingsSnapshot,
  saveReturnDeductionDefaultRate,
} from "./returnDeductionStorage";

const settingsMenus = [
  { id: "pharmacy-store", label: "Pharmacy Store" },
  { id: "subscription-bill", label: "Subcription & Bill" },
  { id: "documents-invoice", label: "Documents & Invoice" },
  { id: "store-bill-payment", label: "Store Bill Payment" },
  { id: "profile", label: "Profile" },
] as const;

const pharmacyStoreSubmenus = ["Product Management", "Inventory", "VAT/TAX", "Add Payment Method", "Account Info", "Return System"] as const;
const defaultMobilePaymentNames = ["Bangla QR", "Bkash", "Nagad", "Rocket", "upay", "Tap", "gpay"] as const;
const bankNames = [
  "Sonali Bank PLC",
  "Janata Bank PLC",
  "Agrani Bank PLC",
  "Rupali Bank PLC",
  "Bangladesh Development Bank PLC",
  "BASIC Bank PLC",
  "Bangladesh Krishi Bank",
  "Rajshahi Krishi Unnayan Bank",
  "Probashi Kallyan Bank",
  "AB Bank PLC",
  "Bangladesh Commerce Bank Limited",
  "Bank Asia PLC",
  "BRAC Bank PLC",
  "City Bank PLC",
  "Community Bank Bangladesh PLC",
  "Dhaka Bank PLC",
  "Dutch-Bangla Bank PLC",
  "Eastern Bank PLC",
  "IFIC Bank PLC",
  "Jamuna Bank PLC",
  "Meghna Bank PLC",
  "Mercantile Bank PLC",
  "Midland Bank PLC",
  "Modhumoti Bank PLC",
  "Mutual Trust Bank PLC",
  "National Bank Limited",
  "National Credit and Commerce Bank PLC (NCC Bank)",
  "NRB Bank PLC",
  "NRB Commercial Bank PLC",
  "ONE Bank PLC",
  "Padma Bank PLC",
  "Premier Bank PLC",
  "Prime Bank PLC",
  "Pubali Bank PLC",
  "Shimanto Bank PLC",
  "South Bangla Agriculture and Commerce Bank PLC (SBAC)",
  "Southeast Bank PLC",
  "Standard Bank PLC",
  "Trust Bank PLC",
  "United Commercial Bank PLC (UCB)",
  "Uttara Bank PLC",
  "Citizens Bank PLC",
  "Al-Arafah Islami Bank PLC",
  "ICB Islamic Bank Limited",
  "Islami Bank Bangladesh PLC",
  "Shahjalal Islami Bank PLC",
  "Sammilito Islami Bank PLC",
  "EXIM Bank PLC",
  "First Security Islami Bank PLC",
  "Global Islami Bank PLC",
  "Social Islami Bank PLC",
  "Union Bank PLC",
  "Standard Chartered Bank",
  "HSBC Bangladesh",
  "Citibank N.A.",
  "Commercial Bank of Ceylon PLC",
  "State Bank of India",
  "Habib Bank Limited",
  "National Bank of Pakistan",
  "Woori Bank",
  "Bank Alfalah Limited",
  "Ansar VDP Unnayan Bank",
  "Karmasangsthan Bank",
  "Grameen Bank",
  "Jubilee Bank",
  "Palli Sanchay Bank",
] as const;

type SettingsProfile = {
  photoUrl: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
};

type ProfileState =
  | { status: "loading"; profile: null; error: "" }
  | { status: "ready"; profile: SettingsProfile; error: "" }
  | { status: "error"; profile: null; error: string };

const emptyPageData: SectionData = {
  description: "View your account profile.",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

function metadataString(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getInitials(fullName: string, email: string) {
  const name = fullName.trim();
  if (name) {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase();
  }
  return email.trim().slice(0, 1).toLocaleUpperCase() || "?";
}

export default function SettingPage() {
  const [activeMenu, setActiveMenu] = useState<(typeof settingsMenus)[number]["id"]>("pharmacy-store");
  const [activeStoreSubmenu, setActiveStoreSubmenu] = useState<(typeof pharmacyStoreSubmenus)[number] | null>(null);
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [lowStockMessage, setLowStockMessage] = useState("");
  const [lowStockError, setLowStockError] = useState("");
  const [vatTaxRate, setVatTaxRate] = useState("0");
  const [vatTaxMessage, setVatTaxMessage] = useState("");
  const [vatTaxError, setVatTaxError] = useState("");
  const [returnDeductionRate, setReturnDeductionRate] = useState("0");
  const [savedReturnDeductionRate, setSavedReturnDeductionRate] = useState(0);
  const [returnDeductionMessage, setReturnDeductionMessage] = useState("");
  const [returnDeductionError, setReturnDeductionError] = useState("");
  const [paymentMethodType, setPaymentMethodType] = useState<"mobile" | "bank">("mobile");
  const [paymentMethodName, setPaymentMethodName] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankDistrict, setBankDistrict] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState<string | null>(null);
  const [paymentMethodMessage, setPaymentMethodMessage] = useState("");
  const [paymentMethodError, setPaymentMethodError] = useState("");
  const [profileState, setProfileState] = useState<ProfileState>({
    status: "loading",
    profile: null,
    error: "",
  });
  const existingMobilePaymentNames = new Set(
    paymentMethods
      .filter((method): method is Extract<PaymentMethod, { type: "mobile" }> =>
        method.type === "mobile" && method.id !== editingPaymentMethodId)
      .map((method) => method.name.trim().toLocaleLowerCase()),
  );
  const existingBankNames = new Set(
    paymentMethods
      .filter((method): method is Extract<PaymentMethod, { type: "bank" }> =>
        method.type === "bank" && method.id !== editingPaymentMethodId)
      .map((method) => method.bankName.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Sign in to view your profile.");

        const { data: userProfile, error: profileError } = await supabase
          .from("user_profiles")
          .select("full_name, phone, role")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!userProfile) throw new Error("Your account profile could not be found.");

        const metadata = user.user_metadata as Record<string, unknown>;
        const profile: SettingsProfile = {
          photoUrl: metadataString(metadata, "avatar_url", "picture", "profile_photo_url", "photo_url"),
          fullName: metadataString(metadata, "full_name", "name") || userProfile.full_name || "",
          email: user.email ?? "",
          phone: metadataString(metadata, "phone", "phone_number") || userProfile.phone || "",
          role: userProfile.role,
        };

        if (active) setProfileState({ status: "ready", profile, error: "" });
      } catch (error) {
        if (active) {
          setProfileState({
            status: "error",
            profile: null,
            error: error instanceof Error ? error.message : "Unable to load your profile.",
          });
        }
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const profile = profileState.status === "ready" ? profileState.profile : null;
  const profileFields = [
    ["Full Name", profile?.fullName],
    ["Email", profile?.email],
    ["Phone Number", profile?.phone],
    ["User Role", profile?.role],
  ] as const;
  const parsedLowStockThreshold = Number(lowStockThreshold);
  const isLowStockEnabled = lowStockThreshold.trim() !== ""
    && Number.isInteger(parsedLowStockThreshold)
    && parsedLowStockThreshold > 0;

  function selectStoreSubmenu(submenu: (typeof pharmacyStoreSubmenus)[number]) {
    setActiveStoreSubmenu(submenu);
    setLowStockMessage("");
    setLowStockError("");
    setVatTaxMessage("");
    setVatTaxError("");
    setReturnDeductionMessage("");
    setReturnDeductionError("");
    setPaymentMethodMessage("");
    setPaymentMethodError("");
    if (submenu === "VAT/TAX") {
      const settings = getVatTaxSettingsSnapshot();
      setVatTaxRate(String(settings.defaultRate));
      setVatTaxError(settings.error);
      return;
    }
    if (submenu === "Return System") {
      const settings = getReturnDeductionSettingsSnapshot();
      setReturnDeductionRate(String(settings.defaultRate));
      setSavedReturnDeductionRate(settings.defaultRate);
      setReturnDeductionError(settings.error);
      return;
    }
    if (submenu === "Add Payment Method" || submenu === "Account Info") {
      const snapshot = getPaymentMethodsSnapshot();
      setPaymentMethods(snapshot.rows);
      setPaymentMethodError(snapshot.error);
      return;
    }
    if (submenu !== "Inventory") return;

    try {
      const savedThreshold = window.localStorage.getItem(LOW_STOCK_THRESHOLD_STORAGE_KEY);
      setLowStockThreshold(savedThreshold ?? "");
    } catch (error) {
      setLowStockError(error instanceof Error ? error.message : "Could not load the low stock setting.");
    }
  }

  function saveLowStockThreshold() {
    const threshold = Number(lowStockThreshold);
    if (lowStockThreshold.trim() === "" || !Number.isInteger(threshold) || threshold < 0) {
      setLowStockError("Enter a whole number equal to or greater than 0.");
      setLowStockMessage("");
      return;
    }

    try {
      persistLowStockThreshold(String(threshold));
      setLowStockThreshold(String(threshold));
      setLowStockError("");
      setLowStockMessage("Low stock threshold saved.");
    } catch (error) {
      setLowStockError(error instanceof Error ? error.message : "Could not save the low stock setting.");
      setLowStockMessage("");
    }
  }

  function saveVatTaxSettings() {
    const rate = Number(vatTaxRate);
    if (vatTaxRate.trim() === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setVatTaxError("Enter a VAT/TAX rate between 0 and 100%.");
      setVatTaxMessage("");
      return;
    }

    try {
      saveVatTaxDefaultRate(rate);
      setVatTaxRate(String(Number(rate.toFixed(2))));
      setVatTaxError("");
      setVatTaxMessage("Default VAT/TAX rate saved.");
    } catch (error) {
      setVatTaxError(error instanceof Error ? error.message : "Could not save VAT/TAX settings.");
      setVatTaxMessage("");
    }
  }

  function saveReturnDeductionSettings() {
    const rate = Number(returnDeductionRate);
    if (returnDeductionRate.trim() === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setReturnDeductionError("Enter a return deduction rate between 0 and 100%.");
      setReturnDeductionMessage("");
      return;
    }

    try {
      saveReturnDeductionDefaultRate(rate);
      const normalizedRate = Number(rate.toFixed(2));
      setReturnDeductionRate(String(normalizedRate));
      setSavedReturnDeductionRate(normalizedRate);
      setReturnDeductionError("");
      setReturnDeductionMessage("Return deduction rate saved.");
    } catch (error) {
      setReturnDeductionError(error instanceof Error ? error.message : "Could not save the return deduction rate.");
      setReturnDeductionMessage("");
    }
  }

  function savePaymentMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentMethodMessage("");
    setPaymentMethodError("");

    if (
      (paymentMethodType === "mobile" && !paymentMethodName.trim())
      || (paymentMethodType === "bank" && (!bankName || !accountHolderName.trim() || !accountNumber.trim()))
    ) {
      setPaymentMethodError("Complete all required payment method fields.");
      return;
    }
    const duplicateMethodName = paymentMethodType === "mobile"
      ? existingMobilePaymentNames.has(paymentMethodName.trim().toLocaleLowerCase())
      : existingBankNames.has(bankName.trim().toLocaleLowerCase());
    if (duplicateMethodName) {
      setPaymentMethodError("This payment method name has already been added.");
      return;
    }

    const method: PaymentMethod = paymentMethodType === "mobile"
      ? {
          id: editingPaymentMethodId ?? crypto.randomUUID(),
          type: "mobile",
          name: paymentMethodName.trim(),
          phone: paymentPhone.trim(),
        }
      : {
          id: editingPaymentMethodId ?? crypto.randomUUID(),
          type: "bank",
          bankName,
          accountHolderName: accountHolderName.trim(),
          accountNumber: accountNumber.trim(),
          branch: bankBranch.trim(),
          district: bankDistrict.trim(),
        };

    try {
      const nextMethods = editingPaymentMethodId
        ? paymentMethods.map((existingMethod) => existingMethod.id === editingPaymentMethodId ? method : existingMethod)
        : [...paymentMethods, method];
      savePaymentMethods(nextMethods);
      setPaymentMethods(nextMethods);
      setPaymentMethodMessage(editingPaymentMethodId ? "Payment method updated." : "Payment method saved.");
      setEditingPaymentMethodId(null);
      setPaymentMethodName("");
      setPaymentPhone("");
      setBankName("");
      setAccountHolderName("");
      setAccountNumber("");
      setBankBranch("");
      setBankDistrict("");
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not save the payment method.");
    }
  }

  function editPaymentMethod(method: PaymentMethod) {
    setEditingPaymentMethodId(method.id);
    setPaymentMethodType(method.type);
    if (method.type === "mobile") {
      setPaymentMethodName(method.name);
      setPaymentPhone(method.phone);
    } else {
      setBankName(method.bankName);
      setAccountHolderName(method.accountHolderName);
      setAccountNumber(method.accountNumber);
      setBankBranch(method.branch);
      setBankDistrict(method.district);
    }
    setPaymentMethodMessage("");
    setPaymentMethodError("");
    setActiveStoreSubmenu("Add Payment Method");
  }

  function deletePaymentMethod(methodId: string) {
    if (!window.confirm("Delete this payment method?")) return;
    const nextMethods = paymentMethods.filter((method) => method.id !== methodId);
    try {
      savePaymentMethods(nextMethods);
      setPaymentMethods(nextMethods);
      setPaymentMethodMessage("Payment method deleted.");
      setPaymentMethodError("");
      if (editingPaymentMethodId === methodId) {
        setEditingPaymentMethodId(null);
        setPaymentMethodName("");
        setPaymentPhone("");
        setBankName("");
        setAccountHolderName("");
        setAccountNumber("");
        setBankBranch("");
        setBankDistrict("");
      }
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not delete the payment method.");
      setPaymentMethodMessage("");
    }
  }

  return (
    <DashboardSectionPage
      sectionSlug="settings"
      data={emptyPageData}
      hideAction
      content={
        <>
          <section aria-labelledby="settings-profile-title" style={{ maxWidth: 760, background: "transparent", padding: 24, marginBottom: 20 }}>
            <h2 id="settings-profile-title" style={{ margin: 0, color: "#20342a", fontSize: 18, fontWeight: 700 }}>Profile</h2>
            {profileState.status === "loading" && (
              <p role="status" style={{ margin: "16px 0 0", color: "#687871", fontSize: 13 }}>Loading profile...</p>
            )}
            {profileState.status === "error" && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#b34b43", fontSize: 13 }}>{profileState.error}</p>
            )}
            {profile && (
              <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", marginTop: 20 }}>
                <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                  <div style={{ width: 104, height: 104, display: "grid", placeItems: "center", overflow: "hidden", border: "1px solid #d7ebdf", borderRadius: "50%", background: "#e5f5ed", color: "#187553", fontSize: 28, fontWeight: 700 }}>
                    {profile.photoUrl ? (
                      <Image
                        src={profile.photoUrl}
                        alt={`${profile.fullName || "User"} profile photo`}
                        width={104}
                        height={104}
                        unoptimized
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : getInitials(profile.fullName, profile.email)}
                  </div>
                  <span style={{ color: "#687871", fontSize: 12 }}>Profile Photo</span>
                </div>
                <dl style={{ flex: "1 1 320px", display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr", gap: "14px 20px", margin: 0, color: "#34453b", fontSize: 13 }}>
                  {profileFields.map(([label, value]) => (
                    <div key={label} style={{ display: "contents" }}>
                      <dt style={{ color: "#77857d" }}>{label}</dt>
                      <dd style={{ margin: 0, fontWeight: 600 }}>{value || "Not provided"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
          <div role="group" aria-label="Settings menu" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 20 }}>
            {settingsMenus.map((menu) => (
              <button
                key={menu.id}
                type="button"
                aria-pressed={activeMenu === menu.id}
                onClick={() => setActiveMenu(menu.id)}
                style={{ border: 0, background: "transparent", color: activeMenu === menu.id ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 650, textDecoration: activeMenu === menu.id ? "underline" : "none", textUnderlineOffset: 4, cursor: "pointer" }}
              >
                {menu.label}
              </button>
            ))}
          </div>
          {activeMenu === "pharmacy-store" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 40, margin: "-6px 0 20px", paddingLeft: 16 }}>
              <nav aria-label="Pharmacy Store menu" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
                {pharmacyStoreSubmenus.map((submenu) => (
                  <button
                    key={submenu}
                    type="button"
                    aria-pressed={activeStoreSubmenu === submenu}
                    onClick={() => selectStoreSubmenu(submenu)}
                    style={{ border: 0, background: "transparent", color: activeStoreSubmenu === submenu ? "#16845f" : "#687871", padding: 0, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    {submenu}
                  </button>
                ))}
              </nav>
              <section aria-live="polite" style={{ flex: "1 1 0", minWidth: 0, minHeight: 80, color: "#26352f", fontSize: 15, fontWeight: 600 }}>
                {activeStoreSubmenu === "Product Management" && <p style={{ margin: 0 }}>Hello Product Management</p>}
                {activeStoreSubmenu === "Add Payment Method" && (
                  <section aria-labelledby="payment-method-title" style={{ width: "100%", maxWidth: 900, color: "#26352f" }}>
                    <h2 id="payment-method-title" style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>{editingPaymentMethodId ? "Edit Payment Method" : "Add Payment Method"}</h2>
                    <form onSubmit={savePaymentMethod} style={{ display: "grid", gap: 14, padding: 16, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb" }}>
                      <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                        Payment type
                        <select
                          value={paymentMethodType}
                          onChange={(event) => {
                            if (event.currentTarget.value === "mobile" || event.currentTarget.value === "bank") {
                              setPaymentMethodType(event.currentTarget.value);
                            }
                          }}
                          style={{ width: "100%", maxWidth: 360, boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                        >
                          <option value="mobile">Mobile Banking</option>
                          <option value="bank">Bank Account</option>
                        </select>
                      </label>

                      {paymentMethodType === "mobile" ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>Payment Method Name <span aria-hidden="true" style={{ color: "#b34b43" }}>*</span></span>
                            <input
                              list="default-mobile-payment-names"
                              required
                              value={paymentMethodName}
                              onChange={(event) => setPaymentMethodName(event.currentTarget.value)}
                              placeholder="Select or enter a name"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                            <datalist id="default-mobile-payment-names">
                              {defaultMobilePaymentNames
                                .filter((name) => !existingMobilePaymentNames.has(name.toLocaleLowerCase()))
                                .map((name) => <option key={name} value={name} />)}
                            </datalist>
                          </label>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            Phone Number
                            <input
                              type="tel"
                              inputMode="tel"
                              value={paymentPhone}
                              onChange={(event) => setPaymentPhone(event.currentTarget.value)}
                              placeholder="Enter phone number"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                          </label>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>Bank Name <span aria-hidden="true" style={{ color: "#b34b43" }}>*</span></span>
                            <select
                              required
                              value={bankName}
                              onChange={(event) => setBankName(event.currentTarget.value)}
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            >
                              <option value="">Select bank</option>
                              {bankNames
                                .filter((name) => !existingBankNames.has(name.toLocaleLowerCase()))
                                .map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                          </label>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>Account Holder Name <span aria-hidden="true" style={{ color: "#b34b43" }}>*</span></span>
                            <input
                              required
                              value={accountHolderName}
                              onChange={(event) => setAccountHolderName(event.currentTarget.value)}
                              placeholder="Enter account holder name"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>Account Number <span aria-hidden="true" style={{ color: "#b34b43" }}>*</span></span>
                            <input
                              required
                              value={accountNumber}
                              onChange={(event) => setAccountNumber(event.currentTarget.value)}
                              placeholder="Enter account number"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>Branch <span style={{ color: "#687871", fontWeight: 400 }}>(optional)</span></span>
                            <input
                              value={bankBranch}
                              onChange={(event) => setBankBranch(event.currentTarget.value)}
                              placeholder="Enter branch"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                            <span>District <span style={{ color: "#687871", fontWeight: 400 }}>(optional)</span></span>
                            <input
                              value={bankDistrict}
                              onChange={(event) => setBankDistrict(event.currentTarget.value)}
                              placeholder="Enter district"
                              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                            />
                          </label>
                        </div>
                      )}

                      <div>
                        <button
                          type="submit"
                          style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                        >
                          {editingPaymentMethodId ? "Update Payment Method" : "Add Payment Method"}
                        </button>
                        {editingPaymentMethodId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPaymentMethodId(null);
                              setPaymentMethodName("");
                              setPaymentPhone("");
                              setBankName("");
                              setAccountHolderName("");
                              setAccountNumber("");
                              setBankBranch("");
                              setBankDistrict("");
                              setPaymentMethodMessage("");
                              setPaymentMethodError("");
                            }}
                            style={{ marginLeft: 8, border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#526158", padding: "8px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                    {paymentMethodMessage && <p role="status" style={{ margin: "10px 0 0", color: "#16845f", fontSize: 12 }}>{paymentMethodMessage}</p>}
                    {paymentMethodError && <p role="alert" style={{ margin: "10px 0 0", color: "#b34b43", fontSize: 12 }}>{paymentMethodError}</p>}
                  </section>
                )}
                {activeStoreSubmenu === "Account Info" && (
                  <section aria-labelledby="account-info-title" style={{ width: "100%", maxWidth: 900, color: "#26352f" }}>
                    <h2 id="account-info-title" style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Account Info</h2>
                    {paymentMethodMessage && <p role="status" style={{ margin: "0 0 10px", color: "#16845f", fontSize: 12 }}>{paymentMethodMessage}</p>}
                    {paymentMethodError && <p role="alert" style={{ margin: "0 0 10px", color: "#b34b43", fontSize: 12 }}>{paymentMethodError}</p>}
                    <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                      {paymentMethods.length === 0 && <p style={{ margin: 0, color: "#687871", fontSize: 13 }}>No payment methods added yet.</p>}
                      {paymentMethods.map((method) => (
                        <article key={method.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: 12, border: "1px solid #e5ebe7", borderRadius: 7, background: "#fff", color: "#526158", fontSize: 12 }}>
                          <div>
                            {method.type === "mobile" ? (
                              <>
                                <strong style={{ color: "#26352f" }}>{method.name}</strong>
                                <span style={{ marginLeft: 10 }}>Mobile Banking</span>
                                {method.phone && <div style={{ marginTop: 5 }}>Phone Number: {method.phone}</div>}
                              </>
                            ) : (
                              <>
                                <strong style={{ color: "#26352f" }}>{method.bankName}</strong>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "5px 12px", marginTop: 6 }}>
                                  <span>Account Holder: {method.accountHolderName}</span>
                                  <span>Account Number: {method.accountNumber}</span>
                                  {method.branch && <span>Branch: {method.branch}</span>}
                                  {method.district && <span>District: {method.district}</span>}
                                </div>
                              </>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => editPaymentMethod(method)}
                              style={{ border: "1px solid #dce5df", borderRadius: 5, background: "#fff", color: "#17704e", padding: "5px 9px", fontSize: 11, cursor: "pointer" }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePaymentMethod(method.id)}
                              style={{ border: "1px solid #f1d8d5", borderRadius: 5, background: "#fff", color: "#ad4b43", padding: "5px 9px", fontSize: 11, cursor: "pointer" }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                {activeStoreSubmenu === "Return System" && (
                  <section aria-labelledby="return-system-title" style={{ width: "100%", maxWidth: 900, color: "#26352f" }}>
                    <h2 id="return-system-title" style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Return System</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
                      <div>
                        <label htmlFor="return-deduction-default-rate" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                          Return Deduction %
                          <input
                            id="return-deduction-default-rate"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            inputMode="decimal"
                            value={returnDeductionRate}
                            onFocus={() => setReturnDeductionRate("")}
                            onChange={(event) => {
                              setReturnDeductionRate(event.currentTarget.value);
                              setReturnDeductionMessage("");
                              setReturnDeductionError("");
                            }}
                            style={{ width: 140, boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={saveReturnDeductionSettings}
                          style={{ marginTop: 12, border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                        >
                          Save
                        </button>
                      </div>
                      <aside aria-live="polite" style={{ minHeight: 72, borderLeft: "2px solid #dce5df", paddingLeft: 16 }}>
                        <h3 style={{ margin: 0, color: "#16845f", fontSize: 13, fontWeight: 700 }}>Saved Return Deduction</h3>
                        <p style={{ margin: "8px 0 0", color: "#26352f", fontSize: 14, fontWeight: 600 }}>
                          {savedReturnDeductionRate}%
                        </p>
                      </aside>
                    </div>
                    {returnDeductionMessage && <p role="status" style={{ margin: "10px 0 0", color: "#16845f", fontSize: 12 }}>{returnDeductionMessage}</p>}
                    {returnDeductionError && <p role="alert" style={{ margin: "10px 0 0", color: "#b34b43", fontSize: 12 }}>{returnDeductionError}</p>}
                  </section>
                )}
                {activeStoreSubmenu === "VAT/TAX" && (
                  <section aria-labelledby="vat-tax-settings-title" style={{ width: "100%", maxWidth: 760, color: "#26352f" }}>
                    <h2 id="vat-tax-settings-title" style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>VAT/TAX setup</h2>
                    <p style={{ margin: "0 0 16px", color: "#687871", fontSize: 12, fontWeight: 400, lineHeight: 1.6 }}>
                      The default is 0% until you set it. Applicable VAT and supplementary-duty rates depend on product classification and current NBR rules; confirm the correct rate for your products before applying it. You can change the rate on each sale.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 24, alignItems: "center" }}>
                      <div>
                        <label htmlFor="vat-tax-default-rate" style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                          Default VAT/TAX rate (%)
                          <input
                            id="vat-tax-default-rate"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            inputMode="decimal"
                            value={vatTaxRate}
                            onChange={(event) => {
                              setVatTaxRate(event.currentTarget.value);
                              setVatTaxMessage("");
                              setVatTaxError("");
                            }}
                            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={saveVatTaxSettings}
                          style={{ marginTop: 12, border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                        >
                          Save
                        </button>
                      </div>
                      <aside style={{ borderLeft: "2px solid #dce5df", paddingLeft: 16 }}>
                        <h3 style={{ margin: 0, color: "#16845f", fontSize: 13, fontWeight: 700 }}>Per-sale adjustment</h3>
                        <p style={{ margin: "8px 0 0", color: "#687871", fontSize: 12, fontWeight: 400, lineHeight: 1.6 }}>
                          The saved rate is stored in this browser and prefilled for new sales on this device. A cashier can adjust it for an individual sale without changing this default.
                        </p>
                      </aside>
                    </div>
                    {vatTaxMessage && <p role="status" style={{ margin: "10px 0 0", color: "#16845f", fontSize: 12, fontWeight: 400 }}>{vatTaxMessage}</p>}
                    {vatTaxError && <p role="alert" style={{ margin: "10px 0 0", color: "#b34b43", fontSize: 12, fontWeight: 400 }}>{vatTaxError}</p>}
                  </section>
                )}
                {activeStoreSubmenu === "Inventory" && (
                  <section aria-labelledby="low-stock-title" style={{ width: "100%", color: "#26352f" }}>
                    <h2 id="low-stock-title" style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>Low Stock Management</h2>
                    <p style={{ margin: "0 0 16px", color: "#687871", fontSize: 12, fontWeight: 400 }}>
                      Set the quantity at which an item should be considered low in stock.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 24, alignItems: "center" }}>
                      <div>
                        <label htmlFor="low-stock-threshold" style={{ display: "grid", gap: 7, color: "#34453b", fontSize: 12, fontWeight: 600 }}>
                          Low stock threshold (units)
                          <input
                            id="low-stock-threshold"
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={lowStockThreshold}
                            onChange={(event) => {
                              setLowStockThreshold(event.target.value);
                              setLowStockMessage("");
                              setLowStockError("");
                            }}
                            placeholder="Enter quantity"
                            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 13 }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={saveLowStockThreshold}
                          style={{ marginTop: 12, border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
                        >
                          Save
                        </button>
                      </div>
                      <aside aria-live="polite" style={{ borderLeft: "2px solid #dce5df", paddingLeft: 16 }}>
                        <h3 style={{ margin: 0, color: isLowStockEnabled ? "#16845f" : "#dc2626", fontSize: 13, fontWeight: 700 }}>
                          {isLowStockEnabled ? "Low Stock Monitoring Active" : "Low Stock Not Working"}
                        </h3>
                        <p style={{ margin: "8px 0 0", color: "#687871", fontSize: 12, fontWeight: 400, lineHeight: 1.6 }}>
                          {isLowStockEnabled
                            ? `Products with available stock below ${parsedLowStockThreshold} units will appear in the Low Stock list.`
                            : "Enter and save a threshold greater than 0 to enable low stock monitoring."}
                        </p>
                      </aside>
                    </div>
                    {lowStockMessage && <p role="status" style={{ margin: "10px 0 0", color: "#16845f", fontSize: 12, fontWeight: 400 }}>{lowStockMessage}</p>}
                    {lowStockError && <p role="alert" style={{ margin: "10px 0 0", color: "#b34b43", fontSize: 12, fontWeight: 400 }}>{lowStockError}</p>}
                  </section>
                )}
              </section>
            </div>
          )}
        </>
      }
      listTitle=""
    />
  );
}
