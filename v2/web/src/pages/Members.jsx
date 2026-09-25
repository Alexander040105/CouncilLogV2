import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Network } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { Card, Empty, PageHeader, Skeleton } from '../components/ui';
import { MemberManager } from '../components/MemberManager';

function Node({ n, nameOf }) {
  return (
    <li className="ml-4 border-l border-[var(--color-line)] pl-3">
      <div className="py-1">
        <span className="text-sm font-medium">{n.title}</span>
        <span className="ml-2 text-xs text-[var(--color-ink-3)]">{n.holder ? nameOf(n.holder) : 'vacant'}</span>
      </div>
      {n.children.length > 0 && <ul>{n.children.map((c) => <Node key={c.id} n={c} nameOf={nameOf} />)}</ul>}
    </li>
  );
}

export default function Members() {
  const org = currentOrgId();
  const [tab, setTab] = useState('roster');

  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
  });
  const chart = useQuery({
    queryKey: ['orgchart', org],
    queryFn: () => get(`/orgs/${org}/org-chart`),
    enabled: tab === 'chart',
  });
  const nameOf = (id) =>
    id ? (members.data?.data.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8)) : 'vacant';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        description="Roster, org chart, and this school year's positions."
        action={
          <div className="flex gap-1 rounded border border-[var(--color-line)] p-0.5 text-sm">
            {['roster', 'chart'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className={`rounded px-3 py-1 ${tab === t ? 'bg-[var(--color-surface-3)] font-semibold' : 'text-[var(--color-ink-3)]'}`}>
                {t === 'roster' ? 'Roster' : 'Org chart'}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'roster' && (
        <Card>
          <div className="mb-2 text-xs text-[var(--color-ink-3)]">
            Owners can change roles or remove members here — changes apply on the member's next action.
          </div>
          <MemberManager />
        </Card>
      )}

      {tab === 'chart' && (
        <Card>
          {chart.isLoading && <Skeleton className="h-40" />}
          {chart.data && (
            <>
              <div className="mb-2 text-xs text-[var(--color-ink-3)]">{chart.data.school_year}</div>
              {chart.data.data.length === 0
                ? <Empty icon={<Network size={24} />} title="No positions yet" hint="An owner can define the org chart in Settings." />
                : <ul>{chart.data.data.map((n) => <Node key={n.id} n={n} nameOf={nameOf} />)}</ul>}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
