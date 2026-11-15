import './ui.css';

/** Concentric rings that pulse outwards like a sonar ping. Decorative. */
export function SonarRings({ className = '' }) {
  return (
    <div className={`sonar ${className}`} aria-hidden="true">
      <span /><span /><span /><i />
    </div>
  );
}

/** Shown while a free-tier server wakes up (first request after idle time can take about 30 seconds). */
export function WakeNotice({ children = 'The server is waking up (free hosting). This can take up to 30 seconds…' }) {
  return (
    <div className="wake" role="status" aria-live="polite">
      <SonarRings className="sonar--small" />
      <span>{children}</span>
    </div>
  );
}
