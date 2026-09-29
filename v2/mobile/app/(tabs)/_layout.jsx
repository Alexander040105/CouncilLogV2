/** Tab bar — same split as web AppShell: Today/Journal/Attendance/Projects +
 *  More. Everything else is a pushed screen inside the tabs group (href:null
 *  keeps them out of the bar while preserving the bar on-screen). */
import { Tabs } from 'expo-router';
import { CalendarCheck, FolderKanban, MoreHorizontal, NotebookPen, Sun } from 'lucide-react-native';
import { useTheme } from '../../src/lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HIDDEN = { href: null };

export default function TabsLayout() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.navActiveFg,
        tabBarInactiveTintColor: t.ink3,
        tabBarActiveBackgroundColor: t.navActiveBg,
        tabBarStyle: {
          backgroundColor: t.surface2,
          borderTopWidth: t.boxWidth, borderTopColor: t.boxColor,
          height: 56 + insets.bottom, paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: 10, fontWeight: t.labelWeight,
          textTransform: t.labelTransform, letterSpacing: t.labelTracking,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color }) => <Sun size={22} color={color} /> }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal', tabBarIcon: ({ color }) => <NotebookPen size={22} color={color} /> }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: ({ color }) => <CalendarCheck size={22} color={color} /> }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: ({ color }) => <FolderKanban size={22} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color }) => <MoreHorizontal size={22} color={color} /> }} />
      <Tabs.Screen name="tasks" options={HIDDEN} />
      <Tabs.Screen name="documents" options={HIDDEN} />
      <Tabs.Screen name="document/[id]" options={HIDDEN} />
      <Tabs.Screen name="project/[id]" options={HIDDEN} />
      <Tabs.Screen name="members" options={HIDDEN} />
      <Tabs.Screen name="guide" options={HIDDEN} />
      <Tabs.Screen name="settings" options={HIDDEN} />
    </Tabs>
  );
}
