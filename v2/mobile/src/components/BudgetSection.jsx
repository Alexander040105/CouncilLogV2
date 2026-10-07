/** Mobile port of web BudgetSection — budget setup, allocated/spent/remaining,
 *  vendor-grouped expenses with receipt upload/download, close flow. */
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Receipt } from 'lucide-react-native';
import { del, get, isQueued, patch, post, queuedMsg } from '../lib/api';
import { atLeast, todayOrg } from '../lib/org';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import { peso, toCentavos } from '../lib/money';
import { Button, Card, Chip, ConfirmDialog, Field, Input, Select, Sheet } from './ui';
import { DocPicker } from './DocPicker';
import { putToSignedUrl } from './PhotoPicker';

async function uploadSigned(signPath, f) {
  const sign = await post(signPath, { mime: f.type, byte_size: f.size });
  if (isQueued(sign)) throw new Error("You're offline — file uploads need a connection.");
  await putToSignedUrl(sign.upload_url, { uri: f.uri, type: f.type });
  return { storage_path: sign.path, mime: f.type, byte_size: f.size };
}

async function openUrl(path, toast) {
  try {
    const r = await get(path);
    await Linking.openURL(r.download_url);
  } catch (e) { toast.error(e.message); }
}

function Setup({ org, projectId, onCreated }) {
  const { t } = useTheme();
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
        resolution = await uploadSigned(`/orgs/${org}/fund/resolution-sign`, resFile);
      }
      const r = await post(`/orgs/${org}/projects/${projectId}/budget`, {
        allocated_centavos: allocated,
        resolution_id: resDoc || null,
        resolution,
        source_label: source || null,
      });
      toast.success(queuedMsg(r, 'Budget set — the withdrawal is on the bankbook.'));
      onCreated();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Budget</Text>
      <Text style={{ fontSize: 13, color: t.ink3 }}>
        Enter the amount the board resolution allocated. The withdrawal lands on the bankbook automatically.
      </Text>
      <Field label="Allocated amount (₱)" hint="e.g. 1,116.00">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      </Field>
      <Field label="Fund tag (optional)" hint="e.g. TAX, CSW — shown on the report">
        <Input value={source} autoCapitalize="characters" onChangeText={setSource} />
      </Field>
      <Field label="Board resolution (optional)"
             hint="Attach the signed resolution so the amount can be verified — or link the tracked paper. Skip it for now if it isn't on hand.">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {resFile ? (
            <Pressable accessibilityRole="button" onPress={() => setResFile(null)}
                       style={{ flex: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: t.radiusInput, borderWidth: Math.max(t.elWidth, 1), borderColor: t.elColor }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: t.ink }}>{resFile.name} — tap to remove</Text>
            </Pressable>
          ) : (
            <DocPicker onPick={setResFile} label="Upload scan" style={{ flex: 1 }} />
          )}
        </View>
      </Field>
      {resolutions.length > 0 ? (
        <Field label="…or link a tracked resolution">
          <Select value={resDoc} onChange={setResDoc} accessibilityLabel="Linked resolution"
                  options={[{ value: '', label: 'None' },
                            ...resolutions.map((d) => ({ value: d.id, label: d.title }))]} />
        </Field>
      ) : null}
      <Button style={{ width: '100%' }} busy={busy} onPress={submit}>Create budget</Button>
    </Card>
  );
}

function ExpenseForm({ org, budgetId, expense, onClose, onSaved }) {
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
      const body = {
        vendor: form.vendor || null, item: form.item.trim(),
        amount_centavos: amount, spent_on: form.on || null, note: form.note || null,
      };
      const r = isEdit
        ? await patch(`/orgs/${org}/expenses/${expense.id}`, body)
        : await post(`/orgs/${org}/budgets/${budgetId}/expenses`,
                     { ...body, client_request_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
      toast.success(queuedMsg(r, isEdit ? 'Expense updated.' : 'Expense recorded.'));
      onSaved(); onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={isEdit ? 'Edit expense' : 'Record an expense'}>
      <Field label="Store / vendor (optional)" hint="Same vendor groups items together on the report — e.g. MR. DIY">
        <Input value={form.vendor} onChangeText={(v) => setForm({ ...form, vendor: v })} />
      </Field>
      <Field label="Item" hint="Include qty/unit price if known — e.g. Lunch box (22.00 x 10pcs)">
        <Input value={form.item} onChangeText={(v) => setForm({ ...form, item: v })} />
      </Field>
      <Field label="Amount (₱)">
        <Input keyboardType="decimal-pad" value={form.amount}
               onChangeText={(v) => setForm({ ...form, amount: v })} />
      </Field>
      <Field label="Date spent" hint="YYYY-MM-DD">
        <Input value={form.on} autoCapitalize="none"
               onChangeText={(v) => setForm({ ...form, on: v })} />
      </Field>
      <Field label="Note (optional)">
        <Input value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} />
      </Field>
      <Button style={{ width: '100%' }} busy={busy} onPress={submit}>
        {isEdit ? 'Save changes' : 'Record expense'}
      </Button>
    </Sheet>
  );
}

export function BudgetSection({ org, projectId, active, myId }) {
  const { t } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const canWrite = active ? atLeast(active.role, 'officer') : false;
  const today = todayOrg();
  const [expenseSheet, setExpenseSheet] = useState(null); // 'new' | expense
  const [closeOpen, setCloseOpen] = useState(false);
  const [delExpense, setDelExpense] = useState(null);
  const [busyPath, setBusyPath] = useState(null); // expense id being uploaded to

  const key = ['project-budget', org, projectId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get(`/orgs/${org}/projects/${projectId}/budget`),
    enabled: !!org && !!projectId,
    retry: false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['budgets', org] });
    qc.invalidateQueries({ queryKey: ['fund', org] });
  };

  const removeExpense = useMutation({
    mutationFn: (id) => del(`/orgs/${org}/expenses/${id}`),
    onSuccess: (r) => {
      toast.success(queuedMsg(r, 'Expense removed.'));
      setDelExpense(null); refresh();
    },
    onError: (e) => { setDelExpense(null); toast.error(e.message); },
  });
  const closeMut = useMutation({
    mutationFn: () => post(`/orgs/${org}/budgets/${q.data.budget.id}/close`, {}),
    onSuccess: (r) => {
      toast.success(isQueued(r) ? queuedMsg(r) : (r.return_txn
        ? `Budget closed — ${peso(r.return_txn.amount_centavos)} deposited back to the bankbook.`
        : 'Budget closed.'));
      setCloseOpen(false); refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isError && q.error?.status !== 404) return null;

  if (q.isError && q.error?.status === 404) {
    return canWrite
      ? <Setup org={org} projectId={projectId} onCreated={refresh} />
      : (
        <Card>
          <Text style={{ fontSize: 13, color: t.ink3 }}>
            No budget set up for this project yet — an officer can add one here.
          </Text>
        </Card>
      );
  }
  if (!q.data) return null;

  const { budget, spent_centavos, remaining_centavos, expenses, withdrawal_txn } = q.data;
  const open = budget.status === 'open';
  const groups = expenses.reduce((m, e) => { (m[e.vendor ?? ''] ??= []).push(e); return m; }, {});
  const editable = (e) => (e.recorded_by === myId && e.spent_on === today) || active?.role === 'owner';

  const attachResolution = async (f) => {
    try {
      const file = await uploadSigned(`/orgs/${org}/fund/resolution-sign`, f);
      await patch(`/orgs/${org}/budgets/${budget.id}`, { resolution: file });
      toast.success('Resolution attached.');
      refresh();
    } catch (e) { toast.error(e.message); }
  };

  const uploadReceipt = async (expenseId, f) => {
    setBusyPath(expenseId);
    try {
      const file = await uploadSigned(`/orgs/${org}/expenses/${expenseId}/receipts/sign`, f);
      await post(`/orgs/${org}/expenses/${expenseId}/receipts`, file);
      toast.success('Receipt attached.');
      refresh();
    } catch (e) { toast.error(e.message); } finally { setBusyPath(null); }
  };

  const stat = (label, value, alert) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3 }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: t.headingWeight, color: alert ? t.alert : t.ink }}>{value}</Text>
    </View>
  );

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking, color: t.ink2 }}>Budget</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Chip kind={open ? 'pending' : 'done'} label={open ? 'open' : 'closed'} />
          <Pressable accessibilityRole="button" onPress={() => router.push(`/project/financial-report/${projectId}`)}>
            <Text style={{ fontSize: 12, color: t.brand }}>Report →</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {stat('Allocated', peso(budget.allocated_centavos))}
        {stat('Spent', peso(spent_centavos))}
        {stat('Remaining', peso(remaining_centavos), remaining_centavos < 0)}
      </View>
      {withdrawal_txn ? (
        <Text style={{ fontSize: 12, color: t.ink3 }}>
          Withdrawn {withdrawal_txn.transacted_on}{budget.source_label ? ` · ${budget.source_label}` : ''}
        </Text>
      ) : null}

      {/* Resolution */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <FileText size={14} color={t.ink3} />
        {budget.has_resolution_file ? (
          <Pressable accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center' }}
                     onPress={() => openUrl(`/orgs/${org}/budgets/${budget.id}/resolution/url`, toast)}>
            <Text style={{ fontSize: 13, color: t.brand }}>Board resolution (scan)</Text>
          </Pressable>
        ) : budget.resolution_id ? (
          <Text style={{ fontSize: 13, color: t.ink2 }}>{budget.resolution_title ?? 'Board resolution (linked)'}</Text>
        ) : (
          <Text style={{ fontSize: 12, color: t.ink3 }}>No resolution attached</Text>
        )}
      </View>
      {canWrite && open && !budget.has_resolution_file ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <DocPicker onPick={attachResolution} label="Attach resolution" />
        </View>
      ) : null}

      {/* Expenses grouped by vendor */}
      {Object.entries(groups).map(([vendor, items]) => (
        <View key={vendor || '(none)'} style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3 }}>
            {vendor || 'Expenses'}
          </Text>
          {items.map((e) => (
            <View key={e.id} style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: t.radiusInput }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, color: t.ink }}>{e.item}</Text>
                <Text style={{ fontSize: 11, color: t.ink3 }}>{e.spent_on}</Text>
                <Text style={{ fontSize: 13, color: t.ink }}>{peso(e.amount_centavos)}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4, alignItems: 'center' }}>
                {e.receipts.map((r) => (
                  <Pressable key={r.id} accessibilityRole="button"
                             style={{ flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32 }}
                             onPress={() => openUrl(`/orgs/${org}/receipts/${r.id}/url`, toast)}>
                    <Receipt size={11} color={t.brand} />
                    <Text style={{ fontSize: 11, color: t.brand }}>
                      {r.mime === 'application/pdf' ? 'receipt.pdf' : 'receipt'}
                    </Text>
                  </Pressable>
                ))}
                {canWrite && open && editable(e) ? (
                  <>
                    <Pressable accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center' }}
                               onPress={() => setExpenseSheet(e)}>
                      <Text style={{ fontSize: 11, color: t.ink3 }}>Edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center' }}
                               onPress={() => setDelExpense(e)}>
                      <Text style={{ fontSize: 11, color: t.alert }}>Remove</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
              {canWrite && open ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <DocPicker onPick={(f) => uploadReceipt(e.id, f)}
                             label={busyPath === e.id ? 'Uploading…' : '+ receipt'} />
                </View>
              ) : null}
            </View>
          ))}
          <Text style={{ fontSize: 11, color: t.ink3, textAlign: 'right' }}>
            Subtotal {peso(items.reduce((s, i) => s + i.amount_centavos, 0))}
          </Text>
        </View>
      ))}

      {expenses.length === 0 ? (
        <Text style={{ fontSize: 13, color: t.ink3 }}>
          No expenses yet — each purchase gets recorded here with its receipt.
        </Text>
      ) : null}

      {canWrite && open ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="secondary" style={{ flex: 1 }} onPress={() => setExpenseSheet('new')}>
            <Plus size={14} color={t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>Expense</Text>
          </Button>
          <Button variant="secondary" style={{ flex: 1 }} onPress={() => setCloseOpen(true)}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>Close budget</Text>
          </Button>
        </View>
      ) : null}

      {expenseSheet ? (
        <ExpenseForm org={org} budgetId={budget.id}
                     expense={expenseSheet === 'new' ? null : expenseSheet}
                     onClose={() => setExpenseSheet(null)} onSaved={refresh} />
      ) : null}

      <ConfirmDialog
        open={closeOpen} onClose={() => setCloseOpen(false)} danger={false}
        onConfirm={() => closeMut.mutate()} busy={closeMut.isPending}
        title="Close this budget?"
        body={remaining_centavos > 0
          ? `The remaining ${peso(remaining_centavos)} will be deposited back into the bankbook and the budget locks — no more expenses can be added.`
          : remaining_centavos === 0
            ? 'The budget is fully spent. Closing locks it — no more expenses can be added.'
            : `Spending is ${peso(Math.abs(remaining_centavos))} over the allocation — raise the allocated amount before closing.`}
        confirmLabel="Close budget"
      />
      <ConfirmDialog
        open={!!delExpense} onClose={() => setDelExpense(null)}
        onConfirm={() => removeExpense.mutate(delExpense.id)} busy={removeExpense.isPending}
        title="Remove this expense?"
        body={`"${delExpense?.item}" and its receipts leave the budget. This is logged.`}
        confirmLabel="Remove"
      />
    </Card>
  );
}
