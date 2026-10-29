import { Text } from '@/providers/LanguageProvider';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type PharmacyNotification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DashboardNotificationCenter() {
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<PharmacyNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !session) {
      setError('Notifications are unavailable. Check your Supabase connection.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('pharmacy_notifications')
        .select('id, title, body, created_at, read_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
      if (loadError) throw loadError;
      setNotifications(data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const client = supabase;
    if (!client || !session) return;

    const channel = client
      .channel(`dashboard-notifications:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pharmacy_notifications',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => void loadNotifications(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live notifications are temporarily unavailable.');
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadNotifications, session]);

  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(() => void loadNotifications(), 0);
    return () => clearTimeout(timeout);
  }, [loadNotifications, session]);

  async function toggleReadState(notification: PharmacyNotification) {
    if (!supabase || !session) return;

    setUpdatingId(notification.id);
    setError('');
    const readAt = notification.read_at ? null : new Date().toISOString();
    try {
      const { data, error: updateError } = await supabase
        .from('pharmacy_notifications')
        .update({ read_at: readAt })
        .eq('id', notification.id)
        .eq('user_id', session.user.id)
        .select('id')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error('Notification could not be updated. Please refresh and try again.');
      setNotifications((current) => current.map((item) =>
        item.id === notification.id ? { ...item, read_at: readAt } : item,
      ));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update notification status.');
    } finally {
      setUpdatingId(null);
    }
  }

  if (!session) return null;

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        onPress={() => {
          setIsOpen(true);
          void loadNotifications();
        }}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <SymbolView
          name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
          size={21}
          tintColor="#17664f"
        />
        {unreadCount ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsOpen(false)}
        presentationStyle="pageSheet"
        visible={isOpen}>
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.eyebrow}>STAY UP TO DATE</Text>
              <Text style={styles.modalTitle}>Notifications</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notifications"
              onPress={() => setIsOpen(false)}
              style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void loadNotifications()}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#17664f" />
              <Text style={styles.mutedText}>Loading notifications…</Text>
            </View>
          ) : notifications.length === 0 && !error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>You’re all caught up</Text>
              <Text style={styles.mutedText}>New pharmacy updates will appear here.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {notifications.map((notification) => {
                const unread = !notification.read_at;
                const isUpdating = updatingId === notification.id;
                return (
                  <View key={notification.id} style={[styles.card, unread && styles.unreadCard]}>
                    <View style={styles.heading}>
                      <View style={[styles.dot, unread ? styles.unreadDot : styles.readDot]} />
                      <Text style={styles.title}>{notification.title}</Text>
                    </View>
                    {notification.body ? <Text style={styles.body}>{notification.body}</Text> : null}
                    <View style={styles.footer}>
                      <Text style={styles.date}>{formatNotificationTime(notification.created_at)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isUpdating}
                        onPress={() => void toggleReadState(notification)}>
                        <Text style={[styles.readAction, isUpdating && styles.disabledText]}>
                          {isUpdating ? 'Updating…' : unread ? 'Mark as read' : 'Mark unread'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#fffefa',
    borderWidth: 1,
    borderColor: '#dce8df',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.72 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#d9483b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  modalSafeArea: { flex: 1, backgroundColor: '#f7f8f5' },
  modalHeader: {
    minHeight: 78,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dce4dc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { color: '#6f8477', fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  modalTitle: { marginTop: 4, color: '#193d31', fontSize: 21, fontWeight: '800' },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8eee8',
  },
  closeButtonText: { color: '#355448', fontSize: 23, lineHeight: 25 },
  errorBox: { margin: 16, padding: 12, borderRadius: 10, backgroundColor: '#fff0ed' },
  errorText: { color: '#a83b31', fontSize: 12 },
  retryText: { marginTop: 8, color: '#17664f', fontSize: 12, fontWeight: '700' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 24 },
  emptyTitle: { color: '#234337', fontSize: 16, fontWeight: '700' },
  mutedText: { color: '#748078', fontSize: 12, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e4e9e4', backgroundColor: '#fff' },
  unreadCard: { borderColor: '#a8d7bf', backgroundColor: '#f1faf4' },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  dot: { width: 8, height: 8, marginTop: 5, borderRadius: 4 },
  unreadDot: { backgroundColor: '#16845d' },
  readDot: { backgroundColor: '#bdc8c0' },
  title: { flex: 1, color: '#243a30', fontSize: 13, fontWeight: '700' },
  body: { marginTop: 8, color: '#68766e', fontSize: 12, lineHeight: 18 },
  footer: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  date: { color: '#89958e', fontSize: 10, flexShrink: 1 },
  readAction: { color: '#17664f', fontSize: 11, fontWeight: '700' },
  disabledText: { opacity: 0.5 },
});
