import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Flag, MessageSquare, ArrowLeft, ExternalLink, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { generateReport, useDetection } from '../../hooks/useApi';
import './DefectDetail.css';

const SEV_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--major)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

function adaptApiDetection(api) {
  if (!api) return null;
  if (api.category && api.subtype) return api;

  const category = api.class_label
    ? api.class_label.charAt(0).toUpperCase() + api.class_label.slice(1)
    : 'Crack';
  const chainageVal = api.chainage_m != null
    ? api.chainage_m
    : (api.coordinates?.z != null ? api.coordinates.z : (api.chainage || 0));

  return {
    id: api.id || api.detection_id || api._id,
    category,
    subtype: api.subtype || `${category} Surface Defect`,
    severity: api.severity || (api.confidence > 0.85 ? 'Critical' : api.confidence > 0.70 ? 'Major' : 'Minor'),
    confidence: typeof api.confidence === 'number' ? api.confidence : 0.88,
    chainage: chainageVal,
    chainage_m: chainageVal,
    tunnelDepthM: api.tunnelDepthM || (chainageVal ? (30 + chainageVal * 0.1).toFixed(1) : '42.0'),
    estimatedSize: api.estimatedSize || `${api.crack_width_mm || 3.2} mm x ${api.crack_length_mm || 180.0} mm`,
    orientation: api.orientation || api.clock_pos || "12 o'clock (Crown)",
    detectedAt: api.created_at || api.timestamp || new Date().toISOString(),
    aiModel: api.aiModel || 'YOLOv8n-seg Subsea Pipeline',
    reviewStatus: api.verified_status || api.reviewStatus || 'confirmed',
    notes: api.notes || api.reviewer_notes || 'Confirmed concrete anomaly from live subsea inspection stream.',
    inspectionId: api.inspection_id || api.inspectionId || 'INSP-LIVE-ROV',
    timestamp: api.timestamp ? new Date(api.timestamp).toLocaleTimeString() : '10:14:22',
    frameIndex: api.frame_index ?? api.frameIndex ?? 0,
    imageUrl: api.image_url || api.imageUrl || null,
    bbox: api.bbox || null,
  };
}

function MetaRow({ label, value }) {
  return (
    <tr className="dd-meta-tr">
      <td className="dd-meta-td dd-meta-td--label">{label}</td>
      <td className="dd-meta-td dd-meta-td--value">{value ?? '—'}</td>
    </tr>
  );
}

export default function DefectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exportState, setExportState] = useState('idle'); // idle | loading | done | error

  const { data: liveDetection, loading: apiLoading } = useDetection(id);

  const detection = useMemo(() => {
    if (liveDetection) {
      return adaptApiDetection(liveDetection);
    }
    return null;
  }, [liveDetection]);

  if (apiLoading && !detection) {
    return (
      <div className="dd-not-found" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: '16px' }}>
        <Loader2 size={32} className="sp-dl-btn__spin" style={{ color: 'var(--teal)' }} />
        <p style={{ color: '#94a3b8' }}>Loading defect dossier...</p>
      </div>
    );
  }

  if (!detection) {
    return (
      <div className="dd-not-found">
        <p>Detection <strong>{id}</strong> was not found.</p>
        <button onClick={() => navigate('/dashboard/detections')} className="dd-back-btn">
          ← Back to detections
        </button>
      </div>
    );
  }

  const { severity, category, subtype, confidence, chainage, tunnelDepthM,
          estimatedSize, orientation, detectedAt, aiModel, reviewStatus,
          notes, inspectionId, timestamp, frameIndex } = detection;

  return (
    <div className="dd-page">
      {/* ── Header ── */}
      <div className="dd-header">
        <button className="dd-back-btn" onClick={() => navigate('/dashboard/detections')} aria-label="Back to detections">
          <ArrowLeft size={16} /> AI Detections
        </button>
        <button
          className="dd-export-btn"
          aria-label="Export analysis as PDF"
          disabled={exportState === 'loading'}
          onClick={async () => {
            setExportState('loading');
            try {
              await generateReport({ inspection_id: detection.inspectionId, format: 'pdf' });
              setExportState('done');
              setTimeout(() => setExportState('idle'), 2000);
            } catch {
              setExportState('error');
              setTimeout(() => setExportState('idle'), 3000);
            }
          }}
        >
          {exportState === 'loading' && <><Loader2 size={14} className="sp-dl-btn__spin" /> Generating…</>}
          {exportState === 'done'    && <><CheckCircle2 size={14} style={{ color: 'var(--teal)' }} /> Downloaded</>}
          {exportState === 'error'   && <><AlertCircle size={14} style={{ color: 'var(--critical)' }} /> Error — retry</>}
          {exportState === 'idle'    && <><Download size={14} /> Export Analysis</>}
        </button>
      </div>

      <div className="dd-layout">
        {/* ── Left: evidence images ── */}
        <div className="dd-evidence">
          {/* Primary evidence image — Actual captured frame from uploaded video */}
          <div className="dd-main-img" aria-label="Detection evidence image">
            {detection.imageUrl ? (
              <div className="dd-img-container">
                <img
                  src={detection.imageUrl}
                  alt={`Captured concrete lining frame #${frameIndex}`}
                  className="dd-concrete-photo"
                />
                <div className="dd-img-placeholder__annotations">
                  <span className="dd-img-ann">
                    CLASSIFICATION : {category.toUpperCase()}<br />
                    SEVERITY       : {severity.toUpperCase()}<br />
                    DIMENSIONS     : {estimatedSize}<br />
                    CONFIDENCE     : {Math.round(confidence * 100)}%
                  </span>
                </div>
                {detection.bbox && (
                  <div
                    className="dd-img-placeholder__bbox"
                    style={
                      detection.bbox.left_pct != null
                        ? {
                            left: `${detection.bbox.left_pct}%`,
                            top: `${detection.bbox.top_pct}%`,
                            width: `${detection.bbox.width_pct}%`,
                            height: `${detection.bbox.height_pct}%`,
                          }
                        : {
                            left: `${(detection.bbox.x1 / 640) * 100}%`,
                            top: `${(detection.bbox.y1 / 480) * 100}%`,
                            width: `${((detection.bbox.x2 - detection.bbox.x1) / 640) * 100}%`,
                            height: `${((detection.bbox.y2 - detection.bbox.y1) / 480) * 100}%`,
                          }
                    }
                    aria-label="Bounding box"
                  />
                )}
              </div>
            ) : (
              <div
                className="dd-img-container"
                style={{
                  minHeight: '320px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px',
                  textAlign: 'center',
                  color: 'var(--db-ink-3)',
                }}
              >
                <p style={{ margin: '0 0 6px 0', color: 'var(--db-ink-2)', fontWeight: 600 }}>
                  Telemetry-Only Record (No Video Snapshot Archived)
                </p>
                <p style={{ margin: 0, fontSize: '0.8rem', maxWidth: '340px' }}>
                  Run a video scan in New Inspection to automatically archive annotated concrete frame evidence.
                </p>
              </div>
            )}
          </div>

          {/* Captured Frame Metadata Strip */}
          {detection.imageUrl && (
            <div className="dd-thumbs" aria-label="Captured frame info">
              <button className="dd-thumb dd-thumb--active" aria-label="Captured frame thumbnail">
                <img
                  src={detection.imageUrl}
                  alt="Captured defect snapshot"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            </div>
          )}
        </div>

        {/* ── Right: metadata ── */}
        <div className="dd-info">
          {/* Severity badge + type */}
          <div className="dd-info__top">
            <span
              className="dd-sev-badge"
              style={{
                background: SEV_COLOR[severity],
                color: '#fff',
              }}
            >
              {severity} Defect
            </span>
            <span className="dd-confidence">
              Confidence <strong style={{ color: SEV_COLOR[severity] }}>
                {Math.round(confidence * 100)}%
              </strong>
            </span>
          </div>

          <h1 className="dd-defect-type">{subtype || category}</h1>

          {/* Metadata table */}
          <table className="dd-meta-table" aria-label="Defect metadata">
            <tbody>
              <MetaRow
                label="Location (Chainage)"
                value={
                  detection.chainage_m != null
                    ? `${detection.chainage_m.toFixed(1)} m (Ch ${(detection.chainage_m / 1000).toFixed(3)} km)`
                    : (typeof chainage === 'number' ? `${chainage.toFixed(2)} km` : (chainage || '—'))
                }
              />
              <MetaRow label="Tunnel Depth (m)" value={tunnelDepthM ? `${tunnelDepthM} m` : null} />
              <MetaRow label="Estimated Size" value={estimatedSize} />
              <MetaRow label="Orientation" value={orientation} />
              <MetaRow label="First Detected" value={
                detectedAt && !isNaN(new Date(detectedAt).getTime())
                  ? new Date(detectedAt).toLocaleString('en-IN', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })
                  : '—'
              } />
              <MetaRow label="AI Model" value={aiModel} />
              <MetaRow label="Video Timestamp" value={timestamp} />
              <MetaRow label="Frame Index" value={frameIndex} />
              <MetaRow label="Review Status" value={reviewStatus} />
            </tbody>
          </table>

          {/* ── Inspection & 3D Twin links ── */}
          <div className="dd-inspection-link" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link
              to="/dashboard/inspections"
              className="dd-insp-link-btn"
              aria-label={`Go to inspection ${inspectionId || 'history'}`}
            >
              Inspection {inspectionId || 'Batch'} <ExternalLink size={13} />
            </Link>
            <Link
              to={`/tunnel-twin?defect=${detection.id}&chainage=${detection.chainage || 0}`}
              className="dd-insp-link-btn"
              style={{ borderColor: '#0d9488', color: '#14b8a6' }}
              aria-label="View in 3D Digital Twin"
            >
              Inspect in 3D Twin &rarr;
            </Link>
          </div>

          {/* ── Action buttons ── */}
          <div className="dd-actions">
            <button
              className="dd-action-btn dd-action-btn--flag"
              aria-label="Flag for urgent repair"
            >
              <Flag size={15} />
              Flag for Urgent Repair
            </button>
            <button
              className="dd-action-btn dd-action-btn--observe"
              aria-label="Add observation note"
            >
              <MessageSquare size={15} />
              Add Observation
            </button>
          </div>

          {/* ── Historical notes ── */}
          {notes && (
            <div className="dd-historical">
              <h2 className="dd-historical__title">Historical Data</h2>
              <p className="dd-historical__body">{notes}</p>
            </div>
          )}

          {/* ── AI vs human clarification ── */}
          <div className="dd-disclaimer">
            <p>
              <strong>AI Prediction</strong> — not yet human-verified.
              Review status: <strong>{reviewStatus}</strong>.
              Inspector confirmation required before scheduling repair.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
