import Link from "next/link";
import Navbar from "../component/main/homepage/Navbar";

const contactMethods = [
  {
    label: "Email",
    value: "devcluster24@gmail.com",
    href: "mailto:devcluster24@gmail.com",
    icon: "✉",
    description: "Send us a message about your account, setup, or plan.",
  },
  {
    label: "Phone",
    value: "+8801753105250",
    href: "tel:+8801753105250",
    icon: "☎",
    description: "Call the Pharmacy Cluster team for assistance.",
  },
  {
    label: "Website",
    value: "www.dev-cluster.com",
    href: "https://www.dev-cluster.com/",
    icon: "↗",
    description: "Visit Dev Cluster to learn more about our team.",
  },
];

export default function ContactPage() {
  return (
    <main
      className="public-page"
      style={{
        minHeight: "100vh",
        background: "#eef3ef",
        color: "#0d2c2a",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <Navbar />
      <section style={{ maxWidth: 1000, margin: "0 auto", padding: "70px 24px 84px" }}>
        <header style={{ maxWidth: 700, margin: "0 auto 42px", textAlign: "center" }}>
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
            WE’RE HERE TO HELP
          </span>
          <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.12, letterSpacing: "-0.055em", fontWeight: 850 }}>
            Contact Pharmacy Cluster
          </h1>
          <p style={{ margin: "17px 0 0", color: "rgba(13,44,42,0.76)", fontSize: 16, lineHeight: 1.6 }}>
            Reach out to the Dev Cluster team for help with Pharmacy Cluster accounts, setup, or plans.
          </p>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: 16 }}>
          {contactMethods.map((method) => (
            <article
              key={method.label}
              style={{
                padding: 24,
                border: "1px solid rgba(13,44,42,0.09)",
                borderRadius: 16,
                background: "rgba(255,255,255,0.88)",
                boxShadow: "0 10px 28px rgba(13,44,42,0.045)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "grid",
                  width: 42,
                  height: 42,
                  marginBottom: 18,
                  placeItems: "center",
                  borderRadius: 12,
                  background: "rgba(42,212,154,0.15)",
                  color: "#167254",
                  fontSize: 21,
                  fontWeight: 700,
                }}
              >
                {method.icon}
              </span>
              <h2 style={{ margin: "0 0 8px", fontSize: 17, letterSpacing: "-0.02em" }}>{method.label}</h2>
              <p style={{ minHeight: 42, margin: "0 0 14px", color: "#62736a", fontSize: 13, lineHeight: 1.55 }}>
                {method.description}
              </p>
              <a
                href={method.href}
                target={method.label === "Website" ? "_blank" : undefined}
                rel={method.label === "Website" ? "noreferrer" : undefined}
                style={{ color: "#17684e", fontSize: 14, fontWeight: 700, textDecoration: "none", overflowWrap: "anywhere" }}
              >
                {method.value}
              </a>
            </article>
          ))}
        </div>

        <div style={{ marginTop: 34, textAlign: "center" }}>
          <p style={{ margin: "0 0 14px", color: "#526b60", fontSize: 13 }}>
            Looking for quick answers? Visit our FAQ page.
          </p>
          <Link href="/faq" style={{ color: "#17684e", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            Browse Frequently Asked Questions →
          </Link>
        </div>
      </section>
    </main>
  );
}
