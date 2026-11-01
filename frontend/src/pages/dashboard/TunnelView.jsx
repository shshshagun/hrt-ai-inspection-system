import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldCheck, Activity, Flame, Info, Eye } from 'lucide-react';
import { useDetections } from '../../hooks/useApi';
import { DETECTIONS, TUNNEL_META } from '../../data/mockData';
import './TunnelView.css';

// ─── Severity Weights for Structural Risk Calculation ──────────
// Section Risk = 3 * N_critical + 2 * N_major + 1 * N_minor
const RISK_WEIGHTS = {
  Critical: 3,
  Major:    2,
  Minor:    1,
  Info:     0,
};

function getRiskCategory(score) {
  if (score >= 6) return { level: 'CRITICAL', color: '#ef4444', label: 'High Structural Distress' };
  if (score >= 3) return { level: 'ELEVATED', color: '#f97316', label: 'Moderate Deterioration' };
  if (score > 0)  return { level: 'NOMINAL',  color: '#eab308', label: 'Minor Superficial Flaws' };
  return { level: 'SOUND', color: '#10b981', label: 'Sound Concrete Lining' };
}

export default function TunnelView() {
  const navigate = useNavigate();
  const { data: apiDetections } = useDetections({ limit: 100 });
  const detections = apiDetections || DETECTIONS;

  const [activeSectionId, setActiveSectionId] = useState('s01');
  const [selectedBin, setSelectedBin] = useState(null);
  const [hoveredBin, setHoveredBin] = useState(null);

  // Active section metadata (e.g. s01 = 0 to 4.2 km)
  const currentSection = TUNNEL_META.sections.find(s => s.id === activeSectionId) || TUNNEL_META.sections[0];
  const [secStartKm, secEndKm] = currentSection.chainage;
  const sectionLengthMeters = (secEndKm - secStartKm) * 1000;

  // ── Calculate 100-meter Heatmap Bins ──────────────────────────
  const BIN_SIZE_M = 100;
  const numBins = Math.max(1, Math.ceil(sectionLengthMeters / BIN_SIZE_M));

  const bins = useMemo(() => {
    // Initialize empty bins
    const bArray = Array.from({ length: numBins }, (_, i) => {
      const startM = Math.round(secStartKm * 1000 + i * BIN_SIZE_M);
      const endM   = Math.min(Math.round(secEndKm * 1000), startM + BIN_SIZE_M);
      return {
        binIndex: i,
        startM,
        endM,
        startKm: (startM / 1000).toFixed(2),
        endKm:   (endM / 1000).toFixed(2),
        defects: [],
        criticalCount: 0,
        majorCount:    0,
        minorCount:    0,
        infoCount:     0,
        score:         0,
      };
    });

    // Populate defects into bins
    detections.forEach(d => {
      const dKm = d.chainage !== undefined ? d.chainage : (d.coord_z ? d.coord_z / 1000 : 0);
      if (dKm >= secStartKm && dKm <= secEndKm) {
        const dM = dKm * 1000;
        const bIdx = Math.min(numBins - 1, Math.max(0, Math.floor((dM - secStartKm * 1000) / BIN_SIZE_M)));
        const bin = bArray[bIdx];
        if (bin) {
          bin.defects.push(d);
          const sev = d.severity || 'Minor';
          if (sev === 'Critical') bin.criticalCount++;
          else if (sev === 'Major') bin.majorCount++;
          else if (sev === 'Minor') bin.minorCount++;
          else bin.infoCount++;
          bin.score += (RISK_WEIGHTS[sev] ?? 1);
        }
      }
    });

    // Add risk level and max-score scaling
    return bArray.map(b => ({
      ...b,
      risk: getRiskCategory(b.score),
    }));
  }, [detections, secStartKm, secEndKm, numBins]);

  // Aggregate Section Metrics
  const totalSectionScore = useMemo(() => bins.reduce((acc, b) => acc + b.score, 0), [bins]);
  const criticalSectionCount = useMemo(() => bins.reduce((acc, b) => acc + b.criticalCount, 0), [bins]);
  const highRiskBins = useMemo(() => bins.filter(b => b.score >= 6).length, [bins]);

  const activeFocusBin = selectedBin || hoveredBin || bins.find(b => b.score > 0) || bins[0];

  return (
    <div className="tv-page">
      {/* ── Top Header ── */}
      <div className="tv-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="tv-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
            Unwrapped Tunnel Risk Heatmap
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
            Automated Structural Severity Index (2D Cylinder Projection · 100 m Resolution)
          </p>
        </div>
        <button
          className="tv-launch-twin-btn"
          onClick={() => navigate('/tunnel-twin')}
          style={{
            backgroundColor: '#0d9488',
            color: '#ffffff',
            border: '1px solid #14b8a6',
            padding: '10px 18px',
            fontFamily: "'IBM Plex Mono', Consolas, monospace",
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '4px',
            boxShadow: '0 4px 14px rgba(13, 148, 136, 0.4)',
          }}
          id="btn-launch-3d-twin"
        >
          ENTER 3D ROVER DIGITAL TWIN →
        </button>
      </div>

      {/* ── Metric Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px 16px' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tunnel Section</span>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: '4px' }}>{currentSection.label}</div>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Ch {secStartKm.toFixed(1)} km &rarr; {secEndKm.toFixed(1)} km</span>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px 16px' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Severity Score</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: totalSectionScore > 10 ? '#ef4444' : '#14b8a6', marginTop: '4px' }}>
            {totalSectionScore} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}>pts</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Formula: 3N_crit + 2N_maj + 1N_min</span>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px 16px' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Critical Zones</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: criticalSectionCount > 0 ? '#ef4444' : '#10b981', marginTop: '4px' }}>
            {criticalSectionCount} Defects
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{highRiskBins} High-distress segments (&ge;6 pts)</span>
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px 16px' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inspection Health</span>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: highRiskBins > 0 ? '#f97316' : '#10b981', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {highRiskBins > 0 ? <AlertTriangle size={18} color="#f97316" /> : <ShieldCheck size={18} color="#10b981" />}
            {highRiskBins > 0 ? 'Action Required' : 'Lining Sound'}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{bins.length} Survey Bins analyzed</span>
        </div>
      </div>

      <div className="tv-layout">
        {/* ── UNROLLED 2D HEATMAP CYLINDER PROJECTION ── */}
        <div className="tv-canvas-area" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="tv-canvas-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="tv-canvas-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Flame size={16} color="#f97316" />
              CYLINDRICAL UNWRAPPED PROJECTION (0&deg; &rarr; 360&deg; CROWN TO INVERT)
            </span>
            <span className="tv-canvas-mode" style={{ color: '#38bdf8' }}>
              CLICK SEGMENT TO INSPECT DEFECTS
            </span>
          </div>

          {/* Interactive Heatmap Strip */}
          <div style={{ background: '#090d16', padding: '16px', borderRadius: '6px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: '#64748b', fontFamily: "'IBM Plex Mono', monospace" }}>
              <span>Ch {secStartKm.toFixed(2)} km (Intake)</span>
              <span>Chainage Progression &rarr;</span>
              <span>Ch {secEndKm.toFixed(2)} km</span>
            </div>

            {/* Heatmap Blocks */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(bins.length, 42)}, 1fr)`,
                gap: '3px',
                height: '70px',
                background: '#040711',
                padding: '6px',
                borderRadius: '4px',
                overflowX: 'auto',
              }}
              role="region"
              aria-label="Chainage risk heatmap bins"
            >
              {bins.map(b => {
                const isSelected = selectedBin?.binIndex === b.binIndex;
                const isHovered  = hoveredBin?.binIndex  === b.binIndex;
                return (
                  <button
                    key={b.binIndex}
                    onClick={() => setSelectedBin(b)}
                    onMouseEnter={() => setHoveredBin(b)}
                    onMouseLeave={() => setHoveredBin(null)}
                    style={{
                      backgroundColor: b.risk.color,
                      border: isSelected ? '2px solid #ffffff' : isHovered ? '2px solid #38bdf8' : 'none',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      padding: 0,
                      position: 'relative',
                      opacity: b.score === 0 ? 0.35 : 0.95,
                      transition: 'transform 0.15s ease, opacity 0.15s ease',
                      transform: isSelected || isHovered ? 'scaleY(1.08)' : 'none',
                    }}
                    title={`Ch ${b.startKm}-${b.endKm} km | Score: ${b.score} (${b.risk.level}) | Defects: ${b.defects.length}`}
                    aria-label={`Bin ${b.startKm} to ${b.endKm} km`}
                  >
                    {b.criticalCount > 0 && (
                      <span style={{ position: 'absolute', top: '2px', right: '2px', width: '5px', height: '5px', borderRadius: '50%', background: '#ffffff' }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Unwrapped Cylinder Clock Projection (Crown -> Left Wall -> Invert -> Right Wall) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '0.72rem', color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace" }}>
              <span>12 o'clock (Crown)</span>
              <span>3 o'clock (Right Wall)</span>
              <span>6 o'clock (Invert / Floor)</span>
              <span>9 o'clock (Left Wall)</span>
              <span>12 o'clock (Crown)</span>
            </div>
          </div>

          {/* Active Segment Telemetry Card */}
          {activeFocusBin && (
            <div style={{ background: '#090d16', border: `1px solid ${activeFocusBin.risk.color}40`, borderRadius: '6px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Selected Chainage Segment</span>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Ch {activeFocusBin.startKm} &ndash; {activeFocusBin.endKm} km ({activeFocusBin.startM}m &ndash; {activeFocusBin.endM}m)
                  </h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      background: activeFocusBin.risk.color,
                      color: '#ffffff',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      letterSpacing: '0.05em'
                    }}
                  >
                    {activeFocusBin.risk.level} ({activeFocusBin.score} PTS)
                  </span>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>{activeFocusBin.risk.label}</div>
                </div>
              </div>

              {/* Defects in this bin */}
              {activeFocusBin.defects.length === 0 ? (
                <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '4px', color: '#10b981', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={18} /> No structural distress detected in this 100-meter section. Concrete lining intact.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Identified Defects in Segment ({activeFocusBin.defects.length})
                  </span>
                  {activeFocusBin.defects.map(d => (
                    <div
                      key={d.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#0f172a',
                        padding: '10px 14px',
                        borderRadius: '4px',
                        borderLeft: `4px solid ${d.severity === 'Critical' ? '#ef4444' : d.severity === 'Major' ? '#f97316' : '#eab308'}`
                      }}
                    >
                      <div>
                        <strong style={{ color: '#f1f5f9', fontSize: '0.9rem' }}>{d.id} &middot; {d.subtype || d.category}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          Ch {d.chainage ? d.chainage.toFixed(3) : '—'} km &middot; Confidence: {Math.round((d.confidence || 0) * 100)}% &middot; Status: {d.reviewStatus || 'flagged'}
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/dashboard/detections/${d.id}`)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #38bdf8',
                          color: '#38bdf8',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Eye size={12} /> Inspect
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── SIDEBAR CONTROLS & RISK SCALE ── */}
        <aside className="tv-panel">
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Tunnel Section Select</h2>
            <select
              className="tv-select"
              value={activeSectionId}
              onChange={e => {
                setActiveSectionId(e.target.value);
                setSelectedBin(null);
              }}
              aria-label="Select tunnel section"
            >
              {TUNNEL_META.sections.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Risk Scoring Formula */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Structural Risk Index (SRI)</h2>
            <div style={{ background: '#090d16', padding: '10px', borderRadius: '4px', fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>Calculation Standard:</div>
              <code style={{ color: '#14b8a6', display: 'block', marginBottom: '6px' }}>
                Score = 3(N_crit) + 2(N_maj) + 1(N_min)
              </code>
              Weights prioritize catastrophic fault modes (burst, collapse) over cosmetic spalling.
            </div>
          </div>

          {/* Heatmap Legend */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Heatmap Risk Scale</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', borderRadius: '3px', background: '#ef4444' }} />
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>&ge; 6 pts: High Risk (Critical)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', borderRadius: '3px', background: '#f97316' }} />
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>3 &ndash; 5 pts: Elevated (Major)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', borderRadius: '3px', background: '#eab308' }} />
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>1 &ndash; 2 pts: Nominal (Minor)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '14px', height: '14px', borderRadius: '3px', background: '#10b981', opacity: 0.6 }} />
                <span style={{ color: '#94a3b8' }}>0 pts: Sound Concrete</span>
              </div>
            </div>
          </div>

          {/* Technical Specifications */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Tunnel Geometry</h2>
            <table className="tv-meta-table">
              <tbody>
                <tr><td>Diameter</td><td>{TUNNEL_META.diameterM} m</td></tr>
                <tr><td>Total Length</td><td>{TUNNEL_META.totalLengthKm} km</td></tr>
                <tr><td>Bin Resolution</td><td>100 m / Cell</td></tr>
                <tr><td>Lining Type</td><td>PCC Precast Segments</td></tr>
              </tbody>
            </table>
          </div>
        </aside>
      </div>
    </div>
  );
}
