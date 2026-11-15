import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { areaOf, lengthOf, siteGrowth, siteOf, timeOf } from '../../utils/defectHistory';
import './insight.css';

const fmtDate = (d) => new Date(timeOf(d)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * Shows how the same physical defect changed over repeated inspections: a before/after slider on the
 * snapshots, and a table with length, area and growth. Renders nothing when the defect was seen only once.
 */
export default function DefectHistory({ detections, currentId }) {
  const [pos, setPos] = useState(50);
  const site = useMemo(() => siteOf(detections, currentId), [detections, currentId]);
  if (!site || site.sightings.length < 2) return null;

  const growth = siteGrowth(site);
  const first = site.sightings[0];
  const last = site.sightings[site.sightings.length - 1];
  const hasImages = first.imageUrl && last.imageUrl;

  return (
    <section className="history dd-card" aria-label="History of this defect" style={{ marginTop: 20 }}>
      <h2 className="dd-historical__title">History across inspections</h2>
      {growth && (
        <p style={{ margin: 0, color: '#d6e8f5' }}>
          Seen in {site.sightings.length} inspections. Its {areaOf(first) ? 'area' : 'length'} changed by{' '}
          <strong className={growth.percent >= 20 ? 'growth-up' : 'growth-flat'}>{growth.percent >= 0 ? '+' : ''}{growth.percent}%</strong>{' '}
          between {fmtDate(first)} and {fmtDate(last)}.
        </p>
      )}
      {hasImages && (
        <div className="compare" style={{ '--pos': `${pos}%` }}>
          <img src={first.imageUrl} alt={`Defect on ${fmtDate(first)}`} />
          <img className="compare__after" src={last.imageUrl} alt={`Defect on ${fmtDate(last)}`} />
          <span className="compare__tag compare__tag--l">{fmtDate(first)}</span>
          <span className="compare__tag compare__tag--r">{fmtDate(last)}</span>
          <div className="compare__handle" />
          <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Slide between the first and the latest inspection" />
        </div>
      )}
      <table className="growth-table">
        <thead><tr><th>Date</th><th>Inspection</th><th>Length</th><th>Area</th><th>Severity</th></tr></thead>
        <tbody>
          {site.sightings.map((d) => (
            <tr key={d.id} style={d.id === currentId ? { background: 'rgba(95,208,255,.08)' } : undefined}>
              <td>{fmtDate(d)}</td>
              <td>{d.id === currentId ? d.inspectionId : <Link to={`/dashboard/detections/${d.id}`}>{d.inspectionId}</Link>}</td>
              <td>{lengthOf(d) ? `${lengthOf(d)} mm` : '—'}</td>
              <td>{areaOf(d) ? `${areaOf(d).toLocaleString()} mm²` : '—'}</td>
              <td>{d.severity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
