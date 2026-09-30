/** Port of web/pages/Account.jsx — profile, capabilities, security,
 *  appearance, danger zone. Lives outside tabs (reached via More). */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CircleAlert, LogOut, ShieldCheck, Trash2 } from 'lucide-react-native';
import { del, patch, post } from '../src/lib/api';
import { unregisterPushToken } from '../src/lib/push';
import { setCurrentOrg } from '../src/lib/org';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/lib/auth';
import { useToast } from '../src/lib/toast';
import { useTheme } from '../src/lib/theme';
import { useMe } from '../src/lib/me';
import { humanize } from '../src/lib/labels';
import { PhotoPicker, putToSignedUrl } from '../src/components/PhotoPicker';
import {
  Avatar, Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, Input,
  PageHeader, Screen, Skeleton, ThemePicker,
} from '../src/components/ui';

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

const labelOf = (t) => ({
  fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform,
  letterSpacing: t.labelTracking, color: t.ink2,
});

export default function Account() {
  const meQ = useMe();
  const me = meQ.data;
  const { session } = useAuth();
  const nav = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();

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
      await putToSignedUrl(sign.upload_url, f);
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

  const changePw = async () => {
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

  const changeEmail = async () => {
    setEmailErr(null);
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) setEmailErr(error.message);
      else { setEmailSent(true); toast.success('Confirmation email sent.'); }
    } finally { setEmailBusy(false); }
  };

  const signOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    setCurrentOrg(null);
    nav.replace('/login');
  };

  const deleteAccount = useMutation({
    mutationFn: async () => { await unregisterPushToken(); return del('/me'); },
    onSuccess: async () => {
      toast.success('Account deleted.');
      await supabase.auth.signOut();
      setCurrentOrg(null);
      nav.replace('/login');
    },
    onError: (e) => { setDelOpen(false); toast.error(e.message); },
  });

  if (meQ.isLoading) {
    return (
      <Screen>
        <PageHeader title="Account" description="Your name, photo, security, and what you can do." />
        {[0, 1, 2].map((i) => (
          <Card key={i} style={{ gap: 10 }}>
            <Skeleton style={{ height: 20, width: 128 }} />
            <Skeleton style={{ height: 16, width: 192 }} />
            <Skeleton style={{ height: 44, width: '100%' }} />
          </Card>
        ))}
      </Screen>
    );
  }
  if (meQ.isError) {
    return (
      <Screen>
        <PageHeader title="Account" description="Your name, photo, security, and what you can do." />
        <ErrorState error={meQ.error} retry={meQ.refetch} />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Account" description="Your name, photo, security, and what you can do." />

      {/* Identity */}
      <Card style={{ gap: 12 }}>
        <Text style={labelOf(t)}>Profile</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Avatar name={profile?.display_name ?? email} url={profile?.avatar_url} size={80} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: '600', color: t.ink }} numberOfLines={1}>
              {profile?.display_name ?? email}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {verified
                ? <><BadgeCheck size={13} color={t.done} /><Text style={{ fontSize: 12, color: t.ink3 }}>Email verified</Text></>
                : <><CircleAlert size={13} color={t.pending} /><Text style={{ fontSize: 12, color: t.ink3 }}>Email not verified</Text></>}
            </View>
            {me?.is_admin ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <ShieldCheck size={13} color={t.done} />
                <Text style={{ fontSize: 12, color: t.ink3 }}>
                  CounciLog admin — you can see and manage every org
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ opacity: uploading ? 0.5 : 1 }} pointerEvents={uploading ? 'none' : 'auto'}>
          <PhotoPicker photos={photos} onChange={onPhotos} max={1} />
          {uploading ? <Text style={{ marginTop: 4, fontSize: 12, color: t.ink3 }}>Uploading…</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Display name" hint="Shown to your orgmates on rosters and journal entries.">
              <Input value={displayName} onChangeText={setName} maxLength={80} />
            </Field>
          </View>
          <Button
            variant="secondary"
            onPress={() => saveName.mutate()}
            disabled={saveName.isPending || !displayName.trim() || displayName.trim() === profile?.display_name}
          >
            {saveName.isPending ? '…' : 'Save'}
          </Button>
        </View>
      </Card>

      {/* Capabilities */}
      <Card style={{ gap: 10 }}>
        <Text style={labelOf(t)}>What you can do</Text>
        {memberships.length === 0 ? (
          <Empty
            title="No organizations yet"
            hint="Create or join an org and your powers show up here."
          />
        ) : (
          memberships.map((m) => (
            <View key={m.org_id} style={{ borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{m.org_name}</Text>
                <Chip kind="extra" label={humanize(m.role)} />
              </View>
              <View style={{ paddingLeft: 12, gap: 2 }}>
                {(ROLE_CAPS[m.role] ?? ROLE_CAPS.member).map((c) => (
                  <Text key={c} style={{ fontSize: 14, color: t.ink2 }}>• {c}</Text>
                ))}
              </View>
            </View>
          ))
        )}
      </Card>

      {/* Security */}
      <Card style={{ gap: 12 }}>
        <Text style={labelOf(t)}>Security</Text>
        <Field label="New password" hint="At least 6 characters.">
          <Input secureTextEntry autoComplete="new-password" value={pw.next}
                 onChangeText={(v) => setPw({ ...pw, next: v })} />
        </Field>
        <Field label="Confirm password">
          <Input secureTextEntry autoComplete="new-password" value={pw.confirm}
                 onChangeText={(v) => setPw({ ...pw, confirm: v })} />
        </Field>
        {pwErr ? <Text style={{ fontSize: 14, color: t.alert }}>{pwErr}</Text> : null}
        <Button variant="secondary" onPress={changePw} disabled={pwBusy || !pw.next}>
          {pwBusy ? '…' : 'Change password'}
        </Button>
        <View style={{ borderTopWidth: 1, borderTopColor: t.line, marginTop: 4 }} />
        <Field label="Email" hint={`Current: ${email}`}>
          <Input autoCapitalize="none" keyboardType="email-address" placeholder="new@address.com" value={newEmail}
                 onChangeText={(v) => { setNewEmail(v); setEmailSent(false); setEmailErr(null); }} />
        </Field>
        {emailErr ? <Text style={{ fontSize: 14, color: t.alert }}>{emailErr}</Text> : null}
        {emailSent ? (
          <Text style={{ fontSize: 14, color: t.done }}>
            Confirmation sent to the new address — your email changes once you click it.
          </Text>
        ) : null}
        <Button variant="secondary" onPress={changeEmail} disabled={emailBusy || !newEmail}>
          {emailBusy ? '…' : 'Send confirmation'}
        </Button>
      </Card>

      {/* Preferences */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={labelOf(t)}>Appearance</Text>
          <Text style={{ fontSize: 12, color: t.ink3 }}>Neo-brutalist is default — your pick sticks to this device.</Text>
        </View>
        <ThemePicker />
      </Card>

      {/* Danger */}
      <Card style={{ gap: 10, borderColor: t.alert }}>
        <Text style={[labelOf(t), { color: t.alert }]}>Danger zone</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 14, color: t.ink2 }}>Sign out of CounciLog on this device.</Text>
          <Button variant="secondary" onPress={signOut}>
            <LogOut size={15} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Sign out</Text>
          </Button>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: t.line }} />
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 14, color: t.ink2 }}>
            Delete your account. Your name becomes “Former member” and org
            history stays, but you lose all access.
          </Text>
          <Button variant="danger" onPress={() => setDelOpen(true)}>
            <Trash2 size={15} color="#fff" /><Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Delete</Text>
          </Button>
        </View>
      </Card>

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
    </Screen>
  );
}
