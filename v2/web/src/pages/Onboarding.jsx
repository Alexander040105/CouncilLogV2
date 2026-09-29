import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { get, post, patch } from '../lib/api';
import { currentOrgId, setCurrentOrg } from '../lib/org';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Field, Input } from '../components/ui';

export default function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState('choose');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const toast = useToast();

  // /onboarding is also reachable from the org switcher, so members may land
  // here with somewhere to go back to — org-less users get no escape link.
  const me = useQuery({ queryKey: ['me'], queryFn: () => get('/me'), enabled: !!session });
  const memberships = me.data?.memberships ?? [];
  const backTo = memberships.find((m) => m.org_id === currentOrgId()) ?? memberships[0];

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sy, setSy] = useState('');
  const [myName, setMyName] = useState('');

  const saveName = async () => {
    // best-effort — a bad name shouldn't mask a successful create/join
    if (myName.trim()) { try { await patch('/me', { display_name: myName.trim() }); } catch { /* ignored */ } }
  };

  // Philippine school years run mid-year to mid-year — e.g. SY 2026–2027
  const now = new Date();
  const base = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  const SY_OPTIONS = [...Array(7)].map((_, i) => {
    const y = base - 1 + i;
    return `SY ${y}–${y + 1}`;
  });
  const [syCustom, setSyCustom] = useState(false);
  const [code, setCode] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [message, setMessage] = useState('');

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post('/orgs', { name, slug, school_year_label: sy });
      await saveName();
      setCurrentOrg(r.id);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const redeem = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/invites/${code}/redeem`);
      await saveName();
      setCurrentOrg(r.org_id);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // /onboarding sits outside AppShell — sign out must route to /login itself
  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentOrg(null);
    nav('/login');
  };

  const requestJoin = async () => {
    setBusy(true); setErr(null);
    try {
      // join-requests need the org's uuid — slug lookup happens server-side later;
      // for MVP the user pastes the org id or gets it from an admin.
      await post(`/orgs/${orgSlug}/join-requests`, { message });
      await saveName();
      setMode('choose');
      setCode(''); setOrgSlug(''); setMessage('');
      toast.success('Request sent — an admin will approve it.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-4">
        {mode === 'choose' ? (
          <h1 className="heading-strong label-strong text-xl">Get started</h1>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="px-3"
              onClick={() => { setMode('choose'); setErr(null); }}
            >
              <ArrowLeft size={16} aria-hidden /> Back
            </Button>
            <h1 className="heading-strong label-strong text-xl">
              {mode === 'create' ? 'Start your organization' : 'Join an organization'}
            </h1>
          </div>
        )}
        {mode === 'choose' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button onClick={() => setMode('create')}>Start your organization</Button>
              <Button variant="secondary" onClick={() => setMode('join')}>Join with code</Button>
            </div>
            {backTo && (
              <button
                className="w-full text-center text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]"
                onClick={() => nav('/')}
              >
                Back to {backTo.org_name}
              </button>
            )}
          </>
        )}
        {mode === 'create' && (
          <div className="space-y-3">
            <Field label="Your name" hint="Optional — how orgmates will see you.">
              <Input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={80} placeholder="e.g. Alex Solis" />
            </Field>
            <Field label="Organization name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CCS Council" /></Field>
            <Field label="Slug" hint="lowercase, used in links"><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ccs-council" /></Field>
            <Field label="School year" hint="Pick the year this org starts with — you can add more in Settings later.">
              {syCustom ? (
                <Input value={sy} onChange={(e) => setSy(e.target.value)} placeholder="e.g. AY 2026–2027" autoFocus />
              ) : (
                <select
                  className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                  value={sy}
                  onChange={(e) => {
                    if (e.target.value === '__custom') { setSyCustom(true); setSy(''); }
                    else setSy(e.target.value);
                  }}
                >
                  <option value="">Choose a school year…</option>
                  {SY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value="__custom">Custom…</option>
                </select>
              )}
            </Field>
            <Button onClick={create} disabled={busy || !name || !slug || !sy}>{busy ? '…' : 'Create org'}</Button>
          </div>
        )}
        {mode === 'join' && (
          <div className="space-y-3">
            <Field label="Your name" hint="Optional — how orgmates will see you.">
              <Input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={80} placeholder="e.g. Alex Solis" />
            </Field>
            <Field label="Invite code" hint="Paste the code an admin gave you — instant join">
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Button onClick={redeem} disabled={busy || !code}>{busy ? '…' : 'Join org'}</Button>
            <hr className="border-[var(--color-line)]" />
            <Field label="Or request to join — Organization ID"
                   hint="Ask the org's admin — they can copy it from Settings.">
              <Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} />
            </Field>
            <Field label="Message (optional)"><Input value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            <Button variant="secondary" onClick={requestJoin} disabled={busy || !orgSlug}>Request to join</Button>
          </div>
        )}
        {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
        {/* escape hatch — org-less users have no other way out of this page */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-3)]">
          <span className="truncate">Signed in as {session?.user?.email}</span>
          <button className="label-strong min-h-[36px] shrink-0 px-2 hover:text-[var(--color-ink)]" onClick={signOut}>
            Sign out
          </button>
        </div>
      </Card>
    </div>
  );
}
