"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import PasswordInput from "@/app/component/PasswordInput";
import { supabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === "PASSWORD_RECOVERY" && session) {
        setHasRecoverySession(true);
        setIsCheckingLink(false);
      }
    });

    async function checkRecoveryLink() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const queryParams = new URLSearchParams(window.location.search);
        const isRecoveryRedirect = hashParams.get("type") === "recovery" || queryParams.has("code");
        if (!active) return;

        if (data.session && isRecoveryRedirect) {
          setHasRecoverySession(true);
        } else if (!data.session) {
          setMessage("This password reset link is invalid or has expired. Request a new one from the login page.");
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not verify the password reset link.");
      } finally {
        if (active) setIsCheckingLink(false);
      }
    }

    void checkRecoveryLink();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSuccess(false);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm-password") ?? "");
    if (password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setIsSuccess(true);
      setMessage("Your password has been updated. You can now sign in with your new password.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f5f4", color: "#1f2937", fontFamily: "Inter, Arial, sans-serif" }}>
      <section style={{ width: "min(440px, 100%)", padding: 32, border: "1px solid #e5e9e6", borderRadius: 14, background: "#fff", boxShadow: "0 16px 40px rgba(15, 28, 21, 0.08)" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Reset your password</h1>
        <p style={{ margin: "0 0 24px", color: "#687871", fontSize: 14, lineHeight: 1.5 }}>Choose a new password for your account.</p>

        {isCheckingLink ? (
          <p role="status" style={{ color: "#687871", fontSize: 14 }}>Verifying your reset link...</p>
        ) : hasRecoverySession && !isSuccess ? (
          <form onSubmit={(event) => void handleSubmit(event)} style={{ display: "grid", gap: 16 }}>
            <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 600 }}>
              New password
              <PasswordInput name="password" required minLength={8} autoComplete="new-password" style={{ boxSizing: "border-box", width: "100%", padding: "12px 14px", border: "1px solid #dfe4e2", borderRadius: 9, fontSize: 14 }} />
            </label>
            <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 600 }}>
              Confirm new password
              <PasswordInput name="confirm-password" required minLength={8} autoComplete="new-password" style={{ boxSizing: "border-box", width: "100%", padding: "12px 14px", border: "1px solid #dfe4e2", borderRadius: 9, fontSize: 14 }} />
            </label>
            <button type="submit" disabled={isSaving} style={{ border: 0, borderRadius: 9, padding: "12px 16px", background: "#2ad49a", color: "#042b22", fontSize: 14, fontWeight: 650, cursor: isSaving ? "wait" : "pointer" }}>
              {isSaving ? "Updating password..." : "Update password"}
            </button>
          </form>
        ) : null}

        {message && <p role={isSuccess ? "status" : "alert"} style={{ margin: "16px 0 0", color: isSuccess ? "#17704e" : "#ad4b43", fontSize: 13, lineHeight: 1.5 }}>{message}</p>}
        {(isSuccess || (!isCheckingLink && !hasRecoverySession)) && (
          <Link href="/login" style={{ display: "inline-block", marginTop: 18, color: "#17704e", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Back to login</Link>
        )}
      </section>
    </main>
  );
}
