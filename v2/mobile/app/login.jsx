/** Port of web/pages/Login.jsx — same modes (in/up/forgot) + Google OAuth.
 *  Native OAuth uses skipBrowserRedirect + openAuthSessionAsync + setSession.
 *  In Expo Go the redirect is exp://<host> (needs an exp://** entry in Supabase
 *  redirect URLs); in a dev build it's councilog:// — see mobile/README.md. */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../src/lib/supabase';
import { Button, Card, Field, Input } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { useTheme } from '../src/lib/theme';
import Constants from 'expo-constants';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173';

export default function Login() {
  const { session } = useAuth();
  const router = useRouter();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 'in' sign-in | 'up' sign-up | 'forgot' password reset
  const [mode, setMode] = useState('in');
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      if (mode === 'forgot') {
        // Reset emails must land on a browser — point them at the web app.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${WEB_URL}/reset-password`,
        });
        if (error) setErr(error.message);
        else setNotice('Check your email — we sent a password reset link.');
      } else {
        const { data, error } = mode === 'in'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
        if (error) setErr(error.message);
        else if (mode === 'up' && !data.session) {
          setNotice('Account created — check your email to confirm it, then sign in.');
          setMode('in');
          setPassword('');
        } else router.replace('/');
      }
    } catch (ex) {
      setErr(ex.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setErr(null);
    try {
      // exp:// in Expo Go, councilog:// in a dev build / installed app.
      const redirectTo = AuthSession.makeRedirectUri();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) { setErr(error.message); return; }
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success' || !res.url) return; // user cancelled
      const url = new URL(res.url.replace('#', '?'));
      const code = url.searchParams.get('code');
      const access = url.searchParams.get('access_token');
      const refresh = url.searchParams.get('refresh_token');
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) setErr(exErr.message);
      } else if (access && refresh) {
        const { error: sErr } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
        if (sErr) setErr(sErr.message);
      } else {
        setErr('Sign-in came back without a session — check the redirect URL allowlist in Supabase.');
      }
    } catch (ex) {
      setErr(ex.message || 'Google sign-in failed');
    }
  };

  const isExpoGo = Constants.appOwnership === 'expo';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.surface }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16, paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Card style={{ width: '100%', maxWidth: 380, gap: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: t.headingWeight, color: t.ink, textTransform: 'uppercase', letterSpacing: 0.8 }}>CounciLog</Text>
          <Text style={{ fontSize: 14, color: t.ink3 }}>
            Council ops: duty, journal, papers — logged with proof.
          </Text>
          <View style={{ gap: 12 }}>
            <Field label="Email">
              <Input keyboardType="email-address" autoCapitalize="none" autoComplete="email"
                     value={email} onChangeText={setEmail} />
            </Field>
            {mode !== 'forgot' && (
              <Field label="Password">
                <Input secureTextEntry value={password} onChangeText={setPassword} autoComplete="password" />
              </Field>
            )}
            {notice ? <Text style={{ fontSize: 13, color: t.done }}>{notice}</Text> : null}
            {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
            <Button onPress={submit} disabled={busy || !email || (mode !== 'forgot' && password.length < 6)} busy={busy} style={{ width: '100%' }}>
              {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
            </Button>
          </View>
          {mode !== 'forgot' && (
            <View style={{ gap: 6 }}>
              <Button variant="secondary" style={{ width: '100%' }} onPress={google}>
                Continue with Google
              </Button>
              {isExpoGo && (
                <Text style={{ fontSize: 11, color: t.ink3 }}>
                  Google sign-in needs an exp:// redirect allowlisted in Supabase — email sign-in is the reliable option in Expo Go.
                </Text>
              )}
            </View>
          )}
          <View style={{ gap: 4 }}>
            {mode === 'in' && (
              <Pressable accessibilityRole="button" style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
                         onPress={() => { setMode('forgot'); setErr(null); setNotice(null); }}>
                <Text style={{ fontSize: 14, color: t.ink3 }}>Forgot password?</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
                       onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null); setNotice(null); }}>
              <Text style={{ fontSize: 14, color: t.ink3 }}>
                {mode === 'forgot' ? 'Back to sign in' : mode === 'in' ? 'No account? Sign up' : 'Have an account? Sign in'}
              </Text>
            </Pressable>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
