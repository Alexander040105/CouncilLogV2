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
  const [mode, setMode] = useState('in');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav('/', { replace: true });
  }, [session, nav]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { error } = mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) setErr(error.message);
      else nav('/');
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
        <h1 className="text-xl font-bold">CounciLog</h1>
        <p className="text-sm text-[var(--color-ink-3)]">
          Council ops: duty, journal, papers — logged with proof.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? '…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <Button variant="secondary" className="w-full" onClick={google}>
          Continue with Google
        </Button>
        <button
          className="w-full text-center text-sm text-[var(--color-ink-3)]"
          onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
        >
          {mode === 'in' ? 'No account? Sign up' : 'Have an account? Sign in'}
        </button>
      </Card>
    </div>
  );
}
