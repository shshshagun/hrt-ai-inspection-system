import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDetections } from '../hooks/useApi';
import { useAuth } from '../auth/useAuth';
import { PERMISSIONS } from '../auth/permissions';
import { toggleTheme } from './theme';
import { aiSearch } from '../assistant/api';
import { isDemo } from '../demo/demoMode';
import { parseKeywordQuery, applyKeywordFilters } from '../utils/keywordSearch';
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
  const [ai, setAi] = useState(null); // null | { loading } | { error } | { chips, rows, mode }
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQuery(''); setIndex(0); setAi(null); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => { setOpen(true); setQuery(''); setIndex(0); setAi(null); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('hrt:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hrt:palette', onOpen); };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const toRow = (d) => ({
    kind: 'defect',
    label: `${d.severity} ${d.category || d.defect_class} · ${Number(d.chainage_m ?? d.chainage ?? 0).toFixed(1)} m`,
    hint: `${d.orientation || d.clock_position || ''} · ${d.inspectionId || d.inspection_id || ''}`,
    to: `/dashboard/detections/${d.id}`,
  });

  const results = useMemo(() => {
    if (ai?.rows) return ai.rows.map(toRow);
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
    const ask = q.length >= 3 ? [{ kind: 'ask', label: `Search with AI: "${query.trim()}"`, hint: 'Press Enter' }] : [];
    // the AI row goes last when something already matches, so plain Enter still opens the best match
    return hits.length ? [...hits.slice(0, 40), ...ask] : ask;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dets, can, ai]);

  if (!open) return null;

  // Runs only on an explicit Enter or click, never while typing, to respect the free-plan quota.
  async function runAskAi() {
    const text = query.trim();
    const keyword = (note) => {
      const { filters, chips } = parseKeywordQuery(text);
      setAi({ chips: chips.length ? chips : ['no filters recognised'], rows: applyKeywordFilters(dets || [], filters), mode: note });
    };
    setAi({ loading: true });
    if (isDemo()) return keyword('Keyword search (the AI search needs a signed-in account)');
    try {
      const out = await aiSearch(text);
      setAi({ chips: out.interpreted.length ? out.interpreted : ['no filters, showing the most severe'], rows: out.results, mode: 'AI search' });
    } catch (err) {
      if (err.status === 503) return keyword('Keyword search (the AI search is not switched on for this server)');
      setAi({ error: err.message || 'The AI search failed.' });
    }
    return undefined;
  }

  const go = (r) => {
    if (r.kind === 'ask') { runAskAi(); return; }
    setOpen(false);
    if (r.run) r.run(); else navigate(r.to);
  };
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[index]) go(results[index]);
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0); setAi(null); }} onKeyDown={onInputKey}
          placeholder="Search pages and defects…" aria-label="Search pages and defects" />
        {ai?.loading && <p className="cmdk__status" role="status">Asking the AI…</p>}
        {ai?.error && <p className="cmdk__status cmdk__status--error" role="alert">{ai.error}</p>}
        {ai?.rows && (
          <p className="cmdk__status" role="status">
            {ai.mode}: {ai.chips.map((c) => <b key={c} className="cmdk__chip">{c}</b>)} {ai.rows.length} result{ai.rows.length === 1 ? '' : 's'}
          </p>
        )}
        <ul role="listbox">
          {results.length === 0 && !ai?.loading && <li style={{ padding: '14px 12px', color: 'var(--ink-3)' }}>Nothing found</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.to || r.label}-${i}`} role="option" aria-selected={i === index}>
              <button type="button" onClick={() => go(r)} onMouseEnter={() => setIndex(i)}>
                <span>{r.kind === 'defect' ? '◈' : r.kind === 'action' ? '◐' : r.kind === 'ask' ? '✦' : '→'}</span><span>{r.label}</span><small>{r.hint}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="cmdk__hint"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> toggle</span></div>
      </div>
    </div>
  );
}
