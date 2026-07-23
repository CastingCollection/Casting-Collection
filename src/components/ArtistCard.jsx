import { useState } from 'react';
import ArtistModal from './ArtistModal.jsx';

const CATEGORY_COLORS = {
  new: 'bg-green-100 text-green-800',
  pencil: 'bg-amber-100 text-amber-800',
  fitting: 'bg-blue-100 text-blue-800',
  shoot: 'bg-red-100 text-red-800',
  not_available: 'bg-gray-100 text-gray-600',
};

export default function ArtistCard({ artist, onUpdated, onDeleted, selected, onSelect, showCheckbox, actions, compact }) {
  const [editing, setEditing] = useState(false);
  const fullName = [artist.first_name, artist.last_name].filter(Boolean).join(' ');

  return (
    <>
      <div className={`artist-card relative ${selected ? 'ring-2 ring-gold' : ''}`}>
        {showCheckbox && (
          <div className={`absolute z-10 ${compact ? 'top-1 left-1' : 'top-2 left-2'}`}>
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onSelect?.(artist.id)}
              className={`accent-yellow-500 cursor-pointer ${compact ? 'w-3 h-3' : 'w-4 h-4'}`}
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}

        {/* Headshot */}
        <div
          className="aspect-[3/4] bg-gray-100 relative overflow-hidden cursor-pointer"
          onClick={() => setEditing(true)}
        >
          {artist.headshot_path ? (
            <img
              src={artist.headshot_path}
              alt={fullName}
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-gray-300 ${compact ? 'text-2xl' : 'text-4xl'}`}>
              👤
            </div>
          )}
          <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent ${compact ? 'p-1' : 'p-2'}`}>
            <p className={`text-white font-bold leading-tight ${compact ? 'text-[10px]' : 'text-sm'}`}>{fullName}</p>
          </div>
        </div>

        {/* Info */}
        <div className={compact ? 'px-1.5 py-1 space-y-0.5' : 'p-3 space-y-1'}>
          {artist.agent_name && (
            <p className="text-[10px] text-gray-500 truncate">{compact ? '' : '📎 '}{artist.agent_name}</p>
          )}
          {artist.role && (
            <p className="text-[10px] font-semibold text-indigo-700 truncate">{artist.role}</p>
          )}
          <div className="flex items-center justify-between gap-1">
            {artist.day_rate && !compact && (
              <span className="text-xs text-gray-500">R {artist.day_rate.replace(/[Rr]/gi,'').replace(/\s+/g,'').trim()}</span>
            )}
            <span className={`badge ${compact ? 'text-[9px] px-1 py-0' : 'text-xs'} ${CATEGORY_COLORS[artist.category] || 'bg-gray-100 text-gray-600'}`}>
              {artist.category?.replace('_',' ')||'new'}
            </span>
          </div>
          {!compact && artist.shoot_date && (
            <p className="text-xs text-gray-400">🎬 {artist.shoot_date}</p>
          )}
          {!compact && artist.fitting_date && (
            <p className="text-xs text-gray-400">👗 {artist.fitting_date}</p>
          )}
        </div>

        {/* Actions */}
        {actions && !compact && (
          <div className="px-3 pb-3 flex gap-1 flex-wrap">
            {actions.map((a, i) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); a.onClick(artist); }}
                className={`text-xs px-2 py-1 rounded font-medium ${a.className || 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setEditing(true)}
          className={`absolute right-1 bg-black/50 text-white rounded hover:bg-black/70 ${compact ? 'top-1 text-[9px] px-1 py-0.5' : 'top-2 text-xs px-2 py-1'}`}
        >
          Edit
        </button>
      </div>

      {editing && (
        <ArtistModal
          artist={artist}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setEditing(false); onUpdated?.(updated); }}
          onDeleted={() => { setEditing(false); onDeleted?.(artist.id); }}
        />
      )}
    </>
  );
}
