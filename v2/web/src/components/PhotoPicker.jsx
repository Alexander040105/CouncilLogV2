import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ImageUp, X } from 'lucide-react';
import { useToast } from '../lib/toast';
import { Button, Skeleton } from './ui';

const MAX_BYTES = 5 * 1024 * 1024; // matches journal bucket + PhotoSign limit
const ACCEPT = 'image/jpeg,image/png,image/webp';

/** Capture-or-upload photo input. `photos` is File[]; `max` caps attachments. */
export function PhotoPicker({ photos, onChange, max = 4 }) {
  const toast = useToast();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [mirrored, setMirrored] = useState(false);
  const [ready, setReady] = useState(false);
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const urlsRef = useRef([]);

  const full = photos.length >= max;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!cameraOpen) return undefined;
    let cancelled = false;
    setCamErr(null); setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr('No camera here — use Upload instead.');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setMirrored(stream.getVideoTracks()[0]?.getSettings().facingMode === 'user');
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setCamErr(e.name === 'NotAllowedError'
          ? 'Camera blocked — allow access in the browser prompt/settings, or use Upload.'
          : 'No camera found — use Upload instead.');
      });
    return () => { cancelled = true; stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  // revoke preview object URLs on unmount
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (f) => {
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) { toast.error('Photos must be JPG, PNG, or WebP.'); return; }
    if (f.size > MAX_BYTES) { toast.error('Photo too large — 5 MB max.'); return; }
    onChange([...photos, f].slice(0, max));
    toast.success(`Photo added — ${Math.min(photos.length + 1, max)} of ${max}.`);
  };

  const remove = (i) => {
    URL.revokeObjectURL(urlsRef.current[i]);
    urlsRef.current.splice(i, 1);
    onChange(photos.filter((_, k) => k !== i));
  };

  const urlOf = (f, i) => {
    if (!urlsRef.current[i]) urlsRef.current[i] = URL.createObjectURL(f);
    return urlsRef.current[i];
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (mirrored) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (b) add(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      if (photos.length + 1 >= max) setCameraOpen(false);
    }, 'image/jpeg', 0.85);
  };

  if (cameraOpen) {
    return (
      <div className="space-y-2">
        {camErr ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] [border:var(--border-box)] p-3 text-sm text-[var(--color-ink-2)]">
            <CameraOff size={16} className="shrink-0 text-[var(--color-status-alert)]" />
            {camErr}
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-[var(--radius-card)] [border:var(--border-box)] bg-[var(--color-surface-3)]">
            {!ready && <Skeleton className="aspect-video w-full" />}
            <video
              ref={videoRef} autoPlay playsInline muted
              aria-label="Camera preview"
              className={`aspect-video w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${ready ? '' : 'absolute opacity-0'}`}
            />
          </div>
        )}
        <div className="flex gap-2">
          {!camErr && (
            <Button className="flex-1" onClick={capture} disabled={!ready} aria-label="Capture photo">
              <Camera size={16} /> Snap photo
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={() => setCameraOpen(false)}>
            {camErr ? 'Back' : 'Cancel'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative">
              <img src={urlOf(f, i)} alt={`selected photo ${i + 1}`}
                   className="h-20 w-20 rounded-[var(--radius-input)] object-cover" />
              <button
                aria-label={`Remove photo ${i + 1}`}
                className="absolute -right-1 -top-1 flex min-h-[28px] min-w-[28px] items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-ink-2)]"
                onClick={() => remove(i)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!full && (
        <div className="grid grid-cols-2 gap-2">
          <button
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-[var(--radius-card)] [border:var(--border-dash)] text-sm text-[var(--color-ink-3)]"
            onClick={() => setCameraOpen(true)}
          >
            <Camera size={18} /> Take photo
          </button>
          <button
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-[var(--radius-card)] [border:var(--border-dash)] text-sm text-[var(--color-ink-3)]"
            onClick={() => fileRef.current?.click()}
          >
            <ImageUp size={18} /> Upload
          </button>
        </div>
      )}
      {full && <div className="text-xs text-[var(--color-ink-3)]">{max} photos max — remove one to add another.</div>}
      <input
        ref={fileRef} type="file" accept={ACCEPT} capture="environment" multiple={max > 1}
        className="hidden"
        onChange={(e) => {
          [...(e.target.files ?? [])].forEach((f) => add(f));
          e.target.value = '';
        }}
      />
    </div>
  );
}
