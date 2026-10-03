/** Port of web/pages/Projects.jsx — status board + create sheet with flags
 *  and live checklist preview. Board becomes stacked status sections. */
import { memo, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react-native';
import { get, post, queuedMsg } from '../../src/lib/api';
import { atLeast, useOrgId } from '../../src/lib/org';
import { collectFlagNames } from '../../src/lib/rules';
import { humanize, projectStatusLabel } from '../../src/lib/labels';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { ChecklistEditor } from '../../src/components/ChecklistEditor';
import { FlagCheckboxes } from '../../src/components/RuleFields';
import { Button, Card, CheckRow, Chip, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Screen, Select, Sheet, Skeleton } from '../../src/components/ui';

const STATUS = ['draft', 'active', 'done', 'archived'];

/** One board card — memoized so the board doesn't re-render every row on
 *  unrelated state changes (sheet open, form typing). */
const ProjectCard = memo(function ProjectCard({ p, nameOf, onPress }) {
  const { t } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{p.title}</Text>
        {p.target_date ? <Text style={{ fontSize: 12, color: t.ink3 }}>Target {p.target_date}</Text> : null}
        {nameOf(p.owner_id) ? <Text style={{ fontSize: 12, color: t.ink3 }}>Lead: {nameOf(p.owner_id)}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {p.needs_paper_processing ? <Chip kind="pending" label="Papers" /> : null}
          {p.needs_logistics ? <Chip kind="extra" label="Logistics" /> : null}
        </View>
      </Card>
    </Pressable>
  );
});

export default function Projects() {
  const org = useOrgId();
  const router = useRouter();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const canCreate = active ? atLeast(active.role, 'adviser') : false;
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', event_type: '', target_date: '', paper: false, logistics: false, assignee: '', flags: {} });
  const [checklist, setChecklist] = useState([]);
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
  const chains = useQuery({
    queryKey: ['chains', org],
    queryFn: () => get(`/orgs/${org}/signatory-chains`),
    enabled: !!org,
  });
  const flagNames = collectFlagNames({ chains: chains.data?.data, templates: templates.data?.data });
  const knownEventTypes = [...new Set(
    (templates.data?.data ?? []).map((x) => x.event_type).filter(Boolean))].sort();
  const nameOf = (id) =>
    members.data?.data.find((m) => m.user_id === id)?.display_name ?? null;
  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/projects`, {
      title: form.title, details: form.details || null,
      event_type: form.event_type || null, target_date: form.target_date || null,
      owner_id: form.assignee || null,
      needs_paper_processing: form.paper, needs_logistics: form.logistics,
      flags: form.flags,
      checklist_items: checklist
        .filter((i) => i.label.trim())
        .map((i, n) => ({
          label: i.label.trim(), hint: i.hint || null,
          required: !!i.required, due_date: i.due_date || null, ord: n,
        })),
    }),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, form.assignee ? 'Project created — assignee will be emailed.' : 'Project created.'));
      setOpen(false);
      setForm({ title: '', details: '', event_type: '', target_date: '', paper: false, logistics: false, assignee: '', flags: {} });
      setChecklist([]);
      qc.invalidateQueries({ queryKey: ['projects', org] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const sections = useMemo(
    () => STATUS
      .map((s) => ({ title: s, data: (list.data?.data ?? []).filter((p) => p.status === s) }))
      .filter((sec) => sec.data.length > 0),
    [list.data]);

  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([list.refetch(), members.refetch(), templates.refetch(), chains.refetch()]); }
    finally { setRefreshing(false); }
  };

  const header = (
    <View style={{ gap: 14, marginBottom: 6 }}>
      <PageHeader
        title="Projects"
        description="Events and the paperwork + logistics behind them."
        action={canCreate ? (
          <Button onPress={() => setOpen(true)}>
            <Plus size={16} color={t.accentFg} /><Text style={{ color: t.accentFg, fontWeight: '700' }}>New project</Text>
          </Button>
        ) : null}
      />
      <HintBanner id="projects">
        A project generates its checklist from templates: check “Needs papers” for
        signatory-routed documents, “Needs logistics” for venue/equipment steps.
      </HintBanner>
      {list.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {list.isError ? <ErrorState error={list.error} retry={list.refetch} /> : null}
    </View>
  );

  return (
    <Screen scroll={false} pad={0}>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(p) => p.id}
        renderSectionHeader={({ section }) => (
          <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', color: t.ink3 }}>
            {projectStatusLabel(section.title)} · {section.data.length}
          </Text>
        )}
        renderItem={({ item: p }) => (
          <ProjectCard p={p} nameOf={nameOf} onPress={() => router.push(`/project/${p.id}`)} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={list.isSuccess ? (
          <Empty icon={<FolderKanban size={24} color={t.ink3} />} title="No projects"
                 hint={canCreate
                   ? 'Create one to start tracking papers and logistics.'
                   : 'Projects are created by advisers and owners — ask one to set one up.'}
                 action={canCreate ? <Button onPress={() => setOpen(true)}>New project</Button> : null} />
        ) : null}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        SectionSeparatorComponent={() => <View style={{ height: 14 }} />}
        stickySectionHeadersEnabled={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom + 72 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ink3} />}
      />

      <Sheet open={open} onClose={() => setOpen(false)} title="New project">
        <Field label="Title"><Input value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} /></Field>
        <Field label="Details"><Input value={form.details} onChangeText={(v) => setForm({ ...form, details: v })} multiline /></Field>
        <Field label="Event type" hint="Drives which templates match — known types are suggested.">
          <Input value={form.event_type} onChangeText={(v) => setForm({ ...form, event_type: v })}
                 placeholder="seminar, competition, webinar_intl…" autoCapitalize="none" />
          {knownEventTypes.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {knownEventTypes.map((et) => (
                <Pressable key={et} accessibilityRole="button" onPress={() => setForm({ ...form, event_type: et })}
                           style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: t.chipRadius, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor, backgroundColor: t.surface2 }}>
                  <Text style={{ fontSize: 12, color: t.ink2 }}>{humanize(et)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Field>
        <Field label="Target date" hint="YYYY-MM-DD">
          <Input value={form.target_date} onChangeText={(v) => setForm({ ...form, target_date: v })} placeholder="2026-03-15" autoCapitalize="none" />
        </Field>
        <Field label="Assign to (optional)" hint="They'll get an email telling them they lead this project.">
          <Select
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v })}
            accessibilityLabel="Assign to"
            options={[{ value: '', label: 'Me' }, ...(members.data?.data ?? []).filter((m) => m.status === 'active').map((m) => ({ value: m.user_id, label: m.display_name }))]}
          />
        </Field>
        <CheckRow checked={form.paper} onChange={(v) => setForm({ ...form, paper: v })} label="Needs papers" />
        <CheckRow checked={form.logistics} onChange={(v) => setForm({ ...form, logistics: v })} label="Needs logistics" />
        <FlagCheckboxes flagNames={flagNames} value={form.flags}
                        onChange={(flags) => setForm({ ...form, flags })} />
        <ChecklistEditor
          templates={templates.data?.data}
          paper={form.paper} logistics={form.logistics}
          eventType={form.event_type || null} flags={form.flags}
          targetDate={form.target_date || null}
          items={checklist} onItems={setChecklist} />
        {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
        <Button style={{ width: '100%' }} onPress={() => create.mutate()} disabled={!form.title || create.isPending} busy={create.isPending}>Create</Button>
      </Sheet>
    </Screen>
  );
}
