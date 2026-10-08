/** More tab — the overflow menu from web's AppShell Sheet: remaining nav +
 *  org switcher + account link + theme picker + sign out. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, FileText, ListTodo, LogOut, RefreshCw, Settings, ShieldCheck, Sparkles, Users, Wallet } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { queueCounts, subscribeOutbox } from '../../src/lib/offline';
import { unregisterPushToken } from '../../src/lib/push';
import { useEffect, useState } from 'react';
import { atLeast, setCurrentOrg, setOrgPicked } from '../../src/lib/org';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useTheme } from '../../src/lib/theme';
import { humanize } from '../../src/lib/labels';
import { Avatar, Card, ErrorState, Screen, Sheet, ThemePicker } from '../../src/components/ui';

const ROWS = [
  { path: '/documents', label: 'Papers', Icon: FileText },
  { path: '/tasks', label: 'Tasks', Icon: ListTodo },
  { path: '/agenda', label: 'Agenda', Icon: CalendarDays },
  { path: '/budget', label: 'Budget', Icon: Wallet },
  { path: '/members', label: 'Members', Icon: Users },
  { path: '/pending', label: 'Pending changes', Icon: RefreshCw },
  { path: '/guide', label: 'Guide', Icon: BookOpen },
  { path: '/whatsnew', label: "What's new", Icon: Sparkles },
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
  const [orgSheet, setOrgSheet] = useState(false);
  const [queued, setQueued] = useState(() => queueCounts());
  useEffect(() => subscribeOutbox(() => setQueued({ ...queueCounts() })), []);
  const pendingN = queued.pending + queued.sending + queued.dead;

  const signOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    setCurrentOrg(null);
    setOrgPicked(false);
    qc.clear();
    router.replace('/login');
  };

  return (
    <Screen>
      <Text style={{ fontSize: 28, fontWeight: t.headingWeight, color: t.ink }}>More</Text>

      {me.isError ? (
        <Card><ErrorState error={me.error} retry={me.refetch} what="your organizations" /></Card>
      ) : null}

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink3 }}>Organization</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOrgSheet(true)}
          style={{
            minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10,
            borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor, backgroundColor: t.surface3,
          }}
        >
          <Text style={{ flex: 1, fontSize: 14, color: t.ink }} numberOfLines={1}>{active?.org_name ?? 'No org'}</Text>
          <ChevronDown size={14} color={t.ink3} />
        </Pressable>
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

      <Sheet open={orgSheet} onClose={() => setOrgSheet(false)} title="Switch organization">
        <View style={{ gap: 2 }}>
          {memberships.map((m) => (
            <Pressable
              key={m.org_id}
              accessibilityRole="button"
              onPress={() => { setCurrentOrg(m.org_id); setOrgPicked(); qc.invalidateQueries(); setOrgSheet(false); }}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: t.radiusInput }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }} numberOfLines={1}>{m.org_name}</Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>{humanize(m.role)}</Text>
              </View>
              {m.org_id === active?.org_id ? <Check size={16} color={t.accent} /> : null}
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => { setOrgSheet(false); router.push('/onboarding'); }}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 10 }}
          >
            <Text style={{ fontSize: 14, color: t.ink3 }}>+ Create or join another organization</Text>
          </Pressable>
        </View>
      </Sheet>
    </Screen>
  );
}
