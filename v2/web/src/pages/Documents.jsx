import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AlertTriangle, FileText, Plus, Route } from 'lucide-react';
import { get, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { autoMatchedChain, collectFlagNames, visibleChainSteps } from '../lib/rules';
import { Button, Card, Chip, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';
import { FlagCheckboxes } from '../components/RuleFields';

/** Live preview of the signatory route a new document will follow. */
function ChainPreview({ chains, docType, overrideId, eventType = null, flags = {} }) {
  const { active } = useOutletContext() ?? {};
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const override = (chains ?? []).find((c) => c.id === overrideId);
  const auto = overrideId ? null : autoMatchedChain(chains, docType);
  const chain = override ?? auto;
  if (!docType && !override) return null;

  if (!chain) {
    return (
      <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-status-alert)] p-3 text-sm text-[var(--color-ink-2)]">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-status-alert)]" />
        <span>
          No signatory chain matches <span className="font-mono">{docType}</span> — this paper
          won't be routed for signatures.{' '}
          {isOwner
            ? <Link to="/settings?tab=chains" className="text-[var(--color-accent)] underline">Add a chain in Settings</Link>
            : 'Ask an owner to add one in Settings.'}{' '}
          <Link to="/guide" className="text-[var(--color-accent)] underline">How matching works</Link>
        </span>
      </div>
    );
  }

  const steps = visibleChainSteps(chain, eventType, flags);
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-3)] p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-[var(--color-ink-2)]">
        <Route size={15} />
        {override ? 'Using' : 'Will route through'}: {chain.name}
      </div>
      {steps.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          This chain has no steps that apply — the document won't route anywhere.
        </p>
      ) : (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-xs text-[var(--color-ink-2)]">
          {steps.map((s) => (
            <li key={s.id}>{s.label}{s.office ? <span className="text-[var(--color-ink-3)]"> — {s.office}</span> : ''}</li>
          ))}
        </ol>
      )}
      {!override && (
        <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
          Matched automatically from the document type. Pick a chain below to override.
        </p>
      )}
    </div>
  );
}

export default function Documents() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { active } = useOutletContext() ?? {};
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', chain_id: '', project_id: '', flags: {} });
  const [typeSel, setTypeSel] = useState('');
  const [customType, setCustomType] = useState('');
  const [err, setErr] = useState(null);

  const docs = useQuery({
    queryKey: ['documents', org],
    queryFn: () => get(`/orgs/${org}/documents?pageSize=100`),
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

  const flagNames = collectFlagNames({ chains: chains.data?.data });
  const knownTypes = [...new Set((chains.data?.data ?? []).map((c) => c.doc_type))].sort();
  const docType = typeSel === '__custom' ? customType.trim() : typeSel;
  const linkedProject = (projects.data?.data ?? []).find((p) => p.id === form.project_id) ?? null;

  // Linking a project pre-ticks its flags (the officer can still untick) —
  // flag-gated steps like "RFP for international webinars" evaluate against
  // the document's own flags plus the project's event type.
  const pickProject = (projectId) => {
    const proj = (projects.data?.data ?? []).find((p) => p.id === projectId);
    setForm((f) => ({
      ...f, project_id: projectId,
      flags: proj ? { ...f.flags, ...(proj.flags ?? {}) } : f.flags,
    }));
  };

  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents`, {
      title: form.title, doc_type: docType, chain_id: form.chain_id || null,
      project_id: form.project_id || null, flags: form.flags,
    }),
    onSuccess: () => {
      toast.success('Document registered — custody log started.');
      setOpen(false); setForm({ title: '', chain_id: '', project_id: '', flags: {} }); setTypeSel(''); setCustomType('');
      qc.invalidateQueries({ queryKey: ['documents', org] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const statusKind = (s) =>
    s === 'signed' ? 'done' : ['routing', 'revision'].includes(s) ? 'pending' : s === 'filed' ? 'skip' : 'neutral';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Papers"
        description="Where physical documents are and who's signing them."
        action={canWrite ? <Button onClick={() => setOpen(true)}><Plus size={16} />New document</Button> : null}
      />
      <HintBanner id="papers">
        This is the digital logbook for physical documents. Register a paper, then record
        every hand-off — the newest entry is where it sits now.
      </HintBanner>
      {docs.isLoading && <Skeleton className="h-48" />}
      {docs.isError && <ErrorState error={docs.error} retry={docs.refetch} />}
      {docs.data?.data.length === 0 && (
        <Empty icon={<FileText size={24} />} title="No documents tracked"
               hint={canWrite
                 ? 'Register a paper to start its custody log.'
                 : 'Papers are registered by officers — ask one to log a document.'}
               action={canWrite ? <Button onClick={() => setOpen(true)}>New document</Button> : null} />
      )}
      <div className="space-y-2">
        {docs.data?.data.map((d) => (
          <Link key={d.id} to={`/documents/${d.id}`}>
            <Card className="flex items-center justify-between hover:border-[var(--color-accent)]">
              <div>
                <div className="text-sm font-medium">{d.title}</div>
                <div className="text-xs text-[var(--color-ink-3)]">{d.doc_type}</div>
              </div>
              <Chip kind={statusKind(d.status)} label={d.status === 'revision' ? 'in revision' : d.status} />
            </Card>
          </Link>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="New document">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="IoT Session concept paper" /></Field>
          <Field label="Document type" hint="Picks the signing route — types that already have chains are listed.">
            <select
              className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
              value={typeSel} onChange={(e) => setTypeSel(e.target.value)}
            >
              <option value="">choose…</option>
              {knownTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__custom">custom…</option>
            </select>
          </Field>
          {typeSel === '__custom' && (
            <Field label="Custom doc type" hint="No preset — it only routes if a chain with this exact type exists.">
              <Input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="leave_request" />
            </Field>
          )}
          <Field label="Project (optional)"
                 hint="Lets steps that only apply to a certain event type fire — e.g. the RFP desk for international webinars.">
            <select
              className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
              value={form.project_id} onChange={(e) => pickProject(e.target.value)}
            >
              <option value="">not tied to a project</option>
              {(projects.data?.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}{p.event_type ? ` (${p.event_type})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <FlagCheckboxes flagNames={flagNames} value={form.flags}
                          onChange={(flags) => setForm({ ...form, flags })}
                          hint="These checkboxes exist because a chain step looks for them — tick what applies to this paper." />
          <ChainPreview chains={chains.data?.data} docType={docType} overrideId={form.chain_id || null}
                        eventType={linkedProject?.event_type ?? null} flags={form.flags} />
          <Field label="Override chain (optional)">
            <select className="min-h-[44px] w-full rounded-[var(--radius-input)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={form.chain_id} onChange={(e) => setForm({ ...form, chain_id: e.target.value })}>
              <option value="">auto-match by type</option>
              {chains.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={() => create.mutate()} disabled={!form.title || !docType || create.isPending}>
            Register document
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
