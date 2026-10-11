"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
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
  const [isVerifying, setIsVerifying] = useState(false);
  const [phone, setPhone] = useState("");
  const [needsPhoneVerification, setNeedsPhoneVerification] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setHasError(false);
    const formData = new FormData(event.currentTarget);
    const submittedPhone = String(formData.get("phone") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setPhone(submittedPhone);

    try {
      const { data, error } = await supabase.auth.signUp({
        phone: submittedPhone,
        password,
        options: {
          data: {
            registration_type: "pharmacy_staff",
            staff_invite_token: token,
            phone: submittedPhone,
          },
        },
      });
      if (error) throw error;

      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
        setMessage("Staff account created. Dashboard access is not enabled yet; contact your pharmacy owner for next steps.");
        return;
      }

      setNeedsPhoneVerification(true);
      setMessage("Enter the SMS verification code sent to your phone to finish creating the account.");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "Could not create the staff account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setMessage("");
    setHasError(false);
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") ?? "").trim();
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
      if (error) throw error;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setNeedsPhoneVerification(false);
      setMessage("Phone verified and staff account created. Dashboard access is not enabled yet; contact your pharmacy owner for next steps.");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "Could not verify the phone number.");
    } finally {
      setIsVerifying(false);
    }
  }

  const isInvalidLink = !/^[a-f0-9]{64}$/i.test(token);

  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", background: "#f6f5f4", color: "#1f2937", fontFamily: "Inter, Arial, sans-serif" }}>
      <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px clamp(24px, 7vw, 80px)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 44, color: "#1f2937", textDecoration: "none" }}>
          <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "linear-gradient(135deg, #2ad49a, #1ac490)", color: "#fff", fontSize: 14, fontWeight: 900 }}>⚡</span>
          <strong style={{ fontSize: 18, fontWeight: 650 }}>Pharmecy Cluster</strong>
        </Link>
        <div style={{ width: "100%", maxWidth: 460, margin: "0 auto" }}>
          <span style={{ color: "#1d7059", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>STAFF INVITATION</span>
          <h1 style={{ margin: "10px 0 8px", color: "#111827", fontSize: 30, lineHeight: 1.1, fontWeight: 750 }}>Create staff account</h1>
          <p style={{ margin: "0 0 26px", color: "#525a63", fontSize: 14, lineHeight: 1.6 }}>
            Sign up using your phone number and a password. Your pharmacy owner shared this private invitation link with you.
          </p>
          {isInvalidLink ? (
            <p role="alert" style={{ color: "#ad4b43", fontSize: 13 }}>This staff signup link is invalid. Ask your pharmacy owner to create a new one.</p>
          ) : needsPhoneVerification ? (
            <form onSubmit={verifyPhone} style={{ display: "grid", gap: 13 }}>
              <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>
                SMS verification code
                <input name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="Enter the code sent by SMS" style={fieldStyle} />
              </label>
              <button type="submit" disabled={isVerifying} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#2ad49a", color: "#042b22", fontSize: 13, fontWeight: 700, cursor: isVerifying ? "wait" : "pointer", opacity: isVerifying ? 0.7 : 1 }}>
                {isVerifying ? "Verifying..." : "Verify phone"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} style={{ display: "grid", gap: 13 }}>
              <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>
                Phone Number
                <input
                  name="phone"
                  required
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.currentTarget.value)}
                  placeholder="+880 1XXX-XXXXXX"
                  style={fieldStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>
                Password
                <input name="password" required type="password" minLength={8} autoComplete="new-password" placeholder="At least 8 characters" style={fieldStyle} />
              </label>
              <button type="submit" disabled={isSubmitting} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#2ad49a", color: "#042b22", fontSize: 13, fontWeight: 700, cursor: isSubmitting ? "wait" : "pointer", opacity: isSubmitting ? 0.7 : 1 }}>
                {isSubmitting ? "Creating account..." : "Create staff account"}
              </button>
            </form>
          )}
          {message && <p role={hasError ? "alert" : "status"} style={{ margin: "14px 0 0", color: hasError ? "#ad4b43" : "#276749", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
          <p style={{ margin: "20px 0 0", color: "#525a63", fontSize: 12 }}>
            Already have an account? <Link href="/login" style={{ color: "#111827", fontWeight: 650, textDecoration: "none" }}>Sign in</Link>
          </p>
        </div>
      </section>
      <aside style={{ display: "grid", placeItems: "center", overflow: "hidden", borderLeft: "1px solid #e5e5e4", backgroundColor: "#f4f3f2", backgroundImage: "radial-gradient(#dfe3df 1.4px, transparent 1.4px)", backgroundSize: "18px 18px" }}>
        <div style={{ padding: 32, color: "#111827", textAlign: "center" }}>
          <span style={{ color: "#1d7059", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PHARMECY CLUSTER</span>
          <h2 style={{ margin: "14px 0 0", fontSize: 36, lineHeight: 1.15, fontWeight: 700 }}>Welcome to your pharmacy team</h2>
        </div>
      </aside>
    </main>
  );
}
