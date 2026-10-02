/** Bell with unread badge → /notifications. Mount inside PageHeader action
 *  areas; the poll lives on the shared 'notifications' query key. */
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react-native';
import { get } from '../lib/api';
import { useOrgId } from '../lib/org';
import { useTheme } from '../lib/theme';

export function BellButton() {
  const { t } = useTheme();
  const router = useRouter();
  const org = useOrgId();
  const notifs = useQuery({
    queryKey: ['notifications', org],
    queryFn: () => get(`/orgs/${org}/notifications`),
    enabled: !!org,
    refetchInterval: 30_000,
  });
  const unread = notifs.data?.unread ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications — ${unread} unread` : 'Notifications'}
      onPress={() => router.push('/notifications')}
      style={{
        minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center',
        borderRadius: t.radiusInput,
      }}
    >
      <View>
        <Bell size={20} color={t.ink2} />
        {unread > 0 ? (
          <View style={{
            position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16,
            borderRadius: 999, backgroundColor: t.alert, alignItems: 'center',
            justifyContent: 'center', paddingHorizontal: 3,
          }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#ffffff' }}>
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
