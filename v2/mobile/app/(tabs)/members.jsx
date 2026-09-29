/** Port of web/pages/Members.jsx — Roster / Org chart segmented tabs.
 *  Tree renders as an indented list (same left-rail look as web). */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Network } from 'lucide-react-native';
import { get } from '../../src/lib/api';
import { useOrgId } from '../../src/lib/org';
import { useTheme } from '../../src/lib/theme';
import { Card, Empty, ErrorState, PageHeader, Screen, Skeleton } from '../../src/components/ui';
import { MemberManager } from '../../src/components/MemberManager';

function Node({ n, nameOf, depth = 0 }) {
  const { t } = useTheme();
  return (
    <View style={{ marginLeft: depth === 0 ? 0 : 16, borderLeftWidth: depth === 0 ? 0 : 1, borderLeftColor: t.line, paddingLeft: depth === 0 ? 0 : 12 }}>
      <View style={{ paddingVertical: 4, flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: t.ink }}>{n.title}</Text>
        <Text style={{ fontSize: 12, color: t.ink3 }}>{n.holder ? nameOf(n.holder) : 'vacant'}</Text>
      </View>
      {n.children.map((c) => <Node key={c.id} n={c} nameOf={nameOf} depth={depth + 1} />)}
    </View>
  );
}

export default function Members() {
  const org = useOrgId();
  const { t } = useTheme();
  const [tab, setTab] = useState('roster');

  const members = useQuery({
    queryKey: ['members', org],
    queryFn: () => get(`/orgs/${org}/members?pageSize=100`),
    enabled: !!org,
  });
  const chart = useQuery({
    queryKey: ['orgchart', org],
    queryFn: () => get(`/orgs/${org}/org-chart`),
    enabled: !!org && tab === 'chart',
  });
  const nameOf = (id) =>
    id ? (members.data?.data.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8)) : 'vacant';

  return (
    <Screen refresh={members.refetch}>
      <PageHeader
        title="Members"
        description="Roster, org chart, and this school year's positions."
        action={
          <View style={{
            flexDirection: 'row', gap: 2, borderRadius: t.radiusInput,
            borderWidth: t.boxWidth, borderColor: t.boxColor, padding: 2,
          }}>
            {['roster', 'chart'].map((x) => (
              <Pressable key={x} accessibilityRole="button" onPress={() => setTab(x)}
                         style={{
                           minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: t.radiusInput,
                           backgroundColor: tab === x ? t.navActiveBg : 'transparent',
                         }}>
                <Text style={{
                  fontSize: 12, fontWeight: t.labelWeight, textTransform: t.labelTransform, letterSpacing: t.labelTracking,
                  color: tab === x ? t.navActiveFg : t.ink3,
                }}>{x === 'roster' ? 'Roster' : 'Org chart'}</Text>
              </Pressable>
            ))}
          </View>
        }
      />

      {tab === 'roster' ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 12, color: t.ink3 }}>
            Owners can change roles or remove members here — changes apply on the member’s next action.
          </Text>
          <MemberManager />
        </Card>
      ) : null}

      {tab === 'chart' ? (
        <Card style={{ gap: 8 }}>
          {chart.isLoading ? <Skeleton style={{ height: 160 }} /> : null}
          {chart.isError ? <ErrorState error={chart.error} retry={chart.refetch} /> : null}
          {chart.data ? (
            <>
              <Text style={{ fontSize: 12, color: t.ink3 }}>{chart.data.school_year}</Text>
              {chart.data.data.length === 0
                ? <Empty icon={<Network size={24} color={t.ink3} />} title="No positions yet" hint="An owner can define the org chart in Settings." />
                : <View>{chart.data.data.map((n) => <Node key={n.id} n={n} nameOf={nameOf} />)}</View>}
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
