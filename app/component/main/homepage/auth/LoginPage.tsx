"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/app/component/PasswordInput";
import { supabase } from "@/lib/supabase/client";
import { dashboardNavItems } from "@/app/component/pharmacy-dashboard/navigation";
import { canPharmacyStaffAccess } from "@/lib/pharmacy-staff-permissions";
import { clearPharmacyDashboardIdentity, loadPharmacyDashboardIdentity } from "@/lib/pharmacy-dashboard-identity";

export default function LoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);
  const hasHandledGoogleCallback = useRef(false);

  const completeSignIn = useCallback(async (userId: string) => {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role, approval_status")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile) {
      throw new Error(profileError?.message ?? "Your account profile is not ready yet.");
    }

    if (profile.role === "pharmacy_staff" && profile.approval_status !== "approved") {
      const { error: signOutError } = await supabase.auth.signOut();
      setMessage(signOutError
        ? `Your staff application is waiting for owner approval. Sign out failed: ${signOutError.message}`
        : profile.approval_status === "rejected"
          ? "Your staff application was not approved. Contact your pharmacy owner."
          : "Your staff application is waiting for owner approval.");
      setIsSubmitting(false);
      return;
    }

    if (profile.role === "pharmacy_staff") {
      const identity = await loadPharmacyDashboardIdentity(userId, true);
      if (!identity || identity.role !== "pharmacy_staff" || identity.approvalStatus !== "approved") {
        throw new Error("Your staff account could not load its approved pharmacy access. Ask the pharmacy owner to check your account status.");
      }

      const firstAllowedPage = dashboardNavItems.find((item) =>
        item.slug !== "staff" && canPharmacyStaffAccess(item.slug || "overview", "view"),
      );
      if (!firstAllowedPage) {
        const { error: signOutError } = await supabase.auth.signOut();
        clearPharmacyDashboardIdentity();
        setMessage(signOutError
          ? `Your account is active, but no dashboard pages are enabled. Sign out failed: ${signOutError.message}`
          : "Your account is active, but your pharmacy owner has not enabled any dashboard pages yet.");
        setIsSubmitting(false);
        return;
      }

      router.replace(firstAllowedPage.href);
      return;
    }

    if (profile.approval_status !== "approved") {
      const { error: signOutError } = await supabase.auth.signOut();
      setMessage(signOutError
        ? `Your account is awaiting approval. Sign out failed: ${signOutError.message}`
        : "Your account is awaiting approval.");
      setIsSubmitting(false);
      return;
    }

    if (profile.role === "pharmacy_user") {
      const { data: pharmacy, error: pharmacyError } = await supabase
        .from("pharmacies")
        .select("id")
        .eq("owner_user_id", userId)
        .maybeSingle();

      if (pharmacyError) throw pharmacyError;

      if (!pharmacy) {
        router.replace("/shop-setup");
        return;
      }
    }

    router.replace(profile.role === "admin" || profile.role === "superadmin"
      ? "/admin-dashboard"
      : "/dashboard");
  }, [router]);

  useEffect(() => {
    if (hasHandledGoogleCallback.current) return;
    if (new URLSearchParams(window.location.search).get("google_signin") !== "1") return;
    hasHandledGoogleCallback.current = true;

    async function completeGoogleSignIn() {
      setIsSubmitting(true);
      setMessage("");
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("Google sign-in did not complete. Please try again.");
        await completeSignIn(data.session.user.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not sign in with Google.";
        const { error: signOutError } = await supabase.auth.signOut();
        setMessage(signOutError ? `${message} Sign out also failed: ${signOutError.message}` : message);
        setIsSubmitting(false);
      }
    }

    void completeGoogleSignIn();
  }, [completeSignIn]);

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/login?google_signin=1`,
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Google sign-in.");
      setIsSubmitting(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      setMessage(error?.message ?? "Sign in failed. Please try again.");
      setIsSubmitting(false);
      return;
    }

    try {
      await completeSignIn(data.user.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    const email = emailInputRef.current?.value.trim().toLowerCase() ?? "";
    if (!email) {
      setResetMessage("Enter your email address first.");
      emailInputRef.current?.focus();
      return;
    }
    if (!emailInputRef.current?.checkValidity()) {
      setResetMessage("Enter a valid email address.");
      emailInputRef.current?.focus();
      return;
    }

    setIsSendingReset(true);
    setResetMessage("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetMessage("If an account exists for this email, a password reset link has been sent.");
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : "Could not send the password reset email.");
    } finally {
      setIsSendingReset(false);
    }
  }

  return (
    <div
      className="public-auth-page"
      style={{
        minHeight: "100vh",
        background: "#f6f5f4",
        color: "#1f2937",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 26px 0 26px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/pharmacy-icon.png" alt="" width={36} height={36} aria-hidden="true" />
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.04em" }}>Pharmacy Cluster</span>
        </div>

      </div>

      <div
        className="public-auth-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr",
          minHeight: "calc(100vh - 90px)",
        }}
      >
        <section
          className="public-auth-panel"
          style={{
            padding: "52px 52px 40px 52px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "#f8f8f7",
          }}
        >
          <div style={{ maxWidth: 520, margin: "0 auto", width: "100%" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "30px",
                lineHeight: 1.1,
                letterSpacing: "-0.06em",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Welcome back
            </h1>

            <p
              style={{
                margin: "12px 0 26px",
                fontSize: "16px",
                color: "#525a63",
              }}
            >
              Sign in to your account
            </p>

            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isSubmitting}
              style={{
                width: "100%",
                border: "1px solid #dfe4e2",
                background: "#fff",
                color: "#111827",
                borderRadius: 12,
                padding: "12px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 18,
                cursor: isSubmitting ? "wait" : "pointer",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, #fff 0%, #f3f4f6 100%)",
                  border: "1px solid #dfe4e2",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                G
              </span>
              Continue with Google
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                margin: "18px 0 28px",
                color: "#7a8088",
                fontSize: 18,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "#e4e5e4" }} />
              <span>or</span>
              <div style={{ flex: 1, height: 1, background: "#e4e5e4" }} />
            </div>

            <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 18 }}>
              <label
                htmlFor="login-email"
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 14,
                  color: "#1f2937",
                  fontWeight: 500,
                }}
              >
                Email
              </label>
              <input
                ref={emailInputRef}
                id="login-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                style={{
                  width: "100%",
                  background: "#fff",
                  border: "1px solid #dfe4e2",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 14,
                  color: "#111827",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: 22 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <label
                  htmlFor="login-password"
                  style={{
                    fontSize: 14,
                    color: "#1f2937",
                    fontWeight: 500,
                  }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={isSendingReset}
                  style={{ border: 0, padding: 0, background: "transparent", color: "#4b5563", fontSize: 14, cursor: isSendingReset ? "wait" : "pointer" }}
                >
                  {isSendingReset ? "Sending..." : "Forgot password?"}
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <PasswordInput
                  id="login-password"
                  name="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  style={{
                    width: "100%",
                    background: "#fff",
                    border: "1px solid #dfe4e2",
                    borderRadius: 12,
                    padding: "14px 46px 14px 16px",
                    fontSize: 14,
                    color: "#111827",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: "100%",
                border: "none",
                background: "#2ad49a",
                color: "#042b22",
                borderRadius: 12,
                padding: "14px 18px",
                fontSize: 14,
                fontWeight: 500,
                cursor: isSubmitting ? "wait" : "pointer",
                boxShadow: "0 10px 18px rgba(42,212,154,0.25)",
                marginBottom: 26,
              }}
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
            {message && <p role="alert" style={{ margin: "-12px 0 18px", color: "#ad4b43", fontSize: 13 }}>{message}</p>}
            {resetMessage && <p role="status" style={{ margin: "-12px 0 18px", color: resetMessage.startsWith("If an account exists") ? "#17704e" : "#ad4b43", fontSize: 13 }}>{resetMessage}</p>}
            </form>

            <div style={{ textAlign: "center", fontSize: 14, color: "#4b5563" }}>
              Don&apos;t have an account? <a href="/register" style={{ color: "#111827", fontWeight: 500, textDecoration: "none" }}>Sign up</a>
            </div>
          </div>
        </section>

        <section
          className="public-auth-aside"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f4f3f2",
            borderLeft: "1px solid #e5e5e4",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(#dfe3df 1.4px, transparent 1.4px)",
              backgroundSize: "18px 18px",
              opacity: 0.7,
            }}
          />

          <div
            className="public-auth-promo"
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              color: "#111827",
              fontWeight: 500,
              flexWrap: "wrap",
            }}
          >
            <span className="public-auth-promo-icon" aria-hidden="true">💊</span>
            <div className="public-auth-promo-text">
              Pharmacy Cluster makes work easier.
            </div>
          </div>

          <div
            className="public-auth-signature"
            style={{
              position: "absolute",
              bottom: 110,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              zIndex: 1,
            }}
          >
            <span className="public-auth-signature-icon" aria-hidden="true">💊</span>
            <span className="public-auth-signature-text">Pharmacy Cluster</span>
          </div>
        </section>
      </div>
    </div>
  );
}
