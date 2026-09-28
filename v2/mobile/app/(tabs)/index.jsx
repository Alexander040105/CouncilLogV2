/** Port of web/pages/Dashboard.jsx — Today: your day status, quick actions,
 *  duty-roster summary, onboarding explainer for brand-new orgs. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Check, FileText, FolderKanban, Users } from 'lucide-react-native';
import { get } from '../../src/lib/api';
import { todayOrg, useOrgId } from '../../src/lib/org';
import { useMe } from '../../src/lib/me';
import { useTheme } from '../../src/lib/theme';
import { Button, Card, Chip, Empty, ErrorState, HintBanner, PageHeader, Screen, Skeleton } from '../../src/components/ui';

export default function Dashboard() {
  const me = useMe();
  const router = useRouter();
  const { t } = useTheme();
  const org = useOrgId();
  const today = todayOrg();

  const att = useQuery({
    queryKey: ['attendance', 'day', org, today],
    queryFn: () => get(`/orgs/${org}/attendance?day=${today}`),
    enabled: !!org,
  });
  const positions = useQuery({
    queryKey: ['positions', org],
    queryFn: () => get(`/orgs/${org}/positions`),
    enabled: !!org,
  });

  const myRow = att.data?.data.find((r) => r.member_id === me.data?.id);
  const isFresh =
    positions.data && positions.data.data.length === 0 &&
    att.data && att.data.data.length === 0;

  const navLink = (to, text) => (
    <Pressable key={text} accessibilityRole="link" onPress={() => router.push(to)} style={{ minHeight: 28 }}>
      <Text style={{ color: t.brand, fontSize: 14, textDecorationLine: 'underline' }}>{text}</Text>
    </Pressable>
  );

  return (
    <Screen refresh={async () => { await Promise.all([att.refetch(), positions.refetch(), me.refetch()]); }}>
      <PageHeader
        title="Today"
        description="Your duty day at a glance: file once, you're accounted."
      />

      <HintBanner id="dashboard">
        File a journal entry on your assigned day — or tap "No tasks today". That's all it
        takes to be counted present. Papers and projects live in their own tabs.
      </HintBanner>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: t.ink3 }}>Your day</Text>
            <Text style={{ fontSize: 18, fontWeight: '600', color: t.ink }}>
              {myRow ? (myRow.status === 'documented' ? 'Documented' : 'No tasks declared') : 'Nothing filed yet'}
            </Text>
          </View>
          {myRow ? (
            <Chip
              kind={myRow.status === 'documented' ? 'done' : 'neutral'}
              label={myRow.duty_type === 'extra' ? 'extra duty' : 'on duty'}
              icon={<Check size={12} color={myRow.status === 'documented' ? t.chips.done.fg : t.chips.neutral.fg} />}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button style={{ flex: 1 }} onPress={() => router.push('/journal?compose=1')}>Log work</Button>
          <Button variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/journal?notasks=1')}>No tasks today</Button>
        </View>
      </Card>

      {isFresh ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>New here? How CounciLog works</Text>
          <Text style={{ fontSize: 14, color: t.ink2 }}>• File a journal entry each duty day — that's your attendance.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: t.ink2 }}>• </Text>
            {navLink('/documents', 'Papers')}
            <Text style={{ fontSize: 14, color: t.ink2 }}> tracks where physical documents are and who's signing them.</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: t.ink2 }}>• </Text>
            {navLink('/projects', 'Projects')}
            <Text style={{ fontSize: 14, color: t.ink2 }}> holds events and their paperwork + logistics checklists.</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: t.ink2 }}>• Admins set up positions, duty days, and templates in </Text>
            {navLink('/settings', 'Settings')}
            <Text style={{ fontSize: 14, color: t.ink2 }}>.</Text>
          </View>
        </Card>
      ) : null}

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Duty roster today</Text>
        {att.isLoading ? <Skeleton style={{ height: 64 }} /> : null}
        {att.isError ? <ErrorState error={att.error} retry={att.refetch} /> : null}
        {att.data && att.data.data.length === 0 && att.data.unaccounted_member_ids.length === 0 ? (
          <Empty icon={<CalendarCheck size={24} color={t.ink3} />} title="No duty entries yet" hint="Be the first to file today." />
        ) : null}
        {att.data && (att.data.data.length > 0 || att.data.unaccounted_member_ids.length > 0) ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, color: t.ink }}>{att.data.data.length} entries filed today</Text>
            {att.data.unaccounted_member_ids.length > 0 ? (
              <Text style={{ fontSize: 14, color: t.alert }}>
                {att.data.unaccounted_member_ids.length} scheduled member(s) haven't filed yet
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Quick links</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[
            { to: '/projects', label: 'Projects', Icon: FolderKanban },
            { to: '/documents', label: 'Papers', Icon: FileText },
            { to: '/attendance', label: 'Attendance', Icon: CalendarCheck },
            { to: '/members', label: 'Org chart', Icon: Users },
          ].map(({ to, label, Icon }) => (
            <Button key={to} variant="secondary" style={{ flexGrow: 1, minWidth: '45%' }} onPress={() => router.push(to)}>
              <Icon size={16} color={t.ink} />
              <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, color: t.ink }}>{label}</Text>
            </Button>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
