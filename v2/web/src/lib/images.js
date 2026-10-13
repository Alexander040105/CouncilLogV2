/** Downscale + re-encode an image before upload — phone photos arrive at
 *  3-8 MB and blow through the 5 MB sign cap; ~1600px JPEG lands ~150-400 KB.
 *  Already-small files pass through untouched; anything that fails to decode
 *  also passes through so the existing validation reports the real error. */

const MAX_DIM = 1600;
const QUALITY = 0.78;
const SKIP_BELOW = 400 * 1024; // already tiny — don't recompress

export async function compressImageFile(file, { maxDim = MAX_DIM, quality = QUALITY } = {}) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.size <= SKIP_BELOW) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    // keep the original if re-encode somehow grew the file
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
