import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, Pencil, Plus, Receipt, Trash2, X } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { atLeast, todayOrg } from '../lib/org';
import { useToast } from '../lib/toast';
import { peso, toCentavos } from '../lib/money';
import { Button, Card, Chip, Field, Input, Select, Sheet } from './ui';
import { FilePicker } from './FilePicker';

async function uploadSigned(org, signPath, f) {
  const sign = await post(signPath, { mime: f.type, byte_size: f.size });
  const put = await fetch(sign.upload_url, { method: 'PUT', body: f });
  if (!put.ok) throw new Error('File upload failed');
  return { storage_path: sign.path, mime: f.type, byte_size: f.size };
}

async function openDownload(url) {
  const r = await get(url);
  window.open(r.download_url, '_blank', 'noopener');
}

function BudgetSetup({ org, projectId, onCreated }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [resFile, setResFile] = useState(null);
  const [resDoc, setResDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const docs = useQuery({
    queryKey: ['documents', org],
    queryFn: () => get(`/orgs/${org}/documents?pageSize=100`),
    enabled: !!org,
  });
  const resolutions = (docs.data?.data ?? []).filter((d) => d.doc_type === 'board_resolution');

  const submit = async () => {
    const allocated = toCentavos(amount);
    if (!allocated) { toast.error('Enter the peso amount the resolution allocated.'); return; }
    setBusy(true);
    try {
      let resolution = null;
      if (resFile) {
        resolution = await uploadSigned(org, `/orgs/${org}/fund/resolution-sign`, resFile);
      }
      await post(`/orgs/${org}/projects/${projectId}/budget`, {
        allocated_centavos: allocated,
        resolution_id: resDoc || null,
        resolution,
        source_label: source || null,
      });
      toast.success('Budget set — the withdrawal is on the bankbook.');
      onCreated();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="space-y-3">
      <div className="label-strong text-sm">Set up this project's budget</div>
      <p className="text-sm text-[var(--color-ink-3)]">
        Enter the amount the board resolution allocated. The withdrawal lands on
        the bankbook automatically.
      </p>
      <Field label="Allocated amount (₱)" hint="e.g. 1,116.00">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Fund tag (optional)" hint="e.g. TAX, CSW — shown on the report">
        <Input value={source} maxLength={60} onChange={(e) => setSource(e.target.value)} />
      </Field>
      <Field label="Board resolution (optional)"
             hint="Attach the signed resolution so the amount can be verified — or link the tracked paper. Either, both, or skip for now.">
        <FilePicker file={resFile} onPick={setResFile} onClear={() => setResFile(null)}
                    label="Upload scan or photo" />
      </Field>
      {resolutions.length > 0 && (
        <Field label="…or link a tracked resolution">
          <Select value={resDoc} onChange={(e) => setResDoc(e.target.value)} className="w-full">
            <option value="">None</option>
            {resolutions.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </Select>
        </Field>
      )}
      <Button className="w-full" onClick={submit} disabled={busy}>
        {busy ? '…' : 'Create budget'}
      </Button>
    </Card>
  );
}

function ExpenseSheet({ open, onClose, org, budgetId, expense, onSaved }) {
  const toast = useToast();
  const isEdit = !!expense;
  const [form, setForm] = useState({
    vendor: expense?.vendor ?? '', item: expense?.item ?? '',
    amount: expense ? (expense.amount_centavos / 100).toString() : '',
    on: expense?.spent_on ?? todayOrg(), note: expense?.note ?? '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amount = toCentavos(form.amount);
    if (!form.item.trim()) { toast.error('Name the item — e.g. "Storage box (65.00 x 3pcs)".'); return; }
    if (!amount) { toast.error('Enter a peso amount over 0.'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await patch(`/orgs/${org}/expenses/${expense.id}`, {
          vendor: form.vendor || null, item: form.item.trim(),
          amount_centavos: amount, spent_on: form.on || null,
          note: form.note || null,
        });
        toast.success('Expense updated.');
      } else {
        await post(`/orgs/${org}/budgets/${budgetId}/expenses`, {
          vendor: form.vendor || null, item: form.item.trim(),
          amount_centavos: amount, spent_on: form.on || null,
          note: form.note || null,
          client_request_id: crypto.randomUUID(),
        });
        toast.success('Expense recorded.');
      }
      onSaved(); onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Edit expense' : 'Record an expense'}>
      <div className="space-y-3">
        <Field label="Store / vendor (optional)" hint="Same vendor groups items together on the report — e.g. MR. DIY">
          <Input value={form.vendor} maxLength={200}
                 onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        </Field>
        <Field label="Item" hint="Include qty/unit price if known — e.g. Lunch box (22.00 x 10pcs)">
          <Input value={form.item} maxLength={300}
                 onChange={(e) => setForm({ ...form, item: e.target.value })} />
        </Field>
        <Field label="Amount (₱)">
          <Input inputMode="decimal" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Date spent">
          <Input type="date" value={form.on}
                 onChange={(e) => setForm({ ...form, on: e.target.value })} />
        </Field>
        <Field label="Note (optional)">
          <Input value={form.note} maxLength={500}
                 onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? '…' : isEdit ? 'Save changes' : 'Record expense'}
        </Button>
      </div>
    </Sheet>
  );
}

function ReceiptRow({ org, receipt, canDelete, onDeleted }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
      <Receipt size={12} className="shrink-0" />
      <button className="underline hover:text-[var(--color-accent)]"
              onClick={() => openDownload(`/orgs/${org}/receipts/${receipt.id}/url`).catch((e) => toast.error(e.message))}>
        {receipt.mime === 'application/pdf' ? 'receipt.pdf' : 'receipt'}
      </button>
      {canDelete && (
        <button aria-label="Remove receipt"
                onClick={async () => {
                  try { await del(`/orgs/${org}/expenses/${receipt.expense_id}/receipts/${receipt.id}`); onDeleted(); }
                  catch (e) { toast.error(e.message); }
                }}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function BudgetSection({ org, projectId, active, myId }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const today = todayOrg();
  const [expenseSheet, setExpenseSheet] = useState(null); // 'new' | expense obj
  const [closeOpen, setCloseOpen] = useState(false);
  const [uploadingFor, setUploadingFor] = useState(null); // expense id
  const [resUpload, setResUpload] = useState(null); // File being uploaded

  const key = ['project-budget', org, projectId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get(`/orgs/${org}/projects/${projectId}/budget`),
    enabled: !!org,
    retry: false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['budgets', org] });
    qc.invalidateQueries({ queryKey: ['fund', org] });
  };

  const closeMut = useMutation({
    mutationFn: () => post(`/orgs/${org}/budgets/${q.data.budget.id}/close`, {}),
    onSuccess: (r) => {
      toast.success(r.return_txn
        ? `Budget closed — ${peso(r.return_txn.amount_centavos)} deposited back to the bankbook.`
        : 'Budget closed.');
      setCloseOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isError && q.error?.status !== 404) return null;

  // No budget yet
  if (q.isError && q.error?.status === 404) {
    return canWrite
      ? <BudgetSetup org={org} projectId={projectId} onCreated={refresh} />
      : (
        <Card>
          <p className="text-sm text-[var(--color-ink-3)]">
            No budget set up for this project yet — an officer can add one here.
          </p>
        </Card>
      );
  }
  if (!q.data) return null;

  const { budget, spent_centavos, remaining_centavos, expenses, withdrawal_txn } = q.data;
  const open = budget.status === 'open';
  const groups = expenses.reduce((m, e) => { (m[e.vendor ?? ''] ??= []).push(e); return m; }, {});
  const editable = (e) => (e.recorded_by === myId && e.spent_on === today) || active?.role === 'owner';

  const attachResolution = async (f) => {
    setResUpload(f);
    try {
      const file = await uploadSigned(org, `/orgs/${org}/fund/resolution-sign`, f);
      await patch(`/orgs/${org}/budgets/${budget.id}`, { resolution: file });
      toast.success('Resolution attached.');
      refresh();
    } catch (e) { toast.error(e.message); } finally { setResUpload(null); }
  };

  const uploadReceipt = async (expenseId, f) => {
    setUploadingFor(expenseId);
    try {
      const file = await uploadSigned(org, `/orgs/${org}/expenses/${expenseId}/receipts/sign`, f);
      await post(`/orgs/${org}/expenses/${expenseId}/receipts`, file);
      toast.success('Receipt attached.');
      refresh();
    } catch (e) { toast.error(e.message); } finally { setUploadingFor(null); }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="label-strong text-sm">Budget</div>
        <div className="flex items-center gap-2">
          <Chip kind={open ? 'pending' : 'done'} label={open ? 'open' : 'closed'} />
          <Link to={`/projects/${projectId}/report`} className="text-xs text-[var(--color-accent)] underline">
            Financial report
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="label-strong text-[10px] text-[var(--color-ink-3)]">Allocated</div>
          <div className="heading-strong">{peso(budget.allocated_centavos)}</div>
        </div>
        <div>
          <div className="label-strong text-[10px] text-[var(--color-ink-3)]">Spent</div>
          <div className="heading-strong">{peso(spent_centavos)}</div>
        </div>
        <div>
          <div className="label-strong text-[10px] text-[var(--color-ink-3)]">Remaining</div>
          <div className={`heading-strong ${remaining_centavos < 0 ? 'text-[var(--color-status-alert)]' : ''}`}>
            {peso(remaining_centavos)}
          </div>
        </div>
      </div>
      {withdrawal_txn && (
        <div className="text-xs text-[var(--color-ink-3)]">
          Withdrawn {withdrawal_txn.transacted_on}
          {budget.source_label ? ` · ${budget.source_label}` : ''}
        </div>
      )}

      {/* Resolution */}
      <div className="flex items-center gap-2 text-sm">
        <FileText size={14} className="shrink-0 text-[var(--color-ink-3)]" />
        {budget.has_resolution_file ? (
          <button className="text-[var(--color-accent)] underline"
                  onClick={() => openDownload(`/orgs/${org}/budgets/${budget.id}/resolution/url`)
                    .catch((e) => toast.error(e.message))}>
            Board resolution (scan)
          </button>
        ) : budget.resolution_id ? (
          <Link to={`/documents/${budget.resolution_id}`} className="text-[var(--color-accent)] underline">
            {budget.resolution_title ?? 'Board resolution'}
          </Link>
        ) : (
          <span className="text-xs text-[var(--color-ink-3)]">No resolution attached</span>
        )}
        {canWrite && open && !budget.has_resolution_file && (
          <span className="ml-auto">
            <FilePicker file={resUpload} onPick={attachResolution} onClear={() => setResUpload(null)}
                        label="Attach scan" />
          </span>
        )}
      </div>

      {/* Expenses grouped by vendor */}
      {Object.entries(groups).map(([vendor, items]) => (
        <div key={vendor || '(none)'} className="space-y-1">
          <div className="label-strong text-xs text-[var(--color-ink-3)]">{vendor || 'Expenses'}</div>
          {items.map((e) => (
            <div key={e.id} className="rounded-[var(--radius-input)] px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{e.item}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-3)]">{e.spent_on}</span>
                <span className="shrink-0 text-sm">{peso(e.amount_centavos)}</span>
                {canWrite && open && editable(e) && (
                  <>
                    <button aria-label="Edit expense" onClick={() => setExpenseSheet(e)}
                            className="text-[var(--color-ink-3)]"><Pencil size={13} /></button>
                    <button aria-label="Delete expense"
                            onClick={async () => {
                              try { await del(`/orgs/${org}/expenses/${e.id}`); toast.success('Expense removed.'); refresh(); }
                              catch (er) { toast.error(er.message); }
                            }}
                            className="text-[var(--color-ink-3)]"><Trash2 size={13} /></button>
                  </>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {e.receipts.map((r) => (
                  <ReceiptRow key={r.id} org={org} receipt={r}
                              canDelete={canWrite && open && editable(e)} onDeleted={refresh} />
                ))}
                {canWrite && open && (
                  <FilePicker file={null}
                              onPick={(f) => uploadReceipt(e.id, f)}
                              onClear={() => {}}
                              label={uploadingFor === e.id ? 'Uploading…' : '+ receipt'} />
                )}
              </div>
            </div>
          ))}
          <div className="text-right text-xs text-[var(--color-ink-3)]">
            Subtotal {peso(items.reduce((s, i) => s + i.amount_centavos, 0))}
          </div>
        </div>
      ))}

      {expenses.length === 0 && (
        <p className="text-sm text-[var(--color-ink-3)]">
          No expenses yet — each purchase gets recorded here with its receipt.
        </p>
      )}

      {canWrite && open && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setExpenseSheet('new')}>
            <Plus size={16} /> Expense
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => setCloseOpen(true)}>
            <Download size={16} className="rotate-180" /> Close budget
          </Button>
        </div>
      )}

      <ExpenseSheet open={!!expenseSheet} onClose={() => setExpenseSheet(null)}
                    org={org} budgetId={budget.id}
                    expense={expenseSheet === 'new' ? null : expenseSheet}
                    onSaved={refresh} />

      <Sheet open={closeOpen} onClose={() => setCloseOpen(false)} title="Close this budget?">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            {remaining_centavos > 0
              ? <>The remaining <b>{peso(remaining_centavos)}</b> will be recorded as a deposit back into the bankbook, and the budget will lock — no more expenses can be added.</>
              : remaining_centavos === 0
                ? 'The budget is fully spent. Closing locks it — no more expenses can be added.'
                : <span className="text-[var(--color-status-alert)]">Spending is {peso(Math.abs(remaining_centavos))} over the allocation — raise the allocated amount before closing.</span>}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button onClick={() => closeMut.mutate()}
                    disabled={remaining_centavos < 0 || closeMut.isPending}>
              {closeMut.isPending ? '…' : 'Close budget'}
            </Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}
