import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, Empty, Skeleton } from '../components/ui';

export default function ProjectDetail() {
  const { id } = useParams();
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ['project', org, id],
    queryFn: () => get(`/orgs/${org}/projects/${id}`),
  });
  const instantiate = useMutation({
    mutationFn: () => post(`/orgs/${org}/projects/${id}/instantiate`, {}),
    onSuccess: (r) => {
      toast.success(`Checklist generated — ${r.instantiated_items} item(s).`);
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const check = useMutation({
    mutationFn: ({ itemId, done }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', org, id] }),
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  const p = q.data?.data;
  if (!p) return <Empty title="Project not found" />;
  const items = q.data?.checklist ?? [];

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
        <ArrowLeft size={14} /> Projects
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip kind="neutral" label={p.status} />
          {p.event_type && <Chip kind="extra" label={p.event_type} />}
          {p.target_date && <Chip kind="pending" label={`target ${p.target_date}`} />}
        </div>
        {p.details && <p className="mt-2 text-sm text-[var(--color-ink-2)]">{p.details}</p>}
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-[var(--color-ink-2)]">Checklist</div>
          {items.length === 0 && (
            <Button variant="secondary" onClick={() => instantiate.mutate()} disabled={instantiate.isPending}>
              {instantiate.isPending ? 'Generating…' : 'Generate checklist'}
            </Button>
          )}
        </div>
        {items.length === 0 && <Empty title="No checklist yet" hint="Generate one from your org's checklist templates." />}
        <div className="space-y-1">
          {items.map((it) => (
            <label key={it.id} className="flex items-start gap-3 rounded p-2 hover:bg-[var(--color-surface-3)]">
              <input
                type="checkbox" checked={it.done}
                onChange={(e) => check.mutate({ itemId: it.id, done: e.target.checked })}
                className="mt-1 h-4 w-4"
              />
              <span className="flex-1">
                <span className={`text-sm ${it.done ? 'line-through text-[var(--color-ink-3)]' : ''}`}>{it.label}</span>
                {it.hint && <span className="block text-xs text-[var(--color-ink-3)]">{it.hint}</span>}
              </span>
              {it.due_date && <Chip kind="pending" label={`due ${it.due_date}`} />}
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
