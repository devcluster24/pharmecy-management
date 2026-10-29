import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AlertButton, AlertOptions } from 'react-native';

export type AppAlertPayload = {
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

export function AppAlertHost({
  alert,
  onClose,
}: {
  alert: AppAlertPayload | null;
  onClose: () => void;
}) {
  const tone = getAlertTone(alert?.title ?? '');
  const buttons = alert?.buttons.length ? alert.buttons : [{ text: 'OK' }];

  function dismiss() {
    onClose();
  }

  function requestClose() {
    if (alert?.options?.cancelable) dismiss();
  }

  function handleButtonPress(button: AlertButton) {
    onClose();
    button.onPress?.();
  }

  return (
    <Modal
      visible={alert !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={requestClose}
      onDismiss={alert?.options?.onDismiss}>
      <View style={styles.backdrop}>
        {alert?.options?.cancelable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close alert"
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
          />
        ) : null}
        <View accessibilityRole="alert" style={styles.dialog}>
          <View style={[
            styles.icon,
            tone === 'success' ? styles.successIcon : null,
            tone === 'error' ? styles.errorIcon : null,
            tone === 'warning' ? styles.warningIcon : null,
          ]}>
            <Text style={[
              styles.iconText,
              tone === 'success' ? styles.successIconText : null,
              tone === 'error' ? styles.errorIconText : null,
              tone === 'warning' ? styles.warningIconText : null,
            ]}>
              {tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}
            </Text>
          </View>
          <Text style={styles.title}>{alert?.title}</Text>
          {alert?.message ? (
            <ScrollView style={styles.messageScroll} showsVerticalScrollIndicator>
              <Text style={styles.message}>{alert.message}</Text>
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            {buttons.map((button, index) => {
              const isDestructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              return (
                <Pressable
                  key={`${button.text ?? 'action'}-${index}`}
                  accessibilityRole="button"
                  onPress={() => handleButtonPress(button)}
                  style={({ pressed }) => [
                    styles.action,
                    isCancel ? styles.cancelAction : null,
                    isDestructive ? styles.destructiveAction : null,
                    pressed ? styles.actionPressed : null,
                  ]}>
                  <Text
                    style={[
                      styles.actionText,
                      isCancel ? styles.cancelActionText : null,
                      isDestructive ? styles.destructiveActionText : null,
                    ]}>
                    {button.text ?? 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getAlertTone(title: string): 'success' | 'error' | 'warning' | 'info' {
  if (/\bwarning\b/i.test(title)) {
    return 'warning';
  }
  if (/\b(success|saved|created|updated|submitted|complete|completed|connected|downloaded|activated|placed|received|recorded|deleted)\b/i.test(title)) {
    return 'success';
  }
  if (/\bsigned in\b/i.test(title)) {
    return 'success';
  }
  if (/\b(check your input)\b/i.test(title)) {
    return 'warning';
  }
  if (/\b(error|failed|failure|unavailable|required|could not|unable|invalid|denied|missing|too short)\b/i.test(title)) {
    return 'error';
  }
  return 'info';
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(12, 27, 21, 0.48)',
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderRadius: 22,
    backgroundColor: '#fffefa',
    shadowColor: '#112c20',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  icon: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderRadius: 27,
    backgroundColor: '#e8f3eb',
  },
  successIcon: {
    backgroundColor: '#e5f5ec',
  },
  errorIcon: {
    backgroundColor: '#fff0ed',
  },
  warningIcon: {
    backgroundColor: '#fff5db',
  },
  iconText: {
    color: '#17664f',
    fontSize: 28,
    fontWeight: '700',
  },
  successIconText: {
    color: '#16845f',
  },
  errorIconText: {
    color: '#b9382d',
  },
  warningIconText: {
    color: '#a76b08',
  },
  title: {
    color: '#183c31',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    color: '#68756e',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  messageScroll: {
    maxHeight: 220,
  },
  actions: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
  },
  action: {
    minWidth: 100,
    minHeight: 44,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#145642',
  },
  cancelAction: {
    borderWidth: 1,
    borderColor: '#dce5df',
    backgroundColor: '#fffefa',
  },
  destructiveAction: {
    backgroundColor: '#b9382d',
  },
  actionPressed: {
    opacity: 0.78,
  },
  actionText: {
    color: '#fffefa',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelActionText: {
    color: '#526259',
  },
  destructiveActionText: {
    color: '#fff',
  },
});
