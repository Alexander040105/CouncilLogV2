import { useRef } from 'react';
import { FileUp, X } from 'lucide-react';
import { useToast } from '../lib/toast';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 5 * 1024 * 1024; // matches the API's FileSign limit

/** Pick a single receipt/resolution file (image or PDF). Calls
 *  `onPick(File)`; `file` shows the current pick with a clear button. */
export function FilePicker({ file, onPick, onClear, label = 'Attach file' }) {
  const toast = useToast();
  const ref = useRef(null);

  const pick = (f) => {
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) {
      toast.error('Files must be a photo (JPG, PNG, WebP) or a PDF.');
      return;
    }
    if (f.size > MAX_BYTES) { toast.error('File too large — 5 MB max.'); return; }
    onPick(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-input)] [border:var(--border-box)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{file.name ?? file}</span>
        <button aria-label="Remove file" onClick={onClear}
                className="flex min-h-[28px] min-w-[28px] items-center justify-center text-[var(--color-ink-3)]">
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => ref.current?.click()}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-input)] [border:var(--border-dash)] px-3 text-sm text-[var(--color-ink-3)]">
      <FileUp size={16} /> {label}
      <input ref={ref} type="file" accept={ACCEPT} className="hidden"
             onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </button>
  );
}
