import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban, Plus } from 'lucide-react';
import { get, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { ChecklistPreview } from '../components/ChecklistPreview';
import { Button, Card, Chip, Empty, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';

const STATUS = ['draft', 'active', 'done', 'archived'];

export default function Projects() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', event_type: '', target_date: '', paper: false, logistics: false, assignee: '' });
  const [err, setErr] = useState(null);

  const list = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });
  const templates = useQuery({
    queryKey: ['templates', org],
    queryFn: () => get(`/orgs/${org}/checklist-templates`),
    enabled: !!org,
  });
  const knownEventTypes = [...new Set(
    (templates.data?.data ?? []).map((t) => t.event_type).filter(Boolean))].sort();
  const nameOf = (id) =>
    members.data?.data.find((m) => m.user_id === id)?.display_name ?? null;
  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/projects`, {
      title: form.title, details: form.details || null,
      event_type: form.event_type || null, target_date: form.target_date || null,
      owner_id: form.assignee || null,
      needs_paper_processing: form.paper, needs_logistics: form.logistics,
    }),
    onSuccess: () => {
      toast.success(form.assignee ? 'Project created — assignee will be emailed.' : 'Project created.');
      setOpen(false);
      setForm({ title: '', details: '', event_type: '', target_date: '', paper: false, logistics: false, assignee: '' });
      qc.invalidateQueries({ queryKey: ['projects', org] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const groups = STATUS.map((s) => ({ s, items: (list.data?.data ?? []).filter((p) => p.status === s) }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Events and the paperwork + logistics behind them."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} />New project</Button>}
      />
      <HintBanner id="projects">
        A project generates its checklist from templates: check "Needs papers" for
        signatory-routed documents, "Needs logistics" for venue/equipment steps.
      </HintBanner>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.data?.data.length === 0 && (
        <Empty icon={<FolderKanban size={24} />} title="No projects"
               hint="Create one to start tracking papers and logistics."
               action={<Button onClick={() => setOpen(true)}>New project</Button>} />
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map(({ s, items }) => (
          <div key={s} className="space-y-2">
            <div className="text-xs font-semibold uppercase text-[var(--color-ink-3)]">{s} · {items.length}</div>
            {items.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="space-y-1 hover:border-[var(--color-accent)]">
                  <div className="text-sm font-medium">{p.title}</div>
                  {p.target_date && <div className="text-xs text-[var(--color-ink-3)]">target {p.target_date}</div>}
                  {nameOf(p.owner_id) && <div className="text-xs text-[var(--color-ink-3)]">lead: {nameOf(p.owner_id)}</div>}
                  <div className="flex gap-1">
                    {p.needs_paper_processing && <Chip kind="pending" label="papers" />}
                    {p.needs_logistics && <Chip kind="extra" label="logistics" />}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="New project">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Details"><Input value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field>
          <Field label="Event type" hint="Drives which templates match — known types are suggested.">
            <Input list="event-types" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} placeholder="seminar, competition, webinar_intl…" />
            <datalist id="event-types">
              {knownEventTypes.map((t) => <option key={t} value={t} />)}
            </datalist>
          </Field>
          <Field label="Target date"><Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
          <Field label="Assign to (optional)" hint="They'll get an email telling them they lead this project.">
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
              <option value="">Me</option>
              {members.data?.data.filter((m) => m.status === 'active').map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.checked })} /> Needs papers</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.logistics} onChange={(e) => setForm({ ...form, logistics: e.target.checked })} /> Needs logistics</label>
          </div>
          <ChecklistPreview
            templates={templates.data?.data}
            paper={form.paper} logistics={form.logistics}
            eventType={form.event_type || null} targetDate={form.target_date || null} />
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={() => create.mutate()} disabled={!form.title || create.isPending}>Create</Button>
        </div>
      </Sheet>
    </div>
  );
}
