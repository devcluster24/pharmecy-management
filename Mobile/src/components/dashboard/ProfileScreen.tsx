import * as Crypto from 'expo-crypto';
import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Text, useTranslate } from '@/providers/LanguageProvider';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type ProfileDetails = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  storeName: string;
  photoUrl: string;
};

const PHOTO_BUCKET = 'user-profile-photos';
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

function safePhotoUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function displayRole(role: string) {
  if (role === 'pharmacy_staff') return 'Pharmacy Staff';
  if (role === 'pharmacy_user') return 'Pharmacy Owner';
  return role.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function getPhotoExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return null;
}

function getPhotoMimeType(photo: ImagePicker.ImagePickerAsset) {
  const mimeType = photo.mimeType ?? photo.file?.type ?? '';
  if (getPhotoExtension(mimeType)) return mimeType;
  const fileName = photo.fileName ?? photo.uri;
  const extension = fileName.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
}

export default function ProfileScreen() {
  const t = useTranslate();
  const {
    isLoading: isAuthLoading,
    profileLoading,
    session,
  } = useAuth();
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [fullNameDraft, setFullNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useFocusEffect(useCallback(() => {
    if (isAuthLoading || profileLoading) return;
    if (!session) {
      setError('Sign in to view your profile.');
      setIsLoading(false);
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured.');
      setIsLoading(false);
      return;
    }

    const client = supabase;
    const userId = session.user.id;
    let active = true;

    async function loadProfile() {
      setIsLoading(true);
      setError('');
      try {
        const { data: userResult, error: userError } = await client.auth.getUser();
        if (userError) throw userError;
        const user = userResult.user;
        if (!user || user.id !== userId) throw new Error('Sign in again to view your profile.');

        const { data, error: profileError } = await client
          .from('user_profiles')
          .select('full_name, email, phone, role, approval_status')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!data) throw new Error('Your profile information could not be found.');

        let storeName = '';
        if (data.role === 'pharmacy_staff') {
          const { data: contextData, error: contextError } = await client.rpc('get_my_pharmacy_dashboard_context');
          if (contextError) throw contextError;
          const context = contextData?.[0] as { store_name?: string } | undefined;
          storeName = context?.store_name ?? '';
        } else {
          const { data: pharmacy, error: pharmacyError } = await client
            .from('pharmacies')
            .select('store_name')
            .eq('owner_user_id', user.id)
            .maybeSingle();
          if (pharmacyError) throw pharmacyError;
          storeName = pharmacy?.store_name ?? '';
        }

        const metadata = user.user_metadata ?? {};
        const photoUrl = [
          metadata.avatar_url,
          metadata.picture,
          metadata.profile_photo_url,
          metadata.photo_url,
        ].map(safePhotoUrl).find(Boolean) ?? '';
        if (!active) return;

        const loadedProfile = {
          fullName: data.full_name ?? '',
          email: data.email || user.email || '',
          phone: data.phone ?? '',
          role: displayRole(data.role),
          status: data.approval_status === 'approved' ? 'Active' : 'Inactive',
          storeName,
          photoUrl,
        };
        setProfile(loadedProfile);
        setFullNameDraft(loadedProfile.fullName);
        setPhoneDraft(loadedProfile.phone);
        setSelectedPhoto(null);
        setIsEditing(false);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load your profile.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [isAuthLoading, profileLoading, session]));

  async function choosePhoto() {
    setError('');
    setMessage('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const photo = result.assets[0];
      if (!photo) throw new Error('Could not read the selected photo.');
      const extension = getPhotoExtension(getPhotoMimeType(photo));
      if (!extension) throw new Error('Choose a JPG, PNG, or WebP image.');
      const fileSize = photo.fileSize ?? photo.file?.size;
      if (fileSize !== undefined && fileSize > MAX_PHOTO_SIZE) {
        throw new Error('Profile photos must be 5 MB or smaller.');
      }
      setSelectedPhoto(photo);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Could not select a profile photo.');
    }
  }

  function cancelEditing() {
    setFullNameDraft(profile?.fullName ?? '');
    setPhoneDraft(profile?.phone ?? '');
    setSelectedPhoto(null);
    setIsEditing(false);
    setError('');
    setMessage('');
  }

  async function saveProfile() {
    if (!supabase || !session || !profile) {
      setError('Sign in again before updating your profile.');
      return;
    }
    const fullName = fullNameDraft.trim();
    const phone = phoneDraft.trim();
    if (!fullName || fullName.length > 120) {
      setError('Full name must contain between 1 and 120 characters.');
      return;
    }
    if (phone.length > 32) {
      setError('Phone number cannot exceed 32 characters.');
      return;
    }

    const client = supabase;
    const userId = session.user.id;
    let uploadedPhotoPath = '';
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      let photoUrl: string | null = null;
      if (selectedPhoto) {
        const mimeType = getPhotoMimeType(selectedPhoto);
        const extension = getPhotoExtension(mimeType);
        if (!extension) throw new Error('Choose a JPG, PNG, or WebP image.');
        const imageFile = new ExpoFile(selectedPhoto.uri);
        const fileSize = selectedPhoto.fileSize ?? imageFile.size;
        if (fileSize > MAX_PHOTO_SIZE) throw new Error('Profile photos must be 5 MB or smaller.');

        uploadedPhotoPath = `${userId}/avatar-${Crypto.randomUUID()}.${extension}`;
        const uploadBody = selectedPhoto.file ?? await imageFile.arrayBuffer();
        const { error: uploadError } = await client.storage
          .from(PHOTO_BUCKET)
          .upload(uploadedPhotoPath, uploadBody, {
            contentType: mimeType,
            cacheControl: '3600',
            upsert: false,
          });
        if (uploadError) throw uploadError;
        photoUrl = `${client.storage.from(PHOTO_BUCKET).getPublicUrl(uploadedPhotoPath).data.publicUrl}?v=${Date.now()}`;
      }

      const { error: updateError } = await client.rpc('update_my_pharmacy_profile', {
        requested_full_name: fullName,
        requested_phone: phone,
        requested_photo_url: photoUrl,
      });
      if (updateError) throw updateError;

      if (photoUrl && profile.photoUrl) {
        const bucketPath = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
        try {
          const previousPhoto = new URL(profile.photoUrl);
          const markerIndex = previousPhoto.pathname.indexOf(bucketPath);
          if (markerIndex >= 0) {
            const previousPath = decodeURIComponent(previousPhoto.pathname.slice(markerIndex + bucketPath.length));
            if (previousPath.startsWith(`${userId}/`)) {
              const { error: removeError } = await client.storage.from(PHOTO_BUCKET).remove([previousPath]);
              if (removeError) throw removeError;
            }
          }
        } catch (cleanupError) {
          console.error('Profile updated, but the previous profile photo could not be removed.', cleanupError);
        }
      }

      setProfile({
        ...profile,
        fullName,
        phone,
        photoUrl: photoUrl ?? profile.photoUrl,
      });
      setSelectedPhoto(null);
      setIsEditing(false);
      setMessage('Your profile has been updated.');
    } catch (saveError) {
      if (uploadedPhotoPath) {
        const { error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([uploadedPhotoPath]);
        if (cleanupError) console.error('Could not remove the profile photo after the profile update failed.', cleanupError);
      }
      setError(saveError instanceof Error ? saveError.message : 'Could not update your profile.');
    } finally {
      setIsSaving(false);
    }
  }

  const initials = profile?.fullName.trim()
    ? profile.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase()
    : profile?.email.slice(0, 1).toLocaleUpperCase() || '?';
  const displayedPhoto = selectedPhoto?.uri || profile?.photoUrl || '';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.cover} />
        <View style={styles.cardContent}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              {displayedPhoto ? (
                <Image alt={t('Profile photo')} source={{ uri: displayedPhoto }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
            </View>
            <View style={styles.identityText}>
              <Text style={styles.profileName}>
                {isLoading ? t('Loading profile...') : isEditing ? fullNameDraft || t('Your profile') : profile?.fullName || t('Your profile')}
              </Text>
              {profile?.email ? <Text style={styles.email}>{profile.email}</Text> : null}
            </View>
            {profile ? (
              <View style={[styles.statusBadge, profile.status === 'Active' ? styles.activeBadge : styles.inactiveBadge]}>
                <Text style={[styles.statusText, profile.status === 'Active' ? styles.activeStatusText : styles.inactiveStatusText]}>
                  {t(profile.status)}
                </Text>
              </View>
            ) : null}
          </View>

          {profile && !isLoading ? (
            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={() => void choosePhoto()}
                    style={[styles.secondaryButton, isSaving && styles.disabledButton]}>
                    <Text style={styles.secondaryButtonText}>
                      {t(selectedPhoto ? 'Change photo' : 'Update photo')}
                    </Text>
                  </Pressable>
                  <Text style={styles.photoHint}>{t('JPG, PNG or WebP · up to 5 MB')}</Text>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setIsEditing(true);
                    setMessage('');
                    setError('');
                  }}
                  style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{t('Edit profile')}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
          {message ? <Text style={styles.success}>{t(message)}</Text> : null}
          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#17664f" />
              <Text style={styles.loadingText}>{t('Loading account information...')}</Text>
            </View>
          ) : profile ? (
            <>
              <View style={styles.details}>
                {([
                  ['Full name', 'fullName', profile.fullName || 'Not provided'],
                  ['Email address', 'email', profile.email || 'Not provided'],
                  ['Phone number', 'phone', profile.phone || 'Not provided'],
                  ['Account type', 'role', profile.role],
                  ['Pharmacy', 'store', profile.storeName || 'Not assigned'],
                  ['Account status', 'status', profile.status],
                ] as const).map(([label, key, value]) => (
                  <View key={key} style={styles.detail}>
                    <Text style={styles.detailLabel}>{t(label)}</Text>
                    {isEditing && key === 'fullName' ? (
                      <TextInput
                        accessibilityLabel={t('Full name')}
                        autoComplete="name"
                        maxLength={120}
                        onChangeText={setFullNameDraft}
                        style={styles.input}
                        value={fullNameDraft}
                      />
                    ) : isEditing && key === 'phone' ? (
                      <TextInput
                        accessibilityLabel={t('Phone number')}
                        autoComplete="tel"
                        keyboardType="phone-pad"
                        maxLength={32}
                        onChangeText={setPhoneDraft}
                        style={styles.input}
                        value={phoneDraft}
                      />
                    ) : (
                      <Text style={styles.detailValue}>{t(value)}</Text>
                    )}
                  </View>
                ))}
              </View>
              {isEditing ? (
                <View style={styles.editActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={cancelEditing}
                    style={[styles.cancelButton, isSaving && styles.disabledButton]}>
                    <Text style={styles.cancelButtonText}>{t('Cancel')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving || !fullNameDraft.trim()}
                    onPress={() => void saveProfile()}
                    style={[styles.saveButton, (isSaving || !fullNameDraft.trim()) && styles.disabledButton]}>
                    {isSaving ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.saveButtonText}>{t(isSaving ? 'Saving...' : 'Save changes')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f8f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e4e9e5',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  cover: {
    height: 92,
    backgroundColor: '#dff1e6',
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: -36,
    marginBottom: 18,
  },
  avatar: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#fff',
    borderRadius: 20,
    backgroundColor: '#e5f5ed',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    color: '#187553',
    fontSize: 24,
    fontWeight: '800',
  },
  identityText: {
    flex: 1,
    minWidth: 150,
    paddingBottom: 4,
  },
  profileName: {
    color: '#203128',
    fontSize: 18,
    fontWeight: '800',
  },
  email: {
    marginTop: 4,
    color: '#718078',
    fontSize: 12,
  },
  statusBadge: {
    marginLeft: 'auto',
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  activeBadge: {
    backgroundColor: '#e8f6ee',
  },
  inactiveBadge: {
    backgroundColor: '#fff4e5',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  activeStatusText: {
    color: '#18794e',
  },
  inactiveStatusText: {
    color: '#946200',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 14,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#cddfd3',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#246548',
    fontSize: 12,
    fontWeight: '700',
  },
  photoHint: {
    color: '#89958e',
    fontSize: 11,
  },
  details: {
    gap: 10,
  },
  detail: {
    minWidth: 0,
    padding: 13,
    borderWidth: 1,
    borderColor: '#edf0ed',
    borderRadius: 10,
    backgroundColor: '#fbfcfb',
  },
  detailLabel: {
    marginBottom: 7,
    color: '#849189',
    fontSize: 11,
    fontWeight: '600',
  },
  detailValue: {
    color: '#26352f',
    fontSize: 13,
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
    fontSize: 14,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 9,
    marginTop: 16,
  },
  cancelButton: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#dce5df',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    color: '#52625a',
    fontSize: 12,
    fontWeight: '700',
  },
  saveButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#16845d',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.65,
  },
  error: {
    marginVertical: 8,
    color: '#ad4b43',
    fontSize: 13,
  },
  success: {
    marginVertical: 8,
    color: '#18794e',
    fontSize: 13,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  loadingText: {
    color: '#718078',
    fontSize: 13,
  },
});
