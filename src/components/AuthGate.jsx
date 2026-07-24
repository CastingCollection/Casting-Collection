import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import Login from './Login.jsx';
import ResetPassword from './ResetPassword.jsx';
import App from '../App.jsx';

// Gates the whole app behind an active Supabase session:
//  - on mount, checks for an existing session (supabase.auth.getSession())
//  - subscribes to supabase.auth.onAuthStateChange() so sign-in / sign-out
//    (from Login.jsx or the Sidebar's "Log out" button) immediately swaps
//    the Login screen and the app in and out, with no extra plumbing needed.
//  - a "PASSWORD_RECOVERY" event fires when the user arrives via a password
//    reset email link (supabase-js parses the token out of the URL for us,
//    since detectSessionInUrl is on) — in that case we show ResetPassword
//    instead of dropping them straight into the app with a stale intent.
export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
      }
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (recovery) {
    return <ResetPassword onDone={() => setRecovery(false)} />;
  }

  if (session === undefined) {
    // Brief loading state while we check for an existing session on load.
    return (
      <div className="flex h-screen items-center justify-center bg-sidebar">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return <App />;
}
