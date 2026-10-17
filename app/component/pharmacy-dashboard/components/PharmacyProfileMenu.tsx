"use client";

import { useEffect, useState, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { recordPharmacySessionActivity } from "@/lib/pharmacy-session-activity";

export default function PharmacyProfileMenu() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [initials, setInitials] = useState("PC");

  useEffect(() => {
    let active = true;

    async function loadAvatar() {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error("Could not load the user profile photo.", error);
        return;
      }
      if (!active || !data.user) return;

      const metadata = data.user.user_metadata;
      const name = typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";
      const email = data.user.email ?? "";
      const userInitials = name.trim()
        ? name.trim().split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toLocaleUpperCase()
        : email.slice(0, 1).toLocaleUpperCase() || "PC";
      const image = [metadata.avatar_url, metadata.picture, metadata.profile_photo_url, metadata.photo_url]
        .find((value): value is string => typeof value === "string" && value.trim() !== "");
      let safeAvatarUrl = "";
      if (image) {
        try {
          const parsedUrl = new URL(image);
          if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
            safeAvatarUrl = parsedUrl.href;
          }
        } catch {
          safeAvatarUrl = "";
        }
      }

      if (active) {
        setInitials(userInitials);
        setAvatarUrl(safeAvatarUrl);
      }
    }

    void loadAvatar();
    window.addEventListener("pharmacy-profile-updated", loadAvatar);
    return () => {
      active = false;
      window.removeEventListener("pharmacy-profile-updated", loadAvatar);
    };
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    setErrorMessage("");

    try {
      await recordPharmacySessionActivity("logout");
    } catch (error) {
      console.error("Could not record pharmacy logout activity.", error);
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      setIsSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  function closeOnFocusLeave(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsOpen(false);
    }
  }

  return (
    <div
      className="dashboard-profile-menu"
      style={{ position: "relative" }}
      onBlur={closeOnFocusLeave}
    >
      <button
        type="button"
        className="dashboard-profile-trigger"
        aria-label="User profile menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        style={{
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          border: "1px solid #d7ebdf",
          borderRadius: "50%",
          background: "#e5f5ed",
          color: "#187553",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          backgroundImage: avatarUrl ? `url("${avatarUrl.replaceAll('"', "%22")}")` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!avatarUrl && initials}
      </button>

      {isOpen && (
        <div
          className="dashboard-profile-actions"
          role="menu"
          aria-label="Pharmacy profile actions"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 20,
            minWidth: 156,
            padding: 5,
            border: "1px solid #e1e8e3",
            borderRadius: 7,
            background: "#fff",
            boxShadow: "0 8px 24px rgba(22, 42, 31, 0.12)",
          }}
        >
          <button
            type="button"
            className="dashboard-profile-action-button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              router.push("/dashboard/Profile");
            }}
            style={{
              width: "100%",
              padding: "9px 10px",
              border: 0,
              borderRadius: 5,
              background: "transparent",
              color: "#26352f",
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <svg className="dashboard-profile-action-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="6.25" r="3.25" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3.75 17c.35-3.05 2.85-5 6.25-5s5.9 1.95 6.25 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Profile
          </button>
          <button
            type="button"
            className="dashboard-profile-action-button dashboard-profile-logout-button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={isSigningOut}
            style={{
              width: "100%",
              padding: "9px 10px",
              border: 0,
              borderRadius: 5,
              background: "transparent",
              color: "#a33d35",
              textAlign: "left",
              fontSize: 12,
              fontWeight: 600,
              cursor: isSigningOut ? "wait" : "pointer",
            }}
          >
            <svg className="dashboard-profile-action-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="M8.25 3.5H4.5v13h3.75M11 6.25 14.75 10 11 13.75M14.5 10H7.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {isSigningOut ? "Logging out..." : "Logout"}
          </button>
          {errorMessage && (
            <p role="alert" style={{ margin: "4px 8px 6px", color: "#a33d35", fontSize: 11 }}>
              {errorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}