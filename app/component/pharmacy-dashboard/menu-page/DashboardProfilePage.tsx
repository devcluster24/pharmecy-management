"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadPharmacyDashboardIdentity } from "@/lib/pharmacy-dashboard-identity";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";

type ProfileDetails = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  storeName: string;
  photoUrl: string;
};

const pageData: SectionData = {
  description: "View your account information.",
  action: "",
  metrics: [],
  columns: [],
  rows: [],
};

function safePhotoUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function displayRole(role: string) {
  if (role === "pharmacy_staff") return "Pharmacy Staff";
  if (role === "pharmacy_user") return "Pharmacy Owner";
  return role.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function DashboardProfilePage() {
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [fullNameDraft, setFullNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Sign in to view your profile.");

        const { data, error: profileError } = await supabase
          .from("user_profiles")
          .select("full_name, email, phone, role, approval_status")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!data) throw new Error("Your profile information could not be found.");

        const identity = await loadPharmacyDashboardIdentity(user.id);
        const metadata = user.user_metadata ?? {};
        const photoUrl = [
          metadata.avatar_url,
          metadata.picture,
          metadata.profile_photo_url,
          metadata.photo_url,
        ].map(safePhotoUrl).find(Boolean) ?? "";

        if (active) {
          const loadedProfile = {
            fullName: data.full_name || "",
            email: data.email || user.email || "",
            phone: data.phone || "",
            role: displayRole(data.role),
            status: data.approval_status === "approved" ? "Active" : "Inactive",
            storeName: identity?.storeName ?? "",
            photoUrl,
          };
          setProfile(loadedProfile);
          setFullNameDraft(loadedProfile.fullName);
          setPhoneDraft(loadedProfile.phone);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load your profile.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    setError("");
    setSuccess("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      event.currentTarget.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile photos must be 5 MB or smaller.");
      event.currentTarget.value = "";
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function cancelEditing() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview("");
    setPhotoFile(null);
    setFullNameDraft(profile?.fullName ?? "");
    setPhoneDraft(profile?.phone ?? "");
    setError("");
    setSuccess("");
    setIsEditing(false);
    if (photoInput.current) photoInput.current.value = "";
  }

  async function saveProfile() {
    const currentProfile = profile;
    if (!currentProfile) {
      setError("Your profile has not finished loading. Please try again.");
      return;
    }
    if (!fullNameDraft.trim()) {
      setError("Full name is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");
    let uploadedPhotoPath = "";
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Sign in again before updating your profile.");

      let photoUrl: string | null = null;
      if (photoFile) {
        const extensionByType: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };
        const extension = extensionByType[photoFile.type];
        uploadedPhotoPath = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("user-profile-photos")
          .upload(uploadedPhotoPath, photoFile, {
            contentType: photoFile.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) throw uploadError;

        photoUrl = `${supabase.storage.from("user-profile-photos").getPublicUrl(uploadedPhotoPath).data.publicUrl}?v=${Date.now()}`;
      }

      const { error: updateError } = await supabase.rpc("update_my_pharmacy_profile", {
        requested_full_name: fullNameDraft.trim(),
        requested_phone: phoneDraft.trim(),
        requested_photo_url: photoUrl,
      });
      if (updateError) throw updateError;

      if (photoUrl && currentProfile.photoUrl) {
        const bucketPath = "/storage/v1/object/public/user-profile-photos/";
        try {
          const previousPhoto = new URL(currentProfile.photoUrl);
          const markerIndex = previousPhoto.pathname.indexOf(bucketPath);
          if (markerIndex >= 0) {
            const previousPath = decodeURIComponent(previousPhoto.pathname.slice(markerIndex + bucketPath.length));
            if (previousPath.startsWith(`${user.id}/`)) {
              const { error: removeError } = await supabase.storage.from("user-profile-photos").remove([previousPath]);
              if (removeError) throw removeError;
            }
          }
        } catch (cleanupError) {
          console.error("Profile updated, but the previous profile photo could not be removed.", cleanupError);
        }
      }

      const updatedProfile = {
        ...currentProfile,
        fullName: fullNameDraft.trim(),
        phone: phoneDraft.trim(),
        photoUrl: photoUrl ?? currentProfile.photoUrl,
      };
      setProfile(updatedProfile);
      window.dispatchEvent(new Event("pharmacy-profile-updated"));
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview("");
      setPhotoFile(null);
      setIsEditing(false);
      setSuccess("Your profile has been updated.");
      if (photoInput.current) photoInput.current.value = "";
    } catch (cause) {
      if (uploadedPhotoPath) {
        const { error: cleanupError } = await supabase.storage.from("user-profile-photos").remove([uploadedPhotoPath]);
        if (cleanupError) console.error("Could not remove the profile photo after the profile update failed.", cleanupError);
      }
      setError(cause instanceof Error ? cause.message : "Could not update your profile.");
    } finally {
      setIsSaving(false);
    }
  }

  const initials = profile?.fullName.trim()
    ? profile.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase()
    : profile?.email.slice(0, 1).toLocaleUpperCase() || "?";
  const displayedPhoto = photoPreview || profile?.photoUrl || "";

  return (
    <DashboardSectionPage
      sectionSlug=""
      pageTitle="Profile"
      hideAction
      data={pageData}
      content={
        <section style={{ maxWidth: 820, overflow: "hidden", border: "1px solid #e4e9e5", borderRadius: 12, background: "#fff", boxShadow: "0 5px 20px rgba(26, 54, 39, 0.04)" }}>
          <div style={{ height: 112, background: "linear-gradient(120deg, #e4f5eb 0%, #d9f0e4 50%, #eff7f1 100%)" }} />
          <div style={{ padding: "0 26px 26px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginTop: -44, marginBottom: 22, flexWrap: "wrap" }}>
              <div
                role={displayedPhoto ? "img" : undefined}
                aria-label={displayedPhoto ? `${profile?.fullName || "User"} profile photo` : undefined}
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 88,
                  height: 88,
                  border: "4px solid #fff",
                  borderRadius: 22,
                  backgroundColor: "#e5f5ed",
                  backgroundImage: displayedPhoto ? `url("${displayedPhoto.replaceAll('"', "%22")}")` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  color: "#187553",
                  fontSize: 27,
                  fontWeight: 750,
                  boxShadow: "0 3px 12px rgba(23, 77, 49, 0.12)",
                }}
              >
                {!displayedPhoto && initials}
              </div>
              <div style={{ paddingBottom: 5 }}>
                <h2 style={{ margin: 0, color: "#203128", fontSize: 21, letterSpacing: "-0.02em" }}>
                  {isLoading ? "Loading profile..." : isEditing ? fullNameDraft || "Your profile" : profile?.fullName || "Your profile"}
                </h2>
                {profile?.email && <p style={{ margin: "5px 0 0", color: "#718078", fontSize: 13 }}>{profile.email}</p>}
              </div>
              {profile && (
                <span style={{ marginLeft: "auto", marginBottom: 7, borderRadius: 20, background: profile.status === "Active" ? "#e8f6ee" : "#fff4e5", color: profile.status === "Active" ? "#18794e" : "#946200", padding: "6px 11px", fontSize: 11, fontWeight: 700 }}>
                  {profile.status}
                </span>
              )}
              {profile && !isLoading && (
                <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
                  {isEditing ? (
                    <>
                      <button type="button" disabled={isSaving} onClick={() => photoInput.current?.click()} style={{ border: "1px solid #cddfd3", borderRadius: 7, background: "#fff", color: "#246548", padding: "8px 11px", fontSize: 12, fontWeight: 650, cursor: isSaving ? "wait" : "pointer" }}>
                        {photoFile ? "Change photo" : "Update photo"}
                      </button>
                      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelection} hidden />
                      <span style={{ alignSelf: "center", color: "#89958e", fontSize: 11 }}>JPG, PNG or WebP · up to 5 MB</span>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setIsEditing(true); setSuccess(""); setError(""); }} style={{ border: "1px solid #cddfd3", borderRadius: 7, background: "#fff", color: "#246548", padding: "8px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>
                      Edit profile
                    </button>
                  )}
                </div>
              )}
            </div>

            {error && <p role="alert" style={{ margin: "12px 0", color: "#ad4b43", fontSize: 13 }}>{error}</p>}
            {success && <p role="status" style={{ margin: "12px 0", color: "#18794e", fontSize: 13 }}>{success}</p>}
            {isLoading ? (
              <p role="status" style={{ color: "#718078", fontSize: 13 }}>Loading account information...</p>
            ) : profile && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  {[
                    ["Full name", "fullName", profile.fullName || "Not provided"],
                    ["Email address", "email", profile.email || "Not provided"],
                    ["Phone number", "phone", profile.phone || "Not provided"],
                    ["Account type", "role", profile.role],
                    ["Pharmacy", "store", profile.storeName || "Not assigned"],
                    ["Account status", "status", profile.status],
                  ].map(([label, key, value]) => (
                    <div key={key} style={{ minWidth: 0, padding: "15px 16px", border: "1px solid #edf0ed", borderRadius: 9, background: "#fbfcfb" }}>
                      <div style={{ marginBottom: 7, color: "#849189", fontSize: 11, fontWeight: 600 }}>{label}</div>
                      {isEditing && key === "fullName" ? (
                        <input aria-label="Full name" autoComplete="name" maxLength={120} value={fullNameDraft} onChange={(event) => setFullNameDraft(event.currentTarget.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "8px 9px", color: "#26352f", fontSize: 13 }} />
                      ) : isEditing && key === "phone" ? (
                        <input aria-label="Phone number" type="tel" autoComplete="tel" maxLength={32} value={phoneDraft} onChange={(event) => setPhoneDraft(event.currentTarget.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "8px 9px", color: "#26352f", fontSize: 13 }} />
                      ) : (
                        <div style={{ overflowWrap: "anywhere", color: "#26352f", fontSize: 13, fontWeight: 600 }}>{value}</div>
                      )}
                    </div>
                  ))}
                </div>
                {isEditing && (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <button type="button" disabled={isSaving} onClick={cancelEditing} style={{ border: "1px solid #dce5df", borderRadius: 7, background: "#fff", color: "#52625a", padding: "9px 13px", fontSize: 12, fontWeight: 600, cursor: isSaving ? "wait" : "pointer" }}>Cancel</button>
                    <button type="button" disabled={isSaving || !fullNameDraft.trim()} onClick={() => void saveProfile()} style={{ border: 0, borderRadius: 7, background: "#16845d", color: "#fff", padding: "9px 15px", fontSize: 12, fontWeight: 700, cursor: isSaving ? "wait" : "pointer", opacity: isSaving || !fullNameDraft.trim() ? 0.7 : 1 }}>
                      {isSaving ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      }
    />
  );
}
