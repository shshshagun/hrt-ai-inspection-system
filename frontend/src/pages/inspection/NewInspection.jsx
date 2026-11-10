/**
 * NewInspection.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Video upload + live AI detection page.
 * Uses SSE (Server-Sent Events) from FastAPI inference_api to stream results.
 * Falls back to simulated detections when the inference server is unavailable.
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Film, X, Play, AlertTriangle, CheckCircle,
  Download, Zap, StopCircle, Info
} from 'lucide-react';
import './NewInspection.css';

/* ── Config ── */
const INFER_API = import.meta.env.VITE_INFER_API_URL || 'http://localhost:8000';

const SEVERITY_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--amber)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

const DEFECT_CLASS_SEVERITY = {
  crack:    'Critical',
  spalling: 'Major',
  leakage:  'Major',
  erosion:  'Minor',
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSeverityClass(severity) {
  return severity?.toLowerCase() || 'info';
}

function getSeverityColor(severity) {
  return SEVERITY_COLOR[severity] || 'var(--info)';
}

/* ── Simulated demo detections for when inference server is offline ── */
function* simulatedDetections(totalFrames = 300) {
  const classes = ['crack', 'spalling', 'leakage', 'erosion'];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const frame = Math.floor((i / count) * totalFrames);
    const cls   = classes[i % classes.length];
    yield {
      class:       cls,
      confidence:  Math.round((0.72 + Math.random() * 0.25) * 100) / 100,
      severity:    DEFECT_CLASS_SEVERITY[cls],
      frame_index: frame,
      chainage_z:  parseFloat((frame / totalFrames * 27.3).toFixed(2)),
      clock_pos:   `${Math.floor(Math.random() * 12) + 1} o'clock`,
      width_mm:    Math.round(50 + Math.random() * 400),
      height_mm:   Math.round(10 + Math.random() * 100),
    };
  }
}

/* ── DefectCard ── */
function DefectCard({ det, index }) {
  const sevClass = getSeverityClass(det.severity);
  const sevColor = getSeverityColor(det.severity);

  return (
    <article
      className={`ni-defect-card ni-defect-card--${sevClass}`}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="ni-defect-card__sev">
        <div className="ni-defect-card__sev-dot" style={{ background: sevColor }} />
        <span className="ni-defect-card__sev-label" style={{ color: sevColor }}>
          {det.severity}
        </span>
      </div>

      <div className="ni-defect-card__body">
        <p className="ni-defect-card__type">
          {(det.class || det.category || 'Unknown').replace(/\b\w/g, c => c.toUpperCase())}
        </p>
        <div className="ni-defect-card__meta">
          <span className="ni-defect-card__meta-item">
            Frame <span>#{det.frame_index}</span>
          </span>
          {det.chainage_z != null && (
            <span className="ni-defect-card__meta-item">
              Z <span>{det.chainage_z.toFixed(2)} m</span>
            </span>
          )}
          {det.clock_pos && (
            <span className="ni-defect-card__meta-item">
              <span>{det.clock_pos}</span>
            </span>
          )}
          {det.width_mm != null && (
            <span className="ni-defect-card__meta-item">
              <span>{det.width_mm}×{det.height_mm} mm</span>
            </span>
          )}
        </div>
      </div>

      <span className="ni-defect-card__conf">
        {Math.round((det.confidence || 0) * 100)}%
      </span>
    </article>
  );
}

/* ── Main component ── */
export default function NewInspection() {
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | processing | done | error
  const [detections, setDetections] = useState([]);
  const [progress, setProgress] = useState(0);       // 0–100
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef(null);
  const sseRef = useRef(null);
  const simTimerRef = useRef(null);

  /* ── File selection ── */
  const handleFile = useCallback((f) => {
    if (!f) return;
    if (!f.type.startsWith('video/') && !f.name.match(/\.(mp4|mov|avi|mkv|webm)$/i)) {
      setErrorMsg('Please select a valid video file (MP4, MOV, AVI, MKV, WEBM).');
      return;
    }
    setFile(f);
    setErrorMsg('');
    setDetections([]);
    setStatus('idle');
    setProgress(0);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  /* ── Stop processing ── */
  const stopProcessing = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (simTimerRef.current) {
      clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    }
    setStatus('done');
  }, []);

  /* ── Run simulated detection (server offline fallback) ── */
  const runSimulated = useCallback((totalF) => {
    const simDets = [...simulatedDetections(totalF)];
    let idx = 0;

    function step() {
      if (idx >= simDets.length) {
        setProgress(100);
        setStatus('done');
        return;
      }
      const det = simDets[idx];
      const pct  = Math.round(((idx + 1) / simDets.length) * 100);
      const frame = det.frame_index;

      setDetections(prev => [det, ...prev]);
      setCurrentFrame(frame);
      setProgress(pct);
      idx++;

      simTimerRef.current = setTimeout(step, 480);
    }

    setTotalFrames(totalF);
    step();
  }, []);

  /* ── Open SSE stream for live detection ── */
  const openStream = useCallback((jid, totalF) => {
    const url = `${INFER_API}/infer/stream/${jid}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.type === 'progress') {
          setCurrentFrame(data.frame_index);
          setTotalFrames(data.total_frames ?? totalF);
          setProgress(Math.round((data.frame_index / (data.total_frames || totalF)) * 100));
        } else if (data.type === 'detection') {
          setDetections(prev => [data, ...prev]);
        } else if (data.type === 'done') {
          es.close();
          sseRef.current = null;
          setProgress(100);
          setStatus('done');
        } else if (data.type === 'error') {
          setErrorMsg(data.message || 'Inference error.');
          setStatus('error');
          es.close();
        }
      } catch {/* non-JSON frame, ignore */}
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
      // Fall back to simulated
      setStatus('processing');
      runSimulated(totalF || 300);
    };
  }, [runSimulated]);

  /* ── Upload + start inference ── */
  const handleStart = useCallback(async () => {
    if (!file) return;
    setStatus('uploading');
    setDetections([]);
    setProgress(0);
    setErrorMsg('');

    const formData = new FormData();
    formData.append('video', file);

    try {
      const res = await fetch(`${INFER_API}/infer`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json = await res.json();
      const jid   = json.job_id;
      const totalF = json.total_frames || 300;

      setJobId(jid);
      setStatus('processing');
      openStream(jid, totalF);
    } catch (err) {
      // Inference server not running — run simulation
      console.warn('Inference API unavailable, running simulated detection:', err);
      setStatus('processing');
      setJobId('demo-' + Date.now());
      runSimulated(300);
    }
  }, [file, openStream, runSimulated]);

  /* ── Download report ── */
  const handleDownloadReport = useCallback(() => {
    const report = {
      inspectionId: jobId || 'demo',
      generatedAt:  new Date().toISOString(),
      videoFile:    file?.name || 'unknown',
      totalDetections: detections.length,
      detections: detections.map(d => ({
        class:      d.class || d.category,
        severity:   d.severity,
        confidence: d.confidence,
        frame:      d.frame_index,
        chainage:   d.chainage_z,
        location:   d.clock_pos,
        dimensions: d.width_mm && d.height_mm ? `${d.width_mm}×${d.height_mm} mm` : null,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `hrt-inspection-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [detections, file, jobId]);

  const isProcessing = status === 'uploading' || status === 'processing';
  const isDone       = status === 'done';
  const hasFile      = Boolean(file);
  const [todayStr]   = useState(() =>
    new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  );

  return (
    <div className="ni-root">
      {/* ── Header ── */}
      <header className="ni-header">
        <p className="ni-header__eyebrow">AI Pipeline</p>
        <h1 className="ni-header__title">New Inspection</h1>
        <p className="ni-header__sub">
          Upload an MP4 video to run live YOLOv8 defect detection and generate an inspection report.
        </p>
      </header>

      {/* ── Info note ── */}
      <div className="ni-note">
        <Info size={14} className="ni-note__icon" />
        <span>
          Requires the FastAPI inference server at <code>{INFER_API}</code>.
          If unavailable, a simulated demo run will execute automatically with mock detections.
        </span>
      </div>

      {/* ── Upload zone ── */}
      {!hasFile && !isProcessing && !isDone && (
        <div
          className={`ni-upload-zone${dragging ? ' ni-upload-zone--dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop or click to select a video file"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          <Upload size={40} className="ni-upload-zone__icon" />
          <p className="ni-upload-zone__title">
            {dragging ? 'Drop to upload' : 'Drag & drop your inspection video'}
          </p>
          <p className="ni-upload-zone__sub">MP4, MOV, AVI, MKV, WEBM · Any size</p>
          <button className="ni-upload-zone__btn" type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            Browse Files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.mov,.avi,.mkv,.webm"
            className="ni-upload-zone__input"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {/* ── File selected ── */}
      {hasFile && !isProcessing && !isDone && (
        <>
          <div className="ni-file-info">
            <Film size={18} className="ni-file-info__icon" />
            <div className="ni-file-info__details">
              <p className="ni-file-info__name">{file.name}</p>
              <p className="ni-file-info__meta">{formatBytes(file.size)} · {file.type || 'video'}</p>
            </div>
            <button
              className="ni-file-info__clear"
              onClick={() => { setFile(null); setDetections([]); setStatus('idle'); setProgress(0); }}
              aria-label="Remove selected file"
            >
              <X size={16} />
            </button>
          </div>

          {errorMsg && (
            <div className="ni-note">
              <AlertTriangle size={14} className="ni-note__icon" style={{ color: 'var(--critical)' }} />
              <span style={{ color: 'var(--ink)' }}>{errorMsg}</span>
            </div>
          )}

          <button className="ni-start-btn" onClick={handleStart}>
            <Play size={18} />
            Start AI Inspection
          </button>
        </>
      )}

      {/* ── Progress ── */}
      {isProcessing && (
        <section className="ni-progress-section">
          <div className="ni-progress-section__header">
            <span className="ni-progress-label">
              {status === 'uploading' ? 'Uploading video...' : 'Processing frames...'}
            </span>
            <span className="ni-progress-pct">{progress}%</span>
          </div>
          <div className="ni-progress-bar">
            <div className="ni-progress-bar__fill" style={{ width: `${progress}%` }} />
          </div>
          {totalFrames > 0 && (
            <p className="ni-progress-frame">
              Frame {currentFrame.toLocaleString()} / {totalFrames.toLocaleString()}
              {' · '}{detections.length} detection{detections.length !== 1 ? 's' : ''} so far
            </p>
          )}
          <button
            className="ni-btn-outline"
            onClick={stopProcessing}
            style={{ alignSelf: 'flex-start', marginTop: 'var(--space-1)' }}
          >
            <StopCircle size={14} />
            Stop
          </button>
        </section>
      )}

      {/* ── Live detection feed ── */}
      {(isProcessing || isDone) && (
        <section className="ni-feed">
          <div className="ni-feed__header">
            {isProcessing && <span className="ni-live-dot" aria-hidden="true" />}
            {isDone && <CheckCircle size={14} style={{ color: 'var(--cyan)' }} />}
            <span className="ni-feed__title">
              {isProcessing ? 'Live Detection Feed' : 'Inspection Complete'}
            </span>
            <span className="ni-feed__count">{detections.length} defect{detections.length !== 1 ? 's' : ''}</span>
            {isDone && (
              <span className="ni-complete-badge">
                <CheckCircle size={10} /> Done
              </span>
            )}
          </div>

          {detections.length === 0 && isProcessing && (
            <div className="ni-empty">
              <Zap size={24} style={{ color: 'var(--ink-3)' }} />
              <p className="ni-empty__title">Waiting for first detection...</p>
            </div>
          )}

          {detections.length > 0 && (
            <div className="ni-detection-list">
              {detections.map((det, i) => (
                <DefectCard key={`${det.frame_index}-${i}`} det={det} index={i} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Report download ── */}
      {isDone && detections.length > 0 && (
        <section className="ni-report-section">
          <div className="ni-report-section__info">
            <p className="ni-report-section__title">Inspection Report Ready</p>
            <p className="ni-report-section__sub">
              {detections.length} defect{detections.length !== 1 ? 's' : ''} detected
              {file ? ` in ${file.name}` : ''} · {todayStr}
            </p>
          </div>
          <div className="ni-report-section__actions">
            <button className="ni-btn-outline" onClick={() => navigate('/dashboard/detections')}>
              <Zap size={14} />
              View Detections
            </button>
            <button className="ni-btn-download" onClick={handleDownloadReport}>
              <Download size={14} />
              Download Report (JSON)
            </button>
          </div>
        </section>
      )}

      {/* ── Error state ── */}
      {status === 'error' && errorMsg && (
        <div className="ni-note" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
          <AlertTriangle size={14} className="ni-note__icon" style={{ color: 'var(--critical)' }} />
          <span>
            <strong style={{ color: 'var(--critical)' }}>Error:</strong> {errorMsg}
          </span>
        </div>
      )}
    </div>
  );
}
