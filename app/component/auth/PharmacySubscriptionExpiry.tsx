"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const SubscriptionExpiryContext = createContext<string | null>(null);

export function PharmacySubscriptionExpiryProvider({
  children,
  expiresAt,
}: {
  children: ReactNode;
  expiresAt: string | null;
}) {
  return (
    <SubscriptionExpiryContext.Provider value={expiresAt}>
      {children}
    </SubscriptionExpiryContext.Provider>
  );
}

export function usePharmacySubscriptionExpiry() {
  const expiresAt = useContext(SubscriptionExpiryContext);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;
  const remainingMs = expiryTime !== null && Number.isFinite(expiryTime)
    ? Math.max(0, expiryTime - now)
    : null;

  return {
    expiresAt,
    isExpired: remainingMs === 0,
    remainingMs,
    now,
  };
}

export function SubscriptionActionLock({
  children,
  showExpiryNotice = false,
  locked = true,
}: {
  children: ReactNode;
  showExpiryNotice?: boolean;
  locked?: boolean;
}) {
  const { isExpired } = usePharmacySubscriptionExpiry();

  return (
    <>
      {isExpired && showExpiryNotice && (
        <p role="status" style={{ margin: "0 0 16px", padding: "10px 12px", border: "1px solid #f0d3cf", borderRadius: 7, background: "#fff8f7", color: "#ad4b43", fontSize: 12 }}>
          Your subscription has expired. Dashboard actions are disabled until you choose a new plan in Settings → Subscription &amp; Billing.
        </p>
      )}
      <fieldset disabled={isExpired && locked} style={{ display: "contents" }}>
        {children}
      </fieldset>
    </>
  );
}
