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
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);

  if (isLoading) return null;
  if (session && !hasAttemptedLogin) return <Redirect href="/dashboard" />;

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
    setHasAttemptedLogin(true);
    let hasAuthenticated = false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      if (!data.session || !data.user) {
        throw new Error('Sign in did not complete. Please try again.');
      }
      hasAuthenticated = true;

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role, approval_status')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error('Your account profile could not be found.');

      if (profile.role === 'pharmacy_staff' && profile.approval_status !== 'approved') {
        const title = profile.approval_status === 'suspended'
          ? 'Staff account inactive'
          : profile.approval_status === 'rejected'
            ? 'Staff account not approved'
            : 'Staff approval pending';
        const notice = profile.approval_status === 'suspended'
          ? 'Your pharmacy owner has marked your staff account as inactive. Contact them to restore access.'
          : profile.approval_status === 'rejected'
            ? 'Your staff application was not approved. Contact your pharmacy owner.'
            : 'Your staff account is waiting for approval from your pharmacy owner.';
        const { error: signOutError } = await supabase.auth.signOut();
        if (!signOutError) hasAuthenticated = false;
        alert.alert(
          title,
          signOutError ? `${notice}\n\nSign out failed: ${signOutError.message}` : notice,
        );
        setIsSubmitting(false);
        return;
      }

      let activityWarning = '';
      try {
        await recordPharmacySessionActivity('login');
      } catch (activityError) {
        activityWarning = activityError instanceof Error
          ? activityError.message
          : 'Could not record this login in the activity history.';
      }
      if (activityWarning) {
        alert.alert('Signed in with a warning', activityWarning);
      }
      router.replace('/dashboard');
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Could not sign in. Please try again.';
      if (hasAuthenticated) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) message += ` Sign out failed: ${signOutError.message}`;
      }
      alert.alert(
        'Sign in failed',
        message,
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
