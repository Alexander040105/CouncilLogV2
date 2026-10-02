/** Push notifications: token lifecycle + tap-through.
 *  Server keeps tokens per user (push_tokens); we POST on login/org-ready and
 *  DELETE on sign-out (the DELETE queues offline like any other write, so the
 *  server catches up when connectivity returns).
 *  NOTE: remote push doesn't work in Expo Go on Android (SDK 53+) — needs a
 *  development build; everything here is a quiet no-op off-device. */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';
import { currentOrgId } from './org';

const TOKEN_KEY = 'expo-push-token';

/* ── display + channel setup (call once, app start) ─────────────── */
export function initNotificationDisplay() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  }
}

/* ── token lifecycle ────────────────────────────────────────────── */
export async function registerPushToken(orgId) {
  if (!orgId || Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return; // user said no — inbox still works
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const prev = await AsyncStorage.getItem(TOKEN_KEY);
    if (prev === token) return; // same device token already on the server
    await api(`/orgs/${orgId}/push-tokens`, {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      org: orgId,
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch { /* push is best-effort — never block the UI on it */ }
}

/** Call BEFORE supabase.auth.signOut() — the DELETE needs a live session.
 *  Offline it lands in the outbox and replays later. */
export async function unregisterPushToken() {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  // org context for the call comes from the token owner's current org — the
  // route authorizes by user anyway; any org they belong to validates.
  const org = currentOrgId();
  if (!org) return;
  api(`/orgs/${org}/push-tokens`, {
    method: 'DELETE', body: { token }, org,
  }).catch(() => {});
}

/* ── tap-through: push data → app route ─────────────────────────── */
export function routeForPushData(data) {
  if (!data || typeof data !== 'object') return null;
  const { entity_type, entity_id } = data;
  switch (entity_type) {
    case 'document': return entity_id ? `/document/${entity_id}` : '/documents';
    case 'project': return entity_id ? `/project/${entity_id}` : '/projects';
    case 'task': return '/tasks';
    case 'journal': return '/journal';
    default: return null;
  }
}

/** Expo Router pattern: cold-start via getLastNotificationResponseAsync,
 *  foreground taps via the response listener. */
export function observeNotificationTaps(router) {
  Notifications.getLastNotificationResponseAsync().then((res) => {
    const route = res ? routeForPushData(res.notification.request.content.data) : null;
    if (route) router.push(route);
  }).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const route = routeForPushData(res.notification.request.content.data);
    if (route) router.push(route);
  });
  return () => sub.remove();
}
