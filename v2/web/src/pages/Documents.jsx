import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { get, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { Button, Card, Chip, Empty, Field, HintBanner, Input, PageHeader, Sheet, Skeleton } from '../components/ui';

export default function Documents() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', doc_type: '', chain_id: '' });
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
  const create = useMutation({
    mutationFn: () => post(`/orgs/${org}/documents`, {
      title: form.title, doc_type: form.doc_type, chain_id: form.chain_id || null,
    }),
    onSuccess: () => {
      toast.success('Document registered — custody log started.');
      setOpen(false); qc.invalidateQueries({ queryKey: ['documents', org] });
    },
    onError: (e) => { setErr(e.message); toast.error(e.message); },
  });

  const statusKind = (s) =>
    s === 'signed' ? 'done' : s === 'routing' ? 'pending' : s === 'filed' ? 'skip' : 'neutral';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Papers"
        description="Where physical documents are and who's signing them."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} />New document</Button>}
      />
      <HintBanner id="papers">
        This is the digital logbook for physical documents. Register a paper, then record
        every hand-off — the newest entry is where it sits now.
      </HintBanner>
      {docs.isLoading && <Skeleton className="h-48" />}
      {docs.data?.data.length === 0 && (
        <Empty icon={<FileText size={24} />} title="No documents tracked"
               hint="Register a paper to start its custody log."
               action={<Button onClick={() => setOpen(true)}>New document</Button>} />
      )}
      <div className="space-y-2">
        {docs.data?.data.map((d) => (
          <Link key={d.id} to={`/documents/${d.id}`}>
            <Card className="flex items-center justify-between hover:border-[var(--color-accent)]">
              <div>
                <div className="text-sm font-medium">{d.title}</div>
                <div className="text-xs text-[var(--color-ink-3)]">{d.doc_type}</div>
              </div>
              <Chip kind={statusKind(d.status)} label={d.status} />
            </Card>
          </Link>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="New document">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="IoT Session concept paper" /></Field>
          <Field label="Document type" hint="e.g. concept_paper, board_resolution, financial_report">
            <Input value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} />
          </Field>
          <Field label="Signatory chain (optional — auto-matched by doc type)">
            <select className="min-h-[44px] w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm"
                    value={form.chain_id} onChange={(e) => setForm({ ...form, chain_id: e.target.value })}>
              <option value="">auto</option>
              {chains.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {err && <p className="text-sm text-[var(--color-status-alert)]">{err}</p>}
          <Button className="w-full" onClick={() => create.mutate()} disabled={!form.title || !form.doc_type || create.isPending}>
            Register document
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
