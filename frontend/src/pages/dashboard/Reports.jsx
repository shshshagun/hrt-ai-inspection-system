import { REPORTS } from '../../data/mockData';
import './SharedPages.css';

export default function Reports() {
  return (
    <div className="sp-page">
      <h1 className="sp-title">Reports</h1>
      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
        Inspection reports derived from available detection records.
        PDF export requires backend report-generation endpoint at <code style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8em' }}>/api/reports/generate</code>.
      </p>
      <div className="sp-reports-grid">
        {REPORTS.map(r => (
          <div key={r.id} className="sp-report-card">
            <div className="sp-report-card__info">
              <h2 className="sp-report-card__title">{r.title}</h2>
              <p className="sp-report-card__meta">
                {r.id} · {r.date} · {r.defectCount} defects · {r.criticalCount} critical
              </p>
            </div>
            <div className="sp-report-card__actions">
              <span
                className="sp-badge"
                style={{
                  color: r.status === 'complete' ? 'var(--teal)' : 'var(--minor)',
                  borderColor: r.status === 'complete' ? 'var(--teal)' : 'var(--minor)',
                }}
              >
                {r.status}
              </span>
              <button
                className="sp-dl-btn"
                disabled={r.status !== 'complete'}
                title={r.status !== 'complete' ? 'Report not yet finalized' : 'Download PDF'}
                aria-label={`Download report ${r.id}`}
              >
                Download PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
