import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 'in' sign-in | 'up' sign-up | 'forgot' password reset
  const [mode, setMode] = useState('in');
  // 'check-email' after signup when email confirmation is required
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav('/', { replace: true });
  }, [session, nav]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/reset-password`,
        });
        if (error) setErr(error.message);
        else setNotice('Check your email — we sent a password reset link.');
      } else {
        const { data, error } = mode === 'in'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
        if (error) setErr(error.message);
        else if (mode === 'up' && !data.session) {
          // Supabase email confirmation is on — there is no session yet.
          setNotice('Account created — check your email to confirm it, then sign in.');
          setMode('in');
          setPassword('');
        } else nav('/');
      }
    } catch (ex) {
      setErr(ex.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const google = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4">
        <h1 className="heading-strong label-strong text-xl">CounciLog</h1>
        <p className="text-sm text-[var(--color-ink-3)]">
          Council ops: duty, journal, papers — logged with proof.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode !== 'forgot' && (
            <Field label="Password">
              <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {notice && <p className="text-sm text-[var(--color-status-done)]">{notice}</p>}
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? '…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        {mode !== 'forgot' && (
          <Button variant="secondary" className="w-full" onClick={google}>
            Continue with Google
          </Button>
        )}
        <div className="space-y-1">
          {mode === 'in' && (
            <button
              className="w-full text-center text-sm text-[var(--color-ink-3)]"
              onClick={() => { setMode('forgot'); setErr(null); setNotice(null); }}
            >
              Forgot password?
            </button>
          )}
          <button
            className="w-full text-center text-sm text-[var(--color-ink-3)]"
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null); setNotice(null); }}
          >
            {mode === 'forgot' ? 'Back to sign in' : mode === 'in' ? 'No account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
      </Card>
    </div>
  );
}
