import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Volume2, VolumeX, Maximize2, Clock, ChevronRight } from 'lucide-react';
import { INSPECTIONS, DETECTIONS } from '../../data/mockData';
import './InspectionVideos.css';

export default function InspectionVideos() {
  const navigate = useNavigate();
  const [selectedInspection, setSelectedInspection] = useState(INSPECTIONS[0]);
  const [selectedDet, setSelectedDet] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);

  const detections = DETECTIONS.filter(d => d.inspectionId === selectedInspection.id);
  const hasVideo = false; // No video file present in this repo yet

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function handleVideoTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
  }

  function handleSeek(e) {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    v.currentTime = (x / rect.width) * v.duration;
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    playing ? v.pause() : v.play();
    setPlaying(p => !p);
  }

  return (
    <div className="ipv-page">
      {/* ── Inspection selector ── */}
      <div className="ipv-selector">
        <h1 className="ipv-selector__title">Inspection Videos</h1>
        <select
          className="ipv-select"
          value={selectedInspection.id}
          onChange={e => {
            const insp = INSPECTIONS.find(i => i.id === e.target.value);
            setSelectedInspection(insp);
            setSelectedDet(null);
          }}
          aria-label="Select inspection"
        >
          {INSPECTIONS.map(i => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </select>
      </div>

      <div className="ipv-layout">
        {/* ── Video player ── */}
        <div className="ipv-player-col">
          <div className="ipv-player">
            {/* Status bar */}
            <div className="ipv-player__status-bar">
              <span className="ipv-status-dot" />
              <span className="ipv-status-label">
                {hasVideo ? 'LIVE ROV FEED' : 'VIDEO UNAVAILABLE'}
              </span>
              <span className="ipv-status-mode">FILLED TUNNEL MODE — OPERATIONAL</span>
            </div>

            {/* Video element or empty state */}
            <div className="ipv-player__viewport">
              {hasVideo ? (
                <>
                  <video
                    ref={videoRef}
                    className="ipv-video"
                    onTimeUpdate={handleVideoTimeUpdate}
                    onEnded={() => setPlaying(false)}
                    muted={muted}
                    playsInline
                    aria-label="ROV inspection video"
                  />
                  {/* Detection overlay */}
                  {selectedDet && (
                    <div
                      className="ipv-det-overlay"
                      style={{
                        left: `${(selectedDet.bbox.x1 / 640) * 100}%`,
                        top: `${(selectedDet.bbox.y1 / 360) * 100}%`,
                        width: `${((selectedDet.bbox.x2 - selectedDet.bbox.x1) / 640) * 100}%`,
                        height: `${((selectedDet.bbox.y2 - selectedDet.bbox.y1) / 360) * 100}%`,
                      }}
                      aria-label={`Detection: ${selectedDet.category} ${Math.round(selectedDet.confidence * 100)}%`}
                    >
                      <span className="ipv-det-overlay__label">
                        {selectedDet.category.toUpperCase()} {Math.round(selectedDet.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="ipv-empty-state">
                  <div className="ipv-empty-state__inner">
                    <div className="ipv-empty-state__icon" aria-hidden="true">▶</div>
                    <p className="ipv-empty-state__title">No video file available</p>
                    <p className="ipv-empty-state__body">
                      Run inference first to generate an annotated video:
                    </p>
                    <code className="ipv-empty-state__cmd">
                      python ai_pipeline/predict.py --source path/to/rov_video.mp4
                    </code>
                    <p className="ipv-empty-state__hint">
                      Output video appears in <code>runs/predictions/</code>
                    </p>
                  </div>
                </div>
              )}

              {/* ROV telemetry HUD (always visible for context) */}
              <div className="ipv-hud" aria-label="ROV telemetry">
                <span className="ipv-hud__label">ROV-04 "AQUASCAN"</span>
                <span className="ipv-hud__val">
                  Ch {selectedDet ? selectedDet.chainage.toFixed(3) : '—'} km
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="ipv-controls">
              <button
                className="ipv-btn"
                onClick={togglePlay}
                disabled={!hasVideo}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>

              {/* Seek bar */}
              <div
                className="ipv-seekbar"
                onClick={handleSeek}
                role="slider"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Video progress"
                tabIndex={hasVideo ? 0 : -1}
              >
                <div className="ipv-seekbar__fill" style={{ width: `${progress}%` }} />
                <div className="ipv-seekbar__thumb" style={{ left: `${progress}%` }} />
              </div>

              <span className="ipv-time">
                {formatTime(0)} / {selectedInspection.duration}
              </span>

              <button
                className="ipv-btn"
                onClick={() => setMuted(m => !m)}
                disabled={!hasVideo}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <button
                className="ipv-btn"
                disabled={!hasVideo}
                aria-label="Fullscreen"
              >
                <Maximize2 size={18} />
              </button>
            </div>
          </div>

          {/* Inspection metadata */}
          <div className="ipv-meta-row">
            <span><strong>Inspection:</strong> {selectedInspection.id}</span>
            <span><strong>ROV:</strong> {selectedInspection.rov}</span>
            <span><strong>Date:</strong> {selectedInspection.date}</span>
            <span><strong>Duration:</strong> {selectedInspection.duration}</span>
          </div>
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
              {detections.map(det => (
                <li key={det.id}>
                  <button
                    className={`ipv-det-item ${selectedDet?.id === det.id ? 'ipv-det-item--active' : ''}`}
                    onClick={() => setSelectedDet(det === selectedDet ? null : det)}
                    aria-pressed={selectedDet?.id === det.id}
                  >
                    <div className="ipv-det-item__thumb" aria-hidden="true">
                      <div className="ipv-det-item__thumb-bg" />
                      <span
                        className="ipv-det-item__sev-dot"
                        style={{
                          background: det.severity === 'Critical' ? 'var(--critical)' :
                            det.severity === 'Major' ? 'var(--major)' : 'var(--minor)'
                        }}
                      />
                    </div>
                    <div className="ipv-det-item__info">
                      <p className="ipv-det-item__cat">{det.category}</p>
                      <p className="ipv-det-item__meta">
                        <Clock size={11} />
                        Ch {det.chainage.toFixed(2)} km · {det.timestamp}
                      </p>
                    </div>
                    <span className="ipv-det-item__conf">
                      {Math.round(det.confidence * 100)}%
                    </span>
                  </button>
                </li>
              ))}
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
