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
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export default function SignupScreen() {
  const alert = useLocalizedAlert();
  const router = useRouter();
  const { session, isLoading, authError } = useAuth();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) return null;
  if (session) return <Redirect href="/dashboard" />;

  async function handleSignup() {
    Keyboard.dismiss();
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = fullName.trim();
    const trimmedUsername = username.trim();
    if (!trimmedName || !trimmedUsername || !normalizedEmail || !password) {
      alert.alert('Missing details', 'Complete your name, username, email, and password.');
      return;
    }
    if (trimmedUsername.length < 3) {
      alert.alert('Invalid username', 'Username must be at least 3 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      alert.alert('Password too short', 'Password must be at least 8 characters.');
      return;
    }
    if (!supabase) {
      alert.alert('Sign up unavailable', supabaseConfigError);
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            username: trimmedUsername,
            full_name: trimmedName,
            phone: phone.trim(),
            registration_type: 'pharmacy_user',
          },
        },
      });
      if (error) throw error;

      if (data.session && data.user) {
        router.replace('/dashboard');
        return;
      }

      alert.alert('Account created', 'Check your email to confirm your account, then sign in to continue.');
      setFullName('');
      setUsername('');
      setEmail('');
      setPhone('');
      setPassword('');
    } catch (error) {
      alert.alert(
        'Sign up failed',
        error instanceof Error ? error.message : 'Could not create your account.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="CREATE YOUR ACCOUNT"
      title="Start with your details"
      subtitle="Create an account for your pharmacy workspace."
      footer={
        <View style={authStyles.linkRow}>
          <Text style={authStyles.linkText}>Already have an account?</Text>
          <Pressable onPress={() => router.replace('/Auth/login')} accessibilityRole="link">
            <Text style={authStyles.linkAction}>Sign in</Text>
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
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          editable={!isSubmitting}
        />
        <AuthField
          label="Username"
          value={username}
          onChangeText={setUsername}
          placeholder="yourname"
          autoCapitalize="none"
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          editable={!isSubmitting}
        />
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
          label="Phone (optional)"
          value={phone}
          onChangeText={setPhone}
          placeholder="+880 1XXX-XXXXXX"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
          editable={!isSubmitting}
        />
        <AuthField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void handleSignup()}
          editable={!isSubmitting}
        />
        <AuthSubmitButton
          title="Create account"
          loadingTitle="Creating account…"
          isLoading={isSubmitting}
          onPress={() => void handleSignup()}
        />
      </View>
    </AuthScreen>
  );
}
