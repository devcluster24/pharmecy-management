import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthField } from '@/components/auth/AuthScreen';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export default function ShopSetupScreen() {
  const { alert } = useLocalizedAlert();
  const {
    session,
    isLoading,
    dashboardRole,
    profileLoading,
    profileError,
    storeName,
    refreshStoreName,
    signupOnboardingPending,
  } = useAuth();
  const [store, setStore] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Bangladesh');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (isLoading || profileLoading || (session && !dashboardRole && !profileError)) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#16845d" />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/Auth/login" />;
  if (profileError) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.error}>{profileError}</Text>
      </SafeAreaView>
    );
  }
  if (dashboardRole !== 'owner') {
    return <Redirect href="/dashboard" />;
  }
  if (storeName.trim()) return <Redirect href="/dashboard" />;

  async function saveStore() {
    Keyboard.dismiss();
    const storeNameValue = store.trim();
    const addressValue = address.trim();
    const cityValue = city.trim();
    const countryValue = country.trim();
    if (!storeNameValue || !addressValue || !cityValue || !countryValue) {
      setError('Complete the store name, address, city, and country.');
      return;
    }
    if (!supabase) {
      setError('Store setup is unavailable. Check your account connection.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const { error: setupError } = await supabase.rpc('complete_pharmacy_setup', {
        requested_store_name: storeNameValue,
        requested_company_name: company.trim(),
        requested_address: addressValue,
        requested_city: cityValue,
        requested_country: countryValue,
      });
      if (setupError) throw setupError;
      await refreshStoreName();
      router.replace(signupOnboardingPending ? '/subscription-setup?onboarding=1' : '/subscription-setup');
    } catch (setupError) {
      const message = setupError instanceof Error
        ? setupError.message
        : 'Could not save your pharmacy details.';
      setError(message);
      alert('Store setup failed', message);
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Text style={styles.brandMark}>✦</Text>
          <View>
            <Text style={styles.brandName}>Pharmacy Cluster</Text>
            <Text style={styles.brandCaption}>STORE SETUP · STEP 2 OF 3</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>READY TO LAUNCH</Text>
          <Text style={styles.title}>Set up your store</Text>
          <Text style={styles.subtitle}>
            Add your pharmacy details. You’ll choose a subscription plan before opening the dashboard.
          </Text>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.form}>
            <AuthField
              label="Store name"
              value={store}
              onChangeText={setStore}
              placeholder="Green Valley Pharmacy"
              autoCapitalize="words"
              editable={!isSubmitting}
            />
            <AuthField
              label="Company name (optional)"
              value={company}
              onChangeText={setCompany}
              placeholder="Valley Health Ltd."
              autoCapitalize="words"
              editable={!isSubmitting}
            />
            <AuthField
              label="Physical store address"
              value={address}
              onChangeText={setAddress}
              placeholder="123 Main Road"
              autoCapitalize="sentences"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={!isSubmitting}
            />
            <AuthField
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder="Dhaka"
              autoCapitalize="words"
              editable={!isSubmitting}
            />
            <AuthField
              label="Country"
              value={country}
              onChangeText={setCountry}
              placeholder="Bangladesh"
              autoCapitalize="words"
              editable={!isSubmitting}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void saveStore()}
              style={[styles.submitButton, isSubmitting && styles.disabled]}>
              <Text style={styles.submitButtonText}>
                {isSubmitting ? 'Saving store details…' : 'Save and continue'}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f8f5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#f4f8f5' },
  content: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', padding: 22, gap: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 40, height: 40, overflow: 'hidden', borderRadius: 12, backgroundColor: '#16845d', color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  brandName: { color: '#183c31', fontSize: 17, fontWeight: '800' },
  brandCaption: { marginTop: 3, color: '#87948c', fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  card: { padding: 22, borderWidth: 1, borderColor: '#e7ebe3', borderRadius: 22, backgroundColor: '#fffefa', gap: 14 },
  eyebrow: { color: '#47826b', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#18362f', fontSize: 25, fontWeight: '800' },
  subtitle: { marginBottom: 4, color: '#728078', fontSize: 13, lineHeight: 19 },
  form: { gap: 14 },
  error: { padding: 11, borderWidth: 1, borderColor: '#f0c9c2', borderRadius: 10, backgroundColor: '#fff3f0', color: '#a63e34', fontSize: 12, lineHeight: 18 },
  submitButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#2ad49a' },
  submitButtonText: { color: '#072f2a', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
