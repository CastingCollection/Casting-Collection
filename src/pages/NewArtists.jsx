import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import ArtistModal from '../components/ArtistModal.jsx';

const MOVE_OPTIONS = [
  { value: 'pencil', label: 'Pencilling' },
  { value: 'fitting', label: 'Fittings' },
  { value: 'shoot', label: 'Shoot Dates' },
  { value: 'not_available', label: 'Not Available' },
];

export default function NewArtists() {
  const { refresh, refreshKey, moveArtistsWithUndo } = useApp();
  const [pool, setPool] = useState([]);   // full list, fetched once on mount/refresh
  const [q, setQ] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const searchRef = useRef();
  const [showAdd, setShowAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [uploadResult, setUploadResult] = useState(null);

  // Fetch pool once; re-fetch only when refreshKey changes (not on every q change)
  useEffect(() => {
    api.getArtists({ category: 'new' }).then(setPool).catch(() => {});
  }, [refreshKey]);

  // Filter client-side — no extra HTTP request per keystroke
  const artists = useMemo(() => {
    if (!q.trim()) return pool;
    const lower = q.toLowerCase();
    return pool.filter(a =>
      `${a.first_name} ${a.last_name}`.toLowerCase().includes(lower) ||
      (a.role || '').toLowerCase().includes(lower)
    );
  }, [pool, q]);

  const toggleSelect = (id) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    if (selected.size === artists.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(artists.map(a => a.id)));
    }
  };

  // Build suggestions from pool using a role-count Map (O(n) not O(n²))
  const suggestions = useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase();
    const roleCounts = {};
    pool.forEach(a => { if (a.role) roleCounts[a.role] = (roleCounts[a.role] || 0) + 1; });
    const results = [];
    const seenRoles = new Set();
    pool.forEach(a => {
      if (a.role && a.role.toLowerCase().includes(lower) && !seenRoles.has(a.role)) {
        seenRoles.add(a.role);
        results.push({ type: 'role', label: a.role, count: roleCounts[a.role] });
      }
    });
    pool.forEach(a => {
      const name = `${a.first_name} ${a.last_name}`.toLowerCase();
      if (name.includes(lower)) {
        results.push({ type: 'artist', label: `${a.first_name} ${a.last_name}`, id: a.id, role: a.role });
      }
    });
    return results.slice(0, 12);
  }, [pool, q]);

  const handleSuggestionClick = (suggestion) => {
    if (suggestion.type === 'role') {
      const ids = pool.filter(a => a.role === suggestion.label).map(a => a.id);
      setSelected(new Set(ids));
      setQ(suggestion.label);
    } else {
      setSelected(new Set([suggestion.id]));
      setQ(suggestion.label);
    }
    setShowSuggestions(false);
  };

  const [bulkEdit, setBulkEdit] = useState(null); // { field, label, type }
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  // legacy alias kept for rename role
  const showRenameRole = bulkEdit?.field === 'role';
  const newRoleName = bulkEdit?.field === 'role' ? bulkValue : '';

  const handleBulkMove = async () => {
    if (!moveTarget || selected.size === 0) return;
    const artistsToMove = pool.filter(a => selected.has(a.id));
    setSelected(new Set());
    setMoveTarget('');
    await moveArtistsWithUndo(artistsToMove, moveTarget);
  };

  const RATES = Array.from({ length: (5000 - 200) / 50 + 1 }, (_, i) => `R ${200 + i * 50}`);
  const normalizeRate = v => { const n = v.replace(/[Rr]/gi, '').replace(/\s+/g, '').trim(); return n ? `R ${n}` : ''; };

  const openBulkEdit = (field, label, type = 'text') => { setBulkEdit({ field, label, type }); setBulkValue(''); };

  const handleBulkApply = async () => {
    if (!bulkEdit || selected.size === 0) return;
    let val = bulkValue;
    if (bulkEdit.type === 'rate') val = normalizeRate(bulkValue);
    setBulkSaving(true);
    try {
      await api.bulkFieldUpdate([...selected], bulkEdit.field, val);
      setBulkEdit(null);
      setBulkValue('');
      setSelected(new Set());
      refresh();
    } finally {
      setBulkSaving(false);
    }
  };

  // kept for legacy ref in JSX below
  const handleBulkRenameRole = handleBulkApply;
  const renamingRole = bulkSaving;

  const handleImportExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    const fd = new FormData();
    fd.append('file', file);
    const result = await api.importExcel(fd);
    setUploadResult(result);
    setImporting(false);
    refresh();
    e.target.value = '';
  };

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">New Artists</h1>
          <p className="text-sm text-gray-500 mt-0.5">{artists.length} artists</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.exportArtists('new')} className="btn-dark text-xs">⬇ Export</button>
          <button onClick={() => setShowAdd(true)} className="btn-gold">+ Add Artist</button>
        </div>
      </div>

      {/* Import result */}
      {uploadResult && (
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-green-700">Import complete: {uploadResult.created.length} artists added</p>
              {uploadResult.duplicates.length > 0 && (
                <p className="text-sm text-amber-600 mt-1">{uploadResult.duplicates.length} duplicates skipped</p>
              )}
            </div>
            <button onClick={()=>setUploadResult(null)} className="text-gray-400 hover:text-gray-600">&times;</button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative" ref={searchRef}>
          <input
            className="input-field w-72"
            placeholder="Search by role or name to select…"
            value={q}
            onChange={e => { setQ(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
          {q && (
            <button onClick={() => { setQ(''); setSelected(new Set()); setShowSuggestions(false); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 top-full mt-1 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <button key={i} onMouseDown={() => handleSuggestionClick(s)}
                  className="w-full text-left px-3 py-2 hover:bg-gold/10 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="text-sm font-semibold text-charcoal">{s.label}</span>
                    {s.role && s.type === 'artist' && <span className="text-xs text-gray-400 ml-2">{s.role}</span>}
                  </div>
                  {s.type === 'role'
                    ? <span className="text-xs bg-gold/20 text-gold-dark font-bold px-2 py-0.5 rounded-full whitespace-nowrap">Role · {s.count} artists</span>
                    : <span className="text-xs text-gray-400">Artist</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected.size > 0 && (
          <button onClick={() => { setSelected(new Set()); setQ(''); }} className="btn-ghost text-xs">✕ Clear Selection</button>
        )}
        {artists.length > 0 && (
          <button onClick={selectAll} className="btn-ghost text-xs">
            {selected.size === artists.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gold">{selected.size} selected</span>
            <select
              className="input-field w-44 text-sm"
              value={moveTarget}
              onChange={e => setMoveTarget(e.target.value)}
            >
              <option value="">Move to…</option>
              {MOVE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={handleBulkMove} disabled={!moveTarget} className="btn-gold text-xs">Move</button>
            <button onClick={() => openBulkEdit('agent_name', 'Agent')} className="btn-dark text-xs">✏ Set Agent</button>
            <button onClick={() => openBulkEdit('role', 'Role')} className="btn-dark text-xs">✏ Set Role</button>
            <button onClick={() => openBulkEdit('day_rate', 'Day Rate', 'rate')} className="btn-dark text-xs">✏ Set Day Rate</button>
            <button onClick={() => openBulkEdit('shoot_date', 'Shoot Date', 'date')} className="btn-dark text-xs">✏ Set Shoot Date</button>
            <button onClick={() => openBulkEdit('fitting_date', 'Fitting Date', 'date')} className="btn-dark text-xs">✏ Set Fitting Date</button>
          </div>
        )}
      </div>

      {/* Grid */}
      {artists.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">✨</div>
          <p className="text-lg font-medium">No new artists yet</p>
          <p className="text-sm mt-1">Add artists manually or import from Excel</p>
          <button onClick={() => setShowAdd(true)} className="btn-gold mt-4">+ Add First Artist</button>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
          {artists.map(a => (
            <ArtistCard
              key={a.id}
              artist={a}
              selected={selected.has(a.id)}
              onSelect={toggleSelect}
              showCheckbox
              compact
              onUpdated={refresh}
              onDeleted={refresh}
              actions={MOVE_OPTIONS.map(o => ({
                label: o.label,
                className: 'bg-gray-100 hover:bg-gold/20 text-gray-700 text-xs',
                onClick: async (artist) => {
                  await moveArtistsWithUndo([artist], o.value);
                },
              }))}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ArtistModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
        />
      )}

      {bulkEdit && (
        <div className="modal-overlay" onClick={() => setBulkEdit(null)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-charcoal mb-1">Set {bulkEdit.label}</h3>
            <p className="text-sm text-gray-500 mb-4">
              Apply to <span className="font-semibold text-gold">{selected.size} selected artist{selected.size !== 1 ? 's' : ''}</span>
            </p>
            <label className="block text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wide">New {bulkEdit.label}</label>
            {bulkEdit.type === 'rate' ? (
              <>
                <input list="bulk-rates-list" className="input-field" placeholder="R 850…"
                  value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                  onBlur={e => setBulkValue(normalizeRate(e.target.value))}
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleBulkApply()} />
                <datalist id="bulk-rates-list">{RATES.map(r => <option key={r} value={r} />)}</datalist>
              </>
            ) : bulkEdit.type === 'date' ? (
              <input type="date" className="input-field" value={bulkValue}
                onChange={e => setBulkValue(e.target.value)} autoFocus />
            ) : (
              <input className="input-field" placeholder={`e.g. JHB AIRPORT CROWD 1990`}
                value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                autoFocus onKeyDown={e => e.key === 'Enter' && handleBulkApply()} />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setBulkEdit(null)} className="btn-ghost">Cancel</button>
              <button onClick={handleBulkApply} disabled={bulkSaving} className="btn-gold">
                {bulkSaving ? 'Applying…' : 'Apply to All Selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
