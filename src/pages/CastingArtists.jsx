import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistModal from '../components/ArtistModal.jsx';
import CropModal from '../components/CropModal.jsx';

const RATES = Array.from({ length: (5000 - 200) / 50 + 1 }, (_, i) => `R ${200 + i * 50}`);
const normalizeRate = v => { const n = v.replace(/[Rr]/gi, '').replace(/\s+/g, '').trim(); return n ? `R ${n}` : ''; };

// Memoized card — only re-renders when its own item data changes
const CastingCard = memo(function CastingCard({ item, onRemove, onEdit, onCrop, onShowDup, onFirstNameChange, onLastNameChange }) {
  return (
    <div className={`card overflow-hidden relative ${item.status==='saved'?'ring-2 ring-green-400':item.status==='duplicate'?'ring-2 ring-amber-400':item.status==='error'?'ring-2 ring-red-400':''}`}>
      {item.status !== 'saved' && (
        <button onClick={() => onRemove(item.id)} className="absolute top-0.5 right-0.5 z-10 w-4 h-4 bg-black/60 text-white rounded-full text-[10px] hover:bg-red-600 flex items-center justify-center">×</button>
      )}
      <div className="aspect-[3/4] bg-gray-100 overflow-hidden relative">
        <img
          src={item.headshotDataUrl || item.preview}
          alt=""
          className={`w-full h-full ${item.headshotDataUrl ? 'object-contain' : 'object-cover object-center'}`}
        />
        {item.headshotDataUrl && (
          <div className="absolute top-0.5 left-0.5 bg-gold text-black text-[9px] font-bold px-1 py-0.5 rounded leading-none">✓</div>
        )}
      </div>
      {item.status === 'saved' && (
        <div className="absolute top-1 left-1 bg-green-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">✓</div>
      )}
      {item.status === 'duplicate' && (
        <div className="absolute top-1 left-1 bg-amber-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">Dup</div>
      )}
      {(item.status === 'done' || item.status === 'pending') && (
        <div className="px-1 py-1 space-y-1">
          <input
            className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-gold"
            placeholder="First name"
            value={item.extracted.first_name}
            onChange={e => onFirstNameChange(item.id, e.target.value, item.extracted.last_name)}
          />
          <input
            className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-gold"
            placeholder="Last name"
            value={item.extracted.last_name}
            onChange={e => onLastNameChange(item.id, item.extracted.first_name, e.target.value)}
          />
          {item.duplicates?.length > 0 && (
            <button
              onClick={() => onShowDup(item)}
              className="w-full text-[10px] bg-amber-500 text-white rounded px-1 py-0.5 font-bold animate-pulse hover:animate-none hover:bg-amber-600 leading-tight"
            >
              ⚠ {item.duplicates.length} match{item.duplicates.length !== 1 ? 'es' : ''}
            </button>
          )}
          {item.extracted.role && <div className="text-[9px] text-gray-400 truncate">{item.extracted.role}</div>}
          {item.extracted.agent_name && <div className="text-[9px] text-gray-400 truncate">{item.extracted.agent_name}</div>}
          <div className="flex gap-1">
            <button
              onClick={() => onEdit(item)}
              className="flex-1 text-[9px] text-gold border border-gold rounded px-1 py-0.5 hover:bg-gold hover:text-black transition-colors leading-tight"
            >
              ✏ Edit
            </button>
            <button
              onClick={() => onCrop(item)}
              className="flex-1 text-[9px] bg-charcoal text-white rounded px-1 py-0.5 hover:bg-gold hover:text-black transition-colors leading-tight"
            >
              ✂ Crop
            </button>
          </div>
        </div>
      )}
      {item.status === 'error' && (
        <div className="p-2">
          <p className="text-xs text-red-500">{item.error}</p>
          <div className="space-y-1 mt-1">
            <input className="w-full text-xs border border-gray-200 rounded px-2 py-1" placeholder="First name" value={item.extracted.first_name} onChange={e => onFirstNameChange(item.id, e.target.value, item.extracted.last_name)} />
            <input className="w-full text-xs border border-gray-200 rounded px-2 py-1" placeholder="Last name" value={item.extracted.last_name} onChange={e => onLastNameChange(item.id, item.extracted.first_name, e.target.value)} />
          </div>
        </div>
      )}
      {item.status === 'saved' && (
        <div className="p-2">
          <p className="text-xs font-semibold truncate">{item.extracted.first_name} {item.extracted.last_name}</p>
          {item.extracted.agent_name && <p className="text-xs text-gray-400 truncate">{item.extracted.agent_name}</p>}
        </div>
      )}
    </div>
  );
});

export default function CastingArtists() {
  const { refresh } = useApp();
  const [items, setItems] = useState([]); // [{ id, file, preview, status, extracted, duplicates, error }]
  const itemsRef = useRef([]);
  const [editItem, setEditItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [agents, setAgents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cropItem, setCropItem] = useState(null);
  const [dupModalItem, setDupModalItem] = useState(null);
  const fileRef = useRef();
  const dupTimers = useRef({});

  const [defaults, setDefaults] = useState({
    role: '', agent_name: '', day_rate: '', fitting_rate: '', shoot_date: '', fitting_date: '',
  });
  const setDefault = (k, v) => setDefaults(d => ({ ...d, [k]: v }));

  useEffect(() => {
    api.getAgents().then(setAgents).catch(() => {});
    api.getRoles().then(setRoles).catch(() => {});
  }, []);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files).slice(0, 20);
    if (!files.length) return;

    const newItems = files.map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      preview: URL.createObjectURL(file),
      status: 'done',
      extracted: { first_name: '', last_name: '', agent_name: defaults.agent_name, role: defaults.role, day_rate: defaults.day_rate, fitting_rate: defaults.fitting_rate, shoot_date: defaults.shoot_date, fitting_date: defaults.fitting_date },
      duplicates: [],
      error: null,
    }));
    itemsRef.current = newItems;
    setItems(newItems);
    setSavedCount(0);
    e.target.value = '';
  };

  const updateItems = useCallback((updater) => {
    setItems(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      itemsRef.current = next;
      return next;
    });
  }, []);

  const setCropResult = useCallback((id, dataUrl) => {
    updateItems(prev => prev.map(it => it.id === id ? { ...it, headshotDataUrl: dataUrl } : it));
    setCropItem(null);
  }, [updateItems]);

  const checkDuplicates = useCallback((itemId, firstName, lastName) => {
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName || fullName.length < 2) {
      updateItems(prev => prev.map(it => it.id === itemId ? { ...it, duplicates: [] } : it));
      return;
    }
    clearTimeout(dupTimers.current[itemId]);
    dupTimers.current[itemId] = setTimeout(async () => {
      try {
        const results = await api.getArtists({ q: fullName });
        const matches = results.filter(a => {
          const name = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
          return name === fullName.toLowerCase() || name.includes(fullName.toLowerCase()) || fullName.toLowerCase().includes(name);
        });
        updateItems(prev => prev.map(it => it.id === itemId ? { ...it, duplicates: matches } : it));
      } catch {}
    }, 400);
  }, [updateItems]);

  // Stable callbacks passed to memoized cards
  const handleFirstNameChange = useCallback((id, firstName, lastName) => {
    updateItems(prev => prev.map(it => it.id === id ? { ...it, extracted: { ...it.extracted, first_name: firstName } } : it));
    checkDuplicates(id, firstName, lastName);
  }, [updateItems, checkDuplicates]);

  const handleLastNameChange = useCallback((id, firstName, lastName) => {
    updateItems(prev => prev.map(it => it.id === id ? { ...it, extracted: { ...it.extracted, last_name: lastName } } : it));
    checkDuplicates(id, firstName, lastName);
  }, [updateItems, checkDuplicates]);

  const removeItem = useCallback((id) => {
    updateItems(prev => prev.filter(it => it.id !== id));
  }, [updateItems]);

  const handleSaveAll = async () => {
    const ready = itemsRef.current.filter(it => it.status === 'done' && it.extracted.first_name.trim());
    if (!ready.length) return;
    setSaving(true);
    let count = 0;
    for (const item of ready) {
      try {
        const saved = await api.createArtist({ ...item.extracted, category: 'new' });
        if (item.headshotDataUrl) {
          try {
            const [header, b64] = item.headshotDataUrl.split(',');
            const mime = header.match(/:(.*?);/)[1];
            const bytes = atob(b64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            const blob = new Blob([arr], { type: mime });
            const fd = new FormData();
            fd.append('headshot', blob, 'headshot.jpg');
            await fetch(`/api/artists/${saved.id}/headshot`, { method: 'POST', body: fd });
          } catch (err) {
            console.error('Headshot upload failed:', err);
          }
        }
        count++;
        updateItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'saved' } : it));
      } catch (err) {
        if (err.status === 409) {
          updateItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'duplicate' } : it));
        } else {
          updateItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', error: 'Save failed' } : it));
        }
      }
    }
    setSavedCount(count);
    setSaving(false);
    refresh();
  };

  const handleReset = () => {
    itemsRef.current = [];
    setItems([]);
    setSavedCount(0);
  };

  const doneCount = items.filter(it => it.status === 'done').length;
  const savedItems = items.filter(it => it.status === 'saved').length;
  const allSaved = items.length > 0 && items.every(it => it.status === 'saved' || it.status === 'duplicate' || it.status === 'error');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Casting Artists</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload up to 20 contact card PNGs — fill in details and save</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button onClick={handleReset} className="btn-ghost text-sm">↺ Start Over</button>
          )}
          <label className="btn-gold cursor-pointer">
            + Upload PNGs
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/*" multiple onChange={handleFiles} className="hidden" />
          </label>
        </div>
      </div>

      {/* Batch Defaults Panel */}
      {items.length === 0 && (
        <div className="card overflow-hidden">
          <div className="section-header" style={{ background: '#1a1a1a', color: '#C9A84C' }}>
            <span className="font-bold tracking-wider text-sm">SET BATCH DEFAULTS — applied to all uploaded cards</span>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Role</label>
              <input list="ba-roles" className="input-field text-sm" placeholder="Type or pick role…"
                value={defaults.role} onChange={e => setDefault('role', e.target.value)} />
              <datalist id="ba-roles">{roles.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Agent</label>
              <input list="ba-agents" className="input-field text-sm" placeholder="Type agent name…"
                value={defaults.agent_name} onChange={e => setDefault('agent_name', e.target.value)} />
              <datalist id="ba-agents">{agents.map(a => <option key={a.id} value={a.name} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Day Rate</label>
              <input list="ba-day-rates" className="input-field text-sm" placeholder="R 850…"
                value={defaults.day_rate}
                onChange={e => setDefault('day_rate', e.target.value)}
                onBlur={e => setDefault('day_rate', normalizeRate(e.target.value))} />
              <datalist id="ba-day-rates">{RATES.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Fitting Rate</label>
              <input list="ba-fit-rates" className="input-field text-sm" placeholder="R 500…"
                value={defaults.fitting_rate}
                onChange={e => setDefault('fitting_rate', e.target.value)}
                onBlur={e => setDefault('fitting_rate', normalizeRate(e.target.value))} />
              <datalist id="ba-fit-rates">{RATES.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Shoot Date</label>
              <input type="date" className="input-field text-sm"
                value={defaults.shoot_date} onChange={e => setDefault('shoot_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">Fitting Date</label>
              <input type="date" className="input-field text-sm"
                value={defaults.fitting_date} onChange={e => setDefault('fitting_date', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card p-12 text-center space-y-4">
          <div className="text-6xl">📸</div>
          <h2 className="text-lg font-bold text-charcoal">Upload Contact Card Images</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto">Select up to 20 PNG or JPEG contact cards. Fill in the details and save each artist.</p>
          <label className="btn-gold cursor-pointer inline-block mt-2">
            Choose Files (up to 20)
            <input type="file" accept="image/png,image/jpeg,image/*" multiple onChange={handleFiles} className="hidden" />
          </label>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {allSaved ? `Done — ${savedItems} artist${savedItems!==1?'s':''} added` : `${doneCount} of ${items.length} ready to save`}
            </p>
            {!allSaved && doneCount > 0 && (
              <button onClick={handleSaveAll} disabled={saving} className="btn-gold">
                {saving ? 'Saving…' : `Save All (${doneCount})`}
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            {items.map(item => (
              <CastingCard
                key={item.id}
                item={item}
                onRemove={removeItem}
                onEdit={setEditItem}
                onCrop={setCropItem}
                onShowDup={setDupModalItem}
                onFirstNameChange={handleFirstNameChange}
                onLastNameChange={handleLastNameChange}
              />
            ))}
          </div>
        </div>
      )}

      {cropItem && (
        <CropModal
          imageSrc={cropItem.preview}
          onConfirm={(dataUrl) => setCropResult(cropItem.id, dataUrl)}
          onClose={() => setCropItem(null)}
        />
      )}

      {dupModalItem && (
        <div className="modal-overlay" onClick={() => setDupModalItem(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b bg-amber-50">
              <div>
                <h3 className="font-bold text-amber-800 text-base">⚠ Possible Duplicate Detected</h3>
                <p className="text-xs text-amber-600 mt-0.5">
                  "{dupModalItem.extracted.first_name} {dupModalItem.extracted.last_name}" matches {dupModalItem.duplicates?.length} existing artist{dupModalItem.duplicates?.length !== 1 ? 's' : ''} in the system
                </p>
              </div>
              <button onClick={() => setDupModalItem(null)} className="text-2xl text-gray-400 hover:text-gray-700 leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              {dupModalItem.duplicates?.map(a => {
                const CATEGORY_LABELS = { new: 'New Artists', pencil: 'Pencilling', fitting: 'Fittings', shoot: 'Shoot Dates', not_available: 'Not Available' };
                return (
                  <div key={a.id} className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50">
                    {a.headshot_path ? (
                      <img src={a.headshot_path} alt="" className="w-16 h-20 object-cover rounded object-top flex-shrink-0" />
                    ) : (
                      <div className="w-16 h-20 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-2xl flex-shrink-0">👤</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-charcoal">{a.first_name} {a.last_name}</p>
                      {a.agent_name && <p className="text-sm text-gray-500">{a.agent_name}</p>}
                      {a.role && <p className="text-sm text-gray-600 truncate">{a.role}</p>}
                      <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-semibold ${
                        a.category === 'new' ? 'bg-green-100 text-green-800' :
                        a.category === 'pencil' ? 'bg-amber-100 text-amber-800' :
                        a.category === 'fitting' ? 'bg-blue-100 text-blue-800' :
                        a.category === 'shoot' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {CATEGORY_LABELS[a.category] || a.category}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 justify-end px-5 py-4 border-t">
              <button onClick={() => setDupModalItem(null)} className="btn-ghost">Close — still different person</button>
            </div>
          </div>
        </div>
      )}

      <datalist id="agents-datalist">
        {agents.map(a => <option key={a.id} value={a.name} />)}
      </datalist>

      {editItem && (
        <ArtistModal
          artist={{ ...editItem.extracted, category: 'new', headshot_path: null }}
          onClose={() => setEditItem(null)}
          onSaved={async (saved) => {
            const currentItem = itemsRef.current.find(it => it.id === editItem.id);
            if (saved?.id && currentItem?.headshotDataUrl) {
              try {
                const [header, b64] = currentItem.headshotDataUrl.split(',');
                const mime = header.match(/:(.*?);/)[1];
                const bytes = atob(b64);
                const arr = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
                const blob = new Blob([arr], { type: mime });
                const fd = new FormData();
                fd.append('headshot', blob, 'headshot.jpg');
                await fetch(`/api/artists/${saved.id}/headshot`, { method: 'POST', body: fd });
              } catch (err) {
                console.error('Headshot upload failed:', err);
              }
            }
            setEditItem(null);
            updateItems(prev => prev.map(it => it.id === editItem.id ? { ...it, status: 'saved' } : it));
            refresh();
          }}
        />
      )}
    </div>
  );
}
