"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      setMessage(profileError?.message ?? "Your account profile is not ready yet.");
      setIsSubmitting(false);
      return;
    }

    if (profile.role === "pharmacy_user") {
      const { data: pharmacy, error: pharmacyError } = await supabase
        .from("pharmacies")
        .select("id")
        .eq("owner_user_id", data.user.id)
        .maybeSingle();

      if (pharmacyError) {
        setMessage(pharmacyError.message);
        setIsSubmitting(false);
        return;
      }

      if (!pharmacy) {
        router.replace("/shop-setup");
        return;
      }
    }

    router.replace(profile.role === "admin" || profile.role === "superadmin"
      ? "/admin-dashboard"
      : "/dashboard");
  }

  return (
    <div
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
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "linear-gradient(135deg, #2ad49a, #1ac490)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 14,
              fontWeight: 900,
            }}
          >
            ⚡
          </div>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.04em" }}>Pharmecy Cluster</span>
        </div>

        <button
          style={{
            border: "1px solid #dfe4e2",
            background: "#fff",
            color: "#1f2937",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          📘 Documentation
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr",
          minHeight: "calc(100vh - 90px)",
        }}
      >
        <section
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
                cursor: "pointer",
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
                  style={{
                    fontSize: 14,
                    color: "#1f2937",
                    fontWeight: 500,
                  }}
                >
                  Password
                </label>
                <span style={{ fontSize: 16, color: "#4b5563" }}>Forgot password?</span>
              </div>

              <div style={{ position: "relative" }}>
                <input
                  type="password"
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
                <span
                  style={{
                    position: "absolute",
                    right: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#8a9198",
                    fontSize: 18,
                  }}
                >
                  ◉
                </span>
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
            </form>

            <div style={{ textAlign: "center", fontSize: 14, color: "#4b5563" }}>
              Don&apos;t have an account? <a href="/register" style={{ color: "#111827", fontWeight: 500, textDecoration: "none" }}>Sign up</a>
            </div>
          </div>
        </section>

        <section
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
            <div
              style={{
                width: 42,
                height: 72,
                borderRadius: 12,
                background: "linear-gradient(180deg, #2d2d2d 0%, #b9b9b9 100%)",
                transform: "skewY(-18deg)",
                opacity: 0.9,
              }}
            />

            <div
              style={{
                fontSize: "54px",
                letterSpacing: "-0.05em",
                lineHeight: 1.2,
                color: "#111827",
              }}
            >
              Supabase is really good.
              <span style={{ color: "#f59e0b", marginLeft: 8 }}>⚡</span>
            </div>
          </div>

          <div
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
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #f6d365, #fda085, #a78bfa)",
                border: "2px solid #fff",
              }}
            />
            <span style={{ fontSize: 16, color: "#4b5563" }}>@shadcn</span>
          </div>
        </section>
      </div>
    </div>
  );
}
