import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  BookOpen, CalendarCheck, CalendarDays, FileText, FolderKanban, ListTodo, LogOut,
  MoreHorizontal, Check, ChevronDown, ChevronRight, NotebookPen, Settings, ShieldCheck, Sun, Users,
  Wallet,
} from 'lucide-react';
import { get } from '../lib/api';
import { atLeast, currentOrgId, orgPicked, setCurrentOrg, setOrgPicked } from '../lib/org';
import { humanize } from '../lib/labels';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar, ErrorState, Sheet, ThemePicker } from './ui';
import { NotificationBell } from './NotificationBell';

const NAV = [
  { to: '/', label: 'Today', Icon: Sun },
  { to: '/journal', label: 'Journal', Icon: NotebookPen },
  { to: '/attendance', label: 'Attendance', Icon: CalendarCheck },
  { to: '/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/budget', label: 'Budget', Icon: Wallet },
  { to: '/tasks', label: 'Tasks', Icon: ListTodo },
  { to: '/agenda', label: 'Agenda', Icon: CalendarDays },
  { to: '/documents', label: 'Papers', Icon: FileText },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/guide', label: 'Guide', Icon: BookOpen },
  { to: '/settings', label: 'Settings', Icon: Settings, admin: true },
  { to: '/admin', label: 'Admin', Icon: ShieldCheck, platform: true },
];

// bottom tab bar shows the first four; the rest live in the More sheet
const TAB_COUNT = 4;

export function AppShell() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [orgSheet, setOrgSheet] = useState(false);
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
  useEffect(() => {
    // Multi-org sessions must not silently default — only persist the fallback
    // once the user has explicitly picked (or has a single membership anyway).
    if (active && active.org_id !== currentOrgId()
        && (memberships.length <= 1 || orgPicked())) {
      setCurrentOrg(active.org_id);
    }
  }, [active, memberships.length]);
  const isAdmin = active ? atLeast(active.role, 'adviser') : false;
  const visible = NAV.filter((n) => (!n.admin || isAdmin) && (!n.platform || me.data?.is_admin));
  const tabs = visible.slice(0, TAB_COUNT);
  const overflow = visible.slice(TAB_COUNT);

  useEffect(() => {
    // /account must stay reachable for org-less users (delete, password, etc.);
    // /admin likewise — a platform admin may have no memberships at all
    const orglessOk = pathname === '/account' || pathname.startsWith('/admin');
    if (me.isSuccess && memberships.length === 0 && !orglessOk) nav('/onboarding');
  }, [me.isSuccess, memberships.length, pathname, nav]);

  useEffect(() => {
    // 2+ orgs and no explicit pick yet this visit → the picker, not a default.
    if (me.isSuccess && memberships.length > 1 && !orgPicked() && pathname !== '/orgs') {
      nav('/orgs', { replace: true });
    }
  }, [me.isSuccess, memberships.length, pathname, nav]);

  if (loading || !session) return null;

  const signOut = () => { supabase.auth.signOut(); setCurrentOrg(null); setOrgPicked(false); };

  const orgSwitcher = (
    <div>
      <span className="label-strong mb-1 block text-[10px] text-[var(--color-ink-3)]">Organization</span>
      <button
        onClick={() => setOrgSheet(true)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-3)] p-2 text-left text-sm hover:bg-[var(--color-surface)]"
      >
        <span className="min-w-0 flex-1 truncate">{active?.org_name ?? 'No org'}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--color-ink-3)]" aria-hidden />
      </button>
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
        <div className="label-strong mb-4 flex items-center justify-between text-lg">
          CounciLog
          <NotificationBell />
        </div>
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
        {/* mobile top strip — gives the bell a home on every screen */}
        <header className="sticky top-0 z-30 flex items-center justify-between bg-[var(--color-surface-2)] px-4 py-1 [border-bottom:var(--border-box)] md:hidden">
          <span className="label-strong">CounciLog</span>
          <NotificationBell />
        </header>
        <div className="mx-auto max-w-5xl p-4">
          {me.isError
            ? <ErrorState error={me.error} retry={me.refetch} />
            : <Outlet context={{ me: me.data, active }} />}
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

      {/* Org switcher — shared by the sidebar button and the More sheet */}
      <Sheet open={orgSheet} onClose={() => setOrgSheet(false)} title="Switch organization">
        <div className="space-y-1">
          {memberships.map((m) => (
            <button
              key={m.org_id}
              onClick={() => { setCurrentOrg(m.org_id); setOrgSheet(false); setMoreOpen(false); }}
              className="flex w-full items-center gap-3 rounded-[var(--radius-input)] px-3 py-3 text-left hover:bg-[var(--color-surface-3)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.org_name}</span>
                <span className="text-xs text-[var(--color-ink-3)]">{humanize(m.role)}</span>
              </span>
              {m.org_id === active?.org_id && <Check size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden />}
            </button>
          ))}
          <button
            onClick={() => { setOrgSheet(false); setMoreOpen(false); nav('/onboarding'); }}
            className="w-full rounded-[var(--radius-input)] px-3 py-3 text-left text-sm text-[var(--color-ink-3)] hover:bg-[var(--color-surface-3)]"
          >
            + Create or join another organization
          </button>
        </div>
      </Sheet>
    </div>
  );
}
