import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';

export default function SettingsModal({ onClose }) {
  const { settings, setSettings, refresh } = useApp();
  const [form, setForm] = useState({ ...settings });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetReport, setResetReport] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    const updated = await api.saveSettings(form);
    setSettings(updated);
    refresh();
    setSaving(false);
    onClose();
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    const res = await api.uploadLogo(fd);
    setForm(f => ({ ...f, app_logo_path: res.path }));
  };

  const handleExportArchive = async () => {
    setExporting(true);
    try {
      await api.exportArchive();
    } finally {
      setExporting(false);
    }
  };

  const handleResetForNewJob = async () => {
    if (resetConfirmText !== 'RESET') return;
    setResetting(true);
    setResetReport(null);
    try {
      const { report } = await api.resetForNewJob();
      setResetReport(report);
      setResetConfirmText('');
      refresh();
    } catch (err) {
      alert('Reset failed: ' + err.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">App Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Production Name</label>
            <input className="input-field" value={form.app_production||''} onChange={e => setForm(f=>({...f, app_production:e.target.value}))} placeholder="e.g. THE ROAD HOME" />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">BG Casting Director</label>
            <input className="input-field" value={form.app_director||''} onChange={e => setForm(f=>({...f, app_director:e.target.value}))} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Assistant Name</label>
            <input className="input-field" value={form.app_assistant||''} onChange={e => setForm(f=>({...f, app_assistant:e.target.value}))} />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">App Logo</label>
            {form.app_logo_path && (
              <img src={form.app_logo_path} alt="Logo preview" className="h-16 object-contain mb-2 border rounded p-1" />
            )}
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-sm" />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Moving to a New Job</h3>
          <p className="text-xs text-gray-500 mb-3">
            Download everything in this app — every artist, headshot, call sheet, and presentation — as one file
            you can keep and open again later. Do this before resetting for a new job.
          </p>
          <button onClick={handleExportArchive} disabled={exporting} className="btn-dark text-xs">
            {exporting ? 'Preparing archive… this can take a few minutes for lots of photos' : '⬇ Download Full Archive (.zip)'}
          </button>

          <div className="mt-5 p-3 rounded-lg border border-red-200 bg-red-50">
            <h3 className="text-sm font-bold text-red-700 uppercase tracking-wide mb-1">Danger Zone</h3>
            <p className="text-xs text-red-700 mb-3">
              Permanently deletes every artist, headshot, call sheet, presentation, brief, and z-card in this app —
              for starting completely fresh on a new job. This cannot be undone. Make sure you've downloaded the
              archive above first.
            </p>
            {resetReport ? (
              <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                Done — data cleared. ({resetReport.media?.removed ?? 0} files removed from storage.)
                <button onClick={() => setResetReport(null)} className="ml-2 underline">Dismiss</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  className="input-field text-xs flex-1"
                  placeholder='Type RESET to enable'
                  value={resetConfirmText}
                  onChange={e => setResetConfirmText(e.target.value)}
                />
                <button
                  onClick={handleResetForNewJob}
                  disabled={resetConfirmText !== 'RESET' || resetting}
                  className="text-xs px-3 py-1.5 rounded font-bold bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700"
                >
                  {resetting ? 'Resetting…' : 'Reset All Data'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-gold">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
