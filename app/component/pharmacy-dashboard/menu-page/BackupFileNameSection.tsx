"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type BackupHistory = {
  id: string;
  created_at: string;
  details: string[];
  status: "Success" | "Partial" | "Failed";
  message: string;
};

type BackupSettings = {
  connected: boolean;
  autoBackupEnabled: boolean;
  intervalDays: number;
  productManagementBackedUp: boolean;
  history: BackupHistory[];
};

const initialSettings: BackupSettings = {
  connected: false,
  autoBackupEnabled: false,
  intervalDays: 1,
  productManagementBackedUp: false,
  history: [],
};

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Sign in again to manage Google Drive backups.");
  return data.session.access_token;
}

async function getError(response: Response) {
  const payload: unknown = await response.json();
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return "Backup request failed.";
}

export default function BackupFileNameSection() {
  const [settings, setSettings] = useState(initialSettings);
  const [schedule, setSchedule] = useState<"daily" | "weekly" | "monthly" | "custom">("daily");
  const [customDays, setCustomDays] = useState("5");
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isSavingAutoBackup, setIsSavingAutoBackup] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSettings() {
    setError("");
    const token = await getAccessToken();
    const response = await fetch("/api/backup/settings", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await getError(response));
    const loaded = await response.json() as BackupSettings;
    setSettings(loaded);
    setSchedule(loaded.intervalDays === 1
      ? "daily"
      : loaded.intervalDays === 7
        ? "weekly"
        : loaded.intervalDays === 30
          ? "monthly"
          : "custom");
    if (![1, 7, 30].includes(loaded.intervalDays)) setCustomDays(String(loaded.intervalDays));
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const oauthStatus = query.get("backup_oauth");
    const oauthMessage = oauthStatus === "connected"
      ? "Google Drive connected successfully."
      : oauthStatus === "error"
        ? query.get("backup_message") || "Google Drive could not be connected."
        : "";
    const timer = window.setTimeout(() => {
        void loadSettings()
          .then(() => {
            if (oauthStatus === "error") setError(oauthMessage);
            else if (oauthMessage) setMessage(oauthMessage);
          })
          .catch((loadError: unknown) => setError(oauthStatus === "error"
            ? oauthMessage
            : loadError instanceof Error ? loadError.message : "Could not load backup settings."))
          .finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function connectGoogleDrive() {
    setIsConnecting(true);
    setError("");
    setMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/backup/google/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(await getError(response));
      const result = await response.json() as { authorizationUrl?: string };
      if (!result.authorizationUrl) throw new Error("Google did not provide an authorization page.");
      window.location.assign(result.authorizationUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not start Google Drive connection.");
      setIsConnecting(false);
    }
  }

  async function saveAutoBackup(enabled: boolean) {
    setIsSavingAutoBackup(true);
    setError("");
    setMessage("");
    const intervalDays = schedule === "daily"
      ? 1
      : schedule === "weekly"
        ? 7
        : schedule === "monthly"
          ? 30
          : Number(customDays);
    try {
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
        throw new Error("Custom interval must be between 1 and 3650 days.");
      }
      const token = await getAccessToken();
      const response = await fetch("/api/backup/settings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ autoBackupEnabled: enabled, intervalDays }),
      });
      if (!response.ok) throw new Error(await getError(response));
      setSettings((current) => ({ ...current, autoBackupEnabled: enabled, intervalDays }));
      setMessage(enabled ? "Auto Backup is enabled." : "Auto Backup is disabled.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Auto Backup settings.");
    } finally {
      setIsSavingAutoBackup(false);
    }
  }

  async function runBackup() {
    setIsBackingUp(true);
    setError("");
    setMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/backup/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Backup failed.";
        throw new Error(message);
      }
      if (!data || typeof data !== "object") throw new Error("Backup service returned an invalid response.");
      const result = data as { status?: string; message?: string };
      if (result.status === "Failed" || result.status === "Skipped") throw new Error(result.message || "Backup failed.");
      setMessage(result.status === "Partial"
        ? "Backup completed with some files missing; see the backup history."
        : "Backup completed and saved to Google Drive.");
      await loadSettings();
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "Could not create the Drive backup.");
    } finally {
      setIsBackingUp(false);
    }
  }

  const scheduleDisabled = !settings.connected || isSavingAutoBackup || isBackingUp;
  const selectedDays = schedule === "daily" ? 1 : schedule === "weekly" ? 7 : schedule === "monthly" ? 30 : Number(customDays);

  return (
    <section aria-labelledby="backup-file-name-title" style={{ width: "100%", maxWidth: 980, color: "#26352f" }}>
      <h2 id="backup-file-name-title" style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>Backup File Name</h2>
      <p style={{ margin: "0 0 18px", color: "#687871", fontSize: 12, fontWeight: 400, lineHeight: 1.6 }}>
        Connect Google Drive to save the dashboard Excel exports in one timestamped backup folder. Later backups reuse that folder.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 16, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fbfcfb" }}>
        <button type="button" onClick={() => void connectGoogleDrive()} disabled={isConnecting || isLoading} style={{ border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 13px", fontSize: 12, fontWeight: 650, cursor: isConnecting || isLoading ? "wait" : "pointer" }}>
          {isConnecting ? "Connecting..." : settings.connected ? "Reconnect Google Drive" : "Login with Google"}
        </button>
        <span role="status" style={{ color: settings.connected ? "#17704e" : "#687871", fontSize: 11 }}>
          {isLoading ? "Loading backup settings..." : settings.connected ? "Google Drive connected" : "Google Drive is not connected"}
        </span>
      </div>

      {settings.connected && (
        <section aria-label="Backup controls" style={{ display: "grid", gap: 12, marginTop: 16, padding: 16, border: "1px solid #e5ebe7", borderRadius: 8, background: "#fff" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 10 }}>
            <button type="button" onClick={() => void runBackup()} disabled={isBackingUp || isLoading} style={{ border: 0, borderRadius: 6, background: "#179c70", color: "#fff", padding: "10px 16px", fontSize: 12, fontWeight: 700, cursor: isBackingUp || isLoading ? "wait" : "pointer", opacity: isBackingUp || isLoading ? 0.65 : 1 }}>
              {isBackingUp ? "Backing up..." : "BackUp"}
            </button>
            <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
              Auto Backup interval
              <select value={schedule} onChange={(event) => {
                if (["daily", "weekly", "monthly", "custom"].includes(event.currentTarget.value)) {
                  setSchedule(event.currentTarget.value as typeof schedule);
                }
              }} style={{ minWidth: 170, border: "1px solid #dce5df", borderRadius: 6, background: "#fff", color: "#26352f", padding: "9px 10px", fontSize: 12 }}>
                <option value="daily">Every day</option>
                <option value="weekly">Every 7 days</option>
                <option value="monthly">Every 30 days</option>
                <option value="custom">Custom days</option>
              </select>
            </label>
            {schedule === "custom" && (
              <label style={{ display: "grid", gap: 6, color: "#526158", fontSize: 11 }}>
                Repeat every (days)
                <input type="number" min={1} max={3650} step={1} value={customDays} onChange={(event) => setCustomDays(event.currentTarget.value)} style={{ width: 130, border: "1px solid #dce5df", borderRadius: 6, padding: "9px 10px", color: "#26352f", fontSize: 12 }} />
              </label>
            )}
            <button type="button" onClick={() => void saveAutoBackup(settings.autoBackupEnabled)} disabled={isSavingAutoBackup || isBackingUp} style={{ border: "1px solid #b9dfd0", borderRadius: 6, background: "#fff", color: "#17704e", padding: "10px 13px", fontSize: 12, fontWeight: 650, cursor: isSavingAutoBackup || isBackingUp ? "wait" : "pointer" }}>
              Save Schedule
            </button>
            <button type="button" role="switch" aria-checked={settings.autoBackupEnabled} disabled={scheduleDisabled} onClick={() => void saveAutoBackup(!settings.autoBackupEnabled)} style={{ minWidth: 116, border: 0, borderRadius: 6, background: settings.autoBackupEnabled ? "#179c70" : "#687871", color: "#fff", padding: "10px 13px", fontSize: 12, fontWeight: 700, cursor: scheduleDisabled ? "wait" : "pointer", opacity: scheduleDisabled ? 0.65 : 1 }}>
              {isSavingAutoBackup ? "Saving..." : settings.autoBackupEnabled ? "Auto Backup: ON" : "Auto Backup: OFF"}
            </button>
          </div>
          <p style={{ margin: 0, color: "#687871", fontSize: 11, lineHeight: 1.55 }}>
            Auto Backup runs on the server even when this dashboard is closed. Daily, weekly, and monthly are scheduled as 1, 7, and 30 days. Custom interval: {selectedDays} day(s).
            {settings.productManagementBackedUp ? " Product Management was already backed up once and will be skipped in future runs." : ""}
          </p>
        </section>
      )}

      {message && <p role="status" style={{ margin: "12px 0 0", color: "#17704e", fontSize: 12 }}>{message}</p>}
      {error && <p role="alert" style={{ margin: "12px 0 0", color: "#ad4b43", fontSize: 12 }}>{error}</p>}

      <section aria-labelledby="backup-history-title" style={{ marginTop: 20, overflow: "hidden", border: "1px solid #e4e9e5", borderRadius: 8, background: "#fff" }}>
        <header style={{ padding: "14px 16px", borderBottom: "1px solid #edf0ed" }}>
          <h3 id="backup-history-title" style={{ margin: 0, fontSize: 14 }}>Backup History</h3>
        </header>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", textAlign: "left" }}>
            <thead><tr>{["Date", "Details", "Status"].map((heading) => <th key={heading} style={{ padding: "11px 13px", background: "#f8faf8", borderBottom: "1px solid #edf0ed", color: "#6c7a73", fontSize: 11, fontWeight: 650 }}>{heading}</th>)}</tr></thead>
            <tbody>
              {settings.history.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(entry.created_at).toLocaleString()}</td>
                  <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: "#42524b", fontSize: 11 }}>{entry.details.join(", ") || entry.message || "No files uploaded"}</td>
                  <td style={{ padding: "11px 13px", borderBottom: "1px solid #f0f2f0", color: entry.status === "Success" ? "#17704e" : entry.status === "Partial" ? "#9b6412" : "#ad4b43", fontSize: 11, fontWeight: 650 }}>{entry.status}{entry.message ? ` · ${entry.message}` : ""}</td>
                </tr>
              ))}
              {!isLoading && settings.history.length === 0 && <tr><td colSpan={3} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>No backups yet.</td></tr>}
              {isLoading && <tr><td colSpan={3} style={{ padding: 24, color: "#87928d", fontSize: 12, textAlign: "center" }}>Loading backup history...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
