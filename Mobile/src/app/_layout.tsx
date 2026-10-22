import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { KeyboardAvoidingView, Platform, StatusBar, useColorScheme } from 'react-native';

import { AuthProvider } from '@/providers/AuthProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LanguageProvider>
        <AuthProvider>
          <StatusBar barStyle="light-content" backgroundColor="#145642" />
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack screenOptions={{ headerShown: false }} />
          </KeyboardAvoidingView>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
