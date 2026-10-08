/** Read-only FRF view of a project's budget — same layout as web's
 *  FinancialReport page, minus the .docx export (desktop-only). */
import { Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react-native';
import { get } from '../../../../src/lib/api';
import { useOrgId } from '../../../../src/lib/org';
import { useToast } from '../../../../src/lib/toast';
import { useTheme } from '../../../../src/lib/theme';
import { peso } from '../../../../src/lib/money';
import { Card, ErrorState, Screen, Skeleton } from '../../../../src/components/ui';

function openSigned(path, toast) {
  return get(path)
    .then((r) => Linking.openURL(r.download_url))
    .catch((e) => toast.error(e.message));
}

export default function FinancialReport() {
  const { id } = useLocalSearchParams();
  const org = useOrgId();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTheme();

  const q = useQuery({
    queryKey: ['financial-report', org, id],
    queryFn: () => get(`/orgs/${org}/projects/${id}/financial-report`),
    enabled: !!org && !!id,
  });

  if (q.isLoading) return <Screen><Skeleton style={{ height: 320 }} /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} retry={q.refetch} what="this report" /></Screen>;
  const d = q.data;
  const sig = d.signatories;
  const label = { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: t.ink3 };
  const sigRow = (role, name) => (
    <View style={{ gap: 2 }}>
      <Text style={label}>{role}</Text>
      <Text style={{ fontSize: 13, color: t.ink }}>{name ?? '____________________'}</Text>
    </View>
  );

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} color={t.ink3} />
        <Text style={{ fontSize: 14, color: t.ink3 }}>Project</Text>
      </Pressable>

      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: t.headingWeight, color: t.ink, textAlign: 'center' }}>
          Financial Report
        </Text>

        <View style={{ gap: 4 }}>
          <Text style={label}>Activity details</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Title of Activity: {d.project.title}</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Date: {d.project.target_date ?? '—'}</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>Nature: {d.project.event_type ?? '—'}</Text>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={label}>Collection and expenses</Text>
          <Text style={{ fontSize: 13, color: t.ink }}>
            Source of Fund: {d.fund.source_label ?? 'Bankbook'}
            {d.fund.withdrawn_on ? ` as of ${d.fund.withdrawn_on}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Total Fund:</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{peso(d.fund.allocated_centavos)}</Text>
          </View>
          {d.resolution?.document_title ? (
            <Text style={{ fontSize: 11, color: t.ink3 }}>Authorized by: {d.resolution.document_title}</Text>
          ) : null}
          {d.resolution?.has_file ? (
            <Pressable accessibilityRole="button"
                       style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 }}
                       onPress={() => openSigned(`/orgs/${org}/budgets/${d.resolution.budget_id}/resolution/url`, toast)}>
              <Download size={12} color={t.brand} />
              <Text style={{ fontSize: 12, color: t.brand }}>Resolution scan</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Less Expenses</Text>
          {d.expenses_by_vendor.map((g, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: t.ink3 }}>
                {i + 1}. {g.vendor ?? 'Miscellaneous'}
              </Text>
              {g.items.map((it, j) => (
                <View key={j} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 12 }}>
                  <Text style={{ flex: 1, fontSize: 13, color: t.ink }}>
                    {it.item}
                    {it.receipts.length > 0 ? (
                      <>
                        {'  '}
                        {it.receipts.map((r) => (
                          <Text key={r.id} style={{ fontSize: 11, color: t.brand }}
                                onPress={() => openSigned(`/orgs/${org}/receipts/${r.id}/url`, toast)}>
                            receipt{' '}
                          </Text>
                        ))}
                      </>
                    ) : null}
                  </Text>
                  <Text style={{ fontSize: 13, color: t.ink }}>{peso(it.amount_centavos)}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink2 }}>Total:</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink2 }}>{peso(g.subtotal_centavos)}</Text>
              </View>
            </View>
          ))}
          <View style={{ borderTopWidth: Math.max(t.boxWidth, 1), borderTopColor: t.boxColor, paddingTop: 8, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Total Expenses</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{peso(d.totals.spent_centavos)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>Total Remaining Fund</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>{peso(d.totals.remaining_centavos)}</Text>
            </View>
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, color: t.ink3 }}>
            Note: Please see attached pictures of receipts for proof of payment.
          </Text>
          {d.return ? (
            <Text style={{ fontSize: 11, color: t.ink3 }}>
              Note: The bankbook reflects a deposit of {peso(d.return.amount_centavos)} on{' '}
              {d.return.deposited_on} — the remaining fund from &quot;{d.project.title}&quot;. The total
              bank balance after the deposit is {peso(d.return.balance_after_centavos)}.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          {sigRow('Audited and prepared by', sig.auditor)}
          {sigRow('Noted by', sig.treasurer)}
          {sigRow('Recommending approval by', sig.president)}
          {sigRow('Approved by', sig.adviser)}
        </View>
      </Card>
    </Screen>
  );
}
