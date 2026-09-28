/** Supabase client for React Native — mirrors web/src/lib/supabase.js but with
 *  AsyncStorage session persistence (SecureStore's 2KB limit can't hold a full
 *  Supabase session payload) and no URL-based session detection on native. */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // A missing env silently produces a client that fails on first call.
  // Fail loudly instead — same contract as the web build.
  throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. Add them to .env and restart with npx expo start -c.');
}

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
