import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const INVOICE_TEMPLATE_SETTINGS_KEY = 'pharmacy-invoice-templates-v1';
const MAX_TEMPLATE_ITEMS = 8;
const MAX_SIGNATURE_LENGTH = 2_800_000;

export type InvoiceFieldKey =
  | 'storeName'
  | 'invoiceNumber'
  | 'dateTime'
  | 'customer'
  | 'phone'
  | 'paymentMethod'
  | 'paymentStatus';

export type InvoiceTemplateItem =
  | { id: string; type: 'field'; key: InvoiceFieldKey; label: string; align?: 'left' | 'right' }
  | { id: string; type: 'text'; label: string; value: string; align?: 'left' | 'right' };

export type InvoiceTemplate = {
  id: string;
  name: string;
  style: 'classic' | 'modern' | 'compact' | 'elegant';
  header: InvoiceTemplateItem[];
  footer: InvoiceTemplateItem[];
};

export type InvoiceTemplateSettings = {
  templates: InvoiceTemplate[];
  activeTemplateId: string;
  pageSize: {
    format: 'a4' | 'a5' | 'custom';
    widthMm: number;
    heightMm: number;
  };
  seals: { paid: boolean; due: boolean };
  signature: { type: 'text' | 'image'; text: string; imageDataUrl: string };
};

export const invoiceFieldOptions: { key: InvoiceFieldKey; label: string }[] = [
  { key: 'storeName', label: 'Store name' },
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'dateTime', label: 'Date & time' },
  { key: 'customer', label: 'Customer name' },
  { key: 'phone', label: 'Customer phone' },
  { key: 'paymentMethod', label: 'Payment method' },
  { key: 'paymentStatus', label: 'Payment status' },
];

function makeDefaultTemplate(
  id: string,
  name: string,
  style: InvoiceTemplate['style'],
  fields: InvoiceFieldKey[],
  footerMessage: string,
): InvoiceTemplate {
  return {
    id,
    name,
    style,
    header: fields.map((key, index) => ({
      id: `${id}-header-${index}`,
      type: 'field',
      key,
      label: invoiceFieldOptions.find((field) => field.key === key)?.label ?? key,
      align: 'left',
    })),
    footer: [{ id: `${id}-footer-message`, type: 'text', label: 'Message', value: footerMessage }],
  };
}

export function createDefaultInvoiceTemplateSettings(): InvoiceTemplateSettings {
  return {
    templates: [
      makeDefaultTemplate(
        'classic',
        'Classic',
        'classic',
        ['storeName', 'invoiceNumber', 'dateTime', 'customer', 'phone', 'paymentMethod', 'paymentStatus'],
        'Thank you for your purchase.',
      ),
      makeDefaultTemplate(
        'modern',
        'Modern',
        'modern',
        ['storeName', 'customer', 'phone', 'dateTime', 'invoiceNumber', 'paymentStatus'],
        'We appreciate your business.',
      ),
      makeDefaultTemplate(
        'compact',
        'Compact',
        'compact',
        ['storeName', 'invoiceNumber', 'dateTime', 'customer', 'paymentStatus'],
        'Please keep this invoice for your records.',
      ),
      makeDefaultTemplate(
        'elegant',
        'Elegant',
        'elegant',
        ['storeName', 'invoiceNumber', 'customer', 'dateTime', 'phone', 'paymentMethod', 'paymentStatus'],
        'Thank you for choosing our pharmacy.',
      ),
    ],
    activeTemplateId: 'classic',
    pageSize: { format: 'a4', widthMm: 210, heightMm: 297 },
    seals: { paid: true, due: true },
    signature: { type: 'text', text: '', imageDataUrl: '' },
  };
}

function isFieldKey(value: unknown): value is InvoiceFieldKey {
  return invoiceFieldOptions.some((field) => field.key === value);
}

function isTemplateItem(value: unknown): value is InvoiceTemplateItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string'
    || item.id.length === 0
    || typeof item.label !== 'string'
    || item.label.length > 120
    || (item.align !== undefined && item.align !== 'left' && item.align !== 'right')
  ) return false;
  if (item.type === 'field') return isFieldKey(item.key);
  return item.type === 'text' && typeof item.value === 'string' && item.value.length <= 120;
}

export function isInvoiceTemplateSettings(value: unknown): value is InvoiceTemplateSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (
    !Array.isArray(settings.templates)
    || settings.templates.length !== 4
    || typeof settings.activeTemplateId !== 'string'
    || !settings.templates.every((template) => {
      if (!template || typeof template !== 'object' || Array.isArray(template)) return false;
      const candidate = template as Record<string, unknown>;
      return typeof candidate.id === 'string'
        && typeof candidate.name === 'string'
        && candidate.name.trim().length > 0
        && candidate.name.length <= 40
        && ['classic', 'modern', 'compact', 'elegant'].includes(String(candidate.style))
        && Array.isArray(candidate.header)
        && candidate.header.length <= MAX_TEMPLATE_ITEMS
        && candidate.header.every(isTemplateItem)
        && Array.isArray(candidate.footer)
        && candidate.footer.length <= MAX_TEMPLATE_ITEMS
        && candidate.footer.every(isTemplateItem);
    })
    || !settings.templates.some((template) => (
      Boolean(template)
      && typeof template === 'object'
      && (template as Record<string, unknown>).id === settings.activeTemplateId
    ))
  ) return false;

  const pageSize = settings.pageSize;
  const seals = settings.seals;
  const signature = settings.signature;
  if (pageSize !== undefined && (!pageSize || typeof pageSize !== 'object' || Array.isArray(pageSize))) return false;
  if (!seals || typeof seals !== 'object' || Array.isArray(seals)) return false;
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) return false;
  const size = pageSize as Record<string, unknown> | undefined;
  const sealSettings = seals as Record<string, unknown>;
  const signatureSettings = signature as Record<string, unknown>;
  return (!size || (
    ['a4', 'a5', 'custom'].includes(String(size.format))
    && typeof size.widthMm === 'number'
    && Number.isFinite(size.widthMm)
    && size.widthMm >= 50
    && size.widthMm <= 420
    && typeof size.heightMm === 'number'
    && Number.isFinite(size.heightMm)
    && size.heightMm >= 50
    && size.heightMm <= 590
  ))
    && typeof sealSettings.paid === 'boolean'
    && typeof sealSettings.due === 'boolean'
    && (signatureSettings.type === 'text' || signatureSettings.type === 'image')
    && typeof signatureSettings.text === 'string'
    && typeof signatureSettings.imageDataUrl === 'string'
    && signatureSettings.imageDataUrl.length <= MAX_SIGNATURE_LENGTH
    && (
      signatureSettings.imageDataUrl === ''
      || /^data:image\/(png|jpeg);base64,/.test(signatureSettings.imageDataUrl)
    );
}

export async function loadInvoiceTemplateSettings(ownerId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('pharmacy_app_data')
    .select('payload')
    .eq('owner_user_id', ownerId)
    .eq('data_key', INVOICE_TEMPLATE_SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  if (data?.payload === null || data?.payload === undefined) {
    return createDefaultInvoiceTemplateSettings();
  }
  if (!isInvoiceTemplateSettings(data.payload)) {
    throw new Error('Saved invoice setup is invalid. Update and save it from Cluster Menu → Documents.');
  }

  const defaults = createDefaultInvoiceTemplateSettings();
  return {
    ...data.payload,
    pageSize: data.payload.pageSize ?? defaults.pageSize,
    templates: data.payload.templates.map((template) => ({
      ...template,
      header: template.header.map((item) => ({ ...item, align: item.align ?? 'left' })),
    })),
  };
}

export async function saveInvoiceTemplateSettings(
  settings: InvoiceTemplateSettings,
  ownerId: string,
  client: SupabaseClient | null = supabase,
) {
  if (!client) throw new Error('Supabase is not configured.');
  if (!isInvoiceTemplateSettings(settings)) {
    throw new Error('Invoice template settings are incomplete or invalid.');
  }

  const existing = await client
    .from('pharmacy_app_data')
    .select('data_key')
    .eq('owner_user_id', ownerId)
    .eq('data_key', INVOICE_TEMPLATE_SETTINGS_KEY)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const now = new Date().toISOString();
  const result = existing.data
    ? await client
      .from('pharmacy_app_data')
      .update({ payload: settings, updated_at: now })
      .eq('owner_user_id', ownerId)
      .eq('data_key', INVOICE_TEMPLATE_SETTINGS_KEY)
      .select('data_key')
      .maybeSingle()
    : await client
      .from('pharmacy_app_data')
      .insert({
        owner_user_id: ownerId,
        data_key: INVOICE_TEMPLATE_SETTINGS_KEY,
        payload: settings,
        updated_at: now,
      })
      .select('data_key')
      .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Could not save invoice setup. Check your account permissions and try again.');
}
