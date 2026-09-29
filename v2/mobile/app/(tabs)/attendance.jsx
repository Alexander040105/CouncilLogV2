/** Port of web/pages/Attendance.jsx — this-week grid + assigned-day filing
 *  rate. Table becomes a horizontal-scroll grid with a sticky member column. */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, Minus } from 'lucide-react-native';
import { del, get, queuedMsg } from '../../src/lib/api';
import { todayOrg, useOrgId } from '../../src/lib/org';
import { useAuth } from '../../src/lib/auth';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { Card, Chip, ConfirmDialog, Empty, ErrorState, HintBanner, PageHeader, Screen, Select, Skeleton } from '../../src/components/ui';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEMBER_COL = 120;
const DAY_COL = 64;

export default function Attendance() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const { t } = useTheme();
  const [memberId, setMemberId] = useState('');
  const [retracting, setRetracting] = useState(null);

  // last 7 days — computed up-front so the query can be bounded to this week
  const days = [...Array(7)].map((_, i) => todayOrg(i - 6));

  const week = useQuery({
    queryKey: ['attendance', 'week', org, days[0], days[6]],
    queryFn: () => get(`/orgs/${org}/attendance?from=${days[0]}&to=${days[6]}`),
    enabled: !!org,
  });
  const summary = useQuery({
    queryKey: ['attendance', 'summary', org],
    queryFn: () => get(`/orgs/${org}/attendance/summary`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members`),
    enabled: !!org,
  });

  const retract = useMutation({
    mutationFn: (r) => del(`/orgs/${org}/attendance/${r.day}?member_id=${r.member_id}`),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Declaration retracted.'));
      setRetracting(null);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => { setRetracting(null); toast.error(e.message); },
  });

  const nameOf = (id) =>
    members.data?.data.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8);
  const canRetract = (r) =>
    r.status === 'declared_no_tasks' &&
    ((r.member_id === session?.user?.id && r.day === todayOrg()) || active?.role === 'owner');
  const cellKind = (r) =>
    !r ? 'alert' : r.status === 'documented' ? 'done' : 'neutral';

  const rows = (week.data?.data ?? []).filter((r) => !memberId || r.member_id === memberId);
  const lookup = new Map(rows.map((r) => [`${r.member_id}|${r.day}`, r]));
  const memberIds = [...new Set(rows.map((r) => r.member_id))];

  const weekdayOf = (d) => WD[new Date(d).getDay() === 0 ? 6 : new Date(d).getDay() - 1];

  const headerCell = { width: DAY_COL, padding: 4, alignItems: 'center' };
  const headText = { fontSize: 11, color: t.ink3 };

  return (
    <Screen refresh={async () => { await Promise.all([week.refetch(), summary.refetch(), members.refetch()]); }}>
      <PageHeader
        title="Attendance"
        description="Who filed, who hasn't — a filed day counts, not a clock-in."
      />

      <HintBanner id="attendance">
        Each column is a day. ✓ = filed a journal entry, ∅ = declared no tasks. Members on
        their assigned day who haven’t filed yet show up as missing.
      </HintBanner>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>This week</Text>
          <Select
            value={memberId}
            onChange={setMemberId}
            accessibilityLabel="Filter by member"
            style={{ minWidth: 140 }}
            options={[{ value: '', label: 'All members' }, ...(members.data?.data ?? []).map((m) => ({ value: m.user_id, label: m.display_name }))]}
          />
        </View>
        {week.isLoading ? <Skeleton style={{ height: 160 }} /> : null}
        {week.isError ? <ErrorState error={week.error} retry={week.refetch} /> : null}
        {week.data && memberIds.length === 0 ? (
          <Empty icon={<CalendarCheck size={24} color={t.ink3} />} title="Nothing filed this week"
                 hint="Once members post journal entries or declare no-tasks, they'll show up here." />
        ) : null}
        {week.data && memberIds.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: MEMBER_COL, padding: 4 }}><Text style={headText}>Member</Text></View>
                {days.map((d) => <View key={d} style={headerCell}><Text style={headText}>{weekdayOf(d)}</Text></View>)}
              </View>
              {memberIds.map((mid) => (
                <View key={mid} style={{ flexDirection: 'row', borderTopWidth: t.boxWidth, borderTopColor: t.boxColor }}>
                  <View style={{ width: MEMBER_COL, padding: 4, justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink }} numberOfLines={1}>{nameOf(mid)}</Text>
                  </View>
                  {days.map((d) => {
                    const r = lookup.get(`${mid}|${d}`);
                    return (
                      <View key={d} style={{ width: DAY_COL, padding: 4, alignItems: 'center', justifyContent: 'center' }}>
                        {r ? (
                          canRetract(r) ? (
                            <Pressable accessibilityRole="button"
                                       accessibilityLabel={`Retract no-tasks declaration for ${nameOf(mid)} on ${d}`}
                                       onPress={() => setRetracting(r)}>
                              <Chip
                                kind={r.duty_type === 'extra' ? 'extra' : cellKind(r)}
                                icon={<Minus size={12} color={t.chips[cellKind(r)].fg} />}
                                label="none"
                              />
                            </Pressable>
                          ) : (
                            <Chip
                              kind={r.duty_type === 'extra' ? 'extra' : cellKind(r)}
                              icon={r.status === 'documented' ? <Check size={12} color={t.chips[r.duty_type === 'extra' ? 'extra' : cellKind(r)].fg} /> : <Minus size={12} color={t.chips[cellKind(r)].fg} />}
                              label={r.status === 'documented' ? 'filed' : 'none'}
                            />
                          )
                        ) : <Text style={{ color: t.ink3 }}>·</Text>}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>
          Assigned-day filing rate{summary.data ? ` · ${summary.data.school_year}` : ''}
        </Text>
        {summary.isLoading ? <Skeleton style={{ height: 128 }} /> : null}
        {summary.isError ? <ErrorState error={summary.error} retry={summary.refetch} /> : null}
        {summary.data && summary.data.data.length === 0 ? (
          <Empty title="No duty data yet" hint="Assigned days appear once an owner sets the duty schedule in Settings." />
        ) : null}
        {summary.data && summary.data.data.length > 0 ? (
          <View>
            <View style={{ flexDirection: 'row' }}>
              {['Officer', 'Duty days', 'Filed', 'Extra', '%'].map((h, i) => (
                <Text key={h} style={[{ flex: i === 0 ? 2 : 1, padding: 4, fontSize: 11, color: t.ink3 }]}>{h}</Text>
              ))}
            </View>
            {summary.data.data.map((s) => (
              <View key={s.member_id} style={{ flexDirection: 'row', borderTopWidth: t.boxWidth, borderTopColor: t.boxColor }}>
                <Text style={{ flex: 2, padding: 4, fontSize: 13, fontWeight: '600', color: t.ink }} numberOfLines={1}>{s.display_name ?? s.member_id.slice(0, 8)}</Text>
                <Text style={{ flex: 1, padding: 4, fontSize: 13, color: t.ink }}>{s.scheduled_days_elapsed}</Text>
                <Text style={{ flex: 1, padding: 4, fontSize: 13, color: t.ink }}>{s.filed}</Text>
                <Text style={{ flex: 1, padding: 4, fontSize: 13, color: t.ink }}>{s.extra}</Text>
                <Text style={{ flex: 1, padding: 4, fontSize: 13, fontWeight: '700', color: t.ink }}>
                  {s.compliance === null ? '—' : `${s.compliance}%`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <ConfirmDialog
        open={!!retracting}
        onClose={() => setRetracting(null)}
        onConfirm={() => retract.mutate(retracting)}
        busy={retract.isPending}
        title={`Retract the no-tasks declaration for ${retracting?.day}?`}
        body={`${retracting ? nameOf(retracting.member_id) : ''}'s day becomes unaccounted again — they can re-declare or file a journal entry.`}
        confirmLabel="Retract"
      />
    </Screen>
  );
}
