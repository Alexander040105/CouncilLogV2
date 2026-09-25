import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Card, ConfirmDialog, Empty, Field, HintBanner, Input, PageHeader, Skeleton, ThemeToggle } from '../components/ui';
import { MemberManager } from '../components/MemberManager';

const TABS = ['members', 'positions', 'duty', 'templates', 'chains', 'contacts', 'invites', 'audit'];

export default function Settings() {
  const [tab, setTab] = useState('positions');
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
            <ThemeToggle />
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

      <div className="flex flex-wrap gap-1 rounded border border-[var(--color-line)] p-0.5 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={`min-h-[36px] rounded px-3 py-1 capitalize ${tab === t ? 'bg-[var(--color-surface-3)] font-semibold' : 'text-[var(--color-ink-3)]'}`}>
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
      {tab === 'positions' && <Positions />}
      {tab === 'duty' && <Duty />}
      {tab === 'templates' && <Templates />}
      {tab === 'chains' && <Chains />}
      {tab === 'contacts' && <Contacts />}
      {tab === 'invites' && <Invites />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

// ── Positions ───────────────────────────────────────────────────────────
function Positions() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [holder, setHolder] = useState('');
  const pos = useQuery({
    queryKey: ['positions', org],
    queryFn: () => get(`/orgs/${org}/positions`),
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members`),
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
      <div className="flex gap-2">
        <Input placeholder="Position title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
                value={holder} onChange={(e) => setHolder(e.target.value)}>
          <option value="">holder…</option>
          {members.data?.data.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
        </select>
        <Button onClick={() => add.mutate()} disabled={!title || add.isPending}>Add</Button>
      </div>
    </Card>
  );
}

// ── Duty schedule ────────────────────────────────────────────────────────
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function Duty() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const duty = useQuery({
    queryKey: ['duty', org],
    queryFn: () => get(`/orgs/${org}/duty-schedule`),
  });
  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members`),
  });
  const save = useMutation({
    mutationFn: (schedule) => put(`/orgs/${org}/duty-schedule`, { schedule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duty', org] }),
    onError: (e) => toast.error(e.message),
  });

  if (duty.isLoading || members.isLoading) return <Skeleton className="h-48" />;
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
              <tr key={m.user_id} className="border-t border-[var(--color-line)]">
                <td className="p-1 font-medium">{m.display_name}</td>
                {WD.map((_, d) => {
                  const on = (schedule[String(d)] ?? schedule[d] ?? []).includes(m.user_id);
                  return (
                    <td key={d} className="p-1">
                      <input type="checkbox" checked={on} onChange={() => toggle(d, m.user_id)} className="h-4 w-4" />
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
function Templates() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [track, setTrack] = useState('paper');
  const [items, setItems] = useState('');
  const t = useQuery({
    queryKey: ['templates', org],
    queryFn: () => get(`/orgs/${org}/checklist-templates`),
  });
  const add = useMutation({
    mutationFn: () => post(`/orgs/${org}/checklist-templates`, {
      name, track,
      items: items.split('\n').filter(Boolean).map((label, i) => ({ ord: i + 1, label })),
    }),
    onSuccess: () => {
      toast.success('Template created.');
      setName(''); setItems('');
      qc.invalidateQueries({ queryKey: ['templates', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">Checklist templates</div>
      <div className="text-xs text-[var(--color-ink-3)]">
        Reusable step lists. When a project matches, these become its checklist.
      </div>
      {t.isLoading && <Skeleton className="h-24" />}
      {t.data && t.data.data.length === 0 && (
        <Empty title="No templates" hint="e.g. a paper-processing checklist for events." />
      )}
      {t.data?.data.map((x) => (
        <div key={x.id} className="rounded border border-[var(--color-line)] p-2">
          <div className="text-sm font-medium">{x.name} <span className="text-xs text-[var(--color-ink-3)]">· {x.track}</span></div>
          <ul className="ml-4 list-disc text-xs text-[var(--color-ink-2)]">
            {x.items.map((i, k) => <li key={k}>{i.label}</li>)}
          </ul>
        </div>
      ))}
      <Field label="New template name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Track" hint="paper = signatory-routed docs · logistics = venue/equipment · both">
        <select className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
                value={track} onChange={(e) => setTrack(e.target.value)}>
          <option value="paper">paper</option><option value="logistics">logistics</option><option value="both">both</option>
        </select>
      </Field>
      <Field label="Items (one per line)">
        <textarea className="min-h-24 w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2 text-sm"
                  value={items} onChange={(e) => setItems(e.target.value)} />
      </Field>
      <Button onClick={() => add.mutate()} disabled={!name || !items || add.isPending}>Create template</Button>
    </Card>
  );
}

// ── Signatory chains ─────────────────────────────────────────────────────
function Chains() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [docType, setDocType] = useState('');
  const [steps, setSteps] = useState('');
  const c = useQuery({
    queryKey: ['chains', org],
    queryFn: () => get(`/orgs/${org}/signatory-chains`),
  });
  const add = useMutation({
    mutationFn: () => post(`/orgs/${org}/signatory-chains`, {
      name, doc_type: docType,
      steps: steps.split('\n').filter(Boolean).map((label, i) => ({ ord: i + 1, label })),
    }),
    onSuccess: () => {
      toast.success('Chain created.');
      setName(''); setDocType(''); setSteps('');
      qc.invalidateQueries({ queryKey: ['chains', org] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">Signatory chains</div>
      <div className="text-xs text-[var(--color-ink-3)]">
        Who signs a document, in order. New documents auto-pick the chain matching their type.
      </div>
      {c.isLoading && <Skeleton className="h-24" />}
      {c.data && c.data.data.length === 0 && (
        <Empty title="No chains" hint="e.g. Concept paper → Adviser → SAS → School Director." />
      )}
      {c.data?.data.map((x) => (
        <div key={x.id} className="rounded border border-[var(--color-line)] p-2">
          <div className="text-sm font-medium">{x.name} <span className="text-xs text-[var(--color-ink-3)]">· {x.doc_type}</span></div>
          <ol className="ml-4 list-decimal text-xs text-[var(--color-ink-2)]">
            {x.steps.map((s, k) => <li key={k}>{s.label}</li>)}
          </ol>
        </div>
      ))}
      <Field label="Chain name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Doc type"><Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="concept_paper" /></Field>
      <Field label="Steps in order (one per line)">
        <textarea className="min-h-24 w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2 text-sm"
                  value={steps} onChange={(e) => setSteps(e.target.value)}
                  placeholder={'SSC President\nSAS routing\nSchool Director'} />
      </Field>
      <Button onClick={() => add.mutate()} disabled={!name || !docType || !steps || add.isPending}>Create chain</Button>
    </Card>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────
function Contacts() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const c = useQuery({
    queryKey: ['contacts', org],
    queryFn: () => get(`/orgs/${org}/contacts`),
  });
  const add = useMutation({
    mutationFn: () => post(`/orgs/${org}/contacts`, { label, value }),
    onSuccess: () => {
      toast.success('Contact added.');
      setLabel(''); setValue('');
      qc.invalidateQueries({ queryKey: ['contacts', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">Quick reference — who to ask</div>
      {c.isLoading && <Skeleton className="h-16" />}
      {c.data && c.data.data.length === 0 && (
        <Empty title="No contacts" hint="e.g. Concept papers → SAS office, 2nd floor." />
      )}
      {c.data?.data.map((x) => (
        <div key={x.id} className="flex justify-between border-b border-[var(--color-line)] py-1 text-sm">
          <span>{x.label}</span><span className="text-[var(--color-ink-3)]">{x.value}</span>
        </div>
      ))}
      <div className="flex gap-2">
        <Input placeholder="Need" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input placeholder="Who / where" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={!label || !value || add.isPending}>Add</Button>
      </div>
    </Card>
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
  });
  const reqs = useQuery({
    queryKey: ['joinreqs', org],
    queryFn: () => get(`/orgs/${org}/join-requests`),
  });
  const mint = useMutation({
    mutationFn: () => post(`/orgs/${org}/invites`, { role }),
    onSuccess: () => {
      toast.success('Invite link created.');
      qc.invalidateQueries({ queryKey: ['invites', org] });
    },
    onError: (e) => toast.error(e.message),
  });
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
        {reqs.data?.data.length === 0 && <div className="text-xs text-[var(--color-ink-3)]">none</div>}
        {reqs.data?.data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">{r.display_name}{r.message ? ` — ${r.message}` : ''}</span>
            <span className="flex items-center gap-1">
              <select
                aria-label="Role to grant"
                className="min-h-[36px] rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-xs"
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
          Anyone with a code joins instantly at the role you pick — share carefully.
        </div>
        {inv.isLoading && <Skeleton className="h-12" />}
        {inv.data && inv.data.data.length === 0 && (
          <div className="text-xs text-[var(--color-ink-3)]">no active invites</div>
        )}
        <div className="flex gap-2">
          <select className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
                  value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="officer">officer</option><option value="adviser">adviser</option><option value="member">member</option>
          </select>
          <Button onClick={() => mint.mutate()} disabled={mint.isPending}>Mint invite</Button>
        </div>
        {inv.data?.data.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-xs">
            <code className="rounded bg-[var(--color-surface-3)] px-2 py-1">{i.code}</code>
            <span className="text-[var(--color-ink-3)]">{i.role} · {i.uses}/{i.max_uses} uses</span>
          </div>
        ))}
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
