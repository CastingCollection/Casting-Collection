import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

function Countdown({ targetDate }) {
  if (!targetDate) return <span className="text-gray-400">No date set</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate + 'T00:00:00');
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return <span className="text-red-600 font-bold">{Math.abs(diff)} days ago</span>;
  if (diff === 0) return <span className="text-red-600 font-bold">TODAY</span>;
  const color = diff <= 7 ? 'text-red-600' : diff <= 14 ? 'text-amber-600' : 'text-green-600';
  return <span className={`font-bold ${color}`}>{diff} days</span>;
}

export default function RolesToFit() {
  const { refresh, refreshKey } = useApp();
  const [roles, setRoles] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ role_name: '', quantity_needed: 1, shoot_date: '', notes: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = async () => {
    const data = await api.getRolesToFit();
    setRoles(data);
  };

  useEffect(() => { load(); }, [refreshKey]);

  const handleAdd = async () => {
    if (!form.role_name.trim()) return;
    await api.createRoleToFit(form);
    setForm({ role_name: '', quantity_needed: 1, shoot_date: '', notes: '' });
    setShowAdd(false);
    load();
  };

  const handleSaveEdit = async (id) => {
    await api.updateRoleToFit(id, editForm);
    setEditingId(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this role entry?')) return;
    await api.deleteRoleToFit(id);
    load();
  };

  const totalNeeded    = roles.reduce((s, r) => s + (r.quantity_needed || 1), 0);
  const totalInShoot   = roles.reduce((s, r) => s + (r.in_shoots || 0), 0);
  const totalUnassigned = roles.reduce((s, r) => s + (r.unassigned_shoot || 0), 0);
  const totalStillNeeded = roles.reduce((s, r) => {
    const needed = r.quantity_needed || 1;
    const confirmed = (r.in_shoots || 0) + (r.unassigned_shoot || 0);
    return s + Math.max(0, needed - confirmed);
  }, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Roles Still To Fit</h1>
          <p className="text-sm text-gray-500 mt-0.5">{roles.length} roles tracked</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-gold">+ Add Role</button>
      </div>

      {roles.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="card p-4 text-center">
            <div className="text-3xl font-black text-charcoal">{totalNeeded}</div>
            <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Total Needed</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-3xl font-black text-green-600">{totalInShoot}</div>
            <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Confirmed</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-3xl font-black text-amber-500">{totalUnassigned}</div>
            <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Unassigned</div>
          </div>
          <div className="card p-4 text-center border-2 border-red-200">
            <div className="text-3xl font-black text-red-600">{totalStillNeeded}</div>
            <div className="text-xs font-semibold text-red-500 uppercase mt-1">Still To Fit</div>
          </div>
        </div>
      )}

      {roles.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🎯</div>
          <p className="text-lg font-medium">No roles being tracked</p>
          <button onClick={() => setShowAdd(true)} className="btn-gold mt-4">+ Add First Role</button>
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map(r => {
            const isEditing = editingId === r.id;
            const needed = r.quantity_needed || 1;
            const inFit = r.in_fittings || 0;
            const inShoot = r.in_shoots || 0;
            const unassigned = r.unassigned_shoot || 0;
            const totalConfirmedOrUnassigned = inShoot + unassigned;
            const stillNeeded = Math.max(0, needed - totalConfirmedOrUnassigned);
            const pct = Math.min(100, Math.round((totalConfirmedOrUnassigned / needed) * 100));

            return (
              <div key={r.id} className="card p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="text-xs font-semibold text-gray-500 uppercase">Role Name</label><input className="input-field mt-1" value={editForm.role_name||''} onChange={e=>setEditForm(f=>({...f,role_name:e.target.value}))} /></div>
                      <div><label className="text-xs font-semibold text-gray-500 uppercase">Needed</label><input type="number" className="input-field mt-1" value={editForm.quantity_needed||1} onChange={e=>setEditForm(f=>({...f,quantity_needed:e.target.value}))} /></div>
                      <div><label className="text-xs font-semibold text-gray-500 uppercase">Shoot Date</label><input type="date" className="input-field mt-1" value={editForm.shoot_date||''} onChange={e=>setEditForm(f=>({...f,shoot_date:e.target.value}))} /></div>
                    </div>
                    <div><label className="text-xs font-semibold text-gray-500 uppercase">Notes</label><input className="input-field mt-1" value={editForm.notes||''} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} /></div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={()=>setEditingId(null)} className="btn-ghost text-xs">Cancel</button>
                      <button onClick={()=>handleSaveEdit(r.id)} className="btn-gold text-xs">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-charcoal">{r.role_name}</h3>
                        {r.notes && <span className="text-xs text-gray-400 italic">{r.notes}</span>}
                      </div>
                      <div className="grid grid-cols-5 gap-4 text-sm mb-3">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-charcoal">{needed}</div>
                          <div className="text-xs text-gray-500">Needed</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">{inFit}</div>
                          <div className="text-xs text-gray-500">In Fittings</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">{inShoot}</div>
                          <div className="text-xs text-gray-500">Confirmed</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-amber-500">{unassigned}</div>
                          <div className="text-xs text-gray-500">Unassigned</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-600">{stillNeeded}</div>
                          <div className="text-xs text-gray-500">Still Needed</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-500">{pct}%</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-gray-500 mb-1">Shoot Date</div>
                      <div className="text-sm font-medium mb-1">{r.shoot_date || '—'}</div>
                      <div className="text-xs text-gray-500 mb-1">Days Remaining</div>
                      <Countdown targetDate={r.shoot_date} />
                      <div className="flex gap-1 mt-3 justify-end">
                        <button onClick={()=>{setEditingId(r.id);setEditForm({...r});}} className="btn-ghost text-xs">Edit</button>
                        <button onClick={()=>handleDelete(r.id)} className="btn-danger text-xs">Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={e=>e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">Add Role to Track</h3>
            <div className="space-y-3">
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Role Name</label><input className="input-field mt-1" value={form.role_name} onChange={e=>setForm(f=>({...f,role_name:e.target.value}))} placeholder="e.g. KLIPTOWN BLACK POLICE" autoFocus /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Total Needed</label><input type="number" className="input-field mt-1" value={form.quantity_needed} onChange={e=>setForm(f=>({...f,quantity_needed:parseInt(e.target.value)||1}))} min={1} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Shoot Date</label><input type="date" className="input-field mt-1" value={form.shoot_date} onChange={e=>setForm(f=>({...f,shoot_date:e.target.value}))} /></div>
              <div><label className="text-xs font-semibold text-gray-500 uppercase">Notes</label><input className="input-field mt-1" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={()=>setShowAdd(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleAdd} className="btn-gold">Add Role</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
