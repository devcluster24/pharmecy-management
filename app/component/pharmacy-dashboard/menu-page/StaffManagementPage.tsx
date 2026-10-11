"use client";

import { useState } from "react";
import DashboardSectionPage, { type SectionData } from "../DashboardSectionPage";
import { supabase } from "@/lib/supabase/client";

const pageData: SectionData = {
  description: "Create a unique signup link for a staff member.",
  action: "Create Staff URL",
  metrics: [],
  columns: [],
  rows: [],
};

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function StaffManagementPage() {
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  async function createStaffUrl() {
    setIsCreating(true);
    setInviteUrl("");
    setMessage("");
    setIsCopied(false);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user) throw new Error("Sign in again before creating a staff signup link.");

      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const tokenHash = await hashToken(token);
      const { error } = await supabase.rpc("create_pharmacy_staff_invite", {
        requested_token_hash: tokenHash,
      });
      if (error) throw error;

      setInviteUrl(`${window.location.origin}/staff-signup/${token}`);
      setMessage("This private link can create one staff account and expires in 30 days.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a staff signup link.");
    } finally {
      setIsCreating(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setIsCopied(true);
      setMessage("Signup link copied. Share it only with the intended staff member.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not copy the signup link.");
    }
  }

  const actionContent = (
    <button
      type="button"
      disabled={isCreating}
      onClick={() => void createStaffUrl()}
      style={{ border: 0, borderRadius: 7, background: "#179c70", color: "#fff", padding: "10px 14px", fontSize: 13, fontWeight: 650, cursor: isCreating ? "wait" : "pointer", opacity: isCreating ? 0.7 : 1 }}
    >
      {isCreating ? "Creating link..." : "Create Staff URL"}
    </button>
  );

  return (
    <DashboardSectionPage
      sectionSlug="staff"
      data={pageData}
      actionContent={actionContent}
      content={
        <section aria-live="polite" style={{ maxWidth: 680, marginTop: 24, padding: 22, border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
          <h2 style={{ margin: 0, color: "#26352f", fontSize: 16 }}>Create staff signup link</h2>
          <p style={{ margin: "9px 0 16px", color: "#687871", fontSize: 12, lineHeight: 1.6 }}>
            Staff can use this link to create an account with a phone number and password. Staff accounts do not have dashboard or store-data access yet.
          </p>
          {message && <p role="status" style={{ margin: "0 0 12px", color: inviteUrl ? "#276749" : "#ad4b43", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
          {inviteUrl && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                aria-label="Staff signup URL"
                readOnly
                value={inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
                style={{ flex: "1 1 360px", minWidth: 0, boxSizing: "border-box", border: "1px solid #dce5df", borderRadius: 6, padding: "9px 10px", color: "#26352f", fontSize: 12 }}
              />
              <button
                type="button"
                onClick={() => void copyInviteUrl()}
                style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 12px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}
              >
                {isCopied ? "Copied" : "Copy URL"}
              </button>
            </div>
          )}
        </section>
      }
    />
  );
}
