import { useRef } from 'react';
import { chainageOf, TUNNEL_LENGTH_M } from '../../utils/defectHistory';
import './console.css';

const RANK = { Critical: 3, Major: 2, Minor: 1 };
const SEV_CLASS = { 3: 'critical', 2: 'major', 1: 'minor' };

/**
 * The tunnel as a ruler (0 to 250 m). Defects are ticks coloured by severity and the marker can be dragged
 * or moved with the arrow keys. KPIs hang from the ruler underneath it.
 */
export default function ChainageScrubber({ defects, value, onChange, kpis = [] }) {
  const trackRef = useRef(null);

  const setFromPointer = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round(p * TUNNEL_LENGTH_M * 2) / 2);
  };
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX);
  };
  const onPointerMove = (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e.clientX); };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 10 : 1;
    const next = { ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step, Home: 0, End: TUNNEL_LENGTH_M, PageUp: value + 25, PageDown: value - 25 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(Math.min(TUNNEL_LENGTH_M, Math.max(0, next)));
  };

  return (
    <div className="sc">
      <div
        className="sc__track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Chainage"
        aria-valuemin={0}
        aria-valuemax={TUNNEL_LENGTH_M}
        aria-valuenow={value}
        aria-valuetext={`${value} metres from the intake`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="sc__ticks" aria-hidden="true">
          {Array.from({ length: TUNNEL_LENGTH_M / 5 + 1 }, (_, i) => (
            <i key={i} className={i % 10 === 0 ? 'major' : i % 2 === 0 ? 'mid' : ''}>{i % 10 === 0 && <em>{i * 5}</em>}</i>
          ))}
        </div>
        <div className="sc__defects" aria-hidden="true">
          {defects.map((d) => {
            const rank = RANK[d.severity] || 1;
            return <b key={d.id} className={`sc__defect sc__defect--${SEV_CLASS[rank]}`} style={{ left: `${(chainageOf(d) / TUNNEL_LENGTH_M) * 100}%`, height: `${12 + rank * 8}px` }} />;
          })}
        </div>
        <div className="sc__marker" style={{ left: `${(value / TUNNEL_LENGTH_M) * 100}%` }} aria-hidden="true">
          <span>{value.toFixed(value % 1 ? 1 : 0)} m</span>
        </div>
      </div>
      {kpis.length > 0 && (
        <ul className="sc__kpis">
          {kpis.map((k) => (
            <li key={k.label}>
              <b>{k.value}{k.unit && <small>{k.unit}</small>}</b>
              <span>{k.label}</span>
              {k.sub && <em>{k.sub}</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
