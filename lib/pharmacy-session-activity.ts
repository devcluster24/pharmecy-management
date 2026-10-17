import { supabase } from "@/lib/supabase/client";

export async function recordPharmacySessionActivity(eventType: "login" | "logout") {
  const { error } = await supabase.rpc("record_pharmacy_session_activity", {
    requested_event_type: eventType,
  });
  if (error) throw error;
}
