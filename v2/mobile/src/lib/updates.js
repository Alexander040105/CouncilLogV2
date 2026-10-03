/** expo-updates helpers — check for a published OTA, download it silently,
 *  and restart into it on user request. Pure JS: ships via eas update
 *  itself, no native rebuild needed. Dev builds / Expo Go / offline all
 *  degrade to 'none' — the banner simply never appears. */
import * as Updates from 'expo-updates';

/** 'ready' when an update is downloaded and only needs a restart,
 *  'none' otherwise (including errors — next launch retries anyway). */
export async function checkForUpdate() {
  if (__DEV__ || !Updates.isEnabled) return 'none';
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return 'none';
    const f = await Updates.fetchUpdateAsync();   // download first — Restart is then instant
    return f.isNew ? 'ready' : 'none';
  } catch { return 'none'; }
}

export async function restartToUpdate() {
  await Updates.reloadAsync();
}
