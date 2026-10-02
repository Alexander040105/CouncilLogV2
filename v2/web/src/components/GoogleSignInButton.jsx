/** Google's own Sign-in button (GIS) + supabase.auth.signInWithIdToken —
 *  keeps the Google flow on this page instead of redirecting the tab through
 *  <project>.supabase.co/auth/v1/authorize.
 *
 *  onLoadError()  → script/client-id missing: parent should show the
 *                   signInWithOAuth redirect fallback instead.
 *  onAuthError(m) → Google returned a credential but Supabase rejected it
 *                   (usually a client-ID/audience mismatch): show m inline.
 *
 *  Source: https://supabase.com/docs/guides/auth/social-login/auth-google */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { Skeleton } from './ui';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DARK_THEMES = new Set(['brutalist-dark', 'dark']);

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById('gis-client');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = 'gis-client';
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', resolve, { once: true });
    s.addEventListener('error', reject, { once: true });
    document.head.appendChild(s);
  });
}

/** Google gets the SHA-256 hex of the nonce; Supabase gets the raw value. */
async function makeNoncePair() {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

export function GoogleSignInButton({ onLoadError, onAuthError }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();
  // callbacks live in a ref so parent re-renders don't re-run init
  const cb = useRef({ onLoadError, onAuthError });
  cb.current = { onLoadError, onAuthError };

  useEffect(() => {
    let cancelled = false;
    const fail = () => { if (!cancelled) cb.current.onLoadError(); };

    (async () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId || !crypto.subtle) return fail();
      try { await loadGisScript(); } catch { return fail(); }
      let nonce;
      try { nonce = await makeNoncePair(); } catch { return fail(); }
      if (cancelled || !ref.current) return;

      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          use_fedcm_for_prompt: true,
          nonce: nonce.hashed,
          callback: async (res) => {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: res.credential,
              nonce: nonce.raw,
            });
            if (error) cb.current.onAuthError(error.message);
          },
        });
        ref.current.innerHTML = '';
        const width = Math.max(200, Math.min(400, ref.current.offsetWidth || 320));
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'en',
          theme: DARK_THEMES.has(theme) ? 'filled_black' : 'outline',
          width,
        });
        if (!cancelled) setReady(true);
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [theme]);

  // Our 2px border frames Google's 40px button → same 44px box as <Button>.
  return (
    <div className="w-full overflow-hidden [border:var(--border-el)]">
      {!ready && <Skeleton className="h-[40px] w-full" />}
      <div ref={ref} className="flex w-full justify-center" />
    </div>
  );
}
