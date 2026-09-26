import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarCheck, Check, Minus } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { Card, Chip, Empty, ErrorState, HintBanner, PageHeader, Skeleton } from '../components/ui';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Attendance() {
  const org = currentOrgId();
  const [memberId, setMemberId] = useState('');

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

  const nameOf = (id) =>
    members.data?.data.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8);
  const cellKind = (r) =>
    !r ? 'alert' : r.status === 'documented' ? 'done' : 'neutral';

  const rows = (week.data?.data ?? []).filter((r) => !memberId || r.member_id === memberId);
  const lookup = new Map(rows.map((r) => [`${r.member_id}|${r.day}`, r]));
  const memberIds = [...new Set(rows.map((r) => r.member_id))];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Who filed, who hasn't — a filed day counts, not a clock-in."
      />

      <HintBanner id="attendance">
        Each column is a day. ✓ = filed a journal entry, ∅ = declared no tasks. Members on
        their assigned day who haven't filed yet show up as missing.
      </HintBanner>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div className="label-strong text-sm text-[var(--color-ink-2)]">This week</div>
          <select
            className="rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-1.5 text-xs"
            value={memberId} onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">All members</option>
            {members.data?.data.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </select>
        </div>
        {week.isLoading && <Skeleton className="h-40" />}
        {week.isError && <ErrorState error={week.error} retry={week.refetch} />}
        {week.data && memberIds.length === 0 && (
          <Empty icon={<CalendarCheck size={24} />} title="Nothing filed this week"
                 hint="Once members post journal entries or declare no-tasks, they'll show up here." />
        )}
        {week.data && memberIds.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-ink-3)]">
                  <th className="p-1">Member</th>
                  {days.map((d) => <th key={d} className="p-1">{WD[new Date(d).getDay() === 0 ? 6 : new Date(d).getDay() - 1]}</th>)}
                </tr>
              </thead>
              <tbody>
                {memberIds.map((mid) => (
                  <tr key={mid} className="[border-top:var(--border-box)]">
                    <td className="p-1 font-medium">{nameOf(mid)}</td>
                    {days.map((d) => {
                      const r = lookup.get(`${mid}|${d}`);
                      return (
                        <td key={d} className="p-1">
                          {r ? (
                            <Chip
                              kind={r.duty_type === 'extra' ? 'extra' : cellKind(r)}
                              icon={r.status === 'documented' ? <Check size={12} /> : <Minus size={12} />}
                              label={r.status === 'documented' ? 'filed' : 'none'}
                            />
                          ) : <span className="text-[var(--color-ink-3)]">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="label-strong mb-2 text-sm text-[var(--color-ink-2)]">
          Assigned-day filing rate {summary.data && `· ${summary.data.school_year}`}
        </div>
        {summary.isLoading && <Skeleton className="h-32" />}
        {summary.isError && <ErrorState error={summary.error} retry={summary.refetch} />}
        {summary.data && summary.data.data.length === 0 && (
          <Empty title="No duty data yet" hint="Assigned days appear once an owner sets the duty schedule in Settings." />
        )}
        {summary.data && summary.data.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-ink-3)]">
                <th className="p-1">Officer</th><th className="p-1">Duty days</th>
                <th className="p-1">Filed</th><th className="p-1">Extra</th><th className="p-1">%</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.data.map((s) => (
                <tr key={s.member_id} className="[border-top:var(--border-box)]">
                  <td className="p-1 font-medium">{s.display_name ?? s.member_id.slice(0, 8)}</td>
                  <td className="p-1">{s.scheduled_days_elapsed}</td>
                  <td className="p-1">{s.filed}</td>
                  <td className="p-1">{s.extra}</td>
                  <td className="p-1 font-semibold">
                    {s.compliance === null ? '—' : `${s.compliance}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
