import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  authError: string;
  dashboardRole: DashboardRole | null;
  approvalStatus: string;
  ownerName: string;
  storeName: string;
  profileLoading: boolean;
  profileError: string;
};

export type DashboardRole = 'owner' | 'staff';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [dashboardRole, setDashboardRole] = useState<DashboardRole | null>(null);
  const [approvalStatus, setApprovalStatus] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setIsLoading(false);
      setAuthError('');
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(error.message);
      } else {
        setSession(data.session);
      }
      setIsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : 'Could not restore your session.');
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setDashboardRole(null);
      setApprovalStatus('');
      setOwnerName('');
      setStoreName('');
      setProfileError('');
      setProfileLoading(false);
      return;
    }

    const client = supabase;
    if (!client) {
      setDashboardRole(null);
      setApprovalStatus('');
      setOwnerName('');
      setStoreName('');
      setProfileError('Supabase is not configured.');
      setProfileLoading(false);
      return;
    }

    let active = true;
    setDashboardRole(null);
    setApprovalStatus('');
    setOwnerName('');
    setStoreName('');
    setProfileError('');
    setProfileLoading(true);
    const activeClient: NonNullable<typeof supabase> = client;
    const activeSession: Session = session;

    async function loadProfile() {
      try {
        const { data, error } = await activeClient
          .from('user_profiles')
          .select('role, approval_status, full_name')
          .eq('id', activeSession.user.id)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setProfileError(error.message);
          return;
        }
        if (!data) {
          setProfileError('Your account profile could not be found.');
          return;
        }

        setOwnerName(data.full_name?.trim() ?? '');

        if (data.role === 'pharmacy_user') {
          setDashboardRole('owner');
          const { data: pharmacy, error: pharmacyError } = await activeClient
            .from('pharmacies')
            .select('store_name')
            .eq('owner_user_id', activeSession.user.id)
            .maybeSingle();
          if (!active) return;
          if (pharmacyError) {
            setProfileError(pharmacyError.message);
            return;
          }
          setStoreName(pharmacy?.store_name?.trim() ?? '');
        } else if (data.role === 'pharmacy_staff') {
          setDashboardRole('staff');
          const { data: pharmacyContext, error: contextError } = await activeClient
            .rpc('get_my_pharmacy_dashboard_context');
          if (!active) return;
          if (contextError) {
            setProfileError(contextError.message);
            return;
          }
          const pharmacy = pharmacyContext?.[0] as { store_name?: string } | undefined;
          setStoreName(pharmacy?.store_name?.trim() ?? '');
        } else {
          setProfileError('This account does not have access to the pharmacy dashboard.');
        }
        setApprovalStatus(data.approval_status);
      } catch (error: unknown) {
        if (!active) return;
        setProfileError(error instanceof Error ? error.message : 'Could not load your account access.');
      } finally {
        if (active) setProfileLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        authError,
        dashboardRole,
        approvalStatus,
        ownerName,
        storeName,
        profileLoading,
        profileError,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
