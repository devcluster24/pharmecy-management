import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  return (
    <header
      style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        borderBottom: "1px solid rgba(13,44,42,0.08)",
        background: "rgba(238,243,239,0.96)",
      }}
    >
      <div
        style={{
          maxWidth: 1260,
          margin: "0 auto",
          height: 88,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 30px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/pharmacy-icon.png" alt="" width={36} height={36} aria-hidden="true" />
          <div
            style={{
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: "-0.08em",
              color: "#0d2c2a",
              lineHeight: 1,
            }}
          >
            Pharmacy<span style={{ color: "#1ec688" }}> Cluster</span>
          </div>
        </div>

        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            color: "#0d2c2a",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <Link
            href="/features"
            style={{
              color: "#0d2c2a",
              textDecoration: "none",
              opacity: 0.9,
            }}
          >
            Features
          </Link>
          <Link
            href="/pricing"
            style={{
              color: "#0d2c2a",
              textDecoration: "none",
              opacity: 0.9,
            }}
          >
            Pricing
          </Link>
          <Link
            href="/faq"
            style={{
              color: "#0d2c2a",
              textDecoration: "none",
              opacity: 0.9,
            }}
          >
            FAQ
          </Link>
          <Link
            href="/contact"
            style={{
              color: "#0d2c2a",
              textDecoration: "none",
              opacity: 0.9,
            }}
          >
            Contact
          </Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              border: "1px solid rgba(13,44,42,0.1)",
              background: "transparent",
              color: "#0d2c2a",
              padding: "6px 16px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            Login
          </Link>
          <Link
            href="/register"
            style={{
              display: "inline-block",
              border: "none",
              background: "#2ad49a",
              color: "#082a28",
              padding: "6px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 20px rgba(42,212,154,0.25)",
              textDecoration: "none",
            }}
          >
            Get Started <span style={{ marginLeft: 10 }}>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
