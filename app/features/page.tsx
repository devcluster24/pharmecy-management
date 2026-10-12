import Link from "next/link";
import Navbar from "../component/main/homepage/Navbar";

const features = [
  {
    icon: "▣",
    title: "Product & inventory management",
    description: "Organize your medicine catalog, monitor stock levels, and keep product information in one place.",
  },
  {
    icon: "৳",
    title: "Fast pharmacy sales",
    description: "Record sales, manage customer transactions, and keep daily activity connected to your store overview.",
  },
  {
    icon: "▧",
    title: "Invoices and receipts",
    description: "Create invoices for sales and configure invoice layouts to match your pharmacy’s needs.",
  },
  {
    icon: "↙",
    title: "Purchases and suppliers",
    description: "Track purchases, manage supplier information, and keep supplier balances and payments organized.",
  },
  {
    icon: "↶",
    title: "Returns and expenses",
    description: "Record product returns and business expenses so your store records stay up to date.",
  },
  {
    icon: "▥",
    title: "Reports and store insights",
    description: "Review sales, inventory, and expense information from the dashboard to understand your business.",
  },
  {
    icon: "♧",
    title: "Staff and access controls",
    description: "Invite pharmacy staff and manage which dashboard pages and actions each approved team member can use.",
  },
  {
    icon: "⚙",
    title: "Configurable pharmacy settings",
    description: "Set up payment methods, taxes, return deductions, invoice templates, and other store preferences.",
  },
];

export default function FeaturesPage() {
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
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "72px 24px 88px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto 44px", textAlign: "center" }}>
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
            PHARMACY MANAGEMENT FEATURES
          </span>
          <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.12, letterSpacing: "-0.055em", fontWeight: 850 }}>
            Everything your pharmacy needs to run smoothly
          </h1>
          <p style={{ margin: "18px 0 0", color: "rgba(13,44,42,0.78)", fontSize: 17, lineHeight: 1.6 }}>
            Manage everyday pharmacy operations from one connected workspace, from products and sales to staff and reports.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 245px), 1fr))",
            gap: 16,
          }}
        >
          {features.map((feature) => (
            <article
              key={feature.title}
              style={{
                minHeight: 175,
                padding: 22,
                border: "1px solid rgba(13,44,42,0.09)",
                borderRadius: 16,
                background: "rgba(255,255,255,0.82)",
                boxShadow: "0 10px 28px rgba(13,44,42,0.04)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "grid",
                  width: 38,
                  height: 38,
                  marginBottom: 18,
                  placeItems: "center",
                  borderRadius: 11,
                  background: "rgba(42,212,154,0.15)",
                  color: "#167254",
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {feature.icon}
              </span>
              <h2 style={{ margin: "0 0 9px", fontSize: 17, lineHeight: 1.3, letterSpacing: "-0.02em" }}>
                {feature.title}
              </h2>
              <p style={{ margin: 0, color: "rgba(13,44,42,0.72)", fontSize: 14, lineHeight: 1.6 }}>
                {feature.description}
              </p>
            </article>
          ))}
        </div>

        <div style={{ marginTop: 42, textAlign: "center" }}>
          <Link
            href="/register"
            style={{
              display: "inline-block",
              borderRadius: 12,
              background: "#2ad49a",
              padding: "12px 24px",
              color: "#082a28",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 12px 22px rgba(42,212,154,0.22)",
            }}
          >
            Get Started <span style={{ marginLeft: 10 }}>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
