import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Skeleton } from '../components/ui';

export default function AuthCallback() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  useEffect(() => {
    const next = params.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    // supabase-js exchanges the code in the URL automatically (PKCE flow)
    supabase.auth.getSession().then(() => nav(dest, { replace: true }));
  }, [nav, params]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Skeleton className="h-8 w-40" />
    </div>
  );
}
