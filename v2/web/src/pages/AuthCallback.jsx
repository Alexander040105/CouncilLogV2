import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Skeleton } from '../components/ui';

export default function AuthCallback() {
  const nav = useNavigate();
  useEffect(() => {
    // supabase-js exchanges the code in the URL automatically (PKCE flow)
    supabase.auth.getSession().then(() => nav('/', { replace: true }));
  }, [nav]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Skeleton className="h-8 w-40" />
    </div>
  );
}
