import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, PlusCircle, Video, Trash2 } from 'lucide-react';
import { useInspections, deleteInspectionSession } from '../../hooks/useApi';
import './SharedPages.css';

export default function Inspections() {
  const navigate = useNavigate();
  const { data: rawInspections, loading, refetch } = useInspections();
  const [deletingId, setDeletingId] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const inspections = rawInspections || [];
  const statusColor = { completed: 'var(--teal)', pending: 'var(--minor)', in_progress: 'var(--info)' };

  async function handleDelete(e, id) {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteInspectionSession(id);
      refetch?.();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClearAll() {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      return;
    }
    setClearingAll(true);
    try {
      await deleteInspectionSession('ALL');
      setConfirmClearAll(false);
      refetch?.();
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="sp-page">
      <div className="sp-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="sp-title">Inspections</h1>
          <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0 0' }}>
            Live subsea ROV &amp; camera inspection logs and session archives.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {inspections.length > 0 && (
            <>
              {confirmClearAll && (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  style={{
                    background: '#111318',
                    border: '1px solid #1f2530',
                    color: '#94a3b8',
                    padding: '7px 12px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAll}
                disabled={clearingAll}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: confirmClearAll ? '#ef4444' : '#1a1114',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: confirmClearAll ? '#ffffff' : '#f87171',
                  padding: '7px 12px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {clearingAll ? <Loader2 size={14} className="sp-dl-btn__spin" /> : <Trash2 size={14} />}
                {confirmClearAll ? 'Confirm Clear All' : 'Clear All'}
              </button>
            </>
          )}
          <button
            className="db-btn-primary"
            onClick={() => navigate('/inspection/new')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <PlusCircle size={16} /> New Inspection
          </button>
        </div>
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
                  <td className="sp-td sp-td--arrow" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, insp.id)}
                      disabled={deletingId === insp.id}
                      title="Remove inspection from database"
                      aria-label={`Delete inspection ${insp.id}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--db-ink-3)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'inline-flex',
                      }}
                    >
                      {deletingId === insp.id ? <Loader2 size={14} className="sp-dl-btn__spin" /> : <Trash2 size={14} />}
                    </button>
                    <span>→</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
