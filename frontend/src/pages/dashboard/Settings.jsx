import { useState } from 'react';
import './SharedPages.css';

export default function Settings() {
  const [confThresh, setConfThresh] = useState('0.35');
  const [iouThresh, setIouThresh]   = useState('0.45');
  const [playbackSpeed, setPlaybackSpeed] = useState('1.0');
  const [saved, setSaved] = useState(false);

  function handleSave(e) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="sp-page">
      <h1 className="sp-title">Settings</h1>
      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)' }}>
        Application configuration. Settings marked with ★ require backend support to apply.
      </p>
      <form onSubmit={handleSave}>
        <div className="sp-settings-grid">

          {/* User preferences */}
          <div className="sp-settings-card">
            <h2 className="sp-settings-card__title">User Preferences</h2>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-name">Display Name</label>
              <input
                id="s-name"
                type="text"
                className="sp-input"
                defaultValue="John Doe"
                aria-label="Display name"
              />
            </div>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-role">Role</label>
              <input
                id="s-role"
                type="text"
                className="sp-input"
                defaultValue="Inspector"
                aria-label="User role"
              />
            </div>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-speed">Video Playback Speed</label>
              <select
                id="s-speed"
                className="sp-input"
                value={playbackSpeed}
                onChange={e => setPlaybackSpeed(e.target.value)}
                aria-label="Video playback speed"
              >
                <option value="0.5">0.5×</option>
                <option value="1.0">1.0×</option>
                <option value="1.5">1.5×</option>
                <option value="2.0">2.0×</option>
              </select>
            </div>
          </div>

          {/* AI detection configuration */}
          <div className="sp-settings-card">
            <h2 className="sp-settings-card__title">AI Detection Configuration ★</h2>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-conf">Confidence Threshold</label>
              <input
                id="s-conf"
                type="number"
                className="sp-input"
                min="0.1" max="1.0" step="0.05"
                value={confThresh}
                onChange={e => setConfThresh(e.target.value)}
                aria-label="Confidence threshold"
              />
            </div>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-iou">IoU Threshold</label>
              <input
                id="s-iou"
                type="number"
                className="sp-input"
                min="0.1" max="1.0" step="0.05"
                value={iouThresh}
                onChange={e => setIouThresh(e.target.value)}
                aria-label="IoU threshold"
              />
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--db-ink-3)' }}>
              Changes here are stored locally. To apply to inference, pass as CLI flags:<br />
              <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
                --conf {confThresh} --iou {iouThresh}
              </code>
            </p>
          </div>

          {/* AI model info */}
          <div className="sp-settings-card">
            <h2 className="sp-settings-card__title">AI Model</h2>
            {[
              ['Model',         'YOLOv8s-HRT-V3 (Custom)'],
              ['Architecture',  'YOLOv8s (small)'],
              ['Parameters',    '~11.2M'],
              ['Input size',    '640 × 640'],
              ['Training data', 'Roboflow — Underwater Crack v3'],
              ['Classes',       'crack'],
            ].map(([k, v]) => (
              <div key={k} className="sp-info-row">
                <span className="sp-info-key">{k}</span>
                <span className="sp-info-val">{v}</span>
              </div>
            ))}
          </div>

          {/* API configuration */}
          <div className="sp-settings-card">
            <h2 className="sp-settings-card__title">Backend API ★</h2>
            <div className="sp-form-row">
              <label className="sp-label" htmlFor="s-api">API Base URL</label>
              <input
                id="s-api"
                type="url"
                className="sp-input"
                defaultValue="http://localhost:3000/api"
                aria-label="Backend API URL"
              />
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--db-ink-3)', lineHeight: 1.5 }}>
              The backend REST API (Node.js/Express) serves detection records at
              <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}> POST /api/detections</code>.
              Deploy the API before enabling live data.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <button type="submit" className="sp-save-btn" id="settings-save-btn">
            Save Preferences
          </button>
          {saved && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--teal)', fontWeight: 600 }}>
              ✓ Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
