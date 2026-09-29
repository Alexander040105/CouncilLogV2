import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { get, post } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { Sheet, Empty } from './ui';

/** Deep-link target for a notification's payload entity. */
function targetFor(n) {
  const { entity_type, entity_id } = n.payload ?? {};
  if (entity_type === 'task' && entity_id) return `/tasks?task=${entity_id}`;
  if (entity_type === 'project' && entity_id) return `/projects/${entity_id}`;
  if (entity_type === 'document' && entity_id) return `/documents/${entity_id}`;
  if (entity_type === 'journal') return '/journal';
  return null;
}

/** One line of human text for a notification row. */
function lineFor(n) {
  const p = n.payload ?? {};
  if (n.kind === 'assigned') return `${p.by ?? 'Someone'} assigned you: ${p.title ?? ''}`;
  if (n.kind === 'task_commented') return `${p.by ?? 'Someone'} commented on ${p.title ?? 'a task'}`;
  if (n.kind === 'task_due_soon') return `"${p.title ?? 'A task'}" is due tomorrow`;
  if (n.kind === 'duty_reminder') return "You're on duty today and haven't filed yet";
  return p.title ?? 'Notification';
}

function ago(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const org = currentOrgId();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const notifs = useQuery({
    queryKey: ['notifications', org],
    queryFn: () => get(`/orgs/${org}/notifications`),
    enabled: !!org,
    refetchInterval: 30_000,  // the badge poll — cheap endpoint, keeps it fresh
  });
  const unread = notifs.data?.unread ?? 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications', org] });

  const markRead = useMutation({
    mutationFn: (ids) => post(`/orgs/${org}/notifications/read`, { ids }),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => post(`/orgs/${org}/notifications/read-all`),
    onSuccess: invalidate,
  });

  const open_ = (n) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const target = targetFor(n);
    setOpen(false);
    if (target) nav(target);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-input)] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)]"
        aria-label={unread ? `Notifications — ${unread} unread` : 'Notifications'}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="label-strong absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-status-alert)] px-1 text-[10px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        <div className="space-y-2">
          {notifs.data?.data.length === 0 && (
            <Empty icon={<Bell size={22} />} title="All quiet"
                   hint="Assignments and reminders land here — nothing yet." />
          )}
          {notifs.data?.data.map((n) => (
            <button
              key={n.id}
              onClick={() => open_(n)}
              className={`flex w-full items-start gap-2 rounded-[var(--radius-input)] px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)] ${n.read_at ? 'text-[var(--color-ink-3)]' : 'font-medium'}`}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-[var(--color-accent)]'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block">{lineFor(n)}</span>
                <span className="text-xs text-[var(--color-ink-3)]">{ago(n.created_at)}</span>
              </span>
            </button>
          ))}
          {unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              className="label-strong flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-input)] text-sm text-[var(--color-accent)] hover:bg-[var(--color-surface-3)]"
            >
              <CheckCheck size={16} /> Mark all read
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
