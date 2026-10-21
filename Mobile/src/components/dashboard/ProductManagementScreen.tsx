import { Text, TextInput } from '@/providers/LanguageProvider';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';

type ProductRow = {
  owner_user_id: string;
  id: string;
  source_catalog_id: string | null;
  serial_number: string;
  medicine_name: string;
  brand: string;
  generic_name: string;
  manufacturer: string;
  product_type: string;
  category: string;
  dosage_form: string;
  strength: string;
  pack_size: string;
  unit: string;
  barcode: string;
  retail_price: string;
  unit_price?: string;
  pack_price?: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type CatalogRow = {
  id: string;
  serial_number: string;
  pharmaceutical_company: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form_description: string;
  retail_price: string;
  pack_size?: string;
  unit_price?: string;
  pack_price?: string;
  usage_type: string;
  dar_code: string;
  medicine_type_category: string;
  registration_information: string;
};

type ProductForm = {
  id: string;
  serialNumber: string;
  brand: string;
  genericName: string;
  company: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  unitPrice: string;
  packPrice: string;
};

const PAGE_SIZE = 10;
const CATALOG_PAGE_SIZE = 1000;
const IMPORT_BATCH_SIZE = 100;
const emptyForm: ProductForm = {
  id: '',
  serialNumber: '',
  brand: '',
  genericName: '',
  company: '',
  strength: '',
  dosageForm: '',
  packSize: '',
  unitPrice: '',
  packPrice: '',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function normalizeIdentityPart(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function getIdentityKey(product: Pick<ProductRow, 'medicine_name' | 'strength' | 'dosage_form' | 'manufacturer'>) {
  const parts = [
    product.medicine_name,
    product.strength,
    product.dosage_form,
    product.manufacturer,
  ].map(normalizeIdentityPart);
  return parts.every(Boolean) ? JSON.stringify(parts) : null;
}

function parsePrice(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatPrice(value: number) {
  return String(Number(value.toFixed(4)));
}

function mapCatalogProduct(row: CatalogRow, ownerId: string): ProductRow {
  const brand = row.brand_name || '-';
  return {
    owner_user_id: ownerId,
    id: `MED-${Date.now()}-${row.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`,
    source_catalog_id: row.id,
    serial_number: row.serial_number || '-',
    medicine_name: brand !== '-' ? brand : row.generic_name,
    brand,
    generic_name: row.generic_name || '-',
    manufacturer: row.pharmaceutical_company || '-',
    product_type: row.usage_type || 'Medicine',
    category: row.medicine_type_category || '',
    dosage_form: row.dosage_form_description || '-',
    strength: row.strength || '-',
    pack_size: row.pack_size || '-',
    unit: '-',
    barcode: row.dar_code || '-',
    retail_price: row.unit_price ?? row.retail_price ?? '-',
    unit_price: row.unit_price ?? row.retail_price ?? '-',
    pack_price: row.pack_price || '-',
    usage_type: row.usage_type || 'Medicine',
    dar_code: row.dar_code || '-',
    medicine_type_category: row.medicine_type_category || '',
    registration_information: row.registration_information || '-',
  };
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#98a39c"
        style={[styles.input, !editable && styles.readOnlyInput]}
        value={value}
      />
    </View>
  );
}

export default function ProductManagementScreen({ isAddPage = false }: { isAddPage?: boolean }) {
  const { dashboardRole, session } = useAuth();
  const [ownerId, setOwnerId] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<{ name: string; count: number }[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [error, setError] = useState(supabase ? '' : 'Supabase is not configured.');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(Boolean(supabase));
  const [loadingCompanies, setLoadingCompanies] = useState(Boolean(supabase));
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadProducts = useCallback(async (requestedPage: number, requestedSearch: string, activeOwnerId: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    let query = supabase
      .from('pharmacy_catalog_products')
      .select('*', { count: 'exact' })
      .eq('owner_user_id', activeOwnerId);
    const term = requestedSearch.trim().replace(/[\\%_,()]/g, '\\$&');
    if (term) {
      query = query.or([
        'brand',
        'generic_name',
        'manufacturer',
        'strength',
        'dosage_form',
        'pack_size',
        'unit_price',
        'pack_price',
        'serial_number',
        'medicine_name',
        'id',
      ].map((column) => `${column}.ilike.%${term}%`).join(','));
    }
    const { data, count, error: queryError } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE - 1);
    if (queryError) throw queryError;
    setProducts((data ?? []) as ProductRow[]);
    setProductCount(count ?? 0);
    setCurrentPage(requestedPage);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function initialize() {
      try {
        const { data: { session }, error: sessionError } = await supabase!.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user) throw new Error('Sign in to manage pharmacy products.');
        let resolvedOwnerId = session.user.id;
        if (dashboardRole === 'staff') {
          const { data, error: contextError } = await supabase!.rpc('get_my_pharmacy_dashboard_context');
          if (contextError) throw contextError;
          const context = (data ?? [])[0] as { owner_user_id?: string } | undefined;
          if (!context?.owner_user_id) throw new Error('Could not find the pharmacy linked to this staff account.');
          resolvedOwnerId = context.owner_user_id;
        }
        if (!active) return;
        setOwnerId(resolvedOwnerId);
        await loadProducts(1, '', resolvedOwnerId);
      } catch (loadError) {
        if (active) setError(`Could not load products: ${getErrorMessage(loadError)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [dashboardRole, loadProducts]);

  useEffect(() => {
    if (!ownerId || isAddPage) return;
    let active = true;
    const timeout = setTimeout(() => {
      void loadProducts(currentPage, search, ownerId).catch((loadError: unknown) => {
        if (active) setError(`Could not search products: ${getErrorMessage(loadError)}`);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [currentPage, isAddPage, loadProducts, ownerId, search]);

  useEffect(() => {
    if (!supabase || !ownerId || isAddPage) return;
    const client = supabase;
    let active = true;
    const channel = client
      .channel(`pharmacy-product-list-${ownerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pharmacy_catalog_products',
          filter: `owner_user_id=eq.${ownerId}`,
        },
        () => {
          void loadProducts(currentPage, search, ownerId).catch((loadError: unknown) => {
            if (active) setError(`Could not refresh products after automatic import: ${getErrorMessage(loadError)}`);
          });
        },
      )
      .subscribe((status, subscribeError) => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setError(`Live product list updates are unavailable${subscribeError?.message ? `: ${subscribeError.message}` : '.'}`);
        }
      });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [currentPage, isAddPage, loadProducts, ownerId, search]);

  useEffect(() => {
    if (!supabase || !ownerId || isAddPage) return;
    let active = true;
    async function loadCompanies() {
      try {
        const { data, error: rpcError } = await supabase!.rpc('get_admin_catalog_manufacturers');
        if (rpcError) throw rpcError;
        if (active) {
          setCompanies(((data ?? []) as { pharmaceutical_company: string; product_count: number }[])
            .map((company) => ({
              name: company.pharmaceutical_company,
              count: Number(company.product_count),
            }))
            .filter((company) => company.name && company.count > 0));
        }
      } catch (companyError) {
        if (active) setError(`Could not load import catalog: ${getErrorMessage(companyError)}`);
      } finally {
        if (active) setLoadingCompanies(false);
      }
    }
    void loadCompanies();
    return () => {
      active = false;
    };
  }, [isAddPage, ownerId]);

  useEffect(() => {
    if (!supabase || !isAddPage) return;
    let active = true;
    async function reserveProductId() {
      try {
        if (dashboardRole === 'staff' && session?.user.id) {
          const token = `${Date.now()}-${session.user.id.slice(0, 8).toUpperCase()}`;
          if (active) {
            setForm((current) => ({
              ...current,
              id: `MED-${token}`,
              serialNumber: `SL-${token}`,
            }));
          }
          return;
        }
        const { data, error: rpcError } = await supabase!.rpc('reserve_pharmacy_product_identifiers');
        if (rpcError) throw rpcError;
        const identifier = (data ?? [])[0] as { serial_number?: string; product_id?: string } | undefined;
        if (!identifier?.product_id) throw new Error('The database did not return a product ID.');
        if (active) {
          setForm((current) => ({
            ...current,
            id: identifier.product_id ?? '',
            serialNumber: identifier.serial_number ?? '',
          }));
        }
      } catch (reservationError) {
        if (active) setError(`Could not reserve product ID: ${getErrorMessage(reservationError)}`);
      }
    }
    void reserveProductId();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAddPage, session?.user.id]);

  const totalPages = Math.max(1, Math.ceil(productCount / PAGE_SIZE));
  const firstVisible = productCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(currentPage * PAGE_SIZE, productCount);
  const totalCatalogCount = useMemo(() => companies.reduce((total, company) => total + company.count, 0), [companies]);

  function updateField(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  }

  function updatePrice(field: 'packSize' | 'unitPrice' | 'packPrice', value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      const packSize = parsePrice(next.packSize);
      const unitPrice = parsePrice(next.unitPrice);
      const packPrice = parsePrice(next.packPrice);
      if (field === 'packSize' && packSize !== null) {
        if (unitPrice !== null) next.packPrice = formatPrice(packSize * unitPrice);
        else if (packPrice !== null && packSize > 0) next.unitPrice = formatPrice(packPrice / packSize);
      } else if (field === 'unitPrice' && unitPrice !== null) {
        if (packSize !== null) next.packPrice = formatPrice(packSize * unitPrice);
        else if (packPrice !== null && unitPrice > 0) next.packSize = formatPrice(packPrice / unitPrice);
      } else if (field === 'packPrice' && packPrice !== null) {
        if (packSize !== null && packSize > 0) next.unitPrice = formatPrice(packPrice / packSize);
        else if (unitPrice !== null && unitPrice > 0) next.packSize = formatPrice(packPrice / unitPrice);
      }
      return next;
    });
    setError('');
  }

  async function saveProduct() {
    if (!supabase || !ownerId) {
      setError('Could not verify the signed-in pharmacy account.');
      return;
    }
    const brand = form.brand.trim();
    const company = form.company.trim();
    const prices = [form.packSize, form.unitPrice, form.packPrice];
    const parsedPrices = prices.map(parsePrice);
    if (!brand || !company) {
      setError('Brand Name and Company Name are required.');
      return;
    }
    if (!form.id) {
      setError('A product ID has not been reserved. Go back and reopen Add New Product.');
      return;
    }
    if (prices.some((value, index) => value.trim() && parsedPrices[index] === null)) {
      setError('Enter valid non-negative numbers for pack size and prices.');
      return;
    }
    const [packSize, unitPrice, packPrice] = parsedPrices;
    if (packSize !== null && packSize <= 0) {
      setError('Pack Size must be greater than zero.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const { data: matchingRows, error: duplicateError } = await supabase
        .from('pharmacy_catalog_products')
        .select('medicine_name, strength, dosage_form, manufacturer')
        .eq('owner_user_id', ownerId)
        .ilike('medicine_name', brand);
      if (duplicateError) throw duplicateError;
      const newIdentity = getIdentityKey({
        medicine_name: brand,
        strength: form.strength.trim() || '-',
        dosage_form: form.dosageForm.trim() || '-',
        manufacturer: company,
      });
      const isDuplicate = (matchingRows ?? []).some((row) => getIdentityKey({
        medicine_name: row.medicine_name,
        strength: row.strength,
        dosage_form: row.dosage_form,
        manufacturer: row.manufacturer,
      }) === newIdentity);
      if (isDuplicate) {
        throw new Error('This product already exists with the same name, strength, dosage form, and company.');
      }
      const product: ProductRow = {
        owner_user_id: ownerId,
        id: form.id,
        source_catalog_id: null,
        serial_number: form.serialNumber || '-',
        medicine_name: brand,
        brand,
        generic_name: form.genericName.trim() || '-',
        manufacturer: company,
        product_type: 'Medicine',
        category: '',
        dosage_form: form.dosageForm.trim() || '-',
        strength: form.strength.trim() || '-',
        pack_size: packSize === null ? '-' : formatPrice(packSize),
        unit: '-',
        barcode: '-',
        retail_price: unitPrice === null ? '-' : formatPrice(unitPrice),
        unit_price: unitPrice === null ? '-' : formatPrice(unitPrice),
        pack_price: packPrice === null ? '-' : formatPrice(packPrice),
        usage_type: 'Medicine',
        dar_code: '-',
        medicine_type_category: '',
        registration_information: '-',
      };
      const { error: insertError } = await supabase.from('pharmacy_catalog_products').insert(product);
      if (insertError) throw insertError;
      router.replace('/dashboard/menu/product-management');
    } catch (saveError) {
      setError(`Could not save product: ${getErrorMessage(saveError)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function loadCatalogRows(company?: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const rows: CatalogRow[] = [];
    for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
      let query = supabase.from('admin_medicine_catalog').select('*');
      if (company) query = query.eq('pharmaceutical_company', company);
      const { data, error: catalogError } = await query
        .order('id', { ascending: true })
        .range(offset, offset + CATALOG_PAGE_SIZE - 1);
      if (catalogError) throw catalogError;
      const page = (data ?? []) as CatalogRow[];
      rows.push(...page);
      if (page.length < CATALOG_PAGE_SIZE) return rows;
    }
  }

  async function importProducts(company?: string) {
    if (!supabase || !ownerId || isImporting) return;
    if (!company && totalCatalogCount === 0) return;
    setIsImporting(true);
    setError('');
    setNotice('');
    setImportProgress('Loading shared products…');
    let added = 0;
    try {
      const catalogRows = await loadCatalogRows(company);
      if (!catalogRows.length) throw new Error('No shared catalog products were found to import.');
      const existing: Pick<ProductRow, 'id' | 'source_catalog_id' | 'medicine_name' | 'strength' | 'dosage_form' | 'manufacturer'>[] = [];
      for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
        const { data, error: existingError } = await supabase
          .from('pharmacy_catalog_products')
          .select('id, source_catalog_id, medicine_name, strength, dosage_form, manufacturer')
          .eq('owner_user_id', ownerId)
          .order('id', { ascending: true })
          .range(offset, offset + CATALOG_PAGE_SIZE - 1);
        if (existingError) throw existingError;
        const page = (data ?? []) as typeof existing;
        existing.push(...page);
        if (page.length < CATALOG_PAGE_SIZE) break;
      }
      const importedIds = new Set(existing.map((product) => product.source_catalog_id).filter((id): id is string => Boolean(id)));
      const importedKeys = new Set(existing.map(getIdentityKey).filter((key): key is string => Boolean(key)));
      const productsToSave: ProductRow[] = [];
      let duplicates = 0;
      for (const row of catalogRows) {
        if (importedIds.has(row.id)) {
          duplicates += 1;
          continue;
        }
        const product = mapCatalogProduct(row, ownerId);
        const identity = getIdentityKey(product);
        if (identity && importedKeys.has(identity)) {
          duplicates += 1;
          continue;
        }
        productsToSave.push(product);
        importedIds.add(row.id);
        if (identity) importedKeys.add(identity);
      }
      for (let offset = 0; offset < productsToSave.length; offset += IMPORT_BATCH_SIZE) {
        const batch = productsToSave.slice(offset, offset + IMPORT_BATCH_SIZE);
        setImportProgress(`Importing ${Math.min(offset + batch.length, productsToSave.length)} of ${productsToSave.length}…`);
        const { error: insertError } = await supabase.from('pharmacy_catalog_products').insert(batch);
        if (insertError) throw insertError;
        added += batch.length;
      }
      setCurrentPage(1);
      setSearch('');
      await loadProducts(1, '', ownerId);
      setNotice(`Imported ${added} product(s). ${duplicates} duplicate(s) skipped.`);
      setImportProgress('');
    } catch (importError) {
      setError(`Product import failed${added ? ` after importing ${added} product(s)` : ''}: ${getErrorMessage(importError)}`);
      setImportProgress('');
    } finally {
      setIsImporting(false);
    }
  }

  if (isAddPage) {
    return (
      <SafeAreaView style={styles.screen}>
        <DashboardSubpageHeader
          subtitle="Add New Product"
          onBack={() => router.replace('/dashboard/menu/product-management')}
        />
        <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
          <View style={styles.sectionHeader}>
            <Text style={styles.heading}>Add New Product</Text>
            <Text style={styles.helperText}>Add product details and pricing to your pharmacy list.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Product details</Text>
            <Field editable={false} label="ID Number" value={form.id || 'Generating ID…'} />
            <Field label="Brand Name *" onChangeText={(value) => updateField('brand', value)} value={form.brand} />
            <Field label="Generic Name" onChangeText={(value) => updateField('genericName', value)} value={form.genericName} />
            <Field label="Company Name *" onChangeText={(value) => updateField('company', value)} value={form.company} />
            <Field label="Strength" onChangeText={(value) => updateField('strength', value)} value={form.strength} />
            <Field label="Dosage Form" onChangeText={(value) => updateField('dosageForm', value)} value={form.dosageForm} />
            <Text style={[styles.sectionTitle, styles.pricingTitle]}>Pack &amp; pricing</Text>
            <Field keyboardType="decimal-pad" label="Pack Size" onChangeText={(value) => updatePrice('packSize', value)} value={form.packSize} />
            <Field keyboardType="decimal-pad" label="Unit Price" onChangeText={(value) => updatePrice('unitPrice', value)} value={form.unitPrice} />
            <Field keyboardType="decimal-pad" label="Pack Price" onChangeText={(value) => updatePrice('packPrice', value)} value={form.packPrice} />
            <Text style={styles.helperText}>Enter any two values to calculate the third price.</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => void saveProduct()}
              style={[styles.primaryButton, isSaving && styles.disabledButton]}>
              <Text style={styles.primaryButtonText}>{isSaving ? 'Saving…' : 'Save Product'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <DashboardSubpageHeader subtitle="Product Management" />
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.heading}>Product Management</Text>
            <Text style={styles.helperText}>Manage your pharmacy catalog, prices, and product availability.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/dashboard/menu/add-new-product')}
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>+ Add New</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Import product data</Text>
          <Text style={styles.helperText}>Import one manufacturer or every product from the shared catalog.</Text>
          <Text style={styles.fieldLabel}>Manufacturer / company</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyList}>
            {companies.map((company) => (
              <Pressable
                key={company.name}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCompany === company.name }}
                onPress={() => setSelectedCompany((selected) => selected === company.name ? '' : company.name)}
                style={[styles.companyChip, selectedCompany === company.name && styles.selectedChip]}>
                <Text style={[styles.companyChipText, selectedCompany === company.name && styles.selectedChipText]}>
                  {company.name} ({company.count})
                </Text>
              </Pressable>
            ))}
            {loadingCompanies ? <ActivityIndicator color="#17664f" /> : null}
            {!loadingCompanies && companies.length === 0 ? (
              <Text style={styles.helperText}>No new shared products available.</Text>
            ) : null}
          </ScrollView>
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={isImporting || !selectedCompany}
              onPress={() => void importProducts(selectedCompany)}
              style={[styles.secondaryButton, (isImporting || !selectedCompany) && styles.disabledButton]}>
              <Text style={styles.secondaryButtonText}>Import company products</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isImporting || loadingCompanies || !totalCatalogCount}
              onPress={() => void importProducts()}
              style={[styles.primaryButton, (isImporting || loadingCompanies || !totalCatalogCount) && styles.disabledButton]}>
              <Text style={styles.primaryButtonText}>All Data Import</Text>
            </Pressable>
          </View>
          {isImporting ? <Text style={styles.helperText}>{importProgress}</Text> : null}
          {notice ? <Text style={styles.success}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Product list ({productCount})</Text>
          <TextInput
            accessibilityLabel="Search products"
            onChangeText={(value) => {
              setSearch(value);
              setCurrentPage(1);
              setExpandedProductId(null);
            }}
            placeholder="Search products…"
            placeholderTextColor="#98a39c"
            style={styles.input}
            value={search}
          />
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeading, styles.productBrandColumn]}>Brand Name</Text>
            <Text style={[styles.tableHeading, styles.productGenericColumn]}>Generic Name</Text>
            <Text style={[styles.tableHeading, styles.productCompanyColumn]}>Company</Text>
          </View>
          {loading ? <ActivityIndicator color="#17664f" style={styles.loader} /> : null}
          {!loading && products.map((product) => {
            const expanded = expandedProductId === product.id;
            return (
              <View key={product.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpandedProductId((current) => current === product.id ? null : product.id)}
                  style={styles.productRow}>
                  <Text numberOfLines={2} style={[styles.productCell, styles.productBrandColumn]}>{product.brand || '—'}</Text>
                  <Text numberOfLines={2} style={[styles.productCell, styles.productGenericColumn]}>{product.generic_name || '—'}</Text>
                  <Text numberOfLines={2} style={[styles.productCell, styles.productCompanyColumn]}>{product.manufacturer || '—'}</Text>
                </Pressable>
                {expanded ? (
                  <View style={styles.expandedDetails}>
                    {([
                      ['ID Number', product.source_catalog_id || product.id],
                      ['Strength', product.strength],
                      ['Dosage Form', product.dosage_form],
                      ['Pack Size', product.pack_size],
                      ['Unit Price', product.unit_price || product.retail_price],
                      ['Pack Price', product.pack_price || '-'],
                    ] as const).map(([label, value]) => (
                      <View key={label} style={styles.detailItem}>
                        <Text style={styles.detailLabel}>{label}</Text>
                        <Text style={styles.detailValue}>{value || '—'}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          {!loading && products.length === 0 ? (
            <Text style={styles.emptyText}>
              {search ? 'No products match your search.' : 'No products yet. Import from the shared catalog or add a product.'}
            </Text>
          ) : null}
          <View style={styles.pagination}>
            <Text style={styles.helperText}>Showing {firstVisible}-{lastVisible} of {productCount} products</Text>
            <View style={styles.paginationControls}>
              <Pressable
                accessibilityRole="button"
                disabled={currentPage <= 1}
                onPress={() => {
                  setCurrentPage((page) => Math.max(1, page - 1));
                  setExpandedProductId(null);
                }}
                style={[styles.pageButton, currentPage <= 1 && styles.disabledButton]}>
                <Text style={styles.pageButtonText}>Previous</Text>
              </Pressable>
              <Text style={styles.pageLabel}>Page {currentPage} of {totalPages}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={currentPage >= totalPages}
                onPress={() => {
                  setCurrentPage((page) => Math.min(totalPages, page + 1));
                  setExpandedProductId(null);
                }}
                style={[styles.pageButton, currentPage >= totalPages && styles.disabledButton]}>
                <Text style={styles.pageButtonText}>Next</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  pageContent: {
    flexGrow: 1,
    gap: 14,
    padding: 16,
  },
  sectionHeader: {
    gap: 12,
    alignItems: 'flex-start',
  },
  heading: {
    color: '#20342a',
    fontSize: 22,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#26352f',
    fontSize: 16,
    fontWeight: '700',
  },
  helperText: {
    marginTop: 4,
    color: '#6a7973',
    fontSize: 12,
    lineHeight: 18,
  },
  card: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  field: {
    gap: 6,
    marginTop: 10,
  },
  fieldLabel: {
    color: '#526158',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#d5dfd8',
    borderRadius: 7,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    color: '#26372f',
    fontSize: 14,
  },
  readOnlyInput: {
    backgroundColor: '#f4f7f4',
    color: '#65736b',
  },
  pricingTitle: {
    marginTop: 12,
  },
  primaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: '#179c70',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#179c70',
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#16845f',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  companyList: {
    maxHeight: 48,
  },
  companyChip: {
    justifyContent: 'center',
    marginRight: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 18,
    backgroundColor: '#fff',
  },
  selectedChip: {
    borderColor: '#179c70',
    backgroundColor: '#e8f5ee',
  },
  companyChipText: {
    color: '#526158',
    fontSize: 11,
  },
  selectedChipText: {
    color: '#17664f',
    fontWeight: '700',
  },
  tableHeader: {
    flexDirection: 'row',
    marginTop: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#dfe7e1',
    backgroundColor: '#f8faf8',
  },
  tableHeading: {
    color: '#6c7a73',
    fontSize: 10,
    fontWeight: '700',
  },
  productBrandColumn: {
    flex: 1.05,
  },
  productGenericColumn: {
    flex: 1.2,
    paddingHorizontal: 5,
  },
  productCompanyColumn: {
    flex: 1,
  },
  productRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0ed',
  },
  productCell: {
    color: '#34453b',
    fontSize: 11,
  },
  expandedDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ece8',
    backgroundColor: '#f8faf8',
  },
  detailItem: {
    width: '50%',
    paddingVertical: 7,
    paddingRight: 8,
  },
  detailLabel: {
    color: '#7a8981',
    fontSize: 10,
  },
  detailValue: {
    marginTop: 3,
    color: '#26372f',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    paddingVertical: 28,
    color: '#77857d',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
  },
  pagination: {
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#edf0ed',
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pageButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  pageButtonText: {
    color: '#34453b',
    fontSize: 11,
  },
  pageLabel: {
    color: '#687871',
    fontSize: 11,
  },
  loader: {
    marginVertical: 18,
  },
  error: {
    color: '#ad4b43',
    fontSize: 12,
    lineHeight: 18,
  },
  success: {
    color: '#17664f',
    fontSize: 12,
    lineHeight: 18,
  },
});
