import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { usePdfProgress } from '../contexts/PdfProgressContext.jsx';

const FIELDS = [
  { key: 'age',        label: 'Age' },
  { key: 'eye_color',  label: 'Eyes' },
  { key: 'hair_color', label: 'Hair' },
  { key: 'height',     label: 'Height' },
  { key: 'chest',      label: 'Chest' },
  { key: 'bust_size',  label: 'Bust' },
  { key: 'waist',      label: 'Waist' },
  { key: 'dress_size', label: 'Dress' },
  { key: 'shoe_size',  label: 'Shoe' },
  { key: 'neck_hat',   label: 'Neck/Hat' },
  { key: 'suit',       label: 'Suit' },
];

const ACCENT_PRESETS = ['#f97316','#e11d48','#7c3aed','#0ea5e9','#16a34a','#ca8a04','#111827','#1e3a5f'];

function PhotoSlot({ label, src, onUpload, size = 'full' }) {
  const ref = useRef();
  const h = size === 'main' ? 'h-72' : 'h-36';
  return (
    <div
      className={`relative ${h} bg-gray-100 rounded overflow-hidden cursor-pointer group border-2 border-dashed border-gray-300 hover:border-gold transition-colors`}
      onClick={() => ref.current.click()}
    >
      {src
        ? <img src={src} alt={label} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
            <span className="text-2xl">📷</span>
            <span className="text-xs mt-1">{label}</span>
          </div>
      }
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <span className="text-white text-xs font-bold">Replace Photo</span>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onUpload} />
    </div>
  );
}

function ZCardPreview({ zcard, settings, name }) {
  const accent = zcard.accent_color || '#1e3a5f';
  const photoStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
  const noPhoto = (label) => (
    <div style={{ width:'100%', height:'100%', background:'#1a1a2e', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#555', fontSize:9, gap:4 }}>
      <span style={{ fontSize:18, opacity:.3 }}>📷</span>{label}
    </div>
  );
  const filledMeasures = FIELDS.filter(f => zcard[f.key]);

  return (
    <div style={{ background: '#0d0d0d', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)', fontFamily: "'Arial Black', Arial, sans-serif", border: `2px solid ${accent}` }}>
      {/* Photos row */}
      <div style={{ display: 'flex', height: 270 }}>
        {/* Left: headshot */}
        <div style={{ width: '50%', position: 'relative', overflow: 'hidden', borderRight: `2px solid ${accent}` }}>
          {zcard.photo1 ? <img src={zcard.photo1} alt="headshot" style={photoStyle} /> : noPhoto('Headshot')}
          {/* gradient overlay for name */}
          <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'linear-gradient(transparent, rgba(0,0,0,0.85))', padding:'28px 10px 8px' }}>
            <div style={{ fontSize:14, fontWeight:900, color:'#fff', textTransform:'uppercase', letterSpacing:'.08em', textShadow:'0 1px 6px rgba(0,0,0,0.8)', lineHeight:1.1 }}>
              {name || 'ARTIST NAME'}
            </div>
            {zcard.agent_name && (
              <div style={{ fontSize:8, color:'rgba(255,255,255,0.7)', marginTop:2, fontWeight:600, letterSpacing:'.04em' }}>{zcard.agent_name}</div>
            )}
          </div>
          {/* accent top bar */}
          <div style={{ position:'absolute', top:0, left:0, right:0, height:4, background: accent }} />
        </div>
        {/* Right: full length */}
        <div style={{ width: '50%', overflow: 'hidden', position:'relative' }}>
          {zcard.photo2 ? <img src={zcard.photo2} alt="full body" style={photoStyle} /> : noPhoto('Full Length')}
          <div style={{ position:'absolute', top:0, left:0, right:0, height:4, background: accent }} />
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ background: accent, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Measurements */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px', flex:1 }}>
          {filledMeasures.map(f => (
            <div key={f.key} style={{ display:'flex', alignItems:'baseline', gap:4, whiteSpace:'nowrap' }}>
              <span style={{ fontSize:9, fontWeight:800, color:'rgba(255,255,255,0.65)', textTransform:'uppercase', letterSpacing:'.06em' }}>{f.label}</span>
              <span style={{ fontSize:13, fontWeight:700, color:'#fff' }}>{zcard[f.key]}</span>
            </div>
          ))}
        </div>
        {/* Logo */}
        {settings?.app_logo_path && (
          <div style={{ flexShrink:0, background:'rgba(255,255,255,0.08)', borderRadius:6, padding:'4px 8px', border:'1px solid rgba(255,255,255,0.15)' }}>
            <img src={settings.app_logo_path} alt="logo" style={{ height:52, maxWidth:130, objectFit:'contain', display:'block' }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ZCards() {
  const { settings, refreshKey } = useApp();
  const runPdfDownload = usePdfProgress();
  const [zcards, setZcards] = useState([]);
  const [artists, setArtists] = useState([]);
  const [editing, setEditing] = useState(null); // null=list | 'new' | zcard obj
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [artistSearch, setArtistSearch] = useState('');

  const load = async () => {
    const [zs, arts] = await Promise.all([api.getZCards(), api.getArtists()]);
    setZcards(zs);
    setArtists(arts);
  };

  useEffect(() => { load(); }, [refreshKey]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const startNew = () => {
    setForm({ accent_color: '#f97316', artist_id: '', age:'', eye_color:'', hair_color:'', height:'', shoe_size:'', neck_hat:'', waist:'', chest:'', suit:'' });
    setArtistSearch('');
    setEditing('new');
  };

  const startEdit = async (zc) => {
    const full = await api.getZCard(zc.id);
    setForm({ ...full });
    setArtistSearch([full.first_name, full.last_name].filter(Boolean).join(' '));
    setEditing(full);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing === 'new') {
        const created = await api.createZCard(form);
        setEditing(created);
        setForm(f => ({ ...f, ...created }));
      } else {
        const updated = await api.updateZCard(editing.id, form);
        setForm(f => ({ ...f, ...updated }));
      }
      load();
    } finally { setSaving(false); }
  };

  const handlePhotoUpload = async (slot, e) => {
    const file = e.target.files[0];
    if (!file || editing === 'new') return;
    const fd = new FormData();
    fd.append('photo', file);
    const updated = await api.uploadZCardPhoto(editing.id, slot, fd);
    setForm(f => ({ ...f, [`photo${slot}`]: updated[`photo${slot}`] }));
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this Z-Card?')) return;
    await api.deleteZCard(id);
    load();
  };

  const handleDownload = async (id) => {
    await runPdfDownload('Z-Card PDF', onProgress => api.zCardPdfUrl(id, onProgress));
  };

  const selectArtist = (artist) => {
    const fullName = `${artist.first_name} ${artist.last_name || ''}`.trim();
    setArtistSearch(fullName);
    setForm(f => ({
      ...f,
      artist_id: artist.id,
      display_name: fullName,
      agent_name: artist.agent_name || '',
      chest: f.chest || artist.chest || '',
      waist: f.waist || artist.waist || '',
      shoe_size: f.shoe_size || artist.shoe_size || '',
      suit: f.suit || artist.jacket_size || '',
    }));
  };

  const filteredArtists = artistSearch.length > 1
    ? artists.filter(a => `${a.first_name} ${a.last_name||''}`.toLowerCase().includes(artistSearch.toLowerCase())).slice(0, 8)
    : [];

  const currentName = form.display_name || artistSearch;

  // ── Edit view ──────────────────────────────────────────────────────────────
  if (editing !== null) {
    const isNew = editing === 'new';
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setEditing(null); load(); }} className="btn-ghost text-sm">← Back to Z-Cards</button>
          <h1 className="text-2xl font-bold text-charcoal">{isNew ? 'New Z-Card' : `Edit — ${currentName}`}</h1>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left — form */}
          <div className="space-y-5">

            {/* Artist selector */}
            <div className="card p-4">
              <h2 className="text-xs font-bold uppercase text-gray-500 tracking-wider border-b pb-2 mb-3">Artist</h2>
              <div className="relative">
                <input
                  className="input-field"
                  placeholder="Search or type artist name…"
                  value={artistSearch}
                  onChange={e => { setArtistSearch(e.target.value); set('display_name', e.target.value); }}
                />
                {filteredArtists.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredArtists.map(a => (
                      <button key={a.id} onClick={() => selectArtist(a)}
                        className="w-full text-left px-3 py-2 hover:bg-gold/10 text-sm flex items-center gap-2">
                        {a.headshot_path && <img src={a.headshot_path} className="w-7 h-7 rounded-full object-cover" />}
                        <div>
                          <div className="font-semibold">{a.first_name} {a.last_name}</div>
                          {a.agent_name && <div className="text-xs text-gray-400">{a.agent_name}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Photos — only available after first save */}
            <div className="card p-4">
              <h2 className="text-xs font-bold uppercase text-gray-500 tracking-wider border-b pb-2 mb-3">Photos</h2>
              {isNew ? (
                <p className="text-sm text-gray-400 italic">Save the card first, then upload photos.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1 font-semibold">① Headshot</p>
                    <PhotoSlot label="Headshot" src={form.photo1} onUpload={e => handlePhotoUpload(1, e)} size="main" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1 font-semibold">② Full Length</p>
                    <PhotoSlot label="Full Length" src={form.photo2} onUpload={e => handlePhotoUpload(2, e)} size="main" />
                  </div>
                </div>
              )}
            </div>

            {/* Measurements */}
            <div className="card p-4">
              <h2 className="text-xs font-bold uppercase text-gray-500 tracking-wider border-b pb-2 mb-3">Measurements &amp; Details</h2>
              <div className="grid grid-cols-3 gap-3">
                {FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-semibold text-gray-500 uppercase">{f.label}</label>
                    <input className="input-field mt-1 text-sm" value={form[f.key]||''} onChange={e => set(f.key, e.target.value)} placeholder={f.label} />
                  </div>
                ))}
              </div>
            </div>

            {/* Accent colour */}
            <div className="card p-4">
              <h2 className="text-xs font-bold uppercase text-gray-500 tracking-wider border-b pb-2 mb-3">Banner Colour</h2>
              <div className="flex items-center gap-3 flex-wrap">
                {ACCENT_PRESETS.map(c => (
                  <button key={c} onClick={() => set('accent_color', c)}
                    className={`w-8 h-8 rounded-full border-4 transition-transform ${form.accent_color === c ? 'border-gold scale-110' : 'border-transparent'}`}
                    style={{ background: c }} />
                ))}
                <input type="color" value={form.accent_color || '#f97316'} onChange={e => set('accent_color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-gray-300" title="Custom colour" />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={() => { setEditing(null); load(); }} className="btn-ghost">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-gold flex-1">
                {saving ? 'Saving…' : isNew ? 'Create Z-Card' : 'Save Changes'}
              </button>
              {!isNew && (
                <button onClick={() => handleDownload(editing.id)} className="btn-dark">⬇ Download PDF</button>
              )}
            </div>
          </div>

          {/* Right — live preview */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Live Preview</h2>
            <ZCardPreview zcard={form} settings={settings} name={currentName} />
            <p className="text-xs text-gray-400 text-center">Preview updates as you edit. Photos require saving first.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Z-Cards</h1>
          <p className="text-sm text-gray-500 mt-0.5">{zcards.length} Z-cards</p>
        </div>
        <button onClick={startNew} className="btn-gold">+ New Z-Card</button>
      </div>

      {zcards.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🪪</div>
          <p className="text-lg font-medium">No Z-Cards yet</p>
          <button onClick={startNew} className="btn-gold mt-4">+ Create First Z-Card</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {zcards.map(zc => {
            const name = [zc.first_name, zc.last_name].filter(Boolean).join(' ') || 'Artist';
            return (
              <div key={zc.id} className="card overflow-hidden">
                <ZCardPreview zcard={zc} settings={settings} name={name} />
                <div className="p-3 flex gap-2">
                  <button onClick={() => startEdit(zc)} className="btn-ghost text-xs flex-1">✏️ Edit</button>
                  <button onClick={() => handleDownload(zc.id)} className="btn-dark text-xs">⬇ PDF</button>
                  <button onClick={() => handleDelete(zc.id)} className="btn-danger text-xs">Del</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
