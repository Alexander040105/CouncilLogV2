import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { setCurrentOrg } from '../lib/org';
import { Button, Card, Field, Input } from '../components/ui';

export default function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState('choose');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sy, setSy] = useState('');

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
      setCurrentOrg(r.id);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const redeem = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/invites/${code}/redeem`);
      setCurrentOrg(r.org_id);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const requestJoin = async () => {
    setBusy(true); setErr(null);
    try {
      // join-requests need the org's uuid — slug lookup happens server-side later;
      // for MVP the user pastes the org id or gets it from an admin.
      await post(`/orgs/${orgSlug}/join-requests`, { message });
      setMode('choose');
      setErr('Request sent — an admin will approve it.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-bold">Get started</h1>
        {mode === 'choose' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={() => setMode('create')}>Start your organization</Button>
            <Button variant="secondary" onClick={() => setMode('join')}>Join with code</Button>
          </div>
        )}
        {mode === 'create' && (
          <div className="space-y-3">
            <Field label="Organization name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CCS Council" /></Field>
            <Field label="Slug" hint="lowercase, used in links"><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ccs-council" /></Field>
            <Field label="School year" hint="Pick the year this org starts with — you can add more in Settings later.">
              {syCustom ? (
                <Input value={sy} onChange={(e) => setSy(e.target.value)} placeholder="e.g. AY 2026–2027" autoFocus />
              ) : (
                <select
                  className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
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
        {mode !== 'choose' && (
          <button className="text-sm text-[var(--color-ink-3)]" onClick={() => { setMode('choose'); setErr(null); }}>← back</button>
        )}
      </Card>
    </div>
  );
}
