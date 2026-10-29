import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Keyboard,
  Pressable,
  View
} from 'react-native';

import {
  AuthField,
  AuthScreen,
  AuthSubmitButton,
  authStyles,
} from '@/components/auth/AuthScreen';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { recordPharmacySessionActivity } from '@/lib/pharmacy-activity';

export default function LoginScreen() {
  const alert = useLocalizedAlert();
  const router = useRouter();
  const { session, isLoading, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) return null;
  if (session) return <Redirect href="/dashboard" />;

  async function handleLogin() {
    Keyboard.dismiss();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      alert.alert('Invalid details', 'Enter your email address and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }
    if (!supabase) {
      alert.alert('Sign in unavailable', supabaseConfigError);
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      if (!data.session || !data.user) {
        throw new Error('Sign in did not complete. Please try again.');
      }
      let activityWarning = '';
      try {
        await recordPharmacySessionActivity('login');
      } catch (activityError) {
        activityWarning = activityError instanceof Error
          ? activityError.message
          : 'Could not record this login in the activity history.';
      }
      alert.alert(
        activityWarning ? 'Signed in with a warning' : 'Signed in',
        activityWarning || 'You are now signed in.',
        [{ text: 'Continue', onPress: () => router.replace('/dashboard') }],
      );
    } catch (error) {
      alert.alert(
        'Sign in failed',
        error instanceof Error ? error.message : 'Could not sign in. Please try again.',
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="YOUR WORKSPACE IS READY"
      title="Welcome back"
      subtitle="Sign in to continue to your pharmacy dashboard."
      footer={
        <View style={authStyles.linkRow}>
          <Text style={authStyles.linkText}>New to Pharmacy Cluster?</Text>
          <Pressable onPress={() => router.push('/Auth/signup')} accessibilityRole="link">
            <Text style={authStyles.linkAction}>Create an account</Text>
          </Pressable>
        </View>
      }>
      <View style={authStyles.form}>
        {authError || supabaseConfigError ? (
          <Text style={[authStyles.feedback, authStyles.errorFeedback]}>
            {authError || supabaseConfigError}
          </Text>
        ) : null}
        <AuthField
          label="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          editable={!isSubmitting}
        />
        <AuthField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void handleLogin()}
          editable={!isSubmitting}
        />
        <AuthSubmitButton
          title="Sign in"
          loadingTitle="Signing in…"
          isLoading={isSubmitting}
          onPress={() => void handleLogin()}
        />
      </View>
    </AuthScreen>
  );
}
