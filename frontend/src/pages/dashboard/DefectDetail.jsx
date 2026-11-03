import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Flag, MessageSquare, ArrowLeft, ExternalLink, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { DETECTIONS } from '../../data/mockData';
import { generateReport } from '../../hooks/useApi';
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
  const [exportState, setExportState] = useState('idle'); // idle | loading | done | error
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
              <MetaRow label="Location (Chainage)" value={typeof chainage === 'number' ? `${chainage.toFixed(2)} km` : (chainage || '—')} />
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
              to="/tunnel-twin"
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
