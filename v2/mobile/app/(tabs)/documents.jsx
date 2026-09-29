/** Port of web/pages/Documents.jsx — custody list + register sheet with
 *  doc-type picker, project pre-tick flags, live ChainPreview, override chain. */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Plus, Route } from 'lucide-react-native';
import { get, post, queuedMsg } from '../../src/lib/api';
import { atLeast, useOrgId } from '../../src/lib/org';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { autoMatchedChain, collectFlagNames, visibleChainSteps } from '../../src/lib/rules';
import { Button, Card, Chip, Empty, ErrorState, Field, HintBanner, Input, PageHeader, Screen, Select, Sheet, Skeleton } from '../../src/components/ui';
import { FlagCheckboxes } from '../../src/components/RuleFields';

/** Live preview of the signatory route a new document will follow. */
function ChainPreview({ chains, docType, overrideId, eventType = null, flags = {} }) {
  const router = useRouter();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const isOwner = active ? atLeast(active.role, 'owner') : false;
  const override = (chains ?? []).find((c) => c.id === overrideId);
  const auto = overrideId ? null : autoMatchedChain(chains, docType);
  const chain = override ?? auto;
  if (!docType && !override) return null;

  if (!chain) {
    return (
      <View style={{
        flexDirection: 'row', gap: 8, alignItems: 'flex-start',
        borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.alert,
        padding: 12,
      }}>
        <AlertTriangle size={16} color={t.alert} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: t.ink2 }}>
            No signatory chain matches {docType} — this paper won’t be routed for signatures.{' '}
            {isOwner ? 'Add a chain in Settings.' : 'Ask an owner to add one in Settings.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            {isOwner ? (
              <Pressable accessibilityRole="link" onPress={() => router.push('/settings?tab=chains')} style={{ minHeight: 28, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, color: t.brand, textDecorationLine: 'underline' }}>Add a chain in Settings</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="link" onPress={() => router.push('/guide')} style={{ minHeight: 28, justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, color: t.brand, textDecorationLine: 'underline' }}>How matching works</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const steps = visibleChainSteps(chain, eventType, flags);
  return (
    <View style={{
      borderRadius: t.radiusCard, borderWidth: Math.max(t.boxWidth, 1), borderColor: t.line,
      backgroundColor: t.surface3, padding: 12, gap: 6,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Route size={15} color={t.ink2} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink2 }}>
          {override ? 'Using' : 'Will route through'}: {chain.name}
        </Text>
      </View>
      {steps.length === 0 ? (
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          This chain has no steps that apply — the document won’t route anywhere.
        </Text>
      ) : (
        <View style={{ marginLeft: 12, gap: 2 }}>
          {steps.map((s, i) => (
            <Text key={s.id} style={{ fontSize: 12, color: t.ink2 }}>
              {i + 1}. {s.label}{s.office ? <Text style={{ color: t.ink3 }}> — {s.office}</Text> : null}
            </Text>
          ))}
        </View>
      )}
      {!override ? (
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Matched automatically from the document type. Pick a chain below to override.
        </Text>
      ) : null}
    </View>
  );
}

const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Registered' },
  { id: 'routing', label: 'Out for signatures' },
  { id: 'revision', label: 'Sent back' },
  { id: 'signed', label: 'Signed' },
  { id: 'filed', label: 'Filed' },
];

export default function Documents() {
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', chain_id: '', project_id: '', flags: {} });
  const [typeSel, setTypeSel] = useState('');
  const [customType, setCustomType] = useState('');
  const [err, setErr] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

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

  // Linking a project pre-ticks its flags (the officer can still untick).
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
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Document registered — custody log started.'));
      setOpen(false); setForm({ title: '', chain_id: '', project_id: '', flags: {} }); setTypeSel(''); setCustomType('');
      qc.invalidateQueries({ queryKey: ['documents', org] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const statusKind = (s) =>
    s === 'signed' ? 'done' : ['routing', 'revision'].includes(s) ? 'pending' : s === 'filed' ? 'skip' : 'neutral';

  return (
    <Screen refresh={async () => { await Promise.all([docs.refetch(), chains.refetch(), projects.refetch()]); }}>
      <PageHeader
        title="Papers"
        description="Where physical documents are and who's signing them."
        action={canWrite ? (
          <Button onPress={() => setOpen(true)}>
            <Plus size={16} color={t.accentFg} /><Text style={{ color: t.accentFg, fontWeight: '700' }}>New document</Text>
          </Button>
        ) : null}
      />
      <HintBanner id="papers">
        This is the digital logbook for physical documents. Register a paper, then record
        every hand-off — the newest entry is where it sits now.
      </HintBanner>
      {docs.isLoading ? <Skeleton style={{ height: 192 }} /> : null}
      {docs.isError ? <ErrorState error={docs.error} retry={docs.refetch} /> : null}
      {docs.data?.data.length === 0 ? (
        <Empty icon={<FileText size={24} color={t.ink3} />} title="No documents tracked"
               hint={canWrite
                 ? 'Register a paper to start its custody log.'
                 : 'Papers are registered by officers — ask one to log a document.'}
               action={canWrite ? <Button onPress={() => setOpen(true)}>New document</Button> : null} />
      ) : null}
      {(docs.data?.data.length ?? 0) > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STATUS_FILTERS.map((f) => {
            const on = statusFilter === f.id;
            const n = f.id ? (docs.data?.data ?? []).filter((d) => d.status === f.id).length : docs.data?.data.length;
            return (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                onPress={() => setStatusFilter(f.id)}
                style={{
                  minHeight: 36, justifyContent: 'center', paddingHorizontal: 12,
                  borderRadius: t.radiusInput, borderWidth: t.boxWidth, borderColor: t.boxColor,
                  backgroundColor: on ? t.navActiveBg : t.surface2,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: on ? t.navActiveFg : t.ink2 }}>
                  {f.label} · {n}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={{ gap: 8 }}>
        {(docs.data?.data ?? []).filter((d) => !statusFilter || d.status === statusFilter).map((d) => (
          <Pressable key={d.id} accessibilityRole="button" onPress={() => router.push(`/document/${d.id}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{d.title}</Text>
                <Text style={{ fontSize: 12, color: t.ink3 }}>{d.doc_type}</Text>
              </View>
              <Chip kind={statusKind(d.status)} label={d.status === 'revision' ? 'in revision' : d.status} />
            </Card>
          </Pressable>
        ))}
      </View>

      <Sheet open={open} onClose={() => setOpen(false)} title="New document">
        <Field label="Title"><Input value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="IoT Session concept paper" /></Field>
        <Field label="Document type" hint="Picks the signing route — types that already have chains are listed.">
          <Select
            value={typeSel}
            onChange={setTypeSel}
            placeholder="choose…"
            accessibilityLabel="Document type"
            options={[...knownTypes.map((x) => ({ value: x, label: x })), { value: '__custom', label: 'custom…' }]}
          />
        </Field>
        {typeSel === '__custom' ? (
          <Field label="Custom doc type" hint="No preset — it only routes if a chain with this exact type exists.">
            <Input value={customType} onChangeText={setCustomType} placeholder="leave_request" autoCapitalize="none" />
          </Field>
        ) : null}
        <Field label="Project (optional)"
               hint="Lets steps that only apply to a certain event type fire — e.g. the RFP desk for international webinars.">
          <Select
            value={form.project_id}
            onChange={pickProject}
            accessibilityLabel="Project"
            options={[{ value: '', label: 'not tied to a project' },
              ...(projects.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.title}${p.event_type ? ` (${p.event_type})` : ''}` }))]}
          />
        </Field>
        <FlagCheckboxes flagNames={flagNames} value={form.flags}
                        onChange={(flags) => setForm({ ...form, flags })}
                        hint="These checkboxes exist because a chain step looks for them — tick what applies to this paper." />
        <ChainPreview chains={chains.data?.data} docType={docType} overrideId={form.chain_id || null}
                      eventType={linkedProject?.event_type ?? null} flags={form.flags} />
        <Field label="Override chain (optional)">
          <Select
            value={form.chain_id}
            onChange={(v) => setForm({ ...form, chain_id: v })}
            accessibilityLabel="Override chain"
            options={[{ value: '', label: 'auto-match by type' },
              ...(chains.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
        {err ? <Text style={{ fontSize: 13, color: t.alert }}>{err}</Text> : null}
        <Button style={{ width: '100%' }} onPress={() => create.mutate()} disabled={!form.title || !docType || create.isPending} busy={create.isPending}>
          Register document
        </Button>
      </Sheet>
    </Screen>
  );
}
