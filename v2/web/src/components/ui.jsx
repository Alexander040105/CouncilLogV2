import { Component, useEffect, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useTheme, THEMES } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { setCurrentOrg } from '../lib/org';

export function Button({ variant = 'primary', className = '', ...rest }) {
  const v = {
    primary: 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90',
    secondary: 'bg-[var(--color-surface-3)] text-[var(--color-ink)] hover:bg-[var(--hover-fill)]',
    ghost: 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)]',
    danger: 'bg-[var(--color-status-alert)] text-white hover:opacity-90',
  }[variant];
  return (
    <button
      className={`label-strong inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-input)] px-4 text-sm transition [border:var(--border-el)] hover:[box-shadow:var(--shadow-1)] active:[transform:var(--press-transform)] disabled:opacity-50 ${v} ${className}`}
      {...rest}
    />
  );
}

export function Input(props) {
  return (
    <input
      className="min-h-[44px] w-full rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
      {...props}
    />
  );
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select
      className={`min-h-[44px] rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 text-sm ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="label-strong block text-sm text-[var(--color-ink-2)]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--color-ink-3)]">{hint}</span>}
    </label>
  );
}

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-2)] p-4 ${className}`}>
      {children}
    </div>
  );
}

/** Page header: title + one plain-language line + optional right-side action. */
export function PageHeader({ title, description, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="heading-strong text-3xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const chipColors = {
  pending: '[background:var(--chip-pending-bg)] [border:var(--chip-pending-bd)] text-[var(--chip-pending-fg)]',
  done:    '[background:var(--chip-done-bg)]    [border:var(--chip-done-bd)]    text-[var(--chip-done-fg)]',
  skip:    '[background:var(--chip-skip-bg)]    [border:var(--chip-skip-bd)]    text-[var(--chip-skip-fg)]',
  alert:   '[background:var(--chip-alert-bg)]   [border:var(--chip-alert-bd)]   text-[var(--chip-alert-fg)]',
  extra:   '[background:var(--chip-extra-bg)]   [border:var(--chip-extra-bd)]   text-[var(--chip-extra-fg)]',
  neutral: '[background:var(--chip-neutral-bg)] [border:var(--chip-neutral-bd)] text-[var(--chip-neutral-fg)]',
};

/** status chip — icon is a lucide element, e.g. icon={<Check size={12} />} */
export function Chip({ kind = 'neutral', label, icon }) {
  return (
    <span className={`label-strong inline-flex items-center gap-1 rounded-[var(--chip-radius)] px-2 py-0.5 text-xs ${chipColors[kind]}`}>
      {icon}
      {label}
    </span>
  );
}

/** Empty state: icon + line + CTA. */
export function Empty({ icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] [border:var(--border-empty)] p-4 py-10 text-center">
      {icon && <div className="text-[var(--color-ink-3)]">{icon}</div>}
      <div className="heading-strong text-[var(--color-ink-2)]">{title}</div>
      {hint && <div className="max-w-xs text-sm text-[var(--color-ink-3)]">{hint}</div>}
      {action}
    </div>
  );
}

/** First-visit explainer. Dismissal persists in localStorage by `id`. */
export function HintBanner({ id, children }) {
  const KEY = `councilog.hint.${id}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(KEY) === '1');
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-3)] px-3 py-2 text-sm text-[var(--color-ink-2)]">
      <Info size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
      <span className="flex-1">{children}</span>
      <button
        aria-label="Dismiss hint"
        className="min-h-[28px] min-w-[28px] text-[var(--color-ink-3)]"
        onClick={() => { localStorage.setItem(KEY, '1'); setDismissed(true); }}
      >
        <X size={14} className="mx-auto" />
      </button>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-[var(--radius-input)] bg-[var(--color-surface-3)] ${className}`} />;
}

export function Sheet({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-[var(--radius-sheet)] [border:var(--border-box)] [box-shadow:var(--shadow-2)] bg-[var(--color-surface-2)] p-5 sm:rounded-[var(--radius-sheet)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="heading-strong text-lg">{title}</h2>
          <button onClick={onClose} className="flex min-h-[44px] min-w-[44px] items-center justify-center text-[var(--color-ink-3)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confirmation for destructive/irreversible actions. `requireText` adds a
 *  type-to-confirm gate: the confirm button stays disabled until the input
 *  matches exactly (used for account deletion). */
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger = true, busy, requireText }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const confirmed = !requireText || typed === requireText;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-ink-2)]">{body}</p>
        {requireText && open && (
          <Field label={`Type ${requireText} to confirm`}>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy || !confirmed}>
            {busy ? '…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function Avatar({ name, url, size = 'h-7 w-7', textSize = 'text-xs' }) {
  const initials = (name ?? '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return url ? (
    <img src={url} alt={name ?? ''} className={`${size} rounded-[var(--avatar-radius)] [border:var(--border-el)] object-cover`} />
  ) : (
    <span className={`flex ${size} items-center justify-center rounded-[var(--avatar-radius)] [border:var(--border-el)] bg-[var(--color-accent)] ${textSize} font-semibold text-[var(--color-accent-fg)]`}>
      {initials}
    </span>
  );
}

/** Theme picker — 4 variants: brutalist light (default) + dark, classic dark/light. */
export function ThemePicker({ className = '' }) {
  const { theme, setTheme } = useTheme();
  return (
    <select
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      aria-label="Theme"
      title="Theme"
      className={`min-h-[44px] rounded-[var(--radius-input)] [border:var(--border-el)] bg-[var(--color-surface-2)] px-2 text-sm text-[var(--color-ink-2)] ${className}`}
    >
      {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
}

/** App-shell error boundary: friendly card + reload + sign-out escape. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('app error:', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm space-y-3 text-center">
          <AlertTriangle size={28} className="mx-auto text-[var(--color-status-alert)]" />
          <h1 className="heading-strong text-lg">Something broke</h1>
          <p className="text-sm text-[var(--color-ink-3)]">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <Button className="w-full" onClick={() => location.reload()}>Reload</Button>
          <button
            className="w-full text-center text-sm text-[var(--color-ink-3)]"
            onClick={() => { supabase.auth.signOut(); setCurrentOrg(null); location.href = '/login'; }}
          >
            Sign out instead
          </button>
        </Card>
      </div>
    );
  }
}
