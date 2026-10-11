import { supabase } from "@/lib/supabase/client";

export type PharmacyDashboardIdentity = {
  userId: string;
  role: string;
  fullName: string;
  phone: string;
  storeName: string;
  hasPharmacy: boolean;
};

let cachedIdentity: PharmacyDashboardIdentity | null = null;
let identityRequest: { userId: string; promise: Promise<PharmacyDashboardIdentity | null> } | null = null;
let identityGeneration = 0;

export function getPharmacyDashboardIdentity(userId: string) {
  return cachedIdentity?.userId === userId ? cachedIdentity : null;
}

export function loadPharmacyDashboardIdentity(userId: string) {
  const cached = getPharmacyDashboardIdentity(userId);
  if (cached) return Promise.resolve(cached);
  if (identityRequest?.userId === userId) return identityRequest.promise;

  const generation = identityGeneration;
  const promise = (async () => {
    const [profileResult, pharmacyResult] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("role, full_name, phone")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("pharmacies")
        .select("id, store_name")
        .eq("owner_user_id", userId)
        .maybeSingle(),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (pharmacyResult.error) throw pharmacyResult.error;
    if (!profileResult.data) return null;

    const identity = {
      userId,
      role: profileResult.data.role,
      fullName: profileResult.data.full_name ?? "",
      phone: profileResult.data.phone ?? "",
      storeName: pharmacyResult.data?.store_name ?? "",
      hasPharmacy: pharmacyResult.data !== null,
    };
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
}
