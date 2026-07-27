import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import CropModal from './CropModal.jsx';

const RATES = Array.from({ length: (5000 - 200) / 50 + 1 }, (_, i) => `R ${200 + i * 50}`);
const normalizeRate = (v) => { const n = v.replace(/[Rr]/gi, '').replace(/\s+/g, '').trim(); return n ? `R ${n}` : ''; };

const FIELDS = [
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name' },
  { key: 'agent_name', label: 'Agent' },
  { key: 'role', label: 'Role' },
  { key: 'gender', label: 'Gender', type: 'gender' },
  { key: 'day_rate', label: 'Day Rate', type: 'rate' },
  { key: 'fitting_rate', label: 'Fitting Rate', type: 'rate' },
  { key: 'fitting_date', label: 'Fitting Date', type: 'date' },
  { key: 'shoot_date', label: 'Shoot Date', type: 'date' },
];

const MEASUREMENTS = [
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'inseam', label: 'Inseam' },
  { key: 'shoe_size', label: 'Shoe Size' },
  { key: 'dress_size', label: 'Dress Size' },
  { key: 'jacket_size', label: 'Jacket Size' },
  { key: 'shirt_size', label: 'Shirt Size' },
  { key: 'trouser_size', label: 'Trouser Size' },
  { key: 'hat_size', label: 'Hat Size' },
];

const CATEGORIES = [
  { value: 'new', label: 'New Artists' },
  { value: 'pencil', label: 'Pencilling' },
  { value: 'fitting', label: 'Fittings' },
  { value: 'shoot', label: 'Shoot Dates' },
  { value: 'not_available', label: 'Not Available' },
];

const DATE_TYPES = [
  { value: 'pencil',  label: 'Pencil Date',   color: '#D4880A' },
  { value: 'fitting', label: 'Fitting Date',   color: '#2E6DA4' },
  { value: 'shoot',   label: 'Shoot Date',     color: '#8B1A1A' },
  { value: 'other',   label: 'Other',          color: '#4B3F72' },
];

const parseDates = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch {}
  return [];
};

export default function ArtistModal({ artist, onClose, onSaved, onDeleted }) {
  const { refresh } = useApp();
  const isNew = !artist?.id;
  const [form, setForm] = useState(artist || { category: 'new' });
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState([]);
  const [roles, setRoles] = useState([]);
  useEffect(() => {
    api.getAgents().then(setAgents).catch(() => {});
    api.getRoles().then(setRoles).catch(() => {});
  }, []);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState('info');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  // For a brand-new artist there's no id yet to attach a headshot to (the
  // upload endpoint is POST /api/artists/:id/headshot), so the cropped photo
  // is held here as a Blob and uploaded right after the artist is created.
  const [pendingHeadshotBlob, setPendingHeadshotBlob] = useState(null);
  const [notes, setNotes] = useState(artist?.notes || '');
  const [dates, setDates] = useState(() => parseDates(artist?.additional_dates));
  const [movingCategory, setMovingCategory] = useState(false);
  const [categoryMoved, setCategoryMoved] = useState(null); // label of category just moved to
  const [newDateType, setNewDateType] = useState('pencil');
  const [newDateVal, setNewDateVal] = useState('');
  const [newDateLabel, setNewDateLabel] = useState('');

  const addDate = () => {
    if (!newDateVal) return;
    setDates(d => [...d, { type: newDateType, date: newDateVal, label: newDateLabel.trim() }]);
    setNewDateVal('');
    setNewDateLabel('');
  };
  const removeDate = async (i) => {
    const newDates = dates.filter((_, idx) => idx !== i);
    setDates(newDates);
    if (!isNew && artist?.id) {
      try {
        await api.updateArtist(artist.id, { ...form, notes, additional_dates: JSON.stringify(newDates) });
        refresh();
      } catch {}
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Changing the category dropdown used to just update local form state,
  // requiring the user to also remember to click "Save Artist" for the move
  // to actually happen — unlike every other move action in the app (bulk
  // move, per-card quick-move buttons), which is a single immediate click.
  // For an existing artist we now persist the category change right away,
  // matching that pattern, so the move happens the instant it's selected.
  const handleCategoryChange = async (newCategory) => {
    set('category', newCategory);
    setCategoryMoved(null);
    if (isNew || !artist?.id || newCategory === artist.category) return;
    setMovingCategory(true);
    try {
      await api.bulkCategory([artist.id], newCategory);
      refresh();
      setCategoryMoved(CATEGORIES.find(c => c.value === newCategory)?.label || newCategory);
    } catch (err) {
      alert('Failed to move artist: ' + err.message);
      set('category', artist.category); // revert the dropdown on failure
    } finally {
      setMovingCategory(false);
    }
  };

  // Uploads a pending (pre-creation) cropped headshot now that the artist
  // has a real id, and returns the saved record with headshot_path filled in.
  const uploadPendingHeadshot = async (savedArtist) => {
    if (!pendingHeadshotBlob || !savedArtist?.id) return savedArtist;
    const fd = new FormData();
    fd.append('headshot', pendingHeadshotBlob, 'headshot.jpg');
    const result = await api.uploadHeadshot(savedArtist.id, fd);
    setPendingHeadshotBlob(null);
    return { ...savedArtist, headshot_path: result.headshot_path };
  };

  const handleSave = async () => {
    if (!form.first_name?.trim()) return alert('First name is required');
    setSaving(true);
    try {
      const data = { ...form, notes, additional_dates: JSON.stringify(dates) };
      let saved;
      if (isNew) {
        saved = await api.createArtist(data);
        saved = await uploadPendingHeadshot(saved);
      } else {
        saved = await api.updateArtist(artist.id, data);
      }
      refresh();
      onSaved?.(saved);
    } catch (err) {
      if (err.status === 409) {
        if (confirm('An artist with this name already exists. Add anyway?')) {
          const data = { ...form, notes, additional_dates: JSON.stringify(dates) };
          let saved = await api.createArtist(data, true);
          saved = await uploadPendingHeadshot(saved);
          refresh();
          onSaved?.(saved);
        }
      } else {
        alert(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${form.first_name} ${form.last_name || ''}?`)) return;
    setDeleting(true);
    await api.deleteArtist(artist.id);
    refresh();
    onDeleted?.();
    setDeleting(false);
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async (dataUrl) => {
    setCropSrc(null);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (!artist?.id) {
      // Brand-new artist — no id to upload against yet. Hold the cropped
      // photo locally (preview it via the data URL) and upload it once
      // handleSave() has created the artist and has a real id.
      setPendingHeadshotBlob(blob);
      setForm(f => ({ ...f, headshot_path: dataUrl }));
      return;
    }
    setUploadingPhoto(true);
    const fd = new FormData();
    fd.append('headshot', blob, 'headshot.jpg');
    const result = await api.uploadHeadshot(artist.id, fd);
    setForm(f => ({ ...f, headshot_path: result.headshot_path }));
    setUploadingPhoto(false);
    refresh();
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b bg-charcoal text-white rounded-t-xl">
          <h2 className="text-lg font-bold text-gold">
            {isNew ? 'New Artist' : `${form.first_name || ''} ${form.last_name || ''}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-gray-50">
          {['info', 'dates', 'measurements', 'notes'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-semibold capitalize transition-colors ${tab === t ? 'border-b-2 border-gold text-gold' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'dates' ? `Dates${dates.length ? ` (${dates.length})` : ''}` : t}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'info' && (
            <div className="space-y-4">
              {/* Headshot */}
              <div className="flex items-start gap-4">
                <div className="relative w-28 h-36 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 group">
                  {form.headshot_path ? (
                    <img src={form.headshot_path} alt="Headshot" className="w-full h-full object-cover object-center" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">👤</div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <span className="text-white text-xs font-bold text-center px-2">
                      {uploadingPhoto ? 'Uploading…' : form.headshot_path ? '🔄 Replace Photo' : '📷 Add Photo'}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
                  </label>
                </div>
                <div className="flex-1" />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600 uppercase tracking-wide">Category</label>
                <select className="input-field" value={form.category||'new'} disabled={movingCategory} onChange={e => handleCategoryChange(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                {!isNew && (movingCategory || categoryMoved) && (
                  <p className="text-xs mt-1 font-semibold text-green-600">
                    {movingCategory ? 'Moving…' : `✓ Moved to ${categoryMoved}`}
                  </p>
                )}
              </div>

              {/* Core fields */}
              <div className="grid grid-cols-2 gap-3">
                {FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold mb-1 text-gray-600 uppercase tracking-wide">
                      {f.label}{f.required && ' *'}
                    </label>
                    {f.type === 'gender' ? (
                      <select className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
                        <option value="">Select…</option>
                        <option>Male</option>
                        <option>Female</option>
                        <option>Male/Female</option>
                      </select>
                    ) : f.type === 'rate' ? (
                      <>
                        <input list={`rates-${f.key}`} className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, normalizeRate(e.target.value))} onBlur={e => set(f.key, normalizeRate(e.target.value))} placeholder="Type or pick…" />
                        <datalist id={`rates-${f.key}`}>
                          {RATES.map(r => <option key={r} value={r} />)}
                        </datalist>
                      </>
                    ) : f.key === 'agent_name' ? (
                      <>
                        <input list="modal-agents-datalist" className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder="Type to search agents…" />
                        <datalist id="modal-agents-datalist">
                          {agents.map(a => <option key={a.id} value={a.name} />)}
                        </datalist>
                      </>
                    ) : f.key === 'role' ? (
                      <>
                        <input list="modal-roles-datalist" className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder="Type or pick role…" />
                        <datalist id="modal-roles-datalist">
                          {roles.map(r => <option key={r} value={r} />)}
                        </datalist>
                      </>
                    ) : (
                      <input
                        type={f.type || 'text'}
                        className="input-field"
                        value={form[f.key] || ''}
                        onChange={e => set(f.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'dates' && (
            <div className="space-y-4">
              {/* Existing single dates for reference */}
              {(form.fitting_date || form.shoot_date) && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 space-y-1">
                  {form.fitting_date && <div><span className="font-semibold text-blue-700">Fitting:</span> {form.fitting_date}</div>}
                  {form.shoot_date && <div><span className="font-semibold text-red-700">Shoot:</span> {form.shoot_date}</div>}
                </div>
              )}

              {/* Add new date */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
                <p className="text-xs font-bold uppercase text-gray-500 tracking-wider">Add Date</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">Type</label>
                    <select className="input-field mt-1 text-sm" value={newDateType} onChange={e => setNewDateType(e.target.value)}>
                      {DATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">Date</label>
                    <input type="date" className="input-field mt-1 text-sm" value={newDateVal} onChange={e => setNewDateVal(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Label / Note <span className="font-normal text-gray-400">(optional)</span></label>
                  <input className="input-field mt-1 text-sm" placeholder="e.g. SHOOTDAY 3, BG Police…" value={newDateLabel} onChange={e => setNewDateLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDate()} />
                </div>
                <button onClick={addDate} disabled={!newDateVal} className="btn-gold text-xs w-full">+ Add Date</button>
              </div>

              {/* Date list */}
              {dates.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">No additional dates added yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...dates].sort((a,b) => a.date.localeCompare(b.date)).map((d, i) => {
                    const typeInfo = DATE_TYPES.find(t => t.value === d.type) || DATE_TYPES[0];
                    const origIdx = dates.indexOf(d);
                    return (
                      <div key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: typeInfo.color }}>
                            {typeInfo.label}
                          </span>
                          <span className="font-semibold text-sm text-charcoal">{d.date}</span>
                          {d.label && <span className="text-xs text-gray-500">{d.label}</span>}
                        </div>
                        <button onClick={() => removeDate(origIdx)} className="text-red-400 hover:text-red-600 text-lg leading-none font-bold">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'measurements' && (
            <div className="grid grid-cols-2 gap-3">
              {MEASUREMENTS.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold mb-1 text-gray-600 uppercase tracking-wide">{f.label}</label>
                  <input type="text" className="input-field" value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          {tab === 'notes' && (
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-600 uppercase tracking-wide">Notes</label>
              <textarea
                className="input-field h-40 resize-none"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any notes about this artist…"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 pb-5">
          {!isNew ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger text-sm">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-gold">
              {saving ? 'Saving…' : 'Save Artist'}
            </button>
          </div>
        </div>
      </div>
    </div>

    {cropSrc && (
      <CropModal
        imageSrc={cropSrc}
        onConfirm={handleCropConfirm}
        onClose={() => setCropSrc(null)}
      />
    )}
    </>
  );
}
