import { useNavigate } from 'react-router-dom';
import { Loader2, HardDrive } from 'lucide-react';
import { useInspections } from '../../hooks/useApi';
import './SharedPages.css';

export default function Assets() {
  const navigate = useNavigate();
  const { data: rawInspections, loading } = useInspections();
  const inspections = rawInspections || [];

  const liveAssets = inspections.flatMap((insp) => [
    {
      id: `${insp.id}-vid`,
      name: insp.videoName || `${insp.id}_source_footage.mp4`,
      type: 'video',
      inspectionId: insp.id,
      notes: `${insp.totalDetections} YOLOv8-verified defect snapshot(s) archived (${insp.criticalCount} critical).`,
      status: 'archived',
    },
    {
      id: `${insp.id}-rpt`,
      name: `HRT_Inspection_Report_${insp.id}.pdf`,
      type: 'pdf',
      inspectionId: insp.id,
      notes: `Live audit telemetry linked to MongoDB Atlas (${insp.date}).`,
      status: 'ready',
    },
  ]);

  return (
    <div className="sp-page">
      <h1 className="sp-title">Assets</h1>
      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)' }}>
        Archived inspection media, extracted defect frame packs, and generated engineering reports.
      </p>

      {loading && (
        <div className="sp-loading" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '40px' }}>
          <Loader2 size={22} className="sp-dl-btn__spin" style={{ color: 'var(--teal)' }} />
          <span>Loading asset registry…</span>
        </div>
      )}

      {!loading && liveAssets.length === 0 && (
        <div
          style={{
            background: 'var(--db-surface)',
            border: '1px dashed var(--db-border)',
            borderRadius: 'var(--radius-md)',
            padding: '56px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            color: 'var(--db-ink-2)',
            marginTop: '16px',
          }}
        >
          <HardDrive size={36} style={{ color: 'var(--db-ink-3)' }} />
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--db-ink)' }}>No uploaded assets yet</p>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', maxWidth: '420px' }}>
            Upload a video in New Inspection to archive real defect frame captures and engineering reports here.
          </p>
          <button className="db-btn-primary" onClick={() => navigate('/inspection/new')}>
            Launch Inspection
          </button>
        </div>
      )}

      {!loading && liveAssets.length > 0 && (
        <div className="sp-assets-grid">
          {liveAssets.map((a) => (
            <div key={a.id} className="sp-asset-card">
              <div className="sp-asset-card__icon" aria-hidden="true">
                {a.type === 'video' ? '▶' : '📄'}
              </div>
              <p className="sp-asset-card__name">{a.name}</p>
              <p className="sp-asset-card__meta">
                {a.type.toUpperCase()} · {a.inspectionId}
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--db-ink-3)', lineHeight: 1.5 }}>
                {a.notes}
              </p>
              <span className={`sp-asset-card__status sp-asset-card__status--${a.status}`}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
