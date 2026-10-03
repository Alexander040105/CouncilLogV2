import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowRight, Ban, Camera, CheckCircle2, Clock, SkipForward,
  Undo2,
} from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId } from '../lib/org';
import { Button, Chip } from './ui';

export const STATUS = {
  pending:            { chip: 'pending', label: 'Awaiting signature', Icon: Clock },
  signed:             { chip: 'done',    label: 'Signed',             Icon: CheckCircle2 },
  skipped:            { chip: 'skip',    label: 'Skipped',            Icon: SkipForward },
  revision_requested: { chip: 'alert',   label: 'Sent back',          Icon: Undo2 },
  superseded:         { chip: 'neutral', label: 'Superseded',         Icon: Ban },
};

export const fmtTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** Signed-URL thumbnail for a movement's attached photo — lazy per photo. */
export function MovementThumb({ docId, movement }) {
  const org = currentOrgId();
  const q = useQuery({
    queryKey: ['mv-photo', org, movement.id],
    queryFn: () => get(`/orgs/${org}/documents/${docId}/movements/${movement.id}/photo`),
    staleTime: 60_000,
  });
  if (!q.data?.url) return null;
  return (
    <a href={q.data.url} target="_blank" rel="noreferrer"
       className="block overflow-hidden rounded-[var(--radius-input)] [border:var(--border-el)]">
      <img src={q.data.url} alt={`Photo at ${movement.location_text}`} loading="lazy" decoding="async"
           className="h-20 w-full object-cover" />
    </a>
  );
}

function StepCard({ s, isCurrent, live, pinned, nameOf, canWrite, onSign, onSkip, onSendBack, onReturnTo }) {
  const meta = STATUS[s.status] ?? STATUS.pending;
  const done = ['signed', 'skipped', 'revision_requested', 'superseded'].includes(s.status);
  // a signed/skipped desk in the live round can be sent back to — the office
  // re-signs in a new round; history rows (superseded) stay read-only
  const canReturn = live && ['signed', 'skipped'].includes(s.status);
  return (
    <div className={`min-w-0 flex-1 rounded-[var(--radius-card)] bg-[var(--color-surface-2)] p-3 md:min-w-[13rem] ${isCurrent ? 'border-2 border-[var(--color-accent)] [box-shadow:var(--shadow-1)]' : '[border:var(--border-box)]'} ${done && !isCurrent ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {s.ord}. {s.label}
          </div>
          {s.office && <div className="text-xs text-[var(--color-ink-3)]">{s.office}</div>}
        </div>
        <Chip kind={meta.chip} icon={<meta.Icon size={11} />} label={meta.label} />
      </div>

      {isCurrent && (
        <div className="label-strong mt-1 text-[11px] text-[var(--color-accent)]">
          Current desk
        </div>
      )}

      <div className="mt-1 space-y-0.5 break-words text-xs text-[var(--color-ink-3)]">
        {s.signed_at && <div>{nameOf(s.noted_by) ? `${nameOf(s.noted_by)} · ` : ''}{fmtTime(s.signed_at)}</div>}
        {s.note && <div>Note: {s.note}</div>}
      </div>

      {pinned.length > 0 && (
        <div className="mt-2 space-y-1.5 [border-top:var(--border-box)] pt-2">
          {pinned.map((m) => (
            <div key={m.id}>
              <div className="break-words text-xs text-[var(--color-ink-3)]">
                <Camera size={11} className="mr-1 inline" />
                {m.location_text} · {fmtTime(m.created_at)}
                {nameOf(m.moved_by) ? ` · ${nameOf(m.moved_by)}` : ''}
              </div>
              {m.note && <div className="text-xs text-[var(--color-ink-2)]">{m.note}</div>}
              {m.photo_path && <div className="mt-1"><MovementThumb docId={s.document_id} movement={m} /></div>}
            </div>
          ))}
        </div>
      )}

      {isCurrent && canWrite && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="secondary" className="min-h-[36px] px-2 text-xs"
                  onClick={() => onSign(s)}>Sign</Button>
          <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                  onClick={() => onSkip(s)}>Skip</Button>
          <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                  aria-label={`Send back for revision at ${s.label}`}
                  onClick={() => onSendBack(s)}>
            <Undo2 size={12} /> Send back
          </Button>
        </div>
      )}
      {canReturn && canWrite && (
        <div className="mt-2">
          <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                  aria-label={`Return to ${s.label} — they sign again`}
                  onClick={() => onReturnTo(s)}>
            <Undo2 size={12} /> Sign again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Signatory chain as process cards connected by arrows — vertical on
 *  phones, horizontal on desktop. Each card carries the step's status,
 *  who/when resolved it, and any movement+photo evidence pinned to it.
 *  Replaces the flat list visually; the custody timeline below stays the
 *  append-only record. */
export function ChainFlow({ steps, revisions, movements, currentRound,
                           nameOf, canWrite, onSign, onSkip, onSendBack, onReturnTo }) {
  const rounds = [...new Set(steps.map((s) => s.round_no))].sort((a, b) => a - b);
  const byStep = new Map();
  for (const m of movements ?? []) {
    if (!m.step_id) continue;
    if (!byStep.has(m.step_id)) byStep.set(m.step_id, []);
    byStep.get(m.step_id).push(m);
  }

  return (
    <div className="space-y-3">
      {rounds.map((rn) => {
        const rSteps = steps.filter((s) => s.round_no === rn);
        const rev = (revisions ?? []).find((r) => r.round_no === rn);
        return (
          <div key={rn} className="space-y-2">
            {rn > 1 && rev && (
              <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-status-alert)] p-2.5 text-xs text-[var(--color-ink-2)]">
                <Undo2 size={14} className="mt-0.5 shrink-0 text-[var(--color-status-alert)]" />
                <span>
                  <span className="font-medium">Returned for revision</span> — {rev.note}
                  <span className="text-[var(--color-ink-3)]">
                    {nameOf(rev.created_by) ? ` · ${nameOf(rev.created_by)}` : ''}
                    {' · '}{fmtTime(rev.created_at)}
                  </span>
                </span>
              </div>
            )}
            {rounds.length > 1 && (
              <div className="label-strong text-xs text-[var(--color-ink-3)]">
                Round {rn}{rn > 1 ? ' — revision' : ''}
              </div>
            )}
            <div className="flex flex-col md:flex-row md:items-stretch md:overflow-x-auto md:pb-1">
              {rSteps.map((s, i) => (
                <div key={s.id} className="contents">
                  {i > 0 && (
                    <div className="flex shrink-0 items-center justify-center py-1 md:px-1 md:py-0">
                      <ArrowDown size={18} className="text-[var(--color-ink-3)] md:hidden" aria-hidden />
                      <ArrowRight size={18} className="hidden text-[var(--color-ink-3)] md:block" aria-hidden />
                    </div>
                  )}
                  <StepCard
                    s={s}
                    isCurrent={s.status === 'pending' && rn === currentRound}
                    live={rn === currentRound}
                    pinned={byStep.get(s.id) ?? []}
                    nameOf={nameOf}
                    canWrite={canWrite}
                    onSign={onSign} onSkip={onSkip} onSendBack={onSendBack}
                    onReturnTo={onReturnTo}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
