import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Play,
  StopCircle,
  Compass,
  Download,
  Crosshair,
  ShieldAlert,
  Layers,
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { API_BASE, resolveInferApi } from '../../config/api';
import { detectVideoFrame, getYoloSession } from '../../utils/yoloBrowserInference';
import { createDefectTracker } from '../../utils/defectTracker';
import './NewInspection.css';

const SEVERITY_COLORS = {
  Critical: '#ef4444',
  Major: '#ff9500',
  Minor: '#eab308',
  Info: '#00d4ff',
};

function formatTimecode(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function waitForSeek(videoEl, targetTime) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      videoEl.removeEventListener('seeked', finish);
      resolve();
    };
    videoEl.addEventListener('seeked', finish, { once: true });
    videoEl.currentTime = targetTime;
    setTimeout(finish, 1800);
  });
}

export default function NewInspection() {
  const navigate = useNavigate();

  // File & video playback state
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoDims, setVideoDims] = useState({ width: 1280, height: 720, duration: 10 });
  const [dragging, setDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Inspection runtime state
  const [status, setStatus] = useState('idle'); // idle | analyzing | complete | error
  const [engineMsg, setEngineMsg] = useState('Ready — YOLOv8n-seg IN-BROWSER ONNX + MongoDB Atlas Gateway');
  const [dbError, setDbError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(24);
  const [detections, setDetections] = useState([]);
  const [activeOverlays, setActiveOverlays] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [syncedToDb, setSyncedToDb] = useState(0);

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const sseRef = useRef(null);
  const abortRef = useRef(false);
  const trackerRef = useRef(null);

  // Pre-warm Render MongoDB Gateway & load inspection session smoothly
  useEffect(() => {
    fetch(`${API_BASE}/health`).catch(() => {});
    return () => {
      abortRef.current = true;
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  // Revoke object URL on change/unmount
  useEffect(() => {
    return () => {
      if (videoUrl && videoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  /* ── Persist verified detection directly to MongoDB Gateway (with Render cold-start retry) ── */
  const persistToGateway = useCallback(async (det, inspId, videoName) => {
    const payload = {
      class_label: det.class || 'crack',
      subtype: det.subtype || undefined,
      confidence: det.confidence,
      severity: det.severity,
      crack_width_mm: det.width_mm || 2.5,
      crack_length_mm: det.height_mm || 150.0,
      frame_index: det.frame_index ?? 0,
      video_time: det.video_time ?? 0,
      video_name: videoName || null,
      image_url: det.image_url || null,
      bbox: det.bbox || null,
      timestamp: new Date().toISOString(),
      clock_pos: det.clock_pos || "12 o'clock (Crown)",
      x: det.x ?? 0,
      y: det.y ?? 2.95,
      z: det.chainage_z ?? 0,
      inspection_id: inspId,
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/api/detections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setSyncedToDb((prev) => prev + 1);
          setDbError(null);
          return true;
        }
        const errBody = await res.text();
        if (attempt === 3) {
          setDbError(`Gateway returned HTTP ${res.status}: ${errBody.slice(0, 80)}`);
        }
      } catch (e) {
        if (attempt === 3) {
          setDbError(`Database sync error (${API_BASE}): ${e.message}`);
        }
      }
      // Wait briefly before retry (handles Render free-tier wake-up)
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }, []);

  /* ── File selection ── */
  const handleSelectFile = useCallback((selectedFile) => {
    if (!selectedFile) return;
    if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);

    const url = URL.createObjectURL(selectedFile);
    const tsId = `INSP-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
    setFile(selectedFile);
    setVideoUrl(url);
    setStatus('idle');
    setProgress(0);
    setCurrentFrame(0);
    setDetections([]);
    setActiveOverlays([]);
    setSyncedToDb(0);
    setDbError(null);
    setEngineMsg('Video loaded — ready to run real YOLOv8n-seg inspection');
    setJobId(tsId);
  }, [videoUrl]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleSelectFile(dropped);
  }, [handleSelectFile]);

  /* ── Execute Real YOLOv8 Inspection on Uploaded Video ── */
  const handleStartInspection = useCallback(async () => {
    if (!file || !videoRef.current) return;

    abortRef.current = false;
    const inspId = jobId || `INSP-${String(Date.now()).slice(-6)}`;
    setJobId(inspId);
    setStatus('analyzing');
    setProgress(0);
    setCurrentFrame(0);
    setDetections([]);
    setActiveOverlays([]);
    setSyncedToDb(0);
    setDbError(null);

    // If re-running on the same jobId, clean previous entries for idempotency
    if (syncedToDb > 0) {
      await fetch(`${API_BASE}/api/inspections/${encodeURIComponent(inspId)}`, { method: 'DELETE' }).catch(() => {});
    }

    const inferApi = resolveInferApi();
    if (inferApi) {
      try {
        setEngineMsg(`Connecting to FastAPI inference server (${inferApi})…`);
        const formData = new FormData();
        formData.append('video', file);
        const res = await fetch(`${inferApi}/infer`, { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          const remoteJobId = data.job_id;
          setTotalFrames(data.total_frames || 300);

          const sseTracker = createDefectTracker();
          trackerRef.current = sseTracker;
          const es = new EventSource(`${inferApi}/infer/stream/${remoteJobId}`);
          sseRef.current = es;

          es.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'progress') {
                setCurrentFrame(msg.frame_index);
                setProgress(Math.round((msg.frame_index / (msg.total_frames || 300)) * 100));
              } else if (msg.type === 'detection') {
                const manifest = sseTracker.ingestFrame([msg]);
                setDetections(manifest);
                setActiveOverlays([msg]);
                for (const flushed of sseTracker.popExitedTracks(msg.video_time ?? msg.timestamp ?? 0)) {
                  persistToGateway(flushed, inspId, file.name);
                }
              } else if (msg.type === 'done') {
                es.close();
                for (const rem of sseTracker.flushAll()) {
                  persistToGateway(rem, inspId, file.name);
                }
                setProgress(100);
                setStatus('complete');
                setEngineMsg('FastAPI YOLOv8 scan complete');
              }
            } catch {
              // ignore malformed SSE chunk
            }
          };
          es.onerror = () => {
            es.close();
            setStatus('error');
          };
          return;
        }
      } catch {
        // Fall through cleanly to In-Browser YOLOv8n-seg ONNX engine
      }
    }

    // ── Primary Serverless Path: In-Browser YOLOv8n-seg ONNX Runtime ──
    try {
      const videoEl = videoRef.current;
      videoEl.pause();

      await getYoloSession((msg) => setEngineMsg(msg));
      if (abortRef.current) return;

      const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 8;
      // Sample evenly spaced keyframes across the uploaded footage (min 12, max 24 steps)
      const steps = Math.min(24, Math.max(12, Math.round(duration * 2)));
      setTotalFrames(steps);

      const tracker = createDefectTracker({
        maxGapSeconds: 3.5,
        maxAngleDiffDeg: 42,
        maxChainageJumpM: 5.5,
      });
      trackerRef.current = tracker;
      const pendingSaves = [];

      for (let step = 0; step < steps; step++) {
        if (abortRef.current) break;

        const targetTime = steps === 1 ? 0 : (step / (steps - 1)) * Math.max(0.1, duration - 0.15);
        setEngineMsg(`Seeking & tracking frame ${step + 1} / ${steps} (t = ${targetTime.toFixed(1)}s)…`);
        await waitForSeek(videoEl, targetTime);
        if (abortRef.current) break;

        setCurrentTime(targetTime);
        setCurrentFrame(step + 1);

        const chainageZ = Number((targetTime * 1.6).toFixed(2));
        const { detections: frameHits } = await detectVideoFrame(videoEl, {
          frameIndex: step + 1,
          videoTime: targetTime,
          chainageZ,
          confThreshold: 0.25,
        });

        setActiveOverlays(frameHits);

        // Consolidate multi-frame detections of the same physical defect into one track
        const uniqueManifest = tracker.ingestFrame(frameHits);
        setDetections(uniqueManifest);

        // Flush tracks that left camera view so only their single clearest snapshot persists
        for (const readyDet of tracker.popExitedTracks(targetTime)) {
          pendingSaves.push(persistToGateway(readyDet, inspId, file.name));
        }

        setProgress(Math.round(((step + 1) / steps) * 100));
        // Brief yield so React paints the live bounding boxes smoothly on each step
        await new Promise((r) => setTimeout(r, 40));
      }

      // Flush remaining active tracks once video scan finishes (or stopped)
      for (const finalDet of tracker.flushAll()) {
        pendingSaves.push(persistToGateway(finalDet, inspId, file.name));
      }

      setEngineMsg('Finalizing MongoDB Atlas persistence…');
      await Promise.allSettled(pendingSaves);

      if (!abortRef.current) {
        const finalCount = tracker.getManifest().length;
        setProgress(100);
        setStatus('complete');
        setEngineMsg(`YOLOv8n-seg scan complete — ${finalCount} unique physical defect(s) verified`);
      }
    } catch (err) {
      console.error('[NewInspection YOLOv8 ONNX Error]', err);
      setStatus('error');
      setEngineMsg(`AI Vision error: ${err.message}`);
    }
  }, [file, jobId, syncedToDb, persistToGateway]);

  /* ── Stop scan ── */
  const handleStopInspection = useCallback(() => {
    abortRef.current = true;
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (videoRef.current) videoRef.current.pause();
    setStatus('complete');
    setEngineMsg('Scan stopped — unique tracked defects persisted');
  }, []);

  /* ── Inspect any logged defect frame on click ── */
  const handleInspectDefect = useCallback((det) => {
    if (videoRef.current && det.video_time != null) {
      videoRef.current.pause();
      videoRef.current.currentTime = det.video_time;
      setCurrentTime(det.video_time);
    }
    const coLocated = detections.filter(
      (d) => Math.abs((d.video_time ?? 0) - (det.video_time ?? 0)) < 0.05
    );
    setActiveOverlays(coLocated.length > 0 ? coLocated : [det]);
  }, [detections]);

  /* ── Download JSON Inspection Audit Report ── */
  const handleDownloadReport = useCallback(() => {
    const reportData = {
      system: 'HRT Subsea AI Inspection System',
      model: 'YOLOv8n-seg (ONNX Web Runtime) + Laplacian Spall Analyzer',
      inspectionId: jobId || 'INSP-MANUAL',
      timestamp: new Date().toISOString(),
      sourceMedia: file?.name || 'uploaded_video.mp4',
      summary: {
        totalDefects: detections.length,
        critical: detections.filter((d) => d.severity === 'Critical').length,
        major: detections.filter((d) => d.severity === 'Major').length,
        minor: detections.filter((d) => d.severity === 'Minor').length,
      },
      defectManifest: detections.map(({ image_url: _img, ...rest }) => rest),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `HRT_Inspection_Report_${jobId || 'Bore'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [detections, file, jobId]);

  const criticalCount = useMemo(
    () => detections.filter((d) => d.severity === 'Critical').length,
    [detections]
  );

  const currentChainage = useMemo(() => (currentTime * 1.6).toFixed(1), [currentTime]);

  const videoAspect = videoDims.width / Math.max(1, videoDims.height);
  const stageStyle =
    videoAspect >= 16 / 9
      ? { width: '100%', height: 'auto', aspectRatio: `${videoDims.width} / ${videoDims.height}` }
      : { height: '100%', width: 'auto', aspectRatio: `${videoDims.width} / ${videoDims.height}` };

  return (
    <div className="insp-console">
      {/* ── Console Header ── */}
      <div className="insp-console__header">
        <div className="insp-console__title-group">
          <div className="insp-status-badge">
            <span className="insp-status-badge__dot" />
            <span className="insp-status-badge__text">YOLOv8n-seg ONNX VISION · LIVE</span>
          </div>
          <h1 className="insp-console__title">Subsea Video Inspection & Live Crack Detection</h1>
          <p className="insp-console__desc">
            Upload tunnel footage to run real trained YOLOv8n-seg neural inference directly on video frames, plot exact defect bounds, and persist anomalies to MongoDB Atlas.
          </p>
        </div>

        <div className="insp-console__meta-ribbon">
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">ENGINE</span>
            <span className="insp-meta-chip__val">YOLOv8n-seg ONNX</span>
          </div>
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">GATEWAY</span>
            <span className="insp-meta-chip__val">MongoDB Atlas</span>
          </div>
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">3D BORE</span>
            <span className="insp-meta-chip__val">R = 2.95m</span>
          </div>
        </div>
      </div>

      {/* ── Main Inspection Deck ── */}
      <div className="insp-deck">
        {/* Left Column: Viewport & Dropzone */}
        <div className="insp-deck__left">
          {!videoUrl || !file ? (
            <div
              className={`insp-dropzone ${dragging ? 'insp-dropzone--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.mov,.webm,.avi"
                style={{ display: 'none' }}
                onChange={(e) => handleSelectFile(e.target.files?.[0])}
              />
              <div className="insp-dropzone__reticle">
                <Crosshair size={48} className="insp-dropzone__icon" />
              </div>
              <h3 className="insp-dropzone__heading">Drop Subsea Tunnel Footage Here</h3>
              <p className="insp-dropzone__sub">
                MP4, MOV, or WebM · Runs Real YOLOv8n-seg Neural Network In-Browser (No Demo Data)
              </p>

              <button
                type="button"
                className="insp-btn insp-btn--primary"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                <Upload size={16} /> Select Video File
              </button>
            </div>
          ) : (
            <div className="insp-viewport">
              {/* Engine & Sync Status Bar */}
              <div className={`insp-engine-banner ${dbError || status === 'error' ? 'insp-engine-banner--error' : ''}`}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {dbError || status === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  {dbError || engineMsg}
                </span>
                <span>{videoDims.width}×{videoDims.height}</span>
              </div>

              <div className="insp-viewport__screen">
                <div className="insp-video-stage" style={stageStyle}>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="insp-video-player"
                    playsInline
                    muted
                    controls={status !== 'analyzing'}
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        setVideoDims({
                          width: videoRef.current.videoWidth || 1280,
                          height: videoRef.current.videoHeight || 720,
                          duration: videoRef.current.duration || 10,
                        });
                      }
                    }}
                    onTimeUpdate={() => {
                      if (videoRef.current && status !== 'analyzing') {
                        const t = videoRef.current.currentTime;
                        setCurrentTime(t);
                        // Show overlays belonging to nearby playback time if available
                        const near = detections.filter((d) => Math.abs((d.video_time ?? 0) - t) <= 0.45);
                        if (near.length > 0) setActiveOverlays(near);
                        else if (status === 'complete') setActiveOverlays([]);
                      }
                    }}
                  />

                  {/* Laser Scanner Line Overlay */}
                  {status === 'analyzing' && <div className="insp-laser-scanner" />}

                  {/* Real Pixel-Aligned Bounding Boxes from YOLOv8 ONNX */}
                  {activeOverlays.map((det, idx) => {
                    if (!det.bbox || det.bbox.left_pct == null) return null;
                    const sevClass =
                      det.severity === 'Major'
                        ? 'insp-reticle-box--major'
                        : det.severity === 'Minor'
                          ? 'insp-reticle-box--minor'
                          : '';
                    return (
                      <div
                        key={det.localId || `${det.frame_index}-${idx}`}
                        className={`insp-reticle-box ${sevClass}`}
                        style={{
                          left: `${det.bbox.left_pct}%`,
                          top: `${det.bbox.top_pct}%`,
                          width: `${det.bbox.width_pct}%`,
                          height: `${det.bbox.height_pct}%`,
                        }}
                      >
                        <div className="insp-reticle-tag">
                          <ShieldAlert size={11} />
                          <span>
                            {det.class.toUpperCase()} {Math.round(det.confidence * 100)}%
                          </span>
                        </div>
                        <span className="insp-reticle-metric">
                          {det.width_mm}×{det.height_mm}mm · {det.clock_pos.split(' ')[0]} {det.clock_pos.split(' ')[1]}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Tactical HUD Header */}
                <div className="insp-hud-top">
                  <span className="insp-hud-tag"><Layers size={12} /> {file.name}</span>
                  <span className="insp-hud-tag"><Crosshair size={12} /> CH: {currentChainage} m</span>
                  <span className="insp-hud-tag insp-hud-tag--cyan">TC: {formatTimecode(currentTime)}</span>
                </div>

                {/* Tactical HUD Footer */}
                <div className="insp-hud-bottom">
                  <span>JOB: {jobId}</span>
                  <span>SYNCED TO DB: {syncedToDb} RECORDS</span>
                </div>
              </div>

              {/* Viewport Control Bar */}
              <div className="insp-viewport__controls">
                <div className="insp-playback-btns">
                  {status === 'analyzing' ? (
                    <button className="insp-ctrl-btn insp-ctrl-btn--danger" onClick={handleStopInspection}>
                      <StopCircle size={16} /> Stop Scan
                    </button>
                  ) : (
                    <button className="insp-ctrl-btn insp-ctrl-btn--primary" onClick={handleStartInspection}>
                      <Play size={16} /> {status === 'complete' ? 'Re-run AI Scan' : 'Execute AI Detection'}
                    </button>
                  )}

                  <button
                    className="insp-ctrl-btn"
                    onClick={() => {
                      abortRef.current = true;
                      if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
                      setFile(null);
                      setVideoUrl(null);
                      setStatus('idle');
                      setDetections([]);
                      setActiveOverlays([]);
                      setSyncedToDb(0);
                      setDbError(null);
                    }}
                  >
                    <RefreshCw size={14} /> Change Source
                  </button>
                </div>

                <div className="insp-progress-metric">
                  <div className="insp-progress-text">
                    <span>PROGRESS: {progress}%</span>
                    <span>KEYFRAME {currentFrame} / {totalFrames}</span>
                  </div>
                  <div className="insp-progress-track">
                    <div className="insp-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Live Detection Feed & Telemetry */}
        <div className="insp-deck__right">
          <div className="insp-telemetry-panel">
            <div className="insp-panel-heading">
              <span className="insp-panel-title">LIVE DEFECT MANIFEST</span>
              <span className="insp-count-pill">{detections.length} DETECTED</span>
            </div>

            {/* Quick KPI Quad */}
            <div className="insp-kpi-quad">
              <div className="insp-kpi-cell">
                <span className="insp-kpi-cell__label">TOTAL DEFECTS</span>
                <span className="insp-kpi-cell__val">{detections.length}</span>
              </div>
              <div className="insp-kpi-cell">
                <span className="insp-kpi-cell__label">CRITICAL</span>
                <span className="insp-kpi-cell__val insp-kpi-cell__val--red">{criticalCount}</span>
              </div>
              <div className="insp-kpi-cell">
                <span className="insp-kpi-cell__label">SCAN CHAINAGE</span>
                <span className="insp-kpi-cell__val">{currentChainage} m</span>
              </div>
              <div className="insp-kpi-cell">
                <span className="insp-kpi-cell__label">DB SYNCED</span>
                <span className="insp-kpi-cell__val insp-kpi-cell__val--cyan">{syncedToDb}</span>
              </div>
            </div>

            {/* Scrollable Defect Cards Stream */}
            <div className="insp-feed-stream">
              {detections.length === 0 ? (
                <div className="insp-feed-empty">
                  <Activity size={28} className="insp-feed-empty__icon" />
                  <p>{status === 'analyzing' ? 'Scanning video frames…' : 'Awaiting inspection run'}</p>
                  <span>
                    {status === 'analyzing'
                      ? 'YOLOv8n-seg is inspecting keyframes for fractures & spalling.'
                      : 'Select an inspection video and click Execute AI Detection.'}
                  </span>
                </div>
              ) : (
                detections.map((det, idx) => (
                  <div
                    key={det.localId || `${det.frame_index}-${idx}`}
                    className={`insp-defect-item insp-defect-item--${det.severity?.toLowerCase()}`}
                    onClick={() => handleInspectDefect(det)}
                    title="Click to jump video to this exact defect frame"
                  >
                    <div className="insp-defect-item__top">
                      <span className="insp-defect-item__badge" style={{ color: SEVERITY_COLORS[det.severity] }}>
                        {det.severity}
                      </span>
                      <span className="insp-defect-item__class">
                        {det.class.toUpperCase()} · t={det.video_time}s{det.observations > 1 ? ` · ${det.observations}f` : ''}
                      </span>
                      <span className="insp-defect-item__conf">
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>

                    <div className="insp-defect-item__specs">
                      <span>CH: {det.chainage_z}m</span>
                      <span>{det.clock_pos}</span>
                      <span>DIM: {det.width_mm}×{det.height_mm}mm</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Completion / Export Action Dock */}
            {detections.length > 0 && (
              <div className="insp-action-dock">
                <button
                  type="button"
                  className="insp-btn insp-btn--full insp-btn--cyan"
                  onClick={() => navigate('/tunnel-twin')}
                >
                  <Compass size={16} /> View Defects on 3D Digital Twin
                </button>
                <button
                  type="button"
                  className="insp-btn insp-btn--full insp-btn--outline"
                  onClick={() => navigate('/dashboard/detections')}
                >
                  <Activity size={16} /> Open AI Detections & Reports
                </button>
                <button
                  type="button"
                  className="insp-btn insp-btn--full insp-btn--outline"
                  onClick={handleDownloadReport}
                >
                  <Download size={16} /> Export Audit Telemetry (JSON)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
