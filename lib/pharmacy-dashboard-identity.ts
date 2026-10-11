import { supabase } from "@/lib/supabase/client";
import {
  clearPharmacyStaffPermissions,
  setPharmacyStaffPermissions,
  type StaffPermissions,
} from "@/lib/pharmacy-staff-permissions";

export type PharmacyDashboardIdentity = {
  userId: string;
  ownerUserId: string;
  role: string;
  approvalStatus: string;
  permissions: StaffPermissions;
  fullName: string;
  phone: string;
  storeName: string;
  hasPharmacy: boolean;
};

export function formatPharmacyStoreName(storeName: string) {
  const trimmedName = storeName.trim();
  if (!trimmedName) return "";
  return /\bpharmacy\b/i.test(trimmedName) ? trimmedName : `${trimmedName} Pharmacy`;
}

let cachedIdentity: PharmacyDashboardIdentity | null = null;
let identityRequest: { userId: string; promise: Promise<PharmacyDashboardIdentity | null> } | null = null;
let identityGeneration = 0;

export function getPharmacyDashboardIdentity(userId: string) {
  return cachedIdentity?.userId === userId ? cachedIdentity : null;
}

export function loadPharmacyDashboardIdentity(userId: string, refresh = false) {
  const cached = getPharmacyDashboardIdentity(userId);
  if (cached && !refresh) return Promise.resolve(cached);
  if (identityRequest?.userId === userId) return identityRequest.promise;

  const generation = identityGeneration;
  const promise = (async () => {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role, approval_status, full_name, phone")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return null;

    let identity: PharmacyDashboardIdentity;
    if (profile.role === "pharmacy_staff") {
      const { data, error } = await supabase.rpc("get_my_pharmacy_dashboard_context");
      if (error) throw error;
      const context = data?.[0];
      if (!context) return null;
      const permissions = (context.permissions ?? {}) as StaffPermissions;
      identity = {
        userId,
        ownerUserId: context.owner_user_id,
        role: context.role,
        approvalStatus: context.approval_status,
        permissions,
        fullName: profile.full_name ?? "",
        phone: profile.phone ?? "",
        storeName: context.store_name ?? "",
        hasPharmacy: true,
      };
      setPharmacyStaffPermissions(true, permissions);
    } else {
      const { data: pharmacy, error: pharmacyError } = await supabase
        .from("pharmacies")
        .select("id, store_name")
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (pharmacyError) throw pharmacyError;
      identity = {
        userId,
        ownerUserId: userId,
        role: profile.role,
        approvalStatus: profile.approval_status,
        permissions: {},
        fullName: profile.full_name ?? "",
        phone: profile.phone ?? "",
        storeName: pharmacy?.store_name ?? "",
        hasPharmacy: pharmacy !== null,
      };
      setPharmacyStaffPermissions(false, {});
    }

    if (generation === identityGeneration) cachedIdentity = identity;
    return identity;
  })();

  identityRequest = { userId, promise };
  void promise.finally(() => {
    if (identityRequest?.promise === promise) identityRequest = null;
  }).catch(() => undefined);
  return promise;
}

export function clearPharmacyDashboardIdentity() {
  identityGeneration += 1;
  cachedIdentity = null;
  identityRequest = null;
  clearPharmacyStaffPermissions();
}
