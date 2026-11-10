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
  Camera,
  Video,
  Film,
  BookmarkPlus,
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

function makeSessionId(prefix) {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const tail = String(Date.now()).slice(-4);
  return `${prefix}-${d}-${tail}`;
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

  // Mode switcher: 'upload' | 'webcam'
  const [sourceMode, setSourceMode] = useState('upload');

  // File & video playback state
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoDims, setVideoDims] = useState({ width: 1280, height: 720, duration: 10 });
  const [dragging, setDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Webcam state
  const [webcamStream, setWebcamStream] = useState(null);
  const [webcamError, setWebcamError] = useState(null);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [webcamScanning, setWebcamScanning] = useState(false);

  // Inspection runtime state (shared across upload & webcam)
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
  const webcamVideoRef = useRef(null);
  const fileInputRef = useRef(null);
  const sseRef = useRef(null);
  const abortRef = useRef(false);
  const webcamRunningRef = useRef(false);
  const webcamStreamRef = useRef(null);
  const trackerRef = useRef(null);

  /* ── Stop hardware webcam tracks cleanly ── */
  const stopWebcamHardware = useCallback(() => {
    webcamRunningRef.current = false;
    setWebcamScanning(false);
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    setWebcamStream(null);
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
  }, []);

  // Pre-warm Render MongoDB Gateway & guarantee hardware release on unmount
  useEffect(() => {
    fetch(`${API_BASE}/health`).catch(() => {});
    return () => {
      abortRef.current = true;
      webcamRunningRef.current = false;
      if (sseRef.current) sseRef.current.close();
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      }
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

  // Attach MediaStream to <video> element once mounted in DOM
  useEffect(() => {
    if (sourceMode === 'webcam' && webcamStream && webcamVideoRef.current) {
      const el = webcamVideoRef.current;
      if (el.srcObject !== webcamStream) {
        el.srcObject = webcamStream;
      }
      el.play().catch(() => {});
    }
  }, [sourceMode, webcamStream]);

  /* ── Persist verified detection directly to MongoDB Gateway (with Render cold-start retry) ── */
  const persistToGateway = useCallback(async (det, inspId, sourceLabel) => {
    const payload = {
      class_label: det.class || 'crack',
      subtype: det.subtype || undefined,
      confidence: det.confidence,
      severity: det.severity,
      crack_width_mm: det.width_mm || 2.5,
      crack_length_mm: det.height_mm || 150.0,
      frame_index: det.frame_index ?? 0,
      video_time: det.video_time ?? 0,
      video_name: sourceLabel || null,
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
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }, []);

  /* ── Mode Switching ── */
  const handleSwitchMode = useCallback(
    (nextMode) => {
      if (nextMode === sourceMode) return;
      abortRef.current = true;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      stopWebcamHardware();

      setSourceMode(nextMode);
      setStatus('idle');
      setProgress(0);
      setCurrentFrame(0);
      setCurrentTime(0);
      setDetections([]);
      setActiveOverlays([]);
      setSyncedToDb(0);
      setDbError(null);
      setWebcamError(null);
      setJobId(nextMode === 'webcam' ? makeSessionId('CAM') : null);
      setEngineMsg(
        nextMode === 'webcam'
          ? 'Live Camera ready — enable webcam to detect cracks on photos or video'
          : 'Ready — YOLOv8n-seg IN-BROWSER ONNX + MongoDB Atlas Gateway'
      );
    },
    [sourceMode, stopWebcamHardware]
  );

  /* ── Enable Live Webcam Hardware ── */
  const enableWebcam = useCallback(
    async (explicitDeviceId = '') => {
      setWebcamError(null);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setWebcamError('Live camera requires HTTPS (Vercel or localhost) and a browser with WebRTC camera access.');
        return;
      }

      try {
        if (webcamStreamRef.current) {
          webcamStreamRef.current.getTracks().forEach((t) => t.stop());
        }

        const constraints = explicitDeviceId
          ? { video: { deviceId: { exact: explicitDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
          : { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamStreamRef.current = stream;
        setWebcamStream(stream);
        setJobId((prev) => (prev && prev.startsWith('CAM-') ? prev : makeSessionId('CAM')));
        setEngineMsg('Webcam connected — preloading YOLOv8n-seg weights…');

        // Enumerate cameras now that permission is granted
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(cams);
        if (!explicitDeviceId && cams.length > 0) {
          const activeTrack = stream.getVideoTracks()[0];
          const activeId = activeTrack?.getSettings()?.deviceId || cams[0].deviceId;
          setSelectedDeviceId(activeId);
        } else if (explicitDeviceId) {
          setSelectedDeviceId(explicitDeviceId);
        }

        // Pre-warm neural engine cleanly in background
        await getYoloSession((msg) => setEngineMsg(msg));
        setEngineMsg('Camera live & YOLOv8n-seg ready — press Start Live Session to begin detecting');
      } catch (err) {
        setWebcamError(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access in your browser address bar and try again.'
            : `Unable to open camera: ${err.message}`
        );
      }
    },
    []
  );

  /* ── Live Webcam Continuous Detection Session ── */
  const startWebcamSession = useCallback(async () => {
    if (!webcamVideoRef.current || webcamRunningRef.current) return;

    const sessionId = status === 'complete' || !jobId || !jobId.startsWith('CAM-')
      ? makeSessionId('CAM')
      : jobId;

    setJobId(sessionId);
    setStatus('analyzing');
    setWebcamScanning(true);
    webcamRunningRef.current = true;
    setDetections([]);
    setActiveOverlays([]);
    setSyncedToDb(0);
    setDbError(null);
    setCurrentFrame(0);
    setCurrentTime(0);

    try {
      await getYoloSession((msg) => setEngineMsg(msg));

      const tracker = createDefectTracker({
        maxGapSeconds: 1.5,
        maxAngleDiffDeg: 35,
        maxChainageJumpM: 999,
        minPctIoU: 0.14,
        maxCentroidDistPct: 20,
      });
      trackerRef.current = tracker;

      const startTimeMs = performance.now();
      let frameSeq = 0;

      while (webcamRunningRef.current && webcamVideoRef.current) {
        const videoEl = webcamVideoRef.current;
        if (videoEl.readyState >= 2) {
          frameSeq += 1;
          const elapsedSec = (performance.now() - startTimeMs) / 1000;
          setCurrentTime(elapsedSec);
          setCurrentFrame(frameSeq);

          const chainageZ = Number((elapsedSec * 0.4).toFixed(2));
          const { detections: frameHits } = await detectVideoFrame(videoEl, {
            frameIndex: frameSeq,
            videoTime: elapsedSec,
            chainageZ,
            confThreshold: 0.22,
            tiled: false,
          });

          if (!webcamRunningRef.current) break;

          setActiveOverlays(frameHits);

          const manifest = tracker.ingestFrame(frameHits);
          setDetections(manifest);

          // Automatically flush defects after leaving webcam view > 1.5s
          const exited = tracker.popExitedTracks(elapsedSec);
          for (const readyDet of exited) {
            persistToGateway(readyDet, sessionId, `Live Camera (${sessionId})`).then(() => {
              if (trackerRef.current === tracker) {
                setDetections(tracker.getManifest());
              }
            });
          }

          setEngineMsg(
            frameHits.length > 0
              ? `LIVE: ${frameHits.length} anomaly box(es) tracked · Session ${sessionId}`
              : `LIVE: Scanning feed… hold crack image or video in view (${sessionId})`
          );
        }

        await new Promise((r) => setTimeout(r, 80));
      }
    } catch (err) {
      setStatus('error');
      setWebcamScanning(false);
      webcamRunningRef.current = false;
      setEngineMsg(`Live webcam AI error: ${err.message}`);
    }
  }, [jobId, status, persistToGateway]);

  /* ── Stop Live Webcam Session & Persist Remaining Tracks ── */
  const stopWebcamSession = useCallback(async () => {
    webcamRunningRef.current = false;
    setWebcamScanning(false);

    const tracker = trackerRef.current;
    const sessionId = jobId || makeSessionId('CAM');
    if (tracker) {
      setEngineMsg('Saving remaining live defects to MongoDB Atlas…');
      const remaining = tracker.flushAll();
      setDetections(tracker.getManifest());
      await Promise.allSettled(
        remaining.map((det) => persistToGateway(det, sessionId, `Live Camera (${sessionId})`))
      );
      setDetections(tracker.getManifest());
      setStatus('complete');
      setEngineMsg(`Live session ${sessionId} saved — ${tracker.getManifest().length} defect(s) logged`);
    } else {
      setStatus('idle');
    }
  }, [jobId, persistToGateway]);

  /* ── Instant Manual High-Sensitivity Webcam Snapshot & Log ── */
  const captureWebcamNow = useCallback(async () => {
    if (!webcamVideoRef.current || webcamVideoRef.current.readyState < 2) return;

    const sessionId = jobId && jobId.startsWith('CAM-') ? jobId : makeSessionId('CAM');
    if (!jobId || !jobId.startsWith('CAM-')) setJobId(sessionId);

    const nextSeq = currentFrame + 1;
    setCurrentFrame(nextSeq);
    setEngineMsg('Capturing high-sensitivity tiled snapshot (2x2)…');

    try {
      const tSec = Number(currentTime.toFixed(2));
      const { detections: frameHits } = await detectVideoFrame(webcamVideoRef.current, {
        frameIndex: nextSeq,
        videoTime: tSec,
        chainageZ: Number((tSec * 0.4).toFixed(2)),
        confThreshold: 0.20,
        tiled: true,
      });

      setActiveOverlays(frameHits);

      if (frameHits.length === 0) {
        setEngineMsg('No crack/spall signature exceeded 20% threshold in this snapshot — try moving closer or improving light');
        return;
      }

      if (!trackerRef.current) {
        trackerRef.current = createDefectTracker({
          maxGapSeconds: 1.5,
          maxAngleDiffDeg: 35,
          maxChainageJumpM: 999,
          minPctIoU: 0.14,
          maxCentroidDistPct: 20,
        });
      }

      trackerRef.current.ingestFrame(frameHits);
      const pendingBatch = trackerRef.current.flushPendingNow();
      setDetections(trackerRef.current.getManifest());

      if (pendingBatch.length > 0) {
        await Promise.allSettled(
          pendingBatch.map((det) => persistToGateway(det, sessionId, `Live Camera (${sessionId})`))
        );
        setDetections(trackerRef.current.getManifest());
        setStatus((prev) => (prev === 'analyzing' ? 'analyzing' : 'complete'));
        setEngineMsg(`Captured & synced ${pendingBatch.length} new defect(s) to session ${sessionId}`);
      } else {
        setEngineMsg('Defect already synced for the currently held frame');
      }
    } catch (err) {
      setEngineMsg(`Snapshot error: ${err.message}`);
    }
  }, [jobId, currentFrame, currentTime, persistToGateway]);

  /* ── Upload Video File selection ── */
  const handleSelectFile = useCallback(
    (selectedFile) => {
      if (!selectedFile) return;
      if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);

      const url = URL.createObjectURL(selectedFile);
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
      setJobId(makeSessionId('INSP'));
    },
    [videoUrl]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) handleSelectFile(dropped);
    },
    [handleSelectFile]
  );

  /* ── Execute Real YOLOv8 Inspection on Uploaded Video ── */
  const handleStartInspection = useCallback(async () => {
    if (!file || !videoRef.current) return;

    abortRef.current = false;
    const inspId = jobId || makeSessionId('INSP');
    setJobId(inspId);
    setStatus('analyzing');
    setProgress(0);
    setCurrentFrame(0);
    setDetections([]);
    setActiveOverlays([]);
    setSyncedToDb(0);
    setDbError(null);

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

    try {
      const videoEl = videoRef.current;
      videoEl.pause();

      await getYoloSession((msg) => setEngineMsg(msg));
      if (abortRef.current) return;

      const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 8;
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
          tiled: true,
        });

        setActiveOverlays(frameHits);

        const uniqueManifest = tracker.ingestFrame(frameHits);
        setDetections(uniqueManifest);

        for (const readyDet of tracker.popExitedTracks(targetTime)) {
          pendingSaves.push(persistToGateway(readyDet, inspId, file.name));
        }

        setProgress(Math.round(((step + 1) / steps) * 100));
        await new Promise((r) => setTimeout(r, 40));
      }

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

  /* ── Stop upload scan ── */
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

  /* ── Jump uploaded video or highlight bounding box from manifest click ── */
  const handleInspectDefect = useCallback(
    (det) => {
      if (sourceMode === 'upload' && videoRef.current && det.video_time != null) {
        videoRef.current.pause();
        videoRef.current.currentTime = det.video_time;
        setCurrentTime(det.video_time);
      }
      const coLocated = detections.filter(
        (d) => Math.abs((d.video_time ?? 0) - (det.video_time ?? 0)) < 0.05
      );
      setActiveOverlays(coLocated.length > 0 ? coLocated : [det]);
    },
    [detections, sourceMode]
  );

  /* ── Download JSON Inspection Audit Report ── */
  const handleDownloadReport = useCallback(() => {
    const reportData = {
      system: 'HRT Subsea AI Inspection System',
      model: 'YOLOv8n-seg (ONNX Web Runtime) + Laplacian Spall Analyzer',
      mode: sourceMode === 'webcam' ? 'Live Webcam Feed' : 'Video Upload Scan',
      inspectionId: jobId || 'INSP-MANUAL',
      timestamp: new Date().toISOString(),
      sourceMedia: sourceMode === 'webcam' ? `Live Camera (${jobId})` : file?.name || 'uploaded_video.mp4',
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
  }, [detections, file, jobId, sourceMode]);

  const criticalCount = useMemo(
    () => detections.filter((d) => d.severity === 'Critical').length,
    [detections]
  );

  const currentChainage = useMemo(
    () => (currentTime * (sourceMode === 'webcam' ? 0.4 : 1.6)).toFixed(1),
    [currentTime, sourceMode]
  );

  const videoAspect = videoDims.width / Math.max(1, videoDims.height);
  const stageStyle =
    videoAspect >= 16 / 9
      ? { width: '100%', height: 'auto', aspectRatio: `${videoDims.width} / ${videoDims.height}` }
      : { height: '100%', width: 'auto', aspectRatio: `${videoDims.width} / ${videoDims.height}` };

  const renderBoundingBoxes = () =>
    activeOverlays.map((det, idx) => {
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
    });

  return (
    <div className="insp-console">
      {/* ── Console Header ── */}
      <div className="insp-console__header">
        <div className="insp-console__title-group">
          <div className="insp-status-badge">
            <span className="insp-status-badge__dot" />
            <span className="insp-status-badge__text">YOLOv8n-seg ONNX VISION · LIVE</span>
          </div>
          <h1 className="insp-console__title">Concrete Inspection & Live Camera Detection</h1>
          <p className="insp-console__desc">
            Upload tunnel footage or use a live webcam feed to show cracks directly from an image or video, track unique anomalies, and log them into a dedicated MongoDB Atlas session.
          </p>
        </div>

        <div className="insp-console__meta-ribbon">
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">ENGINE</span>
            <span className="insp-meta-chip__val">YOLOv8n-seg ONNX</span>
          </div>
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">SESSION</span>
            <span className="insp-meta-chip__val">{jobId || 'STANDBY'}</span>
          </div>
          <div className="insp-meta-chip">
            <span className="insp-meta-chip__label">GATEWAY</span>
            <span className="insp-meta-chip__val">MongoDB Atlas</span>
          </div>
        </div>
      </div>

      {/* ── Source Mode Bar ── */}
      <div className="insp-mode-bar">
        <div className="insp-mode-tabs" role="tablist" aria-label="Inspection input source">
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === 'upload'}
            className={`insp-mode-tab ${sourceMode === 'upload' ? 'insp-mode-tab--active' : ''}`}
            onClick={() => handleSwitchMode('upload')}
          >
            <Film size={15} /> UPLOAD VIDEO FILE
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === 'webcam'}
            className={`insp-mode-tab ${sourceMode === 'webcam' ? 'insp-mode-tab--active' : ''}`}
            onClick={() => handleSwitchMode('webcam')}
          >
            <Camera size={15} /> LIVE WEBCAM FEED
          </button>
        </div>

        {sourceMode === 'webcam' && videoDevices.length > 1 && (
          <select
            className="insp-cam-select"
            value={selectedDeviceId}
            onChange={(e) => enableWebcam(e.target.value)}
            aria-label="Select camera device"
          >
            {videoDevices.map((dev, idx) => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Main Inspection Deck ── */}
      <div className="insp-deck">
        {/* Left Column: Viewport */}
        <div className="insp-deck__left">
          {sourceMode === 'upload' ? (
            !videoUrl || !file ? (
              <div
                className={`insp-dropzone ${dragging ? 'insp-dropzone--active' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
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
                  MP4, MOV, or WebM · Real YOLOv8n-seg Tracking (Zero Duplicate Logging)
                </p>

                <button
                  type="button"
                  className="insp-btn insp-btn--primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload size={16} /> Select Video File
                </button>
              </div>
            ) : (
              <div className="insp-viewport">
                <div className={`insp-engine-banner ${dbError || status === 'error' ? 'insp-engine-banner--error' : ''}`}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {dbError || status === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                    {dbError || engineMsg}
                  </span>
                  <span>
                    {videoDims.width}×{videoDims.height}
                  </span>
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
                          const near = detections.filter((d) => Math.abs((d.video_time ?? 0) - t) <= 0.45);
                          if (near.length > 0) setActiveOverlays(near);
                          else if (status === 'complete') setActiveOverlays([]);
                        }
                      }}
                    />

                    {status === 'analyzing' && <div className="insp-laser-scanner" />}
                    {renderBoundingBoxes()}
                  </div>

                  <div className="insp-hud-top">
                    <span className="insp-hud-tag">
                      <Layers size={12} /> {file.name}
                    </span>
                    <span className="insp-hud-tag">
                      <Crosshair size={12} /> CH: {currentChainage} m
                    </span>
                    <span className="insp-hud-tag insp-hud-tag--cyan">TC: {formatTimecode(currentTime)}</span>
                  </div>

                  <div className="insp-hud-bottom">
                    <span>JOB: {jobId}</span>
                    <span>SYNCED TO DB: {syncedToDb} RECORDS</span>
                  </div>
                </div>

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
                      <span>
                        KEYFRAME {currentFrame} / {totalFrames}
                      </span>
                    </div>
                    <div className="insp-progress-track">
                      <div className="insp-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : /* ── WEBCAM MODE VIEWPORT ── */
          !webcamStream ? (
            <div className="insp-dropzone" style={{ cursor: 'default' }}>
              <div className="insp-dropzone__reticle">
                <Camera size={44} className="insp-dropzone__icon" />
              </div>
              <h3 className="insp-dropzone__heading">Live Camera Crack Scanner</h3>
              <p className="insp-dropzone__sub" style={{ maxWidth: '460px' }}>
                Hold a concrete crack image, printed sample, phone display, or live surface in front of your webcam. Detected defects lock cleanly and save to a dedicated live camera session.
              </p>

              {webcamError && (
                <div
                  style={{
                    background: '#231114',
                    border: '1px solid #ef4444',
                    color: '#f87171',
                    padding: '10px 14px',
                    borderRadius: '4px',
                    fontSize: '0.78rem',
                    marginBottom: '16px',
                    maxWidth: '460px',
                  }}
                >
                  {webcamError}
                </div>
              )}

              <button type="button" className="insp-btn insp-btn--primary" onClick={() => enableWebcam('')}>
                <Video size={16} /> Enable Live Camera
              </button>
            </div>
          ) : (
            <div className="insp-viewport">
              <div className={`insp-engine-banner ${dbError || status === 'error' ? 'insp-engine-banner--error' : ''}`}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {dbError || status === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  {dbError || engineMsg}
                </span>
                <span>
                  {videoDims.width}×{videoDims.height}
                </span>
              </div>

              <div className="insp-viewport__screen">
                <div className="insp-video-stage" style={stageStyle}>
                  <video
                    ref={webcamVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="insp-video-player"
                    onLoadedMetadata={() => {
                      if (webcamVideoRef.current) {
                        setVideoDims({
                          width: webcamVideoRef.current.videoWidth || 1280,
                          height: webcamVideoRef.current.videoHeight || 720,
                          duration: 0,
                        });
                      }
                    }}
                  />

                  {webcamScanning && <div className="insp-laser-scanner" />}
                  {renderBoundingBoxes()}
                </div>

                <div className="insp-hud-top">
                  {webcamScanning ? (
                    <span className="insp-live-badge">
                      <span className="insp-live-badge__dot" /> LIVE DETECT
                    </span>
                  ) : (
                    <span className="insp-hud-tag">
                      <Camera size={12} /> CAMERA PREVIEW
                    </span>
                  )}
                  <span className="insp-hud-tag">
                    <Crosshair size={12} /> SESSION: {jobId}
                  </span>
                  <span className="insp-hud-tag insp-hud-tag--cyan">TC: {formatTimecode(currentTime)}</span>
                </div>

                <div className="insp-hud-bottom">
                  <span>FRAMES ANALYZED: {currentFrame}</span>
                  <span>SYNCED TO DB: {syncedToDb} RECORDS</span>
                </div>
              </div>

              <div className="insp-viewport__controls">
                <div className="insp-playback-btns">
                  {webcamScanning ? (
                    <button className="insp-ctrl-btn insp-ctrl-btn--danger" onClick={stopWebcamSession}>
                      <StopCircle size={16} /> End Session & Save
                    </button>
                  ) : (
                    <button className="insp-ctrl-btn insp-ctrl-btn--primary" onClick={startWebcamSession}>
                      <Play size={16} /> {status === 'complete' ? 'Start New Live Session' : 'Start Live Detection'}
                    </button>
                  )}

                  <button
                    className="insp-ctrl-btn"
                    onClick={captureWebcamNow}
                    title="Force high-sensitivity snapshot & save to session now"
                  >
                    <BookmarkPlus size={15} /> Log Snapshot Now
                  </button>

                  <button className="insp-ctrl-btn" onClick={stopWebcamHardware}>
                    <RefreshCw size={14} /> Turn Off Camera
                  </button>
                </div>

                <div className="insp-progress-metric">
                  <div className="insp-progress-text">
                    <span>{webcamScanning ? 'CONTINUOUS AI TRACKING ACTIVE' : 'CAMERA READY'}</span>
                    <span>{detections.length} UNIQUE ZONE(S)</span>
                  </div>
                  <div className="insp-progress-track">
                    <div
                      className="insp-progress-fill"
                      style={{ width: webcamScanning ? '100%' : `${detections.length > 0 ? 100 : 0}%` }}
                    />
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
                  <p>
                    {status === 'analyzing'
                      ? 'Scanning live video frames…'
                      : sourceMode === 'webcam'
                        ? 'Awaiting camera session'
                        : 'Awaiting inspection run'}
                  </p>
                  <span>
                    {status === 'analyzing'
                      ? 'Hold a crack image or play footage cleanly in front of the detector.'
                      : sourceMode === 'webcam'
                        ? 'Enable your camera and start a live session to detect & log cracks into a new session.'
                        : 'Select an inspection video and click Execute AI Detection.'}
                  </span>
                </div>
              ) : (
                detections.map((det, idx) => (
                  <div
                    key={det.localId || `${det.frame_index}-${idx}`}
                    className={`insp-defect-item insp-defect-item--${det.severity?.toLowerCase()}`}
                    onClick={() => handleInspectDefect(det)}
                    title={sourceMode === 'upload' ? 'Click to jump video to this exact defect frame' : 'Highlight bounding box'}
                  >
                    <div className="insp-defect-item__top">
                      <span className="insp-defect-item__badge" style={{ color: SEVERITY_COLORS[det.severity] }}>
                        {det.severity}
                      </span>
                      <span className="insp-defect-item__class">
                        {det.class.toUpperCase()} · t={det.video_time}s{det.observations > 1 ? ` · ${det.observations}f` : ''}
                        {det.persisted ? ' · DB ✓' : ''}
                      </span>
                      <span className="insp-defect-item__conf">{Math.round(det.confidence * 100)}%</span>
                    </div>

                    <div className="insp-defect-item__specs">
                      <span>CH: {det.chainage_z}m</span>
                      <span>{det.clock_pos}</span>
                      <span>
                        DIM: {det.width_mm}×{det.height_mm}mm
                      </span>
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
                  onClick={() => navigate('/dashboard/inspections')}
                >
                  <Activity size={16} /> Open Inspections & AI Detections
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
