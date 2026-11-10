import { useNavigate } from 'react-router-dom';
import { Loader2, PlusCircle, Video } from 'lucide-react';
import { useInspections } from '../../hooks/useApi';
import './SharedPages.css';

export default function Inspections() {
  const navigate = useNavigate();
  const { data: rawInspections, loading } = useInspections();
  const inspections = rawInspections || [];
  const statusColor = { completed: 'var(--teal)', pending: 'var(--minor)', in_progress: 'var(--info)' };

  return (
    <div className="sp-page">
      <div className="sp-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="sp-title">Inspections</h1>
          <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0 0' }}>
            Live subsea ROV inspection logs and session archives.
          </p>
        </div>
        <button
          className="db-btn-primary"
          onClick={() => navigate('/inspection/new')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <PlusCircle size={16} /> New Inspection
        </button>
      </div>

      {loading && (
        <div className="sp-loading" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '40px', color: 'var(--db-ink-2)' }}>
          <Loader2 size={24} className="sp-dl-btn__spin" style={{ color: 'var(--teal)' }} />
          <span>Loading inspections from database…</span>
        </div>
      )}

      {!loading && inspections.length === 0 && (
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
          }}
        >
          <Video size={40} style={{ color: 'var(--db-ink-3)' }} />
          <div>
            <h3 style={{ color: 'var(--db-ink)', fontSize: 'var(--text-base)', fontWeight: 600, margin: '0 0 6px 0' }}>
              No inspection sessions recorded
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', maxWidth: '420px', margin: 0 }}>
              Upload an inspection video or connect an ROV telemetry stream to detect subsea tunnel lining anomalies.
            </p>
          </div>
          <button
            className="db-btn-primary"
            onClick={() => navigate('/inspection/new')}
            style={{ marginTop: '8px' }}
          >
            Launch First Inspection
          </button>
        </div>
      )}

      {!loading && inspections.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table" aria-label="Inspections list">
            <thead>
              <tr>
                <th className="sp-th">ID</th>
                <th className="sp-th">Label</th>
                <th className="sp-th">Date</th>
                <th className="sp-th">ROV</th>
                <th className="sp-th">Coverage</th>
                <th className="sp-th">Detections</th>
                <th className="sp-th">Status</th>
                <th className="sp-th" />
              </tr>
            </thead>
            <tbody>
              {inspections.map(insp => (
                <tr
                  key={insp.id}
                  className="sp-tr"
                  onClick={() => navigate('/dashboard/inspections/videos')}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate('/dashboard/inspections/videos')}
                  aria-label={`Open inspection ${insp.id}`}
                >
                  <td className="sp-td sp-td--mono">{insp.id}</td>
                  <td className="sp-td sp-td--name">{insp.label}</td>
                  <td className="sp-td">{insp.date}</td>
                  <td className="sp-td">{insp.rov}</td>
                  <td className="sp-td">{insp.coverageKm} km</td>
                  <td className="sp-td sp-td--num">{insp.totalDetections}</td>
                  <td className="sp-td">
                    <span
                      className="sp-badge"
                      style={{ color: statusColor[insp.status] || 'var(--db-ink-3)', borderColor: statusColor[insp.status] || 'var(--db-border)' }}
                    >
                      {insp.status}
                    </span>
                  </td>
                  <td className="sp-td sp-td--arrow">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
