import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ImageSourcePropType } from 'react-native';

import DashboardNotificationCenter from '@/components/dashboard/DashboardNotificationCenter';
import { getCurrencySymbol } from '@/lib/currency';
import { hasAnyDashboardPageAccess, hasDashboardPageAccess } from '@/lib/dashboard-access';
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';
import {
  formatStaffSaleCurrency,
  getStaffSaleDateKey,
  parseStaffSales,
  type StaffSale,
} from '@/lib/staff-sales';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { Text, useLocalizedAlert } from '@/providers/LanguageProvider';
import pharmacyIcon from '../../../../public/pharmacy-icon.png';
import assessmentIcon from '../../../assets/images/tabIcons/assessment.png';
import expensesIcon from '../../../assets/images/tabIcons/expenses.png';
import inventoryIcon from '../../../assets/images/tabIcons/inventory.png';
import localShippingIcon from '../../../assets/images/tabIcons/local_shipping.png';
import overviewIcon from '../../../assets/images/tabIcons/overview.png';
import peopleAltIcon from '../../../assets/images/tabIcons/people_alt.png';
import pharmacyProductManagementIcon from '../../../assets/images/tabIcons/pharmacy_product_management.png';
import settingsIcon from '../../../assets/images/tabIcons/settings_suggest.png';

type ActivityTab = 'latest-update' | 'expired' | 'low-stock' | 'subscription';
type HomeMenu = 'quick-access' | 'favourites';
type StaffActivity = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  actor_photo_url: string | null;
};
type InventoryBatch = {
  id: string;
  brand: string;
  supplier: string;
  batchNumber: string;
  expDate: string;
  quantity: number | null;
  totalQuantity: string;
  price: string;
  updatedAt: string;
  order: string;
};
type QuickAccessItem = {
  id: string;
  permission?: string | readonly string[];
  anyPermission?: readonly string[];
  label: string;
  href: Href;
  icon: ImageSourcePropType;
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

let realtimeChannelInstance = 0;

const quickAccessItems: QuickAccessItem[] = [
  { id: 'overview', permission: 'overview', label: 'Overview', href: '/staff-overview', icon: overviewIcon },
  { id: 'product-management', permission: 'product-management', label: 'Product Management', href: '/dashboard/menu/product-management', icon: pharmacyProductManagementIcon },
  { id: 'inventory', anyPermission: ['inventory', 'purchase'], label: 'Inventory', href: '/dashboard/inventory', icon: inventoryIcon },
  { id: 'customers', permission: 'customers', label: 'Customer', href: '/customer', icon: peopleAltIcon },
  { id: 'suppliers', permission: 'suppliers', label: 'Supplier', href: '/supplier', icon: localShippingIcon },
  { id: 'reports', permission: 'reports', label: 'Reports', href: '/reports', icon: assessmentIcon },
  { id: 'expenses', permission: 'expenses', label: 'Expenses', href: '/expenses', icon: expensesIcon },
  { id: 'settings', permission: 'settings', label: 'Setting', href: '/dashboard/menu/setting', icon: settingsIcon },
];

const QUICK_ACCESS_STORAGE_PREFIX = 'pharmacy-staff-quick-access-counts-v1';

function getGreeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 21) return 'Good Evening';
  return 'Good Night';
}

function getPackSizeMultiplier(value: string) {
  const normalized = value.trim()
    .replace(/['’]s\s+pack$/i, '')
    .replace(/['’]s$/i, '')
    .replace(/\s+pack$/i, '');
  if (!normalized) return null;
  const factors = normalized.split(/\s*[xX×]\s*/);
  if (factors.some((factor) => !/^\d+(?:\.\d+)?$/.test(factor))) return null;
  const multiplier = factors.reduce((total, factor) => total * Number(factor), 1);
  return Number.isFinite(multiplier) ? multiplier : null;
}

function getAvailableQuantity(row: Record<string, unknown>, packSize: string) {
  if (typeof row.availableQuantity === 'string') {
    const quantity = Number(row.availableQuantity);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  }
  if (typeof row.quantity !== 'string' || !row.quantity.trim() || !packSize.trim()) return null;
  const quantity = Number(row.quantity);
  const multiplier = getPackSizeMultiplier(packSize);
  if (!Number.isFinite(quantity) || quantity < 0 || multiplier === null) return null;
  const totalQuantity = quantity * multiplier;
  return Number.isFinite(totalQuantity) ? Number(totalQuantity.toFixed(4)) : null;
}

function formatQuantity(value: number | null) {
  return value === null ? '-' : value.toLocaleString('en-BD', { maximumFractionDigits: 4 });
}

function getExpiredStockPrice(row: Record<string, unknown>, totalQuantity: number | null) {
  if (totalQuantity === null) return '-';
  const savedUnitPrice = typeof row.unitPurchasePrice === 'string'
    ? Number(row.unitPurchasePrice)
    : Number.NaN;
  let unitPrice = savedUnitPrice;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    const packSize = typeof row.packSize === 'string' ? row.packSize : '';
    const multiplier = getPackSizeMultiplier(packSize);
    const boxQuantity = typeof row.quantity === 'string' ? Number(row.quantity) : Number.NaN;
    const totalPrice = typeof row.totalPrice === 'string' ? Number(row.totalPrice) : Number.NaN;
    if (
      multiplier === null
      || !Number.isFinite(boxQuantity)
      || boxQuantity <= 0
      || !Number.isFinite(totalPrice)
      || totalPrice < 0
    ) return '-';
    unitPrice = totalPrice / boxQuantity / multiplier;
  }
  const stockPrice = totalQuantity * unitPrice;
  return Number.isFinite(stockPrice)
    ? `${getCurrencySymbol()}${stockPrice.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
}

function parseInventoryBatches(value: unknown): InventoryBatch[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Saved inventory data has an invalid format.');

  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Saved inventory contains an invalid batch.');
    }
    const row = item as Record<string, unknown>;
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

    const quantity = getAvailableQuantity(row, row.packSize);
    const brand = typeof row.brand === 'string' && row.brand.trim()
      ? row.brand
      : typeof row.medicine_name === 'string' ? row.medicine_name : '-';

    return {
      id: row.id,
      brand,
      supplier: row.supplier,
      batchNumber: row.batchNumber,
      expDate: row.expDate,
      quantity,
      totalQuantity: formatQuantity(quantity),
      price: getExpiredStockPrice(row, quantity),
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      order: typeof row.order === 'string' ? row.order : '',
    };
  });
}

function formatCurrency(amount: number) {
  return `${getCurrencySymbol()}${formatStaffSaleCurrency(amount)}`;
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

function formatActivityTime(value: string) {
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

function isExpiredDate(value: string, now: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  return year * 12 + month < now.getFullYear() * 12 + now.getMonth() + 1;
}

function ExpiredBatchCard({
  batch,
  isDestroying,
  canDestroy,
  onSwipeDestroy,
}: {
  batch: InventoryBatch;
  isDestroying: boolean;
  canDestroy: boolean;
  onSwipeDestroy: (batchId: string) => void;
}) {
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        canDestroy
        && gestureState.dx > 12
        && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
      onPanResponderRelease: (_event, gestureState) => {
        if (!isDestroying && gestureState.dx >= 90) onSwipeDestroy(batch.id);
      },
    }),
    [batch.id, canDestroy, isDestroying, onSwipeDestroy],
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
      ) : canDestroy ? (
        <Text style={styles.expiredBatchSwipeHint}>Swipe right to destroy</Text>
      ) : null}
    </View>
  );
}

export default function StaffHomeScreen() {
  const alert = useLocalizedAlert();
  const {
    ownerName,
    storeName,
    pharmacyOwnerId,
    staffRole,
    staffPermissions,
    session,
  } = useAuth();
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const [now, setNow] = useState(() => new Date());
  const [sales, setSales] = useState<StaffSale[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState('');
  const [activities, setActivities] = useState<StaffActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState('');
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [lowStockThreshold, setLowStockThreshold] = useState<number | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState('');
  const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [destroyingExpiredBatchId, setDestroyingExpiredBatchId] = useState<string | null>(null);
  const [isActivitiesRealtimeConnected, setIsActivitiesRealtimeConnected] = useState(false);
  const [selectedHomeMenu, setSelectedHomeMenu] = useState<HomeMenu>('quick-access');
  const [selectedActivityTab, setSelectedActivityTab] = useState<ActivityTab>('latest-update');
  const [isQuickAccessExpanded, setIsQuickAccessExpanded] = useState(false);
  const [quickAccessCounts, setQuickAccessCounts] = useState<Record<string, number>>({});
  const [favouritesLoadedForUser, setFavouritesLoadedForUser] = useState<string | null>(null);
  const [favouritesError, setFavouritesError] = useState('');
  const hasSalesAccess = staffPermissions.sales === true;
  const hasInventoryAccess = hasAnyDashboardPageAccess(
    'staff',
    staffPermissions,
    ['inventory', 'purchase'],
  );
  const hasSettingsAccess = staffPermissions.settings === true;
  const canDestroyExpiredInventory = staffPermissions.purchase === true
    && staffPermissions.expenses === true;
  const favouritesStorageKey = session
    ? `${QUICK_ACCESS_STORAGE_PREFIX}:${session.user.id}`
    : null;

  useEffect(() => {
    const interval = setInterval(() => {
      const current = new Date();
      setCurrentHour(current.getHours());
      setNow(current);
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadSales = useCallback(async () => {
    if (!supabase || !session || !pharmacyOwnerId) {
      setSalesError('Sales summary is unavailable. Check your account connection.');
      setSalesLoading(false);
      return;
    }
    if (!hasSalesAccess) {
      setSales([]);
      setSalesError('');
      setSalesLoading(false);
      return;
    }

    setSalesLoading(true);
    setSalesError('');
    try {
      const { data, error } = await supabase.rpc('get_my_pharmacy_staff_sales');
      if (error) throw error;
      setSales(parseStaffSales(data, session.user.id));
    } catch (error) {
      setSalesError(error instanceof Error ? error.message : 'Could not load your sales.');
    } finally {
      setSalesLoading(false);
    }
  }, [hasSalesAccess, pharmacyOwnerId, session]);

  const loadActivities = useCallback(async () => {
    if (!supabase || !session) {
      setActivitiesError('Activity history is unavailable. Check your account connection.');
      setActivitiesLoading(false);
      return;
    }
    const currentDay = new Date();
    const start = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
    const end = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate() + 1);

    setActivitiesLoading(true);
    setActivitiesError('');
    try {
      const { data, error } = await supabase.rpc('get_my_pharmacy_staff_activity_for_day', {
        requested_start: start.toISOString(),
        requested_end: end.toISOString(),
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Activity history has an invalid format.');

      const rows = data.map((item: unknown): StaffActivity => {
        if (!item || typeof item !== 'object') {
          throw new Error('Activity history contains an invalid record.');
        }
        const row = item as Record<string, unknown>;
        if (
          typeof row.id !== 'string'
          || typeof row.title !== 'string'
          || typeof row.description !== 'string'
          || typeof row.created_at !== 'string'
          || Number.isNaN(Date.parse(row.created_at))
          || (row.actor_photo_url !== null && typeof row.actor_photo_url !== 'string')
        ) {
          throw new Error('Activity history contains an invalid record.');
        }
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          created_at: row.created_at,
          actor_photo_url: typeof row.actor_photo_url === 'string' ? row.actor_photo_url : null,
        };
      });
      setActivities(rows);
    } catch (error) {
      setActivitiesError(error instanceof Error ? error.message : 'Could not load your activity.');
    } finally {
      setActivitiesLoading(false);
    }
  }, [session]);

  const loadInventory = useCallback(async () => {
    if (!supabase || !pharmacyOwnerId) {
      setInventoryError('Inventory information is unavailable. Check your account connection.');
      setInventoryLoading(false);
      return;
    }
    if (!hasInventoryAccess) {
      setBatches([]);
      setLowStockThreshold(null);
      setInventoryError('');
      setInventoryLoading(false);
      return;
    }

    setInventoryLoading(true);
    setInventoryError('');
    try {
      const { data, error } = await supabase.rpc('get_my_pharmacy_staff_home_inventory');
      if (error) throw error;
      if (!Array.isArray(data) || !data[0] || typeof data[0] !== 'object') {
        throw new Error('Staff inventory data has an invalid format.');
      }
      const payload = data[0] as Record<string, unknown>;
      const inventoryPayload = payload.purchase_payload;
      const thresholdPayload = payload.low_stock_threshold;
      const parsedThreshold = typeof thresholdPayload === 'number'
        ? thresholdPayload
        : typeof thresholdPayload === 'string' && thresholdPayload.trim()
          ? Number(thresholdPayload)
          : Number.NaN;
      setBatches(parseInventoryBatches(inventoryPayload));
      setLowStockThreshold(
        Number.isInteger(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : null,
      );
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : 'Could not load inventory.');
    } finally {
      setInventoryLoading(false);
    }
  }, [hasInventoryAccess, pharmacyOwnerId]);

  const loadCurrentSubscription = useCallback(async () => {
    if (!hasSettingsAccess) {
      setCurrentSubscription(null);
      setSubscriptionError('Subscription information is only available to staff with settings access.');
      setSubscriptionLoading(false);
      return;
    }
    if (!supabase || !session) {
      setSubscriptionError('Current plan is unavailable. Check your Supabase connection.');
      setSubscriptionLoading(false);
      return;
    }

    setSubscriptionLoading(true);
    setSubscriptionError('');
    try {
      const { data, error } = await supabase.rpc('get_pharmacy_home_current_plan');
      if (error) throw error;
      if (!isCurrentSubscription(data)) {
        throw new Error('The current plan returned by Supabase is invalid.');
      }
      setCurrentSubscription(data);
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : 'Could not load the current plan.');
    } finally {
      setSubscriptionLoading(false);
    }
  }, [hasSettingsAccess, session]);

  const handleSwipeDestroyExpiredBatch = useCallback((batchId: string) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch || destroyingExpiredBatchId) return;
    if (!canDestroyExpiredInventory) {
      alert.alert('Access unavailable', 'Your owner has not granted permission to delete purchases and create expenses.');
      return;
    }
    const client = supabase;
    if (!client || !session) {
      alert.alert('Could not destroy batch', 'Sign in and check your Supabase connection, then try again.');
      return;
    }
    alert.alert(
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
              await loadInventory();
              alert.alert('Expired batch destroyed', 'The batch was removed and recorded as a Destroy expense.');
            })()
              .catch((error: unknown) => {
                alert.alert(
                  'Could not destroy batch',
                  error instanceof Error ? error.message : 'Could not destroy this expired batch.',
                );
              })
              .finally(() => setDestroyingExpiredBatchId(null));
          },
        },
      ],
    );
  }, [alert, batches, canDestroyExpiredInventory, destroyingExpiredBatchId, loadInventory, session]);

  useFocusEffect(useCallback(() => {
    const timeout = setTimeout(() => {
      void loadSales();
      void loadActivities();
      void loadInventory();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadActivities, loadInventory, loadSales]));

  useEffect(() => {
    const client = supabase;
    if (!client || !pharmacyOwnerId || !session) return;
    const channel = client
      .channel(`staff-home-activity-${session.user.id}-${++realtimeChannelInstance}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pharmacy_activity_feed',
          filter: `actor_user_id=eq.${session.user.id}`,
        },
        () => void loadActivities(),
      )
      .subscribe((status) => {
        setIsActivitiesRealtimeConnected(status === 'SUBSCRIBED');
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [loadActivities, pharmacyOwnerId, session]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void loadSales();
        void loadActivities();
        void loadInventory();
      }
    });
    return () => subscription.remove();
  }, [loadActivities, loadInventory, loadSales]);

  useEffect(() => {
    if (!favouritesStorageKey) return;
    let active = true;
    void AsyncStorage.getItem(favouritesStorageKey)
      .then((storedValue) => {
        if (!active) return;
        setFavouritesError('');
        if (!storedValue) {
          setQuickAccessCounts({});
          return;
        }
        const parsed: unknown = JSON.parse(storedValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Saved shortcut usage data has an invalid format.');
        }
        const counts: Record<string, number> = {};
        for (const item of quickAccessItems) {
          const count = (parsed as Record<string, unknown>)[item.id];
          if (count === undefined) continue;
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            throw new Error('Saved shortcut usage data has an invalid format.');
          }
          counts[item.id] = count;
        }
        setQuickAccessCounts(counts);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setQuickAccessCounts({});
        setFavouritesError(
          error instanceof Error ? error.message : 'Could not load shortcut usage data.',
        );
      })
      .finally(() => {
        if (active) setFavouritesLoadedForUser(favouritesStorageKey);
      });
    return () => {
      active = false;
    };
  }, [favouritesStorageKey]);

  const todayKey = getStaffSaleDateKey(now);
  const todaySales = useMemo(
    () => sales.filter((sale) => getStaffSaleDateKey(sale.createdAt) === todayKey),
    [sales, todayKey],
  );
  const todayTotal = todaySales.reduce((total, sale) => total + sale.amount, 0);
  const latestInvoice = todaySales[0];
  const allowedQuickAccessItems = useMemo(
    () => quickAccessItems.filter((item) => (
      (!item.permission || hasDashboardPageAccess('staff', staffPermissions, item.permission))
      && (!item.anyPermission || hasAnyDashboardPageAccess('staff', staffPermissions, item.anyPermission))
    )),
    [staffPermissions],
  );
  const visibleFavouriteItems = allowedQuickAccessItems
    .filter((item) => (quickAccessCounts[item.id] ?? 0) > 0)
    .sort((first, second) =>
      (quickAccessCounts[second.id] ?? 0) - (quickAccessCounts[first.id] ?? 0),
    )
    .slice(0, 6);
  const visibleHomeItems = selectedHomeMenu === 'quick-access'
    ? isQuickAccessExpanded ? allowedQuickAccessItems : allowedQuickAccessItems.slice(0, 6)
    : visibleFavouriteItems;
  const expiredBatches = useMemo(
    () => batches
      .filter((batch) => isExpiredDate(batch.expDate, now))
      .sort((first, second) => {
        const timeDifference = Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
        return Number.isFinite(timeDifference) && timeDifference !== 0
          ? timeDifference
          : second.order.localeCompare(first.order);
      })
      .slice(0, 5),
    [batches, now],
  );
  const lowStockBatches = useMemo(
    () => lowStockThreshold === null
      ? []
      : batches
        .filter((batch) => batch.quantity !== null && batch.quantity <= lowStockThreshold)
        .sort((first, second) => (first.quantity ?? 0) - (second.quantity ?? 0))
        .slice(0, 5),
    [batches, lowStockThreshold],
  );
  function openQuickAccess(item: QuickAccessItem) {
    if (favouritesLoadedForUser === favouritesStorageKey) {
      const nextCounts = {
        ...quickAccessCounts,
        [item.id]: Math.min((quickAccessCounts[item.id] ?? 0) + 1, Number.MAX_SAFE_INTEGER),
      };
      setQuickAccessCounts(nextCounts);
      if (favouritesStorageKey) {
        void AsyncStorage.setItem(favouritesStorageKey, JSON.stringify(nextCounts))
          .then(() => setFavouritesError(''))
          .catch((error: unknown) => {
            setFavouritesError(
              error instanceof Error ? error.message : 'Could not save shortcut usage data.',
            );
          });
      }
    }
    router.push(item.href);
  }

  function renderActivityContent() {
    if (selectedActivityTab === 'latest-update') {
      if (activitiesError) {
        return (
          <View style={styles.errorContent}>
            <Text style={styles.errorText}>{activitiesError}</Text>
            <Pressable accessibilityRole="button" onPress={() => void loadActivities()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        );
      }
      if (activitiesLoading) return <ActivityIndicator size="small" color="#17664f" />;
      if (!activities.length) return <Text style={styles.emptyText}>No updates yet.</Text>;
      return activities.slice(0, 5).map((activity) => (
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
                name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                size={18}
                tintColor="#17664f"
              />
            </View>
          )}
          <View style={styles.activityDetails}>
            <View style={styles.activityHeading}>
              <Text style={styles.activityTitle}>{activity.title}</Text>
              <Text style={styles.activityTime}>{formatActivityTime(activity.created_at)}</Text>
            </View>
            <Text style={styles.activityDescription}>{activity.description}</Text>
          </View>
        </View>
      ));
    }

    if (selectedActivityTab === 'subscription') {
      if (subscriptionError) {
        return (
          <View style={styles.errorContent}>
            <Text style={styles.errorText}>{subscriptionError}</Text>
            {hasSettingsAccess ? (
              <Pressable accessibilityRole="button" onPress={() => void loadCurrentSubscription()}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }
      if (subscriptionLoading) return <ActivityIndicator size="small" color="#17664f" />;
      if (!currentSubscription?.plan) return <Text style={styles.emptyText}>Current plan is not available.</Text>;

      const plan = currentSubscription.plan;
      const isSubscriptionExpired = currentSubscription.expires_at !== null
        && Date.parse(currentSubscription.expires_at) <= now.getTime();
      return (
        <View style={styles.currentPlanCard}>
          <View style={styles.currentPlanHeading}>
            <View style={styles.currentPlanTitleGroup}>
              <Text style={styles.currentPlanEyebrow}>Current Plan</Text>
              <Text style={styles.currentPlanName}>{plan.name}</Text>
              {storeName ? (
                <Text style={styles.currentPlanStoreName}>{getPharmacyDisplayName(storeName)}</Text>
              ) : null}
            </View>
            <Text
              style={[
                styles.currentPlanStatus,
                isSubscriptionExpired
                  ? styles.currentPlanStatusExpired
                  : currentSubscription.is_assigned
                    ? styles.currentPlanStatusAssigned
                    : styles.currentPlanStatusAvailable,
              ]}>
              {isSubscriptionExpired
                ? 'Expired'
                : currentSubscription.is_assigned
                  ? currentSubscription.status ?? 'Assigned'
                  : 'Available'}
            </Text>
          </View>
          {plan.description ? (
            <Text style={styles.currentPlanDescription}>{plan.description}</Text>
          ) : null}
          <View style={styles.currentPlanFees}>
            <Text style={styles.currentPlanFeeText}>
              {plan.setup_fee_label}:{' '}
              <Text style={styles.currentPlanFeeValue}>{formatCurrency(plan.setup_fee)}</Text>
            </Text>
            <Text style={styles.currentPlanFeeText}>
              Recurring Fee:{' '}
              <Text style={styles.currentPlanFeeValue}>{formatCurrency(plan.recurring_fee)}</Text>
            </Text>
            <Text style={styles.currentPlanTotal}>
              {formatCurrency(plan.setup_fee + plan.recurring_fee)}
              <Text style={styles.currentPlanPeriod}>{' / '}{formatPlanPeriod(plan)}</Text>
            </Text>
          </View>
          {currentSubscription.is_assigned ? (
            <View style={styles.currentPlanExpiryRow}>
              <Text style={styles.currentPlanExpiry}>
                {currentSubscription.expires_at
                  ? `Expires ${formatPlanExpiry(currentSubscription.expires_at)}`
                  : 'This plan does not expire.'}
              </Text>
            </View>
          ) : null}
        </View>
      );
    }

    if (!hasInventoryAccess) {
      return <Text style={styles.emptyText}>Inventory access has not been enabled by your owner.</Text>;
    }
    if (inventoryError) {
      return (
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>{inventoryError}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadInventory()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (inventoryLoading) return <ActivityIndicator size="small" color="#17664f" />;
    if (selectedActivityTab === 'low-stock' && lowStockThreshold === null) {
      return <Text style={styles.emptyText}>Low-stock monitoring is not enabled in the store settings.</Text>;
    }

    if (selectedActivityTab === 'expired') {
      if (!expiredBatches.length) return <Text style={styles.emptyText}>No expired inventory.</Text>;
      return (
        <View style={styles.expiredBatchList}>
          {expiredBatches.map((batch) => (
            <ExpiredBatchCard
              key={batch.id}
              batch={batch}
              isDestroying={destroyingExpiredBatchId === batch.id}
              canDestroy={canDestroyExpiredInventory}
              onSwipeDestroy={handleSwipeDestroyExpiredBatch}
            />
          ))}
        </View>
      );
    }

    if (!lowStockBatches.length) {
      return (
        <Text style={styles.emptyText}>
          No low-stock inventory.
        </Text>
      );
    }
    return lowStockBatches.map((batch) => (
      <View key={batch.id} style={styles.inventoryRow}>
        <View style={styles.inventoryText}>
          <Text numberOfLines={1} style={styles.inventoryName}>{batch.brand}</Text>
          <Text numberOfLines={1} style={styles.inventoryMeta}>
            {batch.batchNumber} · {batch.supplier}
          </Text>
        </View>
        <Text style={styles.inventoryQuantity}>{(batch.quantity ?? 0).toLocaleString('en-BD')} units</Text>
      </View>
    ));
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#145642" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.topBar}>
              <View style={styles.storeIdentity}>
                <Image
                  source={pharmacyIcon}
                  contentFit="contain"
                  style={styles.storeIcon}
                  alt={`${getPharmacyDisplayName(storeName)} icon`}
                  accessibilityLabel={`${getPharmacyDisplayName(storeName)} icon`}
                />
                <Text numberOfLines={1} style={styles.storeName}>
                  {getPharmacyDisplayName(storeName)}
                </Text>
              </View>
              <DashboardNotificationCenter />
            </View>
            <View pointerEvents="none" style={styles.heroDecoration} />
            <Text style={styles.greeting}>{getGreeting(currentHour)}</Text>
            <Text numberOfLines={1} style={styles.staffName}>{ownerName || 'Staff'}</Text>
            <Text numberOfLines={1} style={styles.staffRole}>{staffRole || 'Staff'}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open my sales history"
            disabled={!hasSalesAccess}
            onPress={() => router.push('/staff-sales-history')}
            style={[styles.salesCard, !hasSalesAccess && styles.disabledCard]}>
            <View style={styles.salesHeading}>
              <View>
                <Text style={styles.salesTitle}>My Sale</Text>
                <Text style={styles.salesDate}>Today&apos;s sales</Text>
              </View>
              <View style={styles.arrowButton}>
                <SymbolView
                  name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                  size={18}
                  tintColor="#17664f"
                />
              </View>
            </View>
            {salesError ? (
              <View style={styles.errorContent}>
                <Text style={styles.errorText}>{salesError}</Text>
                <Pressable accessibilityRole="button" onPress={() => void loadSales()}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : !hasSalesAccess ? (
              <Text style={styles.emptyText}>Sales access has not been enabled by your owner.</Text>
            ) : salesLoading ? (
              <ActivityIndicator size="small" color="#17664f" style={styles.cardLoader} />
            ) : (
              <View style={styles.salesSummary}>
                <View>
                  <Text style={styles.salesAmount}>{formatCurrency(todayTotal)}</Text>
                  <Text style={styles.salesInvoiceCount}>{todaySales.length} invoices</Text>
                </View>
                <Text numberOfLines={1} style={styles.latestInvoice}>
                  {latestInvoice ? `Latest: ${latestInvoice.invoiceNumber}` : 'No invoice today'}
                </Text>
              </View>
            )}
          </Pressable>

          <View style={styles.homeMenus}>
            <View style={styles.homeMenuTabs}>
              {([
                { id: 'quick-access', label: 'Quick Access' },
                { id: 'favourites', label: 'Favourites' },
              ] as const).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedHomeMenu === item.id }}
                  onPress={() => setSelectedHomeMenu(item.id)}
                  style={styles.homeMenuTab}>
                  <Text
                    style={[
                      styles.homeMenuTabText,
                      selectedHomeMenu === item.id && styles.homeMenuTabTextSelected,
                    ]}>
                    {item.label}
                  </Text>
                  {selectedHomeMenu === item.id ? <View style={styles.tabIndicator} /> : null}
                </Pressable>
              ))}
            </View>

            {favouritesError ? (
              <View style={styles.errorNotice}>
                <Text style={styles.errorText}>{favouritesError}</Text>
              </View>
            ) : null}
            {visibleHomeItems.length ? (
              <View style={styles.quickAccessGrid}>
                {visibleHomeItems.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    onPress={() => void openQuickAccess(item)}
                    style={styles.quickAccessButton}>
                    <Image source={item.icon} contentFit="contain" style={styles.quickAccessIcon} alt="" />
                    <Text numberOfLines={2} style={styles.quickAccessLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.emptyShortcuts}>
                <Text style={styles.emptyText}>
                  {selectedHomeMenu === 'quick-access'
                    ? 'Your owner has not enabled any quick-access pages.'
                    : 'No favourites yet. Open a Quick Access page to add it here.'}
                </Text>
              </View>
            )}
            {selectedHomeMenu === 'quick-access' && allowedQuickAccessItems.length > 6 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isQuickAccessExpanded }}
                onPress={() => setIsQuickAccessExpanded((expanded) => !expanded)}
                style={styles.expandButton}>
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

          <View style={styles.activitySection}>
            <View style={styles.activityTabs}>
              {([
                { id: 'latest-update', label: 'Latest Update' },
                { id: 'expired', label: 'Expired' },
                { id: 'low-stock', label: 'Low Stock' },
              ] as const).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedActivityTab === item.id }}
                  onPress={() => {
                    setSelectedActivityTab(item.id);
                  }}
                  style={styles.activityTab}>
                  <View style={styles.activityTabLabel}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.activityTabText,
                        selectedActivityTab === item.id && styles.activityTabTextSelected,
                      ]}>
                      {item.label}
                    </Text>
                    {item.id === 'latest-update' ? (
                      <View
                        style={[
                          styles.activityLiveDot,
                          isActivitiesRealtimeConnected && styles.activityLiveDotConnected,
                        ]}
                      />
                    ) : null}
                  </View>
                  {selectedActivityTab === item.id ? <View style={styles.tabIndicator} /> : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.activityContent}>{renderActivityContent()}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f2f4ef' },
  content: { paddingBottom: 28 },
  hero: {
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 48,
    backgroundColor: '#145642',
  },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  storeIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  storeIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fffefa' },
  storeName: {
    flexShrink: 1,
    color: '#fffdf7',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  heroDecoration: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(235, 248, 218, 0.16)',
    right: -55,
    top: -75,
  },
  greeting: { marginTop: 22, color: '#fffdf7', fontSize: 14, fontWeight: '600' },
  staffName: { marginTop: 3, color: '#fffdf7', fontSize: 19, lineHeight: 26 },
  staffRole: { marginTop: 2, color: '#d9ebe1', fontSize: 12, fontWeight: '600' },
  salesCard: {
    marginHorizontal: 18,
    marginTop: -27,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 18,
    backgroundColor: '#fffefa',
  },
  disabledCard: { opacity: 0.8 },
  salesHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  salesTitle: { color: '#183c31', fontSize: 16, fontWeight: '700' },
  salesDate: { marginTop: 2, color: '#758078', fontSize: 12 },
  arrowButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#eff8e6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  salesSummary: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  salesAmount: { color: '#183c31', fontSize: 18, fontWeight: '800' },
  salesInvoiceCount: { marginTop: 3, color: '#758078', fontSize: 12 },
  latestInvoice: { maxWidth: '48%', color: '#47826b', fontSize: 11, fontWeight: '700' },
  cardLoader: { marginTop: 18 },
  homeMenus: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 18,
    backgroundColor: '#fffefa',
  },
  homeMenuTabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  homeMenuTab: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  homeMenuTabText: { color: '#758078', fontSize: 12, fontWeight: '600' },
  homeMenuTabTextSelected: { color: '#17664f', fontWeight: '800' },
  tabIndicator: {
    position: 'absolute',
    right: 12,
    bottom: 0,
    left: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#17664f',
  },
  quickAccessGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  quickAccessButton: {
    width: '33.333%',
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 4,
  },
  quickAccessIcon: { width: 23, height: 23 },
  quickAccessLabel: {
    maxWidth: '100%',
    color: '#315b47',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyShortcuts: { paddingVertical: 18, paddingHorizontal: 8 },
  emptyText: { color: '#758078', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  expandButton: {
    alignSelf: 'center',
    width: 36,
    height: 30,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorNotice: { marginBottom: 8, padding: 9, borderRadius: 9, backgroundColor: '#fff3f0' },
  activitySection: { marginHorizontal: 18, marginTop: 17, marginBottom: 20 },
  activityTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#dce5df',
  },
  activityTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  activityTabLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activityLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a7b0a9' },
  activityLiveDotConnected: { backgroundColor: '#2a9a6c' },
  activityTabText: { color: '#758078', fontSize: 11, fontWeight: '600' },
  activityTabTextSelected: { color: '#17664f', fontWeight: '800' },
  activityContent: {
    minHeight: 96,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#e4eae1',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: '#fffefa',
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
  activityAvatar: { width: 38, height: 38, borderRadius: 19 },
  activityAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf3e7',
  },
  activityDetails: { flex: 1, minWidth: 0 },
  activityHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  activityTitle: { flex: 1, color: '#183c31', fontSize: 12, fontWeight: '700' },
  activityTime: { color: '#758078', fontSize: 10 },
  activityDescription: { marginTop: 3, color: '#5d6b63', fontSize: 11, lineHeight: 16 },
  expiredBatchList: { gap: 8 },
  expiredBatchCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 11,
    borderWidth: 1,
    borderColor: '#e4eae1',
    borderRadius: 12,
    backgroundColor: '#fffefa',
  },
  expiredBatchField: { paddingVertical: 5, paddingRight: 8 },
  expiredBatchFirstRowField: { width: '50%' },
  expiredBatchSecondRowField: { width: '33.333%', marginTop: 3 },
  expiredBatchInlineField: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 3 },
  expiredBatchLabel: { color: '#758078', fontSize: 9, fontWeight: '600' },
  expiredBatchValue: { flexShrink: 1, minWidth: 0, marginTop: 3, color: '#183c31', fontSize: 11, fontWeight: '700' },
  expiredBatchValueAlert: { color: '#dc2626' },
  expiredBatchSwipeHint: { width: '100%', marginTop: 5, color: '#9a615d', fontSize: 9, textAlign: 'right' },
  currentPlanCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#cce9d8',
    borderRadius: 12,
    backgroundColor: '#f6fbf7',
  },
  currentPlanHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  currentPlanTitleGroup: { flex: 1 },
  currentPlanEyebrow: { color: '#16845f', fontSize: 10, fontWeight: '700' },
  currentPlanName: { marginTop: 6, color: '#203128', fontSize: 16, fontWeight: '800' },
  currentPlanStoreName: { marginTop: 3, color: '#718078', fontSize: 10 },
  currentPlanStatus: { overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, fontSize: 9, fontWeight: '700' },
  currentPlanStatusAssigned: { backgroundColor: '#e8f6ee', color: '#18794e' },
  currentPlanStatusAvailable: { backgroundColor: '#eef4f0', color: '#65746b' },
  currentPlanStatusExpired: { backgroundColor: '#fff2dd', color: '#9b6412' },
  currentPlanDescription: { marginTop: 11, color: '#687871', fontSize: 10, lineHeight: 15 },
  currentPlanFees: { gap: 5, marginTop: 12 },
  currentPlanFeeText: { color: '#687871', fontSize: 10 },
  currentPlanFeeValue: { color: '#34453b', fontWeight: '700' },
  currentPlanTotal: { color: '#203128', fontSize: 15, fontWeight: '800' },
  currentPlanPeriod: { color: '#718078', fontSize: 10, fontWeight: '500' },
  currentPlanExpiry: { flex: 1, color: '#526158', fontSize: 10, fontWeight: '600' },
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
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 3,
  },
  inventoryText: { flex: 1, minWidth: 0 },
  inventoryName: { color: '#183c31', fontSize: 12, fontWeight: '700' },
  inventoryMeta: { marginTop: 3, color: '#758078', fontSize: 10 },
  inventoryQuantity: { color: '#a63e34', fontSize: 11, fontWeight: '700' },
  errorContent: { alignItems: 'center', gap: 7 },
  errorText: { color: '#a63e34', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  retryText: { color: '#17664f', fontSize: 12, fontWeight: '700' },
});
