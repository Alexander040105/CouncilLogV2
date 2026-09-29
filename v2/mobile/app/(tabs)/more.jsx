/** More tab — the overflow menu from web's AppShell Sheet: remaining nav +
 *  org switcher + account link + theme picker + sign out. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronRight, FileText, LogOut, RefreshCw, Settings, ShieldCheck, Users } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { queueCounts, subscribeOutbox } from '../../src/lib/offline';
import { unregisterPushToken } from '../../src/lib/push';
import { useEffect, useState } from 'react';
import { atLeast, setCurrentOrg } from '../../src/lib/org';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useTheme } from '../../src/lib/theme';
import { Avatar, Card, ErrorState, Screen, Select, ThemePicker } from '../../src/components/ui';

const ROWS = [
  { path: '/documents', label: 'Papers', Icon: FileText },
  { path: '/members', label: 'Members', Icon: Users },
  { path: '/pending', label: 'Pending changes', Icon: RefreshCw },
  { path: '/guide', label: 'Guide', Icon: BookOpen },
  { path: '/settings', label: 'Settings', Icon: Settings, admin: true },
  { path: '/admin', label: 'Admin', Icon: ShieldCheck, platform: true },
];

export default function More() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const memberships = me.data?.memberships ?? [];
  const isAdmin = active ? atLeast(active.role, 'adviser') : false;
  const rows = ROWS.filter((r) => (!r.admin || isAdmin) && (!r.platform || me.data?.is_admin));
  const [queued, setQueued] = useState(() => queueCounts());
  useEffect(() => subscribeOutbox(() => setQueued({ ...queueCounts() })), []);
  const pendingN = queued.pending + queued.sending + queued.dead;

  const signOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    setCurrentOrg(null);
    qc.clear();
    router.replace('/login');
  };

  return (
    <Screen>
      <Text style={{ fontSize: 28, fontWeight: t.headingWeight, color: t.ink }}>More</Text>

      {me.isError ? (
        <Card><ErrorState error={me.error} retry={me.refetch} /></Card>
      ) : null}

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink3 }}>Organization</Text>
        <Select
          value={active?.org_id ?? ''}
          accessibilityLabel="Organization"
          onChange={(v) => { if (v === '__new') router.push('/onboarding'); else { setCurrentOrg(v); qc.invalidateQueries(); } }}
          options={[
            ...memberships.map((m) => ({ value: m.org_id, label: m.org_name })),
            ...(memberships.length === 0 ? [{ value: '', label: 'no org' }] : []),
            { value: '__new', label: '+ create or join…' },
          ]}
        />
      </Card>

      <Card style={{ gap: 2, padding: 8 }}>
        {rows.map(({ path, label, Icon }) => (
          <Pressable
            key={path}
            accessibilityRole="button"
            onPress={() => router.push(path)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: t.radiusInput }}
          >
            <Icon size={20} color={t.ink2} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: t.labelWeight, color: t.ink2, textTransform: t.labelTransform, letterSpacing: t.labelTracking }}>{label}</Text>
            {path === '/pending' && pendingN > 0 ? (
              <Text style={{ fontSize: 12, fontWeight: '700', color: t.pending }}>{pendingN}</Text>
            ) : null}
            <ChevronRight size={14} color={t.ink3} />
          </Pressable>
        ))}
      </Card>

      <Card style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')}
                   style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <Avatar name={me.data?.profile?.display_name} url={me.data?.profile?.avatar_url} />
          <Text style={{ flex: 1, fontSize: 14, color: t.ink2 }} numberOfLines={1}>
            {me.data?.profile?.display_name ?? 'Account'}
          </Text>
          <ChevronRight size={14} color={t.ink3} />
        </Pressable>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3 }}>Theme</Text>
          <ThemePicker />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          style={{
            minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor, backgroundColor: t.surface2,
          }}
        >
          <LogOut size={16} color={t.ink2} />
          <Text style={{ fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink2 }}>Sign out</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
