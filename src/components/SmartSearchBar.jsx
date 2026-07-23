import { useState, useRef, useMemo } from 'react';

/**
 * Smart search bar.
 * Props:
 *   pool       — full artist list provided by parent (no internal fetch)
 *   q / setQ   — controlled search string
 *   onSelectIds(ids) — optional; called with array of artist ids to select
 */
export default function SmartSearchBar({ pool = [], q, setQ, onSelectIds, onOpenArtist, onSelectRole, roleFilter, onClearRole }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);

  const suggestions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const results = [];

    const roleCounts = {};
    pool.forEach(a => {
      if (a.role && a.role.toLowerCase().includes(term)) {
        roleCounts[a.role] = (roleCounts[a.role] || 0) + 1;
      }
    });
    Object.entries(roleCounts).forEach(([role, count]) => {
      results.push({ type: 'role', label: role, count, ids: pool.filter(a => a.role === role).map(a => a.id) });
    });

    pool.forEach(a => {
      const full = `${a.first_name} ${a.last_name}`.toLowerCase();
      if (full.includes(term)) {
        results.push({ type: 'artist', label: `${a.first_name} ${a.last_name}`, role: a.role, ids: [a.id] });
      }
    });

    return results.slice(0, 12);
  }, [q, pool]);

  const handleSuggestionClick = (s) => {
    setShowSuggestions(false);
    if (s.type === 'artist' && onOpenArtist) {
      onOpenArtist(s.ids[0]);
    } else if (s.type === 'role' && onSelectRole) {
      setQ('');
      onSelectRole(s.label);
    } else {
      setQ(s.label);
      if (onSelectIds) onSelectIds(s.ids);
    }
  };

  const handleClear = () => {
    setQ('');
    setShowSuggestions(false);
    if (onSelectIds) onSelectIds([]);
    if (onClearRole) onClearRole();
  };

  return (
    <div className="flex items-center gap-2">
    {roleFilter && (
      <div className="flex items-center gap-1 bg-gold/20 text-gold-dark border border-gold/40 rounded-full px-3 py-1 text-xs font-bold">
        {roleFilter}
        <button onClick={onClearRole} className="ml-1 text-gold-dark hover:text-red-500 font-bold leading-none">×</button>
      </div>
    )}
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
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
        >×</button>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={() => handleSuggestionClick(s)}
              className="w-full text-left px-3 py-2 hover:bg-gold/10 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
            >
              <div>
                <span className="text-sm font-semibold text-charcoal">{s.label}</span>
                {s.type === 'artist' && s.role && (
                  <span className="text-xs text-gray-400 ml-2">{s.role}</span>
                )}
              </div>
              {s.type === 'role'
                ? <span className="text-xs bg-gold/20 text-gold-dark font-bold px-2 py-0.5 rounded-full whitespace-nowrap">Role · {s.count} artists</span>
                : <span className="text-xs text-gray-400">Artist</span>
              }
            </button>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
