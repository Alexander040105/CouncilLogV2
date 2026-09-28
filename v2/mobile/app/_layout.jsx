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
import { setAuthFailureHandler } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { currentOrgId, hydrateOrg, orgHydrated, setCurrentOrg } from '../src/lib/org';
import { useMe } from '../src/lib/me';
import * as ReactNative from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const qc = new QueryClient();

// API 401s → kill the session and bounce to /login (registered once).
setAuthFailureHandler(() => {
  supabase.auth.signOut();
  setCurrentOrg(null);
});

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const me = useMe();
  const { t } = useTheme();

  // Keep the selected org valid — same fallback rule as web's AppShell.
  const memberships = me.data?.memberships ?? [];
  useEffect(() => {
    const active = memberships.find((m) => m.org_id === currentOrgId()) ?? memberships[0];
    if (active && active.org_id !== currentOrgId()) setCurrentOrg(active.org_id);
  }, [memberships]);

  useEffect(() => {
    if (loading) return;
    const inLogin = segments[0] === 'login';
    if (!session && !inLogin) router.replace('/login');
    else if (session && inLogin) router.replace('/');
  }, [session, loading, segments]);

  useEffect(() => {
    if (!session || !me.isSuccess) return;
    const path = segments.join('/');
    const orglessOk = path.includes('onboarding') || path.includes('account') || path.includes('admin');
    if (memberships.length === 0 && !orglessOk) router.replace('/onboarding');
  }, [session, me.isSuccess, memberships.length, segments]);

  return (
    <>
      <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} backgroundColor={t.surface} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.surface } }} />
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { hydrateOrg().finally(() => setReady(true)); }, []);
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
