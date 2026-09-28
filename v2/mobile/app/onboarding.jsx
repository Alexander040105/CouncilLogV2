/** Port of web/pages/Onboarding.jsx — create org / join with code / request to
 *  join, with the signed-in footer escape (org-less users have nowhere else). */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { get, post, patch } from '../src/lib/api';
import { currentOrgId, setCurrentOrg } from '../src/lib/org';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/lib/auth';
import { useToast } from '../src/lib/toast';
import { useTheme } from '../src/lib/theme';
import { Button, Card, Field, Input, Select } from '../src/components/ui';
import { useMe } from '../src/lib/me';

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState('choose');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const toast = useToast();
  const { t } = useTheme();

  const me = useMe();
  const memberships = me.data?.memberships ?? [];
  const backTo = memberships.find((m) => m.org_id === currentOrgId()) ?? memberships[0];

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sy, setSy] = useState('');
  const [myName, setMyName] = useState('');

  const saveName = async () => {
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
      router.replace('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const redeem = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/invites/${code}/redeem`);
      await saveName();
      setCurrentOrg(r.org_id);
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // /onboarding sits outside the tab shell — sign out routes to /login itself
  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentOrg(null);
    router.replace('/login');
  };

  const requestJoin = async () => {
    setBusy(true); setErr(null);
    try {
      await post(`/orgs/${orgSlug}/join-requests`, { message });
      await saveName();
      setMode('choose');
      setCode(''); setOrgSlug(''); setMessage('');
      toast.success('Request sent — an admin will approve it.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.surface }}
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={{ width: '100%', maxWidth: 430, gap: 16 }}>
        {mode === 'choose' ? (
          <Text style={{ fontSize: 20, fontWeight: t.headingWeight, color: t.ink, textTransform: 'uppercase', letterSpacing: 0.8 }}>Get started</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Button variant="ghost" style={{ paddingHorizontal: 12 }}
                    onPress={() => { setMode('choose'); setErr(null); }}>
              <ArrowLeft size={16} color={t.ink2} />
              <Text style={{ fontSize: 13, color: t.ink2 }}> Back</Text>
            </Button>
            <Text style={{ fontSize: 20, fontWeight: t.headingWeight, color: t.ink, flex: 1 }}>
              {mode === 'create' ? 'Start your organization' : 'Join an organization'}
            </Text>
          </View>
        )}
        {mode === 'choose' && (
          <View style={{ gap: 12 }}>
            <Button onPress={() => setMode('create')}>Start your organization</Button>
            <Button variant="secondary" onPress={() => setMode('join')}>Join with code</Button>
            {backTo ? (
              <Pressable accessibilityRole="button" style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
                         onPress={() => router.replace('/')}>
                <Text style={{ fontSize: 14, color: t.ink3 }}>Back to {backTo.org_name}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {mode === 'create' && (
          <View style={{ gap: 12 }}>
            <Field label="Your name" hint="Optional — how orgmates will see you.">
              <Input value={myName} onChangeText={setMyName} maxLength={80} placeholder="e.g. Alex Solis" />
            </Field>
            <Field label="Organization name"><Input value={name} onChangeText={setName} placeholder="CCS Council" /></Field>
            <Field label="Slug" hint="lowercase, used in links"><Input value={slug} onChangeText={setSlug} placeholder="ccs-council" autoCapitalize="none" /></Field>
            <Field label="School year" hint="Pick the year this org starts with — you can add more in Settings later.">
              {syCustom ? (
                <Input value={sy} onChangeText={setSy} placeholder="e.g. AY 2026–2027" autoFocus />
              ) : (
                <Select
                  value={sy}
                  onChange={(v) => { if (v === '__custom') { setSyCustom(true); setSy(''); } else setSy(v); }}
                  placeholder="Choose a school year…"
                  accessibilityLabel="School year"
                  options={[...SY_OPTIONS.map((o) => ({ value: o, label: o })), { value: '__custom', label: 'Custom…' }]}
                />
              )}
            </Field>
            <Button onPress={create} disabled={busy || !name || !slug || !sy} busy={busy}>Create org</Button>
          </View>
        )}
        {mode === 'join' && (
          <View style={{ gap: 12 }}>
            <Field label="Your name" hint="Optional — how orgmates will see you.">
              <Input value={myName} onChangeText={setMyName} maxLength={80} placeholder="e.g. Alex Solis" />
            </Field>
            <Field label="Invite code" hint="Paste the code an admin gave you — instant join">
              <Input value={code} onChangeText={setCode} autoCapitalize="none" />
            </Field>
            <Button onPress={redeem} disabled={busy || !code} busy={busy}>Join org</Button>
            <View style={{ height: 1, backgroundColor: t.line }} />
            <Field label="Or request to join — Organization ID"
                   hint="Ask the org's admin — they can copy it from Settings.">
              <Input value={orgSlug} onChangeText={setOrgSlug} autoCapitalize="none" />
            </Field>
            <Field label="Message (optional)"><Input value={message} onChangeText={setMessage} /></Field>
            <Button variant="secondary" onPress={requestJoin} disabled={busy || !orgSlug} busy={busy}>Request to join</Button>
          </View>
        )}
        {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12,
        }}>
          <Text style={{ fontSize: 12, color: t.ink3, flexShrink: 1 }} numberOfLines={1}>Signed in as {session?.user?.email}</Text>
          <Pressable accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 }} onPress={signOut}>
            <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink2 }}>Sign out</Text>
          </Pressable>
        </View>
      </Card>
    </ScrollView>
  );
}
