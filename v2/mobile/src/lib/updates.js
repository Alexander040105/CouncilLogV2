/** expo-updates helpers — check for a published OTA, download it silently,
 *  and restart into it on user request. Pure JS: ships via eas update
 *  itself, no native rebuild needed. Dev builds / Expo Go / offline all
 *  degrade to 'none' — the banner simply never appears.
 *
 *  Release notes come from updates.json on the web origin — the newest
 *  entry describes the update that just downloaded. level:'minor'
 *  suppresses the banner entirely: the update sits downloaded and the OS
 *  applies it on the next cold start. Unreachable/malformed file → the
 *  banner shows anyway without notes (fail-open: better a vague prompt
 *  than a hidden important update). */
import * as Updates from 'expo-updates';

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173';

async function fetchLatestRelease() {
  const r = await fetch(`${WEB_BASE}/updates.json`, { cache: 'no-store' });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  const entry = data?.updates?.[0];
  return entry && Array.isArray(entry.notes) ? entry : null;
}

/** {status:'ready', notes?, date?} when an update is downloaded and only
 *  needs a restart; {status:'none'} otherwise — including 'minor' releases,
 *  which apply silently on the next cold start, and every error path
 *  (next launch retries anyway). */
export async function checkForUpdate() {
  if (__DEV__ || !Updates.isEnabled) return { status: 'none' };
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return { status: 'none' };
    const f = await Updates.fetchUpdateAsync();   // download first — Restart is then instant
    if (!f.isNew) return { status: 'none' };
    const latest = await fetchLatestRelease().catch(() => null);
    if (latest?.level === 'minor') return { status: 'none' };
    return { status: 'ready', notes: latest?.notes ?? null, date: latest?.date ?? null };
  } catch { return { status: 'none' }; }
}

export async function restartToUpdate() {
  await Updates.reloadAsync();
}
