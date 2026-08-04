import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { usePdfProgress } from '../contexts/PdfProgressContext.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import CallSheetView from '../components/CallSheetView.jsx';
import SmartSearchBar from '../components/SmartSearchBar.jsx';
import BulkEditBar from '../components/BulkEditBar.jsx';

export default function Pencilling() {
  const { refresh, refreshKey, moveArtistsWithUndo } = useApp();
  const runPdfDownload = usePdfProgress();
  const [pencilArtists, setPencilArtists] = useState([]);
  const [pencilDates, setPencilDates] = useState([]);
  const [callSheets, setCallSheets] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [activeCS, setActiveCS] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [showCreateDate, setShowCreateDate] = useState(false);
  const [newDateName, setNewDateName] = useState('');
  const [newDateDate, setNewDateDate] = useState('');
  const [showCreateCS, setShowCreateCS] = useState(false);
  const [csTitle, setCsTitle] = useState('');
  const [csDate, setCsDate] = useState('');
  const [csLocation, setCsLocation] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [moveToCS, setMoveToCS] = useState('');
  const [previewCSId, setPreviewCSId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const [dateGroups, setDateGroups] = useState([]);

  // The call sheet preview is served from an authed /api/* route, and an
  // <iframe src> can't attach the Authorization header itself. So we fetch
  // it with the bearer token and hand the iframe a blob: object URL instead,
  // revoking it on cleanup so we don't leak memory.
  useEffect(() => {
    if (!previewCSId) {
      setPreviewUrl(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    api.callSheetPreviewBlobUrl(previewCSId).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setPreviewUrl(url);
    }).catch((err) => {
      console.error('Failed to load call sheet preview', err);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewCSId]);

  const load = async () => {
    const [artists, pds, sheets, groups] = await Promise.all([
      api.getArtists({ category: 'pencil', q }),
      api.getPencilDates(),
      api.getCallSheets('pencil'),
      api.getArtistsByDateType('pencil'),
    ]);
    setPencilArtists(artists);
    setPencilDates(pds);
    setCallSheets(sheets);
    setDateGroups(groups);
  };

  useEffect(() => { load(); }, [q, refreshKey]);

  const toggleCollapse = (id) => {
    setCollapsed(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  // Artists in any call sheet (by artist_id from enriched call sheet data)
  const assignedIds = new Set(callSheets.flatMap(cs => (cs.artists || []).map(a => a.artist_id)));
  const unassigned = pencilArtists.filter(a => !assignedIds.has(a.id));

  const handleMoveToDate = async (pdId) => {
    if (!selected.size) return;
    await api.addToPencilDate(pdId, [...selected]);
    setSelected(new Set());
    refresh();
  };

  const handleRemoveFromDate = async (pdId, artistId) => {
    await api.removeFromPencilDate(pdId, artistId);
    refresh();
  };

  const handleCreateDate = async () => {
    if (!newDateName.trim()) return;
    await api.createPencilDate({ name: newDateName, date: newDateDate });
    setNewDateName('');
    setNewDateDate('');
    setShowCreateDate(false);
    refresh();
  };

  const handleDeleteDate = async (id) => {
    if (!confirm('Delete this pencil date?')) return;
    await api.deletePencilDate(id);
    refresh();
  };

  // For the create-CS modal: artist → banner name mapping
  const [artistBanners, setArtistBanners] = useState({}); // artistId → bannerName
  const [bannerNames, setBannerNames] = useState([]); // ordered list of unique banner names
  const [newBannerInput, setNewBannerInput] = useState('');

  // Derive selected artist objects from pencilArtists
  const selectedArtistObjects = pencilArtists.filter(a => selected.has(a.id));

  // Group selected artists by their assigned banner for preview
  const previewByBanner = () => {
    const groups = {};
    selectedArtistObjects.forEach(a => {
      const b = artistBanners[a.id] || '(Unassigned)';
      if (!groups[b]) groups[b] = [];
      groups[b].push(a);
    });
    return groups;
  };

  const openCreateCS = () => {
    // Pre-group by role
    const roleMap = {};
    selectedArtistObjects.forEach(a => {
      const role = a.role || '(No Role)';
      if (!roleMap[role]) roleMap[role] = [];
      roleMap[role].push(a.id);
    });
    const initialBanners = Object.keys(roleMap).sort();
    const initialAssign = {};
    initialBanners.forEach(role => roleMap[role].forEach(id => { initialAssign[id] = role; }));
    setArtistBanners(initialAssign);
    setBannerNames(initialBanners.length ? initialBanners : []);
    setNewBannerInput('');
    setShowCreateCS(true);
  };

  const handleCreateCallSheet = async () => {
    if (!csTitle.trim()) return;
    const sheet = await api.createCallSheet({ type: 'pencil', title: csTitle, date: csDate, location: csLocation });

    // Create banners and add artists
    if (selectedArtistObjects.length > 0) {
      const bannerIdMap = {};
      for (const name of bannerNames) {
        const b = await api.createBanner(sheet.id, { name, sort_order: bannerNames.indexOf(name) });
        bannerIdMap[name] = b.id;
      }
      // Add all selected artists to the sheet
      const ids = selectedArtistObjects.map(a => a.id);
      await api.addToCallSheet(sheet.id, ids);
      // Assign each artist to their banner
      for (const a of selectedArtistObjects) {
        const bannerName = artistBanners[a.id];
        if (bannerName && bannerIdMap[bannerName]) {
          await api.updateCallSheetArtist(sheet.id, a.id, { banner_id: bannerIdMap[bannerName] });
        }
      }
    }

    setCsTitle('');
    setCsDate('');
    setCsLocation('');
    setShowCreateCS(false);
    setSelected(new Set());
    setActiveCS(sheet.id);
    refresh();
  };

  const handlePromoteToCS = async (pd) => {
    const sheet = await api.createCallSheet({
      type: 'pencil',
      title: pd.name,
      date: pd.date,
    });
    if (pd.artists?.length) {
      await api.addToCallSheet(sheet.id, pd.artists.map(a => a.id));
      await api.bulkCategory(pd.artists.map(a => a.id), 'pencil');
    }
    setActiveCS(sheet.id);
    refresh();
  };

  const handleAddToExistingCS = async () => {
    if (!moveToCS || !selected.size) return;
    await api.addToCallSheet(Number(moveToCS), [...selected]);
    setMoveToCS('');
    setSelected(new Set());
    refresh();
    load();
  };

  const handleBulkMoveCategory = async () => {
    if (!moveTarget || !selected.size) return;
    const artistsToMove = selectedArtistObjects;
    const moved = await moveArtistsWithUndo(artistsToMove, moveTarget);
    if (moved) { setSelected(new Set()); setMoveTarget(''); }
  };

  if (activeCS) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap border-b border-gray-200 pb-3">
          <button onClick={() => { setActiveCS(null); load(); }} className="btn-ghost text-sm shrink-0">← Pencilling</button>
          <div className="w-px h-5 bg-gray-300 shrink-0" />
          {callSheets.map(cs => (
            <button
              key={cs.id}
              onClick={() => setActiveCS(cs.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                cs.id === activeCS
                  ? 'bg-gold text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cs.title || `Sheet #${cs.id}`}
              {cs.date ? <span className="ml-1 text-xs opacity-70">· {cs.date}</span> : null}
            </button>
          ))}
        </div>
        <CallSheetView sheetId={activeCS} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Pencilling</h1>
          <p className="text-sm text-gray-500 mt-0.5">{pencilArtists.length} pencilled artists</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.exportArtists('pencil')} className="btn-dark text-xs">⬇ Export</button>
          <button onClick={openCreateCS} className="btn-gold">+ New Call Sheet</button>
        </div>
      </div>

      {/* Quick-jump navigation */}
      <div className="flex gap-2">
        <button
          onClick={() => document.getElementById('section-a1')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors"
        >
          ↓ A1 — Unassigned Artists
        </button>
        <button
          onClick={() => document.getElementById('section-a2')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors"
        >
          ↓ A2 — Pencil Dates
        </button>
        <button
          onClick={() => document.getElementById('section-b')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors"
        >
          ↓ B — Pencil Call Sheets
        </button>
      </div>

      {/* Search + bulk */}
      <div className="flex gap-3 items-center flex-wrap">
        <SmartSearchBar pool={pencilArtists} q={q} setQ={setQ} onSelectIds={ids => setSelected(new Set(ids))} />
        {selected.size > 0 && (
          <button onClick={() => { setSelected(new Set()); setQ(''); }} className="btn-ghost text-xs">✕ Clear Selection</button>
        )}
        {pencilArtists.length > 0 && (
          <button onClick={() => selected.size === pencilArtists.length ? setSelected(new Set()) : setSelected(new Set(pencilArtists.map(a => a.id)))} className="btn-ghost text-xs">
            {selected.size === pencilArtists.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gold">{selected.size} selected</span>

            {/* Add to existing call sheet */}
            {callSheets.length > 0 && (
              <>
                <select className="input-field w-52 text-sm" value={moveToCS} onChange={e => setMoveToCS(e.target.value)}>
                  <option value="">Add to call sheet…</option>
                  {callSheets.map(cs => (
                    <option key={cs.id} value={cs.id}>{cs.title}{cs.date ? ` — ${cs.date}` : ''}</option>
                  ))}
                </select>
                <button onClick={handleAddToExistingCS} disabled={!moveToCS} className="btn-gold text-xs">Add</button>
              </>
            )}

            {/* Move to category */}
            <select className="input-field w-44 text-sm" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
              <option value="">Move to category…</option>
              <option value="new">New Artists</option>
              <option value="fitting">Fittings</option>
              <option value="shoot">Shoot Dates</option>
              <option value="not_available">Not Available</option>
            </select>
            <button onClick={handleBulkMoveCategory} disabled={!moveTarget} className="btn-gold text-xs">Move</button>

            <BulkEditBar selected={selected} onDone={() => { setSelected(new Set()); setQ(''); load(); refresh(); }} />
          </div>
        )}
      </div>

      {/* Section A1 — Unassigned Pencil Artists */}
      <div id="section-a1" className="card overflow-hidden">
        <div
          className="section-header flex items-center justify-between cursor-pointer"
          onClick={() => toggleCollapse('unassigned')}
        >
          <span>A1 — Unassigned ({unassigned.length})</span>
          <span>{collapsed.has('unassigned') ? '▸' : '▾'}</span>
        </div>
        {!collapsed.has('unassigned') && (
          <div className="p-4">
            {unassigned.length === 0 ? (
              <p className="text-sm text-gray-400 italic">All pencilled artists have been assigned to a call sheet</p>
            ) : (
              <>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => unassigned.length === selected.size ? setSelected(new Set()) : setSelected(new Set(unassigned.map(a=>a.id)))} className="btn-ghost text-xs">
                    {selected.size === unassigned.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                  {unassigned.map(a => (
                    <ArtistCard key={a.id} artist={a} selected={selected.has(a.id)} onSelect={toggleSelect} showCheckbox compact onUpdated={load} onDeleted={load} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Section A2 — Assigned to Call Sheets */}
      <div id="section-a2" className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">A2 — Pencil Dates</h2>

        {callSheets.filter(cs => (cs.artists || []).length > 0).length === 0 ? (
          <div className="card p-6 text-center text-gray-400">
            <p className="text-sm">No artists assigned to a call sheet yet</p>
          </div>
        ) : (
          callSheets.filter(cs => (cs.artists || []).length > 0).map(cs => {
            const banners = cs.banners || [];
            // Build banner groups preserving call sheet order
            const bannerOrder = [...new Set((cs.artists || []).map(a => a.banner_id ?? null))];
            const bannerGroups = bannerOrder.map(bid => {
              const banner = banners.find(b => b.id === bid) || null;
              const assignedArtists = (cs.artists || []).filter(a => (a.banner_id ?? null) === bid);
              const artistIds = new Set(assignedArtists.map(a => a.artist_id));
              const artistObjects = pencilArtists.filter(a => artistIds.has(a.id));
              return { banner, artistObjects };
            }).filter(g => g.artistObjects.length > 0);
            const allInCS = bannerGroups.flatMap(g => g.artistObjects);
            return (
              <div key={cs.id} className="card overflow-hidden">
                <div
                  className="section-header flex items-center justify-between cursor-pointer"
                  onClick={() => toggleCollapse(`cs-${cs.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-charcoal">{cs.title}</span>
                    {cs.date && <span className="text-gray-400 text-xs">{cs.date}</span>}
                    <span className="badge bg-amber-100 text-amber-800">{cs.artists.length} artists</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setPreviewCSId(cs.id)} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">👁 Preview</button>
                    <button onClick={() => setActiveCS(cs.id)} className="text-xs px-2 py-1 bg-gold/20 text-gold-dark rounded hover:bg-gold/30">Open</button>
                    <button onClick={() => runPdfDownload('Roster PDF', onProgress => api.callSheetRosterPdfUrl(cs.id, onProgress))} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">⬇ Roster PDF</button>
                    <span>{collapsed.has(`cs-${cs.id}`) ? '▸' : '▾'}</span>
                  </div>
                </div>
                {!collapsed.has(`cs-${cs.id}`) && (
                  <div className="p-4 space-y-4">
                    {allInCS.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Artist cards not available — they may have been moved to another category</p>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const ids = allInCS.map(a => a.id);
                              const allSelected = ids.every(id => selected.has(id));
                              setSelected(s => { const n = new Set(s); ids.forEach(id => allSelected ? n.delete(id) : n.add(id)); return n; });
                            }}
                            className="btn-ghost text-xs"
                          >
                            {allInCS.every(a => selected.has(a.id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        {bannerGroups.map((g, gi) => (
                          <div key={gi}>
                            {g.banner && (
                              <div className="flex items-center justify-between px-3 py-1.5 rounded-md mb-2"
                                style={{ background: '#C9A84C', color: '#1a1a1a' }}>
                                <span className="text-xs font-bold uppercase tracking-wider">{g.banner.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold opacity-70">{g.artistObjects.length} artists</span>
                                  <button
                                    onClick={() => {
                                      const ids = g.artistObjects.map(a => a.id);
                                      const allSel = ids.every(id => selected.has(id));
                                      setSelected(s => { const n = new Set(s); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n; });
                                    }}
                                    className="text-xs px-2 py-0.5 rounded bg-black/20 hover:bg-black/40 font-semibold transition-colors"
                                  >
                                    {g.artistObjects.every(a => selected.has(a.id)) ? 'Deselect' : 'Select All'}
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                              {g.artistObjects.map(a => (
                                <ArtistCard key={a.id} artist={a} selected={selected.has(a.id)} onSelect={toggleSelect} showCheckbox compact onUpdated={load} onDeleted={load} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Section B — Call Sheets */}
      <div id="section-b" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">B — Pencil Call Sheets</h2>
          <button onClick={openCreateCS} className="btn-ghost text-xs">+ New Call Sheet</button>
        </div>

        {callSheets.length === 0 ? (
          <div className="card p-6 text-center text-gray-400">
            <p className="text-sm">No pencil call sheets yet — create one above</p>
          </div>
        ) : (
          callSheets.map(cs => (
            <div key={cs.id} className="card p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold">{cs.title}</p>
                <p className="text-xs text-gray-500">{cs.date} · {cs.location} · {cs.artists?.length || 0} artists</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPreviewCSId(cs.id)} className="btn-dark text-xs">👁 Preview</button>
                <button onClick={() => setActiveCS(cs.id)} className="btn-gold text-xs">Open</button>
                <button onClick={() => runPdfDownload('Call Sheet PDF', onProgress => api.callSheetPdfUrl(cs.id, undefined, onProgress))} className="btn-dark text-xs">⬇ PDF</button>
                <button
                  onClick={async () => {
                    if (!confirm(`Move "${cs.title}" to Fittings? All artists will be moved to the Fittings category.`)) return;
                    await api.promoteToFitting(cs.id);
                    load();
                    refresh();
                  }}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-semibold"
                >
                  → Fittings
                </button>
                <button onClick={async () => { if (confirm('Delete this call sheet?')) { await api.deleteCallSheet(cs.id); load(); refresh(); } }} className="btn-danger text-xs">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Call Sheet Preview modal */}
      {previewCSId && (
        <div className="modal-overlay" onClick={() => setPreviewCSId(null)}>
          <div className="bg-white rounded-xl flex flex-col" style={{ width: '90vw', height: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="font-bold text-charcoal">Call Sheet Preview</h3>
              <div className="flex gap-2">
                <button onClick={() => runPdfDownload('Call Sheet PDF', onProgress => api.callSheetPdfUrl(previewCSId, undefined, onProgress))} className="btn-dark text-xs">⬇ Download PDF</button>
                <button onClick={() => setPreviewCSId(null)} className="btn-ghost text-xs">✕ Close</button>
              </div>
            </div>
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="flex-1 w-full rounded-b-xl"
                title="Call Sheet Preview"
              />
            ) : (
              <div className="flex-1 w-full flex items-center justify-center text-gray-400 text-sm">Loading preview…</div>
            )}
          </div>
        </div>
      )}

      {/* Create Pencil Date modal */}
      {showCreateDate && (
        <div className="modal-overlay" onClick={()=>setShowCreateDate(false)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={e=>e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">New Pencil Date</h3>
            <div className="space-y-3">
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Name</label><input className="input-field mt-1" value={newDateName} onChange={e=>setNewDateName(e.target.value)} placeholder="e.g. Pencil Date 1 — Monday 29 June 2026" /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Date</label><input type="date" className="input-field mt-1" value={newDateDate} onChange={e=>setNewDateDate(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={()=>setShowCreateDate(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleCreateDate} className="btn-gold">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Call Sheet modal */}
      {showCreateCS && (
        <div className="modal-overlay" onClick={() => setShowCreateCS(false)}>
          <div className="bg-white rounded-xl w-[700px] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="font-bold text-lg text-charcoal">New Pencil Call Sheet</h3>
              {selectedArtistObjects.length > 0 && (
                <p className="text-sm text-gray-500 mt-0.5">{selectedArtistObjects.length} selected artists will be added</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Call sheet details */}
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-3"><label className="text-xs font-semibold text-gray-500 uppercase">Title</label><input className="input-field mt-1" value={csTitle} onChange={e => setCsTitle(e.target.value)} placeholder="PENCILLED CALL SHEET" autoFocus /></div>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Date</label><input type="date" className="input-field mt-1" value={csDate} onChange={e => setCsDate(e.target.value)} /></div>
                <div className="col-span-2"><label className="text-xs font-semibold text-gray-500 uppercase">Location</label><input className="input-field mt-1" value={csLocation} onChange={e => setCsLocation(e.target.value)} /></div>
              </div>

              {/* Artist grouping */}
              {selectedArtistObjects.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Assign Artists to Banners / Categories</label>
                  </div>

                  {/* Add banner */}
                  <div className="flex gap-2 mb-3">
                    <input className="input-field flex-1 text-sm" placeholder="New banner name (e.g. LEAD BG, CROWD, VIP)…"
                      value={newBannerInput} onChange={e => setNewBannerInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newBannerInput.trim()) {
                          setBannerNames(b => [...b, newBannerInput.trim()]);
                          setNewBannerInput('');
                        }
                      }} />
                    <button className="btn-dark text-xs" onClick={() => {
                      if (!newBannerInput.trim()) return;
                      setBannerNames(b => [...b, newBannerInput.trim()]);
                      setNewBannerInput('');
                    }}>+ Add Banner</button>
                  </div>

                  {/* Artists table — assign each to a banner */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Artist</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Role</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Agent</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Day Rate</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Shoot Date</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Banner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedArtistObjects.map(a => (
                          <tr key={a.id} className="border-b border-gray-100 last:border-0 hover:bg-amber-50/30">
                            <td className="px-3 py-2 font-semibold">{a.first_name} {a.last_name}</td>
                            <td className="px-3 py-2 text-gray-600">{a.role || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{a.agent_name || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{a.day_rate || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{a.shoot_date || '—'}</td>
                            <td className="px-3 py-2">
                              <select
                                className="input-field text-xs py-1"
                                value={artistBanners[a.id] || ''}
                                onChange={e => setArtistBanners(b => ({ ...b, [a.id]: e.target.value }))}
                              >
                                <option value="">No banner</option>
                                {bannerNames.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setShowCreateCS(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleCreateCallSheet} disabled={!csTitle.trim()} className="btn-gold">
                Create Call Sheet{selectedArtistObjects.length > 0 ? ` with ${selectedArtistObjects.length} Artists` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
