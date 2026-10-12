import Link from "next/link";
import Navbar from "../component/main/homepage/Navbar";

const questions = [
  {
    question: "What is Pharmacy Cluster?",
    answer: "Pharmacy Cluster is a pharmacy management system for organizing everyday store work, including products, inventory, sales, purchases, invoices, suppliers, returns, expenses, and reports.",
  },
  {
    question: "How do I create a pharmacy account?",
    answer: "Choose Get Started or Sign Up, register with your email or continue with Google, then follow the steps to set up your pharmacy. You can sign in later from the Login page.",
  },
  {
    question: "Which plans are available?",
    answer: "Starter Access and One-Time Setup are the starting plan options. Plan fees and billing terms are shown on the Pricing page and are managed by the Pharmacy Cluster team.",
  },
  {
    question: "What does One-Time Setup cost include?",
    answer: "The Pricing page shows the current one-time setup fee and the recurring subscription fee used after setup. Review the final billing details during plan setup before proceeding to payment.",
  },
  {
    question: "Can I change my plan later?",
    answer: "Available plan changes depend on your current plan. Open Settings → Subscription & Billing to view your current plan and available next steps.",
  },
  {
    question: "What happens when my subscription expires?",
    answer: "The plan status and expiry are shown in Subscription & Billing. Some dashboard actions are restricted when the subscription expires; renew or choose an available plan to restore access.",
  },
  {
    question: "Can I add pharmacy staff?",
    answer: "Yes. A pharmacy owner can invite staff. Staff access requires owner approval, and the owner controls which dashboard pages and actions are available.",
  },
  {
    question: "I forgot my password. How can I reset it?",
    answer: "On the Login page, enter your account email and choose Forgot password? Follow the reset link sent to your email to set a new password.",
  },
  {
    question: "Where can I get help with my account or plan?",
    answer: "For account, setup, or plan questions, contact your Pharmacy Cluster administrator using the support channel provided to your pharmacy.",
  },
];

export default function FAQPage() {
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
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "64px 24px 80px" }}>
        <header style={{ maxWidth: 700, margin: "0 auto 34px", textAlign: "center" }}>
          <span
            style={{
              display: "inline-block",
              marginBottom: 15,
              padding: "6px 12px",
              border: "1px solid rgba(42,212,154,0.35)",
              borderRadius: 999,
              background: "rgba(42,212,154,0.12)",
              color: "#1d7059",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            HELP & SUPPORT
          </span>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.12, letterSpacing: "-0.055em", fontWeight: 850 }}>
            Frequently asked questions
          </h1>
          <p style={{ margin: "16px 0 0", color: "rgba(13,44,42,0.76)", fontSize: 16, lineHeight: 1.6 }}>
            Quick answers about getting started, plans, pharmacy access, and your account.
          </p>
        </header>

        <div style={{ display: "grid", gap: 10 }}>
          {questions.map((item, index) => (
            <details
              key={item.question}
              open={index === 0}
              style={{
                overflow: "hidden",
                border: "1px solid rgba(13,44,42,0.1)",
                borderRadius: 13,
                background: "rgba(255,255,255,0.88)",
                boxShadow: "0 6px 20px rgba(13,44,42,0.035)",
              }}
            >
              <summary
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "17px 20px",
                  color: "#153a30",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  listStylePosition: "inside",
                }}
              >
                {item.question}
              </summary>
              <p style={{ margin: 0, padding: "0 20px 18px 42px", color: "rgba(13,44,42,0.76)", fontSize: 14, lineHeight: 1.65 }}>
                {item.answer}
              </p>
            </details>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: 22, border: "1px solid rgba(42,212,154,0.3)", borderRadius: 15, background: "rgba(255,255,255,0.72)", textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Ready to get started?</h2>
          <p style={{ margin: "8px 0 17px", color: "#526b60", fontSize: 13 }}>Explore the plans or create your pharmacy account.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <Link href="/pricing" style={{ padding: "9px 15px", border: "1px solid #cddbd1", borderRadius: 9, color: "#17684e", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              View Pricing
            </Link>
            <Link href="/register" style={{ padding: "9px 15px", borderRadius: 9, background: "#2ad49a", color: "#082a28", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              Create Account
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
