/** Port of web/pages/Budget.jsx — the org's bankbook plus every project's
 *  budget at a glance. Reached from More → Budget. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from 'lucide-react-native';
import { get, post, queuedMsg } from '../../src/lib/api';
import { atLeast, todayOrg, useOrgId } from '../../src/lib/org';
import { useToast } from '../../src/lib/toast';
import { useTheme } from '../../src/lib/theme';
import { useMe, useActiveMembership } from '../../src/lib/me';
import { peso, toCentavos } from '../../src/lib/money';
import { Button, Card, Chip, Empty, ErrorState, Field, Input, Screen, Select, Sheet, Skeleton } from '../../src/components/ui';

export default function Budget() {
  const org = useOrgId();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTheme();
  const me = useMe();
  const active = useActiveMembership(me.data);
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
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['fund', org] });
    qc.invalidateQueries({ queryKey: ['budgets', org] });
  };

  const submit = async () => {
    const amount = toCentavos(form.amount);
    if (!amount) { toast.error('Enter a peso amount over 0.'); return; }
    setBusy(true);
    try {
      const r = await post(`/orgs/${org}/fund/transactions`, {
        kind: form.kind,
        amount_centavos: amount,
        transacted_on: form.on || null,
        source_label: form.source || null,
        note: form.note || null,
      });
      toast.success(queuedMsg(r, form.kind === 'deposit' ? 'Deposit recorded.' : 'Withdrawal recorded.'));
      setTxnOpen(false);
      setForm({ kind: 'deposit', amount: '', on: todayOrg(), source: '', note: '' });
      refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const txns = fund.data?.transactions ?? [];
  const rows = budgets.data?.data ?? [];

  return (
    <Screen refresh={refresh}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 28, fontWeight: t.headingWeight, color: t.ink }}>Budget</Text>
          <Text style={{ fontSize: 13, color: t.ink3 }}>
            The council&apos;s bankbook — what came in, what went out, and what each project was allocated.
          </Text>
        </View>
        {canWrite ? (
          <Button variant="secondary" style={{ minHeight: 40 }} onPress={() => setTxnOpen(true)}>
            <Plus size={14} color={t.ink} />
          </Button>
        ) : null}
      </View>

      {fund.isLoading ? <Skeleton style={{ height: 140 }} /> : null}
      {fund.isError ? <Card><ErrorState error={fund.error} retry={fund.refetch} what="the fund" /></Card> : null}
      {fund.isSuccess ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3 }}>Bankbook balance</Text>
          <Text style={{ fontSize: 30, fontWeight: t.headingWeight, color: t.ink }}>{peso(fund.data.balance_centavos)}</Text>
          <Text style={{ fontSize: 12, color: t.ink3 }}>Deposits minus withdrawals, all time.</Text>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <Card style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3, marginBottom: 4 }}>Project budgets</Text>
          {rows.map((b) => (
            <Pressable key={b.id} accessibilityRole="button"
                       onPress={() => router.push(`/project/${b.project_id}`)}
                       style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: t.radiusInput }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.ink }}>{b.project_title}</Text>
              <Text style={{ fontSize: 12, color: t.ink2 }}>
                {peso(b.spent_centavos)} <Text style={{ color: t.ink3 }}>of</Text> {peso(b.allocated_centavos)}
              </Text>
              <Chip kind={b.status === 'closed' ? 'done' : 'pending'}
                    label={b.status === 'closed' ? 'closed' : 'open'} />
            </Pressable>
          ))}
        </Card>
      ) : null}

      {fund.isSuccess && txns.length === 0 ? (
        <Card>
          <Empty icon={<Wallet size={24} color={t.ink3} />} title="No entries yet"
                 hint="Record the bankbook's opening balance as a deposit first, then withdrawals and returns will build the ledger." />
        </Card>
      ) : null}
      {txns.length > 0 ? (
        <Card style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3, marginBottom: 4 }}>Bankbook entries</Text>
          {txns.map((txn) => (
            <View key={txn.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 8 }}>
              {txn.kind === 'deposit'
                ? <ArrowDownLeft size={14} color={t.done} />
                : <ArrowUpRight size={14} color={t.alert} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: t.ink }}>
                  {txn.project_title ?? txn.note ?? txn.kind}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 11, color: t.ink3 }}>
                  {[txn.transacted_on, txn.source_label].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: txn.kind === 'deposit' ? t.done : t.alert }}>
                {txn.kind === 'deposit' ? '+' : '−'}{peso(txn.amount_centavos)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Sheet open={txnOpen} onClose={() => setTxnOpen(false)} title="Record a bankbook entry">
        <Field label="Kind">
          <Select value={form.kind} accessibilityLabel="Entry kind"
                  onChange={(v) => setForm({ ...form, kind: v })}
                  options={[
                    { value: 'deposit', label: 'Deposit — money in' },
                    { value: 'withdrawal', label: 'Withdrawal — money out' },
                  ]} />
        </Field>
        <Field label="Amount (₱)" hint="e.g. 1,447.25">
          <Input keyboardType="decimal-pad" value={form.amount}
                 onChangeText={(v) => setForm({ ...form, amount: v })} />
        </Field>
        <Field label="Date" hint="YYYY-MM-DD">
          <Input value={form.on} autoCapitalize="none" placeholder="2026-03-15"
                 onChangeText={(v) => setForm({ ...form, on: v })} />
        </Field>
        <Field label="Fund tag (optional)" hint="Shown on reports — e.g. TAX, CSW">
          <Input value={form.source} autoCapitalize="characters"
                 onChangeText={(v) => setForm({ ...form, source: v })} />
        </Field>
        <Field label="Note (optional)">
          <Input value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} />
        </Field>
        <Button style={{ width: '100%' }} busy={busy} onPress={submit}>Record entry</Button>
      </Sheet>
    </Screen>
  );
}
