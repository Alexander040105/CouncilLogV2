/** Port of web/pages/ProjectDetail.jsx — checklist card: generate/diagnose,
 *  force-pick template (409 confirm → append), per-item check/assign. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserCheck } from 'lucide-react-native';
import { get, isQueued, patch, post, queuedMsg } from '../../../src/lib/api';
import { atLeast, useOrgId } from '../../../src/lib/org';
import { useAuth } from '../../../src/lib/auth';
import { useToast } from '../../../src/lib/toast';
import { useTheme } from '../../../src/lib/theme';
import { useMe, useActiveMembership } from '../../../src/lib/me';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Screen, Select, Sheet, Skeleton } from '../../../src/components/ui';
import { ChecklistPreview } from '../../../src/components/ChecklistPreview';
import { diagnoseChecklist, humanizeFlag } from '../../../src/lib/rules';

export default function ProjectDetail() {
  const { id } = useLocalSearchParams();
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const canAssign = active ? atLeast(active.role, 'adviser') : false;
  const canCheck = active ? atLeast(active.role, 'officer') : false;
  const { t } = useTheme();

  const q = useQuery({
    queryKey: ['project', org, id],
    queryFn: () => get(`/orgs/${org}/projects/${id}`),
    enabled: !!org && !!id,
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
  const [pickTemplate, setPickTemplate] = useState('');
  const [confirmPick, setConfirmPick] = useState(false);
  const [assignItem, setAssignItem] = useState(null);
  const activeMembers = members.data?.data.filter((m) => m.status === 'active') ?? [];
  const nameOf = (uid) =>
    activeMembers.find((m) => m.user_id === uid)?.display_name ?? null;
  const instantiate = useMutation({
    mutationFn: ({ templateIds, append } = {}) =>
      post(`/orgs/${org}/projects/${id}/instantiate`,
        templateIds?.length ? { template_ids: templateIds, append } : {}),
    onSuccess: (r) => {
      setConfirmPick(false); setPickTemplate('');
      if (isQueued(r)) {
        toast.success(queuedMsg(r));
      } else if (r.instantiated_items > 0) {
        toast.success(`Checklist generated — ${r.instantiated_items} item(s).`);
      } else {
        toast.error('Nothing generated — see the checklist card for why.');
      }
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => {
      toast.error(e.message);
      // ALREADY_INSTANTIATED → refetch so the existing checklist shows
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
  });
  const check = useMutation({
    mutationFn: ({ itemId, done }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', org, id] }),
    onError: (e) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: ({ itemId, assignee_id }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { assignee_id }),
    onSuccess: (_r, v) => {
      setAssignItem(null);
      toast.success(queuedMsg(_r, v.assignee_id ? "Task assigned — they'll be emailed." : 'Task unassigned.'));
      qc.invalidateQueries({ queryKey: ['project', org, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Screen><Skeleton style={{ height: 256 }} /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} retry={q.refetch} /></Screen>;
  const p = q.data?.data;
  if (!p) return <Screen><Empty title="Project not found" /></Screen>;
  const items = q.data?.checklist ?? [];
  const diag = diagnoseChecklist(templates.data?.data, {
    paper: p.needs_paper_processing, logistics: p.needs_logistics,
    eventType: p.event_type, flags: p.flags ?? {}, targetDate: p.target_date,
  });
  const flagNames = Object.entries(p.flags ?? {}).filter(([, v]) => v).map(([k]) => k);

  return (
    <Screen refresh={q.refetch}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Projects</Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 24, fontWeight: t.headingWeight, color: t.ink }}>{p.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip kind="neutral" label={p.status} />
          {p.event_type ? <Chip kind="extra" label={p.event_type} /> : null}
          {p.target_date ? <Chip kind="pending" label={`target ${p.target_date}`} /> : null}
          {flagNames.map((f) => <Chip key={f} kind="neutral" label={humanizeFlag(f)} />)}
        </View>
        {p.details ? <Text style={{ fontSize: 14, color: t.ink2 }}>{p.details}</Text> : null}
        {nameOf(p.owner_id) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <UserCheck size={14} color={t.ink3} />
            <Text style={{ fontSize: 12, color: t.ink3 }}>lead: {nameOf(p.owner_id)}</Text>
          </View>
        ) : null}
      </View>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Checklist</Text>
          {items.length === 0 && diag.reason === 'ok' ? (
            <Button variant="secondary" onPress={() => instantiate.mutate({})} disabled={instantiate.isPending} busy={instantiate.isPending}>
              {`Generate checklist — ${diag.items.length} items`}
            </Button>
          ) : null}
        </View>
        {items.length === 0 ? (
          <View style={{ gap: 12 }}>
            <ChecklistPreview
              templates={templates.data?.data}
              paper={p.needs_paper_processing} logistics={p.needs_logistics}
              eventType={p.event_type} flags={p.flags ?? {}}
              targetDate={p.target_date} />
            {diag.reason !== 'ok' && diag.reason !== 'no_needs'
              && (templates.data?.data.length ?? 0) > 0 && canAssign ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, color: t.ink3 }}>Or force it — pick a template directly:</Text>
                <Select
                  value={pickTemplate}
                  onChange={setPickTemplate}
                  placeholder="choose a template…"
                  accessibilityLabel="Template to generate from"
                  options={templates.data.data.map((x) => ({ value: x.id, label: `${x.name} · ${x.track}${x.event_type ? ` · ${x.event_type}` : ''}` }))}
                />
                <Button variant="secondary" disabled={!pickTemplate || instantiate.isPending}
                        onPress={() => setConfirmPick(true)}>
                  Generate
                </Button>
              </View>
            ) : null}
          </View>
        ) : null}
        {!canCheck && items.length > 0 ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>View only — officers tick checklist items off.</Text>
        ) : null}
        <View style={{ gap: 2 }}>
          {items.map((it) => {
            const assignee = nameOf(it.assignee_id);
            const mine = it.assignee_id === session?.user?.id;
            return (
              <View key={it.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 8, borderRadius: t.radiusInput }}>
                <Pressable
                  accessibilityRole="checkbox" accessibilityState={{ checked: it.done }}
                  accessibilityLabel={`mark ${it.label} done`}
                  disabled={!canCheck || check.isPending}
                  onPress={() => check.mutate({ itemId: it.id, done: !it.done })}
                  hitSlop={8}
                  style={{
                    width: 22, height: 22, marginTop: 1, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor,
                    borderRadius: t.chipRadius, backgroundColor: it.done ? t.accent : t.surface2,
                    alignItems: 'center', justifyContent: 'center', opacity: !canCheck ? 0.5 : 1,
                  }}
                >
                  {it.done ? <Text style={{ color: t.accentFg, fontSize: 14, fontWeight: '800', marginTop: -2 }}>✓</Text> : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: it.done ? t.ink3 : t.ink, textDecorationLine: it.done ? 'line-through' : 'none' }}>{it.label}</Text>
                  {it.hint ? <Text style={{ fontSize: 12, color: t.ink3 }}>{it.hint}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    {it.due_date ? <Chip kind="pending" label={`due ${it.due_date}`} /> : null}
                    {canAssign ? (
                      <Pressable accessibilityRole="button" onPress={() => setAssignItem(it)}
                                 style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 8, borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor }}>
                        <Text style={{ fontSize: 11, color: t.ink2 }}>{assignee ? `→ ${assignee}` : 'assign…'}</Text>
                      </Pressable>
                    ) : assignee ? (
                      <Chip kind="neutral" label={mine ? 'you' : assignee} />
                    ) : !it.done && canCheck ? (
                      <Pressable accessibilityRole="button" onPress={() => assign.mutate({ itemId: it.id, assignee_id: session?.user?.id })}
                                 style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Text style={{ fontSize: 12, color: t.brand }}>Take it</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {/* assign picker sheet */}
      <Sheet open={!!assignItem} onClose={() => setAssignItem(null)} title={assignItem ? `Assign: ${assignItem.label}` : 'Assign'}>
        <View style={{ gap: 2 }}>
          <Pressable accessibilityRole="button" onPress={() => assign.mutate({ itemId: assignItem.id, assignee_id: null })}
                     style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 14, color: t.ink3 }}>unassigned</Text>
          </Pressable>
          {activeMembers.map((m) => (
            <Pressable key={m.user_id} accessibilityRole="button"
                       onPress={() => assign.mutate({ itemId: assignItem.id, assignee_id: m.user_id })}
                       style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: t.radiusInput }}>
              <Text style={{ fontSize: 14, color: t.ink }}>{m.display_name}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <ConfirmDialog
        open={confirmPick} onClose={() => setConfirmPick(false)}
        onConfirm={() => instantiate.mutate({ templateIds: [pickTemplate], append: true })}
        busy={instantiate.isPending}
        title="Force-generate from this template?"
        body="This template doesn't auto-match the project — its items will be added on top of anything already generated."
        confirmLabel="Generate anyway"
      />
    </Screen>
  );
}
