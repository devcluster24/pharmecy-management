import { router, usePathname, type Href } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/AuthProvider';
import { hasDashboardPageAccess } from '@/lib/dashboard-access';
import { Text, useTranslate } from '@/providers/LanguageProvider';
import homeIcon from '../../../assets/images/tabIcons/home.png';
import inventoryIcon from '../../../assets/images/tabIcons/inventory.png';
import localShippingIcon from '../../../assets/images/tabIcons/local_shipping.png';
import localMallIcon from '../../../assets/images/tabIcons/local_mall.png';
import menuIcon from '../../../assets/images/tabIcons/menu.png';
import overviewIcon from '../../../assets/images/tabIcons/overview.png';
import assignmentReturnIcon from '../../../assets/images/tabIcons/assignment_return.png';
import shoppingCartIcon from '../../../assets/images/tabIcons/shopping_cart.png';

type FooterItem = {
  label: string;
  href: Href;
  permission?: string | readonly string[];
  image: ImageSourcePropType;
};

const ownerItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', image: homeIcon },
  { label: 'Overview', href: '/dashboard/overview', image: overviewIcon },
  { label: 'Inventory', href: '/dashboard/inventory', image: inventoryIcon },
  { label: 'Supplier', href: '/dashboard/supplier', image: localShippingIcon },
  { label: 'Menu', href: '/dashboard/menu', image: menuIcon },
];

const staffItems: FooterItem[] = [
  { label: 'Home', href: '/dashboard', image: homeIcon },
  { label: 'Sale', href: '/sales', permission: ['sales', 'purchase'], image: shoppingCartIcon },
  { label: 'Purchase', href: '/purchase', permission: 'purchase', image: localMallIcon },
  { label: 'Return', href: '/return', permission: ['returns', 'sales', 'purchase', 'settings'], image: assignmentReturnIcon },
  { label: 'Menu', href: '/dashboard/menu', image: menuIcon },
];

export default function DashboardFooter() {
  const { session, dashboardRole, approvalStatus, profileLoading, staffPermissions } = useAuth();
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

  const items = dashboardRole === 'owner'
    ? ownerItems
    : staffItems.filter((item) =>
      !item.permission || hasDashboardPageAccess('staff', staffPermissions, item.permission),
    );

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => {
        const selected = pathname === item.href;
        return (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={t(item.label)}
            accessibilityState={{ selected }}
            onPress={() => router.replace(item.href)}
            style={styles.item}>
            <Image alt="" source={item.image} style={styles.iconImage} />
            <Text style={[styles.label, { color: selected ? '#17664f' : '#718078' }]} numberOfLines={1}>
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
