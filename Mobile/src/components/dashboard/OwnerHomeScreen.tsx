import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  ActivityIndicator,
  Modal,
  PanResponder,
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

type PharmacyActivity = {
  id: string;
  event_type: string;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_username: string;
  actor_photo_url: string | null;
};

type ExpiredBatch = {
  id: string;
  brand: string;
  supplier: string;
  batchNumber: string;
  totalQuantity: string;
  price: string;
  updatedAt: string;
  order: string;
};

type CurrentPlan = {
  id: string;
  name: string;
  setup_fee_label: string;
  setup_fee: number;
  recurring_fee: number;
  billing_period: 'minutes' | 'days' | 'month' | 'year' | 'one-time';
  billing_interval: number;
  description: string;
};

type CurrentSubscription = {
  plan: CurrentPlan | null;
  is_assigned: boolean;
  status: 'Active' | 'Inactive' | 'Past Due' | null;
  expires_at: string | null;
};

function ExpiredBatchCard({
  batch,
  isDestroying,
  onSwipeDestroy,
}: {
  batch: ExpiredBatch;
  isDestroying: boolean;
  onSwipeDestroy: (batchId: string) => void;
}) {
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        gestureState.dx > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
      onPanResponderRelease: (_event, gestureState) => {
        if (!isDestroying && gestureState.dx >= 90) onSwipeDestroy(batch.id);
      },
    }),
    [batch.id, isDestroying, onSwipeDestroy],
  );

  return (
    <View {...panResponder.panHandlers} style={styles.expiredBatchCard}>
      {([
        ['Brand Name', batch.brand],
        ['Supplier', batch.supplier],
        ['Batch', batch.batchNumber],
        ['Quantity', batch.totalQuantity],
        ['Price', batch.price],
      ] as const).map(([label, value]) => (
        <View
          key={label}
          style={[
            styles.expiredBatchField,
            label === 'Brand Name' || label === 'Supplier'
              ? styles.expiredBatchFirstRowField
              : styles.expiredBatchSecondRowField,
          ]}>
          <View style={styles.expiredBatchInlineField}>
            <Text style={styles.expiredBatchLabel}>{label} -</Text>
            <Text
              style={[
                styles.expiredBatchValue,
                (label === 'Batch' || label === 'Quantity' || label === 'Price')
                  && styles.expiredBatchValueAlert,
              ]}>
              {value || '-'}
            </Text>
          </View>
        </View>
      ))}
      {isDestroying ? (
        <Text style={styles.expiredBatchSwipeHint}>Destroying…</Text>
      ) : null}
    </View>
  );
}

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
type ActivityMenu = 'latest-update' | 'expired' | 'subscription';

let realtimeChannelInstance = 0;

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

function getPackSizeMultiplier(packSize: string) {
  const normalizedPackSize = packSize
    .trim()
    .replace(/['’]s\s+pack$/i, '')
    .replace(/['’]s$/i, '')
    .replace(/\s+pack$/i, '');
  if (!normalizedPackSize) return null;

  const factors = normalizedPackSize.split(/\s*[xX×]\s*/);
  if (factors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))) return null;

  const multiplier = factors.reduce((total, factor) => total * Number(factor), 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function isExpiredDate(value: string, currentMonthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const currentMonthMatch = /^(\d{4})-(\d{2})$/.exec(currentMonthKey);
  if (!match || !currentMonthMatch) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const currentYear = Number(currentMonthMatch[1]);
  const currentMonth = Number(currentMonthMatch[2]);
  if (month < 1 || month > 12 || currentMonth < 1 || currentMonth > 12) return false;

  return year * 12 + month < currentYear * 12 + currentMonth;
}

function getAvailableQuantity(row: Record<string, unknown>, packSize: string) {
  if (typeof row.availableQuantity === 'string') {
    const quantity = Number(row.availableQuantity);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  }
  if (typeof row.quantity !== 'string' || !row.quantity.trim() || !packSize.trim()) return null;

  const quantity = Number(row.quantity);
  const packMultiplier = getPackSizeMultiplier(packSize);
  if (!Number.isFinite(quantity) || quantity < 0 || packMultiplier === null) return null;
  const totalQuantity = quantity * packMultiplier;
  return Number.isFinite(totalQuantity)
    ? Number(totalQuantity.toFixed(4))
    : null;
}

function formatQuantity(value: number | null) {
  return value === null ? '-' : value.toLocaleString('en-BD', { maximumFractionDigits: 4 });
}

function getExpiredStockPrice(row: Record<string, unknown>, totalQuantity: number | null) {
  if (totalQuantity === null) return '-';

  const savedUnitPrice = typeof row.unitPurchasePrice === 'string'
    && row.unitPurchasePrice.trim()
    && row.unitPurchasePrice.trim() !== '-'
    ? Number(row.unitPurchasePrice)
    : Number.NaN;
  let unitPrice = savedUnitPrice;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    const packSize = typeof row.packSize === 'string' ? row.packSize : '';
    const packMultiplier = getPackSizeMultiplier(packSize);
    const boxQuantity = typeof row.quantity === 'string' ? Number(row.quantity) : Number.NaN;
    const totalPrice = typeof row.totalPrice === 'string' ? Number(row.totalPrice) : Number.NaN;
    if (
      packMultiplier === null
      || !Number.isFinite(boxQuantity)
      || boxQuantity <= 0
      || !Number.isFinite(totalPrice)
      || totalPrice < 0
    ) return '-';
    unitPrice = totalPrice / boxQuantity / packMultiplier;
  }

  const stockPrice = totalQuantity * unitPrice;
  return Number.isFinite(stockPrice)
    ? `৳${stockPrice.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
}

function formatCurrency(amount: number) {
  return `৳${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isCurrentPlan(value: unknown): value is CurrentPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === 'string'
    && typeof plan.name === 'string'
    && typeof plan.setup_fee_label === 'string'
    && typeof plan.setup_fee === 'number'
    && typeof plan.recurring_fee === 'number'
    && ['minutes', 'days', 'month', 'year', 'one-time'].includes(String(plan.billing_period))
    && typeof plan.billing_interval === 'number'
    && typeof plan.description === 'string';
}

function isCurrentSubscription(value: unknown): value is CurrentSubscription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const subscription = value as Record<string, unknown>;
  return typeof subscription.is_assigned === 'boolean'
    && (subscription.status === null
      || ['Active', 'Inactive', 'Past Due'].includes(String(subscription.status)))
    && (subscription.expires_at === null || typeof subscription.expires_at === 'string')
    && (subscription.plan === null || isCurrentPlan(subscription.plan));
}

function formatPlanPeriod(plan: CurrentPlan) {
  if (plan.billing_period === 'one-time') return 'one-time';
  const unit = plan.billing_period === 'minutes'
    ? 'minute'
    : plan.billing_period === 'days'
      ? 'day'
      : plan.billing_period === 'year'
        ? 'year'
        : 'month';
  return `${plan.billing_interval} ${unit}${plan.billing_interval === 1 ? '' : 's'}`;
}

function formatPlanExpiry(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

export default function OwnerHomeScreen() {
  const { dashboardRole, ownerName, storeName, session } = useAuth();
  const router = useRouter();
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now());
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const [currentDateKey, setCurrentDateKey] = useState(() => getLocalDateKey(new Date()));
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<PharmacyNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [updatingNotificationId, setUpdatingNotificationId] = useState<string | null>(null);
  const [todaySales, setTodaySales] = useState<TodaySalesSummary>({ amount: 0, invoiceCount: 0 });
  const [isLoadingTodaySales, setIsLoadingTodaySales] = useState(true);
  const [todaySalesError, setTodaySalesError] = useState('');
  const [activities, setActivities] = useState<PharmacyActivity[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(true);
  const [activitiesError, setActivitiesError] = useState('');
  const [activitiesRealtimeError, setActivitiesRealtimeError] = useState('');
  const [isActivitiesRealtimeConnected, setIsActivitiesRealtimeConnected] = useState(false);
  const [expiredBatches, setExpiredBatches] = useState<ExpiredBatch[]>([]);
  const [isLoadingExpiredBatches, setIsLoadingExpiredBatches] = useState(true);
  const [expiredBatchesError, setExpiredBatchesError] = useState('');
  const [destroyingExpiredBatchId, setDestroyingExpiredBatchId] = useState<string | null>(null);
  const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
  const [isLoadingCurrentSubscription, setIsLoadingCurrentSubscription] = useState(true);
  const [currentSubscriptionError, setCurrentSubscriptionError] = useState('');
  const [isClaimingExtendedAccess, setIsClaimingExtendedAccess] = useState(false);
  const [selectedHomeMenu, setSelectedHomeMenu] = useState<HomeMenu>('quick-access');
  const [selectedActivityMenu, setSelectedActivityMenu] = useState<ActivityMenu>('latest-update');
  const [isQuickAccessExpanded, setIsQuickAccessExpanded] = useState(false);
  const [quickAccessCounts, setQuickAccessCounts] = useState<QuickAccessCounts>({});
  const [favouritesLoadedForKey, setFavouritesLoadedForKey] = useState<string | null>(null);
  const [favouritesError, setFavouritesError] = useState('');
  const favouritesStorageKey = session
    ? `pharmacy-owner-quick-access-counts-v1:${session.user.id}`
    : null;

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentHour(now.getHours());
      setCurrentTimestamp(now.getTime());
      setCurrentDateKey(getLocalDateKey(now));
    }, 60_000);
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
    const client = supabase;
    if (!client || !session) {
      const message = 'Sales summary is unavailable. Check your Supabase connection.';
      setTodaySalesError(message);
      setIsLoadingTodaySales(false);
      return;
    }

    setIsLoadingTodaySales(true);
    setTodaySalesError('');

    try {
      const salesResult = await client
        .from('pharmacy_app_data')
        .select('payload')
        .eq('owner_user_id', session.user.id)
        .eq('data_key', 'pharmacy-sales-list-v1')
        .maybeSingle();

      if (salesResult.error) throw salesResult.error;

      const payload: unknown = salesResult.data?.payload ?? [];
      if (!Array.isArray(payload)) throw new Error('Saved sales data has an invalid format.');

      const todayKey = getLocalDateKey(new Date());
      let amount = 0;
      let invoiceCount = 0;

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

        if (getLocalDateKey(createdAt) === todayKey) {
          amount += invoice.amount;
          invoiceCount += 1;
          if (!Number.isFinite(amount)) {
            throw new Error('Today’s sales total is too large to display.');
          }
        }
      }

      setTodaySales({ amount, invoiceCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load saved sales.';
      setTodaySalesError(message);
    } finally {
      setIsLoadingTodaySales(false);
    }
  }, [session]);

  const loadTodayActivities = useCallback(async () => {
    const client = supabase;
    if (!client || !session) {
      setActivitiesError('Activity history is unavailable. Check your Supabase connection.');
      setIsLoadingActivities(false);
      return;
    }

    setIsLoadingActivities(true);
    setActivitiesError('');
    const [year, month, day] = currentDateKey.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month - 1, day + 1);

    try {
      const { data, error } = await client.rpc('get_pharmacy_activity_for_day', {
        requested_start: start.toISOString(),
        requested_end: end.toISOString(),
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Activity history has an invalid format.');

      const loadedActivities = data.map((value: unknown): PharmacyActivity => {
        if (!value || typeof value !== 'object') {
          throw new Error('Activity history contains an invalid record.');
        }
        const row = value as Record<string, unknown>;
        if (
          typeof row.id !== 'string'
          || typeof row.event_type !== 'string'
          || typeof row.title !== 'string'
          || typeof row.description !== 'string'
          || !row.metadata
          || typeof row.metadata !== 'object'
          || Array.isArray(row.metadata)
          || typeof row.created_at !== 'string'
          || typeof row.actor_username !== 'string'
          || (row.actor_photo_url !== null && typeof row.actor_photo_url !== 'string')
          || Number.isNaN(Date.parse(row.created_at))
        ) {
          throw new Error('Activity history contains an invalid record.');
        }
        return {
          id: row.id,
          event_type: row.event_type,
          title: row.title,
          description: row.description,
          metadata: row.metadata as Record<string, unknown>,
          created_at: row.created_at,
          actor_username: row.actor_username,
          actor_photo_url: row.actor_photo_url,
        };
      });
      setActivities(loadedActivities);
    } catch (error) {
      setActivitiesError(
        error instanceof Error ? error.message : 'Could not load today’s activity.',
      );
    } finally {
      setIsLoadingActivities(false);
    }
  }, [currentDateKey, session]);

  const loadExpiredBatches = useCallback(async () => {
    const client = supabase;
    if (!client || !session) {
      setExpiredBatchesError('Expired inventory is unavailable. Check your Supabase connection.');
      setIsLoadingExpiredBatches(false);
      return;
    }
    setIsLoadingExpiredBatches(true);
    setExpiredBatchesError('');
    const currentMonthKey = currentDateKey.slice(0, 7);

    try {
      const { data, error } = await client
        .from('pharmacy_app_data')
        .select('payload')
        .eq('owner_user_id', session.user.id)
        .eq('data_key', 'pharmacy-purchase-list-v1')
        .maybeSingle();
      if (error) throw error;

      const payload: unknown = data?.payload ?? [];
      if (!Array.isArray(payload)) {
        throw new Error('Saved inventory data has an invalid format.');
      }

      const rows = payload.map((value: unknown): ExpiredBatch | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Saved inventory contains an invalid batch.');
        }

        const row = value as Record<string, unknown>;
        if (
          typeof row.id !== 'string'
          || typeof row.batchNumber !== 'string'
          || typeof row.supplier !== 'string'
          || typeof row.expDate !== 'string'
          || typeof row.packSize !== 'string'
          || (row.brand !== undefined && typeof row.brand !== 'string')
          || (row.medicine_name !== undefined && typeof row.medicine_name !== 'string')
          || (row.quantity !== undefined && typeof row.quantity !== 'string')
          || (row.availableQuantity !== undefined && typeof row.availableQuantity !== 'string')
        ) {
          throw new Error('Saved inventory contains an invalid batch.');
        }
        if (!isExpiredDate(row.expDate, currentMonthKey)) return null;

        const totalQuantity = getAvailableQuantity(row, row.packSize);
        return {
          id: row.id,
          brand: typeof row.brand === 'string' && row.brand.trim()
            ? row.brand
            : typeof row.medicine_name === 'string' ? row.medicine_name : '-',
          supplier: row.supplier,
          batchNumber: row.batchNumber,
          totalQuantity: formatQuantity(totalQuantity),
          price: getExpiredStockPrice(row, totalQuantity),
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
          order: typeof row.order === 'string' ? row.order : '',
        };
      });

      setExpiredBatches(
        rows
          .filter((row): row is ExpiredBatch => row !== null)
          .sort((first, second) => {
            const timeDifference = Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
            return Number.isFinite(timeDifference) && timeDifference !== 0
              ? timeDifference
              : second.order.localeCompare(first.order);
          }),
      );
    } catch (error) {
      setExpiredBatchesError(
        error instanceof Error ? error.message : 'Could not load expired inventory.',
      );
    } finally {
      setIsLoadingExpiredBatches(false);
    }
  }, [currentDateKey, session]);

  const loadCurrentSubscription = useCallback(async () => {
    const client = supabase;
    if (!client || !session) {
      setCurrentSubscriptionError('Current plan is unavailable. Check your Supabase connection.');
      setIsLoadingCurrentSubscription(false);
      return;
    }
    setIsLoadingCurrentSubscription(true);
    setCurrentSubscriptionError('');

    try {
      const { data, error } = await client.rpc('get_pharmacy_home_current_plan');
      if (error) throw error;
      if (!isCurrentSubscription(data)) {
        throw new Error('The current plan returned by Supabase is invalid.');
      }
      setCurrentSubscription(data);
    } catch (error) {
      setCurrentSubscriptionError(
        error instanceof Error ? error.message : 'Could not load the current plan.',
      );
    } finally {
      setIsLoadingCurrentSubscription(false);
    }
  }, [session]);

  const handleClaimExtendedAccess = useCallback(async () => {
    if (!supabase) {
      Alert.alert('Could not activate Extended Access', 'Supabase is not configured.');
      return;
    }
    setIsClaimingExtendedAccess(true);
    try {
      const { error } = await supabase.rpc('claim_my_pharmacy_extended_access');
      if (error) throw error;
      await loadCurrentSubscription();
    } catch (error) {
      Alert.alert(
        'Could not activate Extended Access',
        error instanceof Error ? error.message : 'Could not activate Extended Access.',
      );
    } finally {
      setIsClaimingExtendedAccess(false);
    }
  }, [loadCurrentSubscription]);

  const handleSwipeDestroyExpiredBatch = useCallback((batchId: string) => {
    const batch = expiredBatches.find((item) => item.id === batchId);
    if (!batch || destroyingExpiredBatchId) return;
    const client = supabase;
    if (!client || !session) {
      Alert.alert('Could not destroy batch', 'Sign in and check your Supabase connection, then try again.');
      return;
    }

    Alert.alert(
      'Destroy expired batch?',
      `Destroy ${batch.brand}, batch ${batch.batchNumber} and record its value as a Destroy expense?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Destroy',
          style: 'destructive',
          onPress: () => {
            setDestroyingExpiredBatchId(batchId);
            void (async () => {
              const { error } = await client.rpc('destroy_pharmacy_expired_inventory_batch', {
                requested_batch_id: batchId,
              });
              if (error) throw error;
              await loadExpiredBatches();
            })()
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not destroy batch',
                  error instanceof Error ? error.message : 'Could not destroy this expired batch.',
                );
              })
              .finally(() => setDestroyingExpiredBatchId(null));
          },
        },
      ],
    );
  }, [destroyingExpiredBatchId, expiredBatches, loadExpiredBatches, session]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    void loadTodaySales();

    const client = supabase;
    if (!client || !session) return;

    const channel = client
      .channel(`owner-home-updates-${session.user.id}-${++realtimeChannelInstance}`)
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
          if (row.data_key === 'pharmacy-sales-list-v1') {
            void loadTodaySales();
          }
          if (row.data_key === 'pharmacy-purchase-list-v1') {
            void loadExpiredBatches();
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void loadTodaySales();
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadExpiredBatches, loadTodaySales, session]);

  useEffect(() => {
    void Promise.resolve().then(loadTodayActivities);
    void Promise.resolve().then(loadExpiredBatches);

    const client = supabase;
    if (!client || !session) return;

    const channel = client
      .channel(`owner-home-activity-${session.user.id}-${++realtimeChannelInstance}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pharmacy_activity_feed',
          filter: `owner_user_id=eq.${session.user.id}`,
        },
        () => void loadTodayActivities(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsActivitiesRealtimeConnected(true);
          setActivitiesRealtimeError('');
          void loadTodayActivities();
        } else if (
          status === 'CHANNEL_ERROR'
          || status === 'TIMED_OUT'
          || status === 'CLOSED'
        ) {
          setIsActivitiesRealtimeConnected(false);
          setActivitiesRealtimeError(
            'Live activity updates are unavailable. Check the Supabase Realtime configuration.',
          );
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadExpiredBatches, loadTodayActivities, loadTodaySales, session]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadTodayActivities();
    });
    return () => subscription.remove();
  }, [loadTodayActivities]);

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
    if (itemId === 'reports') {
      router.push('/reports');
    } else if (itemId === 'invoice') {
      router.push('/invoice');
    } else if (itemId === 'customer') {
      router.push('/customer');
    } else if (itemId === 'supplier') {
      router.push('/supplier');
    } else {
      router.push(`/dashboard/${itemId}`);
    }
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
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.stickyDashboardHeader}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open recorded payments"
                onPress={() => router.push('/recorded-payments')}
                style={styles.todaySalesIcon}>
                <SymbolView
                  name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                  size={18}
                  tintColor="#17664f"
                />
              </Pressable>
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
              onPress={() => router.push(
                item.id === 'sale' ? '/sales' : item.id === 'return' ? '/return' : '/purchase',
              )}
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

        <View style={styles.activitySection}>
          <View style={styles.activityMenuHeader}>
            <View style={styles.activityTabs}>
              {([
                { id: 'latest-update', label: 'Latest Update' },
                { id: 'expired', label: 'Expired' },
                { id: 'subscription', label: 'Subscription' },
              ] as const).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedActivityMenu === item.id }}
                  onPress={() => {
                    setSelectedActivityMenu(item.id);
                    if (item.id === 'subscription') void loadCurrentSubscription();
                  }}
                  style={styles.activityTab}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.activityTabText,
                      selectedActivityMenu === item.id && styles.activityTabTextSelected,
                    ]}>
                    {item.label}
                  </Text>
                  {selectedActivityMenu === item.id ? (
                    <View style={styles.activityTabIndicator} />
                  ) : null}
                </Pressable>
              ))}
            </View>
            {selectedActivityMenu === 'latest-update' ? (
              <View style={styles.activityLiveStatus}>
                <View
                  style={[
                    styles.activityLiveDot,
                    isActivitiesRealtimeConnected && styles.activityLiveDotConnected,
                  ]}
                />
                <Text style={styles.activityLiveText}>
                  {isActivitiesRealtimeConnected ? 'Live' : 'Connecting'}
                </Text>
              </View>
            ) : null}
          </View>

          {selectedActivityMenu === 'latest-update' ? (
            <View style={styles.activityContent}>
              {activitiesError ? (
                <View style={styles.activityErrorBox}>
                  <Text style={styles.activityErrorText}>{activitiesError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void loadTodayActivities()}>
                    <Text style={styles.activityRetryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : isLoadingActivities ? (
                <ActivityIndicator size="small" color="#17664f" />
              ) : activities.length > 0 ? (
                <View style={styles.activityList}>
                  {[...activities]
                    .sort(
                      (first, second) =>
                        Date.parse(second.created_at) - Date.parse(first.created_at),
                    )
                    .slice(0, 5)
                    .map((activity) => (
                      <View key={activity.id} style={styles.activityRow}>
                        {activity.actor_photo_url ? (
                          <Image
                            source={{ uri: activity.actor_photo_url }}
                            contentFit="cover"
                            style={styles.activityAvatar}
                            alt="Profile photo"
                            accessibilityLabel="Profile photo"
                          />
                        ) : (
                          <View style={[styles.activityAvatar, styles.activityAvatarFallback]}>
                            <SymbolView
                              name={{ ios: 'person.fill', android: 'person', web: 'person.fill' }}
                              size={18}
                              tintColor="#17664f"
                            />
                          </View>
                        )}
                        <View style={styles.activityDetails}>
                          <View style={styles.activityHeading}>
                            <Text style={styles.activityTitle}>{activity.title}</Text>
                            <Text style={styles.activityTime}>
                              {formatNotificationTime(activity.created_at)}
                            </Text>
                          </View>
                          <Text style={styles.activityDescription}>{activity.description}</Text>
                        </View>
                      </View>
                    ))}
                </View>
              ) : (
                <Text style={styles.activityEmptyText}>No data</Text>
              )}
              {activitiesRealtimeError ? (
                <Text style={styles.activityRealtimeError}>{activitiesRealtimeError}</Text>
              ) : null}
            </View>
          ) : selectedActivityMenu === 'expired' ? (
            <View style={styles.activityContent}>
              {expiredBatchesError ? (
                <View style={styles.activityErrorBox}>
                  <Text style={styles.activityErrorText}>{expiredBatchesError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void loadExpiredBatches()}>
                    <Text style={styles.activityRetryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : isLoadingExpiredBatches ? (
                <ActivityIndicator size="small" color="#17664f" />
              ) : expiredBatches.length > 0 ? (
                <View style={styles.expiredBatchList}>
                  {expiredBatches.map((batch) => (
                    <ExpiredBatchCard
                      key={batch.id}
                      batch={batch}
                      isDestroying={destroyingExpiredBatchId === batch.id}
                      onSwipeDestroy={handleSwipeDestroyExpiredBatch}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.activityEmptyText}>No data</Text>
              )}
            </View>
          ) : (
            <View style={styles.activityContent}>
              {currentSubscriptionError ? (
                <View style={styles.activityErrorBox}>
                  <Text style={styles.activityErrorText}>{currentSubscriptionError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void loadCurrentSubscription()}>
                    <Text style={styles.activityRetryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : isLoadingCurrentSubscription ? (
                <ActivityIndicator size="small" color="#17664f" />
              ) : currentSubscription?.plan ? (
                <View style={styles.currentPlanCard}>
                  <View style={styles.currentPlanHeading}>
                    <View style={styles.currentPlanTitleGroup}>
                      <Text style={styles.currentPlanEyebrow}>Current Plan</Text>
                      <Text style={styles.currentPlanName}>{currentSubscription.plan.name}</Text>
                      {storeName ? (
                        <Text style={styles.currentPlanStoreName}>{storeName}</Text>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.currentPlanStatus,
                        currentSubscription.expires_at
                          && Date.parse(currentSubscription.expires_at) <= currentTimestamp
                          ? styles.currentPlanStatusExpired
                          : currentSubscription.is_assigned
                            ? styles.currentPlanStatusAssigned
                            : styles.currentPlanStatusAvailable,
                      ]}>
                      {currentSubscription.expires_at
                        && Date.parse(currentSubscription.expires_at) <= currentTimestamp
                        ? 'Expired'
                        : currentSubscription.is_assigned
                          ? currentSubscription.status ?? 'Assigned'
                          : 'Available'}
                    </Text>
                  </View>
                  {currentSubscription.plan.description ? (
                    <Text style={styles.currentPlanDescription}>
                      {currentSubscription.plan.description}
                    </Text>
                  ) : null}
                  <View style={styles.currentPlanFees}>
                    <Text style={styles.currentPlanFeeText}>
                      {currentSubscription.plan.setup_fee_label}:{' '}
                      <Text style={styles.currentPlanFeeValue}>
                        {formatCurrency(currentSubscription.plan.setup_fee)}
                      </Text>
                    </Text>
                    <Text style={styles.currentPlanFeeText}>
                      Recurring Fee:{' '}
                      <Text style={styles.currentPlanFeeValue}>
                        {formatCurrency(currentSubscription.plan.recurring_fee)}
                      </Text>
                    </Text>
                    <Text style={styles.currentPlanTotal}>
                      {formatCurrency(
                        currentSubscription.plan.setup_fee + currentSubscription.plan.recurring_fee,
                      )}
                      <Text style={styles.currentPlanPeriod}>
                        {' / '}{formatPlanPeriod(currentSubscription.plan)}
                      </Text>
                    </Text>
                  </View>
                  {currentSubscription.is_assigned ? (
                    <View style={styles.currentPlanExpiryRow}>
                      <Text style={styles.currentPlanExpiry}>
                        {currentSubscription.expires_at
                          ? `Expires ${formatPlanExpiry(currentSubscription.expires_at)}`
                          : 'This plan does not expire.'}
                      </Text>
                      {dashboardRole === 'owner'
                        && currentSubscription.plan.name.trim().toLowerCase() === 'starter access' ? (
                          <Pressable
                            accessibilityRole="button"
                            disabled={isClaimingExtendedAccess}
                            onPress={() => void handleClaimExtendedAccess()}
                            style={[
                              styles.chooseNewPlanButton,
                              isClaimingExtendedAccess && styles.chooseNewPlanButtonDisabled,
                            ]}>
                            <Text style={styles.chooseNewPlanButtonText}>
                              {isClaimingExtendedAccess ? 'Activating…' : 'Claim Extended Access'}
                            </Text>
                          </Pressable>
                        ) : dashboardRole === 'owner'
                          && ['extended access', 'one-time setup', 'standard subscription']
                            .includes(currentSubscription.plan.name.trim().toLowerCase()) ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => router.push('/subscription-setup')}
                            style={styles.chooseNewPlanButton}>
                            <Text style={styles.chooseNewPlanButtonText}>Choose New Plan</Text>
                          </Pressable>
                        ) : null}
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.activityEmptyText}>Current plan is not available.</Text>
              )}
            </View>
          )}
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
  stickyDashboardHeader: {
    zIndex: 1,
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
  activitySection: {
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 24,
  },
  activityMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dce5df',
  },
  activityTabs: {
    flex: 1,
    flexDirection: 'row',
  },
  activityTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  activityTabText: {
    color: '#758078',
    fontSize: 11,
    fontWeight: '600',
  },
  activityTabTextSelected: {
    color: '#17664f',
    fontWeight: '800',
  },
  activityTabIndicator: {
    position: 'absolute',
    right: 8,
    bottom: -1,
    left: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#17664f',
  },
  activityLiveStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 3,
    paddingBottom: 2,
  },
  activityLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#a7b0a9',
  },
  activityLiveDotConnected: {
    backgroundColor: '#2a9a6c',
  },
  activityLiveText: {
    color: '#758078',
    fontSize: 9,
    fontWeight: '700',
  },
  activityContent: {
    paddingTop: 12,
  },
  activityList: {
    gap: 8,
  },
  expiredBatchList: {
    gap: 8,
  },
  expiredBatchCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 11,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 12,
    backgroundColor: '#fffefa',
  },
  expiredBatchField: {
    paddingVertical: 5,
    paddingRight: 8,
  },
  expiredBatchFirstRowField: {
    width: '50%',
  },
  expiredBatchSecondRowField: {
    width: '33.333%',
    marginTop: 3,
  },
  expiredBatchInlineField: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  expiredBatchLabel: {
    color: '#758078',
    fontSize: 9,
    fontWeight: '600',
  },
  expiredBatchValue: {
    marginTop: 3,
    color: '#183c31',
    fontSize: 11,
    fontWeight: '700',
  },
  expiredBatchValueAlert: {
    color: '#dc2626',
  },
  expiredBatchSwipeHint: {
    width: '100%',
    marginTop: 5,
    color: '#9a615d',
    fontSize: 9,
    textAlign: 'right',
  },
  currentPlanCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#cce9d8',
    borderRadius: 12,
    backgroundColor: '#f6fbf7',
  },
  currentPlanHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  currentPlanTitleGroup: {
    flex: 1,
  },
  currentPlanEyebrow: {
    color: '#16845f',
    fontSize: 10,
    fontWeight: '700',
  },
  currentPlanName: {
    marginTop: 6,
    color: '#203128',
    fontSize: 16,
    fontWeight: '800',
  },
  currentPlanStoreName: {
    marginTop: 3,
    color: '#718078',
    fontSize: 10,
  },
  currentPlanStatus: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    fontSize: 9,
    fontWeight: '700',
  },
  currentPlanStatusAssigned: {
    backgroundColor: '#e8f6ee',
    color: '#18794e',
  },
  currentPlanStatusAvailable: {
    backgroundColor: '#eef4f0',
    color: '#65746b',
  },
  currentPlanStatusExpired: {
    backgroundColor: '#fff2dd',
    color: '#9b6412',
  },
  currentPlanDescription: {
    marginTop: 11,
    color: '#687871',
    fontSize: 10,
    lineHeight: 15,
  },
  currentPlanFees: {
    gap: 5,
    marginTop: 12,
  },
  currentPlanFeeText: {
    color: '#687871',
    fontSize: 10,
  },
  currentPlanFeeValue: {
    color: '#34453b',
    fontWeight: '700',
  },
  currentPlanTotal: {
    color: '#203128',
    fontSize: 15,
    fontWeight: '800',
  },
  currentPlanPeriod: {
    color: '#718078',
    fontSize: 10,
    fontWeight: '500',
  },
  currentPlanExpiry: {
    flex: 1,
    color: '#526158',
    fontSize: 10,
    fontWeight: '600',
  },
  currentPlanExpiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e7f0ea',
  },
  chooseNewPlanButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  chooseNewPlanButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  chooseNewPlanButtonDisabled: {
    opacity: 0.65,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 11,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 12,
    backgroundColor: '#fffefa',
  },
  activityAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  activityAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf3e7',
  },
  activityDetails: {
    flex: 1,
    minWidth: 0,
  },
  activityHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  activityTitle: {
    flex: 1,
    color: '#183c31',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  activityTime: {
    color: '#8b968e',
    fontSize: 9,
    lineHeight: 15,
    textAlign: 'right',
  },
  activityDescription: {
    marginTop: 3,
    color: '#526158',
    fontSize: 11,
    lineHeight: 16,
  },
  activityEmptyText: {
    paddingVertical: 10,
    color: '#758078',
    fontSize: 12,
    textAlign: 'center',
  },
  activityErrorBox: {
    padding: 11,
    borderRadius: 10,
    backgroundColor: '#fff3f0',
  },
  activityErrorText: {
    color: '#a63e34',
    fontSize: 11,
    lineHeight: 16,
  },
  activityRetryText: {
    marginTop: 7,
    color: '#17664f',
    fontSize: 11,
    fontWeight: '800',
  },
  activityRealtimeError: {
    marginTop: 8,
    color: '#a63e34',
    fontSize: 10,
    lineHeight: 15,
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
