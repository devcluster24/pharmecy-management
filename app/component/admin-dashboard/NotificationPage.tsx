"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MdNotificationsActive } from "react-icons/md";
import { supabase } from "@/lib/supabase/client";
import AdminDashboardShell from "./AdminDashboardShell";

type RuleKey =
  | "inventory_expiring_soon"
  | "inventory_expired"
  | "inventory_low_stock"
  | "inventory_out_of_stock"
  | "catalog_new_products"
  | "backup_completed"
  | "subscription_expiring";

type NotificationRule = {
  enabled: boolean;
  days_before?: number;
};

type NotificationRules = Record<RuleKey, NotificationRule>;

type Announcement = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

const defaultRules: NotificationRules = {
  inventory_expiring_soon: { enabled: true, days_before: 30 },
  inventory_expired: { enabled: true },
  inventory_low_stock: { enabled: true },
  inventory_out_of_stock: { enabled: true },
  catalog_new_products: { enabled: true },
  backup_completed: { enabled: true },
  subscription_expiring: { enabled: true, days_before: 7 },
};

const ruleFields: { key: RuleKey; label: string; description: string; hasDays?: boolean }[] = [
  {
    key: "inventory_expiring_soon",
    label: "Inventory expiring soon",
    description: "Notify when an inventory batch is approaching its expiry date.",
    hasDays: true,
  },
  {
    key: "inventory_expired",
    label: "Expired inventory",
    description: "Notify when a batch in inventory has expired.",
  },
  {
    key: "inventory_low_stock",
    label: "Low stock",
    description: "Use each pharmacy’s configured low-stock threshold.",
  },
  {
    key: "inventory_out_of_stock",
    label: "Out of stock",
    description: "Notify when an inventory batch reaches zero stock.",
  },
  {
    key: "catalog_new_products",
    label: "New company products",
    description: "Notify when new products are added to Import Company Products.",
  },
  {
    key: "backup_completed",
    label: "Backup completed",
    description: "Notify the pharmacy account when a Google Drive backup succeeds.",
  },
  {
    key: "subscription_expiring",
    label: "Subscription expiring",
    description: "Send a reminder before an active subscription expires.",
    hasDays: true,
  },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  border: "1px solid #d5dfd8",
  borderRadius: 9,
  padding: "9px 11px",
  color: "#24332b",
  background: "#fff",
  font: "inherit",
  boxSizing: "border-box",
};

function parseRules(value: unknown): NotificationRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultRules;

  const parsed = { ...defaultRules };
  for (const { key, hasDays } of ruleFields) {
    const raw = (value as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const config = raw as Record<string, unknown>;
    const enabled = typeof config.enabled === "boolean" ? config.enabled : parsed[key].enabled;
    if (hasDays) {
      const days = Number(config.days_before);
      parsed[key] = {
        enabled,
        days_before: Number.isInteger(days) && days >= 0 ? Math.min(days, 3650) : parsed[key].days_before,
      };
    } else {
      parsed[key] = { enabled };
    }
  }
  return parsed;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export default function NotificationPage() {
  const [rules, setRules] = useState<NotificationRules>(defaultRules);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPageData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [settingsResult, announcementsResult] = await Promise.all([
        supabase.from("pharmacy_notification_settings").select("rules").eq("id", 1).maybeSingle(),
        supabase
          .from("pharmacy_notification_announcements")
          .select("id, title, body, created_at")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (announcementsResult.error) throw announcementsResult.error;
      setRules(settingsResult.data ? parseRules(settingsResult.data.rules) : defaultRules);
      setAnnouncements(announcementsResult.data ?? []);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load notification settings."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadPageData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadPageData]);

  function updateRule(key: RuleKey, update: Partial<NotificationRule>) {
    setRules((current) => ({ ...current, [key]: { ...current[key], ...update } }));
  }

  async function saveRules() {
    setIsSavingRules(true);
    setError("");
    setMessage("");
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error("Sign in with an administrator account to save settings.");

      const { error: saveError } = await supabase
        .from("pharmacy_notification_settings")
        .upsert(
          { id: 1, rules, updated_at: new Date().toISOString(), updated_by: userResult.user.id },
          { onConflict: "id" },
        );
      if (saveError) throw saveError;
      setMessage("Notification settings saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save notification settings."));
    } finally {
      setIsSavingRules(false);
    }
  }

  async function sendAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      setError("Enter both a notification title and message.");
      return;
    }

    setIsSending(true);
    setError("");
    setMessage("");
    try {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) throw new Error("Sign in with an administrator account to send a notification.");

      const { error: sendError } = await supabase
        .from("pharmacy_notification_announcements")
        .insert({ title: trimmedTitle, body: trimmedBody, created_by: userResult.user.id });
      if (sendError) throw sendError;
      setTitle("");
      setBody("");
      setMessage("Notification sent to all approved pharmacy accounts.");
      await loadPageData();
    } catch (sendError) {
      setError(getErrorMessage(sendError, "Could not send the notification."));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AdminDashboardShell>
    <main style={{ minHeight: "100%", padding: "28px clamp(16px, 4vw, 42px) 48px", background: "#f5f8f5", color: "#24332b" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 13, background: "#e1f3eb", color: "#17664f" }}>
          <MdNotificationsActive size={23} />
        </span>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 750 }}>Notification</h1>
          <p style={{ margin: "5px 0 0", color: "#718078", fontSize: 13 }}>Choose which events notify pharmacy owners and staff.</p>
        </div>
      </header>

      {message ? <p role="status" style={{ margin: "0 0 14px", padding: 12, borderRadius: 9, background: "#e6f5eb", color: "#17664f" }}>{message}</p> : null}
      {error ? <p role="alert" style={{ margin: "0 0 14px", padding: 12, borderRadius: 9, background: "#fff0ed", color: "#a83b31" }}>{error}</p> : null}

      <section style={{ maxWidth: 920, padding: 20, border: "1px solid #e0e8e2", borderRadius: 14, background: "#fff", boxShadow: "0 5px 20px rgba(27, 55, 39, 0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 750 }}>Automatic notifications</h2>
            <p style={{ margin: "5px 0 0", color: "#718078", fontSize: 12 }}>Changes apply globally to all pharmacy accounts.</p>
          </div>
          <button type="button" disabled={isLoading || isSavingRules} onClick={() => void saveRules()} style={{ border: 0, borderRadius: 9, padding: "10px 15px", background: "#16845d", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: isLoading || isSavingRules ? 0.6 : 1 }}>
            {isSavingRules ? "Saving…" : "Save settings"}
          </button>
        </div>

        {isLoading ? <p style={{ color: "#718078", fontSize: 13 }}>Loading settings…</p> : (
          <div>
            {ruleFields.map(({ key, label, description, hasDays }) => (
              <div key={key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "center", padding: "15px 0", borderTop: "1px solid #edf1ed" }}>
                <div>
                  <label htmlFor={`notification-rule-${key}`} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700 }}>
                    <input
                      id={`notification-rule-${key}`}
                      type="checkbox"
                      checked={rules[key].enabled}
                      onChange={(event) => updateRule(key, { enabled: event.target.checked })}
                      style={{ width: 17, height: 17, accentColor: "#16845d" }}
                    />
                    {label}
                  </label>
                  <p style={{ margin: "5px 0 0 26px", color: "#718078", fontSize: 12 }}>{description}</p>
                </div>
                {hasDays ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 7, color: "#526158", fontSize: 12 }}>
                    {key === "subscription_expiring" ? "Days before" : "Days before expiry"}
                    <input
                      aria-label={`${label} days before`}
                      type="number"
                      min={key === "subscription_expiring" ? 1 : 0}
                      max={3650}
                      value={rules[key].days_before ?? 0}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        const minimum = key === "subscription_expiring" ? 1 : 0;
                        if (Number.isInteger(value) && value >= minimum && value <= 3650) updateRule(key, { days_before: value });
                      }}
                      style={{ ...inputStyle, width: 82, minHeight: 34, padding: "6px 8px" }}
                    />
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ maxWidth: 920, marginTop: 16, padding: 20, border: "1px solid #e0e8e2", borderRadius: 14, background: "#fff", boxShadow: "0 5px 20px rgba(27, 55, 39, 0.04)" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 750 }}>Send a notification</h2>
        <p style={{ margin: "5px 0 16px", color: "#718078", fontSize: 12 }}>Send a custom message immediately to all approved pharmacy owners and staff.</p>
        <form onSubmit={sendAnnouncement} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 650 }}>
            Title
            <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} placeholder="Notification title" />
          </label>
          <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 12, fontWeight: 650 }}>
            Message
            <textarea maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} style={{ ...inputStyle, minHeight: 96, resize: "vertical" }} placeholder="Write your message" />
          </label>
          <button type="submit" disabled={isSending} style={{ justifySelf: "start", border: 0, borderRadius: 9, padding: "10px 15px", background: "#17664f", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: isSending ? 0.6 : 1 }}>
            {isSending ? "Sending…" : "Send to all users"}
          </button>
        </form>

        {announcements.length ? (
          <div style={{ marginTop: 22 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700 }}>Recent notifications</h3>
            {announcements.map((announcement) => (
              <article key={announcement.id} style={{ padding: "11px 0", borderTop: "1px solid #edf1ed" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <strong style={{ fontSize: 13 }}>{announcement.title}</strong>
                  <time style={{ flexShrink: 0, color: "#849188", fontSize: 11 }}>{new Date(announcement.created_at).toLocaleString()}</time>
                </div>
                <p style={{ margin: "5px 0 0", color: "#66746c", fontSize: 12, whiteSpace: "pre-wrap" }}>{announcement.body}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
    </AdminDashboardShell>
  );
}
