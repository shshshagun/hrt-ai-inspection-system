import './SharedPages.css';

export default function MapsLocation() {
  return (
    <div className="sp-page">
      <h1 className="sp-title">Maps &amp; Location</h1>
      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)' }}>
        Spatial visualisation is shown when GPS coordinates, acoustic telemetry,
        or chainage data are available for the inspection.
      </p>
      {/* Tunnel route schematic (no GPS available) */}
      <div className="sp-map-area" aria-label="Map — spatial data unavailable">
        <div className="sp-map-grid" aria-hidden="true" />
        <div className="sp-map-overlay">
          <h2>Spatial Data Unavailable</h2>
          <p>
            No GPS or acoustic positioning data has been recorded for current
            inspections. When ROV telemetry with real XYZ coordinates is ingested,
            the tunnel route and defect locations will appear here.
          </p>
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
            Simulated telemetry is available in <code>ai_pipeline/utils/spatial.py</code>
          </p>
        </div>
      </div>
    </div>
  );
}
