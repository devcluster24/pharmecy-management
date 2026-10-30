import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Text } from '@/providers/LanguageProvider';

type PharmacyNotification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

let realtimeChannelInstance = 0;

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const loadNotifications = useCallback(async () => {
    const client = supabase;
    if (!client || !session) {
      setError('Notifications are unavailable. Check your account and Supabase connection.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { data, error: loadError } = await client
        .from('pharmacy_notifications')
        .select('id, title, body, created_at, read_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (loadError) throw loadError;
      const loadedNotifications = data ?? [];
      setNotifications(loadedNotifications);
      setUnreadCount(loadedNotifications.filter((item) => !item.read_at).length);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const client = supabase;
    if (!client || !session) return;

    let active = true;
    const loadUnreadCount = async () => {
      const { count, error: countError } = await client
        .from('pharmacy_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .is('read_at', null);

      if (!active) return;
      if (countError) {
        console.error('Could not load unread notification count:', countError);
        return;
      }

      setUnreadCount(count ?? 0);
    };

    void loadUnreadCount();

    const channel = client
      .channel(`dashboard-notifications:${session.user.id}-${++realtimeChannelInstance}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pharmacy_notifications',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          void loadUnreadCount();
          if (isOpenRef.current) void loadNotifications();
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Live notification updates are unavailable:', status);
          if (isOpenRef.current) setError('Live notifications are temporarily unavailable.');
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [loadNotifications, session]);

  async function toggleReadState(notification: PharmacyNotification) {
    const client = supabase;
    if (!client || !session) {
      setError('Notifications are unavailable. Check your account and Supabase connection.');
      return;
    }

    setUpdatingId(notification.id);
    setError('');
    const readAt = notification.read_at ? null : new Date().toISOString();

    try {
      const { data, error: updateError } = await client
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
      setUnreadCount((current) => Math.max(0, current + (readAt ? -1 : 1)));
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Could not update notification status.',
      );
    } finally {
      setUpdatingId(null);
    }
  }

  if (!session) return null;

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
            <View style={styles.state}>
              <ActivityIndicator color="#17664f" />
              <Text style={styles.mutedText}>Loading notifications…</Text>
            </View>
          ) : notifications.length === 0 && !error ? (
            <View style={styles.state}>
              <View style={styles.emptyIcon}>
                <SymbolView
                  name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                  size={23}
                  tintColor="#47826b"
                />
              </View>
              <Text style={styles.emptyTitle}>You’re all caught up</Text>
              <Text style={styles.mutedText}>New pharmacy updates will appear here.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {notifications.map((notification) => {
                const isUnread = !notification.read_at;
                const isUpdating = updatingId === notification.id;

                return (
                  <View
                    key={notification.id}
                    style={[styles.card, isUnread && styles.unreadCard]}>
                    <View style={styles.notificationHeading}>
                      <View style={[styles.dot, isUnread ? styles.unreadDot : styles.readDot]} />
                      <Text style={styles.notificationTitle}>{notification.title}</Text>
                    </View>
                    {notification.body ? (
                      <Text style={styles.body}>{notification.body}</Text>
                    ) : null}
                    <View style={styles.footer}>
                      <Text style={styles.date}>
                        {formatNotificationTime(notification.created_at)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isUpdating}
                        onPress={() => void toggleReadState(notification)}>
                        <Text style={[styles.readAction, isUpdating && styles.disabledText]}>
                          {isUpdating ? 'Updating…' : isUnread ? 'Mark as read' : 'Mark unread'}
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
  modalSafeArea: { flex: 1, backgroundColor: '#f7f8f5', paddingHorizontal: 20 },
  modalHeader: {
    minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dce4dc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { color: '#6f8477', fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  modalTitle: { marginTop: 4, color: '#193d31', fontSize: 21, fontWeight: '800' },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#e8eee8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { color: '#355448', fontSize: 23, lineHeight: 25 },
  errorBox: { marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: '#fff0ed' },
  errorText: { color: '#a83b31', fontSize: 12 },
  retryText: { marginTop: 8, color: '#17664f', fontSize: 12, fontWeight: '700' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 24 },
  emptyIcon: {
    width: 54,
    height: 54,
    marginBottom: 6,
    borderRadius: 19,
    backgroundColor: '#eaf3e7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: '#234337', fontSize: 16, fontWeight: '700' },
  mutedText: { color: '#748078', fontSize: 12, textAlign: 'center' },
  list: { paddingVertical: 16, gap: 10 },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e9e4',
    backgroundColor: '#fff',
  },
  unreadCard: { borderColor: '#a8d7bf', backgroundColor: '#f1faf4' },
  notificationHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  dot: { width: 8, height: 8, marginTop: 5, borderRadius: 4 },
  unreadDot: { backgroundColor: '#16845d' },
  readDot: { backgroundColor: '#bdc8c0' },
  notificationTitle: { flex: 1, color: '#243a30', fontSize: 13, fontWeight: '700' },
  body: { marginTop: 8, color: '#68766e', fontSize: 12, lineHeight: 18 },
  footer: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  date: { color: '#89958e', fontSize: 10, flexShrink: 1 },
  readAction: { color: '#17664f', fontSize: 11, fontWeight: '700' },
  disabledText: { opacity: 0.5 },
});
