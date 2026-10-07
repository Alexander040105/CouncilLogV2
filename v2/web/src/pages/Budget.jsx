import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from 'lucide-react';
import { get, post } from '../lib/api';
import { atLeast, currentOrgId, todayOrg } from '../lib/org';
import { useToast } from '../lib/toast';
import { peso, toCentavos } from '../lib/money';
import { Button, Card, Chip, Empty, ErrorState, Field, Input, PageHeader, Select, Sheet, Skeleton } from '../components/ui';

/** Budget — the org's bankbook plus every project's budget at a glance. */
export default function Budget() {
  const org = currentOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const { active } = useOutletContext() ?? {};
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const [txnOpen, setTxnOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'deposit', amount: '', on: todayOrg(), source: '', note: '' });
  const [busy, setBusy] = useState(false);

  const fund = useQuery({
    queryKey: ['fund', org],
    queryFn: () => get(`/orgs/${org}/fund`),
    enabled: !!org,
  });
  const budgets = useQuery({
    queryKey: ['budgets', org],
    queryFn: () => get(`/orgs/${org}/budgets`),
    enabled: !!org,
  });

  const submit = async () => {
    const amount = toCentavos(form.amount);
    if (!amount) { toast.error('Enter a peso amount over 0.'); return; }
    setBusy(true);
    try {
      await post(`/orgs/${org}/fund/transactions`, {
        kind: form.kind,
        amount_centavos: amount,
        transacted_on: form.on || null,
        source_label: form.source || null,
        note: form.note || null,
      });
      toast.success(form.kind === 'deposit' ? 'Deposit recorded.' : 'Withdrawal recorded.');
      setTxnOpen(false);
      setForm({ kind: 'deposit', amount: '', on: todayOrg(), source: '', note: '' });
      qc.invalidateQueries({ queryKey: ['fund', org] });
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const balance = fund.data?.balance_centavos;
  const txns = fund.data?.transactions ?? [];
  const rows = budgets.data?.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budget"
        description="The council's bankbook — what came in, what went out, and what each project was allocated."
        action={canWrite && (
          <Button onClick={() => setTxnOpen(true)}><Plus size={16} /> Record entry</Button>
        )}
      />

      {fund.isLoading && <Skeleton className="h-40" />}
      {fund.isError && <ErrorState error={fund.error} retry={fund.refetch} />}
      {fund.isSuccess && (
        <Card>
          <div className="label-strong text-xs text-[var(--color-ink-3)]">Bankbook balance</div>
          <div className="heading-strong mt-1 text-3xl">{peso(balance)}</div>
          <div className="mt-1 text-sm text-[var(--color-ink-3)]">
            Deposits minus withdrawals, all time.
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="space-y-2">
          <div className="label-strong text-xs text-[var(--color-ink-3)]">Project budgets</div>
          {rows.map((b) => (
            <Link key={b.id} to={`/projects/${b.project_id}`}
                  className="flex items-center gap-3 rounded-[var(--radius-input)] px-2 py-2 hover:bg-[var(--color-surface-3)]">
              <span className="min-w-0 flex-1 truncate text-sm">{b.project_title}</span>
              <span className="shrink-0 text-sm">{peso(b.spent_centavos)} <span className="text-[var(--color-ink-3)]">of</span> {peso(b.allocated_centavos)}</span>
              <Chip kind={b.status === 'closed' ? 'done' : 'pending'}
                    label={b.status === 'closed' ? 'closed' : 'open'} />
            </Link>
          ))}
        </Card>
      )}

      {fund.isSuccess && txns.length === 0 && (
        <Empty icon={<Wallet size={24} />} title="No entries yet"
               hint="Record the bankbook's opening balance as a deposit first, then withdrawals and returns will build the ledger." />
      )}
      {txns.length > 0 && (
        <Card className="space-y-1">
          <div className="label-strong mb-1 text-xs text-[var(--color-ink-3)]">Bankbook entries</div>
          {txns.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-[var(--radius-input)] px-2 py-2">
              {t.kind === 'deposit'
                ? <ArrowDownLeft size={15} className="shrink-0 text-[var(--color-status-done)]" />
                : <ArrowUpRight size={15} className="shrink-0 text-[var(--color-status-alert)]" />}
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.project_title ?? t.note ?? t.kind}
                {t.project_title && t.source_label ? <span className="text-[var(--color-ink-3)]"> · {t.source_label}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-ink-3)]">{t.transacted_on}</span>
              <span className={`shrink-0 text-sm ${t.kind === 'deposit' ? 'text-[var(--color-status-done)]' : 'text-[var(--color-status-alert)]'}`}>
                {t.kind === 'deposit' ? '+' : '−'}{peso(t.amount_centavos)}
              </span>
            </div>
          ))}
        </Card>
      )}

      <Sheet open={txnOpen} onClose={() => setTxnOpen(false)} title="Record a bankbook entry">
        <div className="space-y-3">
          <Field label="Kind">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="w-full">
              <option value="deposit">Deposit — money in</option>
              <option value="withdrawal">Withdrawal — money out</option>
            </Select>
          </Field>
          <Field label="Amount (₱)" hint="e.g. 1,447.25">
            <Input inputMode="decimal" value={form.amount}
                   onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.on}
                   onChange={(e) => setForm({ ...form, on: e.target.value })} />
          </Field>
          <Field label="Fund tag (optional)" hint="Shown on reports — e.g. TAX, CSW">
            <Input value={form.source} maxLength={60}
                   onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </Field>
          <Field label="Note (optional)">
            <Input value={form.note} maxLength={500}
                   onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? '…' : 'Record entry'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
