import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Check, Copy, Plus } from 'lucide-react';
import { get, post, put, patch, del as delApi } from '../lib/api';
import { atLeast, currentOrgId, setCurrentOrg } from '../lib/org';
import { collectFlagNames, describeCondition, describeItemRule } from '../lib/rules';
import { useToast } from '../lib/toast';
import { Button, Card, ConfirmDialog, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Skeleton, ThemePicker } from '../components/ui';
import { MemberManager } from '../components/MemberManager';
import { TemplateEditor } from '../components/TemplateEditor';
import { ChainEditor } from '../components/ChainEditor';

const TABS = ['members', 'positions', 'duty', 'templates', 'chains', 'contacts', 'invites', 'audit'];

export default function Settings() {
  // tab lives in the URL so guide/settings link-outs land on the right pane
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'positions';
  const setTab = (t) => setParams({ tab: t });
  const { active } = useOutletContext() ?? {};
  const org = currentOrgId();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const canWrite = active ? atLeast(active.role, 'owner') : false;

  const copyOrgId = async () => {
    try {
      await navigator.clipboard.writeText(org);
      setCopied(true);
      toast.success('Organization ID copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — long-press the ID to copy it manually.');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Org structure, templates, invites, and audit log."
      />

      {!canWrite && (
        <HintBanner id="settings-readonly">
          Only owners can change these settings — you're viewing read-only.
        </HintBanner>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Organization ID</div>
            <div className="truncate font-mono text-xs text-[var(--color-ink-3)]">{org}</div>
          </div>
          <div className="flex items-center gap-1">
            <ThemePicker />
            <Button variant="secondary" onClick={copyOrgId}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy ID'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Share this ID with people who want to request access — they paste it on the
          "join" screen. For instant joins, mint an invite link below instead.
        </p>
      </Card>

      <div className="flex flex-wrap gap-1 rounded-[var(--radius-input)] [border:var(--border-box)] p-0.5 text-sm">
        {TABS.filter((t) => t !== 'invites' || canWrite).map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={`label-strong min-h-[36px] rounded-[var(--radius-input)] px-3 py-1 capitalize ${tab === t ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'text-[var(--color-ink-3)]'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'members' && (
        <Card>
          <div className="mb-2 text-sm font-medium">Members &amp; roles</div>
          <div className="mb-2 text-xs text-[var(--color-ink-3)]">
            Roles decide what each member can do — see the descriptions under each name. Owners are set at org creation and can't be changed here.
          </div>
          <MemberManager />
        </Card>
      )}
      {tab === 'positions' && <Positions canWrite={canWrite} />}
      {tab === 'duty' && <Duty canWrite={canWrite} />}
      {tab === 'templates' && <Templates canWrite={canWrite} />}
      {tab === 'chains' && <Chains canWrite={canWrite} />}
      {tab === 'contacts' && <Contacts canWrite={canWrite} />}
      {tab === 'invites' && <Invites />}
      {tab === 'audit' && <Audit />}

      {canWrite && <DangerZone orgName={active?.org_name} />}
    </div>
  );
}

// ── Danger zone ─────────────────────────────────────────────────────────
function DangerZone({ orgName }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const archive = useMutation({
    mutationFn: () => post(`/orgs/${org}/archive`),
    onSuccess: async () => {
      // memberships now empty → /me refetch drops the org → AppShell lands
      // on /onboarding. Clear the stored pick first so nothing queries a
      // dead org in the meantime.
      setCurrentOrg(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => { setOpen(false); toast.error(e.message); },
  });

  return (
    <Card className="space-y-3 border-[var(--color-status-alert)]/40">
      <h2 className="label-strong text-[var(--color-status-alert)]">Danger zone</h2>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-2)]">
          Archive this org — it disappears for every member, including you.
          Nothing is deleted; a CounciLog admin can bring it back.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>Archive org</Button>
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => archive.mutate()}
        busy={archive.isPending}
        title={`Archive ${orgName ?? 'this org'}?`}
        body="Every member loses access immediately — projects, papers, journals, all hidden. Nothing is deleted and the audit trail stays, but only a CounciLog admin can restore it."
        confirmLabel="Archive org"
        requireText={orgName}
      />
    </Card>
  );
}

// ── Positions ───────────────────────────────────────────────────────────
function Positions({ canWrite }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [holder, setHolder] = useState('');
  const pos = useQuery({
    queryKey: ['positions', org],
    queryFn: () => get(`/orgs/${org}/positions`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members`),
    enabled: !!org,
  });
  const add = useMutation({
    mutationFn: () => post(`/orgs/${org}/positions`, { title, holder: holder || null }),
    onSuccess: () => {
      toast.success('Position added.');
      setTitle(''); setHolder('');
      qc.invalidateQueries({ queryKey: ['positions', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  const nameOf = (id) =>
    id ? (members.data?.data.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8)) : '—';

  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">Positions (current school year)</div>
      <div className="text-xs text-[var(--color-ink-3)]">The org chart — who holds which office this year.</div>
      {pos.isLoading && <Skeleton className="h-24" />}
      {pos.isError && <ErrorState error={pos.error} retry={pos.refetch} />}
      {pos.data && pos.data.data.length === 0 && (
        <Empty title="No positions yet" hint="Add your first office — e.g. President, Secretary." />
      )}
      <div className="divide-y divide-[var(--color-line)]">
        {pos.data?.data.map((p) => (
          <div key={p.id} className="flex justify-between py-2 text-sm">
            <span>{p.title}</span><span className="text-[var(--color-ink-3)]">{nameOf(p.holder)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" placeholder="Position title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="min-w-0 flex-1 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-sm"
                value={holder} onChange={(e) => setHolder(e.target.value)}>
          <option value="">holder…</option>
          {members.data?.data.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
        </select>
        <Button onClick={() => add.mutate()} disabled={!canWrite || !title || add.isPending}>Add</Button>
      </div>
    </Card>
  );
}

// ── Duty schedule ────────────────────────────────────────────────────────
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function Duty({ canWrite }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const duty = useQuery({
    queryKey: ['duty', org],
    queryFn: () => get(`/orgs/${org}/duty-schedule`),
    enabled: !!org,
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members`),
    enabled: !!org,
  });
  const save = useMutation({
    mutationFn: (schedule) => put(`/orgs/${org}/duty-schedule`, { schedule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duty', org] }),
    onError: (e) => toast.error(e.message),
  });

  if (duty.isLoading || members.isLoading) return <Skeleton className="h-48" />;
  if (duty.isError) return <ErrorState error={duty.error} retry={duty.refetch} />;
  const schedule = duty.data?.data ?? {};
  const active = members.data?.data.filter((m) => m.status === 'active') ?? [];

  const toggle = (weekday, uid) => {
    const next = {};
    for (let d = 0; d < 7; d++) next[d] = [...(schedule[String(d)] ?? schedule[d] ?? [])];
    const arr = next[weekday];
    next[weekday] = arr.includes(uid) ? arr.filter((x) => x !== uid) : [...arr, uid];
    save.mutate(next);
  };

  return (
    <Card className="space-y-2">
      <div className="text-sm font-medium">Assigned duty days · {duty.data?.school_year}</div>
      <div className="text-xs text-[var(--color-ink-3)]">
        Tick the weekday(s) each member is expected to file. They can still log on other days — it counts as extra duty.
      </div>
      {active.length === 0 && <Empty title="No active members" hint="Members appear here once they join." />}
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-left text-[var(--color-ink-3)]">
              <th className="p-1">Member</th>
              {WD.map((d) => <th key={d} className="p-1">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.user_id} className="[border-top:var(--border-box)]">
                <td className="p-1 font-medium">{m.display_name}</td>
                {WD.map((_, d) => {
                  const on = (schedule[String(d)] ?? schedule[d] ?? []).includes(m.user_id);
                  return (
                    <td key={d} className="p-1">
                      <input type="checkbox" checked={on} disabled={!canWrite || save.isPending}
                             onChange={() => toggle(d, m.user_id)} className="h-4 w-4 disabled:opacity-50" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-[var(--color-ink-3)]">Changes save automatically.</div>
    </Card>
  );
}

// ── Checklist templates ─────────────────────────────────────────────────
const EVENT_TYPE_SUGGESTIONS = ['seminar', 'competition', 'webinar', 'webinar_intl',
                                'outside', 'ces', 'educ_tour', 'merch'];

function LibraryCard() {
  return (
    <Card className="space-y-1">
      <div className="text-sm font-medium">New here?</div>
      <p className="text-xs text-[var(--color-ink-3)]">
        The Guide has worked examples you can load and adapt — with notes on why
        each is built the way it is.{' '}
        <Link to="/guide#library" className="text-[var(--color-accent)] underline">Open the starter library</Link>
      </p>
    </Card>
  );
}

function Templates({ canWrite }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [editor, setEditor] = useState(null); // {template} or {} for new
  const [deleting, setDeleting] = useState(null);
  const t = useQuery({
    queryKey: ['templates', org],
    queryFn: () => get(`/orgs/${org}/checklist-templates`),
    enabled: !!org,
  });
  const chains = useQuery({
    queryKey: ['chains', org],
    queryFn: () => get(`/orgs/${org}/signatory-chains`),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
    enabled: !!org,
  });
  const knownEventTypes = [...new Set([
    ...EVENT_TYPE_SUGGESTIONS,
    ...(projects.data?.data ?? []).map((p) => p.event_type),
    ...(t.data?.data ?? []).map((x) => x.event_type),
  ].filter(Boolean))].sort();
  const flagNames = collectFlagNames({ chains: chains.data?.data, templates: t.data?.data });
  const del = useMutation({
    mutationFn: (id) => delApi(`/orgs/${org}/checklist-templates/${id}`),
    onSuccess: () => {
      toast.success('Template deleted — generated checklists keep their copies.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['templates', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <LibraryCard />
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Checklist templates</div>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditor({})}><Plus size={16} />New template</Button>
          )}
        </div>
        <div className="text-xs text-[var(--color-ink-3)]">
          Reusable step lists that become a project's checklist. A project picks up a
          template when it needs that track (papers / logistics) AND the event types
          match — or the template has no event type.
        </div>
        {t.isLoading && <Skeleton className="h-24" />}
        {t.isError && <ErrorState error={t.error} retry={t.refetch} />}
        {t.data && t.data.data.length === 0 && (
          <Empty title="No templates"
                 hint={canWrite
                   ? 'Create one, or load a worked example from the starter library in the Guide.'
                   : 'Projects will show "no templates exist" until an owner adds one.'}
                 action={canWrite ? <Button variant="secondary" onClick={() => setEditor({})}>New template</Button> : null} />
        )}
        {t.data?.data.map((x) => (
          <div key={x.id} className="space-y-1 rounded-[var(--radius-card)] [border:var(--border-box)] p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{x.name}</div>
                <div className="text-xs text-[var(--color-ink-3)]">
                  {x.track === 'both' ? 'any project' : `projects needing ${x.track}`}
                  {x.event_type ? ` · only "${x.event_type}" events` : ' · any event type'}
                </div>
              </div>
              {canWrite && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                          onClick={() => setEditor({ template: x })}>Edit</Button>
                  <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-[var(--color-status-alert)]"
                          onClick={() => setDeleting(x)}>Delete</Button>
                </div>
              )}
            </div>
            <ul className="ml-4 list-disc text-xs text-[var(--color-ink-2)]">
              {x.items.map((i, k) => {
                const rule = describeItemRule(i.rule_json);
                return (
                  <li key={k}>
                    {i.label}{i.required === false ? ' (optional)' : ''}
                    {i.hint && <span className="block text-[var(--color-ink-3)]">{i.hint}</span>}
                    {rule && <span className="block text-[var(--color-ink-3)]">{rule}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>
      <TemplateEditor
        open={editor !== null} onClose={() => setEditor(null)}
        template={editor?.template ?? null}
        eventTypes={knownEventTypes} flagNames={flagNames} />
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => del.mutate(deleting.id)} busy={del.isPending}
        title={`Delete "${deleting?.name}"?`}
        body="Projects already generated from this template keep their copies — only the template goes away."
        confirmLabel="Delete template"
      />
    </>
  );
}

// ── Signatory chains ─────────────────────────────────────────────────────
const STANDARD_DOC_TYPES = ['concept_paper', 'board_resolution', 'financial_report',
                            'activity_report', 'ces_concept_paper', 'letter'];
function Chains({ canWrite }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [editor, setEditor] = useState(null); // {chain} or {} for new
  const [deleting, setDeleting] = useState(null);
  const c = useQuery({
    queryKey: ['chains', org],
    queryFn: () => get(`/orgs/${org}/signatory-chains`),
    enabled: !!org,
  });
  const templates = useQuery({
    queryKey: ['templates', org],
    queryFn: () => get(`/orgs/${org}/checklist-templates`),
    enabled: !!org,
  });
  const docs = useQuery({
    queryKey: ['documents', org],
    queryFn: () => get(`/orgs/${org}/documents?pageSize=100`),
    enabled: !!org,
  });
  const usedTypes = [...new Set((docs.data?.data ?? []).map((d) => d.doc_type))];
  const typeSuggestions = [...new Set([...usedTypes, ...STANDARD_DOC_TYPES])].sort();
  const flagNames = collectFlagNames({ chains: c.data?.data, templates: templates.data?.data });
  const matchCount = (dt) => (docs.data?.data ?? []).filter((d) => d.doc_type === dt).length;
  const del = useMutation({
    mutationFn: (id) => delApi(`/orgs/${org}/signatory-chains/${id}`),
    onSuccess: () => {
      toast.success('Chain deleted — papers already routing keep their steps.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['chains', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <LibraryCard />
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Signatory chains</div>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditor({})}><Plus size={16} />New chain</Button>
          )}
        </div>
        <div className="text-xs text-[var(--color-ink-3)]">
          A chain is the signing route for a paper. When an officer registers a document
          whose type matches a chain's doc type, these steps attach in order —
          automatically. The doc type must match <span className="font-medium">exactly</span>.
        </div>
        {c.isLoading && <Skeleton className="h-24" />}
        {c.isError && <ErrorState error={c.error} retry={c.refetch} />}
        {c.data && c.data.data.length === 0 && (
          <Empty title="No chains"
                 hint={canWrite
                   ? 'Create one, or load a worked example from the starter library in the Guide.'
                   : 'Documents will register unrouted until an owner adds chains.'}
                 action={canWrite ? <Button variant="secondary" onClick={() => setEditor({})}>New chain</Button> : null} />
        )}
        {c.data?.data.map((x) => {
          const n = matchCount(x.doc_type);
          return (
            <div key={x.id} className="space-y-1 rounded-[var(--radius-card)] [border:var(--border-box)] p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {x.name} <span className="font-mono text-xs text-[var(--color-ink-3)]">· {x.doc_type}</span>
                  </div>
                  <div className={`text-xs ${n === 0 ? 'text-[var(--color-status-alert)]' : 'text-[var(--color-ink-3)]'}`}>
                    {n === 0
                      ? 'matches no registered papers — check the doc type spelling'
                      : `covers ${n} registered paper${n === 1 ? '' : 's'}`}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                            onClick={() => setEditor({ chain: x })}>Edit</Button>
                    <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-[var(--color-status-alert)]"
                            onClick={() => setDeleting(x)}>Delete</Button>
                  </div>
                )}
              </div>
              <ol className="ml-4 list-decimal text-xs text-[var(--color-ink-2)]">
                {x.steps.map((s, k) => {
                  const cond = describeCondition(s.condition_json);
                  return (
                    <li key={k}>
                      {s.label}{s.office ? <span className="text-[var(--color-ink-3)]"> — {s.office}</span> : ''}
                      {cond && <span className="block text-[var(--color-ink-3)]">{cond}</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </Card>
      <ChainEditor
        open={editor !== null} onClose={() => setEditor(null)}
        chain={editor?.chain ?? null}
        docTypes={typeSuggestions} eventTypes={EVENT_TYPE_SUGGESTIONS} flagNames={flagNames} />
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => del.mutate(deleting.id)} busy={del.isPending}
        title={`Delete "${deleting?.name}"?`}
        body="Papers already routing on this chain keep their steps — only the chain goes away."
        confirmLabel="Delete chain"
      />
    </>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────
function Contacts({ canWrite }) {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null); // contact row being edited
  const [deleting, setDeleting] = useState(null);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState('');
  const c = useQuery({
    queryKey: ['contacts', org],
    queryFn: () => get(`/orgs/${org}/contacts`),
    enabled: !!org,
  });
  const reset = () => { setEditing(null); setLabel(''); setValue(''); setCategory(''); };
  const startEdit = (x) => {
    setEditing(x); setLabel(x.label); setValue(x.value); setCategory(x.category ?? '');
  };
  const save = useMutation({
    mutationFn: () => editing
      ? patch(`/orgs/${org}/contacts/${editing.id}`,
              { label, value, category: category || null })
      : post(`/orgs/${org}/contacts`, { label, value, category: category || null }),
    onSuccess: () => {
      toast.success(editing ? 'Contact updated.' : 'Contact added.');
      reset();
      qc.invalidateQueries({ queryKey: ['contacts', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id) => delApi(`/orgs/${org}/contacts/${id}`),
    onSuccess: () => {
      toast.success('Contact removed.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['contacts', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Card className="space-y-3">
        <div className="text-sm font-medium">Quick reference — who to ask</div>
        {c.isLoading && <Skeleton className="h-16" />}
        {c.isError && <ErrorState error={c.error} retry={c.refetch} />}
        {c.data && c.data.data.length === 0 && (
          <Empty title="No contacts"
                 hint="e.g. Concept papers → your student affairs office. Owners add entries below." />
        )}
        {c.data?.data.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] py-1 text-sm">
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
              <span className="min-w-0">{x.label}</span>
              <span className="min-w-0 text-[var(--color-ink-3)]">{x.value}</span>
            </div>
            {canWrite && (
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                        onClick={() => startEdit(x)}>Edit</Button>
                <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-[var(--color-status-alert)]"
                        onClick={() => setDeleting(x)}>Delete</Button>
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1" placeholder="Need" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input className="min-w-0 flex-1" placeholder="Who / where" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input className="min-w-0 flex-1" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          {canWrite && editing && (
            <Button variant="ghost" onClick={reset}>Cancel</Button>
          )}
          <Button onClick={() => save.mutate()} disabled={!canWrite || !label || !value || save.isPending}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => del.mutate(deleting.id)} busy={del.isPending}
        title={`Delete "${deleting?.label}"?`}
        body="It's removed from the who-to-ask directory for every member. Nothing else references it."
        confirmLabel="Delete contact"
      />
    </>
  );
}

// ── Invites ──────────────────────────────────────────────────────────────
function Invites() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState('officer');
  const [approveRoles, setApproveRoles] = useState({});
  const [rejecting, setRejecting] = useState(null);
  const inv = useQuery({
    queryKey: ['invites', org],
    queryFn: () => get(`/orgs/${org}/invites`),
    enabled: !!org,
  });
  const reqs = useQuery({
    queryKey: ['joinreqs', org],
    queryFn: () => get(`/orgs/${org}/join-requests`),
    enabled: !!org,
  });
  const mint = useMutation({
    mutationFn: () => post(`/orgs/${org}/invites`, { role }),
    onSuccess: () => {
      toast.success('Invite link created.');
      qc.invalidateQueries({ queryKey: ['invites', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  const copyInvite = async (code) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/onboarding?code=${code}`);
      toast.success('Invite link copied — send it to your members.');
    } catch {
      toast.error('Copy failed — share the code manually instead.');
    }
  };
  const decide = useMutation({
    mutationFn: ({ id, approve, approveRole }) =>
      post(`/orgs/${org}/join-requests/${id}/decide`, { approve, role: approveRole || 'member' }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? 'Request approved — they can sign in now.' : 'Request rejected.');
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ['joinreqs', org] });
      qc.invalidateQueries({ queryKey: ['members', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium">Pending join requests</div>
        {reqs.isLoading && <Skeleton className="h-12" />}
        {reqs.isError && <ErrorState error={reqs.error} retry={reqs.refetch} />}
        {reqs.data?.data.length === 0 && <div className="text-xs text-[var(--color-ink-3)]">none</div>}
        {reqs.data?.data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">{r.display_name}{r.message ? ` — ${r.message}` : ''}</span>
            <span className="flex items-center gap-1">
              <select
                aria-label="Role to grant"
                className="min-h-[36px] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-xs"
                value={approveRoles[r.id] ?? 'member'}
                onChange={(e) => setApproveRoles({ ...approveRoles, [r.id]: e.target.value })}
              >
                <option value="member">member</option>
                <option value="officer">officer</option>
                <option value="adviser">adviser</option>
              </select>
              <Button variant="secondary" className="min-h-[36px] px-2 text-xs"
                      onClick={() => decide.mutate({ id: r.id, approve: true, approveRole: approveRoles[r.id] })}>Approve</Button>
              <Button variant="ghost" className="min-h-[36px] px-2 text-xs" onClick={() => setRejecting(r)}>Reject</Button>
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Invite links</div>
        <div className="text-xs text-[var(--color-ink-3)]">
          Anyone with the link joins instantly at the role you pick — it stops working after 2 days. Share carefully.
        </div>
        {inv.isLoading && <Skeleton className="h-12" />}
        {inv.isError && <ErrorState error={inv.error} retry={inv.refetch} />}
        {inv.data && inv.data.data.length === 0 && (
          <div className="text-xs text-[var(--color-ink-3)]">no active invites</div>
        )}
        <div className="flex gap-2">
          <select className="rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 text-sm"
                  value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="officer">officer</option><option value="adviser">adviser</option><option value="member">member</option>
          </select>
          <Button onClick={() => mint.mutate()} disabled={mint.isPending}>Mint invite</Button>
        </div>
        {inv.data?.data.map((i) => {
          const expired = new Date(i.expires_at) < new Date();
          const usedUp = i.uses >= i.max_uses;
          return (
            <div key={i.id} className={`flex items-center justify-between gap-2 text-xs ${expired || usedUp ? 'opacity-50' : ''}`}>
              <code className="rounded-[var(--radius-input)] bg-[var(--color-surface-3)] px-2 py-1">{i.code}</code>
              <span className="flex items-center gap-1">
                <span className="text-[var(--color-ink-3)]">
                  {i.role} · {i.uses} joined ·{' '}
                  {expired ? 'expired'
                    : usedUp ? 'used up'
                    : `expires ${new Date(i.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                </span>
                {!expired && !usedUp && (
                  <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                          onClick={() => copyInvite(i.code)}>Copy link</Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={() => decide.mutate({ id: rejecting.id, approve: false })}
        busy={decide.isPending}
        title="Reject join request?"
        body={`${rejecting?.display_name} won't be notified automatically — tell them directly if needed.`}
        confirmLabel="Reject"
      />
    </Card>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────
function Audit() {
  const org = currentOrgId();
  const a = useQuery({
    queryKey: ['audit', org],
    queryFn: () => get(`/orgs/${org}/audit?pageSize=50`),
    enabled: !!org,
  });
  if (a.isLoading) return <Skeleton className="h-48" />;
  if (a.error) return <Empty title="Adviser or owner role required" />;
  return (
    <Card>
      <div className="mb-1 text-sm font-medium">Audit log</div>
      <div className="mb-2 text-xs text-[var(--color-ink-3)]">
        Every sensitive change, recorded permanently — append-only.
      </div>
      {a.data && a.data.data.length === 0 && <Empty title="Nothing logged yet" />}
      <div className="divide-y divide-[var(--color-line)] text-xs">
        {a.data?.data.map((r) => (
          <div key={r.id} className="flex justify-between py-1.5">
            <span><span className="font-medium">{r.action}</span> · {r.entity_type}</span>
            <span className="text-[var(--color-ink-3)]">{new Date(r.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
