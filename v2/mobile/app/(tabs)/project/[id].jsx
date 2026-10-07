/** Port of web/pages/ProjectDetail.jsx — status control, filter chips,
 *  checklist item CRUD + reorder, generate/diagnose, per-item check/assign. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2, UserCheck } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../../../src/lib/api';
import { atLeast, useOrgId } from '../../../src/lib/org';
import { useAuth } from '../../../src/lib/auth';
import { useToast } from '../../../src/lib/toast';
import { useTheme } from '../../../src/lib/theme';
import { useMe, useActiveMembership } from '../../../src/lib/me';
import { humanize, projectStatusLabel } from '../../../src/lib/labels';
import { Button, Card, CheckRow, Chip, ConfirmDialog, Empty, ErrorState, Field, Input, Screen, Select, Sheet, Skeleton } from '../../../src/components/ui';
import { ChecklistPreview } from '../../../src/components/ChecklistPreview';
import { BudgetSection } from '../../../src/components/BudgetSection';
import { diagnoseChecklist, humanizeFlag } from '../../../src/lib/rules';

const STATUS_ORDER = ['draft', 'active', 'done', 'archived'];

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'open', label: 'Not done', test: (i) => !i.done },
  { id: 'done', label: 'Done', test: (i) => i.done },
  { id: 'assigned', label: 'Assigned', test: (i) => !!i.assignee_id },
  { id: 'unassigned', label: 'Unassigned', test: (i) => !i.assignee_id },
  { id: 'mine', label: 'Mine', test: (i, myId) => i.assignee_id === myId },
];

export default function ProjectDetail() {
  const { id } = useLocalSearchParams();
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const myId = session?.user?.id;
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
  const [filter, setFilter] = useState('all');
  const [editItem, setEditItem] = useState(null);     // item object, or 'new'
  const [delItem, setDelItem] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [itemForm, setItemForm] = useState({ label: '', hint: '', due_date: '', required: true });
  const activeMembers = members.data?.data.filter((m) => m.status === 'active') ?? [];
  const nameOf = (uid) =>
    activeMembers.find((m) => m.user_id === uid)?.display_name ?? null;

  const reload = () => qc.invalidateQueries({ queryKey: ['project', org, id] });
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
      reload();
    },
    onError: (e) => {
      toast.error(e.message);
      // ALREADY_INSTANTIATED → refetch so the existing checklist shows
      reload();
    },
  });
  const check = useMutation({
    mutationFn: ({ itemId, done }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { done }),
    onSuccess: reload,
    onError: (e) => toast.error(e.message),
  });
  const assign = useMutation({
    mutationFn: ({ itemId, assignee_id }) =>
      patch(`/orgs/${org}/checklist-items/${itemId}`, { assignee_id }),
    onSuccess: (r, v) => {
      setAssignItem(null);
      toast.success(queuedMsg(r, v.assignee_id ? "Task assigned — they'll be emailed." : 'Task unassigned.'));
      reload();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status) => patch(`/orgs/${org}/projects/${id}`, { status }),
    onSuccess: (_r, v) => {
      toast.success(queuedMsg(_r, `Project marked ${projectStatusLabel(v).toLowerCase()}.`));
      setPendingStatus(null);
      reload();
      qc.invalidateQueries({ queryKey: ['projects', org] });
    },
    onError: (e) => toast.error(e.message),
  });
  const saveItem = useMutation({
    mutationFn: () => {
      const body = {
        label: itemForm.label.trim(),
        hint: itemForm.hint.trim() || null,
        due_date: itemForm.due_date || null,
        required: itemForm.required,
      };
      return editItem === 'new'
        ? post(`/orgs/${org}/projects/${id}/checklist-items`, body)
        : patch(`/orgs/${org}/checklist-items/${editItem.id}`, body);
    },
    onSuccess: (r) => {
      toast.success(queuedMsg(r, editItem === 'new' ? 'Item added.' : 'Item updated.'));
      setEditItem(null);
      reload();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeItem = useMutation({
    mutationFn: (itemId) => del(`/orgs/${org}/checklist-items/${itemId}`),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Item removed.'));
      setDelItem(null);
      reload();
    },
    onError: (e) => { setDelItem(null); toast.error(e.message); },
  });
  const reorder = useMutation({
    mutationFn: (itemIds) =>
      post(`/orgs/${org}/projects/${id}/checklist-items/reorder`, { item_ids: itemIds }),
    onSuccess: reload,
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <Screen><Skeleton style={{ height: 256 }} /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} retry={q.refetch} /></Screen>;
  const p = q.data?.data;
  if (!p) return <Screen><Empty title="Project not found" /></Screen>;

  const isLead = p.owner_id === myId;
  const canStructure = canAssign || isLead;   // adviser+ or the project lead
  const canMoveStatus = canAssign || isLead;

  const items = q.data?.checklist ?? [];
  const diag = diagnoseChecklist(templates.data?.data, {
    paper: p.needs_paper_processing, logistics: p.needs_logistics,
    eventType: p.event_type, flags: p.flags ?? {}, targetDate: p.target_date,
  });
  const flagNames = Object.entries(p.flags ?? {}).filter(([, v]) => v).map(([k]) => k);

  const shown = items.filter((i) => FILTERS.find((f) => f.id === filter)?.test(i, myId));
  const moveItem = (idx, dir) => {
    const ids = items.map((i) => i.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir], ids[idx]];
    reorder.mutate(ids);
  };
  const openEditItem = (it) => {
    setEditItem(it);
    setItemForm({ label: it.label, hint: it.hint ?? '', due_date: it.due_date ?? '', required: it.required });
  };
  const openNewItem = () => {
    setEditItem('new');
    setItemForm({ label: '', hint: '', due_date: '', required: true });
  };
  const askStatus = (v) => {
    if (!v || v === p.status) return;
    if (v === 'done' || v === 'archived') setPendingStatus(v);
    else setStatus.mutate(v);
  };

  const iconBtn = { minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center' };

  return (
    <Screen refresh={q.refetch}>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} /><Text style={{ fontSize: 14, color: t.ink3 }}>Projects</Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 24, fontWeight: t.headingWeight, color: t.ink, flexShrink: 1, minWidth: 140 }}>{p.title}</Text>
          {canMoveStatus ? (
            <Select
              value={p.status}
              onChange={askStatus}
              accessibilityLabel="Project status"
              style={{ minHeight: 36, minWidth: 132 }}
              options={STATUS_ORDER.map((s) => ({ value: s, label: projectStatusLabel(s) }))}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip kind="neutral" label={projectStatusLabel(p.status)} />
          {p.event_type ? <Chip kind="extra" label={humanize(p.event_type)} /> : null}
          {p.target_date ? <Chip kind="pending" label={`Target ${p.target_date}`} /> : null}
          {flagNames.map((f) => <Chip key={f} kind="neutral" label={humanizeFlag(f)} />)}
        </View>
        {p.details ? <Text style={{ fontSize: 14, color: t.ink2 }}>{p.details}</Text> : null}
        {nameOf(p.owner_id) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <UserCheck size={14} color={t.ink3} />
            <Text style={{ fontSize: 12, color: t.ink3 }}>Lead: {nameOf(p.owner_id)}</Text>
          </View>
        ) : null}
      </View>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Checklist</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {items.length === 0 && diag.reason === 'ok' ? (
              <Button variant="secondary" onPress={() => instantiate.mutate({})} disabled={instantiate.isPending} busy={instantiate.isPending}>
                {`Generate checklist — ${diag.items.length} items`}
              </Button>
            ) : null}
            {canStructure && items.length > 0 ? (
              <Button variant="secondary" style={{ minHeight: 36 }} onPress={openNewItem}>
                <Plus size={14} color={t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>Add item</Text>
              </Button>
            ) : null}
          </View>
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
                  placeholder="Choose a template…"
                  accessibilityLabel="Template to generate from"
                  options={templates.data.data.map((x) => ({ value: x.id, label: `${x.name} · ${humanize(x.track)}${x.event_type ? ` · ${humanize(x.event_type)}` : ''}` }))}
                />
                <Button variant="secondary" disabled={!pickTemplate || instantiate.isPending}
                        onPress={() => setConfirmPick(true)}>
                  Generate
                </Button>
              </View>
            ) : null}
            {canStructure ? (
              <Button variant="secondary" style={{ width: '100%', minHeight: 38 }} onPress={openNewItem}>
                <Plus size={14} color={t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>Add the first item by hand</Text>
              </Button>
            ) : null}
          </View>
        ) : null}
        {!canCheck && items.length > 0 ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>View only — officers tick checklist items off.</Text>
        ) : null}
        {items.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="menubar" accessibilityLabel="Filter checklist">
            {FILTERS.map((f) => {
              const n = items.filter((i) => f.test(i, myId)).length;
              if (f.id === 'mine' && n === 0) return null;
              const on = filter === f.id;
              return (
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFilter(f.id)}
                  style={{
                    minHeight: 32, justifyContent: 'center', paddingHorizontal: 10,
                    borderRadius: t.chipRadius, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor,
                    backgroundColor: on ? t.accent : t.surface2,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: on ? t.accentFg : t.ink2 }}>{f.label} · {n}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={{ gap: 2 }}>
          {shown.length === 0 && items.length > 0 ? (
            <Text style={{ padding: 8, fontSize: 12, color: t.ink3 }}>
              Nothing matches this filter — pick another one above.
            </Text>
          ) : null}
          {shown.map((it) => {
            const assignee = nameOf(it.assignee_id);
            const mine = it.assignee_id === myId;
            const idx = items.indexOf(it);
            return (
              <View key={it.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 8, borderRadius: t.radiusInput }}>
                <Pressable
                  accessibilityRole="checkbox" accessibilityState={{ checked: it.done }}
                  accessibilityLabel={`Mark ${it.label} done`}
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
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, color: it.done ? t.ink3 : t.ink, textDecorationLine: it.done ? 'line-through' : 'none' }}>
                    {it.label}{!it.required ? '  (optional)' : ''}
                  </Text>
                  {it.hint ? <Text style={{ fontSize: 12, color: t.ink3 }}>{it.hint}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    {it.due_date ? <Chip kind="pending" label={`Due ${it.due_date}`} /> : null}
                    {canAssign ? (
                      <Pressable accessibilityRole="button" onPress={() => setAssignItem(it)}
                                 style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 8, borderRadius: t.radiusInput, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.boxColor }}>
                        <Text style={{ fontSize: 11, color: t.ink2 }}>{assignee ? `→ ${assignee}` : 'Assign…'}</Text>
                      </Pressable>
                    ) : assignee ? (
                      <Chip kind="neutral" label={mine ? 'You' : assignee} />
                    ) : !it.done && canCheck ? (
                      <Pressable accessibilityRole="button" onPress={() => assign.mutate({ itemId: it.id, assignee_id: myId })}
                                 style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Text style={{ fontSize: 12, color: t.brand }}>Take it</Text>
                      </Pressable>
                    ) : null}
                    {canStructure ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' }}>
                        {filter === 'all' ? (
                          <>
                            <Pressable accessibilityRole="button" accessibilityLabel={`Move ${it.label} up`}
                                       disabled={idx === 0 || reorder.isPending} hitSlop={4}
                                       style={[iconBtn, { opacity: idx === 0 ? 0.3 : 1 }]}
                                       onPress={() => moveItem(idx, -1)}>
                              <ArrowUp size={14} color={t.ink3} />
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={`Move ${it.label} down`}
                                       disabled={idx === items.length - 1 || reorder.isPending} hitSlop={4}
                                       style={[iconBtn, { opacity: idx === items.length - 1 ? 0.3 : 1 }]}
                                       onPress={() => moveItem(idx, 1)}>
                              <ArrowDown size={14} color={t.ink3} />
                            </Pressable>
                          </>
                        ) : null}
                        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${it.label}`} hitSlop={4}
                                   style={iconBtn} onPress={() => openEditItem(it)}>
                          <Pencil size={14} color={t.ink3} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${it.label}`} hitSlop={4}
                                   style={iconBtn} onPress={() => setDelItem(it)}>
                          <Trash2 size={14} color={t.alert} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <BudgetSection org={org} projectId={id} active={active} myId={myId} />

      {/* assign picker sheet */}
      <Sheet open={!!assignItem} onClose={() => setAssignItem(null)} title={assignItem ? `Assign: ${assignItem.label}` : 'Assign'}>
        <View style={{ gap: 2 }}>
          <Pressable accessibilityRole="button" onPress={() => assign.mutate({ itemId: assignItem.id, assignee_id: null })}
                     style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 14, color: t.ink3 }}>Unassigned</Text>
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

      {/* item create/edit sheet */}
      <Sheet open={!!editItem} onClose={() => setEditItem(null)}
             title={editItem === 'new' ? 'Add checklist item' : 'Edit checklist item'}>
        <Field label="What needs doing?">
          <Input autoFocus value={itemForm.label}
                 onChangeText={(v) => setItemForm({ ...itemForm, label: v })} />
        </Field>
        <Field label="Hint (optional)">
          <Input value={itemForm.hint}
                 onChangeText={(v) => setItemForm({ ...itemForm, hint: v })} />
        </Field>
        <Field label="Due date (optional)" hint="YYYY-MM-DD">
          <Input value={itemForm.due_date} placeholder="2026-03-15" autoCapitalize="none"
                 onChangeText={(v) => setItemForm({ ...itemForm, due_date: v })} />
        </Field>
        <CheckRow checked={itemForm.required}
                  onChange={(v) => setItemForm({ ...itemForm, required: v })}
                  label="Required — the project isn't done until this is" />
        <Button style={{ width: '100%' }} disabled={!itemForm.label.trim() || saveItem.isPending}
                busy={saveItem.isPending} onPress={() => saveItem.mutate()}>
          {editItem === 'new' ? 'Add item' : 'Save changes'}
        </Button>
      </Sheet>

      <ConfirmDialog
        open={!!delItem} onClose={() => setDelItem(null)}
        onConfirm={() => removeItem.mutate(delItem.id)}
        busy={removeItem.isPending}
        title="Remove this checklist item?"
        body={`"${delItem?.label}" leaves the checklist. This is logged — anyone can see it was removed.`}
        confirmLabel="Remove item"
      />
      <ConfirmDialog
        open={!!pendingStatus} onClose={() => setPendingStatus(null)} danger={false}
        onConfirm={() => setStatus.mutate(pendingStatus)}
        busy={setStatus.isPending}
        title={`Mark project ${pendingStatus}?`}
        body={pendingStatus === 'done'
          ? 'Done projects stay visible on the board — you can still reopen it.'
          : 'Archived projects drop off the board but keep their history — you can bring it back anytime.'}
        confirmLabel={pendingStatus === 'done' ? 'Mark done' : 'Archive'}
      />
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
