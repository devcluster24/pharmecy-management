"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import {
  LOW_STOCK_THRESHOLD_STORAGE_KEY,
  saveLowStockThreshold as persistLowStockThreshold,
} from "./lowStockStorage";

const settingsMenus = [
  { id: "pharmacy-store", label: "Pharmacy Store" },
  { id: "subscription-bill", label: "Subcription & Bill" },
  { id: "documents-invoice", label: "Documents & Invoice" },
  { id: "store-bill-payment", label: "Store Bill Payment" },
  { id: "profile", label: "Profile" },
] as const;

const pharmacyStoreSubmenus = ["Product Management", "Inventory"] as const;

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
  const [profileState, setProfileState] = useState<ProfileState>({
    status: "loading",
    profile: null,
    error: "",
  });

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
