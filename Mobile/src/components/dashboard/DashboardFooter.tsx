import { router, usePathname, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { SymbolViewProps } from 'expo-symbols';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import { Text, useTranslate } from '@/providers/LanguageProvider';
import homeIcon from '../../../assets/images/tabIcons/home.png';
import inventoryIcon from '../../../assets/images/tabIcons/inventory.png';
import localShippingIcon from '../../../assets/images/tabIcons/local_shipping.png';
import menuIcon from '../../../assets/images/tabIcons/menu.png';
import overviewIcon from '../../../assets/images/tabIcons/overview.png';

type FooterItem = {
  label: string;
  href: Href;
  symbol: SymbolViewProps['name'];
  image?: ImageSourcePropType;
};

const ownerItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', symbol: { ios: 'house.fill', android: 'home', web: 'home' }, image: homeIcon },
  { label: 'Overview', href: '/dashboard/overview', symbol: { ios: 'square.grid.2x2.fill', android: 'dashboard', web: 'dashboard' }, image: overviewIcon },
  { label: 'Inventory', href: '/dashboard/inventory', symbol: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }, image: inventoryIcon },
  { label: 'Supplier', href: '/dashboard/supplier', symbol: { ios: 'shippingbox', android: 'local_shipping', web: 'local_shipping' }, image: localShippingIcon },
  { label: 'Menu', href: '/dashboard/menu', symbol: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' }, image: menuIcon },
];

const staffItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', symbol: { ios: 'house.fill', android: 'home', web: 'home' }, image: homeIcon },
  { label: 'Purchase', href: '/dashboard/purchase', symbol: { ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' } },
  { label: 'Sale', href: '/dashboard/sale', symbol: { ios: 'arrow.left.arrow.right', android: 'currency_exchange', web: 'currency_exchange' } },
  { label: 'Return', href: '/dashboard/return', symbol: { ios: 'arrow.uturn.backward', android: 'assignment_return', web: 'assignment_return' } },
  { label: 'Menu', href: '/dashboard/menu', symbol: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' }, image: menuIcon },
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
            {item.image ? (
              <Image alt="" source={item.image} style={styles.iconImage} />
            ) : (
              <SymbolView name={item.symbol} size={20} tintColor={color} />
            )}
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
  iconImage: { width: 20, height: 20 },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
