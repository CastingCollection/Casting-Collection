import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import CallSheetView from '../components/CallSheetView.jsx';
import SmartSearchBar from '../components/SmartSearchBar.jsx';
import BulkEditBar from '../components/BulkEditBar.jsx';

export default function ShootDates() {
  const { refresh, refreshKey } = useApp();
  const [artists, setArtists] = useState([]);
  const [callSheets, setCallSheets] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [activeCS, setActiveCS] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [moveToCS, setMoveToCS] = useState('');
  const [previewCSId, setPreviewCSId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

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

  // New call sheet modal state
  const [showCreateCS, setShowCreateCS] = useState(false);
  const [csTitle, setCsTitle] = useState('');
  const [csDate, setCsDate] = useState('');
  const [csLocation, setCsLocation] = useState('');
  const [artistBanners, setArtistBanners] = useState({});
  const [bannerNames, setBannerNames] = useState([]);
  const [newBannerInput, setNewBannerInput] = useState('');

  const load = async () => {
    const [arts, sheets] = await Promise.all([
      api.getArtists({ category: 'shoot', q }),
      api.getCallSheets('shoot'),
    ]);
    setArtists(arts);
    setCallSheets(sheets);
  };

  useEffect(() => { load(); }, [q, refreshKey]);

  const toggleCollapse = (id) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelect  = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleGroup = (ids) => {
    const allSel = ids.every(id => selected.has(id));
    setSelected(s => { const n = new Set(s); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n; });
  };

  const assignedIds = new Set(callSheets.flatMap(cs => (cs.artists || []).map(a => a.artist_id)));
  const unassigned  = artists.filter(a => !assignedIds.has(a.id));

  const selectedArtistObjects = artists.filter(a => selected.has(a.id));

  // ── handlers ──────────────────────────────────────────────────────────────

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
    await api.bulkCategory([...selected], moveTarget);
    setSelected(new Set());
    setMoveTarget('');
    refresh();
  };

  const openCreateCS = () => {
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
    setBannerNames(initialBanners);
    setNewBannerInput('');
    setCsTitle('');
    setCsDate('');
    setCsLocation('');
    setShowCreateCS(true);
  };

  const handleCreateCallSheet = async () => {
    if (!csTitle.trim()) return;
    const sheet = await api.createCallSheet({ type: 'shoot', title: csTitle, date: csDate, location: csLocation });
    if (selectedArtistObjects.length > 0) {
      const bannerIdMap = {};
      for (const name of bannerNames) {
        const b = await api.createBanner(sheet.id, { name, sort_order: bannerNames.indexOf(name) });
        bannerIdMap[name] = b.id;
      }
      await api.addToCallSheet(sheet.id, selectedArtistObjects.map(a => a.id));
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

  // ── call sheet view ────────────────────────────────────────────────────────

  if (activeCS) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap border-b border-gray-200 pb-3">
          <button onClick={() => { setActiveCS(null); load(); }} className="btn-ghost text-sm shrink-0">← Shoot Dates</button>
          <div className="w-px h-5 bg-gray-300 shrink-0" />
          {[...callSheets].sort((a, b) => {
            const numA = parseInt((a.title || '').replace(/\D/g, ''), 10) || 0;
            const numB = parseInt((b.title || '').replace(/\D/g, ''), 10) || 0;
            return numB - numA;
          }).map(cs => (
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

  // ── main view ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Shoot Dates</h1>
          <p className="text-sm text-gray-500 mt-0.5">{artists.length} artists · {callSheets.length} call sheets</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.exportArtists('shoot')} className="btn-dark text-xs">⬇ Export</button>
          <button onClick={openCreateCS} className="btn-gold">+ New Call Sheet</button>
        </div>
      </div>

      {/* Quick-jump navigation */}
      <div className="flex gap-2">
        <button onClick={() => document.getElementById('shoot-a1')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors">
          ↓ A1 — Unassigned Artists
        </button>
        <button onClick={() => document.getElementById('shoot-a2')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors">
          ↓ A2 — Shoot Dates
        </button>
        <button onClick={() => document.getElementById('shoot-b')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-600 hover:border-gold hover:text-gold transition-colors">
          ↓ B — Shoot Call Sheets
        </button>
      </div>

      {/* Search + bulk toolbar */}
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
            <span className="text-sm font-semibold text-gold">{selected.size} selected</span>

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

            <select className="input-field w-44 text-sm" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
              <option value="">Move to category…</option>
              <option value="new">New Artists</option>
              <option value="pencil">Pencilling</option>
              <option value="fitting">Fittings</option>
              <option value="not_available">Not Available</option>
            </select>
            <button onClick={handleBulkMoveCategory} disabled={!moveTarget} className="btn-gold text-xs">Move</button>

            <BulkEditBar selected={selected} onDone={() => { setSelected(new Set()); setQ(''); load(); refresh(); }} />
          </div>
        )}
      </div>

      {/* A1 — Unassigned */}
      <div id="shoot-a1" className="card overflow-hidden">
        <div className="section-header flex items-center justify-between cursor-pointer" onClick={() => toggleCollapse('shoot-unassigned')}>
          <span>A1 — Unassigned ({unassigned.length})</span>
          <span>{expanded.has('shoot-unassigned') ? '▾' : '▸'}</span>
        </div>
        {expanded.has('shoot-unassigned') && (
          <div className="p-4">
            {unassigned.length === 0 ? (
              <p className="text-sm text-gray-400 italic">All shoot artists have been assigned to a call sheet</p>
            ) : (
              <>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => toggleGroup(unassigned.map(a => a.id))} className="btn-ghost text-xs">
                    {unassigned.every(a => selected.has(a.id)) ? 'Deselect All' : 'Select All'}
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

      {/* A2 — Assigned to Call Sheets */}
      <div id="shoot-a2" className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">A2 — Shoot Dates</h2>

        {callSheets.filter(cs => (cs.artists || []).length > 0).length === 0 ? (
          <div className="card p-6 text-center text-gray-400">
            <p className="text-sm">No artists assigned to a call sheet yet</p>
          </div>
        ) : (
          [...callSheets].filter(cs => (cs.artists || []).length > 0).sort((a, b) => {
            const numA = parseInt((a.title || '').replace(/\D/g, ''), 10) || 0;
            const numB = parseInt((b.title || '').replace(/\D/g, ''), 10) || 0;
            return numB - numA;
          }).map(cs => {
            const csArtists = (cs.artists || []).map(a => ({ ...a, id: a.artist_id }));
            const bannerMap = {};
            csArtists.forEach(a => {
              const key = a.banner_id ?? '__none__';
              if (!bannerMap[key]) bannerMap[key] = [];
              bannerMap[key].push(a);
            });
            const orderedGroups = [
              ...(cs.banners || []).filter(b => bannerMap[b.id]).map(b => ({ banner: b, artists: bannerMap[b.id] })),
              ...(bannerMap['__none__'] ? [{ banner: null, artists: bannerMap['__none__'] }] : []),
            ];
            const allIds = csArtists.map(a => a.id);
            return (
              <div key={cs.id} className="card overflow-hidden">
                <div className="section-header flex items-center justify-between cursor-pointer" style={{ borderLeft: '4px solid #8B1A1A' }} onClick={() => toggleCollapse(`shoot-cs-${cs.id}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-charcoal">{cs.title}</span>
                    {cs.date && <span className="text-gray-400 text-xs">{cs.date}</span>}
                    <span className="badge bg-red-100 text-red-800">{cs.artists.length} artists</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setPreviewCSId(cs.id)} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">👁 Preview</button>
                    <button onClick={() => setActiveCS(cs.id)} className="text-xs px-2 py-1 bg-gold/20 text-gold-dark rounded hover:bg-gold/30">Open</button>
                    <button onClick={() => api.callSheetRosterPdfUrl(cs.id)} className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">⬇ Roster PDF</button>
                    <span>{expanded.has(`shoot-cs-${cs.id}`) ? '▾' : '▸'}</span>
                  </div>
                </div>
                {expanded.has(`shoot-cs-${cs.id}`) && (
                  <div className="p-4 space-y-4">
                    {csArtists.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Artist cards not available</p>
                    ) : (
                      <>
                        {/* Select All for whole call sheet */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => toggleGroup(allIds)}
                            className="btn-ghost text-xs"
                          >
                            {allIds.every(id => selected.has(id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        {orderedGroups.map((group, gi) => {
                          const groupIds = group.artists.map(a => a.id);
                          const allGroupSel = groupIds.every(id => selected.has(id));
                          return (
                            <div key={gi}>
                              {group.banner ? (
                                // Named banner header with inline select button
                                <div className="px-3 py-1 mb-2 rounded text-xs font-bold uppercase tracking-wide flex items-center justify-between" style={{ background: '#d4a843', color: '#000' }}>
                                  <div className="flex items-center gap-2">
                                    <span>{group.banner.name}</span>
                                    <span className="bg-black/20 rounded-full px-2 py-0.5 text-[10px] font-bold">{group.artists.length}</span>
                                  </div>
                                  <button
                                    onClick={() => toggleGroup(groupIds)}
                                    className="text-[10px] font-bold bg-black/20 hover:bg-black/40 rounded px-2 py-0.5 transition-colors"
                                  >
                                    {allGroupSel ? 'Deselect' : 'Select All'}
                                  </button>
                                </div>
                              ) : (
                                // Unassigned group header
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                    Unassigned ({group.artists.length})
                                  </span>
                                  <button
                                    onClick={() => toggleGroup(groupIds)}
                                    className="text-xs text-gray-500 hover:text-gold border border-gray-300 hover:border-gold rounded px-2 py-0.5 transition-colors"
                                  >
                                    {allGroupSel ? 'Deselect' : 'Select All'}
                                  </button>
                                </div>
                              )}
                              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                                {group.artists.map(a => (
                                  <ArtistCard key={a.id} artist={a} selected={selected.has(a.id)} onSelect={toggleSelect} showCheckbox compact onUpdated={load} onDeleted={load} />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* B — Shoot Call Sheets */}
      <div id="shoot-b" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">B — Shoot Call Sheets</h2>
          <button onClick={openCreateCS} className="btn-ghost text-xs">+ New Call Sheet</button>
        </div>

        {callSheets.length === 0 ? (
          <div className="card p-6 text-center text-gray-400">
            <p className="text-sm">No shoot call sheets yet — create one above</p>
          </div>
        ) : (
          [...callSheets].sort((a, b) => {
            const numA = parseInt((a.title || '').replace(/\D/g, ''), 10) || 0;
            const numB = parseInt((b.title || '').replace(/\D/g, ''), 10) || 0;
            return numB - numA;
          }).map(cs => (
            <div key={cs.id} className="card p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold">{cs.title}</p>
                <p className="text-xs text-gray-500">{cs.date} · {cs.location} · {cs.artists?.length || 0} artists</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPreviewCSId(cs.id)} className="btn-dark text-xs">👁 Preview</button>
                <button onClick={() => setActiveCS(cs.id)} className="btn-gold text-xs">Open</button>
                <button onClick={() => api.callSheetPdfUrl(cs.id)} className="btn-dark text-xs">⬇ PDF</button>
                <button onClick={() => api.callSheetExcelUrl(cs.id)} className="btn-dark text-xs">⬇ Excel</button>
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
                <button onClick={() => api.callSheetPdfUrl(previewCSId)} className="btn-dark text-xs">⬇ Download PDF</button>
                <button onClick={() => setPreviewCSId(null)} className="btn-ghost text-xs">✕ Close</button>
              </div>
            </div>
            {previewUrl ? (
              <iframe src={previewUrl} className="flex-1 w-full rounded-b-xl" title="Call Sheet Preview" />
            ) : (
              <div className="flex-1 w-full flex items-center justify-center text-gray-400 text-sm">Loading preview…</div>
            )}
          </div>
        </div>
      )}

      {/* Create Call Sheet modal */}
      {showCreateCS && (
        <div className="modal-overlay" onClick={() => setShowCreateCS(false)}>
          <div className="bg-white rounded-xl w-[700px] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="font-bold text-lg text-charcoal">New Shoot Call Sheet</h3>
              {selectedArtistObjects.length > 0 && (
                <p className="text-sm text-gray-500 mt-0.5">{selectedArtistObjects.length} selected artists will be added</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-3"><label className="text-xs font-semibold text-gray-500 uppercase">Title</label><input className="input-field mt-1" value={csTitle} onChange={e => setCsTitle(e.target.value)} placeholder="SHOOTDAY CALL SHEET" autoFocus /></div>
                <div><label className="text-xs font-semibold text-gray-500 uppercase">Date</label><input type="date" className="input-field mt-1" value={csDate} onChange={e => setCsDate(e.target.value)} /></div>
                <div className="col-span-2"><label className="text-xs font-semibold text-gray-500 uppercase">Location</label><input className="input-field mt-1" value={csLocation} onChange={e => setCsLocation(e.target.value)} /></div>
              </div>

              {selectedArtistObjects.length > 0 && (
                <div>
                  <div className="flex gap-2 mb-3">
                    <input className="input-field flex-1 text-sm" placeholder="New banner name (e.g. LEAD BG, CROWD)…"
                      value={newBannerInput} onChange={e => setNewBannerInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && newBannerInput.trim()) { setBannerNames(b => [...b, newBannerInput.trim()]); setNewBannerInput(''); } }} />
                    <button className="btn-dark text-xs" onClick={() => { if (!newBannerInput.trim()) return; setBannerNames(b => [...b, newBannerInput.trim()]); setNewBannerInput(''); }}>+ Add Banner</button>
                  </div>
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
                              <select className="input-field text-xs py-1" value={artistBanners[a.id] || ''} onChange={e => setArtistBanners(b => ({ ...b, [a.id]: e.target.value }))}>
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
