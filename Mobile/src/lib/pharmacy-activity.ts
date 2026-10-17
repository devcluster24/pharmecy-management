import { supabase } from '@/lib/supabase';

export async function recordPharmacySessionActivity(eventType: 'login' | 'logout') {
  if (!supabase) {
    throw new Error('Activity history is unavailable. Check your Supabase connection.');
  }

  const { error } = await supabase.rpc('record_pharmacy_session_activity', {
    requested_event_type: eventType,
  });
  if (error) throw error;
}
