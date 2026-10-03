/** Mobile port of PhotoPicker — same `photos`/`onChange`/`max` contract.
 *  Photos are normalized to {uri, name, type, size} so the upload helper can
 *  build the PUT body for the signed URL the API hands back. */
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, ImageUp, X } from 'lucide-react-native';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';

const MAX_BYTES = 5 * 1024 * 1024; // matches journal bucket + PhotoSign limit
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function normalize(asset) {
  const type = asset.mimeType && ACCEPT.includes(asset.mimeType) ? asset.mimeType : 'image/jpeg';
  const ext = MIME_EXT[type];
  // fileSize can be null (some galleries/cameras) — the sign endpoint
  // requires byte_size > 0, so fall back to the filesystem.
  let size = asset.fileSize ?? 0;
  if (!size) {
    const info = await FileSystem.getInfoAsync(asset.uri).catch(() => null);
    if (info?.exists) size = info.size ?? 0;
  }
  return {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.${ext}`,
    type,
    size,
  };
}

export function PhotoPicker({ photos, onChange, max = 4 }) {
  const toast = useToast();
  const { t } = useTheme();
  const full = photos.length >= max;

  const add = async (assets) => {
    const ok = [];
    for (const a of assets) {
      const p = await normalize(a);
      if (!ACCEPT.includes(p.type)) { toast.error('Photos must be JPG, PNG, or WebP.'); continue; }
      if (!p.size) { toast.error('That photo looks empty — try taking or picking it again.'); continue; }
      if (p.size > MAX_BYTES) { toast.error('Photo too large — 5 MB max.'); continue; }
      ok.push(p);
    }
    if (ok.length) {
      onChange([...photos, ...ok].slice(0, max));
      toast.success(`Photo added — ${Math.min(photos.length + ok.length, max)} of ${max}.`);
    }
  };

  const snap = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.error('Camera blocked — allow access in device settings, or use Upload.'); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled) add(res.assets);
  };

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.error('Photo library blocked — allow access in device settings.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: max > 1, selectionLimit: max - photos.length,
    });
    if (!res.canceled) add(res.assets);
  };

  const dash = {
    minHeight: 56, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    flexDirection: 'row', borderRadius: t.radiusCard, borderWidth: t.dashWidth,
    borderColor: t.dashColor, borderStyle: 'dashed',
  };

  return (
    <View style={{ gap: 8 }}>
      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`}>
              <Image source={{ uri: p.uri }} accessibilityLabel={`selected photo ${i + 1}`}
                     style={{ width: 80, height: 80, borderRadius: t.radiusInput }}
                     contentFit="cover" recyclingKey={p.uri} transition={60} />
              <Pressable
                accessibilityLabel={`Remove photo ${i + 1}`} accessibilityRole="button"
                style={{
                  position: 'absolute', top: -4, right: -4, minHeight: 28, minWidth: 28,
                  borderRadius: 999, backgroundColor: t.surface3, alignItems: 'center', justifyContent: 'center',
                  borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
                }}
                onPress={() => onChange(photos.filter((_, k) => k !== i))}
              >
                <X size={14} color={t.ink2} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {!full && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="button" style={dash} onPress={snap}>
            <Camera size={18} color={t.ink3} />
            <Text style={{ fontSize: 13, color: t.ink3 }}>Take photo</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={dash} onPress={pick}>
            <ImageUp size={18} color={t.ink3} />
            <Text style={{ fontSize: 13, color: t.ink3 }}>Upload</Text>
          </Pressable>
        </View>
      )}
      {full && <Text style={{ fontSize: 12, color: t.ink3 }}>{max} photos max — remove one to add another.</Text>}
    </View>
  );
}

/** Upload a picked photo to a signed URL the API hands back. Streams the file
 *  natively — fetch(uri).blob() is slow on RN (base64 round-trip) and the
 *  PUT body it produces gets 400s from Supabase Storage. */
export async function putToSignedUrl(signedUrl, photo) {
  const res = await FileSystem.uploadAsync(signedUrl, photo.uri, {
    httpMethod: 'PUT',
    headers: { 'content-type': photo.type },
  });
  if (res.status >= 300) throw new Error(`Upload failed (${res.status})`);
}
