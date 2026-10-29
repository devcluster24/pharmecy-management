import { Text, useLanguage, useLocalizedAlert } from '@/providers/LanguageProvider';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

type BackupHistory = {
  id: string;
  created_at: string;
  details: string[];
  status: 'Success' | 'Partial' | 'Failed';
  message: string;
};

type BackupSettings = {
  connected: boolean;
  autoBackupEnabled: boolean;
  intervalDays: number;
  productManagementBackedUp: boolean;
  history: BackupHistory[];
};

type Schedule = 'daily' | 'weekly' | 'monthly' | 'custom';

const initialSettings: BackupSettings = {
  connected: false,
  autoBackupEnabled: false,
  intervalDays: 1,
  productManagementBackedUp: false,
  history: [],
};

const webAppUrl = process.env.EXPO_PUBLIC_WEB_APP_URL?.replace(/\/+$/, '');

async function getAccessToken() {
  if (!supabase) throw new Error(supabaseConfigError);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Sign in again to manage Google Drive backups.');
  return data.session.access_token;
}

async function getError(response: Response) {
  const payload: unknown = await response.json();
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return 'Backup request failed.';
}

export default function BackupSettingsScreen() {
  const { alert: showAlert } = useLocalizedAlert();
  const { language } = useLanguage();
  const isBengali = language === 'bn';
  const query = useLocalSearchParams<{ backup_oauth?: string; backup_message?: string }>();
  const [settings, setSettings] = useState(initialSettings);
  const [schedule, setSchedule] = useState<Schedule>('daily');
  const [customDays, setCustomDays] = useState('5');
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadSettings = useCallback(async () => {
    if (!webAppUrl) throw new Error('Set EXPO_PUBLIC_WEB_APP_URL to the deployed web app URL in Mobile/.env.local.');
    const token = await getAccessToken();
    const response = await fetch(`${webAppUrl}/api/backup/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(await getError(response));
    const loaded = await response.json() as BackupSettings;
    setSettings(loaded);
    setSchedule(loaded.intervalDays === 1
      ? 'daily'
      : loaded.intervalDays === 7
        ? 'weekly'
        : loaded.intervalDays === 30
          ? 'monthly'
          : 'custom');
    if (![1, 7, 30].includes(loaded.intervalDays)) setCustomDays(String(loaded.intervalDays));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const oauthStatus = Array.isArray(query.backup_oauth) ? query.backup_oauth[0] : query.backup_oauth;
    const oauthMessage = Array.isArray(query.backup_message) ? query.backup_message[0] : query.backup_message;
    const timer = setTimeout(() => {
      void loadSettings()
        .then(() => {
          if (cancelled) return;
          if (oauthStatus === 'connected') {
            const message = isBengali ? 'Google Drive সংযুক্ত হয়েছে।' : 'Google Drive connected successfully.';
            setMessage(message);
            showAlert('Success', message);
          }
          if (oauthStatus === 'error') {
            const message = oauthMessage || (isBengali ? 'Google Drive সংযোগ করা যায়নি।' : 'Google Drive could not be connected.');
            setError(message);
            showAlert('Error', message);
          }
        })
        .catch((loadError: unknown) => {
          if (cancelled) return;
          setError(loadError instanceof Error ? loadError.message : 'Could not load backup settings.');
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isBengali, loadSettings, query.backup_message, query.backup_oauth, showAlert]);

  async function connectGoogleDrive() {
    setIsConnecting(true);
    setError('');
    setMessage('');
    try {
      if (!webAppUrl) throw new Error('Set EXPO_PUBLIC_WEB_APP_URL to the deployed web app URL in Mobile/.env.local.');
      const token = await getAccessToken();
      const redirectTo = Linking.createURL('dashboard/menu/backup-file', { scheme: 'mobile' });
      const response = await fetch(`${webAppUrl}/api/backup/google/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ returnUrl: redirectTo }),
      });
      if (!response.ok) throw new Error(await getError(response));
      const result = await response.json() as { authorizationUrl?: string };
      if (!result.authorizationUrl) throw new Error('Google did not provide an authorization page.');
      const authResult = await WebBrowser.openAuthSessionAsync(result.authorizationUrl, redirectTo);
      if (authResult.type === 'success' && authResult.url) {
        const callback = Linking.parse(authResult.url);
        const query = callback.queryParams ?? {};
        if (query.backup_oauth === 'error') {
          const callbackError = typeof query.backup_message === 'string' ? query.backup_message : '';
          throw new Error(callbackError || 'Google Drive could not be connected.');
        }
        await loadSettings();
        const message = isBengali ? 'Google Drive সংযুক্ত হয়েছে।' : 'Google Drive connected successfully.';
        setMessage(message);
        showAlert('Success', message);
      }
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : 'Could not start Google Drive connection.';
      setError(message);
      showAlert('Error', message);
    } finally {
      setIsConnecting(false);
    }
  }

  function getIntervalDays() {
    return schedule === 'daily' ? 1
      : schedule === 'weekly' ? 7
        : schedule === 'monthly' ? 30
          : Number(customDays);
  }

  async function saveAutoBackup(enabled: boolean) {
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      if (!webAppUrl) throw new Error('Set EXPO_PUBLIC_WEB_APP_URL to the deployed web app URL in Mobile/.env.local.');
      const intervalDays = getIntervalDays();
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
        throw new Error(isBengali ? 'দিনের সংখ্যা ১ থেকে ৩৬৫০-এর মধ্যে হতে হবে।' : 'Custom interval must be between 1 and 3650 days.');
      }
      const token = await getAccessToken();
      const response = await fetch(`${webAppUrl}/api/backup/settings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ autoBackupEnabled: enabled, intervalDays }),
      });
      if (!response.ok) throw new Error(await getError(response));
      setSettings((current) => ({ ...current, autoBackupEnabled: enabled, intervalDays }));
      const message = enabled
        ? (isBengali ? 'স্বয়ংক্রিয় ব্যাকআপ চালু হয়েছে।' : 'Auto Backup is enabled.')
        : (isBengali ? 'স্বয়ংক্রিয় ব্যাকআপ বন্ধ হয়েছে।' : 'Auto Backup is disabled.');
      setMessage(message);
      showAlert('Success', message);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save Auto Backup settings.';
      setError(message);
      showAlert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function runBackup() {
    setIsBackingUp(true);
    setError('');
    setMessage('');
    try {
      if (!webAppUrl) throw new Error('Set EXPO_PUBLIC_WEB_APP_URL to the deployed web app URL in Mobile/.env.local.');
      const token = await getAccessToken();
      const response = await fetch(`${webAppUrl}/api/backup/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const responseMessage = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
          ? data.message
          : data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Backup failed.';
        throw new Error(responseMessage);
      }
      if (!data || typeof data !== 'object') throw new Error('Backup service returned an invalid response.');
      const result = data as { status?: string; message?: string };
      if (result.status === 'Failed' || result.status === 'Skipped') throw new Error(result.message || 'Backup failed.');
      const message = result.status === 'Partial'
        ? (isBengali ? 'কিছু ফাইল বাদ পড়েছে; ব্যাকআপ ইতিহাস দেখুন।' : 'Backup completed with some files missing; see the history.')
        : (isBengali ? 'ব্যাকআপ Google Drive-এ সংরক্ষিত হয়েছে।' : 'Backup completed and saved to Google Drive.');
      setMessage(message);
      showAlert(result.status === 'Partial' ? 'Backup completed with a warning' : 'Success', message);
      await loadSettings();
    } catch (backupError) {
      const message = backupError instanceof Error ? backupError.message : 'Could not create the Drive backup.';
      setError(message);
      showAlert('Error', message);
    } finally {
      setIsBackingUp(false);
    }
  }

  const selectedDays = getIntervalDays();
  const busy = isLoading || isSaving || isBackingUp;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <Text style={styles.title}>{isBengali ? 'BackUp Setting' : 'BackUp Setting'}</Text>
        <Text style={styles.description}>
          {isBengali
            ? 'Google Drive সংযুক্ত করে ড্যাশবোর্ডের Excel ফাইলগুলো ব্যাকআপ করুন। পরবর্তী ব্যাকআপ একই ফোল্ডারে সংরক্ষিত হবে।'
            : 'Connect Google Drive to back up dashboard Excel exports. Later backups are saved in the same folder.'}
        </Text>
      </View>

      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          disabled={isConnecting || isLoading}
          onPress={() => void connectGoogleDrive()}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, (isConnecting || isLoading) && styles.disabled]}>
          {isConnecting ? <ActivityIndicator color="#17664f" /> : null}
          <Text style={styles.secondaryButtonText}>
            {isConnecting
              ? (isBengali ? 'সংযোগ হচ্ছে…' : 'Connecting…')
              : settings.connected
                ? (isBengali ? 'Google Drive পুনরায় সংযোগ করুন' : 'Reconnect Google Drive')
                : (isBengali ? 'Google দিয়ে লগইন করুন' : 'Login with Google')}
          </Text>
        </Pressable>
        <Text style={[styles.connectionStatus, settings.connected && styles.successText]}>
          {isLoading
            ? (isBengali ? 'সেটিংস লোড হচ্ছে…' : 'Loading backup settings…')
            : settings.connected
              ? (isBengali ? 'Google Drive সংযুক্ত' : 'Google Drive connected')
              : (isBengali ? 'Google Drive সংযুক্ত নয়' : 'Google Drive is not connected')}
        </Text>
      </View>

      {settings.connected ? (
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void runBackup()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}>
            {isBackingUp ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.primaryButtonText}>
              {isBackingUp ? (isBengali ? 'ব্যাকআপ হচ্ছে…' : 'Backing up…') : 'BackUp'}
            </Text>
          </Pressable>

          <Text style={styles.fieldLabel}>{isBengali ? 'স্বয়ংক্রিয় ব্যাকআপের সময়' : 'Auto Backup interval'}</Text>
          <View style={styles.scheduleOptions}>
            {([
              { value: 'daily', en: 'Daily', bn: 'প্রতিদিন' },
              { value: 'weekly', en: '7 days', bn: '৭ দিন' },
              { value: 'monthly', en: '30 days', bn: '৩০ দিন' },
              { value: 'custom', en: 'Custom', bn: 'নিজস্ব' },
            ] as const).map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: schedule === option.value }}
                onPress={() => setSchedule(option.value)}
                style={[styles.scheduleOption, schedule === option.value && styles.scheduleOptionSelected]}>
                <Text style={[styles.scheduleOptionText, schedule === option.value && styles.scheduleOptionTextSelected]}>
                  {isBengali ? option.bn : option.en}
                </Text>
              </Pressable>
            ))}
          </View>

          {schedule === 'custom' ? (
            <View style={styles.customDaysField}>
              <Text style={styles.fieldLabel}>{isBengali ? 'কত দিন পরপর' : 'Repeat every (days)'}</Text>
              <TextInput
                accessibilityLabel={isBengali ? 'দিনের ব্যবধান' : 'Repeat interval in days'}
                keyboardType="number-pad"
                maxLength={4}
                onChangeText={setCustomDays}
                value={customDays}
                style={styles.daysInput}
              />
            </View>
          ) : null}

          <View style={styles.autoBackupRow}>
            <View style={styles.autoBackupCopy}>
              <Text style={styles.fieldLabel}>{isBengali ? 'স্বয়ংক্রিয় ব্যাকআপ' : 'Auto Backup'}</Text>
              <Text style={styles.helperText}>
                {isBengali ? `প্রতি ${selectedDays} দিন পর সার্ভার থেকে ব্যাকআপ চলবে।` : `Runs on the server every ${selectedDays} day(s), even when the app is closed.`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: settings.autoBackupEnabled, disabled: busy }}
              disabled={busy}
              onPress={() => void saveAutoBackup(!settings.autoBackupEnabled)}
              style={[styles.toggle, settings.autoBackupEnabled && styles.toggleOn, busy && styles.disabled]}>
              <View style={[styles.toggleThumb, settings.autoBackupEnabled && styles.toggleThumbOn]} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void saveAutoBackup(settings.autoBackupEnabled)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabled]}>
            <Text style={styles.secondaryButtonText}>{isBengali ? 'সময়সূচি সংরক্ষণ' : 'Save Schedule'}</Text>
          </Pressable>
          {settings.productManagementBackedUp ? (
            <Text style={styles.helperText}>
              {isBengali
                ? 'Product Management একবার ব্যাকআপ হয়েছে; পরেরবারগুলোতে বাদ থাকবে।'
                : 'Product Management has already been backed up once and will be skipped in future runs.'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.errorMessage}>{error}</Text> : null}

      <View style={styles.historyCard}>
        <Text style={styles.historyTitle}>{isBengali ? 'ব্যাকআপ ইতিহাস' : 'Backup History'}</Text>
        {isLoading ? (
          <View style={styles.emptyHistory}>
            <ActivityIndicator color="#17664f" />
          </View>
        ) : settings.history.length ? settings.history.map((entry) => (
          <View key={entry.id} style={styles.historyEntry}>
            <Text style={styles.historyDate}>{new Date(entry.created_at).toLocaleString(isBengali ? 'bn-BD' : 'en-US')}</Text>
            <Text style={styles.historyDetails}>{entry.details.join(', ') || entry.message || (isBengali ? 'কোনো ফাইল আপলোড হয়নি' : 'No files uploaded')}</Text>
            <Text style={[
              styles.historyStatus,
              entry.status === 'Success' ? styles.successText : entry.status === 'Partial' ? styles.partialText : styles.errorText,
            ]}>
              {entry.status}{entry.message ? ` · ${entry.message}` : ''}
            </Text>
          </View>
        )) : (
          <View style={styles.emptyHistory}>
            <Text style={styles.helperText}>{isBengali ? 'এখনও কোনো ব্যাকআপ নেই।' : 'No backups yet.'}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: 14,
    padding: 16,
    paddingBottom: 32,
  },
  intro: {
    gap: 6,
  },
  title: {
    color: '#183c31',
    fontSize: 20,
    fontWeight: '800',
  },
  description: {
    color: '#687871',
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  secondaryButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#cddbd2',
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#17664f',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  connectionStatus: {
    color: '#687871',
    fontSize: 12,
    textAlign: 'center',
  },
  successText: {
    color: '#17704e',
  },
  primaryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  fieldLabel: {
    color: '#34453b',
    fontSize: 13,
    fontWeight: '700',
  },
  scheduleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  scheduleOption: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  scheduleOptionSelected: {
    borderColor: '#17664f',
    backgroundColor: '#e8f3ec',
  },
  scheduleOptionText: {
    color: '#526159',
    fontSize: 12,
    fontWeight: '600',
  },
  scheduleOptionTextSelected: {
    color: '#17664f',
    fontWeight: '800',
  },
  customDaysField: {
    gap: 7,
  },
  daysInput: {
    width: 140,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 14,
  },
  autoBackupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  autoBackupCopy: {
    flex: 1,
    gap: 4,
  },
  helperText: {
    color: '#687871',
    fontSize: 12,
    lineHeight: 18,
  },
  toggle: {
    width: 50,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderRadius: 16,
    backgroundColor: '#9aa59e',
  },
  toggleOn: {
    backgroundColor: '#179c70',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.55,
  },
  successMessage: {
    color: '#17704e',
    fontSize: 13,
    lineHeight: 19,
  },
  errorMessage: {
    color: '#ad4b43',
    fontSize: 13,
    lineHeight: 19,
  },
  historyCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  historyTitle: {
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
    color: '#183c31',
    fontSize: 15,
    fontWeight: '800',
  },
  historyEntry: {
    gap: 5,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f0',
  },
  historyDate: {
    color: '#526159',
    fontSize: 12,
    fontWeight: '700',
  },
  historyDetails: {
    color: '#42524b',
    fontSize: 12,
    lineHeight: 18,
  },
  historyStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  partialText: {
    color: '#9b6412',
  },
  errorText: {
    color: '#ad4b43',
  },
  emptyHistory: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
});
