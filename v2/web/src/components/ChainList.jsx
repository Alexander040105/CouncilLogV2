/** Signatory chain as the original flat list — one row per desk, grouped by
 *  round with revision banners. Kept as an alternative to ChainFlow's cards;
 *  same props, same actions. Resolved rows show who signed and when, plus any
 *  movement/photo evidence pinned to that step. */
import { Camera, Undo2 } from 'lucide-react';
import { Button, Chip } from './ui';
import { fmtTime, MovementThumb, STATUS } from './ChainFlow';

export function ChainList({ steps, revisions, movements, currentRound,
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
            {rSteps.map((s) => {
              const meta = STATUS[s.status] ?? STATUS.pending;
              const resolved = s.status !== 'pending';
              const pinned = byStep.get(s.id) ?? [];
              const canReturn = rn === currentRound && ['signed', 'skipped'].includes(s.status);
              return (
                <div key={s.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`text-sm ${resolved ? 'line-through text-[var(--color-ink-3)]' : ''}`}>
                      {s.ord}. {s.label}
                    </div>
                    {s.office && <div className="text-xs text-[var(--color-ink-3)]">{s.office}</div>}
                    {s.note && <div className="break-words text-xs text-[var(--color-ink-3)]">note: {s.note}</div>}
                    {s.signed_at && (
                      <div className="break-words text-xs text-[var(--color-ink-3)]">
                        {nameOf(s.noted_by) ? `${nameOf(s.noted_by)} · ` : ''}{fmtTime(s.signed_at)}
                      </div>
                    )}
                    {pinned.map((m) => (
                      <div key={m.id} className="mt-1">
                        <div className="break-words text-xs text-[var(--color-ink-3)]">
                          <Camera size={11} className="mr-1 inline" />
                          {m.location_text} · {fmtTime(m.created_at)}
                          {nameOf(m.moved_by) ? ` · ${nameOf(m.moved_by)}` : ''}
                        </div>
                        {m.note && <div className="text-xs text-[var(--color-ink-2)]">{m.note}</div>}
                        {m.photo_path && <div className="mt-1 max-w-48"><MovementThumb docId={s.document_id} movement={m} /></div>}
                      </div>
                    ))}
                  </div>
                  {s.status === 'pending' ? (
                    canWrite ? (
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
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
                    ) : (
                      <Chip kind={meta.chip} icon={<meta.Icon size={11} />} label={meta.label} />
                    )
                  ) : (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <Chip kind={meta.chip} icon={<meta.Icon size={11} />} label={meta.label} />
                      {canReturn && canWrite && (
                        <Button variant="ghost" className="min-h-[36px] px-2 text-xs"
                                aria-label={`Return to ${s.label} — they sign again`}
                                onClick={() => onReturnTo(s)}>
                          <Undo2 size={12} /> Sign again
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
