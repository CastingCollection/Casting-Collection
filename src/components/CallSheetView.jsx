import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { usePdfProgress } from '../contexts/PdfProgressContext.jsx';

// All the fields a call-sheet-artist row actually carries. The PUT route
// that updates a single artist (used to restore state on Undo) always
// writes every one of these — any field left out of the request body gets
// reset to null server-side, it's not a partial update. So an Undo restore
// must always send the artist's full original snapshot, never just the one
// field that changed, or it would silently wipe the artist's other columns.
const CS_ARTIST_FIELDS = ['call_time', 'report_to', 'pickup_time', 'pickup_point', 'notes', 'banner_id'];

export default function CallSheetView({ sheetId, onClose }) {
  const { refresh, pushUndo } = useApp();
  const runPdfDownload = usePdfProgress();
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState({});
  const [newBannerName, setNewBannerName] = useState('');
  const [addingBanner, setAddingBanner] = useState(false);
  const [copyToAll, setCopyToAll] = useState({ call_time: '', report_to: '', pickup_time: '', pickup_point: '', notes: '' });
  const [editingArtist, setEditingArtist] = useState(null);
  const [artistForm, setArtistForm] = useState({});
  const [movingArtist, setMovingArtist] = useState(null);
  const [selectedArtists, setSelectedArtists] = useState(new Set());
  const [siblingSheets, setSiblingSheets] = useState([]);
  const [footerNotes, setFooterNotes] = useState([]);
  const [bulkMoveBanner, setBulkMoveBanner] = useState('');
  const [bulkMoveSheet, setBulkMoveSheet] = useState('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null); // bannerId
  const [bannerNameDraft, setBannerNameDraft] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const [notesSort, setNotesSort] = useState(null); // null | 'asc' | 'desc'
  const [editingNote, setEditingNote] = useState(null); // artist_id
  const [noteDraft, setNoteDraft] = useState('');
  const [expandedSections, setExpandedSections] = useState(new Set());
  const toggleSection = (key) => setExpandedSections(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Set by the search dropdown so the found artist's row stays visibly
  // highlighted until the user actually checks it (rather than fading on a
  // timer, which made it easy to lose track of the row again on a long
  // sheet before you'd gotten to it).
  const [highlightedArtistId, setHighlightedArtistId] = useState(null);

  const toggleSelectArtist = (id) => {
    if (id === highlightedArtistId) setHighlightedArtistId(null);
    setSelectedArtists(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAllArtists  = (ids) => {
    if (highlightedArtistId !== null && ids.includes(highlightedArtistId)) setHighlightedArtistId(null);
    setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.add(id)); return n; });
  };
  const deselectAll       = () => setSelectedArtists(new Set());

  const load = async () => {
    const data = await api.getCallSheet(sheetId);
    setSheet(data);
    // Load sibling sheets of same type for cross-sheet moves
    const all = await api.getCallSheets(data.type);
    setSiblingSheets(all.filter(s => s.id !== data.id));
    // Load previously used footer notes
    api.getFooterNotes().then(setFooterNotes).catch(() => {});
    setHeaderForm({
      title: data.title,
      date: data.date,
      location: data.location,
      director_name: data.director_name,
      assistant_name: data.assistant_name,
      footer_note: data.footer_note,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [sheetId]);

  if (loading) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (!sheet) return null;

  const isShoot   = sheet.type === 'shoot';
  const isFitting = sheet.type === 'fitting';

  // Unique existing values per field for datalist suggestions
  const suggestions = (field) => [...new Set((sheet.artists || []).map(a => a[field]).filter(Boolean))].sort();

  // For shoot sheets: only show columns where at least one artist has data
  // pickup_point and pickup_time are excluded from regular/reportTo sections — they only appear in the pickup section header
  const shootOptionalCols = ['pickup_point','pickup_time','report_to','call_time','notes'];
  const shootVisibleCols = isShoot
    ? shootOptionalCols.filter(col => (sheet.artists || []).some(a => a[col] && String(a[col]).trim()))
    : [];
  // Columns for regular time-group and report-to tables — never show pickup columns there
  const shootVisibleColsNoPickup = shootVisibleCols.filter(c => c !== 'pickup_point' && c !== 'pickup_time');

  const handleSaveHeader = async () => {
    await api.updateCallSheet(sheetId, { ...sheet, ...headerForm });
    setEditingHeader(false);
    load();
  };

  const handleAddBanner = async () => {
    if (!newBannerName.trim()) return;
    await api.createBanner(sheetId, { name: newBannerName, sort_order: sheet.banners.length });
    setNewBannerName('');
    setAddingBanner(false);
    load();
  };

  const handleDeleteBanner = async (bannerId) => {
    if (!confirm('Delete this banner? Artists will become unassigned.')) return;
    await api.deleteBanner(bannerId);
    load();
  };

  const handleRenameBanner = async (bannerId) => {
    if (!bannerNameDraft.trim()) return;
    await api.updateBanner(bannerId, { name: bannerNameDraft.trim() });
    setEditingBanner(null);
    load();
  };

  const renderBannerLabel = (banner, count) => editingBanner === banner.id ? (
    <form onSubmit={e => { e.preventDefault(); handleRenameBanner(banner.id); }} className="flex items-center gap-1 flex-1">
      <input
        autoFocus
        className="input-field py-0.5 text-xs font-bold uppercase flex-1"
        value={bannerNameDraft}
        onChange={e => setBannerNameDraft(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && setEditingBanner(null)}
      />
      <button type="submit" className="text-xs px-2 py-0.5 bg-green-600 text-white rounded">✓</button>
      <button type="button" onClick={() => setEditingBanner(null)} className="text-xs px-2 py-0.5 bg-gray-200 rounded">✗</button>
    </form>
  ) : (
    <span
      className="font-bold text-xs text-charcoal uppercase cursor-pointer hover:text-gold"
      onClick={() => { setEditingBanner(banner.id); setBannerNameDraft(banner.name); }}
      title="Click to rename"
    >
      {banner.name} ({count})
    </span>
  );

  const handleRemoveArtist = async (artistId) => {
    await api.removeFromCallSheet(sheetId, artistId);
    load();
    refresh();
  };

  // Snapshots every relevant field for a set of artists BEFORE a bulk write,
  // so Undo can put each one back exactly as it was — different artists on
  // the sheet can have different existing call times/locations, so this
  // can't just be "set it back to one shared value."
  const snapshotArtists = (ids) => sheet.artists
    .filter(a => ids.includes(a.artist_id))
    .map(a => ({ artist_id: a.artist_id, prev: Object.fromEntries(CS_ARTIST_FIELDS.map(k => [k, a[k] ?? null])) }));

  const restoreSnapshot = async (snapshot) => {
    await Promise.all(snapshot.map(s => api.updateCallSheetArtist(sheetId, s.artist_id, s.prev)));
    load();
  };

  const handleCopyToAll = async () => {
    const fields = Object.fromEntries(Object.entries(copyToAll).filter(([,v]) => v));
    if (!Object.keys(fields).length) return;
    const ids = selectedArtists.size > 0 ? [...selectedArtists] : sheet.artists.map(a => a.artist_id);
    if (!ids.length) return;
    const snapshot = snapshotArtists(ids);
    await api.bulkUpdateCallSheetArtists(sheetId, selectedArtists.size > 0 ? ids : null, fields);
    deselectAll();
    load();
    const fieldLabel = Object.keys(fields).map(f => f.replace(/_/g, ' ')).join(', ');
    pushUndo(`Set ${fieldLabel} for ${ids.length} artist${ids.length !== 1 ? 's' : ''}`, () => restoreSnapshot(snapshot));
  };

  const handleSaveArtist = async () => {
    await api.updateCallSheetArtist(sheetId, editingArtist, artistForm);
    setEditingArtist(null);
    load();
  };

  const handleMoveArtist = async (artistId, bannerId) => {
    await api.updateCallSheetArtist(sheetId, artistId, { banner_id: bannerId || null });
    setMovingArtist(null);
    load();
  };

  const handleBulkMoveBanner = async () => {
    if (!bulkMoveBanner || !selectedArtists.size) return;
    setBulkMoving(true);
    try {
      const ids = [...selectedArtists];
      const snapshot = snapshotArtists(ids);
      const bannerId = bulkMoveBanner === '__none__' ? null : Number(bulkMoveBanner);
      const bannerLabel = bulkMoveBanner === '__none__' ? 'No Banner' : (sheet.banners.find(b => b.id === bannerId)?.name || 'that banner');
      await api.bulkUpdateCallSheetArtists(sheetId, ids, { banner_id: bannerId });
      setBulkMoveBanner('');
      deselectAll();
      load();
      pushUndo(`Moved ${ids.length} artist${ids.length !== 1 ? 's' : ''} to ${bannerLabel}`, () => restoreSnapshot(snapshot));
    } finally { setBulkMoving(false); }
  };

  const handleClearColumn = async (field) => {
    const ids = selectedArtists.size > 0 ? [...selectedArtists] : (sheet.artists || []).map(a => a.artist_id);
    const target = selectedArtists.size > 0 ? `${selectedArtists.size} selected artist${selectedArtists.size !== 1 ? 's' : ''}` : 'all artists on this sheet';
    if (!confirm(`Clear "${field.replace(/_/g,' ')}" for ${target}?`)) return;
    if (!ids.length) return;
    const snapshot = snapshotArtists(ids);
    await api.bulkUpdateCallSheetArtists(sheetId, ids, { [field]: '' });
    deselectAll();
    load();
    pushUndo(`Cleared ${field.replace(/_/g, ' ')} for ${ids.length} artist${ids.length !== 1 ? 's' : ''}`, () => restoreSnapshot(snapshot));
  };

  const handleSaveNote = async (artistId) => {
    await api.updateCallSheetArtist(sheetId, artistId, { ...sheet.artists.find(a => a.artist_id === artistId), notes: noteDraft });
    setEditingNote(null);
    load();
  };

  const handleBulkMoveSheet = async () => {
    if (!bulkMoveSheet || !selectedArtists.size) return;
    setBulkMoving(true);
    try {
      const ids = [...selectedArtists];
      const targetId = Number(bulkMoveSheet);
      const targetLabel = siblingSheets.find(s => s.id === targetId)?.title || 'another call sheet';
      await api.moveToCallSheet(targetId, sheetId, ids);
      setBulkMoveSheet('');
      deselectAll();
      load();
      // Moving between call sheets (not just banners within one) is
      // reversible by just swapping target/source and moving the same
      // artist ids back — the move-from route already matches/creates a
      // banner by name on whichever sheet is the destination.
      pushUndo(`Moved ${ids.length} artist${ids.length !== 1 ? 's' : ''} to ${targetLabel}`, async () => {
        await api.moveToCallSheet(sheetId, targetId, ids);
        load();
      });
    } finally { setBulkMoving(false); }
  };

  const fmtDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // For shoot sheets: artists with pickup info → PICK UP section; artists with only report_to → REPORT TO section
  const hasPickup   = a => isShoot && ((a.pickup_point||'').trim() || (a.pickup_time||'').trim());
  const hasReportTo = a => isShoot && (a.report_to||'').trim() && !hasPickup(a);
  const pickupArtists   = sheet.artists.filter(hasPickup);
  const reportToArtists = sheet.artists.filter(hasReportTo);
  const regularArtists  = sheet.artists.filter(a => !hasPickup(a) && !hasReportTo(a));

  const sortTime = (t) => {
    if (!t) return 9999;
    const cleaned = t.replace(':', '').trim();
    return /^\d+$/.test(cleaned) ? parseInt(cleaned, 10) : 9999;
  };

  // Helper: banner-grouped subgroups in banner sort order
  const buildSubGroupsFor = (artistList) => {
    if (!artistList.length) return [];
    const bannerIds = [...new Set(artistList.map(a => a.banner_id))];
    const groups = bannerIds.map(bid => ({
      banner: sheet.banners.find(b => b.id === bid) || null,
      artists: artistList.filter(a => a.banner_id === bid),
    }));
    return [
      ...groups.filter(g => !g.banner),
      ...sheet.banners.filter(b => groups.find(g => g.banner?.id === b.id)).map(b => groups.find(g => g.banner?.id === b.id)),
    ];
  };

  // PICK UP — grouped by pickup_time, then banner within each time slot
  const pickupTimeGroups = (() => {
    if (!pickupArtists.length) return [];
    const times = [...new Set(pickupArtists.map(a => a.pickup_time||''))].sort((a,b) => sortTime(a) - sortTime(b));
    return times.map(time => {
      const inTime = pickupArtists.filter(a => (a.pickup_time||'') === time);
      const bannerIds = [...new Set(inTime.map(a => a.banner_id))];
      const groups = bannerIds.map(bid => ({
        banner: sheet.banners.find(b => b.id === bid) || null,
        artists: inTime.filter(a => a.banner_id === bid).sort((a, b) => {
          const aS = (a.pickup_point ? 2 : 0) + (a.pickup_time ? 1 : 0);
          const bS = (b.pickup_point ? 2 : 0) + (b.pickup_time ? 1 : 0);
          return bS - aS;
        }),
      }));
      return {
        time,
        subGroups: [
          ...groups.filter(g => !g.banner),
          ...sheet.banners.filter(b => groups.find(g => g.banner?.id === b.id)).map(b => groups.find(g => g.banner?.id === b.id)),
        ],
      };
    });
  })();

  // REPORT TO — grouped by (report_to + call_time) combination, sorted by call_time then report_to
  const reportToGroups = (() => {
    if (!reportToArtists.length) return [];
    const seen = new Set();
    const combos = [];
    reportToArtists.forEach(a => {
      const key = `${a.report_to||''}|||${a.call_time||''}`;
      if (!seen.has(key)) { seen.add(key); combos.push({ rt: a.report_to||'', ct: a.call_time||'' }); }
    });
    combos.sort((a, b) => sortTime(a.ct) - sortTime(b.ct) || a.rt.localeCompare(b.rt));
    return combos.map(({ rt, ct }) => ({
      reportTo: rt,
      callTime: ct,
      subGroups: buildSubGroupsFor(reportToArtists.filter(a => (a.report_to||'') === rt && (a.call_time||'') === ct)),
    }));
  })();

  // Group remaining artists by call_time (sorted earliest first), then by banner within each time group
  const timeGroups = (() => {
    const times = [...new Set(regularArtists.map(a => a.call_time || ''))].sort((a, b) => sortTime(a) - sortTime(b));
    return times.map(time => {
      const artists = regularArtists.filter(a => (a.call_time || '') === time);
      const bannerIds = [...new Set(artists.map(a => a.banner_id))];
      const groups = bannerIds.map(bid => ({
        banner: sheet.banners.find(b => b.id === bid) || null,
        artists: artists.filter(a => a.banner_id === bid),
      }));
      const subGroups = [
        ...groups.filter(g => !g.banner),
        ...sheet.banners.filter(b => groups.find(g => g.banner?.id === b.id)).map(b => groups.find(g => g.banner?.id === b.id)),
      ];
      return { time, subGroups };
    });
  })();

  // Keep for banner-move modal
  const byBanner = {};
  sheet.banners.forEach(b => {
    byBanner[b.id] = { banner: b, artists: sheet.artists.filter(a => a.banner_id === b.id) };
  });

  // Renders artists grouped by agent — inserts a sticky agent sub-header when multiple agents exist
  const agentGroupedRows = (artists, visCols = shootVisibleCols) => {
    const agentNames = [...new Set(artists.map(a => a.agent_name||''))].sort((a, b) => a.localeCompare(b));
    if (agentNames.length <= 1) return artists.map(a => artistRow(a));
    return agentNames.flatMap(agentName => {
      const group = artists.filter(a => (a.agent_name||'') === agentName);
      return [
        <tr key={`agh-${agentName}`}>
          <td colSpan={visCols === shootVisibleCols ? tableHeaders.length : tableHeadersNoPickup.length} className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-500 border-b border-gray-200" style={{ letterSpacing: '0.6px' }}>
            {agentName || 'No Agent'} &nbsp;·&nbsp; {group.length} artist{group.length !== 1 ? 's' : ''}
          </td>
        </tr>,
        ...group.map(a => artistRow(a, visCols)),
      ];
    });
  };

  const artistRow = (a, visCols = shootVisibleCols) => {
    const isEditing = editingArtist === a.artist_id;
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ');
    return (
      <tr id={`csa-row-${a.artist_id}`} key={a.artist_id} className={`border-b border-gray-100 hover:bg-amber-100/70 ${highlightedArtistId === a.artist_id ? 'ring-2 ring-blue-800 ring-inset bg-blue-100' : selectedArtists.has(a.artist_id) ? 'bg-gold/5' : ''}`}>
        <td className="px-2 py-2 w-8">
          <input type="checkbox" checked={selectedArtists.has(a.artist_id)} onChange={() => toggleSelectArtist(a.artist_id)}
            className="w-4 h-4 accent-gold cursor-pointer" />
        </td>
        <td className="px-3 py-2 font-semibold text-sm cursor-pointer hover:text-gold" onClick={() => { setSearchQ(fullName); scrollToArtist(a.artist_id); }}>{fullName}</td>
        <td className="px-3 py-2 text-sm text-gray-600">{a.agent_name}</td>
        <td className="px-3 py-2 text-sm cursor-pointer hover:text-gold" onClick={() => { if (a.role) { setSearchQ(a.role); setSearchOpen(true); } }}>{a.role}</td>
        {isShoot ? (
          <>
            {visCols.includes('pickup_point') && <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.pickup_point||''} onChange={e=>setArtistForm(f=>({...f,pickup_point:e.target.value}))} /> : a.pickup_point}</td>}
            {visCols.includes('pickup_time')  && <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.pickup_time||''} onChange={e=>setArtistForm(f=>({...f,pickup_time:e.target.value}))} /> : a.pickup_time}</td>}
            {visCols.includes('report_to')    && <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.report_to||''} onChange={e=>setArtistForm(f=>({...f,report_to:e.target.value}))} /> : a.report_to}</td>}
            {visCols.includes('call_time')    && <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.call_time||''} onChange={e=>setArtistForm(f=>({...f,call_time:e.target.value}))} /> : a.call_time}</td>}
            {visCols.includes('notes') && <td className="px-3 py-2 text-sm">
              {editingNote === a.artist_id
                ? <span className="flex gap-1 items-center"><input autoFocus className="input-field py-1 text-xs flex-1" value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSaveNote(a.artist_id);if(e.key==='Escape')setEditingNote(null);}} /><button onClick={()=>handleSaveNote(a.artist_id)} className="text-xs px-1.5 py-0.5 bg-green-600 text-white rounded">✓</button><button onClick={()=>setEditingNote(null)} className="text-xs px-1.5 py-0.5 bg-gray-200 rounded">✗</button></span>
                : <span className="cursor-pointer hover:bg-amber-50 rounded px-1 min-w-[60px] block" onClick={()=>{setEditingNote(a.artist_id);setNoteDraft(a.notes||'');}} title="Click to edit note">{a.notes||<span className="text-gray-300 italic text-xs">add note…</span>}</span>
              }
            </td>}
          </>
        ) : (
          <>
            <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.call_time||''} onChange={e=>setArtistForm(f=>({...f,call_time:e.target.value}))} /> : a.call_time}</td>
            {isFitting && (
              <>
                <td className="px-3 py-2 text-sm">{isEditing ? <input className="input-field py-1 text-xs" value={artistForm.report_to||''} onChange={e=>setArtistForm(f=>({...f,report_to:e.target.value}))} /> : a.report_to}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{fmtDate(a.shoot_date)}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{a.day_rate}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{a.fitting_rate}</td>
              </>
            )}
            {!isFitting && (
              <>
                <td className="px-3 py-2 text-sm text-gray-500">{fmtDate(a.shoot_date)}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{fmtDate(a.fitting_date)}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{a.day_rate}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{a.fitting_rate}</td>
              </>
            )}
            <td className="px-3 py-2 text-sm">
              {editingNote === a.artist_id
                ? <span className="flex gap-1 items-center"><input autoFocus className="input-field py-1 text-xs flex-1" value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSaveNote(a.artist_id);if(e.key==='Escape')setEditingNote(null);}} /><button onClick={()=>handleSaveNote(a.artist_id)} className="text-xs px-1.5 py-0.5 bg-green-600 text-white rounded">✓</button><button onClick={()=>setEditingNote(null)} className="text-xs px-1.5 py-0.5 bg-gray-200 rounded">✗</button></span>
                : <span className="cursor-pointer hover:bg-amber-50 rounded px-1 min-w-[60px] block" onClick={()=>{setEditingNote(a.artist_id);setNoteDraft(a.notes||'');}} title="Click to edit note">{a.notes||<span className="text-gray-300 italic text-xs">add note…</span>}</span>
              }
            </td>
          </>
        )}
        <td className="px-3 py-2">
          {isEditing ? (
            <div className="flex gap-1">
              <button onClick={handleSaveArtist} className="text-xs px-2 py-1 bg-green-600 text-white rounded">✓</button>
              <button onClick={()=>setEditingArtist(null)} className="text-xs px-2 py-1 bg-gray-200 rounded">✗</button>
            </div>
          ) : (
            <div className="flex gap-1">
              <button onClick={()=>{setEditingArtist(a.artist_id);setArtistForm({call_time:a.call_time,report_to:a.report_to,pickup_time:a.pickup_time,pickup_point:a.pickup_point,notes:a.notes,banner_id:a.banner_id});}} className="text-xs px-2 py-1 bg-gold/20 text-gold-dark rounded hover:bg-gold/30">✏️</button>
              <button onClick={()=>setMovingArtist(a.artist_id)} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">↕</button>
              <button onClick={()=>handleRemoveArtist(a.artist_id)} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">✕</button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const searchMatches = searchQ.trim().length > 1
    ? (sheet.artists || []).filter(a => {
        const q = searchQ.toLowerCase();
        const name = [a.first_name, a.last_name].filter(Boolean).join(' ').toLowerCase();
        return name.includes(q) || (a.role||'').toLowerCase().includes(q);
      })
    : [];

  const scrollToArtist = (artistId) => {
    const el = document.getElementById(`csa-row-${artistId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedArtistId(artistId);
    setSearchQ('');
    setSearchOpen(false);
  };

  const renderTh = (h, i) => h === 'Notes'
    ? <th key={i} className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-500">
        <button onClick={() => setNotesSort(s => s === 'asc' ? 'desc' : 'asc')} className="flex items-center gap-1 hover:text-gold">
          Notes {notesSort === 'asc' ? '↑' : notesSort === 'desc' ? '↓' : '⇅'}
        </button>
      </th>
    : <th key={i} className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-500">{h}</th>;

  const sortArtists = (artists) => {
    if (!notesSort) return artists;
    return [...artists].sort((a, b) => {
      const na = (a.notes||'').toLowerCase(), nb = (b.notes||'').toLowerCase();
      return notesSort === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
    });
  };

  const shootColLabels = { pickup_point:'Pick Up Point', pickup_time:'Pick Up Time', report_to:'Report To', call_time:'Call Time', notes:'Notes' };
  const tableHeaders = isShoot
    ? ['','Name & Surname','Agent','Role', ...shootVisibleCols.map(c => shootColLabels[c]),'']
    : isFitting
      ? ['','Name & Surname','Agent','Role','Call Time','Report To','Shoot Date','Day Rate','Fitting Fee','Notes','']
      : ['','Name & Surname','Agent','Role','Call Time','Shoot Date','Fitting Date','Day Rate','Fitting Fee','Notes',''];
  const tableHeadersNoPickup = isShoot
    ? ['','Name & Surname','Agent','Role', ...shootVisibleColsNoPickup.map(c => shootColLabels[c]),'']
    : tableHeaders;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4">
        {editingHeader ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Title</label><input className="input-field mt-1" value={headerForm.title||''} onChange={e=>setHeaderForm(f=>({...f,title:e.target.value}))} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Date</label><input type="date" className="input-field mt-1" value={headerForm.date||''} onChange={e=>setHeaderForm(f=>({...f,date:e.target.value}))} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Location</label><input className="input-field mt-1" value={headerForm.location||''} onChange={e=>setHeaderForm(f=>({...f,location:e.target.value}))} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Director</label><input className="input-field mt-1" value={headerForm.director_name||''} onChange={e=>setHeaderForm(f=>({...f,director_name:e.target.value}))} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Assistant</label><input className="input-field mt-1" value={headerForm.assistant_name||''} onChange={e=>setHeaderForm(f=>({...f,assistant_name:e.target.value}))} /></div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Footer Note</label>
                <input list="footer-notes-list" className="input-field mt-1" value={headerForm.footer_note||''} onChange={e=>setHeaderForm(f=>({...f,footer_note:e.target.value}))} placeholder="Type or select a previous footnote…" />
                {footerNotes.length > 0 && (
                  <datalist id="footer-notes-list">
                    {footerNotes.map((n, i) => <option key={i} value={n} />)}
                  </datalist>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setEditingHeader(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleSaveHeader} className="btn-gold text-xs">Save Header</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-charcoal">{sheet.title || `${sheet.type} Call Sheet`}</h2>
              <div className="flex flex-wrap gap-3 text-sm text-gray-500 mt-1">
                {sheet.date && <span>📅 {sheet.date}</span>}
                {sheet.location && <span>📍 {sheet.location}</span>}
                {sheet.director_name && <span>🎬 {sheet.director_name}</span>}
                <span className="font-semibold text-charcoal">{sheet.artists.length} artists</span>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {/* Search */}
              <div className="relative" ref={searchRef}>
                <input
                  className="input-field text-xs w-48 pr-7"
                  placeholder="🔍 Search name or role…"
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                />
                {searchQ && (
                  <button onClick={() => { setSearchQ(''); setSearchOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                )}
                {searchOpen && searchMatches.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    {searchMatches.map(a => (
                      <button
                        key={a.artist_id}
                        onMouseDown={() => scrollToArtist(a.artist_id)}
                        className="w-full text-left px-3 py-2 hover:bg-gold/10 border-b border-gray-50 last:border-0"
                      >
                        <div className="text-sm font-semibold text-charcoal">{[a.first_name, a.last_name].filter(Boolean).join(' ')}</div>
                        {a.role && <div className="text-xs text-gray-500">{a.role}</div>}
                      </button>
                    ))}
                  </div>
                )}
                {searchOpen && searchQ.trim().length > 1 && searchMatches.length === 0 && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 px-3 py-2 text-xs text-gray-400">
                    No matches found
                  </div>
                )}
              </div>
              <button onClick={()=>setEditingHeader(true)} className="btn-ghost text-xs">Edit Header</button>
              <button onClick={() => runPdfDownload('Call Sheet PDF', onProgress => api.callSheetPdfUrl(sheetId, notesSort, onProgress))} className="btn-dark text-xs">⬇ PDF</button>
              <button onClick={() => api.callSheetExcelUrl(sheetId)} className="btn-dark text-xs">⬇ Excel</button>
            </div>
          </div>
        )}
      </div>

      {/* Copy to Selected / All */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {selectedArtists.size > 0 ? `Apply to ${selectedArtists.size} Selected Artist${selectedArtists.size !== 1 ? 's' : ''}` : 'Copy to All Artists'}
          </h3>
          <div className="flex gap-2">
            <button onClick={() => selectAllArtists(sheet.artists.map(a => a.artist_id))} className="text-xs text-gold hover:underline">Select All</button>
            {selectedArtists.size > 0 && <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline">Clear</button>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          {!isShoot && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-gray-500">Call Time</label>
                <button onClick={() => handleClearColumn('call_time')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
              </div>
              <datalist id="dl-call_time">{suggestions('call_time').map(v=><option key={v} value={v}/>)}</datalist>
              <input list="dl-call_time" className="input-field w-28 mt-1" value={copyToAll.call_time} onChange={e=>setCopyToAll(f=>({...f,call_time:e.target.value}))} placeholder="06:00" />
            </div>
          )}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-gray-500">Report To</label>
              <button onClick={() => handleClearColumn('report_to')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
            </div>
            <datalist id="dl-report_to">{suggestions('report_to').map(v=><option key={v} value={v}/>)}</datalist>
            <input list="dl-report_to" className="input-field w-40 mt-1" value={copyToAll.report_to} onChange={e=>setCopyToAll(f=>({...f,report_to:e.target.value}))} />
          </div>
          {isShoot && (
            <>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500">Pick Up Point</label>
                  <button onClick={() => handleClearColumn('pickup_point')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
                </div>
                <datalist id="dl-pickup_point">{suggestions('pickup_point').map(v=><option key={v} value={v}/>)}</datalist>
                <input list="dl-pickup_point" className="input-field w-40 mt-1" value={copyToAll.pickup_point} onChange={e=>setCopyToAll(f=>({...f,pickup_point:e.target.value}))} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500">Pick Up Time</label>
                  <button onClick={() => handleClearColumn('pickup_time')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
                </div>
                <datalist id="dl-pickup_time">{suggestions('pickup_time').map(v=><option key={v} value={v}/>)}</datalist>
                <input list="dl-pickup_time" className="input-field w-28 mt-1" value={copyToAll.pickup_time} onChange={e=>setCopyToAll(f=>({...f,pickup_time:e.target.value}))} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500">Call Time</label>
                  <button onClick={() => handleClearColumn('call_time')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
                </div>
                <datalist id="dl-call_time_shoot">{suggestions('call_time').map(v=><option key={v} value={v}/>)}</datalist>
                <input list="dl-call_time_shoot" className="input-field w-28 mt-1" value={copyToAll.call_time} onChange={e=>setCopyToAll(f=>({...f,call_time:e.target.value}))} placeholder="06:00" />
              </div>
            </>
          )}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-gray-500">Notes</label>
              <button onClick={() => handleClearColumn('notes')} className="text-xs text-red-400 hover:text-red-600">✕ Clear</button>
            </div>
            <datalist id="dl-notes">{suggestions('notes').map(v=><option key={v} value={v}/>)}</datalist>
            <input list="dl-notes" className="input-field w-48 mt-1" value={copyToAll.notes} onChange={e=>setCopyToAll(f=>({...f,notes:e.target.value}))} />
          </div>
          <button onClick={handleCopyToAll} className="btn-gold self-end">Apply to All</button>
        </div>
      </div>

      {/* Bulk move toolbar — visible when artists are selected */}
      {selectedArtists.size > 0 && (
        <div className="card p-4 border border-gold/30 bg-gold/5">
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-sm font-semibold text-gold">{selectedArtists.size} artist{selectedArtists.size !== 1 ? 's' : ''} selected</span>

            {/* Move to different banner */}
            {sheet.banners.length > 0 && (
              <div className="flex items-center gap-2">
                <select className="input-field text-sm w-48" value={bulkMoveBanner} onChange={e => setBulkMoveBanner(e.target.value)}>
                  <option value="">Move to banner…</option>
                  <option value="__none__">— No Banner —</option>
                  {sheet.banners.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button onClick={handleBulkMoveBanner} disabled={!bulkMoveBanner || bulkMoving} className="btn-dark text-xs">
                  {bulkMoving ? '…' : 'Move'}
                </button>
              </div>
            )}

            {/* Move to different call sheet */}
            {siblingSheets.length > 0 && (
              <div className="flex items-center gap-2">
                <select className="input-field text-sm w-56" value={bulkMoveSheet} onChange={e => setBulkMoveSheet(e.target.value)}>
                  <option value="">Move to call sheet…</option>
                  {siblingSheets.map(s => <option key={s.id} value={s.id}>{s.title}{s.date ? ` — ${s.date}` : ''}</option>)}
                </select>
                <button onClick={handleBulkMoveSheet} disabled={!bulkMoveSheet || bulkMoving} className="btn-gold text-xs">
                  {bulkMoving ? '…' : 'Move'}
                </button>
              </div>
            )}

            <button onClick={deselectAll} className="btn-ghost text-xs ml-auto">✕ Clear Selection</button>
          </div>
        </div>
      )}

      {/* Artists grouped by call time (earliest first), banners as sub-headers */}
      <div className="space-y-3">
        {/* PICK UP + REPORT TO — merged and sorted by time */}
        {[
          ...pickupTimeGroups.map(g => ({ kind: 'pickup', sortKey: sortTime(g.time), ...g })),
          ...reportToGroups.map(g => ({ kind: 'reportto', sortKey: sortTime(g.callTime), ...g })),
        ].sort((a, b) => a.sortKey - b.sortKey || (a.kind === 'pickup' ? -1 : 1)).map(entry => {
          if (entry.kind === 'pickup') {
            const { time, subGroups } = entry;
            const timeArtists = subGroups.flatMap(sg => sg.artists);
            const secKey = `pu-${time}`;
            const isOpen = expandedSections.has(secKey);
            return (
              <div key={secKey} className="card overflow-hidden">
                <div className="px-4 py-2 font-bold text-sm uppercase flex items-center justify-between cursor-pointer select-none" style={{ background: '#0d4f0d', color: '#fff' }} onClick={() => toggleSection(secKey)}>
                  <span>{isOpen ? '▼' : '▶'} 🚗 Pick Up{time ? ` — ${time}` : ''} &nbsp;({timeArtists.length} artist{timeArtists.length !== 1 ? 's' : ''})</span>
                  {isOpen && <button
                    onClick={e => {
                      e.stopPropagation();
                      const ids = timeArtists.map(a => a.artist_id);
                      const allSel = ids.every(id => selectedArtists.has(id));
                      allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids);
                    }}
                    className="text-xs font-normal text-green-200 hover:text-white normal-case"
                  >
                    {timeArtists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                  </button>}
                </div>
                {isOpen && subGroups.map((sg, si) => (
                  <div key={sg.banner?.id ?? 'unbannered-pu'}>
                    {sg.banner && (
                      <div className="px-4 py-1.5 bg-gold/20 border-l-4 border-gold flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {renderBannerLabel(sg.banner, sg.artists.length)}
                          <button onClick={() => { const ids = sg.artists.map(a => a.artist_id); const allSel = ids.every(id => selectedArtists.has(id)); allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids); }} className="text-xs text-gold-dark hover:underline font-normal">
                            {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                      </div>
                    )}
                    {!sg.banner && subGroups.some(g => g.banner) && (
                      <div className="px-4 py-1.5 bg-gray-100 flex items-center justify-between">
                        <span className="text-xs text-gray-500 uppercase font-semibold">Unassigned ({sg.artists.length})</span>
                        <button onClick={() => { const ids = sg.artists.map(a => a.artist_id); const allSel = ids.every(id => selectedArtists.has(id)); allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids); }} className="text-xs text-gray-500 hover:text-gold font-semibold">
                          {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        {si === 0 && <thead><tr className="bg-gray-50 border-b">{tableHeaders.map(renderTh)}</tr></thead>}
                        <tbody>{agentGroupedRows(sortArtists(sg.artists))}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          } else {
            const { reportTo, callTime, subGroups } = entry;
            const rtArtists = subGroups.flatMap(sg => sg.artists);
            const secKey = `rt-${reportTo}-${callTime}`;
            const isOpen = expandedSections.has(secKey);
            return (
              <div key={secKey} className="card overflow-hidden">
                <div className="px-4 py-2 font-bold text-sm uppercase flex items-center justify-between cursor-pointer select-none" style={{ background: '#4a3000', color: '#fff' }} onClick={() => toggleSection(secKey)}>
                  <span>{isOpen ? '▼' : '▶'} ⛺ Report To{reportTo ? ` — ${reportTo}` : ''}{callTime ? ` — ${callTime}` : ''} &nbsp;({rtArtists.length} artist{rtArtists.length !== 1 ? 's' : ''})</span>
                  {isOpen && <button
                    onClick={e => {
                      e.stopPropagation();
                      const ids = rtArtists.map(a => a.artist_id);
                      const allSel = ids.every(id => selectedArtists.has(id));
                      allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids);
                    }}
                    className="text-xs font-normal text-amber-200 hover:text-white normal-case"
                  >
                    {rtArtists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                  </button>}
                </div>
                {isOpen && subGroups.map((sg, si) => (
                  <div key={sg.banner?.id ?? 'unbannered-rt'}>
                    {sg.banner && (
                      <div className="px-4 py-1.5 bg-gold/20 border-l-4 border-gold flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {renderBannerLabel(sg.banner, sg.artists.length)}
                          <button onClick={() => { const ids = sg.artists.map(a => a.artist_id); const allSel = ids.every(id => selectedArtists.has(id)); allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids); }} className="text-xs text-gold-dark hover:underline font-normal">
                            {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                      </div>
                    )}
                    {!sg.banner && subGroups.some(g => g.banner) && (
                      <div className="px-4 py-1.5 bg-gray-100 flex items-center justify-between">
                        <span className="text-xs text-gray-500 uppercase font-semibold">Unassigned ({sg.artists.length})</span>
                        <button onClick={() => { const ids = sg.artists.map(a => a.artist_id); const allSel = ids.every(id => selectedArtists.has(id)); allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids); }} className="text-xs text-gray-500 hover:text-gold font-semibold">
                          {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        {si === 0 && <thead><tr className="bg-gray-50 border-b">{tableHeadersNoPickup.map(renderTh)}</tr></thead>}
                        <tbody>{agentGroupedRows(sortArtists(sg.artists), shootVisibleColsNoPickup)}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          }
        })}

        {timeGroups.map(({ time, subGroups }) => {
          const secKey = `time-${time || 'none'}`;
          const isOpen = expandedSections.has(secKey);
          const totalArtists = subGroups.reduce((n, g) => n + g.artists.length, 0);
          return (
          <div key={secKey} className="card overflow-hidden">
            {/* Call time header */}
            <div className="px-4 py-2 bg-charcoal text-white font-bold text-sm uppercase flex items-center justify-between cursor-pointer select-none" onClick={() => toggleSection(secKey)}>
              <span>{isOpen ? '▼' : '▶'} ⏰ {time || 'No Call Time'} — {totalArtists} artist{totalArtists !== 1 ? 's' : ''}</span>
              {isOpen && <button
                onClick={e => {
                  e.stopPropagation();
                  const ids = subGroups.flatMap(g => g.artists.map(a => a.artist_id));
                  const allSel = ids.every(id => selectedArtists.has(id));
                  allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids);
                }}
                className="text-xs font-normal text-gray-300 hover:text-white normal-case"
              >
                {subGroups.flatMap(g => g.artists).every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
              </button>}
            </div>

            {/* Banner sub-groups within this call time */}
            {isOpen && subGroups.map((sg, si) => (
              <div key={sg.banner?.id ?? 'unbannered'}>
                {sg.banner && (
                  <div className="px-4 py-1.5 bg-gold/20 border-l-4 border-gold flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {renderBannerLabel(sg.banner, sg.artists.length)}
                      <button
                        onClick={() => {
                          const ids = sg.artists.map(a => a.artist_id);
                          const allSel = ids.every(id => selectedArtists.has(id));
                          allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids);
                        }}
                        className="text-xs text-gold-dark hover:underline font-normal"
                      >
                        {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <button onClick={() => handleDeleteBanner(sg.banner.id)} className="text-xs text-red-400 hover:text-red-600">Remove Banner</button>
                  </div>
                )}
                {!sg.banner && subGroups.some(g => g.banner) && (
                  <div className="px-4 py-1.5 bg-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase font-semibold">Unassigned ({sg.artists.length})</span>
                    <button
                      onClick={() => {
                        const ids = sg.artists.map(a => a.artist_id);
                        const allSel = ids.every(id => selectedArtists.has(id));
                        allSel ? setSelectedArtists(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; }) : selectAllArtists(ids);
                      }}
                      className="text-xs text-gray-500 hover:text-gold font-semibold"
                    >
                      {sg.artists.every(a => selectedArtists.has(a.artist_id)) ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    {si === 0 && !sg.banner && (
                      <thead><tr className="bg-gray-50 border-b">{tableHeadersNoPickup.map(renderTh)}</tr></thead>
                    )}
                    {(si > 0 || sg.banner) && (
                      <thead><tr className="bg-gray-50 border-b">{tableHeadersNoPickup.map(renderTh)}</tr></thead>
                    )}
                    <tbody>{agentGroupedRows(sortArtists(sg.artists), shootVisibleColsNoPickup)}</tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          );
        })}

        {sheet.artists.length === 0 && (
          <div className="card p-8 text-center text-gray-400">No artists on this call sheet yet</div>
        )}

        {/* Add Banner */}
        <div className="card p-3">
          {addingBanner ? (
            <div className="flex gap-2">
              <input className="input-field" placeholder="Banner name (e.g. KLIPTOWN POLICE)" value={newBannerName} onChange={e=>setNewBannerName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddBanner()} autoFocus />
              <button onClick={handleAddBanner} className="btn-gold whitespace-nowrap">Add Banner</button>
              <button onClick={()=>setAddingBanner(false)} className="btn-ghost">Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setAddingBanner(true)} className="text-gold text-sm font-semibold hover:underline">+ Add Banner Section</button>
          )}
        </div>
      </div>

      {/* Move artist banner modal */}
      {movingArtist && (
        <div className="modal-overlay" onClick={()=>setMovingArtist(null)}>
          <div className="bg-white rounded-xl p-6 w-80" onClick={e=>e.stopPropagation()}>
            <h3 className="font-bold mb-4">Move to Banner</h3>
            <div className="space-y-2">
              <button onClick={()=>handleMoveArtist(movingArtist,null)} className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-sm">— Unassigned</button>
              {sheet.banners.map(b => (
                <button key={b.id} onClick={()=>handleMoveArtist(movingArtist,b.id)} className="w-full text-left px-3 py-2 rounded hover:bg-gold/10 text-sm font-medium">{b.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
