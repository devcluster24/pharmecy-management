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

const LOW_STOCK_THRESHOLD_KEY = 'pharmacy-low-stock-threshold-v1';

export default function InventorySettingsScreen() {
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
  const [threshold, setThreshold] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;

    let active = true;
    const timer = setTimeout(() => {
      async function loadThreshold() {
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
            .eq('data_key', LOW_STOCK_THRESHOLD_KEY)
            .maybeSingle();
          if (loadError) throw loadError;
          const savedThreshold = data?.payload;
          if (savedThreshold !== null && savedThreshold !== undefined) {
            if (typeof savedThreshold !== 'number' && typeof savedThreshold !== 'string') {
              throw new Error('Saved low stock threshold has an invalid format.');
            }
            setThreshold(String(savedThreshold));
          } else {
            setThreshold('');
          }
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load the low stock setting.');
        } finally {
          if (active) setIsLoading(false);
        }
      }

      void loadThreshold();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dashboardRole, hasSettingsAccess, isAuthLoading, pharmacyOwnerId, profileLoading, session]);

  async function saveThreshold() {
    const value = Number(threshold);
    if (threshold.trim() === '' || !Number.isInteger(value) || value < 0) {
      const message = t('Enter a whole number equal to or greater than 0.');
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

    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const client = supabase;
      const ownerId = pharmacyOwnerId;
      const existing = await client.from('pharmacy_app_data')
        .select('data_key')
        .eq('owner_user_id', ownerId)
        .eq('data_key', LOW_STOCK_THRESHOLD_KEY)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const now = new Date().toISOString();
      const result = existing.data
        ? await client.from('pharmacy_app_data')
          .update({ payload: String(value), updated_at: now })
          .eq('owner_user_id', ownerId)
          .eq('data_key', LOW_STOCK_THRESHOLD_KEY)
          .select('data_key')
          .maybeSingle()
        : await client.from('pharmacy_app_data')
          .insert({
            owner_user_id: ownerId,
            data_key: LOW_STOCK_THRESHOLD_KEY,
            payload: String(value),
            updated_at: now,
          })
          .select('data_key')
          .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Could not save the low stock setting. Please try again.');

      setThreshold(String(value));
      const message = t('Low stock threshold saved.');
      setMessage(message);
      alert('Success', message);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t('Could not save the low stock setting.');
      setError(message);
      alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  const parsedThreshold = Number(threshold);
  const isEnabled = threshold.trim() !== ''
    && Number.isInteger(parsedThreshold)
    && parsedThreshold > 0;

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('Low Stock Management')}</Text>
        <Text style={styles.description}>
          {t('Set the quantity at which an item should be considered low in stock.')}
        </Text>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#17664f" />
            <Text style={styles.helperText}>{t('Loading inventory settings…')}</Text>
          </View>
        ) : hasSettingsAccess ? (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{t('Low stock threshold (units)')}</Text>
              <TextInput
                accessibilityLabel={t('Low stock threshold (units)')}
                keyboardType="number-pad"
                onChangeText={(value) => {
                  setThreshold(value);
                  setMessage('');
                  setError('');
                }}
                placeholder={t('Enter quantity')}
                value={threshold}
                style={styles.input}
              />
              <Text style={[styles.statusTitle, isEnabled ? styles.successText : styles.disabledText]}>
                {isEnabled ? t('Low Stock Monitoring Active') : t('Low Stock Not Working')}
              </Text>
              <Text style={styles.helperText}>
                {isEnabled
                  ? `${t('Products with available stock at or below')} ${parsedThreshold} ${t('units will appear in the Low Stock list.')}`
                  : t('Enter and save a threshold greater than 0 to enable low stock monitoring.')}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void saveThreshold()}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, isSaving && styles.disabled]}>
                {isSaving ? <ActivityIndicator color="#fff" size="small" /> : null}
                <Text style={styles.saveButtonText}>{isSaving ? t('Saving…') : t('Save')}</Text>
              </Pressable>
            </View>
            {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error)}</Text> : null}
          </>
        ) : (
          <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error || 'Inventory settings are available to store owners.')}</Text>
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
    maxWidth: 680,
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
  statusTitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '800',
  },
  successText: {
    color: '#16845f',
  },
  disabledText: {
    color: '#dc2626',
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
