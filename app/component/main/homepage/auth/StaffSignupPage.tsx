"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import PasswordInput from "@/app/component/PasswordInput";
import { supabase } from "@/lib/supabase/client";

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #dfe4e2",
  borderRadius: 12,
  padding: "11px 14px",
  background: "#fff",
  color: "#111827",
  fontSize: 14,
  outline: "none",
};

export default function StaffSignupPage({ token }: { token: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompletingGoogleSignup, setIsCompletingGoogleSignup] = useState(false);
  const [signupFinished, setSignupFinished] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const hasHandledGoogleCallback = useRef(false);

  useEffect(() => {
    if (hasHandledGoogleCallback.current || !/^[a-f0-9]{64}$/i.test(token)) return;

    const query = new URLSearchParams(window.location.search);
    if (query.get("staff_google") !== "1") return;
    hasHandledGoogleCallback.current = true;

    async function completeGoogleSignup() {
      setIsCompletingGoogleSignup(true);
      setMessage("");
      setHasError(false);
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          throw new Error("Google sign-in did not complete. Please try again.");
        }

        const { error } = await supabase.rpc("complete_pharmacy_staff_oauth_signup", {
          requested_invite_token: token,
        });
        if (error) throw error;

        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          setMessage(`Staff account created, but sign out failed: ${signOutError.message}`);
          setHasError(true);
          setSignupFinished(true);
          return;
        }

        setSignupFinished(true);
        setMessage("Google signup complete. Your pharmacy owner must approve your account and assign dashboard access before you can sign in.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not finish Google staff signup.";
        const { error: signOutError } = await supabase.auth.signOut();
        setHasError(true);
        setMessage(signOutError ? `${message} Sign out also failed: ${signOutError.message}` : message);
      } finally {
        setIsCompletingGoogleSignup(false);
      }
    }

    void completeGoogleSignup();
  }, [token]);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setHasError(false);
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            registration_type: "pharmacy_staff",
            staff_invite_token: token,
          },
        },
      });
      if (error) throw error;

      setSignupFinished(true);
      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
        setMessage("Staff application submitted. Your pharmacy owner must approve it and assign dashboard access before you can sign in.");
        return;
      }

      setMessage("Check your email to confirm your staff application. Your pharmacy owner must approve it and assign dashboard access before you can sign in.");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "Could not create the staff account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    setIsSubmitting(true);
    setMessage("");
    setHasError(false);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}?staff_google=1`,
        },
      });
      if (error) throw error;
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "Could not start Google signup.");
      setIsSubmitting(false);
    }
  }

  const isInvalidLink = !/^[a-f0-9]{64}$/i.test(token);

  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", background: "#f6f5f4", color: "#1f2937", fontFamily: "Inter, Arial, sans-serif" }}>
      <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px clamp(24px, 7vw, 80px)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 44, color: "#1f2937", textDecoration: "none" }}>
          <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "linear-gradient(135deg, #2ad49a, #1ac490)", color: "#fff", fontSize: 14, fontWeight: 900 }}>⚡</span>
          <strong style={{ fontSize: 18, fontWeight: 650 }}>Pharmacy Cluster</strong>
        </Link>
        <div style={{ width: "100%", maxWidth: 460, margin: "0 auto" }}>
          <span style={{ color: "#1d7059", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>STAFF INVITATION</span>
          <h1 style={{ margin: "10px 0 8px", color: "#111827", fontSize: 30, lineHeight: 1.1, fontWeight: 750 }}>Create staff account</h1>
          <p style={{ margin: "0 0 26px", color: "#525a63", fontSize: 14, lineHeight: 1.6 }}>
            Sign up using your email and a password, or continue with Google. Your pharmacy owner shared this private invitation link with you.
          </p>
          {isInvalidLink ? (
            <p role="alert" style={{ color: "#ad4b43", fontSize: 13 }}>This staff signup link is invalid. Ask your pharmacy owner to create a new one.</p>
          ) : isCompletingGoogleSignup ? (
            <p role="status" style={{ margin: 0, color: "#276749", fontSize: 12, lineHeight: 1.5 }}>Finishing Google signup...</p>
          ) : signupFinished ? (
            <p role={hasError ? "alert" : "status"} style={{ margin: 0, color: hasError ? "#ad4b43" : "#276749", fontSize: 12, lineHeight: 1.5 }}>
              {message}
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={isSubmitting || isCompletingGoogleSignup}
                onClick={() => void handleGoogleSignup()}
                style={{ width: "100%", border: "1px solid #dfe4e2", borderRadius: 10, padding: "11px 14px", background: "#fff", color: "#1f2937", fontSize: 13, fontWeight: 650, cursor: isSubmitting || isCompletingGoogleSignup ? "wait" : "pointer", opacity: isSubmitting || isCompletingGoogleSignup ? 0.7 : 1 }}
              >
                Continue with Google
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0", color: "#7a8088", fontSize: 12 }}>
                <span style={{ flex: 1, height: 1, background: "#e4e5e4" }} />
                <span>or</span>
                <span style={{ flex: 1, height: 1, background: "#e4e5e4" }} />
              </div>
              <form onSubmit={handleSignup} style={{ display: "grid", gap: 13 }}>
                <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>
                  Email
                  <input
                    name="email"
                    required
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>
                  Password
                  <PasswordInput name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" style={fieldStyle} />
                </label>
                <button type="submit" disabled={isSubmitting || isCompletingGoogleSignup} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#2ad49a", color: "#042b22", fontSize: 13, fontWeight: 700, cursor: isSubmitting || isCompletingGoogleSignup ? "wait" : "pointer", opacity: isSubmitting || isCompletingGoogleSignup ? 0.7 : 1 }}>
                  {isSubmitting ? "Creating account..." : "Create staff account"}
                </button>
              </form>
            </>
          )}
          {message && !signupFinished && <p role={hasError ? "alert" : "status"} style={{ margin: "14px 0 0", color: hasError ? "#ad4b43" : "#276749", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
          <p style={{ margin: "20px 0 0", color: "#525a63", fontSize: 12 }}>
            Already have an account? <Link href="/login" style={{ color: "#111827", fontWeight: 650, textDecoration: "none" }}>Sign in</Link>
          </p>
        </div>
      </section>
      <aside style={{ display: "grid", placeItems: "center", overflow: "hidden", borderLeft: "1px solid #e5e5e4", backgroundColor: "#f4f3f2", backgroundImage: "radial-gradient(#dfe3df 1.4px, transparent 1.4px)", backgroundSize: "18px 18px" }}>
        <div style={{ padding: 32, color: "#111827", textAlign: "center" }}>
          <span style={{ color: "#1d7059", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PHARMACY CLUSTER</span>
          <h2 style={{ margin: "14px 0 0", fontSize: 36, lineHeight: 1.15, fontWeight: 700 }}>Welcome to your pharmacy team</h2>
        </div>
      </aside>
    </main>
  );
}
