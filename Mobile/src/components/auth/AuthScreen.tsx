import { Text, TextInput } from '@/providers/LanguageProvider';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInputProps
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

// Metro needs a static require for this shared image, which lives outside the Mobile asset tree.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pharmacyIcon = require('../../../../public/pharmacy-icon.png');

type AuthScreenProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthScreen({ eyebrow, title, subtitle, children, footer }: AuthScreenProps) {
  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets>
            <View style={styles.brandRow}>
              <Image
                source={pharmacyIcon}
                contentFit="contain"
                style={styles.brandMark}
                alt="Pharmacy icon"
                accessibilityLabel="Pharmacy icon"
              />
              <View>
                <Text style={styles.brandName}>Pharmacy Cluster</Text>
                <Text style={styles.brandCaption}>PHARMACY WORKSPACE</Text>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeading}>
                <Text style={styles.eyebrow}>{eyebrow}</Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              {children}
              <View style={styles.footer}>{footer}</View>
            </View>

            <Text style={styles.bottomNote}>A secure workspace for your pharmacy team</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

type AuthFieldProps = TextInputProps & {
  label: string;
  secure?: boolean;
};

export function AuthField({ label, secure = false, ...inputProps }: AuthFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          {...inputProps}
          accessibilityLabel={label}
          secureTextEntry={secure && !isPasswordVisible}
          style={[styles.input, secure && styles.passwordInput, inputProps.style]}
          placeholderTextColor="#929b95"
          selectionColor="#15765c"
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
            onPress={() => setIsPasswordVisible((visible) => !visible)}
            style={styles.passwordToggle}>
            <Text style={styles.passwordToggleText}>{isPasswordVisible ? 'Hide' : 'Show'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function AuthSubmitButton({
  title,
  loadingTitle,
  isLoading,
  onPress,
}: {
  title: string;
  loadingTitle?: string;
  isLoading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isLoading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.submitButton,
        pressed && !isLoading && styles.submitButtonPressed,
        isLoading && styles.submitButtonDisabled,
      ]}>
      <Text style={styles.submitButtonText}>{isLoading ? loadingTitle ?? 'Please wait…' : title}</Text>
      {!isLoading && <Text style={styles.submitArrow}>→</Text>}
    </Pressable>
  );
}

export const authStyles = StyleSheet.create({
  form: {
    gap: 15,
  },
  feedback: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  errorFeedback: {
    borderColor: '#f0c9c2',
    backgroundColor: '#fff3f0',
    color: '#a63e34',
  },
  successFeedback: {
    borderColor: '#bce6d2',
    backgroundColor: '#effaf4',
    color: '#176b4e',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  linkText: {
    color: '#69766f',
    fontSize: 13,
  },
  linkAction: {
    color: '#146e54',
    fontSize: 13,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f2f4ef',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 22,
  },
  brandMark: {
    width: 40,
    height: 40,
  },
  brandName: {
    color: '#183c31',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  brandCaption: {
    marginTop: 3,
    color: '#87948c',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  card: {
    padding: 21,
    borderRadius: 23,
    backgroundColor: '#fffefa',
    borderWidth: 1,
    borderColor: '#e7ebe3',
    shadowColor: '#173b2e',
    shadowOpacity: 0.07,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardHeading: {
    marginBottom: 21,
  },
  eyebrow: {
    color: '#47826b',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 7,
  },
  title: {
    color: '#182d24',
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  subtitle: {
    marginTop: 6,
    color: '#758078',
    fontSize: 13,
    lineHeight: 19,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    color: '#30433a',
    fontSize: 12,
    fontWeight: '700',
  },
  inputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    height: 49,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#dfe6df',
    borderRadius: 12,
    backgroundColor: '#fff',
    color: '#23352c',
    fontSize: 14,
  },
  passwordInput: {
    paddingRight: 60,
  },
  passwordToggle: {
    position: 'absolute',
    right: 13,
    paddingVertical: 10,
  },
  passwordToggleText: {
    color: '#29745a',
    fontSize: 11,
    fontWeight: '700',
  },
  submitButton: {
    minHeight: 50,
    paddingHorizontal: 17,
    borderRadius: 13,
    backgroundColor: '#145642',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 3,
    shadowColor: '#145642',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  submitButtonPressed: {
    opacity: 0.82,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    color: '#fffefa',
    fontSize: 14,
    fontWeight: '800',
  },
  submitArrow: {
    position: 'absolute',
    right: 17,
    color: '#fffefa',
    fontSize: 19,
    lineHeight: 22,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#edf0ea',
    marginTop: 18,
    paddingTop: 15,
  },
  bottomNote: {
    marginTop: 16,
    textAlign: 'center',
    color: '#8a958e',
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
