import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import Login from './Login.jsx';
import App from '../App.jsx';

// Gates the whole app behind an active Supabase session:
//  - on mount, checks for an existing session (supabase.auth.getSession())
//  - subscribes to supabase.auth.onAuthStateChange() so sign-in / sign-out
//    (from Login.jsx or the Sidebar's "Log out" button) immediately swaps
//    the Login screen and the app in and out, with no extra plumbing needed.
export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

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
