/** Port of web/pages/Guide.jsx — Read-mode explainer + starter library.
 *  <details> becomes a Pressable expand toggle; same install flow. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Library, Lightbulb } from 'lucide-react-native';
import { get, post } from '../../src/lib/api';
import { atLeast, useOrgId } from '../../src/lib/org';
import { describeCondition, describeItemRule } from '../../src/lib/rules';
import { docTypeLabel, humanize } from '../../src/lib/labels';
import { STARTER_CHAINS, STARTER_CONTACTS, STARTER_TEMPLATES } from '../../src/lib/starterPack';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { Button, Card, ErrorState, PageHeader, Screen, Sheet, Skeleton } from '../../src/components/ui';

const Section = ({ title, children }) => {
  const { t } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: t.headingWeight, color: t.ink }}>{title}</Text>
      {children}
    </View>
  );
};

const P = ({ children }) => {
  const { t } = useTheme();
  return <Text style={{ fontSize: 14, color: t.ink2 }}>{children}</Text>;
};

const Group = ({ title, children }) => {
  const { t } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink3 }}>{title}</Text>
      {children}
    </View>
  );
};

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
  const { t } = useTheme();
  return (
    <View style={{ marginLeft: 12, gap: 2 }}>
      {steps.map((s) => {
        const cond = describeCondition(s.condition_json);
        return (
          <Text key={s.ord} style={{ fontSize: 12, color: t.ink2 }}>
            {s.ord}. {s.label}{s.office ? <Text style={{ color: t.ink3 }}> — {s.office}</Text> : null}
            {cond ? <Text style={{ color: t.ink3 }}>{'\n   '}{cond}</Text> : null}
          </Text>
        );
      })}
    </View>
  );
}

function ItemList({ items }) {
  const { t } = useTheme();
  return (
    <View style={{ marginLeft: 12, gap: 2 }}>
      {items.map((i) => {
        const rule = describeItemRule(i.rule_json);
        return (
          <Text key={i.ord} style={{ fontSize: 12, color: t.ink2 }}>
            • {i.label}{i.required === false ? ' (optional)' : ''}
            {i.hint ? <Text style={{ color: t.ink3 }}>{'\n   '}{i.hint}</Text> : null}
            {rule ? <Text style={{ color: t.ink3 }}>{'\n   '}{rule}</Text> : null}
          </Text>
        );
      })}
    </View>
  );
}

/** One library entry — expandable, browsable by all, installable by owner. */
function LibraryEntry({ kind, entry, present, isOwner, onInstall }) {
  const { t } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const title = kind === 'contact' ? entry.label : entry.name;
  const meta = kind === 'chain'
    ? `doc type "${docTypeLabel(entry.doc_type)}"`
    : kind === 'template'
      ? `${humanize(entry.track)} track${entry.event_type ? ` · ${humanize(entry.event_type)} events` : ' · any event'}`
      : entry.category;
  const settingsTab = kind === 'chain' ? 'chains' : kind === 'template' ? 'templates' : 'contacts';
  return (
    <View style={{ borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor }}>
      <Pressable
        accessibilityRole="button" accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 12 }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{title}</Text>
          <Text style={{ fontSize: 12, color: t.ink3 }}>{kind} · {meta}</Text>
        </View>
        <Text style={{ fontSize: 12, color: open ? t.ink3 : t.brand }}>{open ? 'hide' : 'show'}</Text>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
          {entry.why ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <Lightbulb size={14} color={t.ink3} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12, color: t.ink3 }}>
                <Text style={{ fontWeight: '700' }}>Why it’s built this way: </Text>{entry.why}
              </Text>
            </View>
          ) : null}
          {kind === 'chain' ? <StepList steps={entry.steps} /> : null}
          {kind === 'template' ? <ItemList items={entry.items} /> : null}
          {kind === 'contact' ? <Text style={{ fontSize: 12, color: t.ink2 }}>{entry.value}</Text> : null}
          <View style={{ paddingTop: 4 }}>
            {present ? (
              <Pressable accessibilityRole="link" onPress={() => router.push(`/settings?tab=${settingsTab}`)} style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, color: t.brand, textDecorationLine: 'underline' }}>Already in your org — edit it in Settings</Text>
              </Pressable>
            ) : isOwner ? (
              <Button variant="secondary" onPress={() => onInstall(kind, entry)}>
                <Download size={14} color={t.ink} /><Text style={{ fontSize: 12, color: t.ink, fontWeight: '700' }}>Add to my org</Text>
              </Button>
            ) : (
              <Text style={{ fontSize: 12, color: t.ink3 }}>Owners can add this to the org.</Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function Guide() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const [preview, setPreview] = useState(null); // {kind, entry}

  const templates = useQuery({ queryKey: ['templates', org], queryFn: () => get(`/orgs/${org}/checklist-templates`), enabled: !!org });
  const chains = useQuery({ queryKey: ['chains', org], queryFn: () => get(`/orgs/${org}/signatory-chains`), enabled: !!org });
  const contacts = useQuery({ queryKey: ['contacts', org], queryFn: () => get(`/orgs/${org}/contacts`), enabled: !!org });

  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const existing = {
    chain: new Set((chains.data?.data ?? []).map((c) => norm(c.name))),
    template: new Set((templates.data?.data ?? []).map((x) => norm(x.name))),
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
    <Screen>
      <PageHeader
        title="Guide"
        description="How chains, templates, and flags actually work — plus worked examples you can load and adapt."
      />

      <Section title="What these things are">
        <Card style={{ gap: 8 }}>
          <P>
            A signatory chain is the route a paper takes — who signs it,
            in order, and where each desk physically is. Register a document and its chain attaches automatically.
          </P>
          <P>
            A checklist template is a reusable to-do list. When a project
            is created (or its checklist generated), every matching template’s items are copied onto it.
          </P>
          <P>
            Both are copies: what lands on your project or paper is a
            snapshot. Editing the template later never rewrites what’s already running — and deleting a
            template never deletes a project’s checklist.
          </P>
        </Card>
      </Section>

      <Section title="How matching actually works">
        <Card>
          <View style={{ marginLeft: 12, gap: 6 }}>
            {RULES.map((r, i) => <Text key={i} style={{ fontSize: 13, color: t.ink2 }}>• {r}</Text>)}
          </View>
        </Card>
      </Section>

      <Section title="Starter library">
        <P>
          Worked examples — chains, checklist templates, and a who-to-ask directory built with generic
          names you adapt to your org. Expand any entry to read its full contents and why it’s built
          that way; owners can add it to this org with one tap, then edit or delete it like anything hand-typed.
        </P>
        {templates.isLoading || chains.isLoading || contacts.isLoading ? (
          <Skeleton style={{ height: 160 }} />
        ) : null}
        {templates.isError || chains.isError || contacts.isError ? (
          <ErrorState
            error={templates.error ?? chains.error ?? contacts.error}
            retry={() => { templates.refetch(); chains.refetch(); contacts.refetch(); }}
            what="starter settings"
          />
        ) : null}
        {templates.isSuccess && chains.isSuccess && contacts.isSuccess ? (
          <>
            {isOwner && missing.length > 0 ? (
              <Button variant="secondary" onPress={() => install.mutate(missing)} disabled={install.isPending} busy={install.isPending}>
                <Library size={16} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{`Add everything (${missing.length})`}</Text>
              </Button>
            ) : null}
            {isOwner && missing.length === 0 ? (
              <Text style={{ fontSize: 12, color: t.ink3 }}>Everything in the library is already in your org.</Text>
            ) : null}
            <Group title="Signatory chains">
              {STARTER_CHAINS.map((e) => (
                <LibraryEntry key={e.name} kind="chain" entry={e}
                              present={isPresent('chain', e)} isOwner={isOwner}
                              onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
              ))}
            </Group>
            <Group title="Checklist templates">
              {STARTER_TEMPLATES.map((e) => (
                <LibraryEntry key={e.name} kind="template" entry={e}
                              present={isPresent('template', e)} isOwner={isOwner}
                              onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
              ))}
            </Group>
            <Group title="Who-to-ask contacts">
              {STARTER_CONTACTS.map((e) => (
                <LibraryEntry key={e.label} kind="contact" entry={e}
                              present={isPresent('contact', e)} isOwner={isOwner}
                              onInstall={(k, en) => setPreview({ kind: k, entry: en })} />
              ))}
            </Group>
          </>
        ) : null}
      </Section>

      <Section title="Building a chain, step by step">
        <Card style={{ gap: 8 }}>
          <View style={{ marginLeft: 12, gap: 4 }}>
            {[
              'Settings → chains → New chain. Name it after the route, e.g. "Standard Concept Paper".',
              'Doc type is the match key — use the same spelling everywhere: concept_paper.',
              'Add steps in signing order, top to bottom. Fill the office so officers know where to physically walk.',
              'Mark steps "only for event type…" or "only when flag…" when they\'re not always on the route.',
            ].map((s, i) => <Text key={i} style={{ fontSize: 13, color: t.ink2 }}>{i + 1}. {s}</Text>)}
          </View>
          <P>
            Worked example: the Standard Concept Paper entry above — notice
            the RFP step is a condition, not a separate chain, because the
            route is identical except for that one office.
          </P>
        </Card>
      </Section>

      <Section title="Building a template, step by step">
        <Card style={{ gap: 8 }}>
          <View style={{ marginLeft: 12, gap: 4 }}>
            {[
              'Settings → templates → New template. Name it after the work, e.g. "Concept Paper Pack".',
              'Pick the track: paper, logistics, or both — that\'s what a project asks for.',
              'Scope to an event type only if it should never land elsewhere — blank means every event.',
              'Add items in order. Hints teach; optional marks a reminder; "when" and "due" rules handle the "only sometimes" and "by then" cases.',
            ].map((s, i) => <Text key={i} style={{ fontSize: 13, color: t.ink2 }}>{i + 1}. {s}</Text>)}
          </View>
          <P>
            Worked example: the Outside Event Pack — its items use the
            off_campus flag instead of an event type, so one
            checkbox covers outside events and educ tours alike.
          </P>
        </Card>
      </Section>

      <Section title="Troubleshooting">
        <Card style={{ gap: 8 }}>
          {[
            ['"My project generated nothing."', ' The checklist card says why — no tracks ticked, no templates yet, track mismatch, event-type mismatch, or every item filtered by its rules. Fix the template or use the force-pick below the preview.'],
            ['"My paper didn\'t route."', ' Check the doc type spelling matches a chain exactly, then attach a chain from the paper\'s detail page.'],
            ['"A step/item didn\'t appear."', ' It was filtered out at creation — event type didn\'t match or its flag wasn\'t ticked. Recheck flags on the project or document.'],
            ['"I edited the template but the project didn\'t change."', ' Working as intended — live checklists are snapshots. Edit the project\'s items directly.'],
          ].map(([lead, rest], i) => (
            <Text key={i} style={{ fontSize: 13, color: t.ink2 }}>
              <Text style={{ fontWeight: '700' }}>{lead}</Text>{rest}
            </Text>
          ))}
        </Card>
        <P>
          Owners build and edit these in Settings; everyone else reads here.
        </P>
      </Section>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title="Add to my org">
        {preview ? (
          <View style={{ gap: 12 }}>
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{preview.kind === 'contact' ? preview.entry.label : preview.entry.name}</Text>
              <Text style={{ fontSize: 12, color: t.ink3 }}>{preview.kind}</Text>
            </View>
            {preview.entry.why ? <Text style={{ fontSize: 12, color: t.ink3 }}>{preview.entry.why}</Text> : null}
            {preview.kind === 'chain' ? <StepList steps={preview.entry.steps} /> : null}
            {preview.kind === 'template' ? <ItemList items={preview.entry.items} /> : null}
            {preview.kind === 'contact' ? <Text style={{ fontSize: 12, color: t.ink2 }}>{preview.entry.value}</Text> : null}
            <Text style={{ fontSize: 12, color: t.ink3 }}>
              This is a starting point — load it, then change whatever doesn’t fit.
            </Text>
            <Button style={{ width: '100%' }} disabled={install.isPending} busy={install.isPending}
                    onPress={() => install.mutate([{
                      ...preview,
                      ord: preview.kind === 'contact' ? STARTER_CONTACTS.indexOf(preview.entry) : 0,
                    }])}>
              Add to my org
            </Button>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
