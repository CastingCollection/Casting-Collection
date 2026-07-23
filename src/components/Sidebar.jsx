import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import SettingsModal from './SettingsModal.jsx';
import { supabase } from '../supabaseClient.js';

const NAV_ITEMS = [
  { id: 'casting-briefs',      label: 'Casting Briefs',      icon: '📋', color: '#0D7377', countKey: null },
  { id: 'casting-presentation',label: 'Casting Presentation',icon: '🎬', color: '#7B2D42', countKey: null },
  { id: 'casting-artists',     label: 'Casting Artists',     icon: '🎭', color: '#4B3F72', countKey: null },
  { id: 'new-artists',         label: 'New Artists',         icon: '✨', color: '#2D6A4F', countKey: 'new' },
  { id: 'pencilling',          label: 'Pencilling',          icon: '✏️', color: '#D4880A', countKey: 'pencil' },
  { id: 'fittings',            label: 'Fittings',            icon: '👗', color: '#2E6DA4', countKey: 'fitting' },
  { id: 'shoot-dates',         label: 'Shoot Dates',         icon: '🎥', color: '#8B1A1A', countKey: 'shoot' },
  { id: 'not-available',       label: 'Not Available',       icon: '🚫', color: '#5A6475', countKey: 'not_available' },
  { id: 'roles-to-fit',        label: 'Roles Still To Fit',  icon: '🎯', color: '#6B6B2A', countKey: null },
  { id: 'calendar',            label: 'Calendar',            icon: '📅', color: '#4A235A', countKey: null },
  { id: 'all-artists',         label: 'All Artists',         icon: '👥', color: '#7A6435', countKey: 'total' },
  { id: 'z-cards',             label: 'Z-Cards',             icon: '🪪', color: '#1A5276', countKey: null },
];

export default function Sidebar({ activePage, onNavigate, counts, settings }) {
  const [showSettings, setShowSettings] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email || '');
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email || '');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <>
      <aside className="w-64 flex-shrink-0 bg-sidebar flex flex-col h-full border-r border-white/10">
        {/* Logo */}
        <div className="p-4 border-b border-white/10">
          {settings.app_logo_path ? (
            <img src={settings.app_logo_path} alt="Logo" className="h-16 w-full object-contain" />
          ) : (
            <div className="text-center">
              <div className="text-gold font-bold text-sm leading-tight">CASTING COLLECTION</div>
              <div className="text-gray-400 text-xs mt-0.5">Background Casting Management</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const count = item.countKey ? (counts[item.countKey] || 0) : null;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm font-medium ${
                  isActive
                    ? 'text-black font-semibold'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
                style={isActive ? { backgroundColor: item.color } : {}}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span className="flex-1 leading-tight">{item.label}</span>
                {count !== null && (
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                    style={{
                      backgroundColor: isActive ? 'rgba(0,0,0,0.25)' : item.color + '33',
                      color: isActive ? '#000' : item.color,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-white/10">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-gold hover:bg-white/5 rounded-lg text-sm transition-colors"
          >
            <span>⚙️</span>
            <span>Settings</span>
          </button>
        </div>

        {/* Auth footer — logged-in user + log out button */}
        <div className="p-3 border-t border-white/10">
          <p className="truncate text-xs text-gray-500" title={email}>
            Logged in as <span className="text-gray-300">{email || '…'}</span>
          </p>
          <button
            onClick={handleLogout}
            className="mt-2 w-full flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-gold hover:bg-white/5 rounded-lg text-sm transition-colors"
          >
            <span>🚪</span>
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
