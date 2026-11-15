import { useEffect, useRef, useState } from 'react';
import './cockpit.css';

/**
 * Overlay for the inspection viewport: a sonar sweep while the scan runs, a ping when a new unique
 * defect is logged, and a chainage tape along the bottom edge.
 */
export function CockpitOverlay({ scanning, detectionCount, chainage, tunnelLength = 250 }) {
  const previous = useRef(detectionCount);
  const [pings, setPings] = useState([]);

  useEffect(() => {
    if (detectionCount > previous.current) {
      const id = Date.now();
      setPings((list) => [...list, id]);
      const t = setTimeout(() => setPings((list) => list.filter((p) => p !== id)), 1600);
      previous.current = detectionCount;
      return () => clearTimeout(t);
    }
    previous.current = detectionCount;
    return undefined;
  }, [detectionCount]);

  const pct = Math.max(0, Math.min(100, (Number(chainage) / tunnelLength) * 100));
  return (
    <div className="cockpit" aria-hidden="true">
      {scanning && <div className="cockpit__sweep" />}
      {pings.map((id) => (
        <div key={id} className="cockpit__ping">
          <span /><span /><b>NEW DEFECT LOGGED</b>
        </div>
      ))}
      <div className="cockpit__tape">
        <div className="cockpit__tape-fill" style={{ width: `${pct}%` }} />
        <div className="cockpit__tape-marker" style={{ left: `${pct}%` }}>{Number(chainage).toFixed(0)} m</div>
        <div className="cockpit__tape-scale"><span>0</span><span>{tunnelLength / 2}</span><span>{tunnelLength} m</span></div>
      </div>
    </div>
  );
}

/** Keyboard help card, toggled with "?". */
export function ShortcutHelp({ open, onClose }) {
  if (!open) return null;
  const rows = [['Space', 'Play or pause the video'], [', and .', 'Step one frame back or forward'], ['S', 'Start the AI scan'], ['Esc', 'Stop the scan'], ['?', 'Show or hide this help']];
  return (
    <div className="cockpit-help" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <dl>{rows.map(([k, v]) => (<div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>))}</dl>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
