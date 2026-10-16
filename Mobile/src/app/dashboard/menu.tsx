import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase, supabaseConfigError } from '@/lib/supabase';

export default function MenuScreen() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleLogout() {
    if (!supabase) {
      setErrorMessage(supabaseConfigError);
      return;
    }

    setIsSigningOut(true);
    setErrorMessage('');

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace('/Auth/login');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not log out. Please try again.');
      setIsSigningOut(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PHARMACY CLUSTER</Text>
        <Text style={styles.title}>Menu</Text>
        <Text style={styles.subtitle}>Manage your account session.</Text>

        {errorMessage ? <Text style={styles.errorMessage}>{errorMessage}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isSigningOut}
          onPress={() => void handleLogout()}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && !isSigningOut && styles.logoutButtonPressed,
            isSigningOut && styles.logoutButtonDisabled,
          ]}>
          <Text style={styles.logoutButtonText}>
            {isSigningOut ? 'Logging out…' : 'Logout'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f2f4ef',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: 24,
    borderWidth: 1,
    borderColor: '#e7ebe3',
    borderRadius: 22,
    backgroundColor: '#fffefa',
  },
  eyebrow: {
    color: '#47826b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 10,
    color: '#183c31',
    fontSize: 25,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 7,
    marginBottom: 22,
    color: '#69766f',
    fontSize: 14,
  },
  errorMessage: {
    marginBottom: 14,
    color: '#a63e34',
    fontSize: 13,
    lineHeight: 19,
  },
  logoutButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#c8f36c',
  },
  logoutButtonPressed: {
    opacity: 0.82,
  },
  logoutButtonDisabled: {
    opacity: 0.65,
  },
  logoutButtonText: {
    color: '#173c2c',
    fontSize: 14,
    fontWeight: '800',
  },
});
