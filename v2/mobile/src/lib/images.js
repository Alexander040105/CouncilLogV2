/** Downscale + re-encode an image before upload — camera photos arrive at
 *  3-8 MB and blow through the 5 MB sign cap; ~1600px JPEG lands ~150-400 KB.
 *  Anything that fails to manipulate passes through untouched so the existing
 *  validation reports the real error. `photo` is the normalized
 *  {uri, name, type, size} shape PhotoPicker/DocPicker produce. */
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

const MAX_DIM = 1600;
const QUALITY = 0.78;
const SKIP_BELOW = 400 * 1024; // already tiny — don't recompress

export async function compressImageUri(photo, { maxDim = MAX_DIM, quality = QUALITY } = {}) {
  if (!photo?.uri || !(photo.type ?? '').startsWith('image/')) return photo;
  if (photo.size && photo.size <= SKIP_BELOW) return photo;
  try {
    const actions = photo.width && photo.width > maxDim ? [{ resize: { width: maxDim } }] : [];
    const out = await ImageManipulator.manipulateAsync(
      photo.uri, actions,
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG });
    const info = await FileSystem.getInfoAsync(out.uri).catch(() => null);
    const size = info?.exists ? info.size ?? 0 : 0;
    if (size && photo.size && size >= photo.size) return photo; // keep original if it grew
    return {
      ...photo,
      uri: out.uri,
      name: (photo.name ?? 'photo').replace(/\.[^.]+$/, '') + '.jpg',
      type: 'image/jpeg',
      size,
    };
  } catch {
    return photo;
  }
}
