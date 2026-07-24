import { useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Shown when the user arrives via a Supabase "reset password" email link.
// supabase-js (detectSessionInUrl: true) has already parsed the recovery
// token out of the URL and established a temporary session for them — this
// screen just collects a new password and calls updateUser() to set it.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || 'Could not update password.');
      return;
    }

    // Clean the recovery token out of the URL bar now that it's been used.
    window.history.replaceState(null, '', window.location.pathname);
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-sidebar">
        <div className="w-full max-w-sm rounded-lg bg-content-bg p-8 text-center shadow-xl">
          <h1 className="mb-2 text-xl font-semibold text-gray-100">Password updated</h1>
          <p className="mb-6 text-sm text-gray-400">You're signed in with your new password.</p>
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Continue to Casting Collection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-sidebar">
      <div className="w-full max-w-sm rounded-lg bg-content-bg p-8 shadow-xl">
        <h1 className="mb-1 text-xl font-semibold text-gray-100">Set a new password</h1>
        <p className="mb-6 text-sm text-gray-400">Choose a new password for your account.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-300">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-300">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
