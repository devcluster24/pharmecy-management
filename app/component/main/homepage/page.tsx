import Navbar from "./Navbar";

export default function HomepagePage() {
  return (
    <>
      <main
        style={{
          minHeight: "100vh",
          background: "#eef3ef",
          color: "#0d2c2a",
          fontFamily: "Inter, Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(13,44,42,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(13,44,42,0.06) 1px, transparent 1px)",
            backgroundSize: "120px 120px",
          }}
        />

        <Navbar />

        <section
          style={{
            position: "relative",
            zIndex: 1,
            maxWidth: 1260,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "72px 24px 90px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(42,212,154,0.12)",
              color: "#1d7059",
              border: "1px solid rgba(42,212,154,0.35)",
              borderRadius: 999,
              padding: "6px 12px",
              marginBottom: 30,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 16 }}>⚡</span>
            <span>#1 Pharmacy POS system</span>
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "44px",
              lineHeight: 1,
              letterSpacing: "-0.06em",
              fontWeight: 900,
              color: "#0d2c2a",
            }}
          >
            Run Your Pharmacy
          </h1>

          <h2
            style={{
              margin: "10px 0 0",
              fontSize: "36px",
              lineHeight: 1,
              letterSpacing: "-0.06em",
              fontWeight: 900,
              color: "#2ad49a",
            }}
          >
            Smarter
          </h2>

          <p
            style={{
              maxWidth: 760,
              marginTop: 20,
              marginBottom: 0,
              fontSize: "18px",
              lineHeight: 1.5,
              color: "rgba(13,44,42,0.8)",
              fontWeight: 400,
            }}
          >
            The all-in-one pharmacy management system built for Bangladesh. POS,
            inventory, expiry tracking, profit analytics — everything to grow your
            business.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              marginTop: 42,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <a
              href="/register"
              style={{
                border: "none",
                background: "#2ad49a",
                color: "#082a28",
                padding: "12px 24px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 12px 22px rgba(42,212,154,0.25)",
                display: "inline-block",
                textDecoration: "none",
              }}
            >
              Start Free Setup <span style={{ marginLeft: 12 }}>→</span>
            </a>

            <button
              style={{
                border: "1px solid rgba(13,44,42,0.12)",
                background: "rgba(255,255,255,0.45)",
                color: "#0d2c2a",
                padding: "12px 24px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              See Features
            </button>
          </div>

          <div
            style={{
              marginTop: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 38,
              flexWrap: "wrap",
              color: "rgba(13,44,42,0.78)",
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            {[
              "Lowest setup fees",
              "From ৳1,000/mo",
              "Works on any device",
            ].map((item) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ color: "#2ad49a", fontSize: 18 }}>✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <div
          style={{
            position: "fixed",
            right: 26,
            bottom: 26,
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "#2ad49a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 32,
            fontWeight: 700,
            boxShadow: "0 10px 25px rgba(42,212,154,0.35)",
            zIndex: 10,
          }}
        >
          💬
        </div>
      </main>
    </>
  );
}
