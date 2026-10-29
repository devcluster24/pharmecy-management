import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export default function StaffSignupScreen() {
  const { alert: showAlert } = useLocalizedAlert();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signupFinished, setSignupFinished] = useState(false);
  const [isCompletingGoogleSignup, setIsCompletingGoogleSignup] = useState(false);
  const hasHandledGoogleCallback = useRef(false);
  const linkingUrl = Linking.useLinkingURL();
  const signupClient = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        storageKey: `staff_signup_${token}`,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }, [token]);
  const isInvalidLink = !/^[a-f0-9]{64}$/i.test(token);
  const configError = signupClient ? '' : 'Supabase is not configured.';

  const finishGoogleSignup = useCallback(async (redirectUrl: string) => {
    if (!signupClient) throw new Error(configError);

    const callbackUrl = new URL(redirectUrl);
    const code = callbackUrl.searchParams.get('code');
    if (code) {
      const { error } = await signupClient.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const callbackParams = new URLSearchParams(callbackUrl.hash.slice(1));
      const accessToken = callbackParams.get('access_token');
      const refreshToken = callbackParams.get('refresh_token');
      if (!accessToken || !refreshToken) {
        throw new Error(callbackParams.get('error_description') ?? 'Google sign-in did not complete. Please try again.');
      }
      const { error } = await signupClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }

    const { error: signupError } = await signupClient.rpc('complete_pharmacy_staff_oauth_signup', {
      requested_invite_token: token,
    });
    if (signupError) throw signupError;

    const { error: signOutError } = await signupClient.auth.signOut();
    setSignupFinished(true);
    if (signOutError) {
      setHasError(true);
      const message = `Staff account created, but sign out failed: ${signOutError.message}`;
      setMessage(message);
      showAlert('Account created with a warning', message);
      return;
    }
    const message = 'Google signup complete. Your pharmacy owner must approve your account and assign dashboard access before you can sign in.';
    setMessage(message);
    showAlert('Staff signup complete', message);
  }, [configError, showAlert, signupClient, token]);

  useEffect(() => {
    if (
      hasHandledGoogleCallback.current
      || isInvalidLink
      || !signupClient
      || !/^[a-f0-9]{64}$/i.test(token)
    ) {
      return;
    }

    if (!linkingUrl) return;
    const callbackUrl = new URL(linkingUrl);
    if (callbackUrl.searchParams.get('staff_google') !== '1') return;
    hasHandledGoogleCallback.current = true;

    const timeout = setTimeout(() => {
      setIsCompletingGoogleSignup(true);
      setMessage('');
      setHasError(false);
      void finishGoogleSignup(linkingUrl)
        .catch(async (error: unknown) => {
          const initialErrorMessage = getErrorMessage(error);
          const { error: signOutError } = await signupClient.auth.signOut();
          setHasError(true);
          const message = signOutError
            ? `${initialErrorMessage} Sign out also failed: ${signOutError.message}`
            : initialErrorMessage;
          setMessage(message);
          showAlert('Google signup failed', message);
        })
        .finally(() => setIsCompletingGoogleSignup(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [token, signupClient, isInvalidLink, linkingUrl, finishGoogleSignup, showAlert]);

  async function handleSignup() {
    Keyboard.dismiss();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      showAlert('Missing details', 'Enter your email and password.');
      setHasError(true);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      showAlert('Invalid email', 'Enter a valid email address.');
      setHasError(true);
      return;
    }
    if (password.length < 8) {
      showAlert('Password too short', 'Password must be at least 8 characters.');
      setHasError(true);
      return;
    }
    if (!signupClient) {
      showAlert('Sign up unavailable', configError);
      setHasError(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await signupClient.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            registration_type: 'pharmacy_staff',
            staff_invite_token: token,
          },
        },
      });
      if (error) throw error;

      setSignupFinished(true);
      if (data.session) {
        const { error: signOutError } = await signupClient.auth.signOut();
        if (signOutError) throw signOutError;
        const message = 'Staff application submitted. Your pharmacy owner must approve it and assign dashboard access before you can sign in.';
        setMessage(message);
        showAlert('Staff application submitted', message);
      } else {
        const message = 'Check your email to confirm your staff application. Your pharmacy owner must approve it and assign dashboard access before you can sign in.';
        setMessage(message);
        showAlert('Staff application submitted', message);
      }
    } catch (signupError) {
      setHasError(true);
      const errorMessage = getErrorMessage(signupError);
      setMessage(errorMessage);
      showAlert('Staff signup failed', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    if (!signupClient) {
      showAlert('Sign up unavailable', configError);
      setHasError(true);
      return;
    }

    setIsSubmitting(true);
    setMessage('');
    setHasError(false);
    try {
      const redirectTo = Linking.createURL(`staff-signup/${token}`, {
        queryParams: { staff_google: '1' },
      });
      const { data, error } = await signupClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('Could not start Google signup.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;
      if (hasHandledGoogleCallback.current) return;
      hasHandledGoogleCallback.current = true;
      setIsCompletingGoogleSignup(true);
      await finishGoogleSignup(result.url);
    } catch (signupError) {
      const initialErrorMessage = getErrorMessage(signupError);
      const { error: signOutError } = await signupClient.auth.signOut();
      setHasError(true);
      const errorMessage = signOutError
        ? `${initialErrorMessage} Sign out also failed: ${signOutError.message}`
        : initialErrorMessage;
      setMessage(errorMessage);
      showAlert('Google signup failed', errorMessage);
    } finally {
      setIsSubmitting(false);
      setIsCompletingGoogleSignup(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="STAFF INVITATION"
      title="Create staff account"
      subtitle="Sign up using your email and a password, or continue with Google. Your pharmacy owner shared this private invitation link with you."
      footer={
        <View style={authStyles.linkRow}>
          <Text style={authStyles.linkText}>Already have an account?</Text>
          <Pressable onPress={() => router.replace('/Auth/login')} accessibilityRole="link">
            <Text style={authStyles.linkAction}>Sign in</Text>
          </Pressable>
        </View>
      }>
      <View style={authStyles.form}>
        {configError ? (
          <Text style={[authStyles.feedback, authStyles.errorFeedback]}>{configError}</Text>
        ) : null}
        {isInvalidLink ? (
          <Text style={[authStyles.feedback, authStyles.errorFeedback]}>
            This staff signup link is invalid. Ask your pharmacy owner to create a new one.
          </Text>
        ) : isCompletingGoogleSignup ? (
          <Text style={[authStyles.feedback, authStyles.successFeedback]}>
            Finishing Google signup…
          </Text>
        ) : signupFinished ? (
          <Text style={[authStyles.feedback, hasError ? authStyles.errorFeedback : authStyles.successFeedback]}>
            {message}
          </Text>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || isCompletingGoogleSignup}
              onPress={() => void handleGoogleSignup()}
              style={({ pressed }) => [
                {
                  minHeight: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: '#dfe4e2',
                  borderRadius: 12,
                  backgroundColor: '#fff',
                  opacity: pressed || isSubmitting ? 0.75 : 1,
                },
              ]}>
              <Text style={{ color: '#183c31', fontSize: 14, fontWeight: '700' }}>
                {isSubmitting ? 'Please wait…' : 'Continue with Google'}
              </Text>
            </Pressable>
            <View style={authStyles.linkRow}>
              <Text style={authStyles.linkText}>— or sign up with email —</Text>
            </View>
            <AuthField
              label="Email"
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
              placeholder="At least 8 characters"
              secure
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void handleSignup()}
              editable={!isSubmitting}
            />
            {message ? (
              <Text style={[authStyles.feedback, hasError ? authStyles.errorFeedback : authStyles.successFeedback]}>
                {message}
              </Text>
            ) : null}
            <AuthSubmitButton
              title="Create staff account"
              loadingTitle="Creating account…"
              isLoading={isSubmitting}
              onPress={() => void handleSignup()}
            />
          </>
        )}
      </View>
    </AuthScreen>
  );
}
