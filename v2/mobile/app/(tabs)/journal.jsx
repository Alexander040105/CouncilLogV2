/** Port of web/pages/Journal.jsx — photo + a line about what you did.
 *  ?compose=1 opens the sheet; ?notasks=1 fires the no-tasks declaration
 *  (both come from Today quick-actions via route params). */
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../../src/lib/api';
import { submitPhotoRecord } from '../../src/lib/offline';
import { todayOrg, useOrgId } from '../../src/lib/org';
import { useAuth } from '../../src/lib/auth';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { PhotoPicker } from '../../src/components/PhotoPicker';
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
      resizeMode="cover"
    />
  );
}

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
    setEditing(null); setDesc(''); setPhotos([]); setProjectId(''); setErr(null);
    setComposeOpen(true);
  };

  const openEdit = (e) => {
    setEditing(e); setDesc(e.description); setProjectId(e.project_id ?? '');
    setPhotos([]); setErr(null); setComposeOpen(true);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (editing) {
        await patch(`/orgs/${org}/journal/${editing.id}`, {
          description: desc,
          project_id: projectId || null,
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

  const byDay = (feed.data?.data ?? []).reduce((m, e) => {
    (m[e.entry_date] ??= []).push(e);
    return m;
  }, {});

  return (
    <Screen refresh={async () => { await Promise.all([feed.refetch(), projects.refetch()]); }}>
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
      {feed.isError ? <ErrorState error={feed.error} retry={feed.refetch} /> : null}
      {feed.data?.data.length === 0 ? (
        <Empty icon={<NotebookPen size={24} color={t.ink3} />} title="No journal entries yet"
               hint="Photo + a line about what you did — that's the day's record."
               action={<Button onPress={openCompose}>Log work</Button>} />
      ) : null}

      {Object.entries(byDay).map(([day, entries]) => (
        <View key={day} style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>{day}</Text>
          {entries.map((e) => (
            <Card key={e.id} style={{ gap: 8 }}>
              {e.photos.map((p) => <PhotoThumb key={p.id} org={org} photo={p} />)}
              <Text style={{ fontSize: 14, color: t.ink }}>{e.description}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View>{e.project_id ? <Chip kind="neutral" label="project" /> : null}</View>
                {canModify(e) ? (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Edit entry"
                               onPress={() => openEdit(e)}
                               style={{ minHeight: 36, minWidth: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
                      <Pencil size={14} color={t.ink2} /><Text style={{ fontSize: 12, color: t.ink2 }}>Edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Delete entry"
                               onPress={() => setDeleting(e)}
                               style={{ minHeight: 36, minWidth: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
                      <Trash2 size={14} color={t.alert} /><Text style={{ fontSize: 12, color: t.alert }}>Delete</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      ))}

      <Sheet open={composeOpen} onClose={() => { setComposeOpen(false); setEditing(null); }}
             title={editing ? 'Edit entry' : 'Log today’s work'}>
        {editing ? (
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Photos can’t be changed on an existing entry — delete and re-file to swap photos.
          </Text>
        ) : (
          <PhotoPicker photos={photos} onChange={setPhotos} />
        )}
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
