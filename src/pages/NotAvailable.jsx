import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import SmartSearchBar from '../components/SmartSearchBar.jsx';
import BulkEditBar from '../components/BulkEditBar.jsx';

export default function NotAvailable() {
  const { refresh, refreshKey } = useApp();
  const [artists, setArtists] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());

  const load = async () => {
    const data = await api.getArtists({ category: 'not_available', q });
    setArtists(data);
  };

  useEffect(() => { load(); }, [q, refreshKey]);

  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  const handleMoveToNew = async () => {
    if (!selected.size) return;
    await api.bulkCategory([...selected], 'new');
    setSelected(new Set());
    refresh();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Not Available</h1>
          <p className="text-sm text-gray-500 mt-0.5">{artists.length} artists</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.exportArtists('not_available')} className="btn-dark text-xs">⬇ Export</button>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <SmartSearchBar pool={artists} q={q} setQ={setQ} onSelectIds={ids => setSelected(new Set(ids))} />
        {selected.size > 0 && (
          <button onClick={() => { setSelected(new Set()); setQ(''); }} className="btn-ghost text-xs">✕ Clear Selection</button>
        )}
        {artists.length > 0 && (
          <button onClick={() => selected.size === artists.length ? setSelected(new Set()) : setSelected(new Set(artists.map(a => a.id)))} className="btn-ghost text-xs">
            {selected.size === artists.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleMoveToNew} className="btn-gold text-xs">Move {selected.size} to New Artists</button>
            <BulkEditBar selected={selected} onDone={() => { setSelected(new Set()); setQ(''); load(); refresh(); }} />
          </div>
        )}
      </div>

      {artists.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🚫</div>
          <p className="text-lg font-medium">No artists marked as Not Available</p>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
