import { supabase, supabaseConfigError } from '@/lib/supabase';
import { Text, TextInput, useLocalizedAlert, useTranslate } from '@/providers/LanguageProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

const RETURN_DEDUCTION_SETTINGS_KEY = 'pharmacy-return-deduction-settings-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function ReturnDeductionSettingsScreen() {
  const { alert } = useLocalizedAlert();
  const t = useTranslate();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [rate, setRate] = useState('0');
  const [savedRate, setSavedRate] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;

    let active = true;
    const timer = setTimeout(() => {
      async function loadRate() {
        setIsLoading(true);
        setError('');
        try {
          if (dashboardRole !== 'owner' || !session) {
            throw new Error('Return settings are available to store owners.');
          }
          if (!supabase) throw new Error(supabaseConfigError);

          const { data, error: loadError } = await supabase
            .from('pharmacy_app_data')
            .select('payload')
            .eq('owner_user_id', session.user.id)
            .eq('data_key', RETURN_DEDUCTION_SETTINGS_KEY)
            .maybeSingle();
          if (loadError) throw loadError;

          const payload = data?.payload;
          if (payload === null || payload === undefined) {
            if (active) {
              setRate('0');
              setSavedRate(0);
            }
            return;
          }
          if (!isRecord(payload)
            || typeof payload.defaultRate !== 'number'
            || !Number.isFinite(payload.defaultRate)
            || payload.defaultRate < 0
            || payload.defaultRate > 100) {
            throw new Error('Saved return deduction settings are invalid. Update the rate in Settings.');
          }
          if (active) {
            setRate(String(payload.defaultRate));
            setSavedRate(payload.defaultRate);
          }
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load return deduction settings.');
        } finally {
          if (active) setIsLoading(false);
        }
      }

      void loadRate();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dashboardRole, isAuthLoading, profileLoading, session]);

  async function saveRate() {
    const value = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      const message = t('Enter a return deduction rate between 0 and 100%.');
      setError(message);
      alert('Check your input', message);
      setMessage('');
      return;
    }
    if (dashboardRole !== 'owner' || !session) {
      const message = t('Return settings are available to store owners.');
      setError(message);
      alert('Error', message);
      setMessage('');
      return;
    }
    if (!supabase) {
      setError(supabaseConfigError);
      alert('Error', supabaseConfigError);
      setMessage('');
      return;
    }

    const normalizedRate = Number(value.toFixed(2));
    const payload = { defaultRate: normalizedRate };
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const client = supabase;
      const ownerId = session.user.id;
      const existing = await client.from('pharmacy_app_data')
        .select('data_key')
        .eq('owner_user_id', ownerId)
        .eq('data_key', RETURN_DEDUCTION_SETTINGS_KEY)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const now = new Date().toISOString();
      const result = existing.data
        ? await client.from('pharmacy_app_data')
          .update({ payload, updated_at: now })
          .eq('owner_user_id', ownerId)
          .eq('data_key', RETURN_DEDUCTION_SETTINGS_KEY)
          .select('data_key')
          .maybeSingle()
        : await client.from('pharmacy_app_data')
          .insert({
            owner_user_id: ownerId,
            data_key: RETURN_DEDUCTION_SETTINGS_KEY,
            payload,
            updated_at: now,
          })
          .select('data_key')
          .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Could not save the return deduction rate. Please try again.');

      setRate(String(normalizedRate));
      setSavedRate(normalizedRate);
      const message = t('Return deduction rate saved.');
      setMessage(message);
      alert('Success', message);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t('Could not save the return deduction rate.');
      setError(message);
      alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('Return System')}</Text>
        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#17664f" />
            <Text style={styles.helperText}>{t('Loading return settings…')}</Text>
          </View>
        ) : dashboardRole === 'owner' ? (
          <>
            <View style={styles.card}>
              <View style={styles.rateRow}>
                <Text style={styles.label}>{t('Return Deduction %')}</Text>
                <TextInput
                  accessibilityLabel={t('Return Deduction %')}
                  keyboardType="decimal-pad"
                  onChangeText={(value) => {
                    if (!/^\d*\.?\d*$/.test(value)) return;
                    const parsedRate = Number(value);
                    if (value !== '' && parsedRate > 100) {
                      setRate('100');
                      setMessage('');
                      setError('');
                      return;
                    }
                    setRate(value);
                    setMessage('');
                    setError('');
                  }}
                  value={rate}
                  style={styles.input}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void saveRate()}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, isSaving && styles.disabled]}>
                {isSaving ? <ActivityIndicator color="#fff" size="small" /> : null}
                <Text style={styles.saveButtonText}>{isSaving ? t('Saving…') : t('Save')}</Text>
              </Pressable>
            </View>

            <View style={styles.savedCard}>
              <Text style={styles.savedTitle}>{t('Saved Return Deduction')}</Text>
              <Text style={styles.savedRate}>{savedRate}%</Text>
            </View>
            {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error)}</Text> : null}
          </>
        ) : (
          <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error || 'Return settings are available to store owners.')}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: 12,
    padding: 18,
  },
  title: {
    color: '#183c31',
    fontSize: 19,
    fontWeight: '800',
  },
  card: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    flex: 1,
    color: '#34453b',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    width: 120,
    minHeight: 42,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 14,
    textAlign: 'right',
  },
  saveButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  savedCard: {
    minHeight: 78,
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  savedTitle: {
    color: '#16845f',
    fontSize: 13,
    fontWeight: '800',
  },
  savedRate: {
    color: '#26352f',
    fontSize: 16,
    fontWeight: '700',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 18,
  },
  helperText: {
    color: '#687871',
    fontSize: 12,
  },
  successMessage: {
    color: '#16845f',
    fontSize: 13,
  },
  errorMessage: {
    color: '#b34b43',
    fontSize: 13,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.6,
  },
});
