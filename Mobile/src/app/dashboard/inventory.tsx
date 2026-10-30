import { Text, TextInput } from '@/providers/LanguageProvider';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { getCurrencySymbol } from '@/lib/currency';
import { getInventoryPackPrice, getInventoryUnitPrice } from '@/lib/inventory-pricing';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { hasAnyDashboardPageAccess, hasDashboardPageAccess } from '@/lib/dashboard-access';

type InventoryList = 'inventory' | 'expire-soon' | 'expired' | 'low-stock' | 'out-of-stock';

type InventoryBatch = {
  id: string;
  order: string;
  supplier: string;
  supplierContactName?: string;
  supplierPhone?: string;
  orderDate: string;
  updatedAt?: string;
  brand: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  batchNumber: string;
  mfgDate: string;
  expDate: string;
  mrp?: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
  totalPrice?: string;
  quantity?: string;
  availableQuantity?: string;
  unitPurchasePrice?: string;
  productId?: string;
  productPackPrice?: string;
  orderPaidAmount?: string;
  orderDueAmount?: string;
  placedAt?: string;
  receivedAt?: string;
  status: string;
};

type PharmacyInventory = {
  batches: InventoryBatch[];
  lowStockThreshold: number | null;
};

const INVENTORY_TABS: { id: InventoryList; label: string }[] = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'expire-soon', label: 'Expire Soon' },
  { id: 'expired', label: 'Expaired' },
  { id: 'low-stock', label: 'Low Stock' },
  { id: 'out-of-stock', label: 'Out of Stock' },
];
const INVENTORY_PAGE_SIZE = 10;

function getPackSizeMultiplier(packSize: string) {
  const factors = packSize.match(/\d[\d,]*(?:\.\d+)?/g)?.map((factor) =>
    Number(factor.replace(/,/g, '')),
  ) ?? [];
  if (!factors.length || factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;
  const multiplier = factors.reduce((total, factor) => total * factor, 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function getTotalQuantity(row: InventoryBatch) {
  if (row.availableQuantity !== undefined) {
    const value = Number(row.availableQuantity);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  if (row.quantity === undefined || !row.quantity.trim()) return null;
  const quantity = Number(row.quantity);
  const multiplier = getPackSizeMultiplier(row.packSize);
  if (!Number.isFinite(quantity) || quantity < 0 || multiplier === null) return null;
  const total = quantity * multiplier;
  return Number.isFinite(total) ? Number(total.toFixed(4)) : null;
}

function formatQuantity(quantity: number | null) {
  return quantity === null ? '—' : quantity.toLocaleString('en-BD', { maximumFractionDigits: 4 });
}

function getMonthExpiryKey(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? year * 12 + month : null;
}

function parseInventoryBatch(value: unknown): InventoryBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved inventory contains an invalid batch.');
  }
  const row = value as Record<string, unknown>;
  const requiredFields = [
    'id',
    'order',
    'supplier',
    'orderDate',
    'brand',
    'genericName',
    'strength',
    'dosageForm',
    'batchNumber',
    'mfgDate',
    'expDate',
    'packSize',
    'unitPrice',
    'packPrice',
    'status',
  ] as const;
  if (requiredFields.some((field) => typeof row[field] !== 'string')) {
    throw new Error('Saved inventory contains an invalid batch.');
  }
  for (const field of [
    'supplierContactName',
    'supplierPhone',
    'updatedAt',
    'mrp',
    'totalPrice',
    'quantity',
    'availableQuantity',
    'unitPurchasePrice',
    'productId',
    'productPackPrice',
    'orderPaidAmount',
    'orderDueAmount',
    'placedAt',
    'receivedAt',
  ]) {
    if (row[field] !== undefined && typeof row[field] !== 'string') {
      throw new Error('Saved inventory contains an invalid quantity or price.');
    }
  }
  return {
    id: row.id as string,
    order: row.order as string,
    supplier: row.supplier as string,
    ...(typeof row.supplierContactName === 'string' ? { supplierContactName: row.supplierContactName } : {}),
    ...(typeof row.supplierPhone === 'string' ? { supplierPhone: row.supplierPhone } : {}),
    orderDate: row.orderDate as string,
    brand: row.brand as string,
    genericName: row.genericName as string,
    strength: row.strength as string,
    dosageForm: row.dosageForm as string,
    batchNumber: row.batchNumber as string,
    mfgDate: row.mfgDate as string,
    expDate: row.expDate as string,
    ...(typeof row.mrp === 'string' ? { mrp: row.mrp } : {}),
    packSize: row.packSize as string,
    unitPrice: row.unitPrice as string,
    packPrice: row.packPrice as string,
    status: row.status as string,
    ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.totalPrice === 'string' ? { totalPrice: row.totalPrice } : {}),
    ...(typeof row.quantity === 'string' ? { quantity: row.quantity } : {}),
    ...(typeof row.availableQuantity === 'string' ? { availableQuantity: row.availableQuantity } : {}),
    ...(typeof row.unitPurchasePrice === 'string' ? { unitPurchasePrice: row.unitPurchasePrice } : {}),
    ...(typeof row.productId === 'string' ? { productId: row.productId } : {}),
    ...(typeof row.productPackPrice === 'string' ? { productPackPrice: row.productPackPrice } : {}),
    ...(typeof row.orderPaidAmount === 'string' ? { orderPaidAmount: row.orderPaidAmount } : {}),
    ...(typeof row.orderDueAmount === 'string' ? { orderDueAmount: row.orderDueAmount } : {}),
    ...(typeof row.placedAt === 'string' ? { placedAt: row.placedAt } : {}),
    ...(typeof row.receivedAt === 'string' ? { receivedAt: row.receivedAt } : {}),
  };
}

function formatMoney(value?: string) {
  if (value === undefined || !value.trim() || value.trim() === '-') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${getCurrencySymbol()}${amount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;
}

function getStockValue(row: InventoryBatch, totalQuantity: number | null) {
  if (totalQuantity === null) return '—';
  const savedUnitPrice = row.unitPurchasePrice?.trim() && row.unitPurchasePrice.trim() !== '-'
    ? Number(row.unitPurchasePrice)
    : Number.NaN;
  let unitPrice = savedUnitPrice;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    const packQuantity = Number(row.quantity);
    const totalPrice = Number(row.totalPrice);
    const multiplier = getPackSizeMultiplier(row.packSize);
    if (
      !Number.isFinite(packQuantity)
      || packQuantity <= 0
      || !Number.isFinite(totalPrice)
      || totalPrice < 0
      || multiplier === null
    ) return '—';
    unitPrice = totalPrice / packQuantity / multiplier;
  }
  const amount = totalQuantity * unitPrice;
  return Number.isFinite(amount)
    ? `${getCurrencySymbol()}${amount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}

function InventoryDetails({ batch, totalQuantity }: { batch: InventoryBatch; totalQuantity: number | null }) {
  const packPrice = getInventoryPackPrice(batch.mrp);
  const unitPrice = getInventoryUnitPrice(packPrice, batch.packSize);
  const details: [string, string][] = [
    ['Order Number', batch.order || '—'],
    ['Date & Time', batch.updatedAt || batch.orderDate || '—'],
    ['Placed At', batch.placedAt || '—'],
    ['Received At', batch.receivedAt || '—'],
    ['Batch Number', batch.batchNumber || '—'],
    ['Brand Name', batch.brand || '—'],
    ['Supplier', batch.supplier || '—'],
    ['Supplier Contact', batch.supplierContactName || '—'],
    ['Supplier Phone', batch.supplierPhone || '—'],
    ['Generic', batch.genericName || '—'],
    ['Strength', batch.strength || '—'],
    ['Dosage Form', batch.dosageForm || '—'],
    ['Product ID', batch.productId || '—'],
    ['Pack Price', formatMoney(packPrice)],
    ['Box Quantity', batch.quantity || '—'],
    ['Pack Size', batch.packSize || '—'],
    ['Total Quantity', formatQuantity(totalQuantity)],
    ['Unit Price', formatMoney(unitPrice === null ? undefined : String(unitPrice))],
    ['Product Pack Price', formatMoney(batch.productPackPrice)],
    ['Total Purchase Price', formatMoney(batch.totalPrice)],
    ['Order Paid Amount', formatMoney(batch.orderPaidAmount)],
    ['Order Due Amount', formatMoney(batch.orderDueAmount)],
    ['Total Stock Value', getStockValue(batch, totalQuantity)],
    ['Mfg Date', batch.mfgDate || '—'],
    ['Exp Date', batch.expDate || '—'],
    ['Status', batch.status || '—'],
  ];

  return (
    <View style={styles.details}>
      {details.map(([label, value]) => (
        <View key={label} style={styles.detailRow}>
          <Text style={styles.detailLabel}>{label}</Text>
          <Text selectable style={styles.detailValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export default function InventoryScreen() {
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
    pharmacyOwnerId,
    staffPermissions,
  } = useAuth();
  const hasInventoryAccess = dashboardRole === 'staff'
    ? hasAnyDashboardPageAccess(dashboardRole, staffPermissions, ['inventory', 'purchase'])
    : hasDashboardPageAccess(dashboardRole, staffPermissions, 'inventory');
  const [inventory, setInventory] = useState<PharmacyInventory>({
    batches: [],
    lowStockThreshold: null,
  });
  const [activeList, setActiveList] = useState<InventoryList>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (isAuthLoading || profileLoading || !hasInventoryAccess) return;
    const client = supabase;
    const currentSession = session;
    const currentOwnerId = pharmacyOwnerId;
    if (!client || !currentSession || !currentOwnerId) return;

    let active = true;
    let latestRequest = 0;
    async function loadInventory(
      inventoryClient: NonNullable<typeof supabase>,
      inventoryOwnerId: string,
      showLoading = false,
    ) {
      const requestId = ++latestRequest;
      if (showLoading) setIsLoading(true);
      setError('');
      try {
        if (dashboardRole === 'staff') {
          const { data: staffData, error: staffError } = await inventoryClient.rpc(
            'get_my_pharmacy_staff_home_inventory',
          );
          if (staffError) throw staffError;
          if (!Array.isArray(staffData) || !staffData[0] || typeof staffData[0] !== 'object') {
            throw new Error('Staff inventory data has an invalid format.');
          }
          const staffPayload = staffData[0] as Record<string, unknown>;
          if (
            !Array.isArray(staffPayload.purchase_payload)
            || staffPayload.purchase_payload.some((row) => !row || typeof row !== 'object')
          ) {
            throw new Error('Saved inventory data has an invalid format.');
          }
          const batches = staffPayload.purchase_payload.map(parseInventoryBatch);
          const threshold = typeof staffPayload.low_stock_threshold === 'number'
            ? staffPayload.low_stock_threshold
            : typeof staffPayload.low_stock_threshold === 'string'
              ? Number(staffPayload.low_stock_threshold)
              : Number.NaN;
          const lowStockThreshold = Number.isInteger(threshold) && threshold > 0 ? threshold : null;
          if (active && requestId === latestRequest) setInventory({ batches, lowStockThreshold });
          return;
        }

        const { data, error: queryError } = await inventoryClient
          .from('pharmacy_app_data')
          .select('data_key, payload')
          .eq('owner_user_id', inventoryOwnerId)
          .in('data_key', ['pharmacy-purchase-list-v1', 'pharmacy-low-stock-threshold-v1']);
        if (queryError) throw queryError;

        let purchasePayload: unknown = [];
        let thresholdPayload: unknown = null;
        for (const row of data ?? []) {
          if (row.data_key === 'pharmacy-purchase-list-v1') purchasePayload = row.payload;
          if (row.data_key === 'pharmacy-low-stock-threshold-v1') thresholdPayload = row.payload;
        }
        if (purchasePayload !== null && !Array.isArray(purchasePayload)) {
          throw new Error('Saved inventory data has an invalid format.');
        }
        const batches = (purchasePayload as unknown[] ?? []).map(parseInventoryBatch);
        const thresholdValue = typeof thresholdPayload === 'number'
          ? thresholdPayload
          : typeof thresholdPayload === 'string' && thresholdPayload.trim()
            ? Number(thresholdPayload)
            : Number.NaN;
        const lowStockThreshold = Number.isInteger(thresholdValue) && thresholdValue > 0
          ? thresholdValue
          : null;
        if (active && requestId === latestRequest) setInventory({ batches, lowStockThreshold });
      } catch (loadError) {
        if (active && requestId === latestRequest) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
        }
      } finally {
        if (active && requestId === latestRequest) setIsLoading(false);
      }
    }

    void loadInventory(client, currentOwnerId, true);
    const channel = client
      .channel(`inventory-updates-${currentOwnerId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pharmacy_app_data',
          filter: `owner_user_id=eq.${currentOwnerId}`,
        },
        (change) => {
          const row = change.eventType === 'DELETE' ? change.old : change.new;
          if (
            row.data_key === 'pharmacy-purchase-list-v1'
            || row.data_key === 'pharmacy-low-stock-threshold-v1'
          ) {
            void loadInventory(client, currentOwnerId);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadInventory(client, currentOwnerId);
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [dashboardRole, hasInventoryAccess, isAuthLoading, pharmacyOwnerId, profileLoading, retryKey, session]);

  const displayError = error
    || (!supabase
      ? 'Inventory is unavailable. Check your account connection.'
      : !session
        ? 'Sign in to view inventory.'
        : !hasInventoryAccess
          ? 'Inventory access has not been enabled by your owner.'
          : '');

  const sortedBatches = useMemo(
    () => [...inventory.batches].sort((left, right) => {
      const leftUpdated = Date.parse(left.updatedAt ?? '');
      const rightUpdated = Date.parse(right.updatedAt ?? '');
      if (Number.isFinite(leftUpdated) && Number.isFinite(rightUpdated) && leftUpdated !== rightUpdated) {
        return rightUpdated - leftUpdated;
      }
      return right.order.localeCompare(left.order);
    }),
    [inventory.batches],
  );
  const visibleBatches = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
    return sortedBatches.filter((batch) => {
      const quantity = getTotalQuantity(batch);
      const expiryMonth = getMonthExpiryKey(batch.expDate);
      if (activeList === 'expire-soon') {
        if (expiryMonth === null) return false;
        const monthsUntilExpiry = expiryMonth - currentMonth;
        return monthsUntilExpiry >= 0 && monthsUntilExpiry <= 3;
      }
      if (activeList === 'expired') return expiryMonth !== null && expiryMonth < currentMonth;
      if (activeList === 'low-stock') {
        return inventory.lowStockThreshold !== null
          && quantity !== null
          && quantity <= inventory.lowStockThreshold;
      }
      if (activeList === 'out-of-stock') return quantity === 0;
      return true;
    });
  }, [activeList, inventory.lowStockThreshold, sortedBatches]);
  const filteredBatches = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return visibleBatches;
    return visibleBatches.filter((batch) =>
      [batch.batchNumber, batch.brand, batch.supplier]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [searchQuery, visibleBatches]);
  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / INVENTORY_PAGE_SIZE));
  const pageNumber = Math.min(currentPage, totalPages);
  const pageBatches = filteredBatches.slice(
    (pageNumber - 1) * INVENTORY_PAGE_SIZE,
    pageNumber * INVENTORY_PAGE_SIZE,
  );

  if (isAuthLoading || profileLoading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <DashboardSubpageHeader subtitle="Inventory Dashboard" />
      <View style={styles.pageBody}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabs}>
          {INVENTORY_TABS.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected: activeList === tab.id }}
              onPress={() => {
                setActiveList(tab.id);
                setCurrentPage(1);
                setExpandedBatchId(null);
              }}
              style={styles.tab}>
              <Text style={[styles.tabText, activeList === tab.id && styles.tabTextSelected]}>
                {tab.label}
              </Text>
              {activeList === tab.id ? <View style={styles.activeTabIndicator} /> : null}
            </Pressable>
          ))}
        </ScrollView>

        {displayError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{displayError}</Text>
            {error && supabase && session && hasInventoryAccess ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setRetryKey((previous) => previous + 1)}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : isLoading ? (
          <ActivityIndicator size="large" color="#17664f" style={styles.loader} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets>
          <TextInput
            accessibilityLabel="Search inventory by batch number, brand name, or company name"
            value={searchQuery}
            onChangeText={(value) => {
              setSearchQuery(value);
              setCurrentPage(1);
              setExpandedBatchId(null);
            }}
            placeholder="Search batch, brand, or company"
            placeholderTextColor="#87938c"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {activeList === 'low-stock' && inventory.lowStockThreshold === null ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                Low Stock Not Working: enter and save a threshold greater than 0 in Settings.
              </Text>
            </View>
          ) : null}
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text numberOfLines={2} style={[styles.headerCell, styles.batchColumn]}>Batch</Text>
              <Text numberOfLines={2} style={[styles.headerCell, styles.brandSupplierColumn]}>Brand Name / Supplier</Text>
              <Text numberOfLines={2} style={[styles.headerCell, styles.quantityColumn]}>Quantity</Text>
              <Text numberOfLines={2} style={[styles.headerCell, styles.unitPriceColumn]}>Unit Price</Text>
            </View>
            {pageBatches.length > 0 ? pageBatches.map((batch) => {
              const expanded = expandedBatchId === batch.id;
              const quantity = getTotalQuantity(batch);
              const packPrice = getInventoryPackPrice(batch.mrp);
              const unitPrice = getInventoryUnitPrice(packPrice, batch.packSize);
              return (
                <View key={batch.id} style={styles.batchContainer}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedBatchId(expanded ? null : batch.id)}
                    style={[styles.tableRow, expanded && styles.tableRowExpanded]}>
                    <Text numberOfLines={2} style={[styles.cell, styles.batchColumn]}>
                      {batch.batchNumber || '—'}
                    </Text>
                    <Text numberOfLines={2} style={[styles.cell, styles.brandSupplierColumn]}>
                      {batch.brand || '—'}
                      <Text style={styles.supplierSubline}>{`\n${batch.supplier || '—'}`}</Text>
                    </Text>
                    <Text style={[styles.cell, styles.quantityColumn, styles.quantityValue]}>
                      {formatQuantity(quantity)}
                    </Text>
                    <Text style={[styles.cell, styles.unitPriceColumn]}>
                      {formatMoney(unitPrice === null ? undefined : String(unitPrice))}
                    </Text>
                  </Pressable>
                  {expanded ? (
                    <InventoryDetails batch={batch} totalQuantity={quantity} />
                  ) : null}
                </View>
              );
            }) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  {searchQuery.trim()
                    ? 'No batches match your search.'
                    : 'No inventory batches found in this list.'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.pagination}>
            <Text style={styles.resultCount}>
              {filteredBatches.length === 0
                ? 'Showing 0 of 0 batches'
                : `Showing ${(pageNumber - 1) * INVENTORY_PAGE_SIZE + 1}-${Math.min(pageNumber * INVENTORY_PAGE_SIZE, filteredBatches.length)} of ${filteredBatches.length} batches`}
            </Text>
            <View style={styles.paginationControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: pageNumber <= 1 }}
                disabled={pageNumber <= 1}
                onPress={() => {
                  setCurrentPage(pageNumber - 1);
                  setExpandedBatchId(null);
                }}
                style={[styles.paginationButton, pageNumber <= 1 && styles.paginationButtonDisabled]}>
                <Text style={[styles.paginationButtonText, pageNumber <= 1 && styles.paginationButtonTextDisabled]}>Previous</Text>
              </Pressable>
              <Text style={styles.pageIndicator}>Page {pageNumber} of {totalPages}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: pageNumber >= totalPages }}
                disabled={pageNumber >= totalPages}
                onPress={() => {
                  setCurrentPage(pageNumber + 1);
                  setExpandedBatchId(null);
                }}
                style={[styles.paginationButton, pageNumber >= totalPages && styles.paginationButtonDisabled]}>
                <Text style={[styles.paginationButtonText, pageNumber >= totalPages && styles.paginationButtonTextDisabled]}>Next</Text>
              </Pressable>
            </View>
          </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f4ef',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f4ef',
  },
  pageBody: {
    flex: 1,
    backgroundColor: '#f2f4ef',
  },
  tabs: {
    gap: 17,
    paddingHorizontal: 17,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8e2',
  },
  tabScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tab: {
    alignItems: 'center',
    paddingTop: 4,
  },
  tabText: {
    color: '#687871',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextSelected: {
    color: '#16845f',
    fontWeight: '700',
  },
  activeTabIndicator: {
    width: '100%',
    height: 2,
    marginTop: 2,
    borderRadius: 1,
    backgroundColor: '#16845f',
  },
  listContent: {
    paddingHorizontal: 13,
    paddingTop: 0,
    paddingBottom: 28,
  },
  searchInput: {
    minHeight: 42,
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
    color: '#34453b',
    fontSize: 12,
  },
  table: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8e2',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  tableHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#f6f8f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e5ebe6',
  },
  headerCell: {
    color: '#65746b',
    fontSize: 11,
    fontWeight: '700',
  },
  tableRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  tableRowExpanded: {
    backgroundColor: '#f7faf7',
    borderBottomWidth: 0,
  },
  batchContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  cell: {
    paddingVertical: 9,
    paddingRight: 10,
    color: '#34453b',
    fontSize: 11,
  },
  batchColumn: {
    flex: 1,
  },
  brandSupplierColumn: {
    flex: 1.8,
  },
  supplierSubline: {
    color: '#77857d',
    fontSize: 10,
  },
  quantityColumn: {
    flex: 0.9,
    textAlign: 'right',
  },
  unitPriceColumn: {
    flex: 1,
    textAlign: 'right',
  },
  quantityValue: {
    color: '#17664f',
    fontWeight: '700',
  },
  details: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#fbfcfb',
    borderTopWidth: 1,
    borderTopColor: '#e8eee9',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f3f0',
  },
  detailLabel: {
    flex: 1,
    color: '#77857d',
    fontSize: 11,
  },
  detailValue: {
    flex: 1.2,
    color: '#34453b',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  emptyState: {
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#87938c',
    fontSize: 12,
  },
  pagination: {
    gap: 8,
    paddingTop: 10,
  },
  resultCount: {
    color: '#87938c',
    fontSize: 10,
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  paginationButton: {
    minWidth: 72,
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  paginationButtonDisabled: {
    opacity: 0.45,
  },
  paginationButtonText: {
    color: '#34453b',
    fontSize: 11,
    fontWeight: '600',
  },
  paginationButtonTextDisabled: {
    color: '#87938c',
  },
  pageIndicator: {
    color: '#687871',
    fontSize: 11,
  },
  noticeCard: {
    marginBottom: 11,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0d8b4',
    borderRadius: 9,
    backgroundColor: '#fff8ed',
  },
  noticeText: {
    color: '#8b5d1a',
    fontSize: 11,
    lineHeight: 16,
  },
  loader: {
    marginTop: 32,
  },
  errorCard: {
    margin: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f0d3cf',
    borderRadius: 10,
    backgroundColor: '#fff8f7',
  },
  errorText: {
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  retryText: {
    marginTop: 10,
    color: '#17664f',
    fontSize: 12,
    fontWeight: '700',
  },
});
