import { useNavigate } from 'react-router-dom';
import { INSPECTIONS } from '../../data/mockData';
import './SharedPages.css';

export default function Inspections() {
  const navigate = useNavigate();
  const statusColor = { completed: 'var(--teal)', pending: 'var(--minor)', in_progress: 'var(--info)' };

  return (
    <div className="sp-page">
      <h1 className="sp-title">Inspections</h1>
      <div className="sp-table-wrap">
        <table className="sp-table" aria-label="Inspections list">
          <thead>
            <tr>
              <th className="sp-th">ID</th>
              <th className="sp-th">Label</th>
              <th className="sp-th">Date</th>
              <th className="sp-th">ROV</th>
              <th className="sp-th">Coverage</th>
              <th className="sp-th">Detections</th>
              <th className="sp-th">Status</th>
              <th className="sp-th" />
            </tr>
          </thead>
          <tbody>
            {INSPECTIONS.map(insp => (
              <tr
                key={insp.id}
                className="sp-tr"
                onClick={() => navigate('/dashboard/inspections/videos')}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate('/dashboard/inspections/videos')}
                aria-label={`Open inspection ${insp.id}`}
              >
                <td className="sp-td sp-td--mono">{insp.id}</td>
                <td className="sp-td sp-td--name">{insp.label}</td>
                <td className="sp-td">{insp.date}</td>
                <td className="sp-td">{insp.rov}</td>
                <td className="sp-td">{insp.coverageKm} km</td>
                <td className="sp-td sp-td--num">{insp.totalDetections}</td>
                <td className="sp-td">
                  <span
                    className="sp-badge"
                    style={{ color: statusColor[insp.status] || 'var(--db-ink-3)', borderColor: statusColor[insp.status] || 'var(--db-border)' }}
                  >
                    {insp.status}
                  </span>
                </td>
                <td className="sp-td sp-td--arrow">→</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
