/**
 * InspectionVideos.jsx — Live Archived Keyframe & Bounding-Box Viewer
 *
 * Displays authentic captured inspection frames and YOLOv8 bounding boxes
 * persisted from uploaded videos in MongoDB Atlas. Never loads demo assets.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Clock,
  ChevronRight,
  Loader2,
  Video,
  PlusCircle,
} from 'lucide-react';
import { useInspections, useDetections } from '../../hooks/useApi';
import './InspectionVideos.css';

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function InspectionVideos() {
  const navigate = useNavigate();

  const { data: inspections, loading: inspLoading } = useInspections();
  const inspList = useMemo(() => inspections ?? [], [inspections]);

  const [selectedInspectionId, setSelectedInspectionId] = useState(null);
  const selectedInspection = useMemo(
    () => inspList.find((i) => i.id === selectedInspectionId) ?? inspList[0] ?? null,
    [inspList, selectedInspectionId]
  );

  const { data: allDetections, loading: detLoading } = useDetections({ limit: 500 });

  const detections = useMemo(() => {
    if (!selectedInspection) return [];
    return (allDetections ?? [])
      .filter(
        (d) =>
          d.inspectionId === selectedInspection.id ||
          d.inspection_id === selectedInspection.id ||
          (selectedInspection.id === 'INSP-LIVE-1' && !d.inspection_id)
      )
      .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
  }, [allDetections, selectedInspection]);

  // Unique keyframes with captured image snapshots
  const frames = useMemo(() => {
    const withImages = detections.filter((d) => Boolean(d.imageUrl));
    const map = new Map();
    for (const det of withImages) {
      const key = `${det.frameIndex ?? 0}-${det.videoTime ?? 0}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          frameIndex: det.frameIndex ?? 0,
          videoTime: det.videoTime ?? 0,
          imageUrl: det.imageUrl,
          detections: [det],
        });
      } else {
        map.get(key).detections.push(det);
      }
    }
    return Array.from(map.values());
  }, [detections]);

  const [cursorIdx, setCursorIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedDetId, setSelectedDetId] = useState(null);
  const intervalRef = useRef(null);

  const totalKeyframes = frames.length;
  const safeCursor = totalKeyframes > 0 ? Math.min(cursorIdx, totalKeyframes - 1) : 0;
  const currentFrameObj = frames[safeCursor] ?? null;

  const stopPlayback = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (totalKeyframes <= 1) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCursorIdx((prev) => {
        if (prev >= totalKeyframes - 1) return 0;
        return prev + 1;
      });
    }, 1100);
    setPlaying(true);
  }, [totalKeyframes]);

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else startPlayback();
  }, [playing, stopPlayback, startPlayback]);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function stepFrame(delta) {
    stopPlayback();
    if (totalKeyframes === 0) return;
    setCursorIdx((i) => Math.max(0, Math.min(totalKeyframes - 1, i + delta)));
    setSelectedDetId(null);
  }

  function handleDetClick(det) {
    stopPlayback();
    setSelectedDetId(det.id);
    const frameMatch = frames.findIndex((f) => f.detections.some((fd) => fd.id === det.id));
    if (frameMatch >= 0) {
      setCursorIdx(frameMatch);
    } else {
      navigate(`/dashboard/detections/${det.id}`);
    }
  }

  const progress = totalKeyframes > 1 ? (safeCursor / (totalKeyframes - 1)) * 100 : totalKeyframes === 1 ? 100 : 0;

  if (!inspLoading && !detLoading && inspList.length === 0) {
    return (
      <div className="ipv-page">
        <div className="ipv-header">
          <h1 className="ipv-title">Inspection Videos</h1>
        </div>
        <div
          style={{
            background: 'var(--db-surface)',
            border: '1px dashed var(--db-border)',
            borderRadius: 'var(--radius-md)',
            padding: '64px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            color: 'var(--db-ink-2)',
          }}
        >
          <Video size={42} style={{ color: 'var(--db-ink-3)' }} />
          <div>
            <h2 style={{ color: 'var(--db-ink)', fontSize: 'var(--text-base)', fontWeight: 600, margin: '0 0 6px 0' }}>
              No uploaded inspection footage yet
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', maxWidth: '460px', margin: 0 }}>
              Upload a subsea tunnel video in New Inspection. Every detected crack keyframe and bounding box will automatically archive here for playback and audit review.
            </p>
          </div>
          <button
            className="db-btn-primary"
            onClick={() => navigate('/inspection/new')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}
          >
            <PlusCircle size={16} /> Launch Inspection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ipv-page">
      {/* ── Header + inspection switcher ── */}
      <div className="ipv-header">
        <h1 className="ipv-title">Inspection Videos</h1>
        {inspLoading ? (
          <Loader2 size={16} className="sp-dl-btn__spin" />
        ) : (
          <select
            className="ipv-select"
            value={selectedInspection?.id ?? ''}
            onChange={(e) => {
              setSelectedInspectionId(e.target.value);
              setSelectedDetId(null);
              setCursorIdx(0);
              stopPlayback();
            }}
            aria-label="Select inspection"
          >
            {inspList.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label ?? i.id}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="ipv-layout">
        {/* ── Video / Frame player ── */}
        <div className="ipv-player-col">
          <div className="ipv-player">
            {/* Status bar */}
            <div className="ipv-player__status-bar">
              <span
                className="ipv-status-dot"
                style={{ background: currentFrameObj ? 'var(--teal)' : 'var(--minor)' }}
              />
              <span className="ipv-status-label">
                {currentFrameObj
                  ? `KEYFRAME ${safeCursor + 1} / ${totalKeyframes} (VID FR #${currentFrameObj.frameIndex})`
                  : detLoading
                    ? 'LOADING CAPTURED FRAMES…'
                    : 'TELEMETRY ARCHIVE'}
              </span>
              <span className="ipv-status-mode">
                {selectedInspection?.videoName || 'LIVE MONGODB SNAPSHOTS'}
              </span>
            </div>

            {/* Viewport */}
            <div className="ipv-player__viewport">
              {detLoading && (
                <div className="ipv-empty-state">
                  <div className="ipv-empty-state__inner">
                    <Loader2 size={28} className="sp-dl-btn__spin" />
                    <p className="ipv-empty-state__title">Loading archived keyframes…</p>
                  </div>
                </div>
              )}

              {!detLoading && !currentFrameObj && (
                <div className="ipv-empty-state">
                  <div className="ipv-empty-state__inner">
                    <Video size={32} style={{ color: 'var(--db-ink-3)' }} />
                    <p className="ipv-empty-state__title">No video snapshots attached to this session</p>
                    <p className="ipv-empty-state__body">
                      Run a live inspection scan in New Inspection to store frame snapshots alongside telemetry.
                    </p>
                  </div>
                </div>
              )}

              {!detLoading && currentFrameObj && (
                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
                    <img
                      src={currentFrameObj.imageUrl}
                      alt={`Captured keyframe #${currentFrameObj.frameIndex}`}
                      className="ipv-video"
                      style={{ width: '100%', height: 'auto', maxHeight: '420px', display: 'block' }}
                      draggable={false}
                    />

                    {/* Real Bounding Boxes overlaid accurately on captured frame */}
                    {currentFrameObj.detections.map((d) => {
                      if (!d.bbox) return null;
                      const style =
                        d.bbox.left_pct != null
                          ? {
                              left: `${d.bbox.left_pct}%`,
                              top: `${d.bbox.top_pct}%`,
                              width: `${d.bbox.width_pct}%`,
                              height: `${d.bbox.height_pct}%`,
                            }
                          : {
                              left: `${(d.bbox.x1 / 640) * 100}%`,
                              top: `${(d.bbox.y1 / 480) * 100}%`,
                              width: `${((d.bbox.x2 - d.bbox.x1) / 640) * 100}%`,
                              height: `${((d.bbox.y2 - d.bbox.y1) / 480) * 100}%`,
                            };
                      return (
                        <div
                          key={d.id}
                          className="ipv-det-overlay"
                          style={style}
                          aria-label={`Detection: ${d.category} ${Math.round((d.confidence ?? 0) * 100)}%`}
                        >
                          <span className="ipv-det-overlay__label">
                            {(d.category ?? '').toUpperCase()} {Math.round((d.confidence ?? 0) * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ROV telemetry HUD */}
              <div className="ipv-hud" aria-label="ROV telemetry">
                <span className="ipv-hud__label">YOLOv8n-seg ARCHIVE</span>
                <span className="ipv-hud__val">
                  {currentFrameObj
                    ? `Ch ${(currentFrameObj.detections[0]?.chainage ?? 0).toFixed(1)} m · t=${formatTime(currentFrameObj.videoTime)}`
                    : '—'}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="ipv-controls">
              <button
                className="ipv-btn"
                onClick={() => stepFrame(-1)}
                disabled={totalKeyframes <= 1}
                aria-label="Previous defect keyframe"
              >
                <SkipBack size={16} />
              </button>

              <button
                className="ipv-btn ipv-btn--play"
                onClick={togglePlay}
                disabled={totalKeyframes <= 1}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <button
                className="ipv-btn"
                onClick={() => stepFrame(1)}
                disabled={totalKeyframes <= 1}
                aria-label="Next defect keyframe"
              >
                <SkipForward size={16} />
              </button>

              <div className="ipv-seekbar" aria-label="Keyframe scrubber">
                <div className="ipv-seekbar__fill" style={{ width: `${progress}%` }} />
                <div className="ipv-seekbar__thumb" style={{ left: `${progress}%` }} />
              </div>

              <span className="ipv-time">
                {totalKeyframes > 0 ? `${safeCursor + 1} / ${totalKeyframes}` : '0 / 0'}
              </span>
            </div>
          </div>

          {/* Inspection metadata */}
          {selectedInspection && (
            <div className="ipv-meta-row">
              <span><strong>Inspection:</strong> {selectedInspection.id}</span>
              <span><strong>Engine:</strong> {selectedInspection.rov}</span>
              <span><strong>Date:</strong> {selectedInspection.date ?? '—'}</span>
              <span><strong>Detections:</strong> {detections.length}</span>
            </div>
          )}
        </div>

        {/* ── Detection list sidebar ── */}
        <aside className="ipv-det-list" aria-label="Detections in this inspection">
          <h2 className="ipv-det-list__title">
            Detections ({detections.length})
          </h2>

          {detections.length === 0 ? (
            <p className="ipv-empty-msg">No detections recorded for this inspection.</p>
          ) : (
            <ul>
              {detections.map((det) => {
                const isActive =
                  selectedDetId === det.id ||
                  (!selectedDetId && currentFrameObj?.detections.some((fd) => fd.id === det.id));
                return (
                  <li key={det.id}>
                    <button
                      className={`ipv-det-item ${isActive ? 'ipv-det-item--active' : ''}`}
                      onClick={() => handleDetClick(det)}
                      aria-pressed={isActive}
                    >
                      <div className="ipv-det-item__thumb" aria-hidden="true">
                        {det.imageUrl ? (
                          <img
                            src={det.imageUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div className="ipv-det-item__thumb-bg" />
                        )}
                        <span
                          className="ipv-det-item__sev-dot"
                          style={{
                            background:
                              det.severity === 'Critical'
                                ? 'var(--critical)'
                                : det.severity === 'Major'
                                  ? 'var(--major)'
                                  : 'var(--minor)',
                          }}
                        />
                      </div>
                      <div className="ipv-det-item__info">
                        <p className="ipv-det-item__cat">{det.category}</p>
                        <p className="ipv-det-item__meta">
                          <Clock size={11} />
                          Ch {(det.chainage ?? 0).toFixed(1)} m · Fr {det.frameIndex ?? 0}
                        </p>
                      </div>
                      <span className="ipv-det-item__conf">
                        {Math.round((det.confidence ?? 0) * 100)}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            className="ipv-view-all-btn"
            onClick={() => navigate('/dashboard/detections')}
            aria-label="View all AI detections"
          >
            View all detections <ChevronRight size={14} />
          </button>
        </aside>
      </div>
    </div>
  );
}
