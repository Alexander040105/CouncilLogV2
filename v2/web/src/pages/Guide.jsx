import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Download, Library, Lightbulb } from 'lucide-react';
import { get, post } from '../lib/api';
import { atLeast, currentOrgId } from '../lib/org';
import { describeCondition, describeItemRule } from '../lib/rules';
import { STARTER_CHAINS, STARTER_CONTACTS, STARTER_TEMPLATES } from '../lib/starterPack';
import { useToast } from '../lib/toast';
import { Button, Card, PageHeader, Sheet } from '../components/ui';

/** The Guide — Read-mode page: how chains, templates, and flags actually
 *  work, plus the starter library of worked examples owners can install. */

const Section = ({ id, title, children }) => (
  <section id={id} className="space-y-3 scroll-mt-4">
    <h2 className="heading-strong text-lg">{title}</h2>
    {children}
  </section>
);

const P = ({ children }) => <p className="text-sm text-[var(--color-ink-2)]">{children}</p>;

const RULES = [
  'A paper routes by its document type matching a chain\u2019s doc type exactly — "Concept Paper" is not "concept_paper". Two chains on the same type? The alphabetically-first name wins; the override picker on the register sheet exists for a reason.',
  'A template lands on a project when the track matches its needs (papers / logistics / both) AND the event types match — or the template has no event type, which means "every event".',
  'A project with a blank event type only picks up untyped templates.',
  'Flag-gated items and steps need the matching checkbox ticked on the project or document — and the checkbox only exists because some template or chain uses that flag name.',
  '"Only for event type" steps need the document linked to a project with that event type — that\u2019s why the register sheet asks for a project.',
  '"Due N days before/after the event" only computes when the project has a target date.',
  'Conditions are read once, at creation. Editing a template later never rewrites a live checklist or a routed paper — that\u2019s the snapshot guarantee. To fix a live checklist, edit its items directly.',
  'Steps aren\u2019t a gate — any officer can mark any pending step; it\u2019s a custody record. Skipping needs a reason. Sent-back papers open a new round; nothing is ever erased.',
  'A paper registered with no matching chain still gets its custody log — attach a chain later from its detail page.',
  'New orgs start empty. The library below is a set of examples — adding one creates a completely ordinary template or chain you can edit or delete. Nothing loaded is locked or special.',
  'Standardize doc type and event type spellings early — matching is literal strings ("webinar_intl", not "intl-webinar").',
];

function StepList({ steps }) {
  return (
    <ol className="ml-5 list-decimal space-y-0.5 text-xs text-[var(--color-ink-2)]">
      {steps.map((s) => {
        const cond = describeCondition(s.condition_json);
        return (
          <li key={s.ord}>
            {s.label}{s.office && <span className="text-[var(--color-ink-3)]"> — {s.office}</span>}
            {cond && <span className="block text-[var(--color-ink-3)]">{cond}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ItemList({ items }) {
  return (
    <ul className="ml-5 list-disc space-y-0.5 text-xs text-[var(--color-ink-2)]">
      {items.map((i) => {
        const rule = describeItemRule(i.rule_json);
        return (
          <li key={i.ord}>
            {i.label}{i.required === false ? ' (optional)' : ''}
            {i.hint && <span className="block text-[var(--color-ink-3)]">{i.hint}</span>}
            {rule && <span className="block text-[var(--color-ink-3)]">{rule}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** One library entry — expandable, browsable by all, installable by owner. */
function LibraryEntry({ kind, entry, present, isOwner, onInstall }) {
  const title = kind === 'contact' ? entry.label : entry.name;
  const meta = kind === 'chain'
    ? `doc type "${entry.doc_type}"`
    : kind === 'template'
      ? `${entry.track} track${entry.event_type ? ` · ${entry.event_type} events` : ' · any event'}`
      : entry.category;
  return (
    <details className="group rounded-[var(--radius-card)] [border:var(--border-box)]">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 p-3 marker:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-[var(--color-ink-3)]">
            {kind} · {meta}
          </span>
        </span>
        <span className="shrink-0 text-xs text-[var(--color-accent)] group-open:hidden">show</span>
        <span className="hidden shrink-0 text-xs text-[var(--color-ink-3)] group-open:block">hide</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {entry.why && (
          <p className="flex items-start gap-1.5 text-xs text-[var(--color-ink-3)]">
            <Lightbulb size={14} className="mt-0.5 shrink-0" />
            <span><span className="font-medium">Why it\u2019s built this way:</span> {entry.why}</span>
          </p>
        )}
        {kind === 'chain' && <StepList steps={entry.steps} />}
        {kind === 'template' && <ItemList items={entry.items} />}
        {kind === 'contact' && <p className="text-xs text-[var(--color-ink-2)]">{entry.value}</p>}
        <div className="pt-1">
          {present ? (
            <Link to={kind === 'chain' ? '/settings?tab=chains'
                      : kind === 'template' ? '/settings?tab=templates'
                      : '/settings?tab=contacts'}
                  className="text-xs text-[var(--color-accent)] underline">
              Already in your org — edit it in Settings
            </Link>
          ) : isOwner ? (
            <Button variant="secondary" className="text-xs" onClick={() => onInstall(kind, entry)}>
              <Download size={14} />Add to my org
            </Button>
          ) : (
            <p className="text-xs text-[var(--color-ink-3)]">Owners can add this to the org.</p>
          )}
        </div>
      </div>
    </details>
  );
}

export default function Guide() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { active } = useOutletContext() ?? {};
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const [preview, setPreview] = useState(null); // {kind, entry}

  const templates = useQuery({ queryKey: ['templates', org], queryFn: () => get(`/orgs/${org}/checklist-templates`), enabled: !!org });
  const chains = useQuery({ queryKey: ['chains', org], queryFn: () => get(`/orgs/${org}/signatory-chains`), enabled: !!org });
  const contacts = useQuery({ queryKey: ['contacts', org], queryFn: () => get(`/orgs/${org}/contacts`), enabled: !!org });

  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const existing = {
    chain: new Set((chains.data?.data ?? []).map((c) => norm(c.name))),
    template: new Set((templates.data?.data ?? []).map((t) => norm(t.name))),
    contact: new Set((contacts.data?.data ?? []).map((c) => norm(c.label))),
  };
  const isPresent = (kind, entry) =>
    existing[kind].has(norm(kind === 'contact' ? entry.label : entry.name));

  const payload = (kind, entry, ord) => {
    if (kind === 'chain') return { name: entry.name, doc_type: entry.doc_type, steps: entry.steps };
    if (kind === 'template') {
      return {
        name: entry.name, track: entry.track, event_type: entry.event_type,
        items: entry.items.map((i) => ({
          ord: i.ord, label: i.label, hint: i.hint ?? null,
          required: i.required ?? true, rule_json: i.rule_json ?? null,
        })),
      };
    }
    return { label: entry.label, value: entry.value, category: entry.category ?? null, ord: ord ?? 0 };
  };
  const endpoint = (kind) =>
    kind === 'chain' ? 'signatory-chains' : kind === 'template' ? 'checklist-templates' : 'contacts';
  const destTab = (kind) =>
    kind === 'chain' ? 'chains' : kind === 'template' ? 'templates' : 'contacts';

  const install = useMutation({
    mutationFn: async (entries) => {
      for (const { kind, entry, ord } of entries) {
        await post(`/orgs/${org}/${endpoint(kind)}`, payload(kind, entry, ord));
      }
      return entries.length;
    },
    onSuccess: (n) => {
      toast.success(`Added ${n} ${n === 1 ? 'entry' : 'entries'} — yours now; edit in Settings.`);
      setPreview(null);
      for (const k of ['templates', 'chains', 'contacts']) qc.invalidateQueries({ queryKey: [k, org] });
    },
    onError: (e) => toast.error(e.message),
  });

  const missing = [
    ...STARTER_CHAINS.map((e) => ({ kind: 'chain', entry: e })),
    ...STARTER_TEMPLATES.map((e) => ({ kind: 'template', entry: e })),
    ...STARTER_CONTACTS.map((e, i) => ({ kind: 'contact', entry: e, ord: i })),
  ].filter(({ kind, entry }) => !isPresent(kind, entry));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Guide"
        description="How chains, templates, and flags actually work — plus worked examples you can load and adapt."
      />

      <Section title="What these things are">
        <Card className="space-y-2">
          <P>
            A <span className="font-medium">signatory chain</span> is the route a paper takes — who signs it,
            in order, and where each desk physically is. Register a document and its chain attaches automatically.
          </P>
          <P>
            A <span className="font-medium">checklist template</span> is a reusable to-do list. When a project
            is created (or its checklist generated), every matching template's items are copied onto it.
          </P>
          <P>
            Both are <span className="font-medium">copies</span>: what lands on your project or paper is a
            snapshot. Editing the template later never rewrites what's already running — and deleting a
            template never deletes a project's checklist.
          </P>
        </Card>
      </Section>

      <Section title="How matching actually works">
        <Card>
          <ul className="ml-5 list-disc space-y-1.5 text-sm text-[var(--color-ink-2)]">
            {RULES.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Card>
      </Section>

      <Section id="library" title="Starter library">
        <P>
          Worked examples — chains, checklist templates, and a who-to-ask directory built with generic
          names you adapt to your org. Expand any entry to read its full contents and why it's built
          that way; owners can add it to this org with one tap, then edit or delete it like anything hand-typed.
        </P>
        {isOwner && missing.length > 0 && (
          <Button variant="secondary" onClick={() => install.mutate(missing)} disabled={install.isPending}>
            <Library size={16} />{install.isPending ? 'Adding…' : `Add everything (${missing.length})`}
          </Button>
        )}
        {isOwner && missing.length === 0 && (
          <p className="text-xs text-[var(--color-ink-3)]">Everything in the library is already in your org.</p>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="label-strong text-xs text-[var(--color-ink-3)]">Signatory chains</div>
            {STARTER_CHAINS.map((e) => (
              <LibraryEntry key={e.name} kind="chain" entry={e}
                            present={isPresent('chain', e)} isOwner={isOwner}
                            onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
            ))}
          </div>
          <div className="space-y-2">
            <div className="label-strong text-xs text-[var(--color-ink-3)]">Checklist templates</div>
            {STARTER_TEMPLATES.map((e) => (
              <LibraryEntry key={e.name} kind="template" entry={e}
                            present={isPresent('template', e)} isOwner={isOwner}
                            onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
            ))}
          </div>
          <div className="space-y-2">
            <div className="label-strong text-xs text-[var(--color-ink-3)]">Who-to-ask contacts</div>
            {STARTER_CONTACTS.map((e) => (
              <LibraryEntry key={e.label} kind="contact" entry={e}
                            present={isPresent('contact', e)} isOwner={isOwner}
                            onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Building a chain, step by step">
        <Card className="space-y-2">
          <ol className="ml-5 list-decimal space-y-1 text-sm text-[var(--color-ink-2)]">
            <li>Settings → chains → New chain. Name it after the route, e.g. "Standard Concept Paper".</li>
            <li>Doc type is the match key — use the same spelling everywhere: <span className="font-mono text-xs">concept_paper</span>.</li>
            <li>Add steps in signing order, top to bottom. Fill the office so officers know where to physically walk.</li>
            <li>Mark steps "only for event type…" or "only when flag…" when they're not always on the route.</li>
          </ol>
          <P>
            Worked example: the <span className="font-medium">Standard Concept Paper</span> entry above — notice
            the RFP step is a <span className="font-medium">condition</span>, not a separate chain, because the
            route is identical except for that one office.
          </P>
        </Card>
      </Section>

      <Section title="Building a template, step by step">
        <Card className="space-y-2">
          <ol className="ml-5 list-decimal space-y-1 text-sm text-[var(--color-ink-2)]">
            <li>Settings → templates → New template. Name it after the work, e.g. "Concept Paper Pack".</li>
            <li>Pick the track: paper, logistics, or both — that's what a project asks for.</li>
            <li>Scope to an event type only if it should never land elsewhere — blank means every event.</li>
            <li>Add items in order. Hints teach; optional marks a reminder; "when" and "due" rules handle the "only sometimes" and "by then" cases.</li>
          </ol>
          <P>
            Worked example: the <span className="font-medium">Outside Event Pack</span> — its items use the
            <span className="font-mono text-xs"> off_campus </span> flag instead of an event type, so one
            checkbox covers outside events and educ tours alike.
          </P>
        </Card>
      </Section>

      <Section title="Troubleshooting">
        <Card>
          <ul className="space-y-2 text-sm text-[var(--color-ink-2)]">
            <li><span className="font-medium">"My project generated nothing."</span> The checklist card says why —
              no tracks ticked, no templates yet, track mismatch, event-type mismatch, or every item filtered by
              its rules. Fix the template or use the force-pick below the preview.</li>
            <li><span className="font-medium">"My paper didn't route."</span> Check the doc type spelling matches
              a chain exactly, then attach a chain from the paper's detail page.</li>
            <li><span className="font-medium">"A step/item didn't appear."</span> It was filtered out at creation —
              event type didn't match or its flag wasn't ticked. Recheck flags on the project or document.</li>
            <li><span className="font-medium">"I edited the template but the project didn't change."</span> Working
              as intended — live checklists are snapshots. Edit the project's items directly.</li>
          </ul>
        </Card>
        <P>
          Owners build and edit these in <Link to="/settings?tab=templates" className="text-[var(--color-accent)] underline">Settings</Link>;
          everyone else reads here.
        </P>
      </Section>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title="Add to my org">
        {preview && (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">{preview.kind === 'contact' ? preview.entry.label : preview.entry.name}</div>
              <div className="text-xs text-[var(--color-ink-3)]">{preview.kind}</div>
            </div>
            {preview.entry.why && <p className="text-xs text-[var(--color-ink-3)]">{preview.entry.why}</p>}
            {preview.kind === 'chain' && <StepList steps={preview.entry.steps} />}
            {preview.kind === 'template' && <ItemList items={preview.entry.items} />}
            {preview.kind === 'contact' && <p className="text-xs text-[var(--color-ink-2)]">{preview.entry.value}</p>}
            <p className="text-xs text-[var(--color-ink-3)]">
              This is a starting point — load it, then change whatever doesn't fit.
              <Link to={`/settings?tab=${destTab(preview.kind)}`} className="text-[var(--color-accent)] underline"> It'll show up here.</Link>
            </p>
            <Button className="w-full" disabled={install.isPending}
                    onClick={() => install.mutate([{
                      ...preview,
                      ord: preview.kind === 'contact' ? STARTER_CONTACTS.indexOf(preview.entry) : 0,
                    }])}>
              {install.isPending ? 'Adding…' : 'Add to my org'}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
