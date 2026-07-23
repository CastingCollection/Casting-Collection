import { createClient } from '@supabase/supabase-js';

// Frontend Supabase client — uses the PUBLIC anon/publishable key only.
// This key is safe to ship to the browser: it has no special privileges and
// relies on Supabase Auth + (optionally) Row Level Security. NEVER put the
// service_role/secret key here — that one lives only in the backend's .env
// (see server.js), which is the trusted server that talks to Postgres.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Create a .env file at the ' +
    'project root (see .env.example) and restart the Vite dev server — Vite only reads ' +
    'env vars at startup, so changes to .env require a restart to take effect.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
