import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';

export default function DashboardLayout() {
  const {
    session,
    isLoading,
    dashboardRole,
    approvalStatus,
    profileLoading,
    profileError,
  } = useAuth();
  const [signOutError, setSignOutError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (isLoading || profileLoading) return null;
  if (!session) return <Redirect href="/Auth/login" />;

  if (profileError || !dashboardRole || approvalStatus !== 'approved') {
    const message = profileError
      || (approvalStatus === 'rejected'
        ? 'Your account was not approved. Please contact your pharmacy owner.'
        : approvalStatus === 'suspended'
          ? 'Your account access is suspended. Please contact your pharmacy owner.'
          : 'Your account is waiting for approval.');

    async function handleSignOut() {
      if (!supabase) {
        setSignOutError('Supabase is not configured.');
        return;
      }
      setIsSigningOut(true);
      setSignOutError('');
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(error.message);
        setIsSigningOut(false);
      }
    }

    return (
      <View style={styles.accessPage}>
        <View style={styles.accessCard}>
          <Text style={styles.accessEyebrow}>PHARMACY CLUSTER</Text>
          <Text style={styles.accessTitle}>Dashboard access unavailable</Text>
          <Text style={styles.accessMessage}>{message}</Text>
          {signOutError ? <Text style={styles.signOutError}>{signOutError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={isSigningOut}
            onPress={() => void handleSignOut()}
            style={styles.signOutButton}>
            <Text style={styles.signOutButtonText}>
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <NativeTabs
      backgroundColor="#fffefa"
      indicatorColor="#e8f0e8"
      tintColor="#17664f"
      labelStyle={{ selected: { color: '#17664f' } }}>
      <NativeTabs.Trigger name="index" testID="dashboard-tab-home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>

      {dashboardRole === 'owner' ? (
        [
          <NativeTabs.Trigger key="overview" name="overview" testID="dashboard-tab-overview">
            <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="chart.bar.fill" md="dashboard" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="inventory" name="inventory" testID="dashboard-tab-inventory">
            <NativeTabs.Trigger.Label>Inventory</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="shippingbox.fill" md="inventory_2" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="supplier" name="supplier" testID="dashboard-tab-supplier">
            <NativeTabs.Trigger.Label>Supplier</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="person.2.fill" md="people" />
          </NativeTabs.Trigger>,
        ]
      ) : (
        [
          <NativeTabs.Trigger key="purchase" name="purchase" testID="dashboard-tab-purchase">
            <NativeTabs.Trigger.Label>Purchase</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="cart.fill" md="shopping_cart" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="sale" name="sale" testID="dashboard-tab-sale">
            <NativeTabs.Trigger.Label>Sale</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="creditcard.fill" md="point_of_sale" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="return" name="return" testID="dashboard-tab-return">
            <NativeTabs.Trigger.Label>Return</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="arrow.uturn.backward" md="assignment_return" />
          </NativeTabs.Trigger>,
        ]
      )}

      <NativeTabs.Trigger name="menu" testID="dashboard-tab-menu">
        <NativeTabs.Trigger.Label>Menu</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="line.3.horizontal" md="menu" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

const styles = StyleSheet.create({
  accessPage: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f2f4ef',
  },
  accessCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: 24,
    borderWidth: 1,
    borderColor: '#e7ebe3',
    borderRadius: 22,
    backgroundColor: '#fffefa',
  },
  accessEyebrow: {
    color: '#47826b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  accessTitle: {
    marginTop: 10,
    color: '#183c31',
    fontSize: 23,
    fontWeight: '800',
  },
  accessMessage: {
    marginTop: 9,
    color: '#69766f',
    fontSize: 14,
    lineHeight: 21,
  },
  signOutError: {
    marginTop: 12,
    color: '#a63e34',
    fontSize: 13,
  },
  signOutButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: '#c8f36c',
  },
  signOutButtonText: {
    color: '#173c2c',
    fontSize: 14,
    fontWeight: '800',
  },
});
