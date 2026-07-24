import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { usePdfProgress } from '../contexts/PdfProgressContext.jsx';

const RATES = Array.from({ length: (5000 - 200) / 50 + 1 }, (_, i) => `R ${200 + i * 50}`);
const normalizeRate = (v) => { const n = v.replace(/[Rr]/gi, '').replace(/\s+/g, '').trim(); return n ? `R ${n}` : ''; };

const formatDate = (iso) => {
  if (!iso) return '';
  const clean = String(iso).trim();
  if (!clean) return '';
  const d = new Date(clean.includes('T') ? clean : clean + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
};

// Normalise shoot_dates to always be an array of date strings
const parseShootDates = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch {}
  return [val]; // legacy single string
};

const RESTRICTION_ITEMS = [
  'Tattoos', 'Body Piercings', 'False Nails',
  'Weaves', 'Extensions', 'Beards', 'Moustaches',
  'Tattooed Eyebrows', 'Tattooed Lipliners',
];

export default function CastingBriefs() {
  const { refreshKey } = useApp();
  const runPdfDownload = usePdfProgress();
  const [briefs, setBriefs] = useState([]);
  const [productions, setProductions] = useState([]);
  const [editing, setEditing] = useState(null); // null=list, 'new', or brief object
  const [form, setForm] = useState({
    production_id: '', role_name: '', age_from: '', age_to: '', gender: '',
    race: '', height_requirements: '', costume_requirements: '', hair_makeup: '',
    restrictions: {}, scene_description: '', fitting_dates: '', shoot_dates: [],
    mood_board_images: [],
  });
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showNewProd, setShowNewProd] = useState(false);
  const [newProd, setNewProd] = useState({ name: '', bg_director: '', contact_number: '', email: '', day_rate: '' });

  const load = async () => {
    const [b, p] = await Promise.all([api.getBriefs(), api.getProductions()]);
    setBriefs(b);
    setProductions(p);
  };

  useEffect(() => { load(); }, [refreshKey]);

  const startNew = () => {
    setForm({
      production_id: productions[0]?.id || '',
      role_name: '', age_from: '', age_to: '', gender: '',
      race: '', height_requirements: '', costume_requirements: '', hair_makeup: '',
      restrictions: {}, scene_description: '', fitting_dates: '', shoot_dates: [],
      mood_board_images: [],
    });
    setEditing('new');
  };

  const startEdit = async (brief) => {
    const full = await api.getBrief(brief.id);
    setForm({ ...full, shoot_dates: parseShootDates(full.shoot_dates) });
    setEditing(full);
  };

  const handleCreateProduction = async () => {
    if (!newProd.name.trim()) return;
    const created = await api.createProduction(newProd);
    await load();
    setForm(f => ({ ...f, production_id: created.id }));
    setShowNewProd(false);
    setNewProd({ name: '', bg_director: '', contact_number: '', email: '', day_rate: '' });
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleRestriction = (item, value) => {
    setForm(f => ({
      ...f,
      restrictions: { ...f.restrictions, [item]: f.restrictions[item] === value ? undefined : value },
    }));
  };

  const addShootDate = (date) => {
    if (!date || (form.shoot_dates||[]).includes(date)) return;
    set('shoot_dates', [...(form.shoot_dates||[]), date].sort());
  };

  const removeShootDate = (date) => {
    set('shoot_dates', (form.shoot_dates||[]).filter(d => d !== date));
  };

  const handleSave = async (download = false) => {
    setSaving(true);
    const payload = { ...form, shoot_dates: JSON.stringify(form.shoot_dates || []) };
    try {
      let saved;
      if (editing === 'new') {
        saved = await api.createBrief(payload);
      } else {
        saved = await api.updateBrief(editing.id, payload);
      }
      load();
      if (download) {
        await runPdfDownload('Casting Brief PDF', onProgress => api.briefPdfUrl(saved.id, onProgress));
      }
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this brief?')) return;
    await api.deleteBrief(id);
    load();
  };

  const handleMoodboardUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (editing === 'new') {
      // Store as data URLs until saved
      const urls = await Promise.all(files.map(f => new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(f);
      })));
      setForm(f => ({ ...f, _moodboardPreview: [...(f._moodboardPreview||[]), ...urls] }));
    } else if (editing?.id) {
      const fd = new FormData();
      files.forEach(f => fd.append('images', f));
      const res = await api.uploadMoodboard(editing.id, fd);
      setForm(f => ({ ...f, mood_board_images: res.mood_board_images }));
    }
  };

  if (editing !== null) {
    const prod = productions.find(p => p.id == form.production_id);
    return (
      <>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(null)} className="btn-ghost text-sm">← Back to Briefs</button>
          <h1 className="text-2xl font-bold text-charcoal">{editing === 'new' ? 'New Casting Brief' : `Edit Brief — ${form.role_name}`}</h1>
        </div>

        {/* Header Section */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 border-b pb-2">Production Header</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Production</label>
              <div className="flex gap-2 mt-1">
                <select className="input-field flex-1" value={form.production_id||''} onChange={e=>set('production_id',e.target.value)}>
                  <option value="">Select production…</option>
                  {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" onClick={() => setShowNewProd(v => !v)} className="btn-ghost text-xs whitespace-nowrap">+ New</button>
              </div>
              {showNewProd && (
                <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                  <p className="text-xs font-bold text-gray-500 uppercase">New Production</p>
                  <input className="input-field text-sm" placeholder="Production name *" value={newProd.name} onChange={e=>setNewProd(f=>({...f,name:e.target.value}))} autoFocus />
                  <input className="input-field text-sm" placeholder="BG Casting Director" value={newProd.bg_director} onChange={e=>setNewProd(f=>({...f,bg_director:e.target.value}))} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input-field text-sm" placeholder="Contact number" value={newProd.contact_number} onChange={e=>setNewProd(f=>({...f,contact_number:e.target.value}))} />
                    <input className="input-field text-sm" placeholder="Email" value={newProd.email} onChange={e=>setNewProd(f=>({...f,email:e.target.value}))} />
                    <input className="input-field text-sm" placeholder="Day rate" value={newProd.day_rate} onChange={e=>setNewProd(f=>({...f,day_rate:e.target.value}))} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowNewProd(false)} className="btn-ghost text-xs">Cancel</button>
                    <button type="button" onClick={handleCreateProduction} className="btn-gold text-xs">Create Production</button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Character Role</label>
              <input className="input-field mt-1" value={form.role_name||''} onChange={e=>set('role_name',e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Fitting Date</label>
              <input type="date" className="input-field mt-1" value={form.fitting_dates||''} onChange={e=>set('fitting_dates',e.target.value)} />
              {form.fitting_dates && <p className="text-xs text-gold font-medium mt-1">{formatDate(form.fitting_dates)}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Shoot Dates</label>
              <div className="mt-1 space-y-1">
                {(form.shoot_dates||[]).map(d => (
                  <div key={d} className="flex items-center gap-2">
                    <span className="flex-1 input-field py-1 text-sm bg-gray-50">{formatDate(d)}</span>
                    <button type="button" onClick={() => removeShootDate(d)} className="text-red-400 hover:text-red-600 text-lg leading-none" title="Remove">×</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input type="date" className="input-field flex-1 text-sm"
                    onChange={e => { addShootDate(e.target.value); e.target.value = ''; }} />
                </div>
                {(form.shoot_dates||[]).length === 0 && <p className="text-xs text-gray-400">Pick a date to add</p>}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Shootday Rate</label>
              <input list="rates-list" className="input-field mt-1" value={form.role_rate||''} onChange={e=>set('role_rate',normalizeRate(e.target.value))} placeholder="Type or pick a rate…" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Fitting Rate</label>
              <input list="rates-list" className="input-field mt-1" value={form.fitting_rate||''} onChange={e=>set('fitting_rate',normalizeRate(e.target.value))} placeholder="Type or pick a rate…" />
            </div>
            <datalist id="rates-list">
              {RATES.map(r => <option key={r} value={r} />)}
            </datalist>
          </div>
        </div>

        {/* Scene Description */}
        <div className="card p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 border-b pb-2 mb-4">Scene Description</h2>
          <textarea className="input-field h-32 resize-none" value={form.scene_description||''} onChange={e=>set('scene_description',e.target.value)} placeholder="Describe the scene…" />
        </div>

        {/* Role Description */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 border-b pb-2">Role Description</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Age From</label>
              <input type="number" className="input-field mt-1" value={form.age_from||''} onChange={e=>set('age_from',e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Age To</label>
              <input type="number" className="input-field mt-1" value={form.age_to||''} onChange={e=>set('age_to',e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Gender</label>
              <select className="input-field mt-1" value={form.gender||''} onChange={e=>set('gender',e.target.value)}>
                <option value="">Any</option>
                <option>Male</option>
                <option>Female</option>
                <option>Male/Female</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Race</label>
              <input className="input-field mt-1" value={form.race||''} onChange={e=>set('race',e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">Height Requirements</label>
              <input className="input-field mt-1" value={form.height_requirements||''} onChange={e=>set('height_requirements',e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className="text-xs font-semibold text-gray-500 uppercase">Costume Requirements</label>
              <textarea className="input-field mt-1 h-20 resize-none" value={form.costume_requirements||''} onChange={e=>set('costume_requirements',e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className="text-xs font-semibold text-gray-500 uppercase">Hair & Make-Up Requirements</label>
              <textarea className="input-field mt-1 h-20 resize-none" value={form.hair_makeup||''} onChange={e=>set('hair_makeup',e.target.value)} />
            </div>
          </div>

          {/* Restrictions */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase block mb-2">Restrictions</label>
            <div className="grid grid-cols-2 gap-2">
              {RESTRICTION_ITEMS.map(item => (
                <div key={item} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                  <span className="text-sm flex-1">{item}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleRestriction(item, 'Allowed')}
                      className={`text-xs px-2 py-1 rounded ${(form.restrictions||{})[item]==='Allowed'?'bg-green-500 text-white':'bg-gray-200 text-gray-600'}`}
                    >Allowed</button>
                    <button
                      onClick={() => toggleRestriction(item, 'Not Allowed')}
                      className={`text-xs px-2 py-1 rounded ${(form.restrictions||{})[item]==='Not Allowed'?'bg-red-500 text-white':'bg-gray-200 text-gray-600'}`}
                    >Not Allowed</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mood Board */}
        <div className="card p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 border-b pb-2 mb-4">Mood Board</h2>
          <label className="btn-ghost text-sm cursor-pointer inline-block mb-4">
            + Upload Images
            <input type="file" accept="image/*" multiple onChange={handleMoodboardUpload} className="hidden" />
          </label>
          {(form.mood_board_images?.length > 0 || form._moodboardPreview?.length > 0) && (
            <div className="flex flex-wrap gap-3">
              {[...(form.mood_board_images||[]), ...(form._moodboardPreview||[])].map((img, i) => (
                <div key={i} className="bg-gray-100 rounded overflow-hidden flex items-center justify-center">
                  <img src={img} alt="" className="max-w-full max-h-64 object-contain" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
          <button onClick={() => setShowPreview(true)} className="btn-dark">👁 Preview Brief</button>
          <button onClick={() => handleSave(false)} disabled={saving} className="btn-dark">Save Draft</button>
          <button onClick={() => handleSave(true)} disabled={saving} className="btn-gold">Save & Download PDF</button>
        </div>
      </div>

      {/* Brief Preview Modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Mock PDF header */}
            <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50 sticky top-0 z-10">
              <span className="text-sm font-semibold text-gray-600">Brief Preview — PDF layout</span>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-8 space-y-6 font-sans text-sm text-gray-900">
              {/* Logo + title */}
              <div className="text-center border-b pb-5">
                {productions.find(p=>p.id==form.production_id)?.name && (
                  <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Casting Brief</p>
                )}
                <h1 className="text-2xl font-black uppercase tracking-wide">
                  {productions.find(p=>p.id==form.production_id)?.name || 'Production Name'}
                </h1>
                {productions.find(p=>p.id==form.production_id) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {[productions.find(p=>p.id==form.production_id)?.bg_director, productions.find(p=>p.id==form.production_id)?.contact_number, productions.find(p=>p.id==form.production_id)?.email].filter(Boolean).join('  ·  ')}
                  </p>
                )}
              </div>

              {/* Role header */}
              <div className="bg-gray-900 text-white px-5 py-3 rounded-lg">
                <p className="text-xs uppercase tracking-widest text-gray-400 mb-0.5">Role</p>
                <p className="text-xl font-bold">{form.role_name || '—'}</p>
              </div>

              {/* Key details grid */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Age Range', value: form.age_from||form.age_to ? `${form.age_from||'?'} – ${form.age_to||'?'} yrs` : null },
                  { label: 'Gender', value: form.gender },
                  { label: 'Race', value: form.race },
                  { label: 'Fitting Date', value: formatDate(form.fitting_dates) },
                  ...((form.shoot_dates||[]).length > 0 ? (form.shoot_dates||[]).map((d, i) => ({ label: (form.shoot_dates.length > 1 ? `Shoot Date ${i+1}` : 'Shoot Date'), value: formatDate(d) })) : [{ label: 'Shoot Date', value: null }]),
                  { label: 'Shootday Rate', value: form.role_rate },
                  { label: 'Fitting Rate', value: form.fitting_rate },
                  { label: 'Height', value: form.height_requirements },
                ].filter(f => f.value).map(f => (
                  <div key={f.label} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-0.5">{f.label}</p>
                    <p className="font-semibold">{f.value}</p>
                  </div>
                ))}
              </div>

              {/* Scene description */}
              {form.scene_description && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1 mb-2">Scene Description</h3>
                  <p className="whitespace-pre-wrap leading-relaxed">{form.scene_description}</p>
                </div>
              )}

              {/* Costume */}
              {form.costume_requirements && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1 mb-2">Costume Requirements</h3>
                  <p className="whitespace-pre-wrap leading-relaxed">{form.costume_requirements}</p>
                </div>
              )}

              {/* Hair & Makeup */}
              {form.hair_makeup && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1 mb-2">Hair & Make-Up</h3>
                  <p className="whitespace-pre-wrap leading-relaxed">{form.hair_makeup}</p>
                </div>
              )}

              {/* Restrictions */}
              {Object.keys(form.restrictions||{}).filter(k => form.restrictions[k]).length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1 mb-3">Restrictions</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(form.restrictions||{}).filter(([,v])=>v).map(([k,v]) => (
                      <div key={k} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                        <span className="text-sm">{k}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${v==='Allowed'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mood board */}
              {((form.mood_board_images||[]).length > 0 || (form._moodboardPreview||[]).length > 0) && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1 mb-3">Mood Board</h3>
                  <div className="flex flex-wrap gap-3">
                    {[...(form.mood_board_images||[]), ...(form._moodboardPreview||[])].map((img, i) => (
                      <div key={i} className="rounded overflow-hidden bg-gray-100 flex items-center justify-center">
                        <img src={img} alt="" className="max-h-48 max-w-xs object-contain" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-8 pb-6 flex justify-end gap-3 border-t pt-4">
              <button onClick={() => setShowPreview(false)} className="btn-ghost">Close Preview</button>
              <button onClick={() => { setShowPreview(false); handleSave(true); }} disabled={saving} className="btn-gold">Save & Download PDF</button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Casting Briefs</h1>
          <p className="text-sm text-gray-500 mt-0.5">{briefs.length} briefs</p>
        </div>
        <button onClick={startNew} className="btn-gold">+ New Brief</button>
      </div>

      {productions.length === 0 && (
        <div className="card p-4 bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-700">⚠️ No production set up yet. <a href="#" onClick={e=>{e.preventDefault();}} className="underline">Go to Settings</a> to add a production.</p>
        </div>
      )}

      {briefs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-medium">No casting briefs yet</p>
          <button onClick={startNew} className="btn-gold mt-4">+ Create First Brief</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {briefs.map(b => (
            <div key={b.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-charcoal">{b.role_name || 'Untitled Role'}</p>
                  <p className="text-xs text-gray-400">{new Date(b.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              {b.scene_description && <p className="text-xs text-gray-500 line-clamp-2">{b.scene_description}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => startEdit(b)} className="btn-ghost text-xs flex-1">Edit</button>
                <button onClick={() => runPdfDownload('Casting Brief PDF', onProgress => api.briefPdfUrl(b.id, onProgress))} className="btn-dark text-xs">⬇ PDF</button>
                <button onClick={() => handleDelete(b.id)} className="btn-danger text-xs">Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
