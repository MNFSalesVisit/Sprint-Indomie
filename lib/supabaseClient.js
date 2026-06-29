import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client-side helpers: monkey-patch auth methods to support offline behaviour.
if (typeof window !== 'undefined') {
  try {
    // Wrap getSession to return a cached offline_user when offline and no live session.
    const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
    supabase.auth.getSession = async () => {
      try {
        const result = await originalGetSession();
        const session = result?.data?.session;
        console.debug('supabase.getSession -> session:', session);
        if (session?.user) return result;

        // No live session, if offline try to return offline_user from localStorage
        if (!navigator.onLine) {
          const raw = localStorage.getItem('offline_user');
          console.debug('supabase.getSession -> offline_user:', raw, 'online:', navigator.onLine);
          if (raw) {
            const user = JSON.parse(raw);
            return { data: { session: { user, access_token: null } }, error: null };
          }
        }

        return result;
      } catch (err) {
        console.debug('supabase.getSession error', err);
        return { data: { session: null }, error: err };
      }
    };

    // Wrap signOut so we can clean up offline_user on logout across the app.
    const originalSignOut = supabase.auth.signOut.bind(supabase.auth);
    supabase.auth.signOut = async (...args) => {
      try {
        localStorage.removeItem('offline_user');
        console.debug('supabase.signOut -> removed offline_user');
      } catch (e) {
        console.debug('supabase.signOut -> failed removing offline_user', e);
      }
      return originalSignOut(...args);
    };
  } catch (e) {
    // defensive: if supabase auth shape is different, avoid crashing
    console.debug('supabaseClient patch failed', e);
  }
}
