import { Text, useLocalizedAlert, useTranslate } from '@/providers/LanguageProvider';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View
} from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { hasDashboardPageAccess } from '@/lib/dashboard-access';
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';
import { useProductCatalogAutoSync } from '@/components/dashboard/ProductCatalogAutoSync';
import { loadPharmacySubscriptionOptions } from '@/lib/pharmacy-subscription';
import { supabase } from '@/lib/supabase';
import { recordPharmacySessionActivity } from '@/lib/pharmacy-activity';
import homeIcon from '../../../assets/images/tabIcons/home.png';
import inventoryIcon from '../../../assets/images/tabIcons/inventory.png';
import localShippingIcon from '../../../assets/images/tabIcons/local_shipping.png';
import localMallIcon from '../../../assets/images/tabIcons/local_mall.png';
import menuIcon from '../../../assets/images/tabIcons/menu.png';
import overviewIcon from '../../../assets/images/tabIcons/overview.png';
import assignmentReturnIcon from '../../../assets/images/tabIcons/assignment_return.png';
import shoppingCartIcon from '../../../assets/images/tabIcons/shopping_cart.png';

export default function DashboardLayout() {
  const alert = useLocalizedAlert();
  const t = useTranslate();
  const {
    session,
    isLoading,
    dashboardRole,
    approvalStatus,
    profileLoading,
    profileError,
    storeName,
    staffPermissions,
    signupOnboardingPending,
  } = useAuth();
  const { onboarding: onboardingParam } = useLocalSearchParams<{ onboarding?: string | string[] }>();
  const isOnboardingRoute = (Array.isArray(onboardingParam) ? onboardingParam[0] : onboardingParam) === '1';
  const [signOutError, setSignOutError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [subscriptionCheck, setSubscriptionCheck] = useState<{
    key: string;
    isAssigned?: boolean;
    error?: string;
  } | null>(null);
  const [subscriptionRetry, setSubscriptionRetry] = useState(0);
  useProductCatalogAutoSync();

  const subscriptionCheckKey = session
    ? `${session.user.id}:${storeName}:${subscriptionRetry}`
    : '';
  useEffect(() => {
    if (
      isLoading
      || profileLoading
      || !session
      || dashboardRole !== 'owner'
      || !storeName.trim()
    ) return;
    let active = true;
    const key = `${session.user.id}:${storeName}:${subscriptionRetry}`;
    void loadPharmacySubscriptionOptions()
      .then((options) => {
        if (active) setSubscriptionCheck({ key, isAssigned: options.is_assigned });
      })
      .catch((error: unknown) => {
        if (active) {
          setSubscriptionCheck({
            key,
            error: error instanceof Error ? error.message : 'Could not verify the pharmacy subscription.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [dashboardRole, isLoading, profileLoading, session, storeName, subscriptionRetry]);

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
      try {
        try {
          await recordPharmacySessionActivity('logout');
        } catch (activityError) {
          alert.alert(
            'Logout activity was not saved',
            activityError instanceof Error
              ? activityError.message
              : 'Could not record this logout in the activity history.',
          );
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch (error) {
        setSignOutError(error instanceof Error ? error.message : 'Could not sign out.');
        setIsSigningOut(false);
      }
    }

    return (
      <View style={styles.accessPage}>
        <View style={styles.accessCard}>
          <Text style={styles.accessEyebrow}>{getPharmacyDisplayName(storeName).toLocaleUpperCase()}</Text>
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

  if (dashboardRole === 'owner') {
    if (!storeName.trim()) {
      return (
        <Redirect
          href={(signupOnboardingPending
            ? '/shop-setup?onboarding=1'
            : '/shop-setup') as Href}
        />
      );
    }
    if (subscriptionCheck?.key !== subscriptionCheckKey) {
      return (
        <View style={styles.accessPage}>
          <ActivityIndicator size="large" color="#16845d" />
        </View>
      );
    }
    if (subscriptionCheck.error) {
      return (
        <View style={styles.accessPage}>
          <View style={styles.accessCard}>
            <Text style={styles.accessTitle}>Subscription status unavailable</Text>
            <Text style={styles.accessMessage}>{subscriptionCheck.error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSubscriptionRetry((value) => value + 1)}
              style={styles.signOutButton}>
              <Text style={styles.signOutButtonText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (!subscriptionCheck.isAssigned) {
      return (
        <Redirect
          href={signupOnboardingPending
            ? '/subscription-setup?onboarding=1'
            : '/subscription-setup'}
        />
      );
    }
    if (signupOnboardingPending && !isOnboardingRoute) {
      return <Redirect href={'/pharmacy-setup-onboarding' as Href} />;
    }
  }

  return (
    <NativeTabs
      backgroundColor="#fffefa"
      indicatorColor="#e8f0e8"
      tintColor="#17664f"
      labelStyle={{ selected: { color: '#17664f' } }}>
      <NativeTabs.Trigger name="index" testID="dashboard-tab-home">
        <NativeTabs.Trigger.Label>{t('Home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={homeIcon} renderingMode="original" />
      </NativeTabs.Trigger>

      {dashboardRole === 'owner' ? (
        [
          <NativeTabs.Trigger key="overview" name="overview" testID="dashboard-tab-overview">
            <NativeTabs.Trigger.Label>{t('Overview')}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon src={overviewIcon} renderingMode="original" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="inventory" name="inventory" testID="dashboard-tab-inventory">
            <NativeTabs.Trigger.Label>{t('Inventory')}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon src={inventoryIcon} renderingMode="original" />
          </NativeTabs.Trigger>,
          <NativeTabs.Trigger key="supplier" name="supplier" testID="dashboard-tab-supplier">
            <NativeTabs.Trigger.Label>{t('Supplier')}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon src={localShippingIcon} renderingMode="original" />
          </NativeTabs.Trigger>,
        ]
      ) : (
        [
          ...(hasDashboardPageAccess('staff', staffPermissions, ['sales', 'purchase']) ? [
            <NativeTabs.Trigger key="sale" name="sale" testID="dashboard-tab-sale">
              <NativeTabs.Trigger.Label>{t('Sale')}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon src={shoppingCartIcon} renderingMode="original" />
            </NativeTabs.Trigger>,
          ] : []),
          ...(hasDashboardPageAccess('staff', staffPermissions, 'purchase') ? [
            <NativeTabs.Trigger key="purchase" name="purchase" testID="dashboard-tab-purchase">
              <NativeTabs.Trigger.Label>{t('Purchase')}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon src={localMallIcon} renderingMode="original" />
            </NativeTabs.Trigger>,
          ] : []),
          ...(hasDashboardPageAccess('staff', staffPermissions, ['returns', 'sales', 'purchase', 'settings']) ? [
            <NativeTabs.Trigger key="return" name="return" testID="dashboard-tab-return">
              <NativeTabs.Trigger.Label>{t('Return')}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon src={assignmentReturnIcon} renderingMode="original" />
            </NativeTabs.Trigger>,
          ] : []),
        ]
      )}

      <NativeTabs.Trigger name="menu" testID="dashboard-tab-menu">
        <NativeTabs.Trigger.Label>{t('Menu')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={menuIcon}
          renderingMode="original"
        />
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
