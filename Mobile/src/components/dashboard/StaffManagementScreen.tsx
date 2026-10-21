import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';

type StaffStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
type StaffRole = 'Manager' | 'Pharmacist' | 'Cashier' | 'Inventory Staff' | 'Sales Staff' | 'Staff';
type StaffPermissions = Record<string, boolean>;
type StaffMember = {
  staff_user_id: string;
  email: string;
  full_name: string;
  photo_url: string | null;
  approval_status: StaffStatus;
  created_at: string;
  staff_role: StaffRole;
  permissions: StaffPermissions;
};

const staffRoles: StaffRole[] = [
  'Manager',
  'Pharmacist',
  'Cashier',
  'Inventory Staff',
  'Sales Staff',
  'Staff',
];
const pageAccess: Record<StaffRole, string[]> = {
  Manager: ['overview', 'product-management', 'sales', 'invoice', 'purchase', 'inventory', 'returns', 'customers', 'suppliers', 'reports', 'expenses', 'settings'],
  Pharmacist: ['overview', 'product-management', 'sales', 'invoice', 'inventory', 'returns', 'customers'],
  Cashier: ['overview', 'sales', 'invoice', 'customers'],
  'Inventory Staff': ['overview', 'product-management', 'purchase', 'inventory', 'returns', 'suppliers'],
  'Sales Staff': ['overview', 'sales', 'invoice', 'customers'],
  Staff: [],
};
const staffPages = [
  { key: 'overview', label: 'Overview' },
  { key: 'product-management', label: 'Product Management' },
  { key: 'sales', label: 'Sales' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'returns', label: 'Return System' },
  { key: 'customers', label: 'Customer Management' },
  { key: 'suppliers', label: 'Supplier Management' },
  { key: 'reports', label: 'Reports' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'settings', label: 'Setting' },
];
const webAppUrl = process.env.EXPO_PUBLIC_WEB_APP_URL?.replace(/\/+$/, '');

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function normalizePermissions(permissions: StaffPermissions) {
  return Object.fromEntries(
    Object.entries(permissions).map(([key, value]) => [key, typeof value === 'boolean' ? value : false]),
  );
}

function getInitialPermissions(role: StaffRole): StaffPermissions {
  return Object.fromEntries(staffPages.map((page) => [page.key, pageAccess[role].includes(page.key)]));
}

function hasPageAccess(permissions: StaffPermissions, page: string) {
  return permissions[page] === true;
}

export default function StaffManagementScreen({ actionPage = false }: { actionPage?: boolean }) {
  const { dashboardRole } = useAuth();
  const { action, staffUserId } = useLocalSearchParams<{ action: string; staffUserId: string }>();
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(supabase ? '' : 'Supabase is not configured.');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<StaffMember | null>(null);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffRole>('Staff');
  const [permissions, setPermissions] = useState<StaffPermissions>({});
  const [status, setStatus] = useState<'approved' | 'suspended'>('suspended');

  async function loadMembers() {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error: rpcError } = await supabase.rpc('get_pharmacy_staff_members');
    if (rpcError) throw rpcError;
    const result = (data ?? []) as StaffMember[];
    setMembers(result);
    return result;
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const timeout = setTimeout(() => {
      void loadMembers()
        .catch((loadError: unknown) => {
          if (active) setError(`Could not load staff applications: ${getErrorMessage(loadError)}`);
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!actionPage || !staffUserId || !members.length) return;
    const timeout = setTimeout(() => {
      const member = members.find((item) => item.staff_user_id === staffUserId);
      if (!member) {
        setError('The selected staff member could not be found.');
        return;
      }
      setSelectedMember(member);
      setFullName(member.full_name);
      setRole(staffRoles.includes(member.staff_role) ? member.staff_role : 'Staff');
      setPermissions(normalizePermissions(member.permissions ?? {}));
      setStatus(member.approval_status === 'approved' ? 'approved' : 'suspended');
    }, 0);
    return () => clearTimeout(timeout);
  }, [actionPage, members, staffUserId]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return members.filter((member) => !query || [
      member.full_name,
      member.email,
      member.staff_role,
      member.approval_status,
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [members, search]);

  async function createStaffUrl() {
    if (!supabase) {
      setInviteMessage('Supabase is not configured.');
      return;
    }
    setIsCreatingInvite(true);
    setInviteUrl('');
    setInviteMessage('');
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user) throw new Error('Sign in again before creating a staff signup link.');
      const origin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : webAppUrl;
      if (!origin) {
        throw new Error('Set EXPO_PUBLIC_WEB_APP_URL to your web app URL to create a staff signup link in the mobile app.');
      }

      const tokenBytes = await Crypto.getRandomBytesAsync(32);
      const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const tokenHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token);
      const { error: inviteError } = await supabase.rpc('create_pharmacy_staff_invite', {
        requested_token_hash: tokenHash,
      });
      if (inviteError) throw inviteError;

      setInviteUrl(`${origin}/staff-signup/${token}`);
      setInviteMessage('This private link accepts one staff application and expires in 30 days.');
    } catch (createError) {
      setInviteMessage(getErrorMessage(createError));
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function shareInviteUrl() {
    if (!inviteUrl) return;
    try {
      await Share.share({ message: inviteUrl, url: inviteUrl, title: 'Staff signup link' });
    } catch (shareError) {
      setInviteMessage(`Could not share the signup link: ${getErrorMessage(shareError)}`);
    }
  }

  async function saveStaff() {
    if (!supabase || !selectedMember) return;
    if (!fullName.trim()) {
      setError('Staff name is required.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const isPermissionPage = action === 'permissions';
      const { error: saveError } = await supabase.rpc('manage_pharmacy_staff_access', {
        target_staff_user_id: selectedMember.staff_user_id,
        requested_decision: 'update',
        requested_permissions: isPermissionPage
          ? normalizePermissions(permissions)
          : normalizePermissions(selectedMember.permissions ?? {}),
        requested_role: isPermissionPage ? role : selectedMember.staff_role,
        requested_status: isPermissionPage ? status : selectedMember.approval_status,
        requested_full_name: fullName.trim(),
      });
      if (saveError) throw saveError;
      router.replace('/dashboard/menu/staff-management');
    } catch (saveError) {
      setError(`Could not update staff access: ${getErrorMessage(saveError)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStatus(member: StaffMember) {
    if (!supabase) return;
    setError('');
    try {
      const { error: statusError } = await supabase.rpc('manage_pharmacy_staff_access', {
        target_staff_user_id: member.staff_user_id,
        requested_decision: 'update',
        requested_permissions: normalizePermissions(member.permissions ?? {}),
        requested_role: member.staff_role,
        requested_status: member.approval_status === 'approved' ? 'suspended' : 'approved',
        requested_full_name: member.full_name.trim() || null,
      });
      if (statusError) throw statusError;
      await loadMembers();
    } catch (statusError) {
      setError(`Could not update staff status: ${getErrorMessage(statusError)}`);
    }
  }

  function confirmDelete(member: StaffMember) {
    Alert.alert(
      'Delete staff account',
      `Permanently delete ${member.full_name || member.email}'s staff account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteStaff(member),
        },
      ],
    );
  }

  async function deleteStaff(member: StaffMember) {
    if (!supabase) return;
    setError('');
    try {
      const { error: deleteError } = await supabase.rpc('delete_pharmacy_staff_member', {
        target_staff_user_id: member.staff_user_id,
      });
      if (deleteError) throw deleteError;
      setMembers((current) => current.filter((item) => item.staff_user_id !== member.staff_user_id));
    } catch (deleteError) {
      setError(`Could not delete staff account: ${getErrorMessage(deleteError)}`);
    }
  }

  if (actionPage) {
    const isPermissionPage = action === 'permissions';
    return (
      <SafeAreaView style={styles.screen}>
        <DashboardSubpageHeader
          subtitle={isPermissionPage ? 'Staff Permissions' : 'Edit Staff'}
          onBack={() => router.replace('/dashboard/menu/staff-management')}
        />
        <ScrollView contentContainerStyle={styles.content}>
          {isLoading ? (
            <ActivityIndicator color="#17664f" />
          ) : !selectedMember ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.error}>
                {error || 'The selected staff member could not be found.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/dashboard/menu/staff-management')}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Back to Staff Management</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.heading}>{isPermissionPage ? 'Staff access & permissions' : 'Edit staff profile'}</Text>
                <Text style={styles.helperText}>{selectedMember.email}</Text>
                <Text style={styles.label}>Full name</Text>
                <TextInput
                  accessibilityLabel="Full name"
                  onChangeText={setFullName}
                  style={styles.input}
                  value={fullName}
                />
                <Text style={styles.label}>Email address</Text>
                <TextInput editable={false} style={[styles.input, styles.readOnly]} value={selectedMember.email} />
              </View>

              {isPermissionPage ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Staff role</Text>
                    {staffRoles.map((item) => (
                      <Pressable
                        key={item}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: role === item }}
                        onPress={() => {
                          setRole(item);
                          setPermissions(getInitialPermissions(item));
                        }}
                        style={styles.optionRow}>
                        <Text style={styles.optionLabel}>{role === item ? '◉' : '○'}  {item}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Menu access ({Object.values(permissions).filter(Boolean).length}/{staffPages.length})</Text>
                    {staffPages.map((page) => (
                      <Pressable
                        key={page.key}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: hasPageAccess(permissions, page.key) }}
                        onPress={() => setPermissions((current) => ({
                          ...current,
                          [page.key]: !hasPageAccess(current, page.key),
                        }))}
                        style={styles.optionRow}>
                        <Text style={styles.optionLabel}>
                          {hasPageAccess(permissions, page.key) ? '☑' : '☐'}  {page.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Login access</Text>
                    {(['approved', 'suspended'] as const).map((item) => (
                      <Pressable
                        key={item}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: status === item }}
                        onPress={() => setStatus(item)}
                        style={styles.optionRow}>
                        <Text style={styles.optionLabel}>
                          {status === item ? '◉' : '○'}  {item === 'approved' ? 'Active — can sign in' : 'Inactive — sign-in blocked'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Pressable disabled={isSaving} onPress={() => void saveStaff()} style={[styles.primaryButton, isSaving && styles.disabledButton]}>
                <Text style={styles.primaryButtonText}>{isSaving ? 'Saving changes…' : 'Save changes'}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <DashboardSubpageHeader subtitle="Staff Management" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.heading}>Create staff signup link</Text>
          <Text style={styles.helperText}>
            Create a unique URL for one staff signup. The link expires after 30 days.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isCreatingInvite || dashboardRole !== 'owner'}
            onPress={() => void createStaffUrl()}
            style={[styles.primaryButton, (isCreatingInvite || dashboardRole !== 'owner') && styles.disabledButton]}>
            <Text style={styles.primaryButtonText}>
              {isCreatingInvite ? 'Creating link…' : 'Create Staff URL'}
            </Text>
          </Pressable>
          {inviteMessage ? <Text style={inviteUrl ? styles.success : styles.helperText}>{inviteMessage}</Text> : null}
          {inviteUrl ? (
            <>
              <Text selectable style={styles.inviteUrl}>{inviteUrl}</Text>
              <Pressable accessibilityRole="button" onPress={() => void shareInviteUrl()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Share signup URL</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Staff applications and access ({members.length})</Text>
          <Text style={styles.helperText}>Manage each staff member’s role, menu access, and login status.</Text>
          {members.length ? (
            <TextInput
              accessibilityLabel="Search staff"
              onChangeText={setSearch}
              placeholder="Search staff…"
              style={styles.input}
              value={search}
            />
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {isLoading ? <ActivityIndicator color="#17664f" /> : null}
          {!isLoading && members.length === 0 ? (
            <Text style={styles.helperText}>No staff applications yet. Staff who sign up with your link will appear here.</Text>
          ) : null}
          {!isLoading && filteredMembers.map((member) => (
            <View key={member.staff_user_id} style={styles.staffCard}>
              <View style={styles.staffHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(member.full_name || member.email || '?').trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.staffIdentity}>
                  <Text style={styles.staffName}>{member.full_name || '—'}</Text>
                  <Text style={styles.staffEmail}>{member.email}</Text>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={`Set ${member.full_name || member.email} ${member.approval_status === 'approved' ? 'inactive' : 'active'}`}
                  accessibilityState={{ checked: member.approval_status === 'approved' }}
                  onPress={() => void toggleStatus(member)}
                  style={styles.statusButton}>
                  <Text style={member.approval_status === 'approved' ? styles.success : styles.statusInactive}>
                    {member.approval_status === 'approved' ? 'Active' : 'Inactive'}
                  </Text>
                  <View style={[
                    styles.statusTrack,
                    member.approval_status === 'approved' && styles.statusTrackActive,
                  ]}>
                    <View style={[
                      styles.statusThumb,
                      member.approval_status === 'approved' && styles.statusThumbActive,
                    ]} />
                  </View>
                </Pressable>
              </View>
              <Text style={styles.staffMeta}>Role: {member.staff_role || 'Staff'}</Text>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({
                    pathname: '/dashboard/menu/staff-action',
                    params: { action: 'permissions', staffUserId: member.staff_user_id },
                  })}
                  style={styles.actionButton}>
                  <Text style={styles.actionText}>Permission</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({
                    pathname: '/dashboard/menu/staff-action',
                    params: { action: 'edit', staffUserId: member.staff_user_id },
                  })}
                  style={styles.actionButton}>
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => confirmDelete(member)} style={[styles.actionButton, styles.deleteButton]}>
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!isLoading && members.length > 0 && filteredMembers.length === 0 ? (
            <Text style={styles.helperText}>No staff members match this search.</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  content: {
    flexGrow: 1,
    gap: 14,
    padding: 16,
  },
  card: {
    gap: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  heading: {
    color: '#20342a',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#26352f',
    fontSize: 15,
    fontWeight: '700',
  },
  helperText: {
    color: '#687871',
    fontSize: 12,
    lineHeight: 18,
  },
  label: {
    marginTop: 8,
    color: '#52625a',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    color: '#26352f',
    fontSize: 13,
  },
  readOnly: {
    backgroundColor: '#f7f9f7',
    color: '#78857e',
  },
  inviteUrl: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 6,
    color: '#26352f',
    fontSize: 12,
  },
  primaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#26352f',
    fontSize: 12,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.55,
  },
  success: {
    color: '#276749',
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  staffCard: {
    gap: 9,
    marginTop: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e7ece8',
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  staffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#e7f4ed',
  },
  avatarText: {
    color: '#18794e',
    fontSize: 16,
    fontWeight: '700',
  },
  staffIdentity: {
    flex: 1,
  },
  staffName: {
    color: '#26352f',
    fontSize: 14,
    fontWeight: '700',
  },
  staffEmail: {
    marginTop: 3,
    color: '#687871',
    fontSize: 11,
  },
  staffMeta: {
    color: '#526158',
    fontSize: 12,
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginLeft: 8,
    paddingVertical: 5,
  },
  statusTrack: {
    width: 36,
    height: 21,
    justifyContent: 'center',
    padding: 3,
    borderRadius: 11,
    backgroundColor: '#c8ceca',
  },
  statusTrackActive: {
    backgroundColor: '#179c70',
  },
  statusThumb: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  statusThumbActive: {
    alignSelf: 'flex-end',
  },
  statusInactive: {
    color: '#8a655f',
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 3,
  },
  actionButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  actionText: {
    color: '#26352f',
    fontSize: 11,
    fontWeight: '600',
  },
  deleteButton: {
    borderColor: '#ead3d0',
  },
  deleteText: {
    color: '#ad4b43',
    fontSize: 11,
    fontWeight: '600',
  },
  optionRow: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  optionLabel: {
    color: '#34453b',
    fontSize: 13,
  },
});
