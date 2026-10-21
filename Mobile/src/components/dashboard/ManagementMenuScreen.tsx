import {
  appCurrencyOptions,
  Text,
  useLanguage,
  useLocalizedAlert,
} from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recordPharmacySessionActivity } from '@/lib/pharmacy-activity';
import {
  loadProductAutoSyncSettings,
  parseProductAutoSyncSettings,
  PRODUCT_CATALOG_AUTO_SYNC_KEY,
  saveProductAutoSyncSettings,
} from '@/lib/product-catalog-auto-sync';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import DashboardTabScreen from '@/components/dashboard/DashboardTabScreen';
import BackupSettingsScreen from '@/components/dashboard/BackupSettingsScreen';
import InventorySettingsScreen from '@/components/dashboard/InventorySettingsScreen';
import PaymentMethodsSettingsScreen from '@/components/dashboard/PaymentMethodsSettingsScreen';
import ReturnDeductionSettingsScreen from '@/components/dashboard/ReturnDeductionSettingsScreen';
import VatTaxSettingsScreen from '@/components/dashboard/VatTaxSettingsScreen';
import OwnerHomeScreen from '@/components/dashboard/OwnerHomeScreen';
import { useAuth } from '@/providers/AuthProvider';

type MenuEntry = {
  label: string;
  slug: string;
  icon: ComponentProps<typeof SymbolView>['name'];
  children?: MenuEntry[];
};

const menuEntries: MenuEntry[] = [
  {
    label: 'Product Management',
    slug: 'product-management',
    icon: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' },
  },
  {
    label: 'Staff Management',
    slug: 'staff-management',
    icon: { ios: 'person.2.fill', android: 'people', web: 'people' },
  },
  {
    label: 'Setting',
    slug: 'setting',
    icon: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
    children: [
      {
        label: 'Language',
        slug: 'language',
        icon: { ios: 'globe', android: 'language', web: 'language' },
      },
      {
        label: 'Currency',
        slug: 'currency',
        icon: { ios: 'dollarsign.circle', android: 'currency_exchange', web: 'currency_exchange' },
      },
      {
        label: 'BackUp File',
        slug: 'backup-file',
        icon: { ios: 'externaldrive.fill', android: 'backup', web: 'backup' },
      },
    ],
  },
  {
    label: 'Pharmacy Setup',
    slug: 'pharmacy-setup',
    icon: { ios: 'cross.case.fill', android: 'medical_services', web: 'medical_services' },
    children: [
      {
        label: 'Inventory',
        slug: 'inventory',
        icon: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' },
      },
      {
        label: 'Vat/Tax',
        slug: 'vat-tax',
        icon: { ios: 'percent', android: 'percent', web: 'percent' },
      },
      {
        label: 'Payment Methord',
        slug: 'payment-methord',
        icon: { ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' },
      },
      {
        label: 'Return Management',
        slug: 'return-management',
        icon: { ios: 'arrow.uturn.backward', android: 'assignment_return', web: 'assignment_return' },
      },
      {
        label: 'Product Management',
        slug: 'pharmacy-product-management',
        icon: { ios: 'pills.fill', android: 'medication', web: 'medication' },
      },
    ],
  },
  {
    label: 'Subscription',
    slug: 'subscription',
    icon: { ios: 'creditcard', android: 'card_membership', web: 'card_membership' },
  },
  {
    label: 'Documents',
    slug: 'documents',
    icon: { ios: 'doc.text.fill', android: 'description', web: 'description' },
  },
  {
    label: 'Profile',
    slug: 'profile',
    icon: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
  },
];

const menuTitleBySlug = new Map<string, string>();

for (const entry of menuEntries) {
  menuTitleBySlug.set(entry.slug, entry.label);
  for (const child of entry.children ?? []) {
    menuTitleBySlug.set(child.slug, child.label);
  }
}

export function getManagementMenuTitle(slug: string | string[] | undefined) {
  const value = Array.isArray(slug) ? slug[0] : slug;
  return value ? menuTitleBySlug.get(value) ?? 'Menu' : 'Menu';
}

export default function ManagementMenuScreen({
  activeSlug,
  pageTitle = 'Menu',
}: {
  activeSlug?: string;
  pageTitle?: string;
}) {
  const alert = useLocalizedAlert();
  const activeParent = menuEntries.find((entry) =>
    entry.children?.some((child) => child.slug === activeSlug),
  )?.slug;
  const [expandedGroup, setExpandedGroup] = useState<string | null>(activeParent ?? null);
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const {
    dashboardRole,
    isLoading: isAuthLoading,
    profileLoading,
    session,
  } = useAuth();
  const [isProductSyncExpanded, setIsProductSyncExpanded] = useState(false);
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(false);
  const [isAutoSyncLoading, setIsAutoSyncLoading] = useState(true);
  const [isAutoSyncSaving, setIsAutoSyncSaving] = useState(false);
  const {
    language,
    setLanguage,
    languageError,
    currency,
    setCurrency,
    currencyError,
  } = useLanguage();

  useEffect(() => {
    if (isAuthLoading || profileLoading || !session || !dashboardRole || !supabase) return;
    const client = supabase;
    const currentSession = session;
    let active = true;
    let removeSettingsChannel: (() => void) | undefined;
    async function loadAutoSyncPreference() {
      setIsAutoSyncLoading(true);
      try {
        let ownerId = currentSession.user.id;
        if (dashboardRole === 'staff') {
          const { data, error } = await client.rpc('get_my_pharmacy_dashboard_context');
          if (error) throw error;
          const context = (data ?? [])[0] as { owner_user_id?: string } | undefined;
          if (!context?.owner_user_id) throw new Error('Could not resolve the pharmacy account for auto sync.');
          ownerId = context.owner_user_id;
        }
        const settings = await loadProductAutoSyncSettings(client, ownerId);
        if (active) setIsAutoSyncEnabled(settings.enabled);
        if (active) {
          const channel = client
            .channel(`menu-product-auto-sync-${currentSession.user.id}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'pharmacy_app_data',
                filter: `owner_user_id=eq.${ownerId}`,
              },
              (event) => {
                const record = event.new as { data_key?: string; payload?: unknown } | null;
                if (record?.data_key !== PRODUCT_CATALOG_AUTO_SYNC_KEY) return;
                try {
                  setIsAutoSyncEnabled(parseProductAutoSyncSettings(record.payload).enabled);
                  setErrorMessage('');
                } catch (settingsError) {
                  setErrorMessage(settingsError instanceof Error
                    ? settingsError.message
                    : 'Could not read product auto-sync settings.');
                }
              },
            )
            .subscribe();
          removeSettingsChannel = () => {
            void client.removeChannel(channel);
          };
        }
      } catch (loadError) {
        if (active) {
          setErrorMessage(loadError instanceof Error ? loadError.message : 'Could not load product auto-sync settings.');
        }
      } finally {
        if (active) setIsAutoSyncLoading(false);
      }
    }
    void loadAutoSyncPreference();
    return () => {
      active = false;
      removeSettingsChannel?.();
    };
  }, [dashboardRole, isAuthLoading, profileLoading, session]);

  function toggleGroup(slug: string, isExpanded: boolean) {
    setExpandedGroup(isExpanded ? null : slug);
  }

  function openPage(slug: string) {
    if (slug === 'language') return;
    if (slug === 'staff-management') {
      router.push('/dashboard/menu/staff-management');
      return;
    }
    if (slug === 'product-management') {
      router.push('/dashboard/menu/product-management');
      return;
    }
    router.push({ pathname: '/dashboard/menu/[slug]', params: { slug } });
  }

  async function chooseLanguage(nextLanguage: 'en' | 'bn') {
    setErrorMessage('');
    try {
      await setLanguage(nextLanguage);
    } catch (languageError) {
      setErrorMessage(languageError instanceof Error ? languageError.message : 'Could not save language preference.');
    }
  }

  async function chooseCurrency(nextCurrency: (typeof appCurrencyOptions)[number]['code']) {
    setErrorMessage('');
    try {
      await setCurrency(nextCurrency);
      setIsCurrencyDropdownOpen(false);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : 'Could not save currency preference.');
    }
  }

  async function toggleAutoSync() {
    if (!supabase || !session || !dashboardRole || isAutoSyncSaving) return;
    setIsAutoSyncSaving(true);
    setErrorMessage('');
    try {
      const client = supabase;
      let ownerId = session.user.id;
      if (dashboardRole === 'staff') {
        const { data, error } = await client.rpc('get_my_pharmacy_dashboard_context');
        if (error) throw error;
        const context = (data ?? [])[0] as { owner_user_id?: string } | undefined;
        if (!context?.owner_user_id) throw new Error('Could not resolve the pharmacy account for auto sync.');
        ownerId = context.owner_user_id;
      }
      const settings = await saveProductAutoSyncSettings(client, ownerId, !isAutoSyncEnabled);
      setIsAutoSyncEnabled(settings.enabled);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : 'Could not save auto sync settings.');
    } finally {
      setIsAutoSyncSaving(false);
    }
  }

  async function handleLogout() {
    if (!supabase) {
      setErrorMessage(supabaseConfigError);
      return;
    }

    setIsSigningOut(true);
    setErrorMessage('');

    try {
      try {
        await recordPharmacySessionActivity('logout');
      } catch (activityError) {
        alert.alert(
          'Logout activity was not saved',
          activityError instanceof Error
            ? activityError.message
            : 'Could not record this logout in the activity history.',
        );
      }

      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace('/Auth/login');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not log out. Please try again.');
      setIsSigningOut(false);
    }
  }

  if (activeSlug) {
    if (activeSlug === 'payment-methord') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <PaymentMethodsSettingsScreen />
        </SafeAreaView>
      );
    }
    if (activeSlug === 'return-management') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <ReturnDeductionSettingsScreen />
        </SafeAreaView>
      );
    }
    if (activeSlug === 'vat-tax') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <VatTaxSettingsScreen />
        </SafeAreaView>
      );
    }
    if (activeSlug === 'inventory') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <InventorySettingsScreen />
        </SafeAreaView>
      );
    }
    if (activeSlug === 'backup-file') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <BackupSettingsScreen />
        </SafeAreaView>
      );
    }
    if (activeSlug === 'currency') {
      return (
        <SafeAreaView style={styles.fullPage}>
          <DashboardSubpageHeader
            subtitle={pageTitle}
            onBack={() => router.replace('/dashboard/menu')}
          />
          <ScrollView
            style={styles.pageContent}
            contentContainerStyle={styles.currencyContent}>
            <View style={styles.currencySelector}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={language === 'bn' ? 'মুদ্রা নির্বাচন করুন' : 'Choose currency'}
                accessibilityState={{ expanded: isCurrencyDropdownOpen }}
                onPress={() => setIsCurrencyDropdownOpen((isOpen) => !isOpen)}
                style={styles.currencyDropdownTrigger}>
                <Text style={styles.currencySymbol}>
                  {appCurrencyOptions.find((option) => option.code === currency)?.symbol}
                </Text>
                <Text style={styles.currencyDropdownLabel}>
                  {appCurrencyOptions.find((option) => option.code === currency)?.label}
                </Text>
                <Text style={styles.currencyDropdownChevron}>{isCurrencyDropdownOpen ? '⌃' : '⌄'}</Text>
              </Pressable>
              {isCurrencyDropdownOpen ? (
                <View style={styles.currencyDropdownOptions}>
                  {appCurrencyOptions.map((option) => {
                    const selected = currency === option.code;
                    return (
                      <Pressable
                        key={option.code}
                        accessibilityRole="button"
                        accessibilityLabel={`${option.label} ${option.symbol}`}
                        accessibilityState={{ selected }}
                        onPress={() => void chooseCurrency(option.code)}
                        style={[
                          styles.currencyDropdownOption,
                          selected && styles.currencyOptionSelected,
                        ]}>
                        <Text style={styles.currencySymbol}>{option.symbol}</Text>
                        <Text style={styles.currencyOptionLabel}>{option.label}</Text>
                        {selected ? <Text style={styles.currencySelectedMark}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
            <View style={styles.currencyUsage}>
              <Text style={styles.currencyUsageTitle}>
                {language === 'bn' ? 'এই মুদ্রা যেসব জায়গায় ব্যবহৃত হবে' : 'Where this currency is used'}
              </Text>
              {[
                'Home dashboard',
                'Sales and invoices',
                'Purchases and inventory',
                'Returns and customer balances',
                'Suppliers, expenses, and reports',
                'Payments and subscription screens',
              ].map((area) => (
                <View key={area} style={styles.currencyUsageRow}>
                  <Text style={styles.currencyUsageBullet}>•</Text>
                  <Text style={styles.currencyUsageText}>{area}</Text>
                </View>
              ))}
            </View>
            {errorMessage || currencyError ? (
              <Text style={styles.errorMessage}>{errorMessage || currencyError}</Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.fullPage}>
        <DashboardSubpageHeader
          subtitle={pageTitle}
          onBack={() => router.replace('/dashboard/menu')}
        />
        <ScrollView style={styles.pageContent} contentContainerStyle={styles.fullPageContent}>
          <Text style={styles.eyebrow}>PHARMACY CLUSTER</Text>
          <Text style={styles.welcomeText}>Welcome {pageTitle}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function renderEntry(entry: MenuEntry, nested = false) {
    const isActive = activeSlug === entry.slug;
    const isExpanded = expandedGroup === entry.slug;
    const hasAutoSyncToggle = entry.slug === 'pharmacy-product-management';
    const isAutoSyncEntryExpanded = hasAutoSyncToggle && isProductSyncExpanded;

    return (
      <View key={entry.slug}>
        <View style={[styles.menuRow, nested && styles.nestedMenuRow]}>
          {entry.slug === 'language' ? (
            <>
              <View style={[styles.menuButton, styles.languageLabel]}>
                <SymbolView name={entry.icon} size={18} tintColor="#718078" />
                <Text style={styles.menuButtonText}>{entry.label}</Text>
              </View>
              <View style={styles.languageButtons}>
                {([
                  { key: 'en', label: 'Eng' },
                  { key: 'bn', label: 'বাং' },
                ] as const).map((option) => (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityLabel={option.key === 'en'
                      ? language === 'bn' ? 'ইংরেজি' : 'English'
                      : 'বাংলা'}
                    accessibilityState={{ selected: language === option.key }}
                    onPress={() => void chooseLanguage(option.key)}
                    style={[
                      styles.languageButton,
                      language === option.key && styles.languageButtonSelected,
                    ]}>
                    <Text
                      style={[
                        styles.languageButtonText,
                        language === option.key && styles.languageButtonTextSelected,
                      ]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                selected: isActive,
                ...(entry.slug === 'pharmacy-product-management'
                  ? { expanded: isProductSyncExpanded }
                  : {}),
              }}
              onPress={() => {
                if (entry.children) {
                  toggleGroup(entry.slug, isExpanded);
                } else if (entry.slug === 'pharmacy-product-management') {
                  setIsProductSyncExpanded((expanded) => !expanded);
                } else {
                  openPage(entry.slug);
                }
              }}
              style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}>
              <SymbolView name={entry.icon} size={18} tintColor={isActive ? '#17664f' : '#718078'} />
              <Text style={[styles.menuButtonText, isActive && styles.activeMenuButtonText]}>
                {entry.label}
              </Text>
            </Pressable>
          )}
          {entry.children || hasAutoSyncToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${(hasAutoSyncToggle ? isAutoSyncEntryExpanded : isExpanded) ? 'Collapse' : 'Expand'} ${entry.label}`}
              accessibilityState={{ expanded: hasAutoSyncToggle ? isAutoSyncEntryExpanded : isExpanded }}
              onPress={() => {
                if (hasAutoSyncToggle) setIsProductSyncExpanded((expanded) => !expanded);
                else toggleGroup(entry.slug, isExpanded);
              }}
              style={({ pressed }) => [styles.expandButton, pressed && styles.menuButtonPressed]}>
              <SymbolView
                name={{
                  ios: (hasAutoSyncToggle ? isAutoSyncEntryExpanded : isExpanded) ? 'chevron.down' : 'chevron.right',
                  android: (hasAutoSyncToggle ? isAutoSyncEntryExpanded : isExpanded) ? 'expand_more' : 'chevron_right',
                  web: (hasAutoSyncToggle ? isAutoSyncEntryExpanded : isExpanded) ? 'expand_more' : 'chevron_right',
                }}
                size={18}
                tintColor="#526159"
              />
            </Pressable>
          ) : null}
        </View>
        {entry.children && isExpanded ? (
          <View>
            {entry.children.map((child) => (
              <View key={child.slug}>
                {renderEntry(child, true)}
                {child.slug === 'pharmacy-product-management' && isProductSyncExpanded ? (
                  <View style={styles.autoSyncPanel}>
                    <View style={styles.autoSyncCopy}>
                      <Text style={styles.autoSyncTitle}>Auto Sync</Text>
                      <Text style={styles.autoSyncDescription}>
                        New shared manufacturer products will be added to your product list automatically.
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityLabel="Auto Sync"
                      accessibilityState={{ checked: isAutoSyncEnabled, disabled: isAutoSyncLoading || isAutoSyncSaving }}
                      disabled={isAutoSyncLoading || isAutoSyncSaving || !supabase}
                      onPress={() => void toggleAutoSync()}
                      style={[
                        styles.autoSyncSwitch,
                        isAutoSyncEnabled && styles.autoSyncSwitchEnabled,
                        (isAutoSyncLoading || isAutoSyncSaving) && styles.autoSyncSwitchDisabled,
                      ]}>
                      <View style={[
                        styles.autoSyncSwitchKnob,
                        isAutoSyncEnabled && styles.autoSyncSwitchKnobEnabled,
                      ]} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.homeBackground}>
        {dashboardRole === 'owner'
          ? <OwnerHomeScreen />
          : <DashboardTabScreen title="Welcome Dashboard" />}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu and return to Home"
        onPress={() => router.replace('/dashboard')}
        style={styles.homeDismissArea}
      />
      <ScrollView
        style={[styles.sidebar, styles.sidebarDrawer]}
        contentContainerStyle={styles.content}>
        <View style={styles.sidebarHeader}>
          <SymbolView
            name={{ ios: 'line.3.horizontal', android: 'menu', web: 'menu' }}
            size={21}
            tintColor="#17664f"
          />
          <Text style={styles.sidebarTitle}>Cluster Menu</Text>
        </View>
        {menuEntries.map((entry) => renderEntry(entry))}
        {errorMessage || languageError ? (
          <Text style={styles.errorMessage}>{errorMessage || languageError}</Text>
        ) : null}
        <View style={styles.menuRow}>
          <Pressable
            accessibilityRole="button"
            disabled={isSigningOut}
            onPress={() => void handleLogout()}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && !isSigningOut && styles.menuButtonPressed,
              isSigningOut && styles.logoutButtonDisabled,
            ]}>
            <SymbolView
              name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
              size={18}
              tintColor="#a63e34"
            />
            <Text style={styles.logoutButtonText}>{isSigningOut ? 'Logging out…' : 'Logout'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f2f4ef',
    overflow: 'hidden',
  },
  homeBackground: {
    ...StyleSheet.absoluteFill,
  },
  homeDismissArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '33.3333%',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 60,
    paddingBottom: 20,
  },
  fullPage: {
    flex: 1,
    backgroundColor: '#145642',
  },
  pageContent: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  currencyContent: {
    flexGrow: 1,
    padding: 20,
  },
  currencySelector: {
    alignSelf: 'stretch',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  currencyDropdownTrigger: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  currencyDropdownLabel: {
    flex: 1,
    color: '#26352f',
    fontSize: 15,
    fontWeight: '600',
  },
  currencyDropdownChevron: {
    color: '#526159',
    fontSize: 22,
  },
  currencyDropdownOptions: {
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: '#e6ece8',
  },
  currencyDropdownOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  currencyOptionSelected: {
    backgroundColor: '#e8f3ec',
  },
  currencySelectedMark: {
    marginLeft: 'auto',
    color: '#17664f',
    fontSize: 18,
    fontWeight: '800',
  },
  currencyUsage: {
    alignSelf: 'stretch',
    maxWidth: 600,
    gap: 10,
    marginTop: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  currencyUsageTitle: {
    marginBottom: 2,
    color: '#183c31',
    fontSize: 15,
    fontWeight: '800',
  },
  currencyUsageRow: {
    flexDirection: 'row',
    gap: 10,
  },
  currencyUsageBullet: {
    color: '#17664f',
    fontSize: 16,
    fontWeight: '800',
  },
  currencyUsageText: {
    flex: 1,
    color: '#526159',
    fontSize: 13,
  },
  currencySymbol: {
    color: '#17664f',
    fontSize: 28,
    fontWeight: '800',
  },
  currencyOptionLabel: {
    color: '#526159',
    fontSize: 13,
    fontWeight: '600',
  },
  fullPageContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sidebar: {
    backgroundColor: '#f2f4ef',
  },
  sidebarDrawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '66.6667%',
  },
  sidebarHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  sidebarTitle: {
    color: '#183c31',
    fontSize: 19,
    fontWeight: '800',
  },
  menuRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
  },
  nestedMenuRow: {
    marginLeft: 12,
  },
  autoSyncPanel: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 24,
    marginRight: 8,
    marginBottom: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 10,
    backgroundColor: '#fffefa',
  },
  autoSyncCopy: {
    flex: 1,
    gap: 3,
  },
  autoSyncTitle: {
    color: '#34453b',
    fontSize: 12,
    fontWeight: '800',
  },
  autoSyncDescription: {
    color: '#718078',
    fontSize: 10,
    lineHeight: 15,
  },
  autoSyncSwitch: {
    width: 44,
    height: 25,
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderRadius: 20,
    backgroundColor: '#c5cec8',
  },
  autoSyncSwitchEnabled: {
    backgroundColor: '#179c70',
  },
  autoSyncSwitchDisabled: {
    opacity: 0.55,
  },
  autoSyncSwitchKnob: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  autoSyncSwitchKnobEnabled: {
    alignSelf: 'flex-end',
  },
  menuButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  languageLabel: {
    paddingRight: 4,
  },
  languageButtons: {
    flexDirection: 'row',
    gap: 4,
    paddingRight: 6,
  },
  languageButton: {
    minWidth: 36,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#d6dfd9',
    borderRadius: 8,
    backgroundColor: '#fffefa',
  },
  languageButtonSelected: {
    borderColor: '#17664f',
    backgroundColor: '#e8f3ec',
  },
  languageButtonText: {
    color: '#526159',
    fontSize: 11,
    fontWeight: '700',
  },
  languageButtonTextSelected: {
    color: '#17664f',
  },
  menuButtonPressed: {
    opacity: 0.72,
  },
  menuButtonText: {
    color: '#526159',
    fontSize: 14,
    fontWeight: '500',
  },
  activeMenuButtonText: {
    color: '#17664f',
    fontWeight: '800',
  },
  expandButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  errorMessage: {
    marginTop: 8,
    paddingHorizontal: 12,
    color: '#a63e34',
    fontSize: 13,
    lineHeight: 19,
  },
  logoutButtonDisabled: {
    opacity: 0.6,
  },
  logoutButtonText: {
    color: '#a63e34',
    fontSize: 14,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#47826b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  welcomeText: {
    marginTop: 10,
    color: '#183c31',
    fontSize: 25,
    fontWeight: '800',
  },
});
