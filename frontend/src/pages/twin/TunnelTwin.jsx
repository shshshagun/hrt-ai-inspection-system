import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, SkipBack, SkipForward, Square, Layers, Ruler, Camera, Sun, Flame, Upload, Glasses, HelpCircle,
  Compass, List, Link2, X,
} from 'lucide-react';
import { API_BASE } from '../../config/api';
import { authFetch } from '../../auth/authFetch';
import { useToast } from '../../ui/contexts';
import ChainageScrubber from '../../components/insight/ChainageScrubber';
import { createTwinEngine, SEVERITY_COLOR, SLAB_M } from './engine';
import { toTwinDefect, parseProfileCsv, formatClock, describeDefect } from './geometry';
import { TUNNEL_CONFIG } from './tunnel.config';
import './TunnelTwin.css';

const LENGTH = TUNNEL_CONFIG.length_m;
const SEV_HEX = (sev) => `#${(SEVERITY_COLOR[sev] || SEVERITY_COLOR.Minor).toString(16).padStart(6, '0')}`;
const RANK = { Critical: 0, Major: 1, Minor: 2, Info: 3 };

function detectWebGLError() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? null : 'WebGL is unavailable or disabled in this browser.';
  } catch {
    return 'WebGL could not start. Please enable hardware acceleration.';
  }
}

/** Defects within 15 m of the camera as dots at their clock position (12 o'clock at the top, 3 o'clock on the right). */
function ClockMini({ defects, chainage, selectedId }) {
  const near = defects.filter((d) => d.located && Math.abs(d.chainage_m - chainage) <= 15);
  return (
    <figure className="tw-clock" aria-label="Defects near the camera by clock position">
      <svg viewBox="-50 -50 100 100">
        <circle r="40" className="tw-clock__ring" />
        {Array.from({ length: 12 }, (_, h) => {
          const a = (h * 30 * Math.PI) / 180;
          return <g key={h}><line x1={Math.sin(a) * 36} y1={-Math.cos(a) * 36} x2={Math.sin(a) * 40} y2={-Math.cos(a) * 40} className="tw-clock__tick" />{h % 3 === 0 && <text x={Math.sin(a) * 46} y={-Math.cos(a) * 46 + 3} textAnchor="middle" className="tw-clock__num">{h === 0 ? 12 : h}</text>}</g>;
        })}
        {near.map((d) => {
          const a = (d.angle_deg * Math.PI) / 180;
          const r = 12 + (1 - Math.abs(d.chainage_m - chainage) / 15) * 22; // closer defects sit nearer the rim
          return <circle key={d.id} cx={Math.sin(a) * r} cy={-Math.cos(a) * r} r={d.id === selectedId ? 4.2 : 2.8} fill={SEV_HEX(d.severity)} stroke={d.id === selectedId ? '#fff' : 'none'} strokeWidth="1" />;
        })}
      </svg>
      <figcaption>Within 15 m · {near.length}</figcaption>
    </figure>
  );
}

export default function TunnelTwin() {
  const [searchParams] = useSearchParams();
  const defectParam = searchParams.get('defect');
  const chainageParam = searchParams.get('chainage');
  const toast = useToast();

  const mountRef = useRef(null);
  const engineRef = useRef(null);
  const [webglError] = useState(detectWebGLError);

  const [defects, setDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [cam, setCam] = useState({ chainage: 6, mode: 'fly' });
  const [tools, setTools] = useState({ heat: true, ghosts: true, light: true, measure: false, section: null, atmosphere: 'water', quality: 'balanced', shape: 'circular' });
  const [view, setView] = useState({ inspectionId: null });
  const [replay, setReplay] = useState({ active: false });
  const [measureResult, setMeasureResult] = useState(null);
  const [profile, setProfile] = useState({ rows: null, name: '' });
  const [panel, setPanel] = useState({ inventory: false, help: true });
  const [sortBy, setSortBy] = useState('chainage');
  const [vr, setVr] = useState(false);
  const [lapse, setLapse] = useState(false);

  const located = useMemo(() => defects.filter((d) => d.located), [defects]);
  const unlocated = useMemo(() => defects.filter((d) => !d.located), [defects]);
  const selected = useMemo(() => defects.find((d) => d.id === selectedId) || null, [defects, selectedId]);

  // inspections, oldest first
  const inspections = useMemo(() => {
    const t = new Map();
    defects.forEach((d) => { if (d.inspectionId) t.set(d.inspectionId, Math.max(t.get(d.inspectionId) || 0, new Date(d.detectedAt || 0).getTime())); });
    return [...t.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  }, [defects]);

  // handlers the engine calls are read through a ref, so the engine is created once
  const live = useRef({});
  useEffect(() => { live.current.located = located; live.current.selectedId = selectedId; });

  // ───────────── data ─────────────
  useEffect(() => {
    let active = true;
    authFetch(`${API_BASE}/api/detections`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}`))))
      .then((rows) => { if (active) { setDefects((Array.isArray(rows) ? rows : []).map(toTwinDefect)); setLoading(false); } })
      .catch((err) => { if (active) { setDataError(err.message || 'Could not load detections'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  // ───────────── engine ─────────────
  useEffect(() => {
    if (webglError || !mountRef.current) return undefined;
    const engine = createTwinEngine(mountRef.current, {
      onSelect: (id) => setSelectedId(id),
      onCamera: (c) => setCam((prev) => (Math.abs(prev.chainage - c.chainage) < 0.05 && prev.mode === c.mode ? prev : { chainage: c.chainage, mode: c.mode })),
      onMode: (mode) => setCam((prev) => ({ ...prev, mode })),
      onMeasure: (m) => setMeasureResult(m),
      onReplay: (r) => setReplay(r),
      onKey: (e) => live.current.onKey?.(e),
    });
    engineRef.current = engine;
    if (import.meta.env.DEV) window.__twin = engine; // for manual checks in the browser console
    engine.vrSupported().then(setVr);
    return () => { engine.destroy(); engineRef.current = null; };
  }, [webglError]);

  useEffect(() => { engineRef.current?.setDefects(defects); }, [defects, profile, tools.shape]);
  useEffect(() => { engineRef.current?.setSelected(selectedId); }, [selectedId, defects]);
  useEffect(() => { engineRef.current?.setView({ inspectionId: view.inspectionId, ghosts: tools.ghosts, heat: tools.heat }); }, [view, tools.ghosts, tools.heat, defects]);
  useEffect(() => { engineRef.current?.setAtmosphere(tools.atmosphere); }, [tools.atmosphere]);
  useEffect(() => { engineRef.current?.setQuality(tools.quality); }, [tools.quality]);
  useEffect(() => { engineRef.current?.setLight(tools.light); }, [tools.light]);
  useEffect(() => { engineRef.current?.setMeasure(tools.measure); }, [tools.measure]);

  // ───────────── deep links: ?defect= and ?chainage= (used by the defect page and the dashboard) ─────────────
  const linkDone = useRef('');
  useEffect(() => {
    if (!engineRef.current || loading || (!defectParam && !chainageParam)) return;
    const key = `${defectParam}:${chainageParam}:${defects.length}`;
    if (linkDone.current === key) return;
    const match = defectParam && located.find((d) => d.id.toLowerCase() === defectParam.toLowerCase());
    if (match) {
      linkDone.current = key;
      setSelectedId(match.id);
      requestAnimationFrame(() => engineRef.current?.flyToDefect(match.id));
      return;
    }
    const z = parseFloat(chainageParam);
    if (Number.isFinite(z)) {
      linkDone.current = key;
      requestAnimationFrame(() => engineRef.current?.flyToChainage(z));
      const nearest = located.map((d) => ({ d, gap: Math.abs(d.chainage_m - z) })).sort((a, b) => a.gap - b.gap)[0];
      if (nearest && nearest.gap <= 15) setSelectedId(nearest.d.id);
    }
  }, [defectParam, chainageParam, defects, located, loading]);

  // ───────────── actions ─────────────
  const flyTo = useCallback((d) => { setSelectedId(d.id); setPanel((p) => ({ ...p, inventory: false })); engineRef.current?.flyToDefect(d.id); }, []);
  const cycle = useCallback((dir) => {
    const list = [...live.current.located].sort((a, b) => a.chainage_m - b.chainage_m);
    if (!list.length) return;
    const at = list.findIndex((d) => d.id === live.current.selectedId);
    flyTo(list[at < 0 ? (dir < 0 ? list.length - 1 : 0) : (at + dir + list.length) % list.length]);
  }, [flyTo]);
  const nearest = useCallback(() => {
    const z = engineRef.current?.debug.rig.pos.z ?? 0;
    const best = live.current.located.map((d) => ({ d, gap: Math.abs(d.chainage_m - z) })).sort((a, b) => a.gap - b.gap)[0];
    if (best && best.gap <= 15) setSelectedId(best.d.id);
  }, []);

  const stopReplay = () => engineRef.current?.replay.stop();
  const toggle = (name) => setTools((t) => ({ ...t, [name]: !t[name] }));
  const switchMode = (mode) => engineRef.current?.setMode(mode);

  const toggleSection = () => {
    if (tools.section != null) { setTools((t) => ({ ...t, section: null })); engineRef.current?.setSection(null); engineRef.current?.setMode('fly'); return; }
    const z = Math.max(0, Math.min(LENGTH - SLAB_M, Math.round(cam.chainage)));
    setTools((t) => ({ ...t, section: z })); engineRef.current?.setSection(z);
  };
  const moveSection = (z) => { setTools((t) => ({ ...t, section: z })); engineRef.current?.setSection(z); };

  const startReplay = () => {
    const list = located.filter((d) => view.inspectionId == null || d.inspectionId === view.inspectionId).sort((a, b) => a.chainage_m - b.chainage_m);
    if (!list.length) { toast.info('There are no located defects to replay.'); return; }
    if (tools.section != null) toggleSection();
    engineRef.current?.setMode('fly');
    engineRef.current?.replay.start(list);
  };

  const screenshot = () => {
    const url = engineRef.current?.screenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `hrt-twin-ch${Math.round(cam.chainage)}m.png`; a.click();
  };
  const copyLink = async () => {
    const q = new URLSearchParams();
    if (selectedId) q.set('defect', selectedId); else q.set('chainage', String(Math.round(cam.chainage)));
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${q}`); toast.success('Link to this view copied.'); }
    catch { toast.error('Could not copy the link.'); }
  };
  const loadProfile = async (file) => {
    if (!file) return;
    if (file.size > 300000) { toast.error('That file is too large for a profile (limit 300 KB).'); return; }
    const { rows, errors } = parseProfileCsv(await file.text());
    if (!rows.length) { toast.error(errors[0] || 'No usable rows in that file.'); return; }
    engineRef.current?.setProfile(rows);
    setProfile({ rows, name: file.name });
    toast.success(`Using the radius profile from ${file.name} (this visit only).${errors.length ? ` ${errors.length} row(s) were skipped.` : ''}`);
  };
  const resetProfile = () => { engineRef.current?.setProfile(null); setProfile({ rows: null, name: '' }); };

  // time-lapse: steps through the inspections in order, older ones stay as hollow rings
  useEffect(() => {
    if (!lapse) return undefined;
    let i = 0;
    const step = () => { setView({ inspectionId: inspections[i % inspections.length] }); i += 1; };
    const first = setTimeout(step, 0);
    const t = setInterval(step, 1800);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [lapse, inspections]);

  // keyboard shortcuts handled in React land (movement keys live in the engine)
  useEffect(() => {
    live.current.onKey = (e) => {
      if (e.code === 'BracketLeft') cycle(-1);
      else if (e.code === 'BracketRight') cycle(1);
      else if (e.code === 'Enter') nearest();
      else if (e.code === 'KeyH') setPanel((p) => ({ ...p, help: !p.help }));
      else if (e.code === 'KeyC') switchMode(cam.mode === 'fly' ? 'orbit' : 'fly');
      else if (e.code === 'KeyL') toggle('light');
      else if (e.code === 'KeyM') toggle('measure');
      else if (e.code === 'KeyP') { if (replay.active) engineRef.current?.replay.stop(); else startReplay(); }
      else if (e.code === 'Escape') { setSelectedId(null); if (replay.active) engineRef.current?.replay.stop(); }
    };
  });

  const sorted = useMemo(() => [...located].sort(sortBy === 'chainage' ? (a, b) => a.chainage_m - b.chainage_m : (a, b) => RANK[a.severity] - RANK[b.severity] || a.chainage_m - b.chainage_m), [located, sortBy]);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="tw" role="region" aria-label="Tunnel 3D digital twin">
      <div ref={mountRef} className="tw__viewport" tabIndex={0} />

      {webglError && (
        <div className="tw__center"><div className="tw__card"><h2>WebGL is required</h2><p>{webglError}</p><Link className="tw__btn" to="/dashboard">Back to the dashboard</Link></div></div>
      )}
      {loading && !webglError && <div className="tw__center tw__center--soft" role="status"><p className="tw__mono">Loading the twin…</p></div>}
      {dataError && <div className="tw__banner tw__banner--error" role="alert">Could not load detections: {dataError} <button type="button" onClick={() => window.location.reload()}>Retry</button></div>}

      {/* header */}
      <header className="tw__top">
        <Link to="/dashboard" className="tw__back"><ArrowLeft size={16} /> Dashboard</Link>
        <div className="tw__title">
          <b>Tunnel twin</b>
          <span>{profile.rows ? `Radius profile: ${profile.name}` : 'Parametric model, not a survey reconstruction'} · {tools.shape === 'circular' ? 'circular' : 'horseshoe'} section</span>
        </div>
        <div className="tw__readout tw__mono" aria-live="off">
          <span>CH {cam.chainage.toFixed(1)} m</span>
          <span>{cam.mode === 'orbit' ? 'ORBIT' : 'FLY'}</span>
        </div>
        <div className="tw__seg" role="group" aria-label="Camera mode">
          <button type="button" aria-pressed={cam.mode === 'fly'} onClick={() => switchMode('fly')}>Fly</button>
          <button type="button" aria-pressed={cam.mode === 'orbit'} onClick={() => switchMode('orbit')}>Orbit</button>
        </div>
      </header>

      {/* tool rail */}
      <nav className="tw__rail" aria-label="Twin tools">
        {[
          { id: 'replay', icon: replay.active ? Square : Play, label: replay.active ? 'Stop the replay (P)' : 'Replay: fly past each defect (P)', on: replay.active, run: () => (replay.active ? stopReplay() : startReplay()) },
          { id: 'section', icon: Layers, label: 'Cross-section cut', on: tools.section != null, run: toggleSection },
          { id: 'measure', icon: Ruler, label: 'Measure between two points (M)', on: tools.measure, run: () => toggle('measure') },
          { id: 'heat', icon: Flame, label: 'Severity glow on the lining', on: tools.heat, run: () => toggle('heat') },
          { id: 'light', icon: Sun, label: 'Inspection light (L)', on: tools.light, run: () => toggle('light') },
          { id: 'shot', icon: Camera, label: 'Save a screenshot', run: screenshot },
          { id: 'link', icon: Link2, label: 'Copy a link to this view', run: copyLink },
          { id: 'list', icon: List, label: 'Defect list', on: panel.inventory, run: () => setPanel((p) => ({ ...p, inventory: !p.inventory })) },
          { id: 'help', icon: HelpCircle, label: 'Controls (H)', on: panel.help, run: () => setPanel((p) => ({ ...p, help: !p.help })) },
        ].map(({ id, icon: Icon, label, on, run }) => (
          <button key={id} type="button" className="tw__tool" aria-label={label} title={label} aria-pressed={on === undefined ? undefined : Boolean(on)} onClick={run}><Icon size={18} /></button>
        ))}
        <label className="tw__tool" title="Load a radius profile (CSV: chainage_m,radius_m). View only, this visit only." aria-label="Load a radius profile CSV">
          <Upload size={18} /><input type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { loadProfile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {vr && <button type="button" className="tw__tool" aria-label="Enter VR (untested)" title="Enter VR (experimental)" onClick={() => engineRef.current?.enterVR().catch(() => toast.error('Could not start VR.'))}><Glasses size={18} /></button>}
      </nav>

      <div className="tw__side">
      {/* settings */}
      <aside className="tw__settings" aria-label="Display settings">
        <label>Section
          <select value={tools.shape} onChange={(e) => { setTools((t) => ({ ...t, shape: e.target.value })); engineRef.current?.setShape(e.target.value); }}>
            <option value="circular">Circular (default)</option><option value="horseshoe">Horseshoe (view only)</option>
          </select>
        </label>
        <label>Atmosphere
          <select value={tools.atmosphere} onChange={(e) => setTools((t) => ({ ...t, atmosphere: e.target.value }))}><option value="water">Water</option><option value="dry">Dry</option></select>
        </label>
        <label>Quality
          <select value={tools.quality} onChange={(e) => setTools((t) => ({ ...t, quality: e.target.value }))}><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option></select>
        </label>
        {profile.rows && <button type="button" className="tw__link" onClick={resetProfile}>Remove the loaded profile</button>}
      </aside>

      {/* inspection filter and time-lapse */}
      {inspections.length > 0 && (
        <aside className="tw__time" aria-label="Inspections">
          <label>Inspection
            <select value={view.inspectionId || ''} onChange={(e) => { setLapse(false); setView({ inspectionId: e.target.value || null }); }}>
              <option value="">All inspections</option>
              {inspections.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <label className="tw__check"><input type="checkbox" checked={tools.ghosts} onChange={() => toggle('ghosts')} /> Show others as hollow rings</label>
          {inspections.length > 1 && (
            <button type="button" className="tw__btn tw__btn--small" disabled={reduced} title={reduced ? 'Turned off because your system asks for reduced motion' : undefined} onClick={() => setLapse((l) => !l)}>
              {lapse ? <><Pause size={14} /> Stop time-lapse</> : <><Play size={14} /> Time-lapse</>}
            </button>
          )}
        </aside>
      )}

      {tools.section != null && (
        <aside className="tw__section" aria-label="Cross-section">
          <b>Cut at {tools.section} m</b>
          <input type="range" min={0} max={LENGTH - SLAB_M} step={1} value={tools.section} onChange={(e) => moveSection(Number(e.target.value))} aria-label="Cut chainage" />
          <span>Showing {SLAB_M} m downstream of the cut. Drag to orbit, scroll to zoom.</span>
        </aside>
      )}

      </div>

      {measureResult && (
        <div className="tw__measure tw__mono" role="status">
          {measureResult.distance.toFixed(2)} m straight · {measureResult.dChainage.toFixed(2)} m along the tunnel
          <button type="button" aria-label="Clear the measurement" onClick={() => engineRef.current?.clearMeasure()}><X size={14} /></button>
        </div>
      )}
      {tools.measure && !measureResult && <div className="tw__measure tw__mono" role="status">Click two points on the lining</div>}

      {/* notices */}
      <div className="tw__notes">
        {unlocated.length > 0 && <p>{unlocated.length} detection{unlocated.length === 1 ? ' has' : 's have'} no recorded position, so {unlocated.length === 1 ? 'it is' : 'they are'} not drawn. {panel.inventory ? '' : 'Open the list to see them.'}</p>}
        {located.length > 0 && <p>Chainage from live video inspections is estimated from the video time, not surveyed.</p>}
      </div>

      {/* replay */}
      {replay.active && (
        <div className="tw__replay" role="status" aria-live="polite">
          <p>{replay.caption}</p>
          <div>
            <button type="button" aria-label="Previous defect" onClick={() => engineRef.current?.replay.prev()}><SkipBack size={16} /></button>
            <button type="button" aria-label={replay.paused ? 'Resume' : 'Pause'} onClick={() => engineRef.current?.replay.pause(!replay.paused)}>{replay.paused ? <Play size={16} /> : <Pause size={16} />}</button>
            <button type="button" aria-label="Next defect" onClick={() => engineRef.current?.replay.next()}><SkipForward size={16} /></button>
            <span className="tw__mono">{(replay.index ?? 0) + 1} / {replay.total}</span>
            <button type="button" aria-label="Stop the replay" onClick={() => engineRef.current?.replay.stop()}><Square size={16} /></button>
          </div>
        </div>
      )}

      {/* inspector */}
      {selected && (
        <aside className="tw__inspector" aria-label="Selected defect">
          <header>
            <div><span className="tw__mono">DEFECT</span><h3>{selected.id}</h3></div>
            <button type="button" aria-label="Close" onClick={() => setSelectedId(null)}><X size={16} /></button>
          </header>
          <p className="tw__sev" style={{ color: SEV_HEX(selected.severity), borderColor: SEV_HEX(selected.severity) }}>{selected.severity.toUpperCase()} · {selected.cls}</p>
          {selected.imageUrl && <figure><img src={selected.imageUrl} alt={`Snapshot of defect ${selected.id}`} loading="lazy" /><figcaption>Frame snapshot, not to scale. It also appears on the wall in the model.</figcaption></figure>}
          <dl>
            <div><dt>Chainage</dt><dd>{selected.located ? `${selected.chainage_m.toFixed(1)} m` : 'not recorded'}</dd></div>
            <div><dt>Clock position</dt><dd>{formatClock(selected.angle_deg)}</dd></div>
            <div><dt>Size</dt><dd>{selected.sizeMeasured ? `${Math.round(selected.length_mm)} × ${selected.width_mm} mm` : 'not measured (system default)'}</dd></div>
            {selected.confidence != null && <div><dt>Confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div>}
            {selected.inspectionId && <div><dt>Inspection</dt><dd>{selected.inspectionId}</dd></div>}
          </dl>
          <p className="tw__hint">The ring on the wall is the measured crack length at true scale. The bright pin is only there to make it easy to find.</p>
          <div className="tw__actions">
            <button type="button" className="tw__btn" onClick={() => engineRef.current?.flyToDefect(selected.id)}><Compass size={15} /> Fly to it</button>
            <Link className="tw__btn tw__btn--ghost" to={`/dashboard/detections/${selected.id}`}>Open the full report and history →</Link>
          </div>
          <p className="tw__hint">{describeDefect(selected)}</p>
        </aside>
      )}

      {/* defect list */}
      {panel.inventory && (
        <aside className="tw__list" aria-label="Defect list">
          <header><h3>Defects ({located.length})</h3><button type="button" aria-label="Close the list" onClick={() => setPanel((p) => ({ ...p, inventory: false }))}><X size={16} /></button></header>
          <div className="tw__seg" role="group" aria-label="Sort">
            <button type="button" aria-pressed={sortBy === 'chainage'} onClick={() => setSortBy('chainage')}>Chainage</button>
            <button type="button" aria-pressed={sortBy === 'severity'} onClick={() => setSortBy('severity')}>Severity</button>
          </div>
          <ul>
            {sorted.map((d) => (
              <li key={d.id}><button type="button" className={d.id === selectedId ? 'is-on' : ''} onClick={() => flyTo(d)}>
                <i style={{ background: SEV_HEX(d.severity) }} /><span>{d.cls} <small>{d.chainage_m.toFixed(1)} m · {Math.round(d.angle_deg / 30) % 12 || 12} o'clock</small></span><small>{d.severity}</small>
              </button></li>
            ))}
          </ul>
          {unlocated.length > 0 && (
            <>
              <h4>No recorded position ({unlocated.length})</h4>
              <ul className="tw__list-muted">{unlocated.slice(0, 40).map((d) => <li key={d.id}><Link to={`/dashboard/detections/${d.id}`}>{d.cls} · {d.severity} · {d.inspectionId || 'no inspection'}</Link></li>)}</ul>
            </>
          )}
        </aside>
      )}

      {/* controls help */}
      {panel.help && (
        <aside className="tw__help" aria-label="Controls">
          <header><b>Controls</b><button type="button" aria-label="Close the help" onClick={() => setPanel((p) => ({ ...p, help: false }))}><X size={14} /></button></header>
          <ul>
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> faster</li>
            <li>Drag to look · arrows turn</li>
            <li><kbd>Space</kbd>/<kbd>Ctrl</kbd> up / down</li>
            <li><kbd>C</kbd> fly / orbit · scroll zooms in orbit</li>
            <li><kbd>[</kbd> <kbd>]</kbd> previous / next defect · <kbd>Enter</kbd> nearest</li>
            <li><kbd>P</kbd> replay · <kbd>M</kbd> measure · <kbd>L</kbd> light</li>
            <li><kbd>Esc</kbd> clear · <kbd>H</kbd> this help</li>
          </ul>
          <div className="tw__pad" aria-label="On-screen movement">
            {[['KeyW', '▲'], ['KeyA', '◀'], ['KeyS', '▼'], ['KeyD', '▶']].map(([k, g]) => (
              <button key={k} type="button" aria-label={`Move ${g}`}
                onPointerDown={() => engineRef.current?.input(k, true)} onPointerUp={() => engineRef.current?.input(k, false)} onPointerLeave={() => engineRef.current?.input(k, false)}>{g}</button>
            ))}
          </div>
        </aside>
      )}

      <ClockMini defects={defects} chainage={cam.chainage} selectedId={selectedId} />

      {/* bottom ruler: where the camera is, and a way to jump */}
      <footer className="tw__bottom">
        <ChainageScrubber defects={located} value={Math.max(0, Math.min(LENGTH, Math.round(cam.chainage * 2) / 2))} onChange={(z) => engineRef.current?.flyToChainage(z)} />
      </footer>
    </div>
  );
}
