/** Org picker — mobile analog of web /orgs. Users with 2+ memberships land
 *  here after login instead of silently defaulting to one org. */
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, LogOut, Plus } from 'lucide-react-native';
import { supabase } from '../src/lib/supabase';
import { unregisterPushToken } from '../src/lib/push';
import { currentOrgId, orgPicked, setCurrentOrg, setOrgPicked } from '../src/lib/org';
import { useMe } from '../src/lib/me';
import { useTheme } from '../src/lib/theme';
import { humanize } from '../src/lib/labels';
import { Button, Card, ErrorState, Screen } from '../src/components/ui';

export default function PickOrg() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTheme();
  const me = useMe();
  const memberships = me.data?.memberships ?? [];
  const lastUsed = currentOrgId();
  const sorted = [...memberships].sort((a, b) =>
    (a.org_id === lastUsed ? -1 : 0) - (b.org_id === lastUsed ? -1 : 0));

  // Nothing to decide: no orgs → onboarding, one org → straight in, already
  // picked this login → back where they were.
  useEffect(() => {
    if (!me.isSuccess) return;
    const list = me.data?.memberships ?? [];
    if (list.length === 0) router.replace('/onboarding');
    else if (list.length === 1 || orgPicked()) {
      if (list.length === 1) setCurrentOrg(list[0].org_id);
      setOrgPicked();
      router.replace('/');
    }
  }, [me.isSuccess, me.data, router]);

  const pick = (orgId) => { setCurrentOrg(orgId); setOrgPicked(); router.replace('/'); };

  const signOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    setCurrentOrg(null);
    setOrgPicked(false);
    qc.clear();
    router.replace('/login');
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 28, fontWeight: t.headingWeight, color: t.ink }}>Choose an organization</Text>
          <Text style={{ fontSize: 14, color: t.ink3 }}>
            You belong to {memberships.length} organizations — pick which one to open. You can switch anytime.
          </Text>
        </View>

        {me.isError ? <ErrorState error={me.error} retry={me.refetch} what="your organizations" /> : null}

        <View style={{ gap: 10 }}>
          {sorted.map((m) => (
            <Pressable key={m.org_id} accessibilityRole="button" onPress={() => pick(m.org_id)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Building2 size={20} color={t.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.ink }} numberOfLines={1}>{m.org_name}</Text>
                  <Text style={{ fontSize: 12, color: t.ink3 }}>
                    {m.org_id === lastUsed ? 'Last used · ' : ''}{humanize(m.role)}
                  </Text>
                </View>
                <ChevronRight size={16} color={t.ink3} />
              </Card>
            </Pressable>
          ))}

          <Pressable accessibilityRole="button" onPress={() => router.push('/onboarding')}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderStyle: 'dashed' }}>
              <Plus size={20} color={t.ink3} />
              <Text style={{ flex: 1, fontSize: 14, color: t.ink2 }}>Create or join another organization</Text>
              <ChevronRight size={16} color={t.ink3} />
            </Card>
          </Pressable>
        </View>

        <Button variant="ghost" onPress={signOut}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LogOut size={16} color={t.ink2} />
            <Text style={{ fontSize: 13, color: t.ink2 }}>Sign out instead</Text>
          </View>
        </Button>
      </View>
    </Screen>
  );
}
