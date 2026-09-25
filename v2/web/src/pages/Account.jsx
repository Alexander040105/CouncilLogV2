import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CircleAlert, LogOut, Trash2 } from 'lucide-react';
import { del, patch, post } from '../lib/api';
import { setCurrentOrg } from '../lib/org';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PhotoPicker } from '../components/PhotoPicker';
import {
  Avatar, Button, Card, Chip, ConfirmDialog, Empty, Field, Input,
  PageHeader, Skeleton, ThemePicker,
} from '../components/ui';

// plain-language capability bullets — mirrors ROLES.md; each level stacks
// on the previous one
const ROLE_CAPS = {
  member: [
    'File journal entries for duty days',
    'Declare no-tasks days',
    'View shared org surfaces',
  ],
  officer: [
    'Everything a member can do',
    'Register papers and log where they are',
    'Sign or skip signatory steps',
    'Tick off project checklist items',
  ],
  adviser: [
    'Everything an officer can do',
    'Create and edit projects',
    'Generate project checklists',
    'View the org audit log',
  ],
  owner: [
    'Everything an adviser can do',
    'Manage members, invites, and roles',
    'Set positions, duty roster, and templates',
    'Edit org settings and contacts',
  ],
};

export default function Account() {
  const { me } = useOutletContext();
  const { session } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const profile = me?.profile;
  const memberships = me?.memberships ?? [];
  const email = me?.email ?? session?.user?.email ?? '';
  const verified = !!session?.user?.email_confirmed_at;

  // identity
  const [name, setName] = useState(null);
  const displayName = name ?? profile?.display_name ?? '';
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);

  // security
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [pwErr, setPwErr] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailErr, setEmailErr] = useState(null);

  // danger
  const [delOpen, setDelOpen] = useState(false);

  const refreshMe = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    await qc.invalidateQueries({ queryKey: ['members'] });
  };

  const saveName = useMutation({
    mutationFn: () => patch('/me', { display_name: displayName }),
    onSuccess: async () => { toast.success('Name saved.'); await refreshMe(); },
    onError: (e) => toast.error(e.message),
  });

  const onPhotos = async (files) => {
    setPhotos(files);
    if (files.length === 0) {
      if (profile?.avatar_url) {
        try {
          await patch('/me', { avatar_url: null });
          await refreshMe();
          toast.success('Photo removed.');
        } catch (e) { toast.error(e.message); }
      }
      return;
    }
    const f = files[0];
    setUploading(true);
    try {
      const sign = await post('/me/avatar/sign', { mime: f.type, byte_size: f.size });
      const res = await fetch(sign.upload_url, {
        method: 'PUT',
        headers: { 'content-type': f.type },
        body: f,
      });
      if (!res.ok) throw new Error('Upload failed — try again.');
      await patch('/me', { avatar_url: sign.public_url });
      await refreshMe();
      setPhotos([]);
      toast.success('Photo updated.');
    } catch (e) {
      setPhotos([]);
      toast.error(e.message || 'Upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    setPwErr(null);
    if (pw.next.length < 6) { setPwErr('At least 6 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwErr("Passwords don't match."); return; }
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) setPwErr(error.message);
      else { setPw({ next: '', confirm: '' }); toast.success('Password updated.'); }
    } finally { setPwBusy(false); }
  };

  const changeEmail = async (e) => {
    e.preventDefault();
    setEmailErr(null);
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) setEmailErr(error.message);
      else { setEmailSent(true); toast.success('Confirmation email sent.'); }
    } finally { setEmailBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentOrg(null);
    nav('/login');
  };

  const deleteAccount = useMutation({
    mutationFn: () => del('/me'),
    onSuccess: async () => {
      toast.success('Account deleted.');
      await supabase.auth.signOut();
      setCurrentOrg(null);
      nav('/login');
    },
    onError: (e) => { setDelOpen(false); toast.error(e.message); },
  });

  if (me === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title="Account" description="Your name, photo, security, and what you can do." />
        {[0, 1, 2].map((i) => (
          <Card key={i} className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-11 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Account" description="Your name, photo, security, and what you can do." />

      {/* Identity */}
      <Card className="space-y-4">
        <h2 className="label-strong">Profile</h2>
        <div className="flex items-center gap-4">
          <Avatar
            name={profile?.display_name ?? email}
            url={profile?.avatar_url}
            size="h-20 w-20"
            textSize="text-lg"
          />
          <div className="min-w-0">
            <div className="truncate font-medium">{profile?.display_name ?? email}</div>
            <div className="flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
              {verified
                ? <><BadgeCheck size={13} aria-hidden className="text-[var(--color-status-done)]" /> Email verified</>
                : <><CircleAlert size={13} aria-hidden className="text-[var(--color-status-pending)]" /> Email not verified</>}
            </div>
          </div>
        </div>
        <div className={uploading ? 'pointer-events-none opacity-50' : ''}>
          <PhotoPicker photos={photos} onChange={onPhotos} max={1} />
          {uploading && <p className="mt-1 text-xs text-[var(--color-ink-3)]">Uploading…</p>}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); saveName.mutate(); }}
        >
          <Field label="Display name" hint="Shown to your orgmates on rosters and journal entries.">
            <Input value={displayName} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={saveName.isPending || !displayName.trim() || displayName.trim() === profile?.display_name}
          >
            {saveName.isPending ? '…' : 'Save'}
          </Button>
        </form>
      </Card>

      {/* Capabilities */}
      <Card className="space-y-3">
        <h2 className="label-strong">What you can do</h2>
        {memberships.length === 0 ? (
          <Empty
            title="No organizations yet"
            hint="Create or join an org and your powers show up here."
          />
        ) : (
          memberships.map((m) => (
            <div key={m.org_id} className="rounded-[var(--radius-card)] [border:var(--border-box)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{m.org_name}</span>
                <Chip kind="extra" label={m.role} />
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-2)]">
                {(ROLE_CAPS[m.role] ?? ROLE_CAPS.member).map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          ))
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Security */}
        <Card className="space-y-4">
          <h2 className="label-strong">Security</h2>
          <form onSubmit={changePw} className="space-y-3">
            <Field label="New password" hint="At least 6 characters.">
              <Input type="password" autoComplete="new-password" value={pw.next}
                     onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm password">
              <Input type="password" autoComplete="new-password" value={pw.confirm}
                     onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            {pwErr && <p className="text-sm text-[var(--color-status-alert)]">{pwErr}</p>}
            <Button type="submit" variant="secondary" disabled={pwBusy || !pw.next}>
              {pwBusy ? '…' : 'Change password'}
            </Button>
          </form>
          <hr className="border-[var(--color-line)]" />
          <form onSubmit={changeEmail} className="space-y-3">
            <Field label="Email" hint={`Current: ${email}`}>
              <Input type="email" placeholder="new@address.com" value={newEmail}
                     onChange={(e) => { setNewEmail(e.target.value); setEmailSent(false); setEmailErr(null); }} />
            </Field>
            {emailErr && <p className="text-sm text-[var(--color-status-alert)]">{emailErr}</p>}
            {emailSent && (
              <p className="text-sm text-[var(--color-status-done)]">
                Confirmation sent to the new address — your email changes once you click it.
              </p>
            )}
            <Button type="submit" variant="secondary" disabled={emailBusy || !newEmail}>
              {emailBusy ? '…' : 'Send confirmation'}
            </Button>
          </form>
        </Card>

        {/* Preferences + danger */}
        <div className="space-y-4">
          <Card className="flex items-center justify-between gap-3">
            <div>
              <h2 className="label-strong">Appearance</h2>
              <p className="text-xs text-[var(--color-ink-3)]">Neo-brutalist is default — your pick sticks to this browser.</p>
            </div>
            <ThemePicker />
          </Card>

          <Card className="space-y-3 border-[var(--color-status-alert)]/40">
            <h2 className="label-strong text-[var(--color-status-alert)]">Danger zone</h2>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-ink-2)]">Sign out of CounciLog on this device.</p>
              <Button variant="secondary" onClick={signOut}>
                <LogOut size={15} aria-hidden /> Sign out
              </Button>
            </div>
            <hr className="border-[var(--color-line)]" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-ink-2)]">
                Delete your account. Your name becomes “Former member” and org
                history stays, but you lose all access.
              </p>
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 size={15} aria-hidden /> Delete
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => deleteAccount.mutate()}
        title="Delete your account?"
        body="This can't be undone. Your org memberships are removed, your name is anonymized, and your sign-in is disabled. Historical journal entries and records are kept."
        confirmLabel="Delete my account"
        requireText={email}
        busy={deleteAccount.isPending}
      />
    </div>
  );
}
