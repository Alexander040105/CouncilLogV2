/** Port of web/pages/Settings.jsx — org structure, templates, chains,
 *  contacts, invites, audit + danger zone. Tabs live in the ?tab= param so
 *  guide/settings link-outs land on the right pane. */
import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus } from 'lucide-react-native';
import { get, post, put, del as delApi } from '../../src/lib/api';
import { atLeast, setCurrentOrg, useOrgId } from '../../src/lib/org';
import { collectFlagNames, describeCondition, describeItemRule } from '../../src/lib/rules';
import { docTypeLabel, humanize } from '../../src/lib/labels';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { Button, Card, ConfirmDialog, Empty, ErrorState, HintBanner, Input, PageHeader, Screen, Select, Skeleton, ThemePicker } from '../../src/components/ui';
import { MemberManager } from '../../src/components/MemberManager';
import { TemplateEditor } from '../../src/components/TemplateEditor';
import { ChainEditor } from '../../src/components/ChainEditor';

const TABS = ['members', 'positions', 'duty', 'templates', 'chains', 'contacts', 'invites', 'audit'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EVENT_TYPE_SUGGESTIONS = ['seminar', 'competition', 'webinar', 'webinar_intl',
                                'outside', 'ces', 'educ_tour', 'merch'];
const STANDARD_DOC_TYPES = ['concept_paper', 'board_resolution', 'financial_report',
                            'activity_report', 'ces_concept_paper', 'letter'];
const labelOf = (t) => ({ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 });

export default function Settings() {
  const { t } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const tab = TABS.includes(params.tab) ? params.tab : 'positions';
  const me = useMe();
  const active = useActiveMembership(me.data);
  const org = useOrgId();
  const [copied, setCopied] = useState(false);
  const canWrite = active ? atLeast(active.role, 'owner') : false;

  const copyOrgId = async () => {
    try {
      await Share.share({ message: org });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* dismissed */ }
  };

  return (
    <Screen>
      <PageHeader title="Settings" description="Org structure, templates, invites, and audit log." />

      {!canWrite ? (
        <HintBanner id="settings-readonly">
          Only owners can change these settings — you’re viewing read-only.
        </HintBanner>
      ) : null}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Organization ID</Text>
            <Text style={{ fontSize: 11, color: t.ink3 }} numberOfLines={1}>{org}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ThemePicker />
            <Button variant="secondary" onPress={copyOrgId}>
              {copied ? <Check size={14} color={t.ink} /> : <Copy size={14} color={t.ink} />}
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{copied ? 'Shared' : 'Share ID'}</Text>
            </Button>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Share this ID with people who want to request access — they paste it on the
          “join” screen. For instant joins, mint an invite link below instead.
        </Text>
      </Card>

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 2,
        borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 2,
      }}>
        {TABS.filter((x) => x !== 'invites' || canWrite).map((x) => (
          <Pressable key={x} accessibilityRole="button"
                     accessibilityState={{ selected: tab === x }}
                     onPress={() => router.setParams({ tab: x })}
                     style={{
                       minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: t.radiusInput,
                       backgroundColor: tab === x ? t.navActiveBg : 'transparent',
                     }}>
            <Text style={{ fontSize: 12, fontWeight: t.labelWeight, textTransform: 'capitalize', color: tab === x ? t.navActiveFg : t.ink3 }}>{x}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'members' ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Members &amp; roles</Text>
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Roles decide what each member can do — see the descriptions under each name. Owners are set at org creation and can’t be changed here.
          </Text>
          <MemberManager />
        </Card>
      ) : null}
      {tab === 'positions' ? <Positions canWrite={canWrite} /> : null}
      {tab === 'duty' ? <Duty canWrite={canWrite} /> : null}
      {tab === 'templates' ? <Templates canWrite={canWrite} /> : null}
      {tab === 'chains' ? <Chains canWrite={canWrite} /> : null}
      {tab === 'contacts' ? <Contacts canWrite={canWrite} /> : null}
      {tab === 'invites' ? <Invites /> : null}
      {tab === 'audit' ? <Audit /> : null}

      {canWrite ? <DangerZone orgName={active?.org_name} /> : null}
    </Screen>
  );
}

// ── Danger zone ─────────────────────────────────────────────────────────
function DangerZone({ orgName }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [open, setOpen] = useState(false);

  const archive = useMutation({
    mutationFn: () => post(`/orgs/${org}/archive`),
    onSuccess: async () => {
      // memberships now empty → /me refetch drops the org → the gate lands
      // on /onboarding. Clear the stored pick first so nothing queries a
      // dead org in the meantime.
      setCurrentOrg(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => { setOpen(false); toast.error(e.message); },
  });

  return (
    <Card style={{ gap: 10, borderColor: t.alert }}>
      <Text style={[labelOf(t), { color: t.alert }]}>Danger zone</Text>
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, color: t.ink2 }}>
          Archive this org — it disappears for every member, including you.
          Nothing is deleted; a CounciLog admin can bring it back.
        </Text>
        <Button variant="danger" onPress={() => setOpen(true)}>Archive org</Button>
      </View>
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
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [title, setTitle] = useState('');
  const [holder, setHolder] = useState('');
  const pos = useQuery({ queryKey: ['positions', org], queryFn: () => get(`/orgs/${org}/positions`), enabled: !!org });
  const members = useQuery({ queryKey: ['members', org], queryFn: () => get(`/orgs/${org}/members`), enabled: !!org });
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
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Positions (current school year)</Text>
      <Text style={{ fontSize: 12, color: t.ink3 }}>The org chart — who holds which office this year.</Text>
      {pos.isLoading ? <Skeleton style={{ height: 96 }} /> : null}
      {pos.isError ? <ErrorState error={pos.error} retry={pos.refetch} /> : null}
      {pos.data && pos.data.data.length === 0 ? (
        <Empty title="No positions yet" hint="Add your first office — e.g. President, Secretary." />
      ) : null}
      {pos.data?.data.map((p, i) => (
        <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: i > 0 ? Math.max(t.boxWidth, 1) : 0, borderTopColor: t.line }}>
          <Text style={{ fontSize: 14, color: t.ink, flexShrink: 1, minWidth: 0 }} numberOfLines={2}>{p.title}</Text>
          <Text style={{ fontSize: 13, color: t.ink3, flexShrink: 0, maxWidth: '55%', textAlign: 'right' }} numberOfLines={1} ellipsizeMode="tail">{nameOf(p.holder)}</Text>
        </View>
      ))}
      <View style={{ gap: 8 }}>
        <Input placeholder="Position title" value={title} onChangeText={setTitle} />
        <Select
          value={holder} onChange={setHolder} accessibilityLabel="Holder" placeholder="Holder…"
          options={[{ value: '', label: 'Holder…' }, ...(members.data?.data ?? []).map((m) => ({ value: m.user_id, label: m.display_name }))]}
        />
        <Button onPress={() => add.mutate()} disabled={!canWrite || !title || add.isPending} busy={add.isPending}>Add</Button>
      </View>
    </Card>
  );
}

// ── Duty schedule ────────────────────────────────────────────────────────
function Duty({ canWrite }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const duty = useQuery({ queryKey: ['duty', org], queryFn: () => get(`/orgs/${org}/duty-schedule`), enabled: !!org });
  const members = useQuery({ queryKey: ['members', org], queryFn: () => get(`/orgs/${org}/members`), enabled: !!org });
  const save = useMutation({
    mutationFn: (schedule) => put(`/orgs/${org}/duty-schedule`, { schedule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duty', org] }),
    onError: (e) => toast.error(e.message),
  });

  if (duty.isLoading || members.isLoading) return <Card><Skeleton style={{ height: 192 }} /></Card>;
  if (duty.isError) return <Card><ErrorState error={duty.error} retry={duty.refetch} /></Card>;
  const schedule = duty.data?.data ?? {};
  const activeM = members.data?.data.filter((m) => m.status === 'active') ?? [];

  const toggle = (weekday, uid) => {
    const next = {};
    for (let d = 0; d < 7; d++) next[d] = [...(schedule[String(d)] ?? schedule[d] ?? [])];
    const arr = next[weekday];
    next[weekday] = arr.includes(uid) ? arr.filter((x) => x !== uid) : [...arr, uid];
    save.mutate(next);
  };

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Assigned duty days · {duty.data?.school_year}</Text>
      <Text style={{ fontSize: 12, color: t.ink3 }}>
        Tick the weekday(s) each member is expected to file. They can still log on other days — it counts as extra duty.
      </Text>
      {activeM.length === 0 ? <Empty title="No active members" hint="Members appear here once they join." /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 110, padding: 4 }}><Text style={{ fontSize: 11, color: t.ink3 }}>Member</Text></View>
            {WD.map((d) => <View key={d} style={{ width: 44, padding: 4, alignItems: 'center' }}><Text style={{ fontSize: 11, color: t.ink3 }}>{d}</Text></View>)}
          </View>
          {activeM.map((m) => (
            <View key={m.user_id} style={{ flexDirection: 'row', borderTopWidth: t.boxWidth, borderTopColor: t.boxColor }}>
              <View style={{ width: 110, padding: 4, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink }} numberOfLines={1}>{m.display_name}</Text>
              </View>
              {WD.map((_, d) => {
                const on = (schedule[String(d)] ?? schedule[d] ?? []).includes(m.user_id);
                return (
                  <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                             accessibilityLabel={`${m.display_name} on ${WD[d]}`}
                             disabled={!canWrite || save.isPending}
                             onPress={() => toggle(d, m.user_id)}
                             style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: !canWrite ? 0.5 : 1 }}>
                    <View style={{
                      width: 20, height: 20, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
                      borderRadius: t.chipRadius, backgroundColor: on ? t.accent : t.surface2,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {on ? <Text style={{ color: t.accentFg, fontSize: 13, fontWeight: '800', marginTop: -2 }}>✓</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={{ fontSize: 12, color: t.ink3 }}>Changes save automatically.</Text>
    </Card>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────
function LibraryCard() {
  const { t } = useTheme();
  const router = useRouter();
  return (
    <Card style={{ gap: 4 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>New here?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          The Guide has worked examples you can load and adapt — with notes on why
          each is built the way it is.{' '}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => router.push('/guide')} style={{ minHeight: 24, justifyContent: 'center' }}>
          <Text style={{ fontSize: 12, color: t.brand, textDecorationLine: 'underline' }}>Open the starter library</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const rowBtn = (t) => ({
  minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: t.radiusInput,
});

// ── Checklist templates ─────────────────────────────────────────────────
function Templates({ canWrite }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [editor, setEditor] = useState(null); // {template} or {} for new
  const [deleting, setDeleting] = useState(null);
  const q = useQuery({ queryKey: ['templates', org], queryFn: () => get(`/orgs/${org}/checklist-templates`), enabled: !!org });
  const chains = useQuery({ queryKey: ['chains', org], queryFn: () => get(`/orgs/${org}/signatory-chains`), enabled: !!org });
  const projects = useQuery({ queryKey: ['projects', org], queryFn: () => get(`/orgs/${org}/projects?pageSize=100`), enabled: !!org });
  const knownEventTypes = [...new Set([
    ...EVENT_TYPE_SUGGESTIONS,
    ...(projects.data?.data ?? []).map((p) => p.event_type),
    ...(q.data?.data ?? []).map((x) => x.event_type),
  ].filter(Boolean))].sort();
  const flagNames = collectFlagNames({ chains: chains.data?.data, templates: q.data?.data });
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
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Checklist templates</Text>
          {canWrite ? (
            <Button variant="secondary" onPress={() => setEditor({})}>
              <Plus size={16} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>New template</Text>
            </Button>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Reusable step lists that become a project’s checklist. A project picks up a
          template when it needs that track (papers / logistics) AND the event types
          match — or the template has no event type.
        </Text>
        {q.isLoading ? <Skeleton style={{ height: 96 }} /> : null}
        {q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : null}
        {q.data && q.data.data.length === 0 ? (
          <Empty title="No templates"
                 hint={canWrite
                   ? 'Create one, or load a worked example from the starter library in the Guide.'
                   : 'Projects will show "no templates exist" until an owner adds one.'}
                 action={canWrite ? <Button variant="secondary" onPress={() => setEditor({})}>New template</Button> : null} />
        ) : null}
        {q.data?.data.map((x) => (
          <View key={x.id} style={{ gap: 4, borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{x.name}</Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>
                  {x.track === 'both' ? 'any project' : `projects needing ${x.track}`}
                  {x.event_type ? ` · only "${x.event_type}" events` : ' · any event type'}
                </Text>
              </View>
              {canWrite ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Pressable accessibilityRole="button" style={rowBtn(t)} onPress={() => setEditor({ template: x })}>
                    <Text style={{ fontSize: 12, color: t.ink2 }}>Edit</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={rowBtn(t)} onPress={() => setDeleting(x)}>
                    <Text style={{ fontSize: 12, color: t.alert }}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            <View style={{ marginLeft: 12, gap: 2 }}>
              {x.items.map((i, k) => {
                const rule = describeItemRule(i.rule_json);
                return (
                  <Text key={k} style={{ fontSize: 12, color: t.ink2 }}>
                    • {i.label}{i.required === false ? ' (optional)' : ''}
                    {i.hint ? <Text style={{ color: t.ink3 }}>{'\n   '}{i.hint}</Text> : null}
                    {rule ? <Text style={{ color: t.ink3 }}>{'\n   '}{rule}</Text> : null}
                  </Text>
                );
              })}
            </View>
          </View>
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
function Chains({ canWrite }) {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [editor, setEditor] = useState(null); // {chain} or {} for new
  const [deleting, setDeleting] = useState(null);
  const c = useQuery({ queryKey: ['chains', org], queryFn: () => get(`/orgs/${org}/signatory-chains`), enabled: !!org });
  const templates = useQuery({ queryKey: ['templates', org], queryFn: () => get(`/orgs/${org}/checklist-templates`), enabled: !!org });
  const docs = useQuery({ queryKey: ['documents', org], queryFn: () => get(`/orgs/${org}/documents?pageSize=100`), enabled: !!org });
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
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Signatory chains</Text>
          {canWrite ? (
            <Button variant="secondary" onPress={() => setEditor({})}>
              <Plus size={16} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>New chain</Text>
            </Button>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          A chain is the signing route for a paper. When an officer registers a document
          whose type matches a chain’s doc type, these steps attach in order —
          automatically. The doc type must match exactly.
        </Text>
        {c.isLoading ? <Skeleton style={{ height: 96 }} /> : null}
        {c.isError ? <ErrorState error={c.error} retry={c.refetch} /> : null}
        {c.data && c.data.data.length === 0 ? (
          <Empty title="No chains"
                 hint={canWrite
                   ? 'Create one, or load a worked example from the starter library in the Guide.'
                   : 'Documents will register unrouted until an owner adds chains.'}
                 action={canWrite ? <Button variant="secondary" onPress={() => setEditor({})}>New chain</Button> : null} />
        ) : null}
        {c.data?.data.map((x) => {
          const n = matchCount(x.doc_type);
          return (
            <View key={x.id} style={{ gap: 4, borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>
                    {x.name} <Text style={{ fontSize: 12, fontWeight: '400', color: t.ink3 }}>· {docTypeLabel(x.doc_type)}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: n === 0 ? t.alert : t.ink3 }}>
                    {n === 0
                      ? 'matches no registered papers — check the doc type spelling'
                      : `covers ${n} registered paper${n === 1 ? '' : 's'}`}
                  </Text>
                </View>
                {canWrite ? (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Pressable accessibilityRole="button" style={rowBtn(t)} onPress={() => setEditor({ chain: x })}>
                      <Text style={{ fontSize: 12, color: t.ink2 }}>Edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={rowBtn(t)} onPress={() => setDeleting(x)}>
                      <Text style={{ fontSize: 12, color: t.alert }}>Delete</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View style={{ marginLeft: 12, gap: 2 }}>
                {x.steps.map((s, k) => {
                  const cond = describeCondition(s.condition_json);
                  return (
                    <Text key={k} style={{ fontSize: 12, color: t.ink2 }}>
                      {k + 1}. {s.label}{s.office ? <Text style={{ color: t.ink3 }}> — {s.office}</Text> : null}
                      {cond ? <Text style={{ color: t.ink3 }}>{'\n   '}{cond}</Text> : null}
                    </Text>
                  );
                })}
              </View>
            </View>
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
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const c = useQuery({ queryKey: ['contacts', org], queryFn: () => get(`/orgs/${org}/contacts`), enabled: !!org });
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
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Quick reference — who to ask</Text>
      {c.isLoading ? <Skeleton style={{ height: 64 }} /> : null}
      {c.isError ? <ErrorState error={c.error} retry={c.refetch} /> : null}
      {c.data && c.data.data.length === 0 ? (
        <Empty title="No contacts" hint="e.g. Concept papers → SAS office, 2nd floor." />
      ) : null}
      {c.data?.data.map((x, i) => (
        <View key={x.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: t.line }}>
          <Text style={{ fontSize: 14, color: t.ink, flexShrink: 1 }}>{x.label}</Text>
          <Text style={{ fontSize: 13, color: t.ink3, flexShrink: 1, textAlign: 'right' }}>{x.value}</Text>
        </View>
      ))}
      <View style={{ gap: 8 }}>
        <Input placeholder="Need" value={label} onChangeText={setLabel} />
        <Input placeholder="Who / where" value={value} onChangeText={setValue} />
        <Button onPress={() => add.mutate()} disabled={!canWrite || !label || !value || add.isPending} busy={add.isPending}>Add</Button>
      </View>
    </Card>
  );
}

// ── Invites ──────────────────────────────────────────────────────────────
function Invites() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [role, setRole] = useState('officer');
  const [approveRoles, setApproveRoles] = useState({});
  const [rejecting, setRejecting] = useState(null);
  const inv = useQuery({ queryKey: ['invites', org], queryFn: () => get(`/orgs/${org}/invites`), enabled: !!org });
  const reqs = useQuery({ queryKey: ['joinreqs', org], queryFn: () => get(`/orgs/${org}/join-requests`), enabled: !!org });
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

  const shareCode = (code) => Share.share({ message: code }).catch(() => {});

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Pending join requests</Text>
        {reqs.isLoading ? <Skeleton style={{ height: 48 }} /> : null}
        {reqs.isError ? <ErrorState error={reqs.error} retry={reqs.refetch} /> : null}
        {reqs.data?.data.length === 0 ? <Text style={{ fontSize: 12, color: t.ink3 }}>none</Text> : null}
        {reqs.data?.data.map((r) => (
          <View key={r.id} style={{ gap: 6, borderRadius: t.radiusCard, borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 8 }}>
            <Text style={{ fontSize: 14, color: t.ink }}>{r.display_name}{r.message ? ` — ${r.message}` : ''}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <Select
                  value={approveRoles[r.id] ?? 'member'}
                  onChange={(v) => setApproveRoles({ ...approveRoles, [r.id]: v })}
                  accessibilityLabel="Role to grant"
                  options={['member', 'officer', 'adviser'].map((x) => ({ value: x, label: x }))}
                />
              </View>
              <Button variant="secondary" disabled={decide.isPending}
                      onPress={() => decide.mutate({ id: r.id, approve: true, approveRole: approveRoles[r.id] })}>Approve</Button>
              <Pressable accessibilityRole="button" onPress={() => setRejecting(r)} style={rowBtn(t)}>
                <Text style={{ fontSize: 12, color: t.alert }}>Reject</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Invite links</Text>
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Anyone with a code joins instantly at the role you pick — share carefully.
        </Text>
        {inv.isLoading ? <Skeleton style={{ height: 48 }} /> : null}
        {inv.isError ? <ErrorState error={inv.error} retry={inv.refetch} /> : null}
        {inv.data && inv.data.data.length === 0 ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>no active invites</Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Select value={role} onChange={setRole} accessibilityLabel="Role"
                    options={['officer', 'adviser', 'member'].map((x) => ({ value: x, label: humanize(x) }))} />
          </View>
          <Button onPress={() => mint.mutate()} disabled={mint.isPending} busy={mint.isPending}>Mint invite</Button>
        </View>
        {inv.data?.data.map((i) => (
          <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={`Share invite code ${i.code}`}
                     onPress={() => shareCode(i.code)}
                     style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 36 }}>
            <Text style={{ fontSize: 12, fontFamily: 'monospace', backgroundColor: t.surface3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: t.radiusInput, color: t.ink }}>{i.code}</Text>
            <Text style={{ fontSize: 12, color: t.ink3 }}>{humanize(i.role)} · {i.uses}/{i.max_uses} uses</Text>
          </Pressable>
        ))}
      </View>
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
  const org = useOrgId();
  const { t } = useTheme();
  const a = useQuery({
    queryKey: ['audit', org],
    queryFn: () => get(`/orgs/${org}/audit?pageSize=50`),
    enabled: !!org,
  });
  if (a.isLoading) return <Card><Skeleton style={{ height: 192 }} /></Card>;
  if (a.error) return <Card><Empty title="Adviser or owner role required" /></Card>;
  return (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>Audit log</Text>
      <Text style={{ fontSize: 12, color: t.ink3 }}>
        Every sensitive change, recorded permanently — append-only.
      </Text>
      {a.data && a.data.data.length === 0 ? <Empty title="Nothing logged yet" /> : null}
      {a.data?.data.map((r, i) => (
        <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: t.line }}>
          <Text style={{ fontSize: 12, color: t.ink, flexShrink: 1 }}>
            <Text style={{ fontWeight: '700' }}>{r.action}</Text> · {r.entity_type}
          </Text>
          <Text style={{ fontSize: 11, color: t.ink3, flexShrink: 0 }}>{new Date(r.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </Card>
  );
}
