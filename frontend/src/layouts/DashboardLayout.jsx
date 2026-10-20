import { useState } from 'react';
import { Outlet, NavLink, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, Box, ClipboardList, Video, Zap,
  MapPin, FileText, HardDrive, Settings, Menu, X, ChevronRight, Compass
} from 'lucide-react';
import './DashboardLayout.css';

const NAV_ITEMS = [
  { to: '/dashboard',            label: 'Dashboard',        Icon: LayoutDashboard, end: true },
  { to: '/dashboard/tunnel',     label: '3D Tunnel View',   Icon: Box },
  { to: '/tunnel-twin',          label: '3D Rover Twin',    Icon: Compass },
  { to: '/dashboard/inspections',label: 'Inspections',      Icon: ClipboardList },
  { to: '/dashboard/inspections/videos', label: 'Inspection Videos', Icon: Video },
  { to: '/dashboard/detections', label: 'AI Detections',    Icon: Zap },
  { to: '/dashboard/maps',       label: 'Maps & Location',  Icon: MapPin },
  { to: '/dashboard/reports',    label: 'Reports',          Icon: FileText },
  { to: '/dashboard/assets',     label: 'Assets',           Icon: HardDrive },
];

const SETTINGS_ITEM = { to: '/dashboard/settings', label: 'Settings', Icon: Settings };

function getPageTitle(pathname) {
  const map = {
    '/dashboard': 'Dashboard Overview',
    '/dashboard/tunnel': '3D Tunnel View',
    '/dashboard/tunnel-twin': '3D Rover Digital Twin',
    '/tunnel-twin': '3D Rover Digital Twin',
    '/dashboard/inspections': 'Inspections',
    '/dashboard/inspections/videos': 'Inspection Videos',
    '/dashboard/detections': 'AI Detections',
    '/dashboard/maps': 'Maps & Location',
    '/dashboard/reports': 'Reports',
    '/dashboard/assets': 'Assets',
    '/dashboard/settings': 'Settings',
  };
  // defect detail
  if (pathname.startsWith('/dashboard/detections/')) return 'Defect Detail';
  return map[pathname] || 'HRT Inspection';
}

function getBreadcrumbs(pathname) {
  const crumbs = [{ label: 'HRT', to: '/dashboard' }];
  if (pathname === '/dashboard') return [];
  const segments = pathname.replace('/dashboard/', '').split('/');
  let path = '/dashboard';
  for (const seg of segments) {
    path += '/' + seg;
    const label = seg.replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    crumbs.push({ label, to: path });
  }
  return crumbs;
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);
  const breadcrumbs = getBreadcrumbs(location.pathname);

  return (
    <div className="db-layout">
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
            {NAV_ITEMS.map(({ to, label, Icon, end }) => (
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
                  <span key={crumb.to} className="db-breadcrumb__item">
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
              <h1 className="db-topbar__title">{pageTitle}</h1>
            )}
          </div>

          <div className="db-topbar__right">
            <span className="db-topbar__demo-badge">DEMO DATA</span>
            <div className="db-topbar__user">
              <div className="db-topbar__avatar" aria-hidden="true">JD</div>
              <div className="db-topbar__user-info">
                <span className="db-topbar__user-name">John Doe</span>
                <span className="db-topbar__user-role">Inspector</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="db-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
