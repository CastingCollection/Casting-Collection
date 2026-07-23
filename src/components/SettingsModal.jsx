import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';

export default function SettingsModal({ onClose }) {
  const { settings, setSettings, refresh } = useApp();
  const [form, setForm] = useState({ ...settings });
  const [saving, setSaving] = useState(false);

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
