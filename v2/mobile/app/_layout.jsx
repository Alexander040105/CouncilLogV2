/** Root layout — provider stack + session/org gate, mobile analog of
 *  web main.jsx + AppShell's redirect rules:
 *   - no session           → /login
 *   - session on /login    → /
 *   - zero memberships     → /onboarding (exempt: onboarding/account/admin)
 *   - selected org         → falls back to first membership (writes through) */
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { ThemeProvider, useTheme } from '../src/lib/theme';
import { ToastProvider } from '../src/lib/toast';
import { ErrorBoundary } from '../src/components/ui';
import { UpdateBanner } from '../src/components/UpdateBanner';
import { setAuthFailureHandler } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { currentOrgId, hydrateOrg, orgHydrated, orgPicked, setCurrentOrg, setOrgPicked } from '../src/lib/org';
import { useMe } from '../src/lib/me';
import { startConnectivity } from '../src/lib/connectivity';
import { hydrateQueryCache, persistQueryCache } from '../src/lib/qcache';
import { initNotificationDisplay, observeNotificationTaps, registerPushToken } from '../src/lib/push';
import * as ReactNative from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const qc = new QueryClient();

// API 401s → kill the session and bounce to /login (registered once).
setAuthFailureHandler(() => {
  supabase.auth.signOut();
  setCurrentOrg(null);
  setOrgPicked(false);
});

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const me = useMe();
  const { t } = useTheme();

  // Push: notification taps deep-link into tasks/papers/projects.
  useEffect(() => observeNotificationTaps(router), [router]);

  // Register this device once the session + org are known. Idempotent —
  // server upserts on the token value, and we skip the POST when unchanged.
  useEffect(() => {
    if (session && me.isSuccess) registerPushToken(currentOrgId());
  }, [session, me.isSuccess, me.data]);

  // Keep the selected org valid — same fallback rule as web's AppShell, but a
  // multi-org session without an explicit pick must not silently default.
  useEffect(() => {
    const memberships = me.data?.memberships ?? [];
    const active = memberships.find((m) => m.org_id === currentOrgId()) ?? memberships[0];
    if (active && active.org_id !== currentOrgId()
        && (memberships.length <= 1 || orgPicked())) {
      setCurrentOrg(active.org_id);
    }
  }, [me.data]);

  useEffect(() => {
    if (loading) return;
    const inLogin = segments[0] === 'login';
    if (!session && !inLogin) router.replace('/login');
    else if (session && inLogin) router.replace('/');
  }, [session, loading, segments, router]);

  useEffect(() => {
    if (!session || !me.isSuccess) return;
    const path = segments.join('/');
    const orglessOk = path.includes('onboarding') || path.includes('account') || path.includes('admin');
    if ((me.data?.memberships?.length ?? 0) === 0 && !orglessOk) router.replace('/onboarding');
  }, [session, me.isSuccess, me.data, segments, router]);

  // 2+ orgs and no explicit pick yet this login → the picker, not a default.
  useEffect(() => {
    if (!session || !me.isSuccess) return;
    const count = me.data?.memberships?.length ?? 0;
    const exempt = segments.join('/').includes('pick-org')
      || segments.join('/').includes('onboarding')
      || segments.join('/').includes('login');
    if (count > 1 && !orgPicked() && !exempt) router.replace('/pick-org');
  }, [session, me.isSuccess, me.data, segments, router]);

  return (
    <>
      <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} backgroundColor={t.surface} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.surface } }} />
      <UpdateBanner />
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateQueryCache(qc);        // cached lists readable offline before first mount
    persistQueryCache(qc);        // dehydrate-on-write (debounced) into SQLite
    startConnectivity();          // NetInfo → onlineManager + outbox replay
    initNotificationDisplay();    // handler + android channel
    hydrateOrg().finally(() => setReady(true));
  }, []);
  if (!ready || !orgHydrated()) {
    return <ReactNative.View style={{ flex: 1, backgroundColor: '#ffffff' }} />;
  }
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <SafeAreaProvider>
              <ErrorBoundary>
                <Gate />
              </ErrorBoundary>
            </SafeAreaProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
