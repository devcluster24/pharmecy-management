import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform, StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardFooter from '@/components/dashboard/DashboardFooter';
import { AuthProvider } from '@/providers/AuthProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LanguageProvider>
        <AuthProvider>
          <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.content}>
              <Stack screenOptions={{ headerShown: false }} />
            </View>
            <DashboardFooter />
            <StatusBarBackground />
          </KeyboardAvoidingView>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function StatusBarBackground() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isGreenHeaderPage = pathname.startsWith('/dashboard')
    || [
      '/customer',
      '/expenses',
      '/invoice',
      '/purchase',
      '/recorded-payments',
      '/recorded-payments-history',
      '/reports',
      '/return',
      '/sales',
      '/supplier',
    ].includes(pathname);
  const backgroundColor = isGreenHeaderPage ? '#145642' : '#f4f8f5';
  const height = Math.max(
    insets.top,
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  );

  return (
    <>
      <StatusBar
        barStyle={isGreenHeaderPage ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundColor}
        translucent={Platform.OS === 'android'}
      />
      {height > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.statusBarBackground, { height, backgroundColor }]}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f8f5' },
  content: { flex: 1 },
  statusBarBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
  },
});
