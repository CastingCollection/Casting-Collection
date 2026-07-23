import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ArtistCard from '../components/ArtistCard.jsx';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function CalendarPage() {
  const { refreshKey } = useApp();
  const [events, setEvents] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.getCalendar().then(setEvents).catch(()=>{});
  }, [refreshKey]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y=>y-1); } else setMonth(m=>m-1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y=>y+1); } else setMonth(m=>m+1); };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const getDateStr = (d) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const getEventsForDay = (d) => {
    const dateStr = getDateStr(d);
    return events.filter(e => e.date === dateStr);
  };

  const selectedEvents = selected ? getEventsForDay(selected) : [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-charcoal">Calendar</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-xs text-gray-600">Pencil Dates</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-xs text-gray-600">Fitting Days</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-700" />
            <span className="text-xs text-gray-600">Shoot Days</span>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Month nav */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-charcoal text-white">
          <button onClick={prevMonth} className="text-gold hover:text-gold-light text-xl font-bold">‹</button>
          <h2 className="text-lg font-bold">{MONTHS[month]} {year}</h2>
          <button onClick={nextMonth} className="text-gold hover:text-gold-light text-xl font-bold">›</button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 bg-gray-50 border-b">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-bold text-gray-500 py-2 uppercase tracking-wider">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="border-b border-r border-gray-100 min-h-[80px]" />;
            const dayEvents = getEventsForDay(day);
            const isSelected = selected === day;
            const isToday = getDateStr(day) === new Date().toISOString().slice(0, 10);
            return (
              <div
                key={i}
                onClick={() => setSelected(isSelected ? null : day)}
                className={`border-b border-r border-gray-100 min-h-[80px] p-1.5 cursor-pointer transition-colors ${
                  isSelected ? 'bg-gold/10' : 'hover:bg-gray-50'
                }`}
              >
                <div className={`text-sm font-semibold mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-gold text-black' : 'text-gray-700'
                }`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.map(e => (
                    <div
                      key={e.id}
                      className={`text-xs px-1.5 py-0.5 rounded font-medium truncate ${
                        e.type === 'fitting'
                          ? 'bg-blue-100 text-blue-800'
                          : e.type === 'pencil'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                      title={e.name}
                    >
                      {e.type === 'fitting' ? '👗' : e.type === 'pencil' ? '✏️' : '🎥'} {e.name}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selected && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg text-charcoal">
            {DAYS[new Date(getDateStr(selected) + 'T00:00:00').getDay()]}, {selected} {MONTHS[month]} {year}
          </h3>
          {selectedEvents.length === 0 ? (
            <div className="card p-5 text-gray-400 text-sm">No events on this day</div>
          ) : (
            selectedEvents.map(e => {
              const isFitting = e.type === 'fitting';
              const isPencil = e.type === 'pencil';
              const totalArtists = (e.bannerGroups || []).reduce((n, g) => n + g.artists.length, 0) + (e.ungrouped || []).length;
              return (
                <div key={e.id} className="card overflow-hidden">
                  {/* Event header */}
                  <div className={`px-5 py-3 flex items-center gap-3 ${isFitting ? 'bg-blue-600' : isPencil ? 'bg-amber-500' : 'bg-red-700'} text-white`}>
                    <span className="text-xl">{isFitting ? '👗' : isPencil ? '✏️' : '🎥'}</span>
                    <div>
                      <div className="font-bold text-base">{e.name}</div>
                      <div className="text-xs opacity-80">{isFitting ? 'Fitting Day' : isPencil ? 'Pencil Date' : 'Shoot Day'} · {totalArtists} artist{totalArtists !== 1 ? 's' : ''}</div>
                    </div>
                  </div>

                  {/* Artists by banner */}
                  {totalArtists === 0 ? (
                    <p className="px-5 py-4 text-sm text-gray-400 italic">No artists linked to this call sheet yet</p>
                  ) : (
                    <div className="p-4 space-y-5">
                      {(e.bannerGroups || []).map(group => (
                        <div key={group.id}>
                          <div className={`px-3 py-1.5 mb-3 rounded font-bold text-sm uppercase tracking-wide ${isFitting ? 'bg-blue-100 text-blue-800' : isPencil ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                            {group.name} <span className="font-normal opacity-60">({group.artists.length})</span>
                          </div>
                          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
                            {group.artists.map(a => (
                              <ArtistCard key={a.id} artist={a} compact onUpdated={() => api.getCalendar().then(setEvents)} />
                            ))}
                          </div>
                        </div>
                      ))}
                      {(e.ungrouped || []).length > 0 && (
                        <div>
                          {(e.bannerGroups || []).length > 0 && (
                            <div className="px-3 py-1.5 mb-3 rounded font-bold text-sm uppercase tracking-wide bg-gray-100 text-gray-600">
                              Unassigned <span className="font-normal opacity-60">({e.ungrouped.length})</span>
                            </div>
                          )}
                          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
                            {e.ungrouped.map(a => (
                              <ArtistCard key={a.id} artist={a} compact onUpdated={() => api.getCalendar().then(setEvents)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
