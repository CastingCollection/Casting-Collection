import { useState } from 'react';
import { api } from '../api.js';

const RATES = Array.from({ length: (5000 - 200) / 50 + 1 }, (_, i) => `R ${200 + i * 50}`);
const normalizeRate = v => { const n = v.replace(/[Rr]/gi, '').replace(/\s+/g, '').trim(); return n ? `R ${n}` : ''; };

const DATE_TYPES = [
  { value: 'pencil',  label: 'Pencil Date',  color: '#D4880A' },
  { value: 'fitting', label: 'Fitting Date',  color: '#2E6DA4' },
  { value: 'shoot',   label: 'Shoot Date',    color: '#8B1A1A' },
  { value: 'other',   label: 'Other',         color: '#4B3F72' },
];

const FIELDS = [
  { field: 'agent_name',   label: 'Agent',        type: 'text' },
  { field: 'role',         label: 'Role',          type: 'text' },
  { field: 'day_rate',     label: 'Day Rate',       type: 'rate' },
  { field: 'fitting_rate', label: 'Fitting Rate',   type: 'rate' },
  { field: 'shoot_date',   label: 'Shoot Date',     type: 'date' },
  { field: 'fitting_date', label: 'Fitting Date',   type: 'date' },
];

export default function BulkEditBar({ selected, onDone }) {
  const [bulkEdit, setBulkEdit] = useState(null);
  const [bulkValue, setBulkValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateType, setDateType] = useState('pencil');
  const [dateVal, setDateVal] = useState('');
  const [dateLabel, setDateLabel] = useState('');
  const [showRemoveDateModal, setShowRemoveDateModal] = useState(false);
  const [removeDateType, setRemoveDateType] = useState('pencil');

  if (!selected || selected.size === 0) return null;

  const open = (f) => { setBulkEdit(f); setBulkValue(''); };

  const handleApply = async () => {
    if (!bulkEdit) return;
    let val = bulkEdit.type === 'rate' ? normalizeRate(bulkValue) : bulkValue;
    setSaving(true);
    try {
      await api.bulkFieldUpdate([...selected], bulkEdit.field, val);
      setBulkEdit(null);
      setBulkValue('');
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDates = async () => {
    setSaving(true);
    try {
      await api.bulkRemoveDates([...selected], removeDateType);
      setShowRemoveDateModal(false);
      setRemoveDateType('pencil');
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  const handleAddDate = async () => {
    if (!dateVal) return;
    setSaving(true);
    try {
      await api.bulkAddDate([...selected], { type: dateType, date: dateVal, label: dateLabel.trim() });
      setShowDateModal(false);
      setDateVal('');
      setDateLabel('');
      setDateType('pencil');
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {FIELDS.map(f => (
          <button key={f.field} onClick={() => open(f)} className="btn-dark text-xs">
            ✏ Set {f.label}
          </button>
        ))}
        <button onClick={() => setShowDateModal(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border-2 border-gold text-gold hover:bg-gold hover:text-charcoal transition-colors">
          📅 Add Date to All
        </button>
        <button onClick={() => setShowRemoveDateModal(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border-2 border-red-400 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
          🗑 Remove Dates
        </button>
      </div>

      {/* Bulk field edit modal */}
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
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleApply()} />
                <datalist id="bulk-rates-list">{RATES.map(r => <option key={r} value={r} />)}</datalist>
              </>
            ) : bulkEdit.type === 'date' ? (
              <input type="date" className="input-field" value={bulkValue}
                onChange={e => setBulkValue(e.target.value)} autoFocus />
            ) : (
              <input className="input-field" placeholder="e.g. JHB AIRPORT CROWD 1990"
                value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                autoFocus onKeyDown={e => e.key === 'Enter' && handleApply()} />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setBulkEdit(null)} className="btn-ghost">Cancel</button>
              <button onClick={handleApply} disabled={saving} className="btn-gold">
                {saving ? 'Applying…' : 'Apply to All Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk add date modal */}
      {showDateModal && (
        <div className="modal-overlay" onClick={() => setShowDateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-[440px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-charcoal text-lg mb-1">Add Date to Selected Artists</h3>
            <p className="text-sm text-gray-500 mb-5">
              This date will be <span className="font-semibold text-gold">appended</span> to the profile of{' '}
              <span className="font-semibold text-gold">{selected.size} artist{selected.size !== 1 ? 's' : ''}</span> without removing existing dates.
            </p>

            <div className="space-y-4">
              {/* Type pills */}
              <div>
                <label className="block text-xs font-bold mb-2 text-gray-500 uppercase tracking-wider">Date Type</label>
                <div className="flex gap-2 flex-wrap">
                  {DATE_TYPES.map(t => (
                    <button key={t.value} onClick={() => setDateType(t.value)}
                      className="px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all"
                      style={{
                        background: dateType === t.value ? t.color : 'transparent',
                        borderColor: t.color,
                        color: dateType === t.value ? '#fff' : t.color,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-bold mb-1 text-gray-500 uppercase tracking-wider">Date *</label>
                <input type="date" className="input-field" value={dateVal}
                  onChange={e => setDateVal(e.target.value)} autoFocus />
              </div>

              {/* Label */}
              <div>
                <label className="block text-xs font-bold mb-1 text-gray-500 uppercase tracking-wider">
                  Label / Note <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input className="input-field" placeholder="e.g. SHOOTDAY 3, BG Police, Wardrobe check…"
                  value={dateLabel} onChange={e => setDateLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddDate()} />
              </div>

              {/* Preview badge */}
              {dateVal && (
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: DATE_TYPES.find(t => t.value === dateType)?.color }}>
                    {DATE_TYPES.find(t => t.value === dateType)?.label}
                  </span>
                  <span className="font-semibold text-sm text-charcoal">{dateVal}</span>
                  {dateLabel && <span className="text-xs text-gray-500">{dateLabel}</span>}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button onClick={() => setShowDateModal(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleAddDate} disabled={saving || !dateVal} className="btn-gold">
                {saving ? 'Adding…' : `Add to ${selected.size} Artist${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk remove dates modal */}
      {showRemoveDateModal && (
        <div className="modal-overlay" onClick={() => setShowRemoveDateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-[420px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-charcoal text-lg mb-1">Remove Dates from Selected Artists</h3>
            <p className="text-sm text-gray-500 mb-5">
              All dates of the chosen type will be <span className="font-semibold text-red-500">removed</span> from{' '}
              <span className="font-semibold text-gold">{selected.size} artist{selected.size !== 1 ? 's' : ''}</span>.
            </p>

            <div>
              <label className="block text-xs font-bold mb-2 text-gray-500 uppercase tracking-wider">Date Type to Remove</label>
              <div className="flex gap-2 flex-wrap">
                {DATE_TYPES.map(t => (
                  <button key={t.value} onClick={() => setRemoveDateType(t.value)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all"
                    style={{
                      background: removeDateType === t.value ? t.color : 'transparent',
                      borderColor: t.color,
                      color: removeDateType === t.value ? '#fff' : t.color,
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button onClick={() => setShowRemoveDateModal(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleRemoveDates} disabled={saving}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                {saving ? 'Removing…' : `Remove from ${selected.size} Artist${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
