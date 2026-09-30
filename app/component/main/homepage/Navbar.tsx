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
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #1dcf8d, #19b479)",
              position: "relative",
              boxShadow: "0 6px 12px rgba(26,168,119,0.25)",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              +
            </span>
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: "-0.08em",
              color: "#0d2c2a",
              lineHeight: 1,
            }}
          >
            Pharmecy<span style={{ color: "#1ec688" }}> Cluster</span>
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
          {[
            "Features",
            "Pricing",
            "Reviews",
            "FAQ",
            "Contact",
            "Blog",
          ].map((item) => (
            <a
              key={item}
              href="#"
              style={{
                color: "#0d2c2a",
                textDecoration: "none",
                opacity: 0.9,
              }}
            >
              {item}
            </a>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <button
            style={{
              border: "1px solid rgba(13,44,42,0.1)",
              background: "transparent",
              color: "#0d2c2a",
              padding: "6px 16px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign In
          </button>
          <button
            style={{
              border: "none",
              background: "#2ad49a",
              color: "#082a28",
              padding: "6px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 20px rgba(42,212,154,0.25)",
            }}
          >
            Get Started <span style={{ marginLeft: 10 }}>→</span>
          </button>
        </div>
      </div>
    </header>
  );
}
