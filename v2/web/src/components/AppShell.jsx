import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  CalendarCheck, FileText, FolderKanban, LogOut, MoreHorizontal, ChevronRight,
  NotebookPen, Settings, Sun, Users,
} from 'lucide-react';
import { get } from '../lib/api';
import { atLeast, currentOrgId, setCurrentOrg } from '../lib/org';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar, Sheet, ThemePicker } from './ui';

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
  const { pathname } = useLocation();
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
    // /account must stay reachable for org-less users (delete, password, etc.)
    if (me.isSuccess && memberships.length === 0 && pathname !== '/account') nav('/onboarding');
  }, [me.isSuccess, memberships.length, pathname, nav]);

  if (loading || !session) return null;

  const signOut = () => { supabase.auth.signOut(); setCurrentOrg(null); };

  const orgSwitcher = (
    <div>
      <label htmlFor="org-switcher" className="mb-1 block text-xs font-medium text-[var(--color-ink-3)]">
        Organization
      </label>
      <select
        id="org-switcher"
        className="w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-3)] p-2 text-sm"
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

  const accountFooter = (
    <div className="space-y-3 border-t border-[var(--color-line)] pt-3">
      <Link
        to="/account"
        title="Your account"
        onClick={() => setMoreOpen(false)}
        className="flex min-w-0 items-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
      >
        <Avatar name={me.data?.profile?.display_name} url={me.data?.profile?.avatar_url} />
        <span className="min-w-0 flex-1 truncate">{me.data?.profile?.display_name ?? 'Account'}</span>
        <ChevronRight size={14} className="shrink-0 text-[var(--color-ink-3)]" aria-hidden />
      </Link>
      <div>
        <span className="label-strong mb-1 block text-[10px] text-[var(--color-ink-3)]">Theme</span>
        <ThemePicker className="w-full" />
      </div>
      <button
        onClick={signOut}
        className="label-strong flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)]"
      >
        <LogOut size={16} aria-hidden /> Sign out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col [border-right:var(--border-box)] bg-[var(--color-surface-2)] p-4 md:flex">
        <div className="label-strong mb-4 text-lg">CounciLog</div>
        <div className="mb-4">{orgSwitcher}</div>
        <nav className="flex flex-1 flex-col gap-1">
          {visible.map(({ to, label, Icon }) => (
            <NavLink
              key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `label-strong flex items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-sm ${isActive ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'text-[var(--color-ink-2)]'}`}
            >
              <Icon size={20} aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4">
          {accountFooter}
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-5xl p-4">
          <Outlet context={{ me: me.data, active }} />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex [border-top:var(--border-box)] bg-[var(--color-surface-2)] md:hidden">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `label-strong flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${isActive ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'text-[var(--color-ink-3)]'}`}
          >
            <Icon size={22} aria-hidden />{label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="label-strong flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[var(--color-ink-3)]"
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
                  `label-strong flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-3 text-sm ${isActive ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]' : 'text-[var(--color-ink-2)]'}`}
              >
                <Icon size={20} aria-hidden />{label}
              </NavLink>
            ))}
          </nav>
          {accountFooter}
        </div>
      </Sheet>
    </div>
  );
}
