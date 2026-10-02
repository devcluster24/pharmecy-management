"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RequiredRole = "pharmacy_user" | "admin";
type AccessState = "checking" | "allowed" | "blocked" | "failed";

export default function DashboardAccessGate({
  children,
  requiredRole,
}: {
  children: ReactNode;
  requiredRole: RequiredRole;
}) {
  const router = useRouter();
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          if (active) {
            setMessage(profileError.message);
            setAccessState("failed");
          }
          return;
        }

        if (!profile) {
          if (active) {
            setMessage("Your account profile is not ready yet.");
            setAccessState("blocked");
          }
          return;
        }

        if (requiredRole === "pharmacy_user" && profile.role === "pharmacy_user") {
          const { data: pharmacy, error: pharmacyError } = await supabase
            .from("pharmacies")
            .select("id")
            .eq("owner_user_id", user.id)
            .maybeSingle();

          if (pharmacyError) {
            if (active) {
              setMessage(pharmacyError.message);
              setAccessState("failed");
            }
            return;
          }

          if (!pharmacy) {
            router.replace("/shop-setup");
            return;
          }
        }

        const permitted = requiredRole === "admin"
          ? profile.role === "admin" || profile.role === "superadmin"
          : profile.role === "pharmacy_user";

        if (!permitted) {
          if (active) {
            setMessage("This account does not have access to this dashboard.");
            setAccessState("blocked");
          }
          return;
        }

        if (active) setAccessState("allowed");
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Unable to verify account access.");
          setAccessState("failed");
        }
      }
    }

    void checkAccess();
    return () => {
      active = false;
    };
  }, [requiredRole, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (accessState === "allowed") return children;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7f5", fontFamily: "Arial, sans-serif" }}>
      <section aria-live="polite" style={{ width: "min(440px, 100%)", padding: 24, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
        <h1 style={{ margin: 0, color: "#203128", fontSize: 20 }}>{accessState === "checking" ? "Checking account access" : "Dashboard access"}</h1>
        <p style={{ margin: "10px 0 18px", color: "#68776f", fontSize: 13, lineHeight: 1.6 }}>
          {accessState === "checking" ? "Please wait while we verify your account." : message}
        </p>
        {accessState !== "checking" && (
          <button type="button" onClick={signOut} style={{ border: 0, borderRadius: 6, background: "#18845d", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>
            Sign out
          </button>
        )}
      </section>
    </main>
  );
}