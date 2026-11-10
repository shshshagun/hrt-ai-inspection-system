/**
 * Reports.jsx — Module 7 (PDF/CSV Download) + Module 8 (Live API)
 *
 * Fetches inspection reports from the real API (falls back to mock data
 * when the backend is offline). Download buttons call POST /api/reports/generate
 * and trigger a browser file-download.
 */

import { useState } from 'react';
import { FileText, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useReports, generateReport } from '../../hooks/useApi';
import './SharedPages.css';

export default function Reports() {
  const { data: reports, loading, error } = useReports();
  // Track per-report download state: { [reportId]: 'idle' | 'loading' | 'done' | 'error' }
  const [dlState, setDlState] = useState({});

  async function handleDownload(report, format) {
    const key = `${report.id}-${format}`;
    setDlState(s => ({ ...s, [key]: 'loading' }));
    try {
      await generateReport({ inspection_id: report.inspectionId, format });
      setDlState(s => ({ ...s, [key]: 'done' }));
      // Reset to idle after 2 s
      setTimeout(() => setDlState(s => ({ ...s, [key]: 'idle' })), 2000);
    } catch (err) {
      console.error('[Reports] Download failed:', err);
      setDlState(s => ({ ...s, [key]: 'error' }));
      setTimeout(() => setDlState(s => ({ ...s, [key]: 'idle' })), 3000);
    }
  }

  function DownloadBtn({ report, format, label }) {
    const key   = `${report.id}-${format}`;
    const state = dlState[key] || 'idle';
    const isComplete = report.status === 'complete';

    return (
      <button
        className="sp-dl-btn"
        disabled={state === 'loading'}
        title={!isComplete ? 'Report not yet finalized — downloading demo data' : `Download ${format.toUpperCase()}`}
        aria-label={`Download ${format.toUpperCase()} for ${report.id}`}
        onClick={() => handleDownload(report, format)}
      >
        {state === 'loading' ? (
          <><Loader2 size={14} className="sp-dl-btn__spin" /> Generating…</>
        ) : state === 'done' ? (
          <><CheckCircle2 size={14} style={{ color: 'var(--teal)' }} /> Downloaded</>
        ) : state === 'error' ? (
          <><AlertCircle size={14} style={{ color: 'var(--critical)' }} /> Error — retry</>
        ) : (
          <><Download size={14} /> {label}</>
        )}
      </button>
    );
  }

  return (
    <div className="sp-page">
      <div className="sp-page-header">
        <h1 className="sp-title">Reports</h1>
      </div>

      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
        Inspection reports generated from real detection records.
        PDF and CSV downloads are powered by{' '}
        <code style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8em' }}>
          POST /api/reports/generate
        </code>.
      </p>

      {loading && (
        <div className="sp-loading" aria-label="Loading reports">
          <Loader2 size={24} className="sp-dl-btn__spin" />
          <span>Loading reports…</span>
        </div>
      )}

      {error && !loading && (
        <div className="sp-error-banner">
          <AlertCircle size={16} /> Live database temporarily unreachable. Retrying connection...
        </div>
      )}

      {!loading && (!reports || reports.length === 0) && (
        <div
          style={{
            background: 'var(--db-surface)',
            border: '1px dashed var(--db-border)',
            borderRadius: 'var(--radius-md)',
            padding: '60px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            color: 'var(--db-ink-2)',
            marginTop: '24px',
          }}
        >
          <FileText size={40} style={{ color: 'var(--db-ink-3)' }} />
          <div>
            <h3 style={{ color: 'var(--db-ink)', fontSize: 'var(--text-base)', fontWeight: 600, margin: '0 0 6px 0' }}>
              No audit reports available
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', maxWidth: '420px', margin: 0 }}>
              Official engineering audit reports are generated automatically from real detected anomalies when an inspection video is processed.
            </p>
          </div>
          <button
            className="db-btn-primary"
            onClick={() => window.location.href = '/inspection/new'}
            style={{ marginTop: '8px' }}
          >
            Run Inspection
          </button>
        </div>
      )}

      {!loading && reports && reports.length > 0 && (
        <div className="sp-reports-grid">
          {reports.map(r => (
            <div key={r.id} className="sp-report-card">
              <div className="sp-report-card__icon" aria-hidden="true">
                <FileText size={22} />
              </div>
              <div className="sp-report-card__info">
                <h2 className="sp-report-card__title">{r.title}</h2>
                <p className="sp-report-card__meta">
                  {r.id} · {r.date} · {r.defectCount} defects
                  {r.criticalCount > 0 && (
                    <span style={{ color: 'var(--critical)', marginLeft: '0.4rem' }}>
                      · {r.criticalCount} critical
                    </span>
                  )}
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
                <DownloadBtn report={r} format="pdf" label="PDF" />
                <DownloadBtn report={r} format="csv" label="CSV" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
