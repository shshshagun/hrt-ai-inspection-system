import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDetections } from '../hooks/useApi';
import { useAuth } from '../auth/useAuth';
import { PERMISSIONS } from '../auth/permissions';
import { toggleTheme } from './theme';
import './ui.css';

const PAGES = [
  { label: 'Dashboard', to: '/dashboard', hint: 'Overview' },
  { label: 'New Inspection', to: '/inspection/new', hint: 'Upload video, webcam, photos', permission: PERMISSIONS.DETECTIONS_CREATE },
  { label: '3D Tunnel Twin', to: '/tunnel-twin', hint: 'Digital twin' },
  { label: '3D Tunnel View', to: '/dashboard/tunnel', hint: 'Risk heat-map' },
  { label: 'Inspections', to: '/dashboard/inspections', hint: 'Sessions' },
  { label: 'Inspection Videos', to: '/dashboard/inspections/videos', hint: 'Frame player' },
  { label: 'AI Detections', to: '/dashboard/detections', hint: 'All defects' },
  { label: 'Reports', to: '/dashboard/reports', hint: 'PDF and CSV' },
  { label: 'Settings', to: '/dashboard/settings', hint: 'Model and system' },
  { label: 'Users', to: '/dashboard/users', hint: 'Roles and access', permission: PERMISSIONS.USERS_MANAGE },
];

/** Ctrl+K (or Cmd+K): jump to a page or straight to a defect. */
export default function CommandPalette() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: dets } = useDetections();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQuery(''); setIndex(0); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => { setOpen(true); setQuery(''); setIndex(0); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('hrt:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hrt:palette', onOpen); };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = PAGES.filter((p) => !p.permission || can(p.permission)).map((p) => ({ ...p, kind: 'page' }));
    const defects = (dets || []).map((d) => ({
      kind: 'defect',
      label: `${d.severity} ${d.category} · ${Number(d.chainage_m ?? d.chainage ?? 0).toFixed(1)} m`,
      hint: `${d.orientation || ''} · ${d.inspectionId || ''}`,
      to: `/dashboard/detections/${d.id}`,
    }));
    const actions = [{ kind: 'action', label: 'Toggle light or dark theme', hint: 'Appearance', run: toggleTheme }];
    const all = [...pages, ...actions, ...defects];
    const hits = q ? all.filter((r) => `${r.label} ${r.hint}`.toLowerCase().includes(q)) : pages;
    return hits.slice(0, 40);
  }, [query, dets, can]);

  if (!open) return null;

  const go = (r) => { setOpen(false); if (r.run) r.run(); else navigate(r.to); };
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[index]) go(results[index]);
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0); }} onKeyDown={onInputKey}
          placeholder="Search pages and defects…" aria-label="Search pages and defects" />
        <ul role="listbox">
          {results.length === 0 && <li style={{ padding: '14px 12px', color: '#8fa8bb' }}>Nothing found</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.to || r.label}-${i}`} role="option" aria-selected={i === index}>
              <button type="button" onClick={() => go(r)} onMouseEnter={() => setIndex(i)}>
                <span>{r.kind === 'defect' ? '◈' : r.kind === 'action' ? '◐' : '→'}</span><span>{r.label}</span><small>{r.hint}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="cmdk__hint"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> toggle</span></div>
      </div>
    </div>
  );
}
