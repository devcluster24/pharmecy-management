import { router, usePathname, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import { Text, useTranslate } from '@/providers/LanguageProvider';

type FooterItem = {
  label: string;
  href: Href;
  symbol: SymbolViewProps['name'];
};

const ownerItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', symbol: { ios: 'house.fill', android: 'home', web: 'home' } },
  { label: 'Overview', href: '/dashboard/overview', symbol: { ios: 'square.grid.2x2.fill', android: 'dashboard', web: 'dashboard' } },
  { label: 'Inventory', href: '/dashboard/inventory', symbol: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' } },
  { label: 'Supplier', href: '/dashboard/supplier', symbol: { ios: 'shippingbox', android: 'local_shipping', web: 'local_shipping' } },
  { label: 'Menu', href: '/dashboard/menu', symbol: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' } },
];

const staffItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', symbol: { ios: 'house.fill', android: 'home', web: 'home' } },
  { label: 'Purchase', href: '/dashboard/purchase', symbol: { ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' } },
  { label: 'Sale', href: '/dashboard/sale', symbol: { ios: 'arrow.left.arrow.right', android: 'currency_exchange', web: 'currency_exchange' } },
  { label: 'Return', href: '/dashboard/return', symbol: { ios: 'arrow.uturn.backward', android: 'assignment_return', web: 'assignment_return' } },
  { label: 'Menu', href: '/dashboard/menu', symbol: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' } },
];

export default function DashboardFooter() {
  const { session, dashboardRole, approvalStatus, profileLoading } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const t = useTranslate();

  if (
    !session
    || profileLoading
    || approvalStatus !== 'approved'
    || !dashboardRole
    || pathname.startsWith('/dashboard')
  ) {
    return null;
  }

  const items = dashboardRole === 'owner' ? ownerItems : staffItems;

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => {
        const selected = pathname === item.href;
        const color = selected ? '#17664f' : '#718078';
        return (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={t(item.label)}
            accessibilityState={{ selected }}
            onPress={() => router.replace(item.href)}
            style={styles.item}>
            <SymbolView
              name={item.symbol}
              size={20}
              tintColor={color}
            />
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {t(item.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 62,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e8e2',
    backgroundColor: '#fffefa',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 54,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
