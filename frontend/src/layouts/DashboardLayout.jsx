import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, Box, ClipboardList, Video, Zap,
  MapPin, FileText, HardDrive, Settings, Menu, X, ChevronRight, Compass,
  PlusCircle, Users as UsersIcon, LogOut, Sun, Moon, Search, Sparkles
} from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useAuth } from '../auth/useAuth';
import CommandPalette from '../ui/CommandPalette';
import { PERMISSIONS } from '../auth/permissions';
import { useTheme } from '../ui/theme';
import { usePageTitle } from '../ui/usePageTitle';
import AssistantDrawer from '../assistant/AssistantDrawer';
import './DashboardLayout.css';
import '../auth/Auth.css';

const NAV_ITEMS = [
  { to: '/dashboard',            label: 'Dashboard',        Icon: LayoutDashboard, end: true },
  { to: '/inspection/new',       label: 'New Inspection',   Icon: PlusCircle, permission: PERMISSIONS.DETECTIONS_CREATE },
  { to: '/dashboard/tunnel',     label: '3D Tunnel View',   Icon: Box },
  { to: '/tunnel-twin',          label: '3D Twin',    Icon: Compass },
  { to: '/dashboard/inspections',label: 'Inspections',      Icon: ClipboardList },
  { to: '/dashboard/inspections/videos', label: 'Inspection Videos', Icon: Video },
  { to: '/dashboard/detections', label: 'AI Detections',    Icon: Zap },
  { to: '/dashboard/maps',       label: 'Maps & Location',  Icon: MapPin },
  { to: '/dashboard/reports',    label: 'Reports',          Icon: FileText },
  { to: '/dashboard/assets',     label: 'Assets',           Icon: HardDrive },
  { to: '/dashboard/users',      label: 'Users',            Icon: UsersIcon, permission: PERMISSIONS.USERS_MANAGE },
];

const SETTINGS_ITEM = { to: '/dashboard/settings', label: 'Settings', Icon: Settings };

function getPageTitle(pathname) {
  const map = {
    '/dashboard': 'Dashboard Overview',
    '/dashboard/tunnel': '3D Tunnel View',
    '/dashboard/tunnel-twin': '3D Digital Twin',
    '/tunnel-twin': '3D Digital Twin',
    '/dashboard/inspections': 'Inspections',
    '/dashboard/inspections/videos': 'Inspection Videos',
    '/dashboard/detections': 'AI Detections',
    '/dashboard/maps': 'Maps & Location',
    '/dashboard/reports': 'Reports',
    '/dashboard/assets': 'Assets',
    '/dashboard/settings': 'Settings',
    '/dashboard/users': 'User Management',
    '/inspection/new': 'New Inspection',
  };
  // defect detail
  if (pathname.startsWith('/dashboard/detections/')) return 'Defect Detail';
  return map[pathname] || 'HRT Inspection';
}

function getBreadcrumbs(pathname) {
  if (pathname === '/dashboard') return [];
  const crumbs = [{ label: 'HRT', to: '/dashboard' }];
  const clean = pathname.replace(/^\//, '').replace(/\/$/, '');
  const segments = clean.split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    current += '/' + seg;
    const label = seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    crumbs.push({ label, to: current });
  }
  return crumbs;
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const { user, can, logout, authEnabled } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);
  const breadcrumbs = getBreadcrumbs(location.pathname);
  usePageTitle(pageTitle);
  const { theme, toggle } = useTheme();

  return (
    <div className="db-layout">
      <CommandPalette />
      <AssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
      <span key={`sweep-${location.pathname}`} className="route-sweep" aria-hidden="true" />
      {/* ── Sidebar ── */}
      <aside className={`db-sidebar ${sidebarOpen ? 'db-sidebar--open' : ''}`}>
        <div className="db-sidebar__brand">
          <Link to="/" className="db-sidebar__logo" aria-label="Go to home page">
            <span className="db-sidebar__logo-mark">HRT</span>
            <span className="db-sidebar__logo-sub">AI INSPECTION SYSTEM</span>
          </Link>
          <button
            className="db-sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="db-sidebar__nav" aria-label="Main navigation">
          <ul>
            {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map(({ to, label, Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `db-nav-item ${isActive ? 'db-nav-item--active' : ''}`
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="db-sidebar__footer">
          <NavLink
            to={SETTINGS_ITEM.to}
            className={({ isActive }) =>
              `db-nav-item ${isActive ? 'db-nav-item--active' : ''}`
            }
          >
            <Settings size={16} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* ── Overlay for mobile ── */}
      {sidebarOpen && (
        <div
          className="db-sidebar__overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Main content ── */}
      <div className="db-main">
        {/* Top bar */}
        <header className="db-topbar">
          <div className="db-topbar__left">
            <button
              className="db-topbar__menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>

            {breadcrumbs.length > 0 && (
              <nav className="db-breadcrumb" aria-label="Breadcrumb">
                {breadcrumbs.map((crumb, i) => (
                  <span key={`${i}-${crumb.to}`} className="db-breadcrumb__item">
                    {i > 0 && <ChevronRight size={14} className="db-breadcrumb__sep" />}
                    {i === breadcrumbs.length - 1
                      ? <span className="db-breadcrumb__current">{crumb.label}</span>
                      : <Link to={crumb.to} className="db-breadcrumb__link">{crumb.label}</Link>
                    }
                  </span>
                ))}
              </nav>
            )}
            {breadcrumbs.length === 0 && (
              <p className="db-topbar__title">{pageTitle}</p>
            )}
          </div>

          <div className="db-topbar__right">
            <button type="button" className="db-tool" onClick={() => window.dispatchEvent(new Event('hrt:palette'))} aria-label="Search pages and defects (Ctrl+K)" title="Search (Ctrl+K)">
              <Search size={15} /><span>Search</span><kbd>Ctrl K</kbd>
            </button>
            <button type="button" className="db-tool" onClick={() => setAiOpen((o) => !o)} aria-expanded={aiOpen} aria-label="Ask the assistant" title="Ask HRT about the defects">
              <Sparkles size={15} /><span>Ask HRT</span>
            </button>
            <button type="button" className="db-tool db-tool--icon" onClick={toggle} aria-label={theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'} title={theme === 'light' ? 'Dark theme' : 'Light theme (good for printing)'}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="db-topbar__user">
              <div className="db-topbar__avatar" aria-hidden="true">{(user?.name || user?.email || '?').slice(0, 2).toUpperCase()}</div>
              <div className="db-topbar__user-info">
                <span className="db-topbar__user-name">{user?.name || user?.email}</span>
                <span className="db-topbar__user-role">{user?.role}</span>
              </div>
              {authEnabled && (
                <button type="button" className="db-user-chip__logout" onClick={() => { logout(); navigate('/login', { replace: true }); }} aria-label={user?.demo ? 'Exit demo' : 'Sign out'} title={user?.demo ? 'Exit demo' : 'Sign out'}>
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="db-content">
          <ErrorBoundary>
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
