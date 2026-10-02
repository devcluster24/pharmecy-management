"use client";

import { useState, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AdminProfileMenu() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
        aria-label="Admin profile menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        style={{
          width: 34,
          height: 34,
          display: "grid",
          placeItems: "center",
          border: "1px solid #d7ebdf",
          borderRadius: "50%",
          background: "#e5f5ed",
          color: "#187553",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        AD
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Admin profile actions"
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