import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import { Redirect, router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import {
  loadProductAutoSyncSettings,
  saveProductAutoSyncSettings,
} from '@/lib/product-catalog-auto-sync';
import { supabase } from '@/lib/supabase';

const setupSections = [
  {
    slug: 'inventory',
    title: 'Inventory',
    description: 'Set the low-stock alert threshold for your products.',
  },
  {
    slug: 'vat-tax',
    title: 'Vat/Tax',
    description: 'Set your default VAT and tax rate.',
  },
  {
    slug: 'payment-methord',
    title: 'Payment Method',
    description: 'Add mobile banking or bank account payment details.',
  },
  {
    slug: 'return-management',
    title: 'Return Management',
    description: 'Set the default deduction rate for returned products.',
  },
] as const;

export default function PharmacySetupOnboardingScreen() {
  const alert = useLocalizedAlert();
  const {
    dashboardRole,
    isLoading,
    profileLoading,
    pharmacyOwnerId,
    session,
    signupOnboardingPending,
    completeSignupOnboarding,
    storeName,
  } = useAuth();
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(false);
  const [isLoadingAutoSync, setIsLoadingAutoSync] = useState(Boolean(supabase));
  const [isSavingAutoSync, setIsSavingAutoSync] = useState(false);
  const [isCompletingSetup, setIsCompletingSetup] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading || profileLoading || !session || dashboardRole !== 'owner') return;
    if (!supabase) return;

    let active = true;
    void loadProductAutoSyncSettings(supabase, pharmacyOwnerId ?? session.user.id)
      .then((settings) => {
        if (active) setIsAutoSyncEnabled(settings.enabled);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load product auto-sync settings.');
        }
      })
      .finally(() => {
        if (active) setIsLoadingAutoSync(false);
      });

    return () => {
      active = false;
    };
  }, [dashboardRole, isLoading, pharmacyOwnerId, profileLoading, session]);

  if (isLoading || profileLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#16845d" />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/Auth/login" />;
  if (!signupOnboardingPending) return <Redirect href="/dashboard" />;
  if (dashboardRole !== 'owner') return <Redirect href="/dashboard" />;
  if (!storeName.trim()) return <Redirect href={'/shop-setup' as Href} />;

  async function skipSetup() {
    setIsCompletingSetup(true);
    setError('');
    try {
      await completeSignupOnboarding();
      router.replace('/dashboard');
    } catch (completionError) {
      const message = completionError instanceof Error
        ? completionError.message
        : 'Could not complete pharmacy setup.';
      setError(message);
      alert.alert('Could not continue', message);
      setIsCompletingSetup(false);
    }
  }

  async function toggleAutoSync() {
    if (!supabase || !session || isSavingAutoSync) return;
    setIsSavingAutoSync(true);
    setError('');
    try {
      const settings = await saveProductAutoSyncSettings(
        supabase,
        pharmacyOwnerId ?? session.user.id,
        !isAutoSyncEnabled,
      );
      setIsAutoSyncEnabled(settings.enabled);
    } catch (saveError) {
      const message = saveError instanceof Error
        ? saveError.message
        : 'Could not save product auto-sync settings.';
      setError(message);
      alert.alert('Could not save setup', message);
    } finally {
      setIsSavingAutoSync(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>Pharmacy Cluster</Text>
          <Text style={styles.step}>OPTIONAL SETUP</Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>Set up your pharmacy</Text>
          <Text style={styles.description}>
            Configure these settings now or skip and update them later from Cluster Menu.
          </Text>
        </View>

        <View style={styles.sectionList}>
          {setupSections.map((section, index) => (
            <View key={section.slug} style={styles.sectionCard}>
              <View style={styles.sectionHeading}>
                <View style={styles.numberBadge}>
                  <Text style={styles.numberText}>{index + 1}</Text>
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionDescription}>{section.description}</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({
                  pathname: '/dashboard/menu/[slug]',
                  params: { slug: section.slug, onboarding: '1' },
                })}
                style={styles.configureButton}>
                <Text style={styles.configureButtonText}>Configure</Text>
              </Pressable>
            </View>
          ))}

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeading}>
              <View style={styles.numberBadge}>
                <Text style={styles.numberText}>5</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Product Management</Text>
                <Text style={styles.sectionDescription}>
                  Automatically add newly shared manufacturer products to your product list.
                </Text>
              </View>
            </View>
            <View style={styles.autoSyncRow}>
              <Text style={styles.autoSyncLabel}>Auto Sync</Text>
              {isLoadingAutoSync ? (
                <ActivityIndicator color="#16845d" />
              ) : (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="Product auto sync"
                  accessibilityState={{
                    checked: isAutoSyncEnabled,
                    disabled: isSavingAutoSync || isCompletingSetup || !supabase,
                  }}
                  disabled={isSavingAutoSync || isCompletingSetup || !supabase}
                  onPress={() => void toggleAutoSync()}
                  style={[
                    styles.switch,
                    isAutoSyncEnabled && styles.switchEnabled,
                    (isSavingAutoSync || isCompletingSetup) && styles.disabled,
                  ]}>
                  <View style={[
                    styles.switchKnob,
                    isAutoSyncEnabled && styles.switchKnobEnabled,
                  ]} />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {error || !supabase ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error || 'Product auto sync is unavailable because Supabase is not configured.'}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={isCompletingSetup}
          onPress={() => void skipSetup()}
          style={[styles.skipButton, isCompletingSetup && styles.disabled]}>
          <Text style={styles.skipButtonText}>
            {isCompletingSetup ? 'Saving…' : 'Skip setup and go to dashboard'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f8f5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f8f5' },
  content: { flexGrow: 1, width: '100%', maxWidth: 620, alignSelf: 'center', padding: 22, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#183c31', fontSize: 16, fontWeight: '800' },
  step: { color: '#47826b', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  intro: { gap: 7 },
  title: { color: '#18362f', fontSize: 26, fontWeight: '800' },
  description: { color: '#728078', fontSize: 13, lineHeight: 19 },
  sectionList: { gap: 12 },
  sectionCard: { padding: 16, gap: 14, borderWidth: 1, borderColor: '#e2e9e4', borderRadius: 16, backgroundColor: '#fffefa' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  numberBadge: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e8f3ec' },
  numberText: { color: '#17664f', fontSize: 13, fontWeight: '800' },
  sectionCopy: { flex: 1, gap: 4 },
  sectionTitle: { color: '#183c31', fontSize: 15, fontWeight: '800' },
  sectionDescription: { color: '#687871', fontSize: 12, lineHeight: 17 },
  configureButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#e8f3ec' },
  configureButtonText: { color: '#17664f', fontSize: 12, fontWeight: '800' },
  autoSyncRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoSyncLabel: { color: '#34453b', fontSize: 13, fontWeight: '700' },
  switch: { width: 48, height: 28, justifyContent: 'center', padding: 3, borderRadius: 20, backgroundColor: '#c9d2cc' },
  switchEnabled: { backgroundColor: '#179c70' },
  switchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', transform: [{ translateX: 0 }] },
  switchKnobEnabled: { transform: [{ translateX: 20 }] },
  disabled: { opacity: 0.6 },
  error: { padding: 12, borderWidth: 1, borderColor: '#f0c9c2', borderRadius: 10, backgroundColor: '#fff3f0', color: '#a63e34', fontSize: 12, lineHeight: 18 },
  skipButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#2ad49a' },
  skipButtonText: { color: '#072f2a', fontSize: 14, fontWeight: '800' },
});
