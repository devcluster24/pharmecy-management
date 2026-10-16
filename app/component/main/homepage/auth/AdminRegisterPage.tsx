"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import PasswordInput from "@/app/component/PasswordInput";
import { supabase } from "@/lib/supabase/client";

const fieldStyle = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #dfe4e2", borderRadius: 10, padding: "11px 13px", background: "#fff", color: "#111827", fontSize: 14, outline: "none" };

export default function AdminRegisterPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  async function registerAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    setIsSubmitting(true);
    setMessage("");
    setHasError(false);

    const { data, error } = await supabase.auth.signUp({
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      password: String(formData.get("password") ?? ""),
      options: {
        data: {
          registration_type: "admin",
          full_name: String(formData.get("full_name") ?? "").trim(),
          username: String(formData.get("username") ?? "").trim(),
          phone: String(formData.get("phone") ?? "").trim(),
        },
      },
    });

    setIsSubmitting(false);
    if (error) {
      setMessage(error.message);
      setHasError(true);
      return;
    }

    if (data.session) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setMessage(`Your admin request was submitted, but sign out failed: ${signOutError.message}`);
        setHasError(true);
        return;
      }
      formElement.reset();
      setMessage("Admin request submitted. You can sign in after a superadmin approves your account.");
      return;
    }

    formElement.reset();
    setMessage("Admin request submitted. Confirm your email, then wait for a superadmin to approve your account.");
  }

  return (
    <main className="public-auth-page public-auth-layout" style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", background: "#f6f5f4", color: "#1f2937", fontFamily: "Inter, Arial, sans-serif" }}>
      <section className="public-auth-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px clamp(24px, 7vw, 80px)" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 44, color: "#1f2937", textDecoration: "none" }}>
          <Image src="/pharmacy-icon.png" alt="" width={36} height={36} aria-hidden="true" />
          <strong style={{ fontSize: 18, fontWeight: 650 }}>Pharmacy Cluster</strong>
        </Link>
        <div style={{ width: "100%", maxWidth: 460, margin: "0 auto" }}>
          <span style={{ color: "#1d7059", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>ADMIN ACCESS</span>
          <h1 style={{ margin: "10px 0 8px", color: "#111827", fontSize: 30, lineHeight: 1.1, fontWeight: 750 }}>Create admin account</h1>
          <p style={{ margin: "0 0 26px", color: "#525a63", fontSize: 14, lineHeight: 1.6 }}>Submit an admin account request. A superadmin must approve it before you can access the dashboard.</p>
          <form onSubmit={registerAdmin} style={{ display: "grid", gap: 13 }}>
            <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>Full name<input name="full_name" required autoComplete="name" placeholder="Your full name" style={fieldStyle} /></label>
            <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>Username<input name="username" required minLength={3} autoComplete="username" placeholder="yourname" style={fieldStyle} /></label>
            <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>Email<input name="email" required type="email" autoComplete="email" placeholder="admin@example.com" style={fieldStyle} /></label>
            <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>Phone<input name="phone" type="tel" autoComplete="tel" placeholder="+880 1XXX-XXXXXX" style={fieldStyle} /></label>
            <label style={{ display: "grid", gap: 6, color: "#26342f", fontSize: 12, fontWeight: 600 }}>Password<PasswordInput name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" style={fieldStyle} /></label>
            <button type="submit" disabled={isSubmitting} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#2ad49a", color: "#042b22", fontSize: 13, fontWeight: 700, cursor: isSubmitting ? "wait" : "pointer", opacity: isSubmitting ? 0.7 : 1 }}>{isSubmitting ? "Submitting request..." : "Request admin account"}</button>
            {message && <p role={hasError ? "alert" : "status"} style={{ margin: 0, color: hasError ? "#ad4b43" : "#276749", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
          </form>
          <p style={{ margin: "20px 0 0", color: "#525a63", fontSize: 12 }}>Already registered? <Link href="/login" style={{ color: "#111827", fontWeight: 650, textDecoration: "none" }}>Sign in</Link></p>
        </div>
      </section>
      <aside className="public-auth-aside" style={{ display: "grid", placeItems: "center", overflow: "hidden", borderLeft: "1px solid #e5e5e4", backgroundColor: "#f4f3f2", backgroundImage: "radial-gradient(#dfe3df 1.4px, transparent 1.4px)", backgroundSize: "18px 18px" }}>
        <div style={{ padding: 32, color: "#111827", textAlign: "center" }}>
          <span style={{ color: "#1d7059", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PHARMACY CLUSTER</span>
          <h2 style={{ margin: "14px 0 0", fontSize: 36, lineHeight: 1.15, fontWeight: 700 }}>Platform administration</h2>
        </div>
      </aside>
    </main>
  );
}