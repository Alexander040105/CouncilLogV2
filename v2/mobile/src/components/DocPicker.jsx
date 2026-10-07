/** Pick a single receipt/resolution file — a photo from the camera/gallery or
 *  a PDF from the file system. Normalizes to {uri, name, type, size}, the same
 *  shape PhotoPicker uses, so `putToSignedUrl` works unchanged. */
import { Pressable, Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, FileUp } from 'lucide-react-native';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';

const MAX_BYTES = 5 * 1024 * 1024; // matches the API's FileSign limit
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf',
};

async function normalize({ uri, name, mimeType, size }) {
  const type = ACCEPT.includes(mimeType) ? mimeType : null;
  let byteSize = size ?? 0;
  if (!byteSize) {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (info?.exists) byteSize = info.size ?? 0;
  }
  return {
    uri,
    name: name ?? `file-${Date.now()}.${MIME_EXT[type] ?? 'bin'}`,
    type,
    size: byteSize,
  };
}

/** Compact "attach file" control — one Pressable, `onPick(file)` when the user
 *  chooses a document or snaps a photo. */
export function DocPicker({ onPick, label = 'Attach file', style }) {
  const toast = useToast();
  const { t } = useTheme();

  const check = async (asset) => {
    const f = await normalize(asset);
    if (!ACCEPT.includes(f.type)) { toast.error('Files must be a photo (JPG, PNG, WebP) or a PDF.'); return; }
    if (!f.size) { toast.error('That file looks empty — try again.'); return; }
    if (f.size > MAX_BYTES) { toast.error('File too large — 5 MB max.'); return; }
    onPick(f);
  };

  const doc = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ACCEPT, copyToCacheDirectory: true, multiple: false,
    });
    if (!res.canceled && res.assets?.length) await check(res.assets[0]);
  };

  const snap = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.error('Camera blocked — allow access in device settings, or pick a file instead.'); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled && res.assets?.length) {
      const a = res.assets[0];
      await check({ uri: a.uri, name: a.fileName, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize });
    }
  };

  const btn = {
    flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: t.radiusInput, borderWidth: t.dashWidth, borderColor: t.dashColor,
    borderStyle: 'dashed',
  };

  return (
    <>
      <Pressable accessibilityRole="button" onPress={doc} style={[btn, style]}>
        <FileUp size={14} color={t.ink3} />
        <Text style={{ fontSize: 12, color: t.ink3 }}>{label}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={snap} style={[btn, style]}>
        <Camera size={14} color={t.ink3} />
        <Text style={{ fontSize: 12, color: t.ink3 }}>Camera</Text>
      </Pressable>
    </>
  );
}
