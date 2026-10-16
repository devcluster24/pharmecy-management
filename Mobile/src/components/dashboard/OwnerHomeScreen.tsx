import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

type TodaySalesSummary = {
  amount: number;
  invoiceCount: number;
};

type LatestInvoice = {
  id: string;
  invoice: string;
  createdAt: string;
};

type LatestPurchaseOrder = {
  order: string;
  createdAt: string;
};

type LatestReceiveOrder = {
  order: string;
  createdAt: string;
};

type LatestReturn = {
  returnId: string;
  createdAt: string;
};

const quickAccessItems = [
  { id: 'overview', label: 'Overview', icon: 'chart.bar.fill' },
  { id: 'inventory', label: 'Inventory', icon: 'shippingbox.fill' },
  { id: 'reports', label: 'Reports', icon: 'doc.text.magnifyingglass' },
  { id: 'invoice', label: 'Invoice', icon: 'doc.text.fill' },
  { id: 'customer', label: 'Customer', icon: 'person.2.fill' },
  { id: 'supplier', label: 'Supplier', icon: 'shippingbox' },
] as const;

const ownerActionItems = [
  { id: 'sale', label: 'Sales', icon: 'cart.fill', androidIcon: 'point_of_sale' },
  { id: 'purchase', label: 'Purchase', icon: 'bag.fill', androidIcon: 'shopping_bag' },
  { id: 'return', label: 'Return', icon: 'arrow.uturn.backward', androidIcon: 'assignment_return' },
] as const;

type QuickAccessId = (typeof quickAccessItems)[number]['id'];
type QuickAccessCounts = Partial<Record<QuickAccessId, number>>;
type HomeMenu = 'quick-access' | 'favourites';

function isQuickAccessId(value: unknown): value is QuickAccessId {
  return typeof value === 'string' && quickAccessItems.some((item) => item.id === value);
}

function getGreeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 21) return 'Good Evening';
  return 'Good Night';
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseReturnDate(value: string) {
  const match = /^([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);
  if (match) {
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .indexOf(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0);
    const minute = Number(match[5]);
    const date = new Date(year, month, day, hour, minute);
    if (
      month >= 0
      && date.getFullYear() === year
      && date.getMonth() === month
      && date.getDate() === day
      && date.getHours() === hour
      && date.getMinutes() === minute
    ) {
      return date;
    }
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function parseOrderDate(value: string) {
  const match = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(value.trim());
  if (match) {
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .indexOf(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month >= 0) {
      const date = new Date(year, month, day);
      if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
        return date;
      }
    }
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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

function formatInvoiceTime(value: string) {
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

export default function OwnerHomeScreen() {
  const { ownerName, storeName, session } = useAuth();
  const router = useRouter();
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<PharmacyNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [updatingNotificationId, setUpdatingNotificationId] = useState<string | null>(null);
  const [todaySales, setTodaySales] = useState<TodaySalesSummary>({ amount: 0, invoiceCount: 0 });
  const [isLoadingTodaySales, setIsLoadingTodaySales] = useState(true);
  const [todaySalesError, setTodaySalesError] = useState('');
  const [latestInvoices, setLatestInvoices] = useState<LatestInvoice[]>([]);
  const [latestPurchaseOrders, setLatestPurchaseOrders] = useState<LatestPurchaseOrder[]>([]);
  const [latestReceiveOrders, setLatestReceiveOrders] = useState<LatestReceiveOrder[]>([]);
  const [latestReturns, setLatestReturns] = useState<LatestReturn[]>([]);
  const [isLoadingLatestInvoices, setIsLoadingLatestInvoices] = useState(true);
  const [latestInvoicesError, setLatestInvoicesError] = useState('');
  const [latestUpdatesRealtimeError, setLatestUpdatesRealtimeError] = useState('');
  const [selectedHomeMenu, setSelectedHomeMenu] = useState<HomeMenu>('quick-access');
  const [isQuickAccessExpanded, setIsQuickAccessExpanded] = useState(false);
  const [quickAccessCounts, setQuickAccessCounts] = useState<QuickAccessCounts>({});
  const [favouritesLoadedForKey, setFavouritesLoadedForKey] = useState<string | null>(null);
  const [favouritesError, setFavouritesError] = useState('');
  const favouritesStorageKey = session
    ? `pharmacy-owner-quick-access-counts-v1:${session.user.id}`
    : null;

  useEffect(() => {
    const interval = setInterval(() => setCurrentHour(new Date().getHours()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !session) {
      setNotificationError('Notifications are unavailable. Check your Supabase connection.');
      return;
    }

    setIsLoadingNotifications(true);
    setNotificationError('');

    try {
      const { data, error } = await supabase
        .from('pharmacy_notifications')
        .select('id, title, body, created_at, read_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data ?? []);
    } catch (error) {
      setNotificationError(
        error instanceof Error ? error.message : 'Could not load notifications.',
      );
    } finally {
      setIsLoadingNotifications(false);
    }
  }, [session]);

  const loadTodaySales = useCallback(async () => {
    if (!supabase || !session) {
      const message = 'Sales summary is unavailable. Check your Supabase connection.';
      setTodaySalesError(message);
      setLatestInvoicesError(message);
      setIsLoadingTodaySales(false);
      setIsLoadingLatestInvoices(false);
      return;
    }

    setIsLoadingTodaySales(true);
    setTodaySalesError('');
    setIsLoadingLatestInvoices(true);
    setLatestInvoicesError('');

    try {
      const [salesResult, purchaseOrderResult, receiveOrderResult, returnsResult] = await Promise.all([
        supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-sales-list-v1')
          .maybeSingle(),
        supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-place-order-list-v1')
          .maybeSingle(),
        supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-purchase-list-v1')
          .maybeSingle(),
        supabase
          .from('pharmacy_app_data')
          .select('payload')
          .eq('owner_user_id', session.user.id)
          .eq('data_key', 'pharmacy-return-records-v1')
          .maybeSingle(),
      ]);

      if (salesResult.error) throw salesResult.error;
      if (purchaseOrderResult.error) throw purchaseOrderResult.error;
      if (receiveOrderResult.error) throw receiveOrderResult.error;
      if (returnsResult.error) throw returnsResult.error;

      const payload: unknown = salesResult.data?.payload ?? [];
      const purchaseOrdersPayload: unknown = purchaseOrderResult.data?.payload ?? [];
      const receiveOrdersPayload: unknown = receiveOrderResult.data?.payload ?? [];
      const returnsPayload: unknown = returnsResult.data?.payload ?? [];
      if (
        !Array.isArray(payload)
        || !Array.isArray(purchaseOrdersPayload)
        || !Array.isArray(receiveOrdersPayload)
        || !Array.isArray(returnsPayload)
      ) {
        throw new Error('Saved sales, purchase order, or return data has an invalid format.');
      }

      const todayKey = getLocalDateKey(new Date());
      let amount = 0;
      let invoiceCount = 0;
      const savedInvoices: LatestInvoice[] = [];
      const latestOrderByNumber = new Map<string, LatestPurchaseOrder>();
      const latestReceiveOrderByNumber = new Map<string, LatestReceiveOrder>();
      const latestReturnById = new Map<string, LatestReturn>();

      for (const item of payload) {
        if (!item || typeof item !== 'object') {
          throw new Error('Saved sales data contains an invalid invoice.');
        }

        const invoice = item as Record<string, unknown>;
        if (
          typeof invoice.createdAt !== 'string'
          || typeof invoice.amount !== 'number'
          || !Number.isFinite(invoice.amount)
        ) {
          throw new Error('Saved sales data contains an invalid invoice.');
        }

        const createdAt = new Date(invoice.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
          throw new Error('Saved sales data contains an invalid invoice date.');
        }

        if (typeof invoice.invoice === 'string' && invoice.invoice.trim()) {
          const latestTimestamp = invoice.createdAt;
          if (getLocalDateKey(new Date(latestTimestamp)) === todayKey) {
            savedInvoices.push({
              id: typeof invoice.id === 'string' ? invoice.id : invoice.invoice,
              invoice: invoice.invoice,
              createdAt: latestTimestamp,
            });
          }
        }

        if (getLocalDateKey(createdAt) === todayKey) {
          amount += invoice.amount;
          invoiceCount += 1;
          if (!Number.isFinite(amount)) {
            throw new Error('Today’s sales total is too large to display.');
          }
        }
      }

      for (const item of purchaseOrdersPayload) {
        if (!item || typeof item !== 'object') {
          throw new Error('Saved purchase order data contains an invalid order.');
        }

        const row = item as Record<string, unknown>;
        const orderNumber = typeof row.order === 'string' ? row.order.trim() : '';
        if (!orderNumber) continue;

        const placedAt = typeof row.placedAt === 'string' ? row.placedAt : '';
        const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : '';
        const orderDate = typeof row.orderDate === 'string' ? row.orderDate : '';
        const placedTimestamp = Date.parse(placedAt);
        const updatedTimestamp = Date.parse(updatedAt);
        const parsedOrderDate = parseOrderDate(orderDate);
        const timestamp = Number.isFinite(placedTimestamp)
          ? placedTimestamp
          : Number.isFinite(updatedTimestamp)
            ? updatedTimestamp
            : parsedOrderDate?.getTime() ?? Number.NaN;
        if (!Number.isFinite(timestamp)) continue;

        const previous = latestOrderByNumber.get(orderNumber);
        if (!previous || timestamp > Date.parse(previous.createdAt)) {
          latestOrderByNumber.set(orderNumber, {
            order: orderNumber,
            createdAt: new Date(timestamp).toISOString(),
          });
        }
      }

      for (const item of receiveOrdersPayload) {
        if (!item || typeof item !== 'object') {
          throw new Error('Saved received order data contains an invalid order.');
        }

        const row = item as Record<string, unknown>;
        const orderNumber = typeof row.order === 'string' ? row.order.trim() : '';
        if (!orderNumber) continue;

        const receivedAt = typeof row.receivedAt === 'string' ? row.receivedAt : '';
        const orderDate = typeof row.orderDate === 'string' ? row.orderDate : '';
        const receivedTimestamp = Date.parse(receivedAt);
        const parsedOrderDate = parseOrderDate(orderDate);
        const timestamp = Number.isFinite(receivedTimestamp)
          ? receivedTimestamp
          : parsedOrderDate?.getTime() ?? Number.NaN;
        if (!Number.isFinite(timestamp)) continue;

        const previous = latestReceiveOrderByNumber.get(orderNumber);
        if (!previous || timestamp > Date.parse(previous.createdAt)) {
          latestReceiveOrderByNumber.set(orderNumber, {
            order: orderNumber,
            createdAt: new Date(timestamp).toISOString(),
          });
        }
      }

      for (const item of returnsPayload) {
        if (!item || typeof item !== 'object') {
          throw new Error('Saved return data contains an invalid return record.');
        }

        const record = item as Record<string, unknown>;
        const returnId = typeof record.returnId === 'string' && record.returnId.trim()
          ? record.returnId.trim()
          : typeof record.id === 'string'
            ? record.id.trim()
            : '';
        const returnDate = typeof record.date === 'string' ? record.date : '';
        const parsedDate = parseReturnDate(returnDate);
        if (!returnId || !parsedDate) continue;

        const createdAt = parsedDate.toISOString();
        if (getLocalDateKey(parsedDate) === todayKey) {
          const previous = latestReturnById.get(returnId);
          if (!previous || Date.parse(createdAt) > Date.parse(previous.createdAt)) {
            latestReturnById.set(returnId, { returnId, createdAt });
          }
        }
      }

      setTodaySales({ amount, invoiceCount });
      setLatestInvoices(
        savedInvoices
          .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt)),
      );
      setLatestPurchaseOrders(
        [...latestOrderByNumber.values()]
          .filter((order) => getLocalDateKey(new Date(order.createdAt)) === todayKey)
          .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt)),
      );
      setLatestReceiveOrders(
        [...latestReceiveOrderByNumber.values()]
          .filter((order) => getLocalDateKey(new Date(order.createdAt)) === todayKey)
          .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt)),
      );
      setLatestReturns(
        [...latestReturnById.values()].sort(
          (first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt),
        ),
      );
      setLatestInvoicesError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load saved sales.';
      setTodaySalesError(message);
      setLatestInvoicesError(message);
    } finally {
      setIsLoadingTodaySales(false);
      setIsLoadingLatestInvoices(false);
    }
  }, [session]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    void loadTodaySales();

    if (!supabase || !session) return;

    const latestUpdateDataKeys = new Set([
      'pharmacy-sales-list-v1',
      'pharmacy-place-order-list-v1',
      'pharmacy-purchase-list-v1',
      'pharmacy-return-records-v1',
    ]);
    const channel = supabase
      .channel(`owner-home-updates-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pharmacy_app_data',
          filter: `owner_user_id=eq.${session.user.id}`,
        },
        (change) => {
          const row = change.eventType === 'DELETE' ? change.old : change.new;
          if (typeof row.data_key === 'string' && latestUpdateDataKeys.has(row.data_key)) {
            void loadTodaySales();
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLatestUpdatesRealtimeError('');
          void loadTodaySales();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setLatestUpdatesRealtimeError(
            'Real-time updates are unavailable. Check the Supabase Realtime configuration.',
          );
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadTodaySales, session]);

  useEffect(() => {
    if (!favouritesStorageKey) return;

    let active = true;
    setFavouritesLoadedForKey(null);
    setFavouritesError('');
    const legacyFavouritesStorageKey = favouritesStorageKey.replace(
      'quick-access-counts-v1',
      'favourites-v1',
    );
    void AsyncStorage.getItem(favouritesStorageKey)
      .then((storedValue) => {
        if (!active) return;
        if (storedValue) {
          const parsed: unknown = JSON.parse(storedValue);
          const counts: QuickAccessCounts = {};

          if (Array.isArray(parsed)) {
            parsed.forEach((id: unknown) => {
              if (isQuickAccessId(id)) {
                counts[id] = 1;
              }
            });
          } else if (parsed && typeof parsed === 'object') {
            for (const item of quickAccessItems) {
              const count = (parsed as Record<string, unknown>)[item.id];
              if (count === undefined) continue;
              if (
                typeof count !== 'number'
                || !Number.isSafeInteger(count)
                || count < 0
              ) {
                throw new Error('Saved shortcut usage data has an invalid format.');
              }
              counts[item.id] = count;
            }
          } else {
            throw new Error('Saved shortcut usage data has an invalid format.');
          }
          setQuickAccessCounts(counts);
        } else {
          return AsyncStorage.getItem(legacyFavouritesStorageKey).then((legacyValue) => {
            if (!active) return;
            const legacyFavorites: unknown = legacyValue ? JSON.parse(legacyValue) : [];
            if (Array.isArray(legacyFavorites)) {
              const migratedCounts: QuickAccessCounts = {};
              legacyFavorites.forEach((id: unknown) => {
                if (isQuickAccessId(id)) migratedCounts[id] = 1;
              });
              setQuickAccessCounts(migratedCounts);
            } else {
              setQuickAccessCounts({});
            }
          });
        }
      })
      .then(() => {
        if (active) setFavouritesLoadedForKey(favouritesStorageKey);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setQuickAccessCounts({});
        setFavouritesLoadedForKey(favouritesStorageKey);
        setFavouritesError(
          error instanceof Error ? error.message : 'Could not load shortcut usage data.',
        );
      });

    return () => {
      active = false;
    };
  }, [favouritesStorageKey]);

  async function toggleReadState(notification: PharmacyNotification) {
    if (!supabase) {
      setNotificationError('Notifications are unavailable. Check your Supabase connection.');
      return;
    }

    setUpdatingNotificationId(notification.id);
    setNotificationError('');
    const readAt = notification.read_at ? null : new Date().toISOString();

    try {
      const { data, error } = await supabase
        .from('pharmacy_notifications')
        .update({ read_at: readAt })
        .eq('id', notification.id)
        .eq('user_id', session?.user.id ?? '')
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Notification could not be updated. Please refresh and try again.');

      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, read_at: readAt } : item,
        ),
      );
    } catch (error) {
      setNotificationError(
        error instanceof Error ? error.message : 'Could not update notification status.',
      );
    } finally {
      setUpdatingNotificationId(null);
    }
  }

  function openNotifications() {
    setIsNotificationsOpen(true);
    void loadNotifications();
  }

  async function openQuickAccess(itemId: QuickAccessId) {
    if (favouritesLoadedForKey === favouritesStorageKey) {
      const nextCounts = {
        ...quickAccessCounts,
        [itemId]: Math.min((quickAccessCounts[itemId] ?? 0) + 1, Number.MAX_SAFE_INTEGER),
      };
      setQuickAccessCounts(nextCounts);
      if (favouritesStorageKey) {
        try {
          await AsyncStorage.setItem(favouritesStorageKey, JSON.stringify(nextCounts));
          setFavouritesError('');
        } catch (error) {
          setFavouritesError(
            error instanceof Error ? error.message : 'Could not save shortcut usage data.',
          );
        }
      }
    }
    router.push(`/dashboard/${itemId}`);
  }

  const visibleQuickAccessItems = isQuickAccessExpanded
    ? quickAccessItems
    : quickAccessItems.slice(0, 3);
  const visibleFavouriteItems = quickAccessItems
    .filter((item) => (quickAccessCounts[item.id] ?? 0) > 0)
    .sort((first, second) =>
      (quickAccessCounts[second.id] ?? 0) - (quickAccessCounts[first.id] ?? 0),
    )
    .slice(0, 6);
  const visibleHomeMenuItems = selectedHomeMenu === 'quick-access'
    ? visibleQuickAccessItems
    : visibleFavouriteItems;
  const combinedLatestUpdates = [
    ...latestInvoices.map((invoice) => ({
      key: `invoice-${invoice.id}`,
      type: 'Sales',
      number: invoice.invoice,
      createdAt: invoice.createdAt,
    })),
    ...latestPurchaseOrders.map((order) => ({
      key: `order-${order.order}`,
      type: 'Pur. Order',
      number: order.order,
      createdAt: order.createdAt,
    })),
    ...latestReceiveOrders.map((order) => ({
      key: `receive-order-${order.order}`,
      type: 'Rec. Ord.',
      number: order.order,
      createdAt: order.createdAt,
    })),
    ...latestReturns.map((record) => ({
      key: `return-${record.returnId}-${record.createdAt}`,
      type: 'Return',
      number: record.returnId,
      createdAt: record.createdAt,
    })),
  ]
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
    .slice(0, 5);

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  return (
    <>
      <StatusBar
        style={isNotificationsOpen ? 'dark' : 'light'}
        backgroundColor={isNotificationsOpen ? '#f7f8f4' : '#145642'}
      />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <ScrollView
        style={styles.dashboardScroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.ownerHero}>
          <View style={styles.topBar}>
            <View style={styles.storeIdentity}>
              <Image
                source={require('../../../../public/pharmacy-icon.png')}
                contentFit="contain"
                style={styles.storeIcon}
                accessibilityLabel="Pharmacy Cluster icon"
              />
              <Text numberOfLines={1} style={styles.storeName}>
                {storeName || 'My Pharmacy'}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : 'Notifications'
              }
              onPress={openNotifications}
              style={({ pressed }) => [
                styles.notificationButton,
                pressed && styles.notificationButtonPressed,
              ]}>
              <SymbolView
                name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                size={18}
                tintColor="#245744"
              />
              {unreadCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          <View style={styles.greetingDecoration} />
          <Text style={styles.greeting}>{getGreeting(currentHour)}</Text>
          <Text numberOfLines={2} style={styles.ownerName}>
            {ownerName || 'Owner'}
          </Text>
        </View>

        <View style={styles.todaySalesCard}>
          <View style={styles.todaySalesHeadingRow}>
            <Text style={styles.todaySalesTitle}>Today&apos;s Sale</Text>
            <View style={styles.todaySalesIcon}>
              <SymbolView
                name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }}
                size={17}
                tintColor="#17664f"
              />
            </View>
          </View>
          {todaySalesError ? (
            <View style={styles.todaySalesErrorRow}>
              <Text style={styles.todaySalesError}>{todaySalesError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadTodaySales()}>
                <Text style={styles.todaySalesRetry}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.todaySalesTotalRow}>
                <Text style={styles.todaySalesLabel}>Total</Text>
                <Text style={styles.todaySalesLabel}>-</Text>
                <Text style={styles.todaySalesAmount}>
                  {isLoadingTodaySales ? 'Loading…' : formatCurrency(todaySales.amount)}
                </Text>
              </View>
              <Text style={styles.todaySalesInvoiceCount}>
                {isLoadingTodaySales
                  ? 'Loading invoices…'
                  : `${todaySales.invoiceCount.toLocaleString('en-BD')} ${
                    todaySales.invoiceCount === 1 ? 'invoice' : 'invoices'
                  }`}
              </Text>
            </>
          )}
        </View>

        <View style={styles.homeMenus}>
          <View style={styles.homeMenuTabs}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedHomeMenu === 'quick-access' }}
              onPress={() => setSelectedHomeMenu('quick-access')}
              style={[
                styles.homeMenuTab,
              ]}>
              <Text
                style={[
                  styles.homeMenuTabText,
                  selectedHomeMenu === 'quick-access' && styles.homeMenuTabTextSelected,
                ]}>
                Quick Access
              </Text>
              {selectedHomeMenu === 'quick-access' ? (
                <View style={styles.homeMenuTabIndicator} />
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedHomeMenu === 'favourites' }}
              onPress={() => setSelectedHomeMenu('favourites')}
              style={[
                styles.homeMenuTab,
              ]}>
              <Text
                style={[
                  styles.homeMenuTabText,
                  selectedHomeMenu === 'favourites' && styles.homeMenuTabTextSelected,
                ]}>
                Favourites
              </Text>
              {selectedHomeMenu === 'favourites' ? (
                <View style={styles.homeMenuTabIndicator} />
              ) : null}
            </Pressable>
          </View>

          {favouritesError ? (
            <View style={styles.favouritesErrorBox}>
              <Text style={styles.favouritesErrorText}>{favouritesError}</Text>
            </View>
          ) : null}

          {visibleHomeMenuItems.length > 0 ? (
            <View style={styles.quickAccessGrid}>
              {visibleHomeMenuItems.map((item) => {
                return (
                  <View key={item.id} style={styles.quickAccessCell}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      disabled={favouritesLoadedForKey !== favouritesStorageKey}
                      onPress={() => void openQuickAccess(item.id)}
                      style={({ pressed }) => [
                        styles.quickAccessButton,
                        favouritesLoadedForKey !== favouritesStorageKey
                          && styles.quickAccessButtonDisabled,
                        pressed && styles.quickAccessButtonPressed,
                      ]}>
                      <SymbolView
                        name={{
                          ios: item.icon,
                          android: item.id === 'overview'
                            ? 'dashboard'
                            : item.id === 'inventory'
                              ? 'inventory_2'
                              : item.id === 'reports'
                                ? 'assessment'
                                : item.id === 'invoice'
                                  ? 'receipt_long'
                                  : item.id === 'customer'
                                    ? 'people'
                                    : 'local_shipping',
                          web: 'circle.grid.2x2.fill',
                        }}
                        size={19}
                        tintColor="#17664f"
                      />
                      <Text numberOfLines={1} style={styles.quickAccessLabel}>
                        {item.label}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.favouritesEmpty}>
              <Text style={styles.favouritesEmptyTitle}>No favourites yet</Text>
              <Text style={styles.favouritesEmptyText}>
                Open shortcuts from Quick Access to add them here.
              </Text>
            </View>
          )}

          {selectedHomeMenu === 'quick-access' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isQuickAccessExpanded ? 'Show fewer shortcuts' : 'Show all shortcuts'}
              accessibilityState={{ expanded: isQuickAccessExpanded }}
              onPress={() => setIsQuickAccessExpanded((expanded) => !expanded)}
              style={styles.quickAccessExpandButton}>
              <SymbolView
                name={{
                  ios: isQuickAccessExpanded ? 'chevron.up' : 'chevron.down',
                  android: isQuickAccessExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                  web: isQuickAccessExpanded ? 'expand_less' : 'expand_more',
                }}
                size={19}
                tintColor="#17664f"
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.ownerActionButtons}>
          {ownerActionItems.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => router.push(`/dashboard/${item.id}`)}
              style={({ pressed }) => [
                styles.ownerActionButton,
                pressed && styles.ownerActionButtonPressed,
              ]}>
              <SymbolView
                name={{ ios: item.icon, android: item.androidIcon, web: 'circle.grid.2x2.fill' }}
                size={18}
                tintColor="#17664f"
              />
              <Text numberOfLines={1} style={styles.ownerActionButtonText}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.latestInvoicesSection}>
          <Text style={styles.latestInvoicesTitle}>Latest Update</Text>
          {isLoadingLatestInvoices ? (
            <ActivityIndicator size="small" color="#17664f" />
          ) : latestInvoicesError ? (
            <Text style={styles.latestInvoicesMessage}>{latestInvoicesError}</Text>
          ) : (
            <>
              {combinedLatestUpdates.length > 0 ? (
                <View style={styles.latestInvoicesList}>
                  {combinedLatestUpdates.map((item) => (
                    <View key={item.key} style={styles.latestInvoiceRow}>
                      <View style={styles.latestInvoiceDetails}>
                        <Text style={styles.latestInvoiceType}>{item.type}</Text>
                        <Text style={styles.latestInvoiceNumber}>{item.number}</Text>
                      </View>
                      <Text style={styles.latestInvoiceTime}>{formatInvoiceTime(item.createdAt)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.latestInvoicesMessage}>No data</Text>
              )}
            </>
          )}
          {latestUpdatesRealtimeError ? (
            <Text style={styles.latestInvoicesMessage}>{latestUpdatesRealtimeError}</Text>
          ) : null}
        </View>

      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsNotificationsOpen(false)}
        presentationStyle="pageSheet"
        visible={isNotificationsOpen}>
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>STAY UP TO DATE</Text>
              <Text style={styles.modalTitle}>Notifications</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notifications"
              onPress={() => setIsNotificationsOpen(false)}
              style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          {notificationError ? (
            <View style={styles.notificationErrorBox}>
              <Text style={styles.notificationError}>{notificationError}</Text>
              <Pressable onPress={() => void loadNotifications()} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {isLoadingNotifications ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#17664f" />
              <Text style={styles.emptyText}>Loading notifications…</Text>
            </View>
          ) : notifications.length === 0 && !notificationError ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <SymbolView
                  name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                  size={23}
                  tintColor="#47826b"
                />
              </View>
              <Text style={styles.emptyTitle}>You’re all caught up</Text>
              <Text style={styles.emptyText}>New pharmacy updates will appear here.</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.notificationList}
              showsVerticalScrollIndicator={false}>
              {notifications.map((notification) => {
                const isUnread = !notification.read_at;
                const isUpdating = updatingNotificationId === notification.id;

                return (
                  <View
                    key={notification.id}
                    style={[styles.notificationCard, isUnread && styles.unreadNotificationCard]}>
                    <View style={styles.notificationHeading}>
                      <View
                        style={[
                          styles.notificationStatusDot,
                          isUnread ? styles.unreadStatusDot : styles.readStatusDot,
                        ]}
                      />
                      <Text style={styles.notificationTitle}>{notification.title}</Text>
                    </View>
                    {notification.body ? (
                      <Text style={styles.notificationBody}>{notification.body}</Text>
                    ) : null}
                    <View style={styles.notificationFooter}>
                      <Text style={styles.notificationDate}>
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
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#145642',
  },
  dashboardScroll: {
    backgroundColor: '#f2f4ef',
  },
  content: {
    width: '100%',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 30,
  },
  ownerHero: {
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 50,
    borderRadius: 0,
    backgroundColor: '#145642',
  },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  storeIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  storeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fffefa',
  },
  storeName: {
    flexShrink: 1,
    color: '#fffdf7',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  notificationButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#fffefa',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationButtonPressed: {
    opacity: 0.72,
  },
  unreadBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#d9483b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#145642',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  greetingDecoration: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(235, 248, 218, 0.16)',
    right: -55,
    top: -75,
  },
  greeting: {
    marginTop: 22,
    color: '#fffdf7',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.9,
  },
  ownerName: {
    marginTop: 3,
    color: '#fffdf7',
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '400',
    letterSpacing: -1.1,
  },
  todaySalesCard: {
    marginHorizontal: 18,
    marginTop: -28,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 18,
    backgroundColor: '#fffefa',
  },
  todaySalesHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  todaySalesTitle: {
    color: '#183c31',
    fontSize: 16,
    fontWeight: '700',
  },
  todaySalesIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#eff8e6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todaySalesLabel: {
    color: '#758078',
    fontSize: 12,
  },
  todaySalesTotalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginTop: 8,
  },
  todaySalesAmount: {
    color: '#183c31',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  todaySalesInvoiceCount: {
    marginTop: 4,
    color: '#758078',
    fontSize: 12,
  },
  todaySalesErrorRow: {
    marginTop: 14,
    gap: 8,
  },
  todaySalesError: {
    color: '#a63e34',
    fontSize: 12,
    lineHeight: 18,
  },
  todaySalesRetry: {
    color: '#17664f',
    fontSize: 12,
    fontWeight: '700',
  },
  homeMenus: {
    marginHorizontal: 18,
    marginTop: 6,
    marginBottom: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 18,
    backgroundColor: '#fffefa',
  },
  homeMenuTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  homeMenuTab: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  homeMenuTabText: {
    color: '#758078',
    fontSize: 12,
    fontWeight: '600',
  },
  homeMenuTabTextSelected: {
    color: '#17664f',
  },
  homeMenuTabIndicator: {
    position: 'absolute',
    right: 12,
    bottom: 0,
    left: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#17664f',
  },
  quickAccessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  quickAccessCell: {
    width: '33.333%',
    position: 'relative',
    alignItems: 'center',
  },
  quickAccessButton: {
    width: '100%',
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 4,
  },
  quickAccessButtonPressed: {
    opacity: 0.7,
  },
  quickAccessButtonDisabled: {
    opacity: 0.45,
  },
  quickAccessLabel: {
    maxWidth: '100%',
    color: '#315b47',
    fontSize: 10,
    fontWeight: '600',
  },
  quickAccessExpandButton: {
    alignSelf: 'center',
    width: 36,
    height: 30,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favouritesEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  favouritesEmptyTitle: {
    color: '#315b47',
    fontSize: 13,
    fontWeight: '700',
  },
  favouritesEmptyText: {
    marginTop: 5,
    color: '#758078',
    fontSize: 11,
    textAlign: 'center',
  },
  favouritesErrorBox: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#fff3f0',
  },
  favouritesErrorText: {
    color: '#a63e34',
    fontSize: 11,
    lineHeight: 16,
  },
  ownerActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    marginTop: -12,
    marginBottom: 4,
  },
  ownerActionButton: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 14,
    backgroundColor: '#fffefa',
  },
  ownerActionButtonPressed: {
    opacity: 0.7,
  },
  ownerActionButtonText: {
    color: '#315b47',
    fontSize: 10,
    fontWeight: '600',
  },
  latestInvoicesSection: {
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 24,
  },
  latestInvoicesTitle: {
    marginBottom: 8,
    color: '#183c31',
    fontSize: 15,
    fontWeight: '700',
  },
  latestInvoicesList: {
    gap: 6,
  },
  latestInvoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 10,
    backgroundColor: '#fffefa',
  },
  latestInvoiceDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  latestInvoiceType: {
    color: '#758078',
    fontSize: 11,
    fontWeight: '600',
  },
  latestInvoiceNumber: {
    color: '#315b47',
    fontSize: 12,
    fontWeight: '600',
  },
  latestInvoiceTime: {
    color: '#758078',
    fontSize: 11,
  },
  latestInvoicesMessage: {
    color: '#758078',
    fontSize: 12,
  },
  modalSafeArea: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 14,
    backgroundColor: '#f7f8f4',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalEyebrow: {
    color: '#47826b',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  modalTitle: {
    marginTop: 5,
    color: '#183c31',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#eaf0e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    marginTop: -2,
    color: '#315b47',
    fontSize: 27,
    fontWeight: '400',
  },
  notificationErrorBox: {
    padding: 13,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0c9c2',
    backgroundColor: '#fff3f0',
  },
  notificationError: {
    color: '#a63e34',
    fontSize: 12,
    lineHeight: 18,
  },
  retryText: {
    marginTop: 8,
    color: '#17664f',
    fontSize: 12,
    fontWeight: '800',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 50,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    marginBottom: 15,
    borderRadius: 19,
    backgroundColor: '#eaf3e7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#183c31',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    marginTop: 6,
    color: '#758078',
    fontSize: 12,
    textAlign: 'center',
  },
  notificationList: {
    paddingBottom: 28,
    gap: 12,
  },
  notificationCard: {
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e6ebe4',
    backgroundColor: '#fffefa',
  },
  unreadNotificationCard: {
    borderColor: '#b8d8c2',
    backgroundColor: '#fbfef8',
  },
  notificationHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  notificationStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unreadStatusDot: {
    backgroundColor: '#2a9a6c',
  },
  readStatusDot: {
    backgroundColor: '#c5cdc5',
  },
  notificationTitle: {
    flex: 1,
    color: '#20392d',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  notificationBody: {
    marginTop: 8,
    marginLeft: 17,
    color: '#68776e',
    fontSize: 12,
    lineHeight: 18,
  },
  notificationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 13,
    marginLeft: 17,
  },
  notificationDate: {
    color: '#8b968e',
    fontSize: 10,
  },
  readAction: {
    color: '#17664f',
    fontSize: 10,
    fontWeight: '800',
  },
  disabledText: {
    opacity: 0.5,
  },
});
