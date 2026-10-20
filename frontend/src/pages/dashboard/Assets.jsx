import { ASSETS } from '../../data/mockData';
import './SharedPages.css';

const TYPE_ICON = { video: '▶', csv: '📊', json: '{}', image: '🖼' };

export default function Assets() {
  return (
    <div className="sp-page">
      <h1 className="sp-title">Assets</h1>
      <p style={{ color: 'var(--db-ink-2)', fontSize: 'var(--text-sm)' }}>
        Project files: inspection videos, detection logs, extracted frames, and reports.
      </p>
      <div className="sp-assets-grid">
        {ASSETS.map(a => (
          <div key={a.id} className="sp-asset-card">
            <div className="sp-asset-card__icon" aria-hidden="true">
              {TYPE_ICON[a.type] || '📁'}
            </div>
            <p className="sp-asset-card__name">{a.name}</p>
            <p className="sp-asset-card__meta">
              {a.type.toUpperCase()}{a.size ? ` · ${a.size}` : ''} · {a.inspectionId}
            </p>
            {a.notes && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--db-ink-3)', lineHeight: 1.5 }}>
                {a.notes}
              </p>
            )}
            <span
              className={`sp-asset-card__status sp-asset-card__status--${a.status}`}
            >
              {a.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
