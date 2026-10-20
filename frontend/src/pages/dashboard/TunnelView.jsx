import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DETECTIONS, TUNNEL_META, INSPECTIONS } from '../../data/mockData';
import './TunnelView.css';

const SEV_COLOR = {
  Critical: '#dc2626',
  Major:    '#ea580c',
  Minor:    '#ca8a04',
  Info:     '#3b82f6',
};

export default function TunnelView() {
  const navigate = useNavigate();
  const [selectedDet, setSelectedDet] = useState(null);
  const [showDefects, setShowDefects] = useState(true);
  const [showPath, setShowPath] = useState(true);
  const [section, setSection] = useState('s01');

  const sectionDets = DETECTIONS.filter(d => {
    const insp = INSPECTIONS.find(i => i.id === d.inspectionId);
    return insp?.section === section;
  });

  return (
    <div className="tv-page">
      <div className="tv-header-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 className="tv-title" style={{ margin: 0 }}>3D Tunnel View</h1>
        <button
          className="tv-launch-twin-btn"
          onClick={() => navigate('/tunnel-twin')}
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: '1px solid #0ea5e9',
            padding: '8px 16px',
            fontFamily: "'IBM Plex Mono', Consolas, monospace",
            fontSize: '0.8rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
          id="btn-launch-3d-twin"
        >
          LAUNCH 3D ROVER DIGITAL TWIN →
        </button>
      </div>

      <div className="tv-layout">
        {/* ── Main 3D area (CSS-rendered tunnel) ── */}
        <div className="tv-canvas-area">
          <div className="tv-canvas-header">
            <span className="tv-canvas-label">HRT · 3D TUNNEL VIEW</span>
            <span className="tv-canvas-mode">
              {selectedDet
                ? `● ${selectedDet.severity.toUpperCase()} — ${selectedDet.subtype}`
                : 'Interactive — click a defect marker'}
            </span>
          </div>

          {/* CSS-rendered tunnel perspective view */}
          <div className="tv-tunnel-scene" aria-label="3D tunnel view (CSS-rendered representation)">
            {/* Background */}
            <div className="tv-tunnel-bg" />

            {/* Tunnel rings receding into perspective */}
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className="tv-ring"
                style={{
                  width: `${100 - i * 12}%`,
                  height: `${100 - i * 12}%`,
                  opacity: 0.15 + i * 0.05,
                  zIndex: i,
                  transform: `translateZ(${i * 40}px)`,
                }}
                aria-hidden="true"
              />
            ))}

            {/* Inspection path line */}
            {showPath && (
              <div className="tv-path-line" aria-label="Inspection path" />
            )}

            {/* Current position marker */}
            <div className="tv-position-marker" aria-label="Current ROV position">
              <span className="tv-pos-label">Ch 2.14 KM</span>
            </div>

            {/* Defect markers */}
            {showDefects && sectionDets.map((det, i) => {
              const x = 15 + (i / Math.max(sectionDets.length - 1, 1)) * 70;
              const y = 30 + (i % 3) * 20;
              return (
                <button
                  key={det.id}
                  className={`tv-marker ${selectedDet?.id === det.id ? 'tv-marker--selected' : ''}`}
                  style={{
                    left: `${x}%`, top: `${y}%`,
                    background: SEV_COLOR[det.severity],
                  }}
                  onClick={() => setSelectedDet(det === selectedDet ? null : det)}
                  aria-label={`${det.severity} ${det.category} at Ch ${det.chainage}`}
                  title={`${det.id} — ${det.subtype}`}
                >
                  {selectedDet?.id === det.id && (
                    <div className="tv-marker__popup">
                      <strong>{det.severity} Detected</strong>
                      <p>Confidence: {Math.round(det.confidence * 100)}%</p>
                      <p>Location: Ch {det.chainage.toFixed(2)} km</p>
                      <p>Orientation: {det.orientation}</p>
                    </div>
                  )}
                </button>
              );
            })}

            {/* Scale bar */}
            <div className="tv-scale" aria-label="Scale indicator">
              <span className="tv-scale__line" />
              <span className="tv-scale__text">12.4 m</span>
            </div>

            {/* Chainage label */}
            <div className="tv-chainage" aria-hidden="true">INTAKE</div>
          </div>

          {/* Measurement display */}
          <div className="tv-measurements" aria-label="Measurement data">
            <div className="tv-meas-item">
              <span className="tv-meas-label">Measurements</span>
              <span className="tv-meas-val">142.5°</span>
              <span className="tv-meas-unit">Pitch</span>
            </div>
            <div className="tv-meas-item">
              <span className="tv-meas-label">Roll</span>
              <span className="tv-meas-val">−2.1°</span>
            </div>
            <div className="tv-meas-item">
              <span className="tv-meas-label">Current Position</span>
              <span className="tv-meas-val">CH 2.14 KM</span>
            </div>
          </div>

          {/* Zoom / controls */}
          <div className="tv-controls" aria-label="View controls">
            <button className="tv-ctrl-btn" aria-label="Zoom in">+</button>
            <button className="tv-ctrl-btn" aria-label="Zoom out">−</button>
            <button className="tv-ctrl-btn" aria-label="Reset view">↺</button>
            <button className="tv-ctrl-btn" aria-label="Fullscreen">⛶</button>
          </div>
        </div>

        {/* ── Right panel ── */}
        <aside className="tv-panel">
          {/* View mode */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">View Mode</h2>
            <label className="tv-toggle" aria-label="Real-time mode">
              <span>Real-Time</span>
              <span className="tv-toggle__track tv-toggle__track--on" />
            </label>
          </div>

          {/* Section selector */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Tunnel Section</h2>
            <select
              className="tv-select"
              value={section}
              onChange={e => { setSection(e.target.value); setSelectedDet(null); }}
              aria-label="Select tunnel section"
            >
              {TUNNEL_META.sections.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Visibility layers */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Visibility Layers</h2>
            <label className="tv-check-row">
              <input
                type="checkbox"
                checked={showDefects}
                onChange={e => setShowDefects(e.target.checked)}
                aria-label="Show defects"
              />
              <span>Defects</span>
            </label>
            <label className="tv-check-row">
              <input
                type="checkbox"
                checked={showPath}
                onChange={e => setShowPath(e.target.checked)}
                aria-label="Show inspection path"
              />
              <span>Inspection Path</span>
            </label>
          </div>

          {/* Key metrics */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Key Metrics</h2>
            <table className="tv-meta-table">
              <tbody>
                <tr><td>Diameter</td><td>{TUNNEL_META.diameterM} m</td></tr>
                <tr><td>Length</td><td>{TUNNEL_META.totalLengthKm} km</td></tr>
                <tr><td>Gradient</td><td>{TUNNEL_META.gradientPercent}%</td></tr>
              </tbody>
            </table>
          </div>

          {/* Detection legend */}
          <div className="tv-panel-section">
            <h2 className="tv-panel-label">Detection Legend</h2>
            {Object.entries(SEV_COLOR).map(([sev, col]) => (
              <div key={sev} className="tv-legend-row">
                <span className="tv-legend-dot" style={{ background: col }} />
                <span className="tv-legend-label">{sev} Defect</span>
              </div>
            ))}
          </div>

          {/* Selected defect detail */}
          {selectedDet && (
            <div className="tv-selected-det">
              <h2 className="tv-panel-label">Selected Detection</h2>
              <p className="tv-sel-id">{selectedDet.id}</p>
              <p className="tv-sel-type">{selectedDet.subtype}</p>
              <p className="tv-sel-meta">Confidence: {Math.round(selectedDet.confidence * 100)}%</p>
              <p className="tv-sel-meta">Ch {selectedDet.chainage.toFixed(2)} km</p>
              <button
                className="tv-view-det-btn"
                onClick={() => navigate(`/dashboard/detections/${selectedDet.id}`)}
              >
                View Full Detail
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
