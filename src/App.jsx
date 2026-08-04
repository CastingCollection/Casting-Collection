import { useState, useEffect, createContext, useContext, Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div className="p-8 text-red-400 font-mono text-sm whitespace-pre-wrap">
        <strong>Page error:</strong> {this.state.error?.message}
      </div>
    );
    return this.props.children;
  }
}
import Sidebar from './components/Sidebar.jsx';
import CastingBriefs from './pages/CastingBriefs.jsx';
import CastingArtists from './pages/CastingArtists.jsx';
import CastingPresentation from './pages/CastingPresentation.jsx';
import NewArtists from './pages/NewArtists.jsx';
import Pencilling from './pages/Pencilling.jsx';
import Fittings from './pages/Fittings.jsx';
import ShootDates from './pages/ShootDates.jsx';
import NotAvailable from './pages/NotAvailable.jsx';
import RolesToFit from './pages/RolesToFit.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import AllArtists from './pages/AllArtists.jsx';
import ZCards from './pages/ZCards.jsx';
import { api } from './api.js';
import { PdfProgressProvider } from './contexts/PdfProgressContext.jsx';
import PdfProgressModal from './components/PdfProgressModal.jsx';
import { useUndo } from './hooks/useUndo.js';
import UndoToast from './components/UndoToast.jsx';

export const AppContext = createContext(null);

export function useApp() { return useContext(AppContext); }

const CATEGORY_LABELS = {
  new: 'New Artists',
  pencil: 'Pencilling',
  fitting: 'Fittings',
  shoot: 'Shoot Dates',
  not_available: 'Not Available',
};

export default function App() {
  const [page, setPage] = useState('new-artists');
  const [counts, setCounts] = useState({});
  const [settings, setSettings] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const { pushUndo, undoPending, executeUndo, dismissUndo } = useUndo();

  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    api.getArtistCounts().then(setCounts).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
  }, [refreshKey]);

  // Shared by every category-move action in the app (the modal's Category
  // dropdown, per-card quick-move buttons, and bulk "Move" controls) so
  // moving an artist is always undoable for a few seconds afterward.
  // `artists` must be the FULL artist objects (not just ids) — we need each
  // one's current category to know what to restore on undo, since a bulk
  // selection can in principle span more than one original category.
  const moveArtistsWithUndo = async (artists, newCategory) => {
    if (!artists?.length) return;
    const ids = artists.map(a => a.id);
    await api.bulkCategory(ids, newCategory);
    refresh();

    const byOldCategory = {};
    artists.forEach(a => {
      const oldCat = a.category || 'new';
      (byOldCategory[oldCat] ||= []).push(a.id);
    });
    const newLabel = CATEGORY_LABELS[newCategory] || newCategory;
    const label = artists.length === 1
      ? `Moved ${[artists[0].first_name, artists[0].last_name].filter(Boolean).join(' ') || 'artist'} to ${newLabel}`
      : `Moved ${artists.length} artists to ${newLabel}`;

    pushUndo(label, async () => {
      await Promise.all(Object.entries(byOldCategory).map(([cat, catIds]) => api.bulkCategory(catIds, cat)));
      refresh();
    });
  };

  const pages = {
    'casting-briefs': <CastingBriefs />,
    'casting-artists': <CastingArtists />,
    'casting-presentation': <CastingPresentation />,
    'new-artists': <NewArtists />,
    'pencilling': <Pencilling />,
    'fittings': <Fittings />,
    'shoot-dates': <ShootDates />,
    'not-available': <NotAvailable />,
    'roles-to-fit': <RolesToFit />,
    'calendar': <CalendarPage />,
    'all-artists': <AllArtists />,
    'z-cards': <ZCards />,
  };

  return (
    <AppContext.Provider value={{ counts, settings, setSettings, refresh, refreshKey, pushUndo, moveArtistsWithUndo }}>
      <PdfProgressProvider>
        <div className="flex h-screen overflow-hidden bg-sidebar">
          <Sidebar activePage={page} onNavigate={setPage} counts={counts} settings={settings} />
          <main className="flex-1 overflow-y-auto bg-content-bg">
            <ErrorBoundary key={page}>
              {pages[page] || <div className="p-8 text-gray-500">Page not found</div>}
            </ErrorBoundary>
          </main>
        </div>
        <PdfProgressModal />
        <UndoToast pending={undoPending} onUndo={executeUndo} onDismiss={dismissUndo} />
      </PdfProgressProvider>
    </AppContext.Provider>
  );
}
