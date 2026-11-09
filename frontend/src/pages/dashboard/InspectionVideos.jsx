/**
 * InspectionVideos.jsx — Module 9
 *
 * Replaces hasVideo=false with a real WebP frame-scrubber.
 * Reads /frames/manifest.json to know total frame count, fps, dimensions.
 * Maps each frame to the nearest detection via frameIndex so the HUD and
 * detection sidebar stay synchronised as the user scrubs or auto-plays.
 *
 * Module 8: INSPECTIONS and DETECTIONS are now fetched from the live API
 * (graceful fallback to mockData when offline).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Maximize2, Clock, ChevronRight, Loader2, AlertCircle,
} from 'lucide-react';
import { useInspections, useDetections } from '../../hooks/useApi';
import './InspectionVideos.css';

// ─── constants ───────────────────────────────────────────────────────────────

const MANIFEST_URL = '/frames/manifest.json';
const FRAME_BASE   = '/frames/mobile/'; // 960×540 frames, good balance

// ─── helpers ─────────────────────────────────────────────────────────────────

function zeroPad(n, width) {
  return String(n).padStart(width, '0');
}

function frameUrl(manifest, frameIdx) {
  if (!manifest) return '';
  const pad   = manifest.pad  ?? 4;
  const ext   = manifest.ext  ?? 'webp';
  const total = manifest.frameCount || 192;
  const n     = Math.max(1, Math.min(total, frameIdx + 1));
  return `${FRAME_BASE}frame_${zeroPad(n, pad)}.${ext}`;
}

function formatTime(seconds) {
  const m   = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Find which detection is closest to the given frame index. */
function nearestDetection(detections, frameIdx) {
  if (!detections || detections.length === 0) return null;
  return detections.reduce((best, d) => {
    const dfi = d.frameIndex ?? d.frame_index ?? 0;
    const bfi = best.frameIndex ?? best.frame_index ?? 0;
    return Math.abs(dfi - frameIdx) < Math.abs(bfi - frameIdx) ? d : best;
  });
}

// ─── component ───────────────────────────────────────────────────────────────

export default function InspectionVideos() {
  const navigate = useNavigate();

  // ── API data (Module 8) ──
  const { data: inspections, loading: inspLoading } = useInspections();
  const inspList = inspections ?? [];

  const [selectedInspectionId, setSelectedInspectionId] = useState(null);
  const selectedInspection = inspList.find(i => i.id === selectedInspectionId) ?? inspList[0] ?? null;


  const { data: allDetections } = useDetections();
  const detections = (allDetections ?? []).filter(
    d => d.inspectionId === (selectedInspection?.id) ||
         d.inspection_id === (selectedInspection?.id)
  );

  // ── manifest ──
  const [manifest,     setManifest]     = useState(null);
  const [manifestErr,  setManifestErr]  = useState(false);

  useEffect(() => {
    fetch(MANIFEST_URL)
      .then(r => r.json())
      .then(setManifest)
      .catch(() => setManifestErr(true));
  }, []);

  // ── frame player state ──
  const [frameIdx,    setFrameIdx]    = useState(0);
  const [playing,     setPlaying]     = useState(false);
  const [muted,       setMuted]       = useState(false);
  const [imgLoading,  setImgLoading]  = useState(true);
  const [selectedDet, setSelectedDet] = useState(null);

  const intervalRef  = useRef(null);
  const imgRef       = useRef(null);

  const totalFrames = manifest?.frameCount ?? 192;
  const fps         = manifest?.fps        ?? 24;
  const duration    = totalFrames / fps; // seconds

  // Near-detection highlight
  const activeDetection = selectedDet ?? nearestDetection(detections, frameIdx);

  // ── playback loop ──
  const stopPlayback = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const ms = Math.round(1000 / fps);
    intervalRef.current = setInterval(() => {
      setFrameIdx(prev => {
        if (prev >= totalFrames - 1) {
          stopPlayback();
          return 0;
        }
        return prev + 1;
      });
    }, ms);
    setPlaying(true);
  }, [fps, totalFrames, stopPlayback]);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function togglePlay() {
    if (!manifest) return;
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function stepFrame(delta) {
    stopPlayback();
    setFrameIdx(i => Math.max(0, Math.min(totalFrames - 1, i + delta)));
  }

  function handleSeek(e) {
    stopPlayback();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setFrameIdx(Math.floor(ratio * (totalFrames - 1)));
  }

  function handleDetClick(det) {
    stopPlayback();
    const rawFi = det.frameIndex ?? det.frame_index ?? 0;
    const fi = rawFi >= totalFrames ? (rawFi % totalFrames) : Math.max(0, Math.min(totalFrames - 1, rawFi));
    setFrameIdx(fi);
    setSelectedDet(det === selectedDet ? null : det);
  }

  // current timestamp as string
  const currentSec     = frameIdx / fps;
  const currentTimeStr = formatTime(currentSec);
  const progress       = totalFrames > 1 ? (frameIdx / (totalFrames - 1)) * 100 : 0;

  const hasFrames = manifest && !manifestErr;

  return (
    <div className="ipv-page">
      {/* ── Inspection selector ── */}
      <div className="ipv-selector">
        <h1 className="ipv-selector__title">Inspection Videos</h1>
        {inspLoading ? (
          <Loader2 size={16} className="sp-dl-btn__spin" />
        ) : (
          <select
            className="ipv-select"
            value={selectedInspection?.id ?? ''}
            onChange={e => {
              setSelectedInspectionId(e.target.value);
              setSelectedDet(null);
              setFrameIdx(0);
              stopPlayback();
            }}
            aria-label="Select inspection"
          >
            {inspList.map(i => (
              <option key={i.id} value={i.id}>{i.label ?? i.id}</option>
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
              <span className="ipv-status-dot" style={{ background: hasFrames ? 'var(--teal)' : 'var(--minor)' }} />
              <span className="ipv-status-label">
                {hasFrames ? `FRAME ${String(frameIdx).padStart(4, '0')} / ${totalFrames}` : 'LOADING FRAMES'}
              </span>
              <span className="ipv-status-mode">FILLED TUNNEL MODE — OPERATIONAL</span>
            </div>

            {/* Viewport */}
            <div className="ipv-player__viewport">
              {manifestErr && (
                <div className="ipv-empty-state">
                  <div className="ipv-empty-state__inner">
                    <AlertCircle size={28} style={{ color: 'var(--minor)' }} />
                    <p className="ipv-empty-state__title">Frame manifest not found</p>
                    <p className="ipv-empty-state__body">
                      Ensure <code>frontend/public/frames/manifest.json</code> exists.
                    </p>
                  </div>
                </div>
              )}

              {!manifestErr && !manifest && (
                <div className="ipv-empty-state">
                  <div className="ipv-empty-state__inner">
                    <Loader2 size={28} className="sp-dl-btn__spin" />
                    <p className="ipv-empty-state__title">Loading frames…</p>
                  </div>
                </div>
              )}

              {hasFrames && (
                <>
                  {/* Frame image */}
                  <img
                    ref={imgRef}
                    src={frameUrl(manifest, frameIdx)}
                    alt={`Frame ${frameIdx}`}
                    className="ipv-video"
                    style={{ display: imgLoading ? 'none' : 'block' }}
                    onLoad={() => setImgLoading(false)}
                    onLoadStart={() => setImgLoading(true)}
                    draggable={false}
                  />
                  {imgLoading && (
                    <div className="ipv-frame-loading" aria-label="Loading frame">
                      <Loader2 size={20} className="sp-dl-btn__spin" />
                    </div>
                  )}

                  {/* Detection bounding-box overlay */}
                  {activeDetection && activeDetection.bbox && (
                    <div
                      className="ipv-det-overlay"
                      style={{
                        left:   `${(activeDetection.bbox.x1 / 960) * 100}%`,
                        top:    `${(activeDetection.bbox.y1 / 540) * 100}%`,
                        width:  `${((activeDetection.bbox.x2 - activeDetection.bbox.x1) / 960) * 100}%`,
                        height: `${((activeDetection.bbox.y2 - activeDetection.bbox.y1) / 540) * 100}%`,
                      }}
                      aria-label={`Detection: ${activeDetection.category} ${Math.round((activeDetection.confidence ?? 0) * 100)}%`}
                    >
                      <span className="ipv-det-overlay__label">
                        {(activeDetection.category ?? '').toUpperCase()}{' '}
                        {Math.round((activeDetection.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* ROV telemetry HUD — always visible */}
              <div className="ipv-hud" aria-label="ROV telemetry">
                <span className="ipv-hud__label">ROV-04 "AQUASCAN"</span>
                <span className="ipv-hud__val">
                  {activeDetection
                    ? `Ch ${(activeDetection.chainage ?? activeDetection.coord_z ?? 0).toFixed(3)} km`
                    : `T ${currentTimeStr}`}
                </span>
                {activeDetection && (
                  <span className="ipv-hud__conf">
                    Conf {Math.round((activeDetection.confidence ?? 0) * 100)}%
                  </span>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="ipv-controls">
              <button
                className="ipv-btn"
                onClick={() => stepFrame(-10)}
                disabled={!hasFrames}
                aria-label="Back 10 frames"
              >
                <SkipBack size={16} />
              </button>

              <button
                className="ipv-btn ipv-btn--play"
                onClick={togglePlay}
                disabled={!hasFrames}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <button
                className="ipv-btn"
                onClick={() => stepFrame(10)}
                disabled={!hasFrames}
                aria-label="Forward 10 frames"
              >
                <SkipForward size={16} />
              </button>

              {/* Seek bar */}
              <div
                className="ipv-seekbar"
                onClick={handleSeek}
                role="slider"
                aria-valuenow={frameIdx}
                aria-valuemin={0}
                aria-valuemax={totalFrames - 1}
                aria-label="Frame scrubber"
                tabIndex={hasFrames ? 0 : -1}
                onKeyDown={e => {
                  if (e.key === 'ArrowRight') stepFrame(1);
                  if (e.key === 'ArrowLeft')  stepFrame(-1);
                }}
              >
                {/* detection markers on the timeline */}
                {detections.map(d => {
                  const rawFi = d.frameIndex ?? d.frame_index ?? 0;
                  const fi  = rawFi >= totalFrames ? (rawFi % totalFrames) : rawFi;
                  const pct = totalFrames > 1 ? (fi / (totalFrames - 1)) * 100 : 0;
                  const col = d.severity === 'Critical' ? 'var(--critical)'
                            : d.severity === 'Major'    ? 'var(--major)'
                            :                             'var(--minor)';
                  return (
                    <div
                      key={d.id}
                      className="ipv-seekbar__marker"
                      style={{ left: `${pct}%`, background: col }}
                      title={`${d.id} — ${d.severity} (frame ${fi})`}
                    />
                  );
                })}
                <div className="ipv-seekbar__fill" style={{ width: `${progress}%` }} />
                <div className="ipv-seekbar__thumb" style={{ left: `${progress}%` }} />
              </div>

              <span className="ipv-time">
                {currentTimeStr} / {formatTime(duration)}
              </span>

              <button
                className="ipv-btn"
                onClick={() => setMuted(m => !m)}
                disabled={!hasFrames}
                aria-label={muted ? 'Unmute' : 'Mute'}
                title="Audio not available for frame sequences"
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>

              <button className="ipv-btn" disabled={!hasFrames} aria-label="Fullscreen">
                <Maximize2 size={18} />
              </button>
            </div>
          </div>

          {/* Inspection metadata */}
          {selectedInspection && (
            <div className="ipv-meta-row">
              <span><strong>Inspection:</strong> {selectedInspection.id}</span>
              <span><strong>ROV:</strong> {selectedInspection.rov}</span>
              <span><strong>Date:</strong> {selectedInspection.date ?? selectedInspection.started_at?.slice(0, 10) ?? '—'}</span>
              <span><strong>Duration:</strong> {selectedInspection.duration ?? `${Math.round(duration)}s`}</span>
            </div>
          )}
        </div>

        {/* ── Detection list sidebar ── */}
        <aside className="ipv-det-list" aria-label="Detections in this inspection">
          <h2 className="ipv-det-list__title">
            Detections ({detections.length})
          </h2>

          {detections.length === 0 ? (
            <p className="ipv-empty-msg">No detections for this inspection.</p>
          ) : (
            <ul>
              {detections.map(det => {
                const fi  = det.frameIndex ?? det.frame_index ?? 0;
                const isActive = selectedDet?.id === det.id
                              || (!selectedDet && activeDetection?.id === det.id);
                return (
                  <li key={det.id}>
                    <button
                      className={`ipv-det-item ${isActive ? 'ipv-det-item--active' : ''}`}
                      onClick={() => handleDetClick(det)}
                      aria-pressed={isActive}
                    >
                      <div className="ipv-det-item__thumb" aria-hidden="true">
                        <div className="ipv-det-item__thumb-bg" />
                        <span
                          className="ipv-det-item__sev-dot"
                          style={{
                            background: det.severity === 'Critical' ? 'var(--critical)'
                              : det.severity === 'Major' ? 'var(--major)' : 'var(--minor)',
                          }}
                        />
                      </div>
                      <div className="ipv-det-item__info">
                        <p className="ipv-det-item__cat">{det.category}</p>
                        <p className="ipv-det-item__meta">
                          <Clock size={11} />
                          Ch {(det.chainage ?? det.coord_z ?? 0).toFixed(2)} km
                          {' · '}Fr {fi}
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
