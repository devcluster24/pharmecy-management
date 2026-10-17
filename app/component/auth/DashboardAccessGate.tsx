"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { initializePharmacyDataSync } from "@/lib/pharmacy-data-sync";
import { canPharmacyStaffAccess } from "@/lib/pharmacy-staff-permissions";
import {
  clearPharmacyDashboardIdentity,
  loadPharmacyDashboardIdentity,
} from "@/lib/pharmacy-dashboard-identity";
import { recordPharmacySessionActivity } from "@/lib/pharmacy-session-activity";
import { PharmacySubscriptionExpiryProvider } from "./PharmacySubscriptionExpiry";
import PharmacyDataSyncNotice from "./PharmacyDataSyncNotice";

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
  const pathname = usePathname();
  const isSubscriptionPaymentPage = pathname === "/dashboard/paymnet";
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [message, setMessage] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [previouslyAllowedPath, setPreviouslyAllowedPath] = useState<string | null>(null);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string | null>(null);
  const accessStateRef = useRef(accessState);

  useEffect(() => {
    accessStateRef.current = accessState;
  }, [accessState]);

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      if (active) {
        setMessage("");
        setAccessState("checking");
      }

      try {
        const { data: { session }, error: authError } = await supabase.auth.getSession();
        const user = session?.user ?? null;

        if (authError || !user) {
          if (active) {
            setPreviouslyAllowedPath(null);
            router.replace("/login");
          }
          return;
        }

        let profile: { role: string; approvalStatus?: string; ownerUserId?: string; hasPharmacy?: boolean } | null;
        if (requiredRole === "pharmacy_user") {
          const identity = await loadPharmacyDashboardIdentity(user.id, true);
          if (!identity) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage("Your account profile is not ready yet.");
              setAccessState("blocked");
            }
            return;
          }
          profile = identity;
        } else {
          const { data, error } = await supabase
            .from("user_profiles")
            .select("role, approval_status")
            .eq("id", user.id)
            .maybeSingle();
          if (error) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage(error.message);
              setAccessState("failed");
            }
            return;
          }
          profile = data
            ? { role: data.role, approvalStatus: data.approval_status }
            : null;
        }

        if (!profile) {
          if (active) {
            setPreviouslyAllowedPath(null);
            setMessage("Your account profile is not ready yet.");
            setAccessState("blocked");
          }
          return;
        }

        if (
          requiredRole === "pharmacy_user"
          && profile.role === "pharmacy_user"
          && profile.approvalStatus === "suspended"
        ) {
          if (active) {
            setPreviouslyAllowedPath(null);
            setMessage("This pharmacy account is suspended. Contact an administrator for assistance.");
            setAccessState("blocked");
          }
          return;
        }

        if (requiredRole === "pharmacy_user" && profile.role === "pharmacy_user" && !profile.hasPharmacy) {
          if (active) router.replace("/shop-setup");
          return;
        }

        if (
          isSubscriptionPaymentPage
          && (profile.role !== "pharmacy_user" || profile.approvalStatus !== "approved")
        ) {
          if (active) {
            setPreviouslyAllowedPath(null);
            setMessage("Only an approved pharmacy owner can access subscription payment.");
            setAccessState("blocked");
          }
          return;
        }

        if (requiredRole === "pharmacy_user" && profile.role === "pharmacy_user") {
          const { data: subscriptionData, error: subscriptionError } = await supabase.rpc("get_my_pharmacy_subscription_plan");
          if (subscriptionError) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage(`Could not verify subscription setup: ${subscriptionError.message} Apply all subscription migrations through supabase/migrations/20261011230000_subscription_billing_period_selection.sql in the Supabase project, then retry.`);
              setAccessState("failed");
            }
            return;
          }
          if (!subscriptionData || typeof subscriptionData !== "object" || !("is_assigned" in subscriptionData)) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage("Supabase returned invalid subscription setup data.");
              setAccessState("failed");
            }
            return;
          }
          const expiresAt = "expires_at" in subscriptionData
            ? subscriptionData.expires_at
            : undefined;
          if (
            expiresAt !== null
            && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)))
          ) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage("Supabase returned invalid subscription expiry data. Apply supabase/migrations/20261011230000_subscription_billing_period_selection.sql in the Supabase project, then retry.");
              setAccessState("failed");
            }
            return;
          }
          if (active) setSubscriptionExpiresAt(expiresAt ?? null);
          if (subscriptionData.is_assigned !== true && !isSubscriptionPaymentPage) {
            if (active) router.replace("/subscription-setup");
            return;
          }
        }

        const isStaff = profile.role === "pharmacy_staff"
          && profile.approvalStatus === "approved"
          && Boolean(profile.ownerUserId);
        const permitted = requiredRole === "admin"
          ? (profile.role === "admin" || profile.role === "superadmin")
            && profile.approvalStatus === "approved"
          : profile.role === "pharmacy_user" || isStaff;

        if (!permitted) {
          if (active) {
            setPreviouslyAllowedPath(null);
            setMessage(
              requiredRole === "admin"
                && (profile.role === "admin" || profile.role === "superadmin")
                && profile.approvalStatus !== "approved"
                ? profile.approvalStatus === "pending"
                  ? "Your admin account is waiting for approval."
                  : "Your admin account is inactive. Contact a superadmin for assistance."
                : "This account does not have access to this dashboard.",
            );
            setAccessState("blocked");
          }
          return;
        }

        if (isStaff) {
          const page = pathname === "/dashboard"
            ? "overview"
            : pathname.slice("/dashboard/".length).split("/")[0].toLocaleLowerCase();
          if (page !== "profile" && !canPharmacyStaffAccess(page, "view")) {
            if (active) {
              setPreviouslyAllowedPath(null);
              setMessage("Your pharmacy owner has not granted access to this page.");
              setAccessState("blocked");
            }
            return;
          }
        }

        if (requiredRole === "pharmacy_user" && !isSubscriptionPaymentPage) {
          try {
            await initializePharmacyDataSync(profile.ownerUserId ?? user.id);
          } catch (error) {
            if (active) {
              setPreviouslyAllowedPath(null);
              const reason = error instanceof Error ? error.message : "Unknown Supabase error.";
              setMessage(`Could not load this pharmacy's Supabase data: ${reason} Apply migration supabase/migrations/20261011000000_pharmacy_app_data.sql in the Supabase project, then retry.`);
              setAccessState("failed");
            }
            return;
          }
        }

        if (active) {
          setPreviouslyAllowedPath(pathname);
          setAccessState("allowed");
        }
      } catch (error) {
        if (active) {
          setPreviouslyAllowedPath(null);
          setMessage(error instanceof Error ? error.message : "Unable to verify account access.");
          setAccessState("failed");
        }
      }
    }

    void checkAccess();
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearPharmacyDashboardIdentity();
        if (active) router.replace("/login");
      } else if (event === "SIGNED_IN" && accessStateRef.current !== "checking") {
        if (active) {
          setAccessState("checking");
          setCheckAttempt((attempt) => attempt + 1);
        }
      }
    });
    function refreshDashboardAccess() {
      if (document.visibilityState === "visible") {
        setCheckAttempt((attempt) => attempt + 1);
      }
    }
    window.addEventListener("focus", refreshDashboardAccess);
    document.addEventListener("visibilitychange", refreshDashboardAccess);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshDashboardAccess);
      document.removeEventListener("visibilitychange", refreshDashboardAccess);
      authListener.subscription.unsubscribe();
    };
  }, [checkAttempt, isSubscriptionPaymentPage, pathname, requiredRole, router]);

  async function signOut() {
    if (requiredRole === "pharmacy_user") {
      try {
        await recordPharmacySessionActivity("logout");
      } catch (error) {
        console.error("Could not record pharmacy logout activity.", error);
      }
    }
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (accessState === "allowed" || (accessState === "checking" && previouslyAllowedPath === pathname)) {
    return (
      <PharmacySubscriptionExpiryProvider expiresAt={subscriptionExpiresAt}>
        {children}
        <PharmacyDataSyncNotice />
      </PharmacySubscriptionExpiryProvider>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7f5", fontFamily: "Arial, sans-serif" }}>
      <section aria-live="polite" style={{ width: "min(440px, 100%)", padding: 24, border: "1px solid #e3e9e4", borderRadius: 8, background: "#fff" }}>
        <h1 style={{ margin: 0, color: "#203128", fontSize: 20 }}>{accessState === "checking" ? "Checking account access" : "Dashboard access"}</h1>
        <p style={{ margin: "10px 0 18px", color: "#68776f", fontSize: 13, lineHeight: 1.6 }}>
          {accessState === "checking" ? "Please wait while we verify your account." : message}
        </p>
        {accessState !== "checking" && (
          <div style={{ display: "flex", gap: 8 }}>
            {accessState === "failed" && (
              <button type="button" onClick={() => { setAccessState("checking"); setCheckAttempt((attempt) => attempt + 1); }} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>
                Retry
              </button>
            )}
            <button type="button" onClick={signOut} style={{ border: 0, borderRadius: 6, background: "#18845d", color: "#fff", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: "pointer" }}>
              Sign out
            </button>
          </div>
        )}
      </section>
    </main>
  );
}