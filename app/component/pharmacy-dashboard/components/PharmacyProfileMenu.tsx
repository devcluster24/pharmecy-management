"use client";

import { useEffect, useState, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

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
      style={{ position: "relative" }}
      onBlur={closeOnFocusLeave}
    >
      <button
        type="button"
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
            Profile
          </button>
          <button
            type="button"
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
            {isSigningOut ? "Signing out..." : "Sign out"}
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