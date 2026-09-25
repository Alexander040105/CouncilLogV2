import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  CalendarCheck, FileText, FolderKanban, LogOut, MoreHorizontal,
  NotebookPen, Settings, Sun, Users,
} from 'lucide-react';
import { get } from '../lib/api';
import { atLeast, currentOrgId, setCurrentOrg } from '../lib/org';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar, Sheet, ThemeToggle } from './ui';

const NAV = [
  { to: '/', label: 'Today', Icon: Sun },
  { to: '/journal', label: 'Journal', Icon: NotebookPen },
  { to: '/attendance', label: 'Attendance', Icon: CalendarCheck },
  { to: '/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/documents', label: 'Papers', Icon: FileText },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/settings', label: 'Settings', Icon: Settings, admin: true },
];

// bottom tab bar shows the first four; the rest live in the More sheet
const TAB_COUNT = 4;

export function AppShell() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/me'),
    enabled: !!session,
  });

  useEffect(() => {
    if (!loading && !session) nav('/login');
  }, [loading, session, nav]);

  const memberships = me.data?.memberships ?? [];
  const orgId = currentOrgId();
  const active = memberships.find((m) => m.org_id === orgId) ?? memberships[0];
  if (active && active.org_id !== orgId) setCurrentOrg(active.org_id);
  const isAdmin = active ? atLeast(active.role, 'adviser') : false;
  const visible = NAV.filter((n) => !n.admin || isAdmin);
  const tabs = visible.slice(0, TAB_COUNT);
  const overflow = visible.slice(TAB_COUNT);

  useEffect(() => {
    if (me.isSuccess && memberships.length === 0) nav('/onboarding');
  }, [me.isSuccess, memberships.length, nav]);

  if (loading || !session) return null;

  const signOut = () => { supabase.auth.signOut(); setCurrentOrg(null); };

  const orgSwitcher = (
    <div>
      <label htmlFor="org-switcher" className="mb-1 block text-xs font-medium text-[var(--color-ink-3)]">
        Organization
      </label>
      <select
        id="org-switcher"
        className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-3)] p-2 text-sm"
        value={active?.org_id ?? ''}
        onChange={(e) => {
          if (e.target.value === '__new') nav('/onboarding');
          else setCurrentOrg(e.target.value);
        }}
      >
        {memberships.map((m) => (
          <option key={m.org_id} value={m.org_id}>{m.org_name}</option>
        ))}
        {memberships.length === 0 && <option value="">no org</option>}
        <option value="__new">+ create or join…</option>
      </select>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface-2)] p-4 md:flex">
        <div className="mb-4 text-lg font-bold">CounciLog</div>
        <div className="mb-4">{orgSwitcher}</div>
        <nav className="flex flex-1 flex-col gap-1">
          {visible.map(({ to, label, Icon }) => (
            <NavLink
              key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded px-3 py-2 text-sm ${isActive ? 'bg-[var(--color-surface-3)] font-semibold' : 'text-[var(--color-ink-2)]'}`}
            >
              <Icon size={20} aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-sm text-[var(--color-ink-3)]"
            onClick={signOut}
          >
            <Avatar name={me.data?.profile?.display_name} url={me.data?.profile?.avatar_url} />
            <span className="flex items-center gap-1"><LogOut size={14} aria-hidden />Sign out</span>
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-5xl p-4">
          <Outlet context={{ me: me.data, active }} />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--color-line)] bg-[var(--color-surface-2)] md:hidden">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${isActive ? 'font-semibold text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]'}`}
          >
            <Icon size={22} aria-hidden />{label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[var(--color-ink-3)]"
        >
          <MoreHorizontal size={22} aria-hidden />More
        </button>
      </nav>

      {/* Mobile More sheet: overflow nav + org switcher + theme + sign out */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-4">
          {orgSwitcher}
          <nav className="flex flex-col gap-1">
            {overflow.map(({ to, label, Icon }) => (
              <NavLink
                key={to} to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded px-3 py-3 text-sm ${isActive ? 'bg-[var(--color-surface-3)] font-semibold' : 'text-[var(--color-ink-2)]'}`}
              >
                <Icon size={20} aria-hidden />{label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-[var(--color-line)] pt-3">
            <button className="flex items-center gap-2 text-sm text-[var(--color-ink-3)]" onClick={signOut}>
              <Avatar name={me.data?.profile?.display_name} url={me.data?.profile?.avatar_url} />
              <span className="flex items-center gap-1"><LogOut size={14} aria-hidden />Sign out</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
