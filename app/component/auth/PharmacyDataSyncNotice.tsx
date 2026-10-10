"use client";

import { useState, useSyncExternalStore } from "react";
import {
  getPharmacyDataSyncStatus,
  retryPharmacyDataSync,
  subscribeToPharmacyDataSync,
} from "@/lib/pharmacy-data-sync";

const emptyStatus = { state: "idle" as const, message: "", lastSyncedAt: null };

export default function PharmacyDataSyncNotice() {
  const status = useSyncExternalStore(
    subscribeToPharmacyDataSync,
    getPharmacyDataSyncStatus,
    () => emptyStatus,
  );
  const [retrying, setRetrying] = useState(false);

  if (status.state === "idle" || status.state === "synced") return null;

  async function retry() {
    setRetrying(true);
    try {
      await retryPharmacyDataSync();
    } finally {
      setRetrying(false);
    }
  }

  const isError = status.state === "error";
  return (
    <aside
      role={isError ? "alert" : "status"}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "min(480px, calc(100vw - 32px))",
        padding: "10px 13px",
        border: `1px solid ${isError ? "#efc4bf" : "#cbe8d9"}`,
        borderRadius: 8,
        background: isError ? "#fff5f4" : "#f2fbf6",
        color: isError ? "#9e3e35" : "#286b4d",
        boxShadow: "0 4px 18px rgba(20, 40, 28, 0.12)",
        fontSize: 11,
      }}
    >
      <span>{isError ? `Supabase sync failed: ${status.message}` : status.message}</span>
      {isError && (
        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry().catch(() => undefined)}
          style={{ flex: "0 0 auto", border: 0, borderRadius: 5, background: "#9e3e35", color: "#fff", padding: "6px 9px", fontSize: 10, fontWeight: 650, cursor: retrying ? "wait" : "pointer" }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </aside>
  );
}
