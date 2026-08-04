import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import ArtistModal from '../components/ArtistModal.jsx';
import SmartSearchBar from '../components/SmartSearchBar.jsx';
import BulkEditBar from '../components/BulkEditBar.jsx';

const CATS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'pencil', label: 'Pencilling' },
  { value: 'fitting', label: 'Fittings' },
  { value: 'shoot', label: 'Shoot Dates' },
  { value: 'not_available', label: 'Not Available' },
];

const MOVE_OPTS = [
  { value: 'new', label: 'New Artists' },
  { value: 'pencil', label: 'Pencilling' },
  { value: 'fitting', label: 'Fittings' },
  { value: 'shoot', label: 'Shoot Dates' },
  { value: 'not_available', label: 'Not Available' },
];

export default function AllArtists() {
  const { refresh, refreshKey, moveArtistsWithUndo } = useApp();
  const [artists, setArtists] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [openArtistId, setOpenArtistId] = useState(null);
  const [openArtist, setOpenArtist] = useState(null);

  const openById = async (id) => {
    const found = artists.find(x => x.id === id) || (await api.getArtists({ q: '' })).find(x => x.id === id);
    setOpenArtist(found || null);
    setOpenArtistId(id);
  };

  const load = async () => {
    const params = {};
    if (roleFilter) params.role = roleFilter;
    else if (q) params.q = q;
    if (cat) params.category = cat;
    const data = await api.getArtists(params);
    setArtists(data);
  };

  useEffect(() => { load(); }, [q, cat, roleFilter, refreshKey]);

  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  const handleBulkMove = async () => {
    if (!moveTarget || !selected.size) return;
    const artistsToMove = artists.filter(a => selected.has(a.id));
    const moved = await moveArtistsWithUndo(artistsToMove, moveTarget);
    if (moved) { setSelected(new Set()); setMoveTarget(''); }
  };

  const handleDuplicate = async (artist) => {
    const role = prompt('Role for duplicate (leave blank to keep same):', artist.role || '');
    if (role === null) return;
    await api.duplicateArtist(artist.id, { role: role || artist.role });
    refresh();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">All Artists</h1>
          <p className="text-sm text-gray-500 mt-0.5">{artists.length} artists</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.exportAllArtists()} className="btn-dark text-sm">⬇ Export All to Excel</button>
          <button onClick={() => setShowAdd(true)} className="btn-gold">+ Add Artist</button>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <SmartSearchBar
          pool={artists} q={q} setQ={setQ}
          onSelectIds={ids => setSelected(new Set(ids))}
          onOpenArtist={openById}
          onSelectRole={role => { setRoleFilter(role); setQ(''); setSelected(new Set()); }}
          roleFilter={roleFilter}
          onClearRole={() => setRoleFilter('')}
        />
        <div className="flex gap-1">
          {CATS.map(c => (
            <button key={c.value} onClick={()=>setCat(c.value)}
              className={`px-3 py-1.5 text-xs rounded font-semibold ${cat===c.value?'bg-gold text-black':'bg-white border border-gray-200 text-gray-600 hover:border-gold'}`}>
              {c.label}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <button onClick={() => { setSelected(new Set()); setQ(''); }} className="btn-ghost text-xs">✕ Clear Selection</button>
        )}
        {artists.length > 0 && (
          <button onClick={() => selected.size === artists.length ? setSelected(new Set()) : setSelected(new Set(artists.map(a => a.id)))} className="btn-ghost text-xs">
            {selected.size === artists.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <span className="text-sm font-semibold text-gold">{selected.size} selected</span>
            <select className="input-field w-44 text-sm" value={moveTarget} onChange={e=>setMoveTarget(e.target.value)}>
              <option value="">Move to…</option>
              {MOVE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={handleBulkMove} disabled={!moveTarget} className="btn-gold text-xs">Move</button>
            <BulkEditBar selected={selected} onDone={() => { setSelected(new Set()); setQ(''); load(); refresh(); }} />
          </div>
        )}
      </div>

      {artists.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-lg font-medium">No artists found</p>
          <button onClick={() => setShowAdd(true)} className="btn-gold mt-4">+ Add First Artist</button>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
          {artists.map(a => (
            <ArtistCard
              key={a.id}
              artist={a}
              selected={selected.has(a.id)}
              onSelect={toggleSelect}
              showCheckbox
              compact
              onUpdated={load}
              onDeleted={load}
              actions={[
                { label: '⧉ Duplicate', onClick: handleDuplicate, className: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs' },
              ]}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ArtistModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}

      {openArtist && (
        <ArtistModal
          artist={openArtist}
          onClose={() => { setOpenArtistId(null); setOpenArtist(null); }}
          onSaved={() => { setOpenArtistId(null); setOpenArtist(null); load(); }}
          onDeleted={() => { setOpenArtistId(null); setOpenArtist(null); load(); }}
        />
      )}
    </div>
  );
}
