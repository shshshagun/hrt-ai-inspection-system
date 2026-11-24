import { lazy, Suspense, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Flag, MessageSquare, ArrowLeft, ExternalLink, Download, Loader2, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { generateReport, useDetection, useDetections, deleteDetectionLog, reviewDetection } from '../../hooks/useApi';
import { useAuth } from '../../auth/useAuth';
import { PERMISSIONS } from '../../auth/permissions';
import { useToast } from '../../ui/contexts';
import { REJECT_REASONS, countsAsCrack, reviewState } from '../../utils/crackVerdict';
import DefectHistory from '../../components/insight/DefectHistory';
import Skeleton from '../../ui/Skeleton';

const MiniTwin = lazy(() => import('../../components/insight/MiniTwin'));
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
    flagged: Boolean(api.flagged_urgent),
    flaggedBy: api.flagged_by || null,
    observations: Array.isArray(api.observations) ? api.observations : [],
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

const REASON_LABEL = { shadow: 'Shadow', stain: 'Stain or water streak', ring_joint: 'Ring joint or seam', debris: 'Debris', texture: 'Concrete texture', other: 'Something else' };
const VERDICT_WHY = { texture_heuristic: 'texture check, not a trained model', low_confidence: 'low confidence', blob_shape: 'blob-shaped, not thin', too_small: 'very small', compact_box: 'compact box', few_frames: 'seen in few frames', classifier_not_crack: 'the crack checker says no', classifier_unsure: 'the crack checker is not sure', classifier_unavailable: 'the crack checker could not load', low_score: 'the checks together fall just short' };

export default function DefectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exportState, setExportState] = useState('idle'); // idle | loading | done | error
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { can } = useAuth();
  const toast = useToast();
  const canReview = can(PERMISSIONS.DETECTIONS_REVIEW);
  const [review, setReview] = useState(null);       // latest server copy after a flag / note
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [rejectReason, setRejectReason] = useState('shadow');
  const [saving, setSaving] = useState(false);
  const [natural, setNatural] = useState(null); // real pixel size of the snapshot, for pixel-based boxes

  const { data: liveDetection, loading: apiLoading } = useDetection(id);
  const { data: allDetections } = useDetections();

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

  // `detection` may be a raw API record or one already normalised by useApi, so read both spellings.
  const source = review || detection;
  const flagged = Boolean(source.flagged_urgent ?? source.flagged);
  const flaggedBy = source.flagged_by ?? source.flaggedBy ?? null;
  const observations = Array.isArray(source.observations) ? source.observations : [];

  async function send(body, okMessage) {
    setSaving(true);
    try {
      setReview(await reviewDetection(detection.id, body));
      toast.success(okMessage);
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not save the change');
      return false;
    } finally {
      setSaving(false);
    }
  }
  const toggleFlag = () => send({ flagged: !flagged }, flagged ? 'Urgent flag removed.' : 'Flagged for urgent repair.');
  async function saveNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    if (await send({ observation: noteText.trim() }, 'Observation added.')) { setNoteText(''); setNoteOpen(false); }
  }

  // Boxes are stored either as percentages of the frame, or as x1..y2 (normalised 0..1, or pixels of the snapshot).
  const bb = detection.bbox;
  let boxStyle = null;
  if (bb && bb.left_pct != null) {
    boxStyle = { left: `${bb.left_pct}%`, top: `${bb.top_pct}%`, width: `${bb.width_pct}%`, height: `${bb.height_pct}%` };
  } else if (bb && bb.x2 != null) {
    const norm = Math.max(bb.x1, bb.y1, bb.x2, bb.y2) <= 1;
    const w = norm ? 1 : natural?.w;
    const h = norm ? 1 : natural?.h;
    if (w && h) boxStyle = { left: `${(bb.x1 / w) * 100}%`, top: `${(bb.y1 / h) * 100}%`, width: `${((bb.x2 - bb.x1) / w) * 100}%`, height: `${((bb.y2 - bb.y1) / h) * 100}%` };
  }

  const { severity, category, subtype, confidence, chainage, tunnelDepthM,
          estimatedSize, orientation, detectedAt, aiModel, reviewStatus,
          notes, inspectionId, timestamp, frameIndex } = detection;

  return (
    <div className="dd-page">
      {/* ── Header ── */}
      <div className="dd-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <button className="dd-back-btn" onClick={() => navigate('/dashboard/detections')} aria-label="Back to detections">
          <ArrowLeft size={16} /> AI Detections
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              style={{
                background: '#111318',
                border: '1px solid #1f2530',
                color: '#94a3b8',
                padding: '8px 12px',
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
            disabled={deleting}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setDeleting(true);
              try {
                await deleteDetectionLog(detection.id);
                navigate('/dashboard/detections');
              } catch {
                setDeleting(false);
                setConfirmDelete(false);
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: confirmDelete ? '#ef4444' : '#1a1114',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: confirmDelete ? '#ffffff' : '#f87171',
              padding: '8px 14px',
              borderRadius: '4px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            aria-label="Delete defect log"
          >
            {deleting ? <Loader2 size={14} className="sp-dl-btn__spin" /> : <Trash2 size={14} />}
            {confirmDelete ? 'Confirm Delete Log' : 'Delete Log'}
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
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                <div className="dd-img-placeholder__annotations">
                  <span className="dd-img-ann">
                    CLASSIFICATION : {category.toUpperCase()}<br />
                    SEVERITY       : {severity.toUpperCase()}<br />
                    DIMENSIONS     : {estimatedSize}<br />
                    CONFIDENCE     : {Math.round(confidence * 100)}%
                  </span>
                </div>
                {boxStyle && (
                  <div className="dd-img-placeholder__bbox" style={boxStyle} aria-label="Bounding box" />
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

          {/* Where the defect sits in the tunnel */}
          <section className="dd-where" aria-label="Where this defect sits">
            <h2 className="dd-historical__title">Where it sits</h2>
            <Suspense fallback={<Skeleton height={240} />}>
              <MiniTwin chainage={Number(chainage) || 0} defects={allDetections ?? []} focusId={detection.id} height={240} />
            </Suspense>
            <p className="dd-where__caption">Chainage {Number(chainage || 0).toFixed(1)} m, {orientation}. Brighter ring is this defect; the others are in the same tunnel.</p>
          </section>

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
              type="button"
              className={`dd-action-btn dd-action-btn--flag${flagged ? ' is-on' : ''}`}
              aria-pressed={flagged}
              disabled={!canReview || saving}
              title={canReview ? undefined : 'Engineers and administrators can flag defects'}
              onClick={toggleFlag}
            >
              <Flag size={15} />
              {flagged ? 'Flagged: urgent repair' : 'Flag for Urgent Repair'}
            </button>
            <button
              type="button"
              className="dd-action-btn dd-action-btn--observe"
              aria-expanded={noteOpen}
              disabled={!canReview}
              title={canReview ? undefined : 'Engineers and administrators can add observations'}
              onClick={() => setNoteOpen((o) => !o)}
            >
              <MessageSquare size={15} />
              Add Observation
            </button>
          </div>
          {!canReview && <p className="dd-readonly-note">Your role can view this defect but not change it.</p>}
          {flagged && <p className="dd-flag-note">Marked urgent{flaggedBy ? ` by ${flaggedBy}` : ''}.</p>}

          {noteOpen && (
            <form className="dd-note-form" onSubmit={saveNote}>
              <label htmlFor="dd-note">Observation</label>
              <textarea id="dd-note" rows={3} maxLength={1000} autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="What did you see on site?" />
              <div className="dd-note-form__row">
                <button type="button" className="dd-back-btn" onClick={() => setNoteOpen(false)}>Cancel</button>
                <button type="submit" className="dd-action-btn dd-action-btn--flag" disabled={saving || !noteText.trim()}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          )}

          {observations.length > 0 && (
            <ul className="dd-observations" aria-label="Observations">
              {observations.map((o, i) => (
                <li key={`${o.at}-${i}`}><p>{o.text}</p><small>{o.by} · {new Date(o.at).toLocaleString()}</small></li>
              ))}
            </ul>
          )}

          {/* ── Is it a crack? (the review decision behind every count) ── */}
          <section className="dd-verdict" aria-label="Is this a crack?">
            <h2 className="dd-historical__title">Is this a crack?</h2>
            <p className="dd-verdict__state">
              {reviewState(source) === 'confirmed' ? 'An engineer confirmed it as a crack.'
                : reviewState(source) === 'rejected' ? `An engineer rejected it${source.reject_reason ? ` (${REASON_LABEL[source.reject_reason] || source.reject_reason})` : ''}. It does not count.`
                  : countsAsCrack(source) ? 'The system judged this to be a crack. It counts until an engineer reviews it.'
                    : `The system is not sure this is a crack, so it does not count yet${source.verdict_reason?.length ? ` (${source.verdict_reason.map((r) => VERDICT_WHY[r] || r).join(', ')})` : ''}.`}
            </p>
            {canReview ? (
              <div className="dd-verdict__row">
                <button type="button" className="dd-action-btn dd-action-btn--observe" disabled={saving} onClick={() => send({ review_status: 'confirmed' }, 'Confirmed as a crack.')}>Confirm: it is a crack</button>
                <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} aria-label="Why it is not a crack">
                  {REJECT_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                </select>
                <button type="button" className="dd-action-btn dd-action-btn--flag" disabled={saving} onClick={() => send({ review_status: 'rejected', reject_reason: rejectReason }, 'Rejected: not a crack.')}>Not a crack</button>
                {reviewState(source) !== 'pending' && <button type="button" className="dd-verdict__undo" disabled={saving} onClick={() => send({ review_status: 'pending' }, 'Sent back to review.')}>Undo</button>}
              </div>
            ) : <p className="dd-readonly-note">Engineers and administrators can review this detection.</p>}
          </section>

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

      <DefectHistory detections={allDetections ?? []} currentId={detection.id} />
    </div>
  );
}
