"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function ShopSetupPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkAccount() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (error || !profile) {
        if (active) {
          setMessage(error?.message ?? "Account profile could not be found.");
          setHasError(true);
        }
        return;
      }

      if (profile.role !== "pharmacy_user") {
        router.replace("/admin-dashboard");
        return;
      }

      if (active) setIsReady(true);
    }

    void checkAccount().catch((error: unknown) => {
      if (active) {
        setMessage(error instanceof Error ? error.message : "Unable to verify your account.");
        setHasError(true);
      }
    });

    return () => {
      active = false;
    };
  }, [router]);

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);
    setMessage("");
    setHasError(false);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setMessage(authError?.message ?? "Please sign in before setting up your store.");
        setHasError(true);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profile) {
        setMessage(profileError?.message ?? "Your account profile was not found. Confirm that the signup migration is applied to the Supabase project used by this app.");
        setHasError(true);
        return;
      }

      if (profile.role !== "pharmacy_user") {
        setMessage(`This signed-in account has role "${profile.role}" and cannot set up a pharmacy.`);
        setHasError(true);
        return;
      }

      const { error } = await supabase.rpc("complete_pharmacy_setup", {
        requested_store_name: String(formData.get("store_name") ?? "").trim(),
        requested_company_name: String(formData.get("company_name") ?? "").trim(),
        requested_address: String(formData.get("address") ?? "").trim(),
        requested_city: String(formData.get("city") ?? "").trim(),
        requested_country: String(formData.get("country") ?? "").trim(),
      });

      if (error) {
        const isRoleRejection = error.message.includes("Only pharmacy accounts can complete store setup");
        setMessage(isRoleRejection
          ? "Your signed-in profile is pharmacy_user, but the database setup function rejected it. Apply migration 20261002130000_fix_pharmacy_setup_role_check.sql to the Supabase project configured for this app."
          : error.message);
        setHasError(true);
        return;
      }

      router.replace("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save pharmacy details.");
      setHasError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f4f8f5",
        color: "#122b2a",
        fontFamily: "Inter, Arial, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          background: "#ffffff",
          border: "1px solid rgba(18,43,42,0.08)",
          borderRadius: 24,
          boxShadow: "0 20px 60px rgba(17, 24, 39, 0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #eafaf4 0%, #f3fbf8 100%)",
            borderBottom: "1px solid rgba(18,43,42,0.06)",
            padding: "24px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "linear-gradient(135deg, #2ad49a, #1ac490)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.04em" }}>Pharmecy Cluster</div>
              <div style={{ fontSize: 12, color: "#5f7a73" }}>Setup your pharmacy</div>
            </div>
          </div>

          <div
            style={{
              background: "rgba(42,212,154,0.11)",
              color: "#1d7059",
              border: "1px solid rgba(42,212,154,0.25)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            2 of 2
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
          }}
        >
          <div style={{ padding: "32px" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "24px",
                letterSpacing: "-0.05em",
                fontWeight: 800,
                color: "#102d2a",
              }}
            >
              Set up your store
            </h1>
            <p
              style={{
                margin: "10px 0 26px",
                color: "#59706d",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              Add your pharmacy details and continue to your dashboard.
            </p>

            <form onSubmit={saveStore} style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>Store Name</label>
                <input
                  type="text"
                  name="store_name"
                  required
                  placeholder="Green Valley Pharmacy"
                  style={{
                    width: "100%",
                    border: "1px solid rgba(16, 36, 35, 0.12)",
                    borderRadius: 12,
                    padding: "8px 14px",
                    fontSize: 12,
                    color: "#102d2a",
                    background: "#f9fafb",
                    boxSizing: "border-box",
                  }}
                />
              </div>

                <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>Company Name</label>
                <input
                  type="text"
                  name="company_name"
                  placeholder="Valley Health Ltd."
                  style={{
                    width: "100%",
                    border: "1px solid rgba(16, 36, 35, 0.12)",
                    borderRadius: 12,
                    padding: "8px 14px",
                    fontSize: 12,
                    color: "#102d2a",
                    background: "#f9fafb",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>Physical Store Address</label>
                <textarea
                  name="address"
                  required
                  placeholder="123 Main Road, Dhanmondi, Dhaka"
                  style={{
                    width: "100%",
                    minHeight: 90,
                    border: "1px solid rgba(16, 36, 35, 0.12)",
                    borderRadius: 12,
                    padding: "8px 14px",
                    fontSize: 12,
                    color: "#102d2a",
                    background: "#f9fafb",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>City</label>
                  <input
                    type="text"
                    name="city"
                    required
                    placeholder="Dhaka"
                    style={{
                      width: "100%",
                      border: "1px solid rgba(16, 36, 35, 0.12)",
                      borderRadius: 12,
                      padding: "8px 14px",
                      fontSize: 12,
                      color: "#102d2a",
                      background: "#f9fafb",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>Country</label>
                  <input
                    type="text"
                    name="country"
                    required
                    defaultValue="Bangladesh"
                    placeholder="Bangladesh"
                    style={{
                      width: "100%",
                      border: "1px solid rgba(16, 36, 35, 0.12)",
                      borderRadius: 12,
                      padding: "8px 14px",
                      fontSize: 12,
                      color: "#102d2a",
                      background: "#f9fafb",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!isReady || isSubmitting}
                style={{
                  display: "block",
                  width: "100%",
                  border: "none",
                  borderRadius: 12,
                  padding: "8px 14px",
                  background: "#2ad49a",
                  color: "#072f2a",
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: "center",
                  textDecoration: "none",
                  boxSizing: "border-box",
                  cursor: !isReady || isSubmitting ? "wait" : "pointer",
                  opacity: !isReady || isSubmitting ? 0.65 : 1,
                }}
              >
                {isSubmitting ? "Saving..." : "Save and continue"}
              </button>
              {message && <p role={hasError ? "alert" : "status"} style={{ margin: 0, color: hasError ? "#ad4b43" : "#1d7059", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
            </form>
          </div>

          <aside
            style={{
              background: "linear-gradient(180deg, #0d2f2a 0%, #163d38 100%)",
              color: "#ffffff",
              padding: "32px 24px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 20,
                }}
              >
                <span>✓</span> Ready to launch
              </div>

              <h2 style={{ margin: 0, fontSize: "28px", letterSpacing: "-0.05em", fontWeight: 800 }}>Your growth starts here</h2>

              <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
                {[
                  "Track inventory and expiry dates",
                  "Manage sales and invoices in real time",
                  "Monitor profit with business analytics",
                ].map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
                    <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#2ad49a", color: "#072f2a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900 }}>✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

          </aside>
        </div>
      </div>
    </div>
  );
}
