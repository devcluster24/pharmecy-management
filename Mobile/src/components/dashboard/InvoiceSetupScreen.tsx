import * as Crypto from 'expo-crypto';
import { Text, TextInput, useLocalizedAlert, useTranslate } from '@/providers/LanguageProvider';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  createDefaultInvoiceTemplateSettings,
  invoiceFieldOptions,
  loadInvoiceTemplateSettings,
  saveInvoiceTemplateSettings,
  type InvoiceFieldKey,
  type InvoiceTemplate,
  type InvoiceTemplateItem,
  type InvoiceTemplateSettings,
} from '@/lib/invoice-template-settings';
import { useAuth } from '@/providers/AuthProvider';
import { getCurrencySymbol } from '@/lib/currency';
import { getPharmacyDisplayName } from '@/lib/pharmacy-display-name';

type EditableSection = 'header' | 'footer';
type PreviewStatus = 'paid' | 'due';

const templateAppearance: Record<InvoiceTemplate['style'], {
  accent: string;
  pale: string;
  ink: string;
  muted: string;
}> = {
  classic: { accent: '#17704e', pale: '#eff7f2', ink: '#26352f', muted: '#65746b' },
  modern: { accent: '#247a78', pale: '#ebf6f5', ink: '#1f3133', muted: '#607373' },
  compact: { accent: '#566fa6', pale: '#eff2fa', ink: '#273043', muted: '#66718a' },
  elegant: { accent: '#98714d', pale: '#f8f3ed', ink: '#382f28', muted: '#766653' },
};

function getPreviewValue(item: InvoiceTemplateItem, storeName: string) {
  if (item.type === 'text') return item.value.trim();
  const values: Record<InvoiceFieldKey, string> = {
    storeName: getPharmacyDisplayName(storeName),
    invoiceNumber: 'INV-2026-0184',
    dateTime: '22 Oct 2026, 10:30 AM',
    customer: 'Rahim Uddin',
    phone: '01712-345678',
    paymentMethod: 'Cash',
    paymentStatus: 'Paid',
  };
  const value = values[item.key];
  return item.key === 'storeName' ? value : `${item.label}: ${value}`;
}

function moveItem(items: InvoiceTemplateItem[], index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const reordered = [...items];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  return reordered;
}

export default function InvoiceSetupScreen() {
  const { alert } = useLocalizedAlert();
  const t = useTranslate();
  const { width } = useWindowDimensions();
  const { dashboardRole, isLoading: isAuthLoading, profileLoading, session, storeName } = useAuth();
  const [settings, setSettings] = useState<InvoiceTemplateSettings>(createDefaultInvoiceTemplateSettings);
  const [selectedTemplateId, setSelectedTemplateId] = useState('classic');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('paid');
  const [customWidth, setCustomWidth] = useState('210');
  const [customHeight, setCustomHeight] = useState('297');
  const [commonInfoSection, setCommonInfoSection] = useState<EditableSection | null>(null);
  const [headerCustomText, setHeaderCustomText] = useState('');
  const [footerCustomText, setFooterCustomText] = useState('');
  const [carouselWidth, setCarouselWidth] = useState(width - 32);
  const cardWidth = Math.max(150, (carouselWidth - 8) * 2 / 3);
  const carouselStep = cardWidth + 10;

  const selectedTemplate = settings.templates.find((template) => template.id === selectedTemplateId)
    ?? settings.templates[0];

  useFocusEffect(useCallback(() => {
    if (isAuthLoading || profileLoading || dashboardRole !== 'owner' || !session) return;
    const ownerId = session.user.id;
    let active = true;
    async function load() {
      setIsLoading(true);
      setError('');
      setMessage('');
      try {
        const loaded = await loadInvoiceTemplateSettings(ownerId);
        if (!active) return;
        setSettings(loaded);
        setSelectedTemplateId(loaded.activeTemplateId);
        setCustomWidth(String(loaded.pageSize.widthMm));
        setCustomHeight(String(loaded.pageSize.heightMm));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load invoice setup.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [dashboardRole, isAuthLoading, profileLoading, session]));

  function updateSelectedTemplate(update: (template: InvoiceTemplate) => InvoiceTemplate) {
    if (!selectedTemplate) return;
    setSettings((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.id === selectedTemplate.id ? update(template) : template),
    }));
    setError('');
    setMessage('');
  }

  function updateSection(section: EditableSection, update: (items: InvoiceTemplateItem[]) => InvoiceTemplateItem[]) {
    updateSelectedTemplate((template) => ({ ...template, [section]: update(template[section]) }));
  }

  function addCommonInfo(key: InvoiceFieldKey) {
    if (!commonInfoSection || !selectedTemplate) return;
    const section = commonInfoSection;
    if (selectedTemplate[section].length >= 8) {
      const message = `${section === 'header' ? 'Header' : 'Footer'} can contain at most 8 entries.`;
      setError(message);
      alert('Check your input', message);
      setCommonInfoSection(null);
      return;
    }
    const option = invoiceFieldOptions.find((field) => field.key === key);
    if (!option) return;
    updateSection(section, (items) => [...items, {
      id: Crypto.randomUUID(),
      type: 'field',
      key: option.key,
      label: option.label,
      align: section === 'header' ? 'left' : undefined,
    }]);
    setCommonInfoSection(null);
  }

  function addCustomText(section: EditableSection) {
    const value = (section === 'header' ? headerCustomText : footerCustomText).trim();
    if (!value) {
      const message = 'Enter information to add to the invoice.';
      setError(message);
      alert('Check your input', message);
      return;
    }
    if (!selectedTemplate || selectedTemplate[section].length >= 8) {
      const message = `${section === 'header' ? 'Header' : 'Footer'} can contain at most 8 entries.`;
      setError(message);
      alert('Check your input', message);
      return;
    }
    updateSection(section, (items) => [...items, {
      id: Crypto.randomUUID(),
      type: 'text',
      label: 'Text',
      value,
      ...(section === 'header' ? { align: 'left' as const } : {}),
    }]);
    if (section === 'header') setHeaderCustomText('');
    else setFooterCustomText('');
  }

  async function saveSetup() {
    if (dashboardRole !== 'owner' || !session) {
      const message = 'Invoice setup is available to pharmacy owners.';
      setError(message);
      alert('Error', message);
      return;
    }
    let pageSize = settings.pageSize;
    if (pageSize.format === 'custom') {
      const widthMm = Number(customWidth);
      const heightMm = Number(customHeight);
      if (!Number.isFinite(widthMm) || widthMm < 50 || widthMm > 420) {
        const message = 'Custom invoice width must be between 50 and 420 mm.';
        setError(message);
        alert('Check your input', message);
        return;
      }
      if (!Number.isFinite(heightMm) || heightMm < 50 || heightMm > 590) {
        const message = 'Custom invoice height must be between 50 and 590 mm.';
        setError(message);
        alert('Check your input', message);
        return;
      }
      pageSize = { ...pageSize, widthMm, heightMm };
    }
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const nextSettings = { ...settings, activeTemplateId: selectedTemplateId, pageSize };
      await saveInvoiceTemplateSettings(nextSettings, session.user.id);
      setSettings(nextSettings);
      const message = 'Invoice setup saved.';
      setMessage(message);
      alert('Success', message);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save invoice setup.';
      setError(message);
      alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  function renderTemplatePreview(template: InvoiceTemplate) {
    const appearance = templateAppearance[template.style];
    const leftItems = template.header.filter((item) => (item.align ?? 'left') === 'left');
    const rightItems = template.header.filter((item) => item.align === 'right');
    const footerItems = template.footer;
    const showSeal = previewStatus === 'paid' ? settings.seals.paid : settings.seals.due;
    const sealColor = previewStatus === 'paid' ? '#c91625' : '#d45232';
    const previewHeight = cardWidth * settings.pageSize.heightMm / settings.pageSize.widthMm;

    return (
      <View style={[
        styles.invoicePreview,
        {
          width: cardWidth,
          height: Math.min(previewHeight, 460),
          borderLeftWidth: template.style === 'compact' ? 4 : 1,
          borderLeftColor: template.style === 'compact' ? appearance.accent : '#e6eae7',
        },
      ]}>
        {template.style === 'modern' ? <View style={[styles.modernCorner, { borderTopColor: appearance.accent }]} /> : null}
        {template.style === 'elegant' ? <View style={[styles.elegantMark, { borderColor: appearance.accent }]} /> : null}
        <View style={[styles.previewHeading, { borderBottomColor: appearance.accent }]}>
          <Text style={[styles.previewTitle, { color: appearance.accent }]}>SALES INVOICE</Text>
          <Text style={styles.previewDate}>Date &amp; time: 22 Oct 2026</Text>
        </View>
        <View style={styles.previewHeaderRows}>
          <View style={styles.previewHeaderColumn}>
            {leftItems.length > 0 ? leftItems.slice(0, 4).map((item) => (
              <Text key={item.id} numberOfLines={1} style={[styles.previewMeta, { color: appearance.muted }]}>
                {getPreviewValue(item, storeName)}
              </Text>
            )) : <Text style={styles.previewMeta}>Header information</Text>}
          </View>
          <View style={[styles.previewHeaderColumn, styles.previewRightColumn]}>
            {rightItems.slice(0, 4).map((item) => (
              <Text key={item.id} numberOfLines={1} style={[styles.previewMeta, { color: appearance.muted }]}>
                {getPreviewValue(item, storeName)}
              </Text>
            ))}
          </View>
        </View>
        <Text style={[styles.previewInvoiceNumber, { color: appearance.accent }]}>INV-2026-0184</Text>
        <View style={[styles.previewTableHeading, { backgroundColor: appearance.pale }]}>
          <Text style={[styles.previewTableText, { color: appearance.accent, flex: 1.5 }]}>Item</Text>
          <Text style={[styles.previewTableText, { color: appearance.accent }]}>Qty</Text>
          <Text style={[styles.previewTableText, { color: appearance.accent }]}>Price</Text>
          <Text style={[styles.previewTableText, { color: appearance.accent }]}>Total</Text>
        </View>
        {[
          ['Paracetamol 500mg', '2', '৳ 10', '৳ 20'],
          ['Vitamin C', '1', '৳ 35', '৳ 35'],
          ['Oral saline', '3', '৳ 10', '৳ 30'],
        ].map(([item, qty, price, total]) => (
          <View key={item} style={styles.previewTableRow}>
            <Text numberOfLines={1} style={[styles.previewTableCell, { flex: 1.5, color: appearance.ink }]}>{item}</Text>
            <Text style={[styles.previewTableCell, { color: appearance.ink }]}>{qty}</Text>
            <Text style={[styles.previewTableCell, { color: appearance.ink }]}>{price}</Text>
            <Text style={[styles.previewTableCell, { color: appearance.ink }]}>{total}</Text>
          </View>
        ))}
        <View style={styles.previewTotals}>
          <Text style={[styles.previewTotalText, { color: appearance.muted }]}>Total: {getCurrencySymbol()} 85.00</Text>
          <Text style={[styles.previewTotalText, { color: appearance.muted }]}>Paid: {getCurrencySymbol()} {previewStatus === 'paid' ? '85.00' : '50.00'}</Text>
          <Text style={[styles.previewTotalText, { color: appearance.accent }]}>Due: {getCurrencySymbol()} {previewStatus === 'paid' ? '0.00' : '35.00'}</Text>
        </View>
        {showSeal ? (
          <View style={[styles.paymentSeal, { borderColor: sealColor }]}>
            <Text style={[styles.paymentSealText, { color: sealColor }]}>{previewStatus.toUpperCase()}</Text>
          </View>
        ) : null}
        <View style={styles.previewFooter}>
          {settings.signature.text.trim() ? (
            <Text numberOfLines={1} style={[styles.previewSignature, { color: appearance.ink }]}>
              {settings.signature.text.trim()}
            </Text>
          ) : null}
          <Text style={[styles.previewMeta, { color: appearance.muted }]}>Signature</Text>
          {footerItems.slice(0, 2).map((item) => (
            <Text key={item.id} numberOfLines={1} style={[styles.previewMeta, { color: appearance.muted }]}>
              {getPreviewValue(item, storeName)}
            </Text>
          ))}
        </View>
      </View>
    );
  }

  function renderSection(section: EditableSection) {
    if (!selectedTemplate) return null;
    const items = selectedTemplate[section];
    const sectionTitle = section === 'header' ? 'Header information' : 'Footer information';
    const customText = section === 'header' ? headerCustomText : footerCustomText;
    const setCustomText = section === 'header' ? setHeaderCustomText : setFooterCustomText;

    return (
      <View style={styles.panel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t(sectionTitle)}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving || items.length >= 8}
            onPress={() => setCommonInfoSection(section)}
            style={[styles.smallButton, items.length >= 8 && styles.disabledButton]}>
            <Text style={styles.smallButtonText}>+ {t('Add info')}</Text>
          </Pressable>
        </View>
        <Text style={styles.helperText}>
          {section === 'header'
            ? 'Add store, invoice, customer, payment, or other information.'
            : 'Add invoice notes, payment details, or a message.'}
        </Text>
        <View style={styles.addTextRow}>
          <TextInput
            accessibilityLabel={`Custom text for ${section}`}
            maxLength={120}
            onChangeText={setCustomText}
            onSubmitEditing={() => addCustomText(section)}
            placeholder="Add custom information or a message"
            returnKeyType="done"
            style={styles.input}
            value={customText}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isSaving || items.length >= 8}
            onPress={() => addCustomText(section)}
            style={[styles.smallButton, items.length >= 8 && styles.disabledButton]}>
            <Text style={styles.smallButtonText}>{t('Add text')}</Text>
          </Pressable>
        </View>
        {items.length > 0 ? items.map((item, index) => (
          <View key={item.id} style={styles.editorItem}>
            <Text style={styles.itemIndex}>{index + 1}</Text>
            <View style={styles.itemFields}>
              {item.type === 'field' ? (
                <TextInput
                  accessibilityLabel={`Edit ${section} label ${index + 1}`}
                  maxLength={120}
                  onChangeText={(label) => updateSection(section, (current) => current.map((entry) => (
                    entry.id === item.id && entry.type === 'field' ? { ...entry, label } : entry
                  )))}
                  style={styles.input}
                  value={item.label}
                />
              ) : (
                <TextInput
                  accessibilityLabel={`Edit ${section} text ${index + 1}`}
                  maxLength={120}
                  onChangeText={(value) => updateSection(section, (current) => current.map((entry) => (
                    entry.id === item.id && entry.type === 'text' ? { ...entry, value } : entry
                  )))}
                  style={styles.input}
                  value={item.value}
                />
              )}
              {section === 'header' ? (
                <View style={styles.alignmentRow}>
                  <Text style={styles.itemHint}>{item.type === 'field' ? 'Common information' : 'Custom text'}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Align ${item.label} ${(item.align ?? 'left') === 'left' ? 'right' : 'left'}`}
                    onPress={() => updateSection(section, (current) => current.map((entry) => (
                      entry.id === item.id ? { ...entry, align: (entry.align ?? 'left') === 'left' ? 'right' : 'left' } : entry
                    )))}
                    style={styles.alignmentButton}>
                    <Text style={styles.alignmentButtonText}>{(item.align ?? 'left') === 'left' ? 'Left' : 'Right'}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.itemHint}>{item.type === 'field' ? 'Common information' : 'Custom text'}</Text>
              )}
            </View>
            <View style={styles.itemActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${section} item up`}
                disabled={index === 0}
                onPress={() => updateSection(section, (current) => moveItem(current, index, -1))}
                style={[styles.iconButton, index === 0 && styles.disabledButton]}>
                <Text style={styles.iconButtonText}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${section} item down`}
                disabled={index === items.length - 1}
                onPress={() => updateSection(section, (current) => moveItem(current, index, 1))}
                style={[styles.iconButton, index === items.length - 1 && styles.disabledButton]}>
                <Text style={styles.iconButtonText}>↓</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${section} item`}
                onPress={() => updateSection(section, (current) => current.filter((entry) => entry.id !== item.id))}
                style={[styles.iconButton, styles.removeButton]}>
                <Text style={styles.removeButtonText}>×</Text>
              </Pressable>
            </View>
          </View>
        )) : (
          <Text style={styles.emptyItems}>No information added to this section.</Text>
        )}
      </View>
    );
  }

  if (dashboardRole && dashboardRole !== 'owner' && !isAuthLoading && !profileLoading) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <Text style={styles.error}>Invoice setup is available to pharmacy owners.</Text>
      </ScrollView>
    );
  }

  if (isAuthLoading || profileLoading || isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#17664f" />
      </View>
    );
  }

  const pageSize = settings.pageSize;

  return (
    <ScrollView
      pointerEvents={isSaving ? 'none' : 'auto'}
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('Invoice Setup')}</Text>
      <Text style={styles.subtitle}>
        Choose one of four invoice templates. The active template is used for mobile sale invoice PDFs and printing.
      </Text>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{t(message)}</Text> : null}

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{t('Invoice page size')}</Text>
        <View style={styles.sizeChoices}>
          {([
            ['a4', 'A4', 210, 297],
            ['a5', 'A4 half / A5', 148, 210],
            ['custom', 'Custom size', pageSize.widthMm, pageSize.heightMm],
          ] as const).map(([format, label, widthMm, heightMm]) => {
            const selected = pageSize.format === format;
            return (
              <Pressable
                key={format}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setSettings((current) => ({
                    ...current,
                    pageSize: { format, widthMm, heightMm },
                  }));
                  if (format !== 'custom') {
                    setCustomWidth(String(widthMm));
                    setCustomHeight(String(heightMm));
                  }
                }}
                style={[styles.sizeChoice, selected && styles.sizeChoiceSelected]}>
                <Text style={[styles.sizeChoiceTitle, selected && styles.sizeChoiceTextSelected]}>{label}</Text>
                <Text style={[styles.sizeChoiceDetail, selected && styles.sizeChoiceTextSelected]}>
                  {widthMm} × {heightMm} mm
                </Text>
              </Pressable>
            );
          })}
        </View>
        {pageSize.format === 'custom' ? (
          <View style={styles.dimensionRow}>
            <View style={styles.dimensionField}>
              <Text style={styles.fieldLabel}>Width (mm)</Text>
              <TextInput
                accessibilityLabel="Invoice width in millimeters"
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={(value) => {
                  if (!/^\d{0,3}$/.test(value)) return;
                  setCustomWidth(value);
                  const parsed = Number(value);
                  if (parsed >= 50 && parsed <= 420) {
                    setSettings((current) => ({ ...current, pageSize: { ...current.pageSize, widthMm: parsed } }));
                  }
                }}
                style={styles.input}
                value={customWidth}
              />
            </View>
            <View style={styles.dimensionField}>
              <Text style={styles.fieldLabel}>Height (mm)</Text>
              <TextInput
                accessibilityLabel="Invoice height in millimeters"
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={(value) => {
                  if (!/^\d{0,3}$/.test(value)) return;
                  setCustomHeight(value);
                  const parsed = Number(value);
                  if (parsed >= 50 && parsed <= 590) {
                    setSettings((current) => ({ ...current, pageSize: { ...current.pageSize, heightMm: parsed } }));
                  }
                }}
                style={styles.input}
                value={customHeight}
              />
            </View>
          </View>
        ) : (
          <Text style={styles.helperText}>This paper size is used for invoice previews and sale PDFs.</Text>
        )}
      </View>

      <View style={styles.demoStatusRow}>
        <Text style={styles.demoStatusLabel}>{t('Demo status:')}</Text>
        {(['paid', 'due'] as const).map((status) => (
          <Pressable
            key={status}
            accessibilityRole="button"
            accessibilityState={{ selected: previewStatus === status }}
            onPress={() => setPreviewStatus(status)}
            style={[styles.statusChoice, previewStatus === status && styles.statusChoiceSelected]}>
            <Text style={[styles.statusChoiceText, previewStatus === status && styles.statusChoiceTextSelected]}>
              {status === 'paid' ? t('Paid') : t('Due')}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.demoNote}>Preview only.</Text>
      </View>

      <View
        onLayout={(event) => setCarouselWidth(event.nativeEvent.layout.width)}
        style={styles.carouselContainer}>
        <ScrollView
          horizontal
          decelerationRate="fast"
          disableIntervalMomentum
          snapToAlignment="start"
          snapToInterval={carouselStep}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
          onMomentumScrollEnd={(event) => {
            const index = Math.min(
              settings.templates.length - 1,
              Math.max(0, Math.round(event.nativeEvent.contentOffset.x / carouselStep)),
            );
            const template = settings.templates[index];
            if (template) setSelectedTemplateId(template.id);
          }}>
          {settings.templates.map((template) => {
            const selected = template.id === selectedTemplateId;
            const active = template.id === settings.activeTemplateId;
            return (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                accessibilityState={{ selected, checked: active }}
                onPress={() => setSelectedTemplateId(template.id)}
                style={[styles.templateCard, { width: cardWidth }, selected && styles.templateCardSelected]}>
                {renderTemplatePreview(template)}
                <Text numberOfLines={1} style={styles.templateCardName}>
                  {template.name || 'Untitled template'}
                </Text>
                <Text style={[styles.templateCardStatus, active && styles.activeTemplateStatus]}>
                  {active ? t('Active template') : t('Tap to edit')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.swipeHint}>Swipe to view the next template →</Text>
      </View>

      {selectedTemplate ? (
        <>
          <View style={styles.panel}>
            <Text style={styles.fieldLabel}>{t('Template name')}</Text>
            <TextInput
              accessibilityLabel="Template name"
              maxLength={40}
              onChangeText={(name) => updateSelectedTemplate((template) => ({ ...template, name }))}
              style={styles.input}
              value={selectedTemplate.name}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => setSettings((current) => ({ ...current, activeTemplateId: selectedTemplate.id }))}
              style={[
                styles.activeTemplateButton,
                settings.activeTemplateId === selectedTemplate.id && styles.activeTemplateButtonSelected,
              ]}>
              <Text style={[
                styles.activeTemplateButtonText,
                settings.activeTemplateId === selectedTemplate.id && styles.activeTemplateButtonTextSelected,
              ]}>
                {settings.activeTemplateId === selectedTemplate.id ? t('Active template') : t('Use this template')}
              </Text>
            </Pressable>
          </View>
          {renderSection('header')}
          {renderSection('footer')}
        </>
      ) : null}

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{t('Invoice payment seals')}</Text>
        {([
          ['paid', 'Show PAID seal on fully paid invoices'],
          ['due', 'Show DUE seal when an amount is due'],
        ] as const).map(([key, label]) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t(label)}</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: settings.seals[key] }}
              onPress={() => setSettings((current) => ({
                ...current,
                seals: { ...current.seals, [key]: !current.seals[key] },
              }))}
              style={[styles.switchTrack, settings.seals[key] && styles.switchTrackOn]}>
              <View style={[styles.switchThumb, settings.seals[key] && styles.switchThumbOn]} />
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{t('Signature')}</Text>
        <Text style={styles.helperText}>
          Enter the signature text to print at the bottom of the sale invoice.
        </Text>
        <TextInput
          accessibilityLabel="Signature text"
          maxLength={80}
          onChangeText={(text) => setSettings((current) => ({
            ...current,
            signature: { ...current.signature, type: 'text', text },
          }))}
          placeholder="Pharmacy owner name"
          style={styles.input}
          value={settings.signature.text}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isSaving}
        onPress={() => void saveSetup()}
        style={[styles.saveButton, isSaving && styles.disabledButton]}>
        {isSaving ? <ActivityIndicator size="small" color="#fff" /> : null}
        <Text style={styles.saveButtonText}>{isSaving ? t('Saving...') : t('Save Invoice Setup')}</Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setCommonInfoSection(null)}
        transparent
        visible={commonInfoSection !== null}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t('Add common information')}</Text>
            <ScrollView style={styles.fieldOptions}>
              {invoiceFieldOptions.map((field) => (
                <Pressable
                  key={field.key}
                  accessibilityRole="button"
                  onPress={() => addCommonInfo(field.key)}
                  style={styles.fieldOption}>
                  <Text style={styles.fieldOptionText}>{t(field.label)}</Text>
                  <Text style={styles.fieldOptionPlus}>+</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCommonInfoSection(null)}
              style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f4f8f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f8f5',
  },
  title: {
    color: '#203128',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: -7,
    color: '#718078',
    fontSize: 12,
    lineHeight: 18,
  },
  panel: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e1eae4',
    borderRadius: 11,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    color: '#203128',
    fontSize: 14,
    fontWeight: '700',
  },
  helperText: {
    color: '#718078',
    fontSize: 11,
    lineHeight: 16,
  },
  sizeChoices: {
    flexDirection: 'row',
    gap: 7,
  },
  sizeChoice: {
    flex: 1,
    minWidth: 0,
    padding: 9,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  sizeChoiceSelected: {
    borderColor: '#179c70',
    backgroundColor: '#eff9f4',
  },
  sizeChoiceTitle: {
    color: '#34453b',
    fontSize: 10,
    fontWeight: '700',
  },
  sizeChoiceDetail: {
    marginTop: 4,
    color: '#718078',
    fontSize: 9,
  },
  sizeChoiceTextSelected: {
    color: '#17664f',
  },
  dimensionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dimensionField: {
    flex: 1,
    gap: 5,
  },
  fieldLabel: {
    color: '#34453b',
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
    color: '#26352f',
    fontSize: 12,
  },
  demoStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
  },
  demoStatusLabel: {
    marginRight: 3,
    color: '#687871',
    fontSize: 11,
  },
  statusChoice: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  statusChoiceSelected: {
    borderColor: '#d9eee2',
    backgroundColor: '#e8f6ee',
  },
  statusChoiceText: {
    color: '#526158',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusChoiceTextSelected: {
    color: '#16845f',
  },
  demoNote: {
    color: '#87928d',
    fontSize: 10,
  },
  carouselContainer: {
    gap: 6,
    marginHorizontal: -16,
  },
  carouselContent: {
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  templateCard: {
    alignItems: 'flex-start',
    gap: 5,
    padding: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  templateCardSelected: {
    borderColor: '#b9dec8',
    backgroundColor: '#eff9f4',
  },
  invoicePreview: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e6eae7',
    borderRadius: 4,
    backgroundColor: '#fff',
    position: 'relative',
  },
  modernCorner: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderTopWidth: 24,
    borderLeftWidth: 24,
    borderLeftColor: 'transparent',
  },
  elegantMark: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 12,
    height: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  previewHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
    paddingBottom: 5,
    borderBottomWidth: 2,
  },
  previewTitle: {
    fontSize: 7,
    fontWeight: '800',
  },
  previewDate: {
    color: '#718078',
    fontSize: 4.5,
  },
  previewHeaderRows: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
    marginTop: 6,
  },
  previewHeaderColumn: {
    flex: 1,
    gap: 3,
  },
  previewRightColumn: {
    alignItems: 'flex-end',
  },
  previewMeta: {
    fontSize: 5,
    lineHeight: 7,
  },
  previewInvoiceNumber: {
    marginTop: 7,
    fontSize: 8,
    fontWeight: '700',
  },
  previewTableHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 3,
    marginTop: 7,
    padding: 4,
  },
  previewTableText: {
    fontSize: 5,
    fontWeight: '700',
    textAlign: 'right',
  },
  previewTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 3,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7ede9',
  },
  previewTableCell: {
    flex: 1,
    fontSize: 5,
    textAlign: 'right',
  },
  previewTotals: {
    alignItems: 'flex-end',
    gap: 4,
    marginTop: 7,
  },
  previewTotalText: {
    fontSize: 6,
    fontWeight: '600',
  },
  paymentSeal: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderRadius: 8,
  },
  paymentSealText: {
    fontSize: 10,
    fontWeight: '900',
  },
  previewFooter: {
    position: 'absolute',
    right: 9,
    bottom: 10,
    left: 9,
    gap: 3,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: '#e7ede9',
  },
  previewSignature: {
    fontSize: 7,
    fontStyle: 'italic',
  },
  templateCardName: {
    width: '100%',
    marginTop: 3,
    color: '#203128',
    fontSize: 12,
    fontWeight: '700',
  },
  templateCardStatus: {
    color: '#718078',
    fontSize: 9,
  },
  activeTemplateStatus: {
    color: '#16845f',
    fontWeight: '700',
  },
  swipeHint: {
    paddingHorizontal: 17,
    color: '#718078',
    fontSize: 10,
    textAlign: 'right',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  smallButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: '#e8f6ee',
  },
  smallButtonText: {
    color: '#16845f',
    fontSize: 10,
    fontWeight: '700',
  },
  addTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  editorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 7,
    borderWidth: 1,
    borderColor: '#e7ede9',
    borderRadius: 8,
    backgroundColor: '#fbfdfb',
  },
  itemIndex: {
    width: 18,
    color: '#93a099',
    fontSize: 10,
    textAlign: 'center',
  },
  itemFields: {
    flex: 1,
    gap: 5,
  },
  itemHint: {
    color: '#87928d',
    fontSize: 9,
  },
  alignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  alignmentButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  alignmentButtonText: {
    color: '#526158',
    fontSize: 9,
  },
  itemActions: {
    gap: 4,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 29,
    height: 29,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  iconButtonText: {
    color: '#526158',
    fontSize: 13,
  },
  removeButton: {
    borderColor: '#f0d3cf',
    backgroundColor: '#fff8f7',
  },
  removeButtonText: {
    color: '#ad4b43',
    fontSize: 17,
    lineHeight: 20,
  },
  emptyItems: {
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#dce5df',
    borderRadius: 7,
    color: '#87928d',
    fontSize: 10,
    textAlign: 'center',
  },
  activeTemplateButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  activeTemplateButtonSelected: {
    borderColor: '#179c70',
    backgroundColor: '#179c70',
  },
  activeTemplateButtonText: {
    color: '#526158',
    fontSize: 10,
    fontWeight: '700',
  },
  activeTemplateButtonTextSelected: {
    color: '#fff',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 5,
  },
  switchLabel: {
    flex: 1,
    color: '#34453b',
    fontSize: 11,
    lineHeight: 16,
  },
  switchTrack: {
    justifyContent: 'center',
    width: 42,
    height: 24,
    padding: 3,
    borderRadius: 15,
    backgroundColor: '#cbd5ce',
  },
  switchTrackOn: {
    backgroundColor: '#179c70',
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 46,
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: '#179c70',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  error: {
    padding: 11,
    borderWidth: 1,
    borderColor: '#f0d3cf',
    borderRadius: 7,
    backgroundColor: '#fff8f7',
    color: '#ad4b43',
    fontSize: 11,
    lineHeight: 16,
  },
  success: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#cce9d8',
    borderRadius: 7,
    backgroundColor: '#f3fbf6',
    color: '#16845f',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(20, 35, 27, 0.45)',
  },
  modalCard: {
    maxHeight: '80%',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  fieldOptions: {
    marginTop: 10,
  },
  fieldOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e1eae4',
  },
  fieldOptionText: {
    color: '#34453b',
    fontSize: 12,
  },
  fieldOptionPlus: {
    color: '#16845f',
    fontSize: 18,
    fontWeight: '700',
  },
  cancelButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelButtonText: {
    color: '#526158',
    fontSize: 11,
    fontWeight: '700',
  },
});
