import { useNavigate } from 'react-router-dom';
import { angleOf, areaOf, chainageOf, TUNNEL_LENGTH_M } from '../../utils/defectHistory';
import './insight.css';

const SEVERITY_COLOR = { Critical: '#ff5470', Major: '#ffa43a', Minor: '#ffd84a' };
const C = 160;       // centre of the 320 x 320 drawing
const R_IN = 34;     // radius at the intake
const R_OUT = 138;   // radius at the far end
const RINGS = [50, 100, 150, 200, 250];

/**
 * The tunnel seen end-on, like a sonar scope: the angle is the clock position around the lining
 * (12 o'clock = crown at the top) and the distance from the centre is the chainage (intake in the middle).
 */
export default function TunnelRadar({ defects, onSelect, focus = null, window: windowM = 15 }) {
  const navigate = useNavigate();
  const point = (angleDeg, z, extra = 0) => {
    const r = R_IN + Math.min(1, z / TUNNEL_LENGTH_M) * (R_OUT - R_IN) + extra;
    const a = (angleDeg * Math.PI) / 180;
    return [C + Math.sin(a) * r, C - Math.cos(a) * r];
  };
  const open = (d) => (onSelect ? onSelect(d) : navigate(`/dashboard/detections/${d.id}`));

  return (
    <figure className="radar">
      <svg viewBox="-20 -20 360 360" role="img" aria-describedby="radar-desc">
        <desc id="radar-desc">Each dot is a defect. Angle is the clock position on the tunnel lining; distance from the centre is the chainage.</desc>
        <defs>
          <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#0c3550" /><stop offset="100%" stopColor="#06131f" /></radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#5fd0ff" stopOpacity="0" /><stop offset="100%" stopColor="#5fd0ff" stopOpacity=".5" /></linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R_OUT + 14} fill="url(#radar-bg)" stroke="#2a5a7a" />
        {RINGS.map((m) => {
          const r = R_IN + (m / TUNNEL_LENGTH_M) * (R_OUT - R_IN);
          return (
            <g key={m}>
              <circle cx={C} cy={C} r={r} fill="none" stroke="#1f4b69" strokeDasharray="2 4" />
              <text x={C + 3} y={C - r - 2} className="radar__ring-label">{m} m</text>
            </g>
          );
        })}
        {Array.from({ length: 12 }, (_, h) => {
          const [x1, y1] = point(h * 30, 0);
          const [x2, y2] = point(h * 30, TUNNEL_LENGTH_M);
          const [lx, ly] = point(h * 30, TUNNEL_LENGTH_M, 24);
          return (
            <g key={h}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#16384f" />
              <text x={lx} y={ly + 4} textAnchor="middle" className="radar__hour">{h === 0 ? 12 : h}</text>
            </g>
          );
        })}
        <g className="radar__sweep" style={{ transformOrigin: `${C}px ${C}px` }}>
          <path d={`M ${C} ${C} L ${C} ${C - R_OUT - 14} A ${R_OUT + 14} ${R_OUT + 14} 0 0 0 ${C - 58} ${C - (R_OUT + 14) * 0.93} Z`} fill="url(#radar-sweep)" />
        </g>
        {focus != null && (
          <circle cx={C} cy={C} r={R_IN + Math.min(1, focus / TUNNEL_LENGTH_M) * (R_OUT - R_IN)} fill="none" stroke="#8fd3ff" strokeWidth="2" className="radar__focus" />
        )}
        <circle cx={C} cy={C} r="3" fill="#5fd0ff" />
        {defects.map((d) => {
          const [x, y] = point(angleOf(d), chainageOf(d));
          const size = 3.5 + Math.min(5, Math.sqrt(areaOf(d) || 600) / 12);
          const color = SEVERITY_COLOR[d.severity] || '#8fd8ff';
          return (
            <g key={d.id} className="radar__dot" tabIndex={0} role="link" opacity={focus == null || Math.abs(chainageOf(d) - focus) <= windowM ? 1 : 0.28}
              aria-label={`${d.severity} ${d.category}, ${chainageOf(d).toFixed(0)} metres`}
              onClick={() => open(d)} onKeyDown={(e) => { if (e.key === 'Enter') open(d); }}>
              <circle cx={x} cy={y} r={size + 5} fill={color} opacity=".16" />
              <circle cx={x} cy={y} r={size} fill={color} stroke="#06131f" strokeWidth="1.2" />
              <title>{`${d.severity} ${d.category} · ${chainageOf(d).toFixed(1)} m · ${d.orientation || ''}`}</title>
            </g>
          );
        })}
      </svg>
      <figcaption>Clock position (angle) and chainage (distance from the centre). Click a dot to open the defect.</figcaption>
    </figure>
  );
}
