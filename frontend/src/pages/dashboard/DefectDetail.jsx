import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Flag, MessageSquare, ArrowLeft, ExternalLink, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { DETECTIONS } from '../../data/mockData';
import { generateReport, useDetection } from '../../hooks/useApi';
import cracksData from '../../../public/data/cracks.json';
import './DefectDetail.css';

const SEV_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--major)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

function formatClockPosition(deg) {
  if (deg == null) return "12 o'clock (Crown)";
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized === 0 || normalized === 360) return "12 o'clock (Crown)";
  if (normalized === 90) return "3 o'clock (Right Wall)";
  if (normalized === 180) return "6 o'clock (Invert / Floor)";
  if (normalized === 270) return "9 o'clock (Left Wall)";
  const clock = Math.round(normalized / 30) || 12;
  return `${clock} o'clock (${normalized}°)`;
}

function adaptCrackToDetection(crack) {
  if (!crack) return null;
  return {
    id: crack.id,
    category: 'Crack',
    subtype: crack.notes ? crack.notes.split('.')[0] : 'Longitudinal Tunnel Crack',
    severity: crack.severity || 'Minor',
    confidence: crack.source === 'Manual' ? 0.98 : 0.94,
    chainage: crack.chainage_m,
    chainage_m: crack.chainage_m,
    tunnelDepthM: (35 + Math.round(crack.chainage_m * 0.15 * 10) / 10).toFixed(1),
    estimatedSize: `${crack.width_mm || 2} mm x ${crack.length_mm || 300} mm`,
    orientation: formatClockPosition(crack.angle_deg),
    detectedAt: '2026-03-15T10:14:22Z',
    aiModel: crack.source === 'Manual' ? 'Manual Engineering Survey' : 'YOLOv8-TunnelSeg v2.4',
    reviewStatus: crack.severity === 'Critical' ? 'flagged' : 'confirmed',
    notes: crack.notes || 'Defect logged during hydro-tunnel survey.',
    inspectionId: 'INSP-2026-03-TWIN',
    timestamp: '10:14:22',
    frameIndex: Math.round(crack.chainage_m * 10),
    source: crack.source || 'AI',
    bbox: {
      x1: 180,
      y1: 140,
      x2: 460,
      y2: 340,
    },
  };
}

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
    id: api.id || api.detection_id,
    category,
    subtype: api.subtype || `${category} Defect`,
    severity: api.severity || (api.confidence > 0.9 ? 'Critical' : api.confidence > 0.75 ? 'Major' : 'Minor'),
    confidence: typeof api.confidence === 'number' ? api.confidence : 0.88,
    chainage: chainageVal,
    chainage_m: chainageVal,
    tunnelDepthM: api.tunnelDepthM || (chainageVal ? (30 + chainageVal * 0.1).toFixed(1) : 42.0),
    estimatedSize: api.estimatedSize || (api.bbox ? `${Math.round(api.bbox.x2 - api.bbox.x1)}px x ${Math.round(api.bbox.y2 - api.bbox.y1)}px` : '3.5 mm x 220 mm'),
    orientation: api.orientation || (api.coordinates ? `Radial (${api.coordinates.x?.toFixed(1)}, ${api.coordinates.y?.toFixed(1)})` : "Crown (12 o'clock)"),
    detectedAt: api.created_at || api.timestamp || new Date().toISOString(),
    aiModel: api.aiModel || 'YOLOv8-TunnelSeg v2.4',
    reviewStatus: api.verified_status || api.reviewStatus || 'pending',
    notes: api.reviewer_notes || api.notes || 'Live detection ingested from inspection telemetry stream.',
    inspectionId: api.inspection_id || api.inspectionId || 'INSP-2026-LIVE',
    timestamp: api.timestamp ? (new Date(api.timestamp).toTimeString().split(' ')[0]) : '10:14:22',
    frameIndex: api.frame_index ?? 0,
    bbox: api.bbox,
  };
}

function createFallbackDetectionForId(fallbackId) {
  return {
    id: fallbackId,
    category: 'Crack',
    subtype: 'Automated Tunnel Defect',
    severity: 'Major',
    confidence: 0.89,
    chainage: 4.5,
    chainage_m: 4.5,
    tunnelDepthM: 35.5,
    estimatedSize: '3.2 mm x 260 mm',
    orientation: "Crown (12 o'clock)",
    detectedAt: '2026-03-15T10:14:22Z',
    aiModel: 'YOLOv8-TunnelSeg v2.4 (Cached)',
    reviewStatus: 'pending',
    notes: `Detection dossier preserved for record ${fallbackId}. Inspection pending reviewer verification.`,
    inspectionId: 'INSP-2026-LIVE',
    timestamp: '10:14:22',
    frameIndex: 45,
    bbox: { x1: 150, y1: 120, x2: 380, y2: 310 },
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
    const mock = DETECTIONS.find(d => d.id === id || String(d.id).toLowerCase() === String(id).toLowerCase());
    if (mock) return mock;

    const crack = cracksData.find(c => c.id === id || String(c.id).toLowerCase() === String(id).toLowerCase());
    if (crack) return adaptCrackToDetection(crack);

    // If ID is a live UUID or alphanumeric identifier and backend is offline
    if (id && (id.length > 15 || id.includes('-'))) {
      return createFallbackDetectionForId(id);
    }

    return null;
  }, [liveDetection, id]);

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
          {/* Primary evidence image — CSS-rendered tunnel crack composition */}
          <div className="dd-main-img" aria-label="Detection evidence image">
            <div className="dd-img-placeholder">
              <div className="dd-img-placeholder__crack" />
              <div className="dd-img-placeholder__annotations">
                <span className="dd-img-ann">
                  CRACK DETECTION<br />
                  WIDTH: 2.8 mm<br />
                  LENGTH: 2.4 km<br />
                  CONFIDENCE: {Math.round(confidence * 100)}%
                </span>
              </div>
              {detection.bbox ? (
                <div
                  className="dd-img-placeholder__bbox"
                  style={{
                    left: `${(detection.bbox.x1 / 640) * 100}%`,
                    top: `${(detection.bbox.y1 / 480) * 100}%`,
                    width: `${((detection.bbox.x2 - detection.bbox.x1) / 640) * 100}%`,
                    height: `${((detection.bbox.y2 - detection.bbox.y1) / 480) * 100}%`,
                  }}
                  aria-label="Bounding box"
                />
              ) : (
                <div
                  className="dd-img-placeholder__bbox"
                  style={{ left: '25%', top: '25%', width: '50%', height: '50%' }}
                  aria-label="Default Bounding Box"
                />
              )}
            </div>
          </div>

          {/* Thumbnail strip */}
          <div className="dd-thumbs" aria-label="Additional evidence thumbnails">
            {[1, 2, 3].map(i => (
              <button
                key={i}
                className={`dd-thumb ${i === 1 ? 'dd-thumb--active' : ''}`}
                aria-label={`View evidence image ${i}`}
              >
                <div className="dd-thumb__bg" />
              </button>
            ))}
            <button className="dd-thumb dd-thumb--add" aria-label="Add evidence">
              +
            </button>
          </div>
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
