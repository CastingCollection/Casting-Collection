import { useState, useEffect } from 'react';
import { api } from '../api.js';

// Helper: file → { preview, dataUrl }
const readFile = (file) => new Promise(resolve => {
  const preview = URL.createObjectURL(file);
  const reader = new FileReader();
  reader.onload = () => resolve({ preview, dataUrl: reader.result });
  reader.readAsDataURL(file);
});

export default function CastingPresentation() {
  const [coverImage, setCoverImage] = useState(null);
  // sets: [{ id, headerImage, groups: [{ id, name, images: [{id, preview, dataUrl}] }] }]
  const [sets, setSets] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [showSavedList, setShowSavedList] = useState(false);
  const [currentId, setCurrentId] = useState(null);   // id of loaded presentation
  const [currentName, setCurrentName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  useEffect(() => {
    api.getPresentations().then(setSavedList).catch(() => {});
  }, []);

  // ── Cover ──────────────────────────────────────────────────────────────────
  const handleCoverUpload = async (file) => {
    if (!file) return;
    setCoverImage(await readFile(file));
  };

  // ── Sets ───────────────────────────────────────────────────────────────────
  const addSet = () => {
    setSets(ss => [...ss, { id: Date.now().toString(), headerImage: null, groups: [] }]);
  };

  const removeSet = (setId) => {
    setSets(ss => ss.filter(s => s.id !== setId));
  };

  const updateSet = (setId, updater) => {
    setSets(ss => ss.map(s => s.id === setId ? { ...s, ...updater(s) } : s));
  };

  const handleHeaderUpload = async (setId, file) => {
    if (!file) return;
    const img = await readFile(file);
    updateSet(setId, () => ({ headerImage: img }));
  };

  // ── Groups inside a set ────────────────────────────────────────────────────
  const addGroup = (setId, name) => {
    if (!name.trim()) return;
    updateSet(setId, s => ({
      groups: [...s.groups, { id: Date.now().toString(), name: name.trim().toUpperCase(), images: [] }]
    }));
  };

  const removeGroup = (setId, groupId) => {
    updateSet(setId, s => ({ groups: s.groups.filter(g => g.id !== groupId) }));
  };

  const addImagesToGroup = async (setId, groupId, files) => {
    const imgs = await Promise.all(Array.from(files).map(readFile));
    const newImages = imgs.map(img => ({ id: Math.random().toString(36).slice(2), ...img }));
    updateSet(setId, s => ({
      groups: s.groups.map(g => g.id === groupId ? { ...g, images: [...g.images, ...newImages] } : g)
    }));
  };

  const removeImage = (setId, groupId, imageId) => {
    updateSet(setId, s => ({
      groups: s.groups.map(g => g.id === groupId
        ? { ...g, images: g.images.filter(img => img.id !== imageId) }
        : g)
    }));
  };

  // ── Save / Load ────────────────────────────────────────────────────────────
  // Upload any blob: URLs to server, return server path
  const persistImage = async (img) => {
    if (!img) return null;
    if (img.preview?.startsWith('/uploads/')) return img; // already saved
    const result = await api.uploadPresentationImage(img.dataUrl);
    return { preview: result.path, dataUrl: img.dataUrl, serverPath: result.path };
  };

  const buildSaveData = async () => {
    const cover = await persistImage(coverImage);
    const persistedSets = await Promise.all(sets.map(async s => ({
      id: s.id,
      headerImage: await persistImage(s.headerImage),
      groups: await Promise.all(s.groups.map(async g => ({
        id: g.id,
        name: g.name,
        images: await Promise.all(g.images.map(async img => {
          const p = await persistImage(img);
          return { id: img.id, preview: p.serverPath || p.preview, serverPath: p.serverPath || p.preview };
        })),
      }))),
    })));
    return { coverImage: cover ? { preview: cover.serverPath || cover.preview, serverPath: cover.serverPath || cover.preview } : null, sets: persistedSets };
  };

  const handleSave = async (name) => {
    setSaving(true);
    try {
      const data = await buildSaveData();
      if (currentId) {
        await api.updatePresentation(currentId, name || currentName, data);
      } else {
        const created = await api.createPresentation(name, data);
        setCurrentId(created.id);
        setCurrentName(name);
      }
      const list = await api.getPresentations();
      setSavedList(list);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id) => {
    try {
      const pres = await api.getPresentation(id);
      const data = pres.data;
      // Restore: server paths become both preview and dataUrl placeholder
      const restoreImg = (img) => img ? { preview: img.preview || img.serverPath, dataUrl: img.dataUrl || null, serverPath: img.serverPath } : null;
      setCoverImage(restoreImg(data.coverImage));
      setSets((data.sets || []).map(s => ({
        ...s,
        headerImage: restoreImg(s.headerImage),
        groups: (s.groups || []).map(g => ({
          ...g,
          images: (g.images || []).map(img => ({ ...img, preview: img.preview || img.serverPath })),
        })),
      })));
      setCurrentId(pres.id);
      setCurrentName(pres.name);
      setShowSavedList(false);
    } catch (err) {
      alert('Load failed: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this presentation?')) return;
    await api.deletePresentation(id);
    setSavedList(l => l.filter(p => p.id !== id));
    if (currentId === id) { setCurrentId(null); setCurrentName(''); }
  };

  const handleNew = () => {
    // Cover image stays — it's always the same unless replaced
    setSets([]);
    setCurrentId(null);
    setCurrentName('');
    setShowSavedList(false);
  };

  // ── PDF ────────────────────────────────────────────────────────────────────
  const hasContent = coverImage || sets.some(s => s.headerImage || s.groups.some(g => g.images.length));

  // Convert a blob: URL to base64 dataUrl; server /uploads/ paths are passed as-is
  const toDataUrl = async (preview) => {
    if (!preview) return null;
    if (preview.startsWith('/uploads/') || preview.startsWith('data:')) return preview;
    const res = await fetch(preview);
    const blob = await res.blob();
    return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  };

  const handleDownloadPDF = async () => {
    if (!hasContent) return;
    setDownloading(true);
    try {
      const coverSrc = await toDataUrl(coverImage?.preview || coverImage?.dataUrl);
      const setsPayload = await Promise.all(sets.map(async s => ({
        headerSrc: await toDataUrl(s.headerImage?.preview || s.headerImage?.dataUrl),
        groups: await Promise.all(s.groups.filter(g => g.images.length).map(async g => ({
          name: g.name,
          images: await Promise.all(g.images.map(async img => ({
            src: await toDataUrl(img.preview || img.dataUrl),
          }))),
        }))),
      })));

      const res = await fetch('/api/presentation/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverSrc, sets: setsPayload }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'casting-presentation.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF download failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Casting Presentation</h1>
          {currentName
            ? <p className="text-sm text-gold font-semibold mt-0.5">📋 {currentName}</p>
            : <p className="text-sm text-gray-500 mt-0.5">Cover → Sets (header image + role categories) → repeat</p>}
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setShowSavedList(true)} className="btn-ghost text-sm">📂 My Presentations</button>
          {hasContent && <button onClick={handleNew} className="btn-ghost text-sm">+ New</button>}
          {hasContent && (
            currentId
              ? <button onClick={() => handleSave(currentName)} disabled={saving} className="btn-dark text-sm">{saving ? 'Saving…' : '💾 Save'}</button>
              : <button onClick={() => setShowNamePrompt(true)} disabled={saving} className="btn-dark text-sm">{saving ? 'Saving…' : '💾 Save'}</button>
          )}
          <button onClick={addSet} className="btn-dark text-sm">+ Add Set</button>
          {hasContent && <button onClick={() => setShowPreview(true)} className="btn-ghost text-sm">👁 Preview</button>}
          {hasContent && (
            <button onClick={handleDownloadPDF} disabled={downloading} className="btn-gold text-sm">
              {downloading ? 'Generating…' : '⬇ Download PDF'}
            </button>
          )}
        </div>
      </div>

      {/* ── Cover Page ── */}
      <SectionCard title="PAGE 1 — COVER IMAGE" badge="Always first page"
        onRemove={coverImage ? () => setCoverImage(null) : null}>
        {coverImage ? (
          <div className="relative max-w-sm mx-auto">
            <img src={coverImage.preview} alt="Cover" className="w-full rounded-lg object-cover" style={{ aspectRatio: '420/297' }} />
            <label className="absolute bottom-2 right-2 btn-gold text-xs cursor-pointer">
              Replace
              <input type="file" accept="image/*" className="hidden" onChange={e => handleCoverUpload(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <UploadZone label="Upload Cover Page Image" sublabel="Fills entire first page edge-to-edge"
            onFiles={files => handleCoverUpload(files[0])} single />
        )}
      </SectionCard>

      {/* ── Sets ── */}
      {sets.map((set, si) => (
        <div key={set.id}>
          <SetBlock
            set={set}
            index={si}
            onRemoveSet={() => removeSet(set.id)}
            onHeaderUpload={file => handleHeaderUpload(set.id, file)}
            onRemoveHeader={() => updateSet(set.id, () => ({ headerImage: null }))}
            onAddGroup={name => addGroup(set.id, name)}
            onRemoveGroup={groupId => removeGroup(set.id, groupId)}
            onAddImages={(groupId, files) => addImagesToGroup(set.id, groupId, files)}
            onRemoveImage={(groupId, imageId) => removeImage(set.id, groupId, imageId)}
          />
          {/* Add a new set after this one */}
          <button
            onClick={addSet}
            className="w-full mt-4 py-3 border-2 border-dashed border-gold/40 rounded-lg text-sm text-gold hover:border-gold hover:bg-gold/5 transition-colors font-semibold tracking-wide"
          >
            + Add New Set After This
          </button>
        </div>
      ))}

      {sets.length === 0 && (
        <div className="card p-10 text-center text-gray-400">
          <div className="text-4xl mb-3">🎬</div>
          <p>Upload a cover image, then add sets — each set has a header page and role categories</p>
          <button onClick={addSet} className="btn-gold mt-4">+ Add First Set</button>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 rounded-t-xl flex-shrink-0">
              <span className="text-sm font-semibold text-gray-600">Presentation Preview — PDF layout</span>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 bg-white space-y-8">
              {coverImage && (
                <div>
                  <p className="text-xs text-gray-400 uppercase font-semibold mb-2">Cover Page</p>
                  <div className="w-full rounded-lg overflow-hidden border" style={{ aspectRatio: '420/297', maxWidth: 480, margin: '0 auto' }}>
                    <img src={coverImage.preview} alt="Cover" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}
              {sets.map((set, si) => (
                <div key={set.id} className="space-y-4">
                  {set.headerImage && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-2">Set {si + 1} — Header Page</p>
                      <div className="w-full rounded-lg overflow-hidden border" style={{ aspectRatio: '420/297', maxWidth: 480, margin: '0 auto' }}>
                        <img src={set.headerImage.preview} alt="Header" className="w-full h-full object-cover" />
                      </div>
                    </div>
                  )}
                  {set.groups.filter(g => g.images.length > 0).map(group => (
                    <div key={group.id}>
                      <div style={{ background: '#1a1a1a', color: '#C9A84C' }} className="font-bold tracking-widest text-lg px-5 py-3 rounded-t-md mb-3 text-center uppercase">
                        {group.name} ({group.images.length})
                      </div>
                      <div className="flex flex-wrap gap-3 justify-center">
                        {group.images.map(img => (
                          <div key={img.id} className="bg-white rounded-lg overflow-hidden border border-gray-100"
                            style={{ width: `calc(${100 / Math.min(group.images.length, 4)}% - 12px)` }}>
                            <img src={img.preview} alt="" className="w-full h-auto block" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl flex-shrink-0">
              <button onClick={() => setShowPreview(false)} className="btn-ghost">Close</button>
              <button onClick={() => { setShowPreview(false); handleDownloadPDF(); }} disabled={downloading} className="btn-gold">
                {downloading ? 'Generating…' : '⬇ Download PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Name Prompt Modal ── */}
      {showNamePrompt && (
        <div className="modal-overlay" onClick={() => setShowNamePrompt(false)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4 text-charcoal">Save Presentation</h3>
            <input
              className="input-field"
              placeholder="Presentation name e.g. The Road Home — Week 3"
              value={currentName}
              onChange={e => setCurrentName(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && currentName.trim()) { setShowNamePrompt(false); handleSave(currentName.trim()); }}}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowNamePrompt(false)} className="btn-ghost">Cancel</button>
              <button
                disabled={!currentName.trim() || saving}
                onClick={() => { setShowNamePrompt(false); handleSave(currentName.trim()); }}
                className="btn-gold"
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved Presentations List ── */}
      {showSavedList && (
        <div className="modal-overlay" onClick={() => setShowSavedList(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 rounded-t-xl flex-shrink-0">
              <h3 className="font-bold text-charcoal">My Presentations</h3>
              <button onClick={() => setShowSavedList(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {savedList.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No saved presentations yet</p>}
              {savedList.map(p => (
                <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border ${currentId === p.id ? 'border-gold bg-gold/5' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div>
                    <p className="font-semibold text-sm text-charcoal">{p.name}</p>
                    <p className="text-xs text-gray-400">Saved {new Date(p.updated_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' })}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleLoad(p.id)} className="btn-gold text-xs">Open</button>
                    <button onClick={() => handleDelete(p.id)} className="btn-ghost text-xs text-red-500">Delete</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl flex-shrink-0">
              <button onClick={() => { handleNew(); }} className="btn-dark w-full text-sm">+ Start New Presentation</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionCard({ title, badge, onRemove, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="section-header flex items-center justify-between" style={{ background: '#1a1a1a', color: '#C9A84C' }}>
        <span className="font-bold tracking-wider">{title}{badge && <span className="ml-2 text-xs font-normal opacity-60">{badge}</span>}</span>
        {onRemove && <button onClick={onRemove} className="text-red-400 hover:text-red-300 text-xs">Remove</button>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function UploadZone({ label, sublabel, onFiles, single }) {
  return (
    <label className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gold transition-colors">
      <span className="text-3xl mb-2">📸</span>
      <span className="text-sm font-semibold text-gray-600">{label}</span>
      {sublabel && <span className="text-xs text-gray-400 mt-1">{sublabel}</span>}
      <input type="file" accept="image/*" multiple={!single} className="hidden"
        onChange={e => onFiles(e.target.files)} />
    </label>
  );
}

function SetBlock({ set, index, onRemoveSet, onHeaderUpload, onRemoveHeader, onAddGroup, onRemoveGroup, onAddImages, onRemoveImage }) {
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);

  return (
    <div className="space-y-3">
      {/* Set label */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Set {index + 1}</span>
        <button onClick={onRemoveSet} className="text-xs text-red-400 hover:text-red-600">Remove Set</button>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Set Header Image */}
      <SectionCard title={`SET ${index + 1} — HEADER PAGE`} badge="Full page"
        onRemove={set.headerImage ? onRemoveHeader : null}>
        {set.headerImage ? (
          <div className="relative max-w-sm mx-auto">
            <img src={set.headerImage.preview} alt="Header" className="w-full rounded-lg object-cover" style={{ aspectRatio: '420/297' }} />
            <label className="absolute bottom-2 right-2 btn-gold text-xs cursor-pointer">
              Replace
              <input type="file" accept="image/*" className="hidden" onChange={e => onHeaderUpload(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <UploadZone label="Upload Set Header Image" sublabel="Fills an entire page before this set's categories"
            onFiles={files => onHeaderUpload(files[0])} single />
        )}
      </SectionCard>

      {/* Role Categories */}
      {set.groups.map(group => (
        <div key={group.id} className="card overflow-hidden">
          <div className="section-header flex items-center justify-between" style={{ background: '#2d2d2d', color: '#C9A84C' }}>
            <span className="font-bold tracking-wider text-sm">{group.name} ({group.images.length})</span>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gold/70 hover:text-gold cursor-pointer">
                + Upload PNGs
                <input type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { onAddImages(group.id, e.target.files); e.target.value = ''; }} />
              </label>
              <button onClick={() => onRemoveGroup(group.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
            </div>
          </div>
          <div className="p-4">
            {group.images.length === 0 ? (
              <UploadZone label={`Upload PNG cards for ${group.name}`} onFiles={files => onAddImages(group.id, files)} />
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {group.images.map(img => (
                  <div key={img.id} className="relative">
                    <div className="bg-white rounded-lg overflow-hidden border border-gray-100">
                      <img src={img.preview} alt="" className="w-full h-auto block" />
                    </div>
                    <button onClick={() => onRemoveImage(group.id, img.id)}
                      className="absolute top-1 right-1 bg-black/60 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center">×</button>
                  </div>
                ))}
                <label className="aspect-[3/4] flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gold transition-colors text-gray-400">
                  <span className="text-2xl">+</span>
                  <span className="text-xs mt-1">Add more</span>
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { onAddImages(group.id, e.target.files); e.target.value = ''; }} />
                </label>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Add Role Category */}
      {showAddGroup ? (
        <div className="flex gap-2 items-center">
          <input
            className="input-field flex-1 text-sm"
            placeholder="Role category name e.g. BACKGROUND CROWD"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { onAddGroup(newGroupName); setNewGroupName(''); setShowAddGroup(false); } if (e.key === 'Escape') setShowAddGroup(false); }}
          />
          <button onClick={() => { onAddGroup(newGroupName); setNewGroupName(''); setShowAddGroup(false); }} className="btn-gold text-sm">Add</button>
          <button onClick={() => setShowAddGroup(false)} className="btn-ghost text-sm">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowAddGroup(true)}
          className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 hover:border-gold hover:text-gold transition-colors">
          + Add Role Category
        </button>
      )}
    </div>
  );
}
