"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatPharmacyStoreName, loadPharmacyDashboardIdentity } from "@/lib/pharmacy-dashboard-identity";

export function usePharmacyStoreName() {
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    let active = true;

    async function loadStoreName(refresh = false) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) {
          if (active) setStoreName("");
          return;
        }

        const identity = await loadPharmacyDashboardIdentity(user.id, refresh);
        if (active) setStoreName(formatPharmacyStoreName(identity?.storeName ?? ""));
      } catch (loadError) {
        console.error("Could not load the pharmacy store name for the dashboard navbar.", loadError);
      }
    }

    const refreshStoreName = () => void loadStoreName(true);
    void loadStoreName();
    window.addEventListener("pharmacy-profile-updated", refreshStoreName);
    return () => {
      active = false;
      window.removeEventListener("pharmacy-profile-updated", refreshStoreName);
    };
  }, []);

  return storeName;
}

export function PharmacyDashboardStoreName({ fallback = "Pharmacy Cluster" }: { fallback?: string }) {
  const storeName = usePharmacyStoreName();

  return <span>{storeName || fallback}</span>;
}

export default function PharmacyDashboardBrand() {
  const storeName = usePharmacyStoreName();

  return (
    <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, color: "#202624", textDecoration: "none", minWidth: 0 }}>
      <Image src="/pharmacy-icon.png" alt="" width={28} height={28} aria-hidden="true" style={{ flex: "0 0 28px" }} />
      <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {storeName || "Pharmacy Cluster"}
      </span>
    </Link>
  );
}
