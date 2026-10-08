/** Port of web/pages/Journal.jsx — photo + a line about what you did.
 *  ?compose=1 opens the sheet; ?notasks=1 fires the no-tasks declaration
 *  (both come from Today quick-actions via route params). */
import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../../src/lib/api';
import { submitPhotoRecord } from '../../src/lib/offline';
import { todayOrg, useOrgId } from '../../src/lib/org';
import { useAuth } from '../../src/lib/auth';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { PhotoPicker, putToSignedUrl } from '../../src/components/PhotoPicker';
import { Button, Card, Chip, ConfirmDialog, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Screen, Select, Sheet, Skeleton } from '../../src/components/ui';

function PhotoThumb({ org, photo }) {
  const { t } = useTheme();
  const q = useQuery({
    queryKey: ['photourl', photo.id],
    queryFn: () => get(`/orgs/${org}/photos/${photo.id}/url`),
    staleTime: 10 * 60 * 1000,
  });
  if (!q.data) return <Skeleton style={{ height: 160, width: '100%' }} />;
  return (
    <Image
      source={{ uri: q.data.url }}
      accessibilityLabel="work photo"
      style={{ width: '100%', maxHeight: 240, height: 240, borderRadius: t.radiusCard }}
      contentFit="cover" cachePolicy="memory-disk" recyclingKey={photo.id} transition={100}
    />
  );
}

/** Small thumbnail with a remove badge — edit-sheet only. */
function EditPhotoThumb({ org, photo, onRemove }) {
  const { t } = useTheme();
  const q = useQuery({
    queryKey: ['photourl', photo.id],
    queryFn: () => get(`/orgs/${org}/photos/${photo.id}/url`),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <View style={{ width: 88, height: 88 }}>
      {q.data
        ? <Image source={{ uri: q.data.url }} accessibilityLabel="work photo"
                 style={{ width: 88, height: 88, borderRadius: t.radiusInput }}
                 contentFit="cover" cachePolicy="memory-disk" recyclingKey={photo.id} />
        : <Skeleton style={{ height: 88, width: 88 }} />}
      <Pressable
        accessibilityRole="button" accessibilityLabel="Remove photo" hitSlop={4}
        onPress={onRemove}
        style={{
          position: 'absolute', top: 2, right: 2, width: 24, height: 24,
          borderRadius: 12, backgroundColor: t.alert,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={13} color="#fff" />
      </Pressable>
    </View>
  );
}

/** One journal entry — memoized so toggling one row doesn't re-mount every
 *  PhotoThumb in the feed (each thumb runs its own signed-URL query). */
const JournalCard = memo(function JournalCard({ e, org, canModify, onEdit, onDelete }) {
  const { t } = useTheme();
  return (
    <Card style={{ gap: 8 }}>
      {e.photos.map((p) => <PhotoThumb key={p.id} org={org} photo={p} />)}
      <Text style={{ fontSize: 14, color: t.ink }}>{e.description}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View>{e.project_id ? <Chip kind="neutral" label="Project" /> : null}</View>
        {canModify ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit entry"
                       onPress={onEdit}
                       style={{ minHeight: 36, minWidth: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
              <Pencil size={14} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Edit</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete entry"
                       onPress={onDelete}
                       style={{ minHeight: 36, minWidth: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
              <Trash2 size={14} color={t.alert} /><Text style={{ fontSize: 12, color: t.alert }}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Card>
  );
});

export default function Journal() {
  const org = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { session } = useAuth();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const [composeOpen, setComposeOpen] = useState(params.compose === '1');
  const [editing, setEditing] = useState(null);   // entry being edited
  const [deleting, setDeleting] = useState(null); // entry pending confirm
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState('');
  const [photos, setPhotos] = useState([]);
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { t } = useTheme();

  const feed = useQuery({
    queryKey: ['journal', org],
    queryFn: () => get(`/orgs/${org}/journal?pageSize=50`),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ['projects', org],
    queryFn: () => get(`/orgs/${org}/projects?pageSize=100`),
    enabled: !!org,
  });

  const noTasks = useMutation({
    mutationFn: () => post(`/orgs/${org}/attendance/no-tasks`, {}),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Marked: no tasks today.'));
      qc.invalidateQueries({ queryKey: ['attendance'] });
      router.setParams({ notasks: undefined });
    },
    onError: (e) => toast.error(e.message),
  });

  const [handledCompose, setHandledCompose] = useState(false);
  if (params.compose === '1' && !handledCompose) {
    setHandledCompose(true);
    setComposeOpen(true);
  }
  useEffect(() => {
    if (params.notasks === '1') noTasks.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.notasks]);

  const canModify = (e) =>
    (e.member_id === session?.user?.id && e.entry_date === todayOrg()) ||
    active?.role === 'owner';

  const openCompose = () => {
    setEditing(null); setDesc(''); setPhotos([]); setProjectId('');
    setRemovedIds(new Set()); setErr(null);
    setComposeOpen(true);
  };

  const openEdit = (e) => {
    setEditing(e); setDesc(e.description); setProjectId(e.project_id ?? '');
    setPhotos([]); setRemovedIds(new Set()); setErr(null); setComposeOpen(true);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (editing) {
        const uploaded = [];
        for (const f of photos) {
          const sign = await post(`/orgs/${org}/journal/photos/sign`,
            { mime: f.type ?? f.mime, byte_size: f.size ?? f.byte_size });
          await putToSignedUrl(sign.upload_url, f);
          uploaded.push({ storage_path: sign.path, mime: f.type ?? f.mime, byte_size: f.size ?? f.byte_size });
        }
        await patch(`/orgs/${org}/journal/${editing.id}`, {
          description: desc,
          project_id: projectId || null,
          add_photos: uploaded.length ? uploaded : null,
          remove_photo_ids: removedIds.size ? [...removedIds] : null,
        });
        toast.success('Entry updated.');
      } else {
        const r = await submitPhotoRecord({
          orgId: org,
          signPath: `/orgs/${org}/journal/photos/sign`,
          photos,
          recordPath: `/orgs/${org}/journal`,
          recordBody: {
            description: desc,
            project_id: projectId || null,
            photos: '{{photos}}',
          },
        });
        toast.success(isQueued(r)
          ? 'Saved on this device — sends when you’re back online.'
          : 'Entry posted — day documented.');
      }
      setComposeOpen(false); setEditing(null); setDesc(''); setPhotos([]); setProjectId('');
      setRemovedIds(new Set());
      qc.invalidateQueries({ queryKey: ['journal', org] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e) {
      setErr(e.message);
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const remove = useMutation({
    mutationFn: (entry) => del(`/orgs/${org}/journal/${entry.id}`),
    onSuccess: () => {
      toast.success('Entry deleted.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['journal', org] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => { setDeleting(null); toast.error(e.message); },
  });

  const sections = useMemo(() => {
    const m = {};
    for (const e of feed.data?.data ?? []) (m[e.entry_date] ??= []).push(e);
    return Object.entries(m).map(([day, data]) => ({ title: day, data }));
  }, [feed.data]);

  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([feed.refetch(), projects.refetch()]); } finally { setRefreshing(false); }
  };

  const header = (
    <View style={{ gap: 14, marginBottom: 6 }}>
      <PageHeader
        title="Daily Journal"
        description="Photo + a line about what you did — that's the day's record."
        action={<Button onPress={openCompose}><Plus size={16} color={t.accentFg} /><Text style={{ color: t.accentFg, fontWeight: '700' }}>Log work</Text></Button>}
      />
      <HintBanner id="journal">
        Entries here prove your duty day — a photo is optional but encouraged. Off-day
        filings count as extra duty.
      </HintBanner>
      {feed.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {feed.isError ? <ErrorState error={feed.error} retry={feed.refetch} what="the journal" /> : null}
    </View>
  );

  return (
    <Screen scroll={false} pad={0}>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(e) => e.id}
        renderSectionHeader={({ section }) => (
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>{section.title}</Text>
        )}
        renderItem={({ item: e }) => (
          <JournalCard e={e} org={org} canModify={canModify(e)}
                       onEdit={() => openEdit(e)} onDelete={() => setDeleting(e)} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={feed.isSuccess ? (
          <Empty icon={<NotebookPen size={24} color={t.ink3} />} title="No journal entries yet"
                 hint="Photo + a line about what you did — that's the day's record."
                 action={<Button onPress={openCompose}>Log work</Button>} />
        ) : null}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        SectionSeparatorComponent={() => <View style={{ height: 14 }} />}
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom + 72 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ink3} />}
      />

      <Sheet open={composeOpen} onClose={() => { setComposeOpen(false); setEditing(null); }}
             title={editing ? 'Edit entry' : 'Log today’s work'}>
        {editing && (editing.photos ?? []).filter((p) => !removedIds.has(p.id)).length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {editing.photos.filter((p) => !removedIds.has(p.id)).map((p) => (
              <EditPhotoThumb key={p.id} org={org} photo={p}
                              onRemove={() => setRemovedIds((prev) => new Set([...prev, p.id]))} />
            ))}
          </View>
        ) : null}
        {editing
          ? <Field label="Add photos"><PhotoPicker photos={photos} onChange={setPhotos} /></Field>
          : <PhotoPicker photos={photos} onChange={setPhotos} />}
        {editing && removedIds.size > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setRemovedIds(new Set())}
                     style={{ minHeight: 32, alignSelf: 'flex-start', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12, color: t.brand }}>
              Undo photo removal ({removedIds.size} marked)
            </Text>
          </Pressable>
        ) : null}
        <Field label="What did you do?">
          <Input value={desc} onChangeText={setDesc} multiline
                 placeholder="Delivered concept paper to SD office" />
        </Field>
        <Field label="Project (optional)">
          <Select
            value={projectId}
            onChange={setProjectId}
            placeholder="—"
            accessibilityLabel="Project"
            options={[{ value: '', label: 'No project' }, ...(projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.title }))]}
          />
        </Field>
        {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
        <Button style={{ width: '100%' }} onPress={submit} disabled={busy || !desc.trim()} busy={busy}>
          {editing ? 'Save changes' : 'Post entry'}
        </Button>
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        busy={remove.isPending}
        title="Delete this entry?"
        body={`Deleting it removes the proof for ${deleting?.entry_date} — that day becomes unaccounted unless another entry exists. You can re-file or declare no tasks.`}
        confirmLabel="Delete entry"
      />
    </Screen>
  );
}
