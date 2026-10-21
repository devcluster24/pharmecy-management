import * as Crypto from 'expo-crypto';
import { useLocalizedAlert, Text, TextInput, useLanguage, useTranslate } from '@/providers/LanguageProvider';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

const PAYMENT_METHODS_KEY = 'pharmacy-payment-methods-v1';
const DEFAULT_MOBILE_PAYMENT_NAMES = ['Bangla QR', 'Bkash', 'Nagad', 'Rocket', 'upay', 'Tap', 'gpay'] as const;
const BANK_NAMES = [
  'Sonali Bank PLC',
  'Janata Bank PLC',
  'Agrani Bank PLC',
  'Rupali Bank PLC',
  'Bangladesh Development Bank PLC',
  'BASIC Bank PLC',
  'Bangladesh Krishi Bank',
  'Rajshahi Krishi Unnayan Bank',
  'Probashi Kallyan Bank',
  'AB Bank PLC',
  'Bangladesh Commerce Bank Limited',
  'Bank Asia PLC',
  'BRAC Bank PLC',
  'City Bank PLC',
  'Community Bank Bangladesh PLC',
  'Dhaka Bank PLC',
  'Dutch-Bangla Bank PLC',
  'Eastern Bank PLC',
  'IFIC Bank PLC',
  'Jamuna Bank PLC',
  'Meghna Bank PLC',
  'Mercantile Bank PLC',
  'Midland Bank PLC',
  'Modhumoti Bank PLC',
  'Mutual Trust Bank PLC',
  'National Bank Limited',
  'National Credit and Commerce Bank PLC (NCC Bank)',
  'NRB Bank PLC',
  'NRB Commercial Bank PLC',
  'ONE Bank PLC',
  'Padma Bank PLC',
  'Premier Bank PLC',
  'Prime Bank PLC',
  'Pubali Bank PLC',
  'Shimanto Bank PLC',
  'South Bangla Agriculture and Commerce Bank PLC (SBAC)',
  'Southeast Bank PLC',
  'Standard Bank PLC',
  'Trust Bank PLC',
  'United Commercial Bank PLC (UCB)',
  'Uttara Bank PLC',
  'Citizens Bank PLC',
  'Al-Arafah Islami Bank PLC',
  'ICB Islamic Bank Limited',
  'Islami Bank Bangladesh PLC',
  'Shahjalal Islami Bank PLC',
  'Sammilito Islami Bank PLC',
  'EXIM Bank PLC',
  'First Security Islami Bank PLC',
  'Global Islami Bank PLC',
  'Social Islami Bank PLC',
  'Union Bank PLC',
  'Standard Chartered Bank',
  'HSBC Bangladesh',
  'Citibank N.A.',
  'Commercial Bank of Ceylon PLC',
  'State Bank of India',
  'Habib Bank Limited',
  'National Bank of Pakistan',
  'Woori Bank',
  'Bank Alfalah Limited',
  'Ansar VDP Unnayan Bank',
  'Karmasangsthan Bank',
  'Grameen Bank',
  'Jubilee Bank',
  'Palli Sanchay Bank',
] as const;

type MobilePaymentMethod = {
  id: string;
  type: 'mobile';
  name: string;
  phone: string;
};

type BankPaymentMethod = {
  id: string;
  type: 'bank';
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  branch: string;
  district: string;
};

type PaymentMethod = MobilePaymentMethod | BankPaymentMethod;

function isPaymentMethod(value: unknown): value is PaymentMethod {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const method = value as Record<string, unknown>;
  if (typeof method.id !== 'string') return false;
  if (method.type === 'mobile') {
    return typeof method.name === 'string' && typeof method.phone === 'string';
  }
  if (method.type === 'bank') {
    return typeof method.bankName === 'string'
      && typeof method.accountHolderName === 'string'
      && typeof method.accountNumber === 'string'
      && typeof method.branch === 'string'
      && typeof method.district === 'string';
  }
  return false;
}

export default function PaymentMethodsSettingsScreen() {
  const { alert } = useLocalizedAlert();
  const { language } = useLanguage();
  const t = useTranslate();
  const isBengali = language === 'bn';
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session } = useAuth();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodType, setMethodType] = useState<'mobile' | 'bank'>('mobile');
  const [methodName, setMethodName] = useState('');
  const [phone, setPhone] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [branch, setBranch] = useState('');
  const [district, setDistrict] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const existingMobileNames = useMemo(() => new Set(
    methods
      .filter((method): method is MobilePaymentMethod => method.type === 'mobile' && method.id !== editingId)
      .map((method) => method.name.trim().toLocaleLowerCase()),
  ), [editingId, methods]);
  const existingBankNames = useMemo(() => new Set(
    methods
      .filter((method): method is BankPaymentMethod => method.type === 'bank' && method.id !== editingId)
      .map((method) => method.bankName.trim().toLocaleLowerCase()),
  ), [editingId, methods]);

  useEffect(() => {
    if (isAuthLoading || profileLoading) return;

    let active = true;
    const timer = setTimeout(() => {
      async function loadMethods() {
        setIsLoading(true);
        setError('');
        try {
          if (dashboardRole !== 'owner' || !session) {
            throw new Error('Payment methods are available to store owners.');
          }
          if (!supabase) throw new Error(supabaseConfigError);

          const { data, error: loadError } = await supabase
            .from('pharmacy_app_data')
            .select('payload')
            .eq('owner_user_id', session.user.id)
            .eq('data_key', PAYMENT_METHODS_KEY)
            .maybeSingle();
          if (loadError) throw loadError;
          const payload = data?.payload;
          if (payload === null || payload === undefined) {
            if (active) setMethods([]);
            return;
          }
          if (!Array.isArray(payload) || !payload.every(isPaymentMethod)) {
            throw new Error('Saved payment methods are invalid. Update them in Settings.');
          }
          if (active) setMethods(payload);
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load payment methods.');
        } finally {
          if (active) setIsLoading(false);
        }
      }

      void loadMethods();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dashboardRole, isAuthLoading, profileLoading, session]);

  function resetForm() {
    setMethodType('mobile');
    setMethodName('');
    setPhone('');
    setBankName('');
    setAccountHolderName('');
    setAccountNumber('');
    setBranch('');
    setDistrict('');
    setEditingId(null);
  }

  function editMethod(method: PaymentMethod) {
    setEditingId(method.id);
    setMethodType(method.type);
    if (method.type === 'mobile') {
      setMethodName(method.name);
      setPhone(method.phone);
      setBankName('');
      setAccountHolderName('');
      setAccountNumber('');
      setBranch('');
      setDistrict('');
    } else {
      setMethodName('');
      setPhone('');
      setBankName(method.bankName);
      setAccountHolderName(method.accountHolderName);
      setAccountNumber(method.accountNumber);
      setBranch(method.branch);
      setDistrict(method.district);
    }
    setMessage('');
    setError('');
  }

  async function persistMethods(nextMethods: PaymentMethod[], successMessage: string) {
    if (dashboardRole !== 'owner' || !session) throw new Error('Payment methods are available to store owners.');
    if (!supabase) throw new Error(supabaseConfigError);

    const client = supabase;
    const ownerId = session.user.id;
    const existing = await client.from('pharmacy_app_data')
      .select('data_key')
      .eq('owner_user_id', ownerId)
      .eq('data_key', PAYMENT_METHODS_KEY)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const now = new Date().toISOString();
    const result = existing.data
      ? await client.from('pharmacy_app_data')
        .update({ payload: nextMethods, updated_at: now })
        .eq('owner_user_id', ownerId)
        .eq('data_key', PAYMENT_METHODS_KEY)
        .select('data_key')
        .maybeSingle()
      : await client.from('pharmacy_app_data')
        .insert({
          owner_user_id: ownerId,
          data_key: PAYMENT_METHODS_KEY,
          payload: nextMethods,
          updated_at: now,
        })
        .select('data_key')
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Could not save payment methods. Please try again.');

    setMethods(nextMethods);
    setMessage(t(successMessage));
    setError('');
  }

  async function saveMethod() {
    setMessage('');
    setError('');
    if (dashboardRole !== 'owner' || !session) {
      setError(t('Payment methods are available to store owners.'));
      return;
    }

    if (methodType === 'mobile' && !methodName.trim()) {
      setError(t('Enter a payment method name.'));
      return;
    }
    if (methodType === 'bank' && (!bankName || !accountHolderName.trim() || !accountNumber.trim())) {
      setError(t('Complete all required bank account fields.'));
      return;
    }

    const identity = methodType === 'mobile' ? methodName.trim() : bankName.trim();
    const duplicates = methodType === 'mobile' ? existingMobileNames : existingBankNames;
    if (duplicates.has(identity.toLocaleLowerCase())) {
      setError(t('This payment method name has already been added.'));
      return;
    }

    const method: PaymentMethod = methodType === 'mobile'
      ? {
          id: editingId ?? Crypto.randomUUID(),
          type: 'mobile',
          name: methodName.trim(),
          phone: phone.trim(),
        }
      : {
          id: editingId ?? Crypto.randomUUID(),
          type: 'bank',
          bankName,
          accountHolderName: accountHolderName.trim(),
          accountNumber: accountNumber.trim(),
          branch: branch.trim(),
          district: district.trim(),
        };

    const nextMethods = editingId
      ? methods.map((existing) => existing.id === editingId ? method : existing)
      : [...methods, method];
    setIsSaving(true);
    try {
      await persistMethods(nextMethods, editingId ? 'Payment method updated.' : 'Payment method saved.');
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('Could not save payment methods.'));
    } finally {
      setIsSaving(false);
    }
  }

  function deleteMethod(method: PaymentMethod) {
    alert(
      isBengali ? 'পেমেন্ট পদ্ধতি মুছবেন?' : 'Delete payment method?',
      isBengali ? 'এই পেমেন্ট পদ্ধতিটি মুছে ফেলা হবে।' : 'This payment method will be deleted.',
      [
        { text: isBengali ? 'বাতিল' : 'Cancel', style: 'cancel' },
        {
          text: isBengali ? 'মুছুন' : 'Delete',
          style: 'destructive',
          onPress: () => {
            setIsSaving(true);
            void persistMethods(methods.filter((entry) => entry.id !== method.id), 'Payment method deleted.')
              .then(() => {
                if (editingId === method.id) resetForm();
              })
              .catch((deleteError: unknown) => {
                setError(deleteError instanceof Error ? deleteError.message : t('Could not delete payment method.'));
              })
              .finally(() => setIsSaving(false));
          },
        },
      ],
    );
  }

  function labelForMethod(method: PaymentMethod) {
    return method.type === 'mobile' ? method.name : method.bankName;
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t(editingId ? 'Edit Payment Method' : 'Add Payment Method')}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{t('Payment type')}</Text>
        <View style={styles.typeOptions}>
          {([
            { value: 'mobile', label: 'Mobile Banking' },
            { value: 'bank', label: 'Bank Account' },
          ] as const).map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: methodType === option.value }}
              onPress={() => {
                setMethodType(option.value);
                setError('');
              }}
              style={[styles.typeOption, methodType === option.value && styles.typeOptionSelected]}>
              <Text style={[styles.typeOptionText, methodType === option.value && styles.typeOptionTextSelected]}>
                {t(option.label)}
              </Text>
            </Pressable>
          ))}
        </View>

        {methodType === 'mobile' ? (
          <>
            <Text style={styles.label}>{t('Payment Method Name')} *</Text>
            <TextInput
              accessibilityLabel={t('Payment Method Name')}
              onChangeText={(value) => {
                setMethodName(value);
                setError('');
              }}
              placeholder={t('Select or enter a name')}
              value={methodName}
              style={styles.input}
            />
            <View style={styles.suggestions}>
              {DEFAULT_MOBILE_PAYMENT_NAMES.filter((name) => !existingMobileNames.has(name.toLocaleLowerCase()) || name === methodName).map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => {
                    setMethodName(name);
                    setError('');
                  }}
                  style={[styles.suggestion, methodName === name && styles.suggestionSelected]}>
                  <Text style={[styles.suggestionText, methodName === name && styles.suggestionTextSelected]}>{name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{t('Phone Number')}</Text>
            <TextInput
              accessibilityLabel={t('Phone Number')}
              keyboardType="phone-pad"
              onChangeText={setPhone}
              placeholder={t('Enter phone number')}
              value={phone}
              style={styles.input}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>{t('Bank Name')} *</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Select bank')}
              disabled={isSaving}
              onPress={() => setIsBankPickerOpen(true)}
              style={styles.bankSelect}>
              <Text style={[styles.bankSelectText, !bankName && styles.placeholder]}>
                {bankName ? t(bankName) : t('Select bank')}
              </Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
            <Text style={styles.label}>{t('Account Holder Name')} *</Text>
            <TextInput
              accessibilityLabel={t('Account Holder Name')}
              onChangeText={setAccountHolderName}
              placeholder={t('Enter account holder name')}
              value={accountHolderName}
              style={styles.input}
            />
            <Text style={styles.label}>{t('Account Number')} *</Text>
            <TextInput
              accessibilityLabel={t('Account Number')}
              onChangeText={setAccountNumber}
              placeholder={t('Enter account number')}
              value={accountNumber}
              style={styles.input}
            />
            <Text style={styles.label}>{t('Branch')} ({t('optional')})</Text>
            <TextInput
              accessibilityLabel={t('Branch')}
              onChangeText={setBranch}
              placeholder={t('Enter branch')}
              value={branch}
              style={styles.input}
            />
            <Text style={styles.label}>{t('District')} ({t('optional')})</Text>
            <TextInput
              accessibilityLabel={t('District')}
              onChangeText={setDistrict}
              placeholder={t('Enter district')}
              value={district}
              style={styles.input}
            />
          </>
        )}

        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving || isLoading}
            onPress={() => void saveMethod()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (isSaving || isLoading) && styles.disabled]}>
            {isSaving ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Text style={styles.primaryButtonText}>
              {isSaving ? t('Saving…') : t(editingId ? 'Update Payment Method' : 'Add Payment Method')}
            </Text>
          </Pressable>
          {editingId ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={resetForm}
              style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>{t('Cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {message ? <Text accessibilityRole="alert" style={styles.successMessage}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.errorMessage}>{t(error)}</Text> : null}

      <View style={styles.accountSection}>
        <Text style={styles.sectionTitle}>{t('Account Info')}</Text>
        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#17664f" />
            <Text style={styles.helperText}>{t('Loading payment methods…')}</Text>
          </View>
        ) : methods.length === 0 ? (
          <Text style={styles.emptyMessage}>{t('No payment methods added yet.')}</Text>
        ) : methods.map((method) => (
          <View key={method.id} style={styles.methodCard}>
            <View style={styles.methodDetails}>
              <Text style={styles.methodName}>{t(labelForMethod(method))}</Text>
              {method.type === 'mobile' ? (
                <>
                  <Text style={styles.methodType}>{t('Mobile Banking')}</Text>
                  {method.phone ? <Text style={styles.methodDetail}>{t('Phone Number')}: {method.phone}</Text> : null}
                </>
              ) : (
                <View style={styles.bankDetails}>
                  <Text style={styles.methodDetail}>{t('Account Holder')}: {method.accountHolderName}</Text>
                  <Text style={styles.methodDetail}>{t('Account Number')}: {method.accountNumber}</Text>
                  {method.branch ? <Text style={styles.methodDetail}>{t('Branch')}: {method.branch}</Text> : null}
                  {method.district ? <Text style={styles.methodDetail}>{t('District')}: {method.district}</Text> : null}
                </View>
              )}
            </View>
            <View style={styles.methodActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => editMethod(method)}
                style={styles.editButton}>
                <Text style={styles.editButtonText}>{t('Edit')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => deleteMethod(method)}
                style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>{t('Delete')}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsBankPickerOpen(false)}
        transparent
        visible={isBankPickerOpen}>
        <View style={styles.modalBackdrop}>
          <View style={styles.bankModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>{t('Select bank')}</Text>
              <Pressable accessibilityRole="button" onPress={() => setIsBankPickerOpen(false)}>
                <Text style={styles.modalClose}>{t('Close')}</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {BANK_NAMES.filter((name) => !existingBankNames.has(name.toLocaleLowerCase()) || name === bankName).map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: bankName === name }}
                  onPress={() => {
                    setBankName(name);
                    setError('');
                    setIsBankPickerOpen(false);
                  }}
                  style={[styles.bankOption, bankName === name && styles.bankOptionSelected]}>
                  <Text style={[styles.bankOptionText, bankName === name && styles.bankOptionTextSelected]}>{t(name)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    maxWidth: 760,
    alignSelf: 'center',
    gap: 13,
    padding: 16,
    paddingBottom: 30,
  },
  title: {
    color: '#183c31',
    fontSize: 19,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#183c31',
    fontSize: 16,
    fontWeight: '800',
  },
  card: {
    gap: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e2e9e4',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  label: {
    marginTop: 3,
    color: '#34453b',
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 13,
  },
  typeOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  typeOption: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  typeOptionSelected: {
    borderColor: '#17664f',
    backgroundColor: '#e8f3ec',
  },
  typeOptionText: {
    color: '#526159',
    fontSize: 12,
    fontWeight: '600',
  },
  typeOptionTextSelected: {
    color: '#17664f',
    fontWeight: '800',
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestion: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 15,
    backgroundColor: '#fff',
  },
  suggestionSelected: {
    borderColor: '#17664f',
    backgroundColor: '#e8f3ec',
  },
  suggestionText: {
    color: '#526159',
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionTextSelected: {
    color: '#17664f',
  },
  bankSelect: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  bankSelectText: {
    flex: 1,
    color: '#26352f',
    fontSize: 13,
  },
  placeholder: {
    color: '#87928d',
  },
  chevron: {
    color: '#526159',
    fontSize: 19,
  },
  formActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 5,
  },
  primaryButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  cancelButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    color: '#526159',
    fontSize: 12,
    fontWeight: '700',
  },
  accountSection: {
    gap: 10,
    marginTop: 4,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5ebe7',
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  methodDetails: {
    flex: 1,
    gap: 4,
  },
  methodName: {
    color: '#26352f',
    fontSize: 13,
    fontWeight: '800',
  },
  methodType: {
    color: '#687871',
    fontSize: 11,
  },
  methodDetail: {
    color: '#526158',
    fontSize: 11,
    lineHeight: 16,
  },
  bankDetails: {
    gap: 3,
    marginTop: 3,
  },
  methodActions: {
    gap: 6,
  },
  editButton: {
    minWidth: 54,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 6,
  },
  editButtonText: {
    color: '#17704e',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteButton: {
    minWidth: 54,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#f1d8d5',
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#ad4b43',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyMessage: {
    color: '#687871',
    fontSize: 13,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  helperText: {
    color: '#687871',
    fontSize: 12,
  },
  successMessage: {
    color: '#16845f',
    fontSize: 12,
  },
  errorMessage: {
    color: '#b34b43',
    fontSize: 12,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bankModal: {
    maxHeight: '82%',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 26,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  modalClose: {
    color: '#17664f',
    fontSize: 13,
    fontWeight: '700',
  },
  bankOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5ebe7',
  },
  bankOptionSelected: {
    backgroundColor: '#e8f3ec',
  },
  bankOptionText: {
    color: '#526159',
    fontSize: 13,
  },
  bankOptionTextSelected: {
    color: '#17664f',
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.55,
  },
});
