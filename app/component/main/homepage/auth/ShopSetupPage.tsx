export default function ShopSetupPage() {
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
            1 of 2
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
              Add your store
            </h1>
            <p
              style={{
                margin: "10px 0 26px",
                color: "#59706d",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              Tell us about your pharmacy and start managing inventory, sales, and customers in one place.
            </p>

            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#1f2a2a" }}>Store Name</label>
                <input
                  type="text"
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

              <a
                href="/dashboard"
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
                }}
              >
                Launch My store
              </a>
            </div>
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
