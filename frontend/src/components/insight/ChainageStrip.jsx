import { chainageOf, TUNNEL_LENGTH_M } from '../../utils/defectHistory';
import './insight.css';

const RANK = { Critical: 3, Major: 2, Minor: 1 };
const COLOR = { 3: '#ff5470', 2: '#ffa43a', 1: '#ffd84a', 0: '#1d4560' };

/** The tunnel unrolled along its length: one bar per 10 m, height = number of defects, colour = worst severity. */
export default function ChainageStrip({ defects, binM = 10 }) {
  const bins = Array.from({ length: Math.ceil(TUNNEL_LENGTH_M / binM) }, () => ({ n: 0, worst: 0 }));
  defects.forEach((d) => {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor(chainageOf(d) / binM)));
    bins[i].n += 1;
    bins[i].worst = Math.max(bins[i].worst, RANK[d.severity] || 1);
  });
  const peak = Math.max(1, ...bins.map((b) => b.n));
  return (
    <figure className="strip" aria-label="Defects along the tunnel">
      <div className="strip__bars">
        {bins.map((b, i) => (
          <span key={i} className="strip__bar" title={`${i * binM}–${(i + 1) * binM} m: ${b.n} defect${b.n === 1 ? '' : 's'}`}
            style={{ height: `${b.n ? 14 + (b.n / peak) * 86 : 6}%`, background: COLOR[b.worst] }} />
        ))}
      </div>
      <div className="strip__axis"><span>0 m (intake)</span><span>{TUNNEL_LENGTH_M / 2} m</span><span>{TUNNEL_LENGTH_M} m</span></div>
    </figure>
  );
}
