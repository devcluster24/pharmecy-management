"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "../component/main/homepage/Navbar";
import { supabase } from "@/lib/supabase/client";

type PublicPlan = {
  id: string;
  name: "Starter Access" | "One-Time Setup";
  setup_fee_label: string;
  setup_fee: number;
  recurring_fee: number;
  billing_period: "minutes" | "days" | "month" | "year" | "one-time";
  billing_interval: number;
  description: string;
  standard_subscription_fee: number | null;
  standard_subscription_billing_period: PublicPlan["billing_period"] | null;
  standard_subscription_billing_interval: number | null;
};

function isPublicPlan(value: unknown): value is PublicPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string"
    && (plan.name === "Starter Access" || plan.name === "One-Time Setup")
    && typeof plan.setup_fee_label === "string"
    && typeof plan.setup_fee === "number"
    && typeof plan.recurring_fee === "number"
    && ["minutes", "days", "month", "year", "one-time"].includes(String(plan.billing_period))
    && typeof plan.billing_interval === "number"
    && typeof plan.description === "string"
    && (plan.standard_subscription_fee === null || typeof plan.standard_subscription_fee === "number")
    && (plan.standard_subscription_billing_period === null
      || ["minutes", "days", "month", "year", "one-time"].includes(String(plan.standard_subscription_billing_period)))
    && (plan.standard_subscription_billing_interval === null
      || typeof plan.standard_subscription_billing_interval === "number");
}

function formatAmount(value: number) {
  return `৳ ${value.toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function formatBillingPeriod(period: PublicPlan["billing_period"], interval: number) {
  if (period === "one-time") return "one-time";
  const unit = period === "minutes"
    ? "minute"
    : period === "days"
      ? "day"
      : period === "year"
        ? "year"
        : "month";
  return `${interval} ${unit}${interval === 1 ? "" : "s"}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Could not load pricing information.";
}

export default function PricingPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPlans() {
      try {
        const { data, error: loadError } = await supabase.rpc("get_public_pharmacy_pricing");
        if (loadError) throw loadError;
        if (!Array.isArray(data)) throw new Error("Pricing information returned an invalid response.");

        const loadedPlans = data.filter(isPublicPlan);
        const starterPlan = loadedPlans.find((plan) => plan.name === "Starter Access");
        const setupPlan = loadedPlans.find((plan) => plan.name === "One-Time Setup");
        if (!starterPlan || !setupPlan) {
          throw new Error("Starter Access and One-Time Setup pricing are not configured yet.");
        }
        if (
          setupPlan.standard_subscription_fee === null
          || setupPlan.standard_subscription_billing_period === null
          || setupPlan.standard_subscription_billing_interval === null
        ) {
          throw new Error("Standard Subscription pricing is required to show the One-Time Setup monthly fee.");
        }

        if (active) setPlans([starterPlan, setupPlan]);
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadPlans();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#eef3ef",
        color: "#0d2c2a",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <Navbar />
      <section style={{ maxWidth: 920, margin: "0 auto", padding: "54px 24px 64px" }}>
        <header style={{ maxWidth: 680, margin: "0 auto 30px", textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              marginBottom: 16,
              padding: "6px 12px",
              border: "1px solid rgba(42,212,154,0.35)",
              borderRadius: 999,
              background: "rgba(42,212,154,0.12)",
              color: "#1d7059",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            SIMPLE PHARMACY PRICING
          </span>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.12, letterSpacing: "-0.055em", fontWeight: 850 }}>
            Choose how to get started
          </h1>
          <p style={{ margin: "14px 0 0", color: "rgba(13,44,42,0.76)", fontSize: 15, lineHeight: 1.55 }}>
            Start with access for your pharmacy, or choose a one-time setup and continue with subscription billing.
          </p>
        </header>

        {isLoading ? (
          <p role="status" style={{ padding: 24, color: "#526158", textAlign: "center" }}>Loading available plans...</p>
        ) : error ? (
          <p role="alert" style={{ maxWidth: 680, margin: "0 auto", padding: 18, border: "1px solid #f0c9c4", borderRadius: 12, background: "#fff8f7", color: "#9f4037", textAlign: "center", lineHeight: 1.5 }}>
            {error}
          </p>
        ) : (
          <div style={{ display: "grid", maxWidth: 640, margin: "0 auto", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14, alignItems: "stretch" }}>
            {plans.map((plan) => {
              const isStarterPlan = plan.name === "Starter Access";
              const totalPrice = plan.setup_fee + plan.recurring_fee;
              return (
                <article
                  key={plan.id}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: 18,
                    border: isStarterPlan ? "2px solid #2abf89" : "1px solid rgba(13,44,42,0.12)",
                    borderRadius: 20,
                    background: "rgba(255,255,255,0.9)",
                    boxShadow: "0 18px 45px rgba(13,44,42,0.08)",
                  }}
                >
                  <div aria-hidden="true" style={{ position: "absolute", inset: "0 0 auto", height: 5, background: "linear-gradient(90deg, #16845d, #54c990)" }} />
                  <span style={{ alignSelf: "flex-start", marginBottom: 10, padding: "4px 8px", borderRadius: 999, background: "#e5f6ec", color: "#167254", fontSize: 9, fontWeight: 800, letterSpacing: 0.6 }}>
                    {isStarterPlan ? "GET STARTED" : "ONE-TIME SETUP"}
                  </span>
                  <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.04em" }}>{plan.name}</h2>
                  <p style={{ minHeight: 42, margin: "8px 0 14px", color: "rgba(13,44,42,0.7)", fontSize: 12, lineHeight: 1.5 }}>
                    {plan.description || (isStarterPlan
                      ? "A simple way to start using Pharmacy Cluster for your store."
                      : "Get your pharmacy configured, then continue with a subscription plan.")}
                  </p>

                  <div style={{ padding: "12px 0", borderTop: "1px solid #e8eee9", borderBottom: "1px solid #e8eee9" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 26, letterSpacing: "-0.05em" }}>
                        {formatAmount(isStarterPlan ? totalPrice : plan.setup_fee)}
                      </strong>
                      <span style={{ color: "#65766b", fontSize: 13 }}>
                        {isStarterPlan ? `/ ${formatBillingPeriod(plan.billing_period, plan.billing_interval)}` : "one-time setup fee"}
                      </span>
                    </div>
                    {isStarterPlan ? (
                      <div style={{ display: "grid", gap: 6, marginTop: 9, color: "#526158", fontSize: 11 }}>
                        <span>{plan.setup_fee_label}: <strong>{formatAmount(plan.setup_fee)}</strong></span>
                        <span>Access fee: <strong>{formatAmount(plan.recurring_fee)} / {formatBillingPeriod(plan.billing_period, plan.billing_interval)}</strong></span>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 6, marginTop: 9, color: "#526158", fontSize: 11 }}>
                        <span>{plan.setup_fee_label}: <strong>{formatAmount(plan.setup_fee)}</strong></span>
                        <span>
                          {plan.standard_subscription_billing_period === "month"
                            && plan.standard_subscription_billing_interval === 1
                            ? "Monthly subscription:"
                            : "Subscription fee:"}{" "}
                          <strong>
                            {formatAmount(plan.standard_subscription_fee ?? 0)} / {formatBillingPeriod(
                              plan.standard_subscription_billing_period ?? "month",
                              plan.standard_subscription_billing_interval ?? 1,
                            )}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <ul style={{ display: "grid", gap: 7, margin: "14px 0 16px", padding: 0, listStyle: "none", color: "#344b40", fontSize: 11 }}>
                    {(isStarterPlan
                      ? ["Pharmacy dashboard access", "Manage products, stock, and sales", "Upgrade your plan when you are ready"]
                      : ["One-time pharmacy setup", "Review billing details before payment", "Continue with subscription billing after setup"]
                    ).map((detail) => (
                      <li key={detail} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                        <span aria-hidden="true" style={{ color: "#16845d", fontWeight: 800 }}>✓</span>
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/register"
                    style={{
                      display: "block",
                      marginTop: "auto",
                      padding: "10px 14px",
                      borderRadius: 11,
                      background: isStarterPlan ? "#2ad49a" : "#0d2c2a",
                      color: isStarterPlan ? "#082a28" : "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    Get Started <span style={{ marginLeft: 8 }}>→</span>
                  </Link>
                </article>
              );
            })}
          </div>
        )}

        <p style={{ maxWidth: 680, margin: "22px auto 0", color: "#65766b", fontSize: 11, lineHeight: 1.5, textAlign: "center" }}>
          Plan prices and descriptions are maintained by the Pharmacy Cluster team and may be updated. The final amount and billing term are confirmed before payment.
        </p>
      </section>
    </main>
  );
}
