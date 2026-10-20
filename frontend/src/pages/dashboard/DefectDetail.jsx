import { useParams, useNavigate, Link } from 'react-router-dom';
import { Flag, MessageSquare, ArrowLeft, ExternalLink } from 'lucide-react';
import { DETECTIONS } from '../../data/mockData';
import './DefectDetail.css';

const SEV_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--major)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

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
  const detection = DETECTIONS.find(d => d.id === id);

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
        <button
          className="dd-back-btn"
          onClick={() => navigate('/dashboard/detections')}
          aria-label="Back to detections"
        >
          <ArrowLeft size={16} /> AI Detections
        </button>
        <button className="dd-export-btn" aria-label="Export analysis (not yet implemented)">
          Export Analysis
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
              <MetaRow label="Location (Chainage)" value={`${chainage.toFixed(2)} km`} />
              <MetaRow label="Tunnel Depth (m)" value={tunnelDepthM ? `${tunnelDepthM} m` : null} />
              <MetaRow label="Estimated Size" value={estimatedSize} />
              <MetaRow label="Orientation" value={orientation} />
              <MetaRow label="First Detected" value={
                new Date(detectedAt).toLocaleString('en-IN', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })
              } />
              <MetaRow label="AI Model" value={aiModel} />
              <MetaRow label="Video Timestamp" value={timestamp} />
              <MetaRow label="Frame Index" value={frameIndex} />
              <MetaRow label="Review Status" value={reviewStatus} />
            </tbody>
          </table>

          {/* ── Inspection link ── */}
          <div className="dd-inspection-link">
            <Link
              to="/dashboard/inspections"
              className="dd-insp-link-btn"
              aria-label={`Go to inspection ${inspectionId}`}
            >
              Inspection {inspectionId} <ExternalLink size={13} />
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
