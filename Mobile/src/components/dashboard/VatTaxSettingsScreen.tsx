import { supabase, supabaseConfigError } from '@/lib/supabase';
import { Text, TextInput, useLocalizedAlert, useTranslate } from '@/providers/LanguageProvider';
import { useAuth } from '@/providers/AuthProvider';
import { hasDashboardPageAccess } from '@/lib/dashboard-access';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

const VAT_TAX_SETTINGS_KEY = 'pharmacy-vat-tax-settings-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function VatTaxSettingsScreen() {
  const { alert } = useLocalizedAlert();
  const t = useTranslate();
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
    pharmacyOwnerId,
    staffPermissions,
  } = useAuth();
  const hasSettingsAccess = hasDashboardPageAccess(dashboardRole, staffPermissions, 'settings');
  const [rate, setRate] = useState('0');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;

    let active = true;
    const timer = setTimeout(() => {
      async function loadSettings() {
        setIsLoading(true);
        setError('');
        try {
          if (!hasSettingsAccess || !session || !pharmacyOwnerId) {
            throw new Error('Settings access has not been enabled by your owner.');
          }
          if (!supabase) throw new Error(supabaseConfigError);

          const { data, error: loadError } = await supabase
            .from('pharmacy_app_data')
            .select('payload')
            .eq('owner_user_id', pharmacyOwnerId)
            .eq('data_key', VAT_TAX_SETTINGS_KEY)
            .maybeSingle();
          if (loadError) throw loadError;

          const payload = data?.payload;
          if (payload === null || payload === undefined) {
            if (active) setRate('0');
            return;
          }
          if (!isRecord(payload)
            || typeof payload.defaultRate !== 'number'
            || !Number.isFinite(payload.defaultRate)
            || payload.defaultRate < 0
            || payload.defaultRate > 100) {
            throw new Error('Saved VAT/TAX settings are invalid. Update the VAT/TAX rate in Settings.');
          }
          if (active) setRate(String(payload.defaultRate));
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load VAT/TAX settings.');
        } finally {
          if (active) setIsLoading(false);
        }
      }

      void loadSettings();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dashboardRole, hasSettingsAccess, isAuthLoading, pharmacyOwnerId, profileLoading, session]);

  async function saveRate() {
    const value = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      const message = t('VAT/TAX must be between 0 and 100%.');
      setError(message);
      alert('Check your input', message);
      setMessage('');
      return;
    }
    if (!hasSettingsAccess || !session || !pharmacyOwnerId) {
      const message = t('Settings access has not been enabled by your owner.');
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
      const ownerId = pharmacyOwnerId;
      const existing = await client.from('pharmacy_app_data')
        .select('data_key')
        .eq('owner_user_id', ownerId)
        .eq('data_key', VAT_TAX_SETTINGS_KEY)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const now = new Date().toISOString();
      const result = existing.data
        ? await client.from('pharmacy_app_data')
          .update({ payload, updated_at: now })
          .eq('owner_user_id', ownerId)
          .eq('data_key', VAT_TAX_SETTINGS_KEY)
          .select('data_key')
          .maybeSingle()
        : await client.from('pharmacy_app_data')
          .insert({
            owner_user_id: ownerId,
            data_key: VAT_TAX_SETTINGS_KEY,
            payload,
            updated_at: now,
          })
          .select('data_key')
          .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Could not save VAT/TAX settings. Please try again.');

      setRate(String(normalizedRate));
      const message = t('Default VAT/TAX rate saved.');
      setMessage(message);
      alert('Success', message);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t('Could not save VAT/TAX settings.');
      setError(message);
      alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('VAT/TAX setup')}</Text>
        <Text style={styles.description}>
          {t('The default is 0% until you set it. Applicable VAT and supplementary-duty rates depend on product classification and current NBR rules; confirm the correct rate for your products before applying it. You can change the rate on each sale.')}
        </Text>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#17664f" />
            <Text style={styles.helperText}>{t('Loading VAT/TAX settings…')}</Text>
          </View>
        ) : hasSettingsAccess ? (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{t('Default VAT/TAX rate (%)')}</Text>
              <TextInput
                accessibilityLabel={t('Default VAT/TAX rate (%)')}
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setRate(value);
                  setMessage('');
                  setError('');
                }}
                placeholder="0"
                value={rate}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void saveRate()}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, isSaving && styles.disabled]}>
                {isSaving ? <ActivityIndicator color="#fff" size="small" /> : null}
                <Text style={styles.saveButtonText}>{isSaving ? t('Saving…') : t('Save')}</Text>
              </Pressable>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>{t('Per-sale adjustment')}</Text>
              <Text style={styles.helperText}>
                {t('The saved rate is stored in this pharmacy’s Supabase account and prefilled for new sales on authorized devices. A cashier can adjust it for an individual sale without changing this default.')}
              </Text>
            </View>
            {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error)}</Text> : null}
          </>
        ) : (
          <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error || 'VAT/TAX settings are available to store owners.')}</Text>
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
  description: {
    color: '#687871',
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    gap: 11,
    marginTop: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  label: {
    color: '#34453b',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 14,
  },
  saveButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  infoCard: {
    gap: 8,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  infoTitle: {
    color: '#16845f',
    fontSize: 14,
    fontWeight: '800',
  },
  helperText: {
    color: '#687871',
    fontSize: 12,
    lineHeight: 18,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 18,
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
