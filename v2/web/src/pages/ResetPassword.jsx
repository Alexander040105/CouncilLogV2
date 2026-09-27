import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Input, Skeleton } from '../components/ui';

export default function ResetPassword() {
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // 'checking' → 'ready' (recovery session live) | 'invalid' (no session)
  const [state, setState] = useState('checking');

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setState('ready');
    });
    // If the recovery exchange already completed before this page mounted,
    // there is a live session — treat it as ready.
    supabase.auth.getSession().then(({ data }) => {
      setState((s) => (s === 'checking' ? (data.session ? 'ready' : 'invalid') : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setErr('Passwords do not match'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setErr(error.message);
    else nav('/', { replace: true });
  };

  if (state === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4">
        <h1 className="heading-strong label-strong text-xl">Set a new password</h1>
        {state === 'invalid' ? (
          <>
            <p className="text-sm text-[var(--color-ink-3)]">
              This reset link is invalid or already used — request a fresh one.
            </p>
            <Link to="/login" className="block text-center text-sm text-[var(--color-accent)] underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="New password">
              <Input type="password" required minLength={6} autoFocus
                     value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Repeat it">
              <Input type="password" required minLength={6}
                     value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? '…' : 'Save password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
