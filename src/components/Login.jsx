import { useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Minimal sign-in screen for the 3-person team. There is intentionally no
// sign-up form and no "forgot password" flow — accounts are created directly
// in the Supabase dashboard by the app owner, so this only ever needs to
// authenticate an existing user.
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message || 'Sign in failed. Please check your email and password.');
    }
    // On success, the onAuthStateChange listener in AuthGate picks up the new
    // session and swaps this screen out for the app automatically.
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sidebar">
      <div className="w-full max-w-sm rounded-lg bg-content-bg p-8 shadow-xl">
        <h1 className="mb-1 text-xl font-semibold text-gray-100">Casting Collection</h1>
        <p className="mb-6 text-sm text-gray-400">Sign in to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 font-mono text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-500">
          Accounts are created by the app owner — contact them if you need access.
        </p>
      </div>
    </div>
  );
}
