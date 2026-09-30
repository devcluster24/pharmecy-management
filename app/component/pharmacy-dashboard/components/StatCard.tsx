type StatCardProps = {
  label: string;
  value: string;
  change: string;
  tone?: "green" | "blue" | "orange";
};

const toneMap = {
  green: { bg: "rgba(34, 197, 94, 0.18)", color: "#86efac" },
  blue: { bg: "rgba(59, 130, 246, 0.18)", color: "#93c5fd" },
  orange: { bg: "rgba(245, 158, 11, 0.18)", color: "#fbbf24" },
};

export default function StatCard({ label, value, change, tone = "green" }: StatCardProps) {
  const palette = toneMap[tone];

  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid rgba(148, 163, 184, 0.12)",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 8px 24px rgba(2, 6, 23, 0.3)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <span style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            background: palette.bg,
            color: palette.color,
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {change}
        </span>
      </div>

      <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>{value}</div>
    </div>
  );
}
