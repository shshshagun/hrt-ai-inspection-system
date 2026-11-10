import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, AlertTriangle, ShieldAlert, Activity, Eye, Compass, X } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis
} from 'recharts';
import {
  KPI_SUMMARY, DEFECT_TYPE_DISTRIBUTION, INSPECTIONS, DETECTIONS
} from '../../data/mockData';
import { useKpiSummary, useDetections, useDefectDistributions } from '../../hooks/useApi';
import './DashboardOverview.css';

const ACTIVITY_DATA = [
  { time: '08:00', detections: 3 },
  { time: '10:00', detections: 7 },
  { time: '12:00', detections: 2 },
  { time: '14:00', detections: 11 },
  { time: '16:00', detections: 5 },
];

function KpiCard({ label, value, unit, Icon, color, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__icon" style={{ color }}>
        <Icon size={18} />
      </div>
      <div className="kpi-card__body">
        <p className="kpi-card__label">{label}</p>
        <p className="kpi-card__value">
          {value}
          {unit && <span className="kpi-card__unit">{unit}</span>}
        </p>
        {sub && <p className="kpi-card__sub">{sub}</p>}
      </div>
    </div>
  );
}

function SeverityDot({ level }) {
  const colors = {
    Critical: 'var(--critical)',
    Major:    'var(--major)',
    Minor:    'var(--minor)',
    Info:     'var(--info)',
    pending:  'var(--minor)',
    confirmed:'var(--info)',
    flagged:  'var(--critical)',
  };
  return (
    <span
      className="severity-dot"
      style={{ background: colors[level] || 'var(--db-ink-3)' }}
      aria-hidden="true"
    />
  );
}

export default function DashboardOverview() {
  const navigate = useNavigate();

  // Module 8 — live API data directly from MongoDB
  const { data: dets } = useDetections();
  const detData = dets ?? [];

  const totalDefects = detData.length;
  const criticalCount = detData.filter(d => d.severity === 'Critical').length;
  const maxChainageM = detData.length > 0
    ? Math.max(...detData.map(d => Number(d.chainage_m || d.chainage || d.z || 0)))
    : 0;
  const inspectedKm = (maxChainageM / 1000).toFixed(2);
  const totalKm = 27.3;
  const pct = maxChainageM > 0 ? Math.min(100, Math.round((maxChainageM / (totalKm * 1000)) * 100)) : 0;

  const recentDets = detData.slice(0, 3);
  const [activeDefectMarker, setActiveDefectMarker] = useState(null);

  const typeDistributionData = [
    { name: 'Cracks', value: detData.filter(d => (d.class_label || d.category || '').toLowerCase().includes('crack')).length, color: '#ef4444' },
    { name: 'Spalling', value: detData.filter(d => (d.class_label || d.category || '').toLowerCase().includes('spall')).length, color: '#ff9500' },
    { name: 'Leakage', value: detData.filter(d => (d.class_label || d.category || '').toLowerCase().includes('leak')).length, color: '#eab308' },
    { name: 'Erosion', value: detData.filter(d => (d.class_label || d.category || '').toLowerCase().includes('eros')).length, color: '#00d4ff' },
  ];

  const schematicDefects = detData.slice(0, 6).map((d, i) => {
    const angle = ((d.coordinates?.x || 0) !== 0 || (d.coordinates?.y || 0) !== 0)
      ? Math.atan2(d.coordinates?.x || 0, d.coordinates?.y || 2.95)
      : (i * (Math.PI / 3));
    const r = 38; // percentage radius in tunnel circle
    const top = `${50 - Math.cos(angle) * r}%`;
    const left = `${50 + Math.sin(angle) * r}%`;
    return {
      id: d.id || d._id || `DET-${i + 1}`,
      type: d.category || d.class_label || 'Defect',
      severity: d.severity || 'Minor',
      chainage: Number(d.chainage_m || d.chainage || d.z || 0).toFixed(1),
      confidence: d.confidence || 0.88,
      top,
      left,
      color: d.severity === 'Critical' ? 'var(--critical)' : d.severity === 'Major' ? 'var(--major)' : 'var(--minor)',
      cssClass: (d.severity || 'minor').toLowerCase(),
    };
  });

  return (
    <div className="db-overview">
      {/* ── Page heading ── */}
      <header className="db-overview__header">
        <div>
          <p className="db-overview__greeting">Good morning,</p>
          <h1 className="db-overview__title">Welcome to HRT</h1>
          <p className="db-overview__sub">
            AI-powered inspection for safer, more resilient hydropower infrastructure.
          </p>
        </div>
      </header>

      {/* ── KPIs ── */}
      <section className="db-overview__kpis" aria-label="Key performance indicators">
        <KpiCard
          label="Total Inspections"
          value={detData.length > 0 ? 1 : 0}
          Icon={Activity}
          color="var(--teal)"
        />
        <KpiCard
          label="Defects Detected"
          value={totalDefects}
          Icon={AlertTriangle}
          color="var(--major)"
          sub="From live MongoDB pipeline"
        />
        <KpiCard
          label="Critical Defects"
          value={criticalCount}
          Icon={ShieldAlert}
          color="var(--critical)"
          sub={criticalCount > 0 ? "Requires review" : "No critical breaches"}
        />
        <KpiCard
          label="Tunnel Coverage"
          value={`${pct}%`}
          unit=""
          Icon={Activity}
          color="var(--info)"
          sub={`${inspectedKm} / ${totalKm} km`}
        />
      </section>

      {/* ── Middle row: tunnel overview + defect types ── */}
      <div className="db-overview__mid">
        {/* Tunnel overview */}
        <section className="db-card db-overview__tunnel" aria-label="Tunnel overview">
          <header className="db-card__header">
            <h2 className="db-card__title">Tunnel Overview</h2>
            <div className="db-card__legend">
              <span className="db-legend-item"><span className="db-legend-dot" style={{background:'var(--critical)'}} />Critical</span>
              <span className="db-legend-item"><span className="db-legend-dot" style={{background:'var(--major)'}} />Major</span>
              <span className="db-legend-item"><span className="db-legend-dot" style={{background:'var(--minor)'}} />Minor</span>
            </div>
          </header>

          {/* CSS tunnel cross-section schematic */}
          <div className="db-tunnel-schematic" aria-label="Tunnel cross-section diagram">
            <div className="db-tunnel-schematic__ring db-tunnel-schematic__ring--outer" />
            <div className="db-tunnel-schematic__ring db-tunnel-schematic__ring--mid" />
            <div className="db-tunnel-schematic__ring db-tunnel-schematic__ring--inner" />
            <div className="db-tunnel-schematic__axis" />

            {/* Interactive Defect markers */}
            {schematicDefects.map(d => {
              const isSelected = activeDefectMarker?.id === d.id;
              return (
                <button
                  key={d.id}
                  className={`db-defect-marker ${isSelected ? 'db-defect-marker--selected' : ''}`}
                  style={{ top: d.top, left: d.left }}
                  title={`${d.id} — ${d.severity} ${d.type} (Click to inspect)`}
                  aria-label={`${d.severity} defect at Ch ${d.chainage}km`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDefectMarker(isSelected ? null : d);
                  }}
                  onDoubleClick={() => navigate(`/dashboard/detections/${d.id}`)}
                >
                  <span className={`db-defect-marker__dot db-defect-marker__dot--${d.cssClass}`} />
                  <span className={`db-defect-marker__pulse db-defect-marker__pulse--${d.cssClass}`} />
                </button>
              );
            })}

            {/* In-schematic Floating Popover with Smart Clamped Position */}
            {activeDefectMarker && (
              <div
                className="db-defect-popover"
                style={{
                  top: parseFloat(activeDefectMarker.top) <= 50 ? `calc(${activeDefectMarker.top} + 22px)` : `calc(${activeDefectMarker.top} - 130px)`,
                  left: `clamp(12px, calc(${activeDefectMarker.left} - 90px), calc(100% - 220px))`,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div className="db-defect-popover__header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: activeDefectMarker.color,
                        flexShrink: 0
                      }}
                    />
                    <strong className="db-defect-popover__id">{activeDefectMarker.id}</strong>
                  </div>
                  <button
                    className="db-defect-popover__close"
                    onClick={() => setActiveDefectMarker(null)}
                    aria-label="Close defect card"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div className="db-defect-popover__body">
                  <div className="db-defect-popover__type">{activeDefectMarker.type}</div>
                  <div className="db-defect-popover__meta">
                    <span style={{ color: activeDefectMarker.color, fontWeight: 700 }}>{activeDefectMarker.severity.toUpperCase()}</span>
                    <span> &bull; Ch {activeDefectMarker.chainage.toFixed(2)} km</span>
                    <span> &bull; {Math.round(activeDefectMarker.confidence * 100)}% Conf</span>
                  </div>
                </div>

                <div className="db-defect-popover__actions">
                  <button
                    className="db-defect-popover__btn db-defect-popover__btn--details"
                    onClick={() => navigate(`/dashboard/detections/${activeDefectMarker.id}`)}
                  >
                    <Eye size={12} /> Inspect
                  </button>
                  <button
                    className="db-defect-popover__btn db-defect-popover__btn--twin"
                    onClick={() => navigate('/tunnel-twin')}
                  >
                    <Compass size={12} /> 3D Rover
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active Defect Quick Inspector Card */}
          {activeDefectMarker ? (
            <div
              className="db-tunnel-active-banner"
              style={{
                background: 'rgba(15, 23, 42, 0.95)',
                border: `1px solid ${activeDefectMarker.color}80`,
                borderRadius: '6px',
                padding: '10px 14px',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: activeDefectMarker.color,
                    boxShadow: `0 0 8px ${activeDefectMarker.color}`,
                    flexShrink: 0
                  }}
                />
                <div>
                  <strong style={{ color: '#f8fafc', fontSize: '0.88rem' }}>
                    {activeDefectMarker.id} &middot; {activeDefectMarker.type}
                  </strong>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    <span style={{ color: activeDefectMarker.color, fontWeight: 700 }}>{activeDefectMarker.severity.toUpperCase()}</span>
                    <span> &bull; Location: Ch {activeDefectMarker.chainage.toFixed(2)} km &bull; Confidence: {Math.round(activeDefectMarker.confidence * 100)}%</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => navigate(`/dashboard/detections/${activeDefectMarker.id}`)}
                  style={{
                    background: '#0d9488',
                    color: '#ffffff',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Eye size={12} /> Inspect Defect &rarr;
                </button>
                <button
                  onClick={() => navigate('/tunnel-twin')}
                  style={{
                    background: '#1e293b',
                    color: '#38bdf8',
                    border: '1px solid #38bdf8',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Compass size={12} /> 3D Rover
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.74rem', color: '#64748b', textAlign: 'center', marginBottom: '10px', letterSpacing: '0.02em' }}>
              &uarr; Click on any defect marker above to inspect defect details or launch 3D twin
            </div>
          )}

          <div className="db-tunnel-meta">
            <span>Tunnel length: <strong>27.3 km</strong></span>
            <span>Inspected: <strong className="db-tunnel-meta__inspected">22.1 km ({pct}%)</strong></span>
          </div>
          <div className="db-tunnel-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="db-tunnel-progress__fill" style={{ width: `${pct}%` }} />
          </div>
        </section>

        {/* Defect types chart */}
        <section className="db-card db-overview__defects" aria-label="Defect type distribution">
          <header className="db-card__header">
            <h2 className="db-card__title">Defect Types</h2>
          </header>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={typeDistributionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={88}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {typeDistributionData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#0d1117',
                  border: '1px solid rgba(0,212,255,0.2)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="db-donut-legend" aria-label="Defect type legend">
            {typeDistributionData.map(d => (
              <li key={d.name} className="db-donut-legend__item">
                <span className="db-donut-legend__swatch" style={{ background: d.color }} />
                <span className="db-donut-legend__label">{d.name}</span>
                <span className="db-donut-legend__count">{d.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── Bottom row: recent detections + latest inspection ── */}
      <div className="db-overview__bottom">
        {/* Recent detections */}
        <section className="db-card db-overview__recent" aria-label="Recent detections">
          <header className="db-card__header">
            <h2 className="db-card__title">Recent Detections</h2>
            <button
              className="db-link-btn"
              onClick={() => navigate('/dashboard/detections')}
              aria-label="View all detections"
            >
              View all <ArrowUpRight size={14} />
            </button>
          </header>
          <div className="db-recent-grid">
            {recentDets.map(d => (
              <button
                key={d.id}
                className="db-recent-card"
                onClick={() => navigate(`/dashboard/detections/${d.id}`)}
                aria-label={`${d.category} — ${d.confidence * 100}% confidence`}
              >
                <div className="db-recent-card__thumb" aria-hidden="true">
                  <div className="db-recent-card__thumbnail-bg" />
                  <SeverityDot level={d.severity} />
                </div>
                <p className="db-recent-card__category">{d.category.toUpperCase()}</p>
                <p className="db-recent-card__conf">{Math.round(d.confidence * 100)}% confidence</p>
                <p className="db-recent-card__date">
                  {new Date(d.detectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Latest inspection */}
        <section className="db-card db-overview__latest" aria-label="Latest inspection">
          <p className="db-card__eyebrow-avoid-style">Latest Inspection</p>
          <div className="db-latest-thumb" aria-hidden="true">
            <div className="db-latest-thumb__inner" />
            <span className="db-latest-thumb__play" aria-label="No video available">▶</span>
          </div>
          <h3 className="db-latest__name">{INSPECTIONS[0].label}</h3>
          <p className="db-latest__meta">
            {new Date(INSPECTIONS[0].date).toLocaleDateString('en-IN', {
              month: 'short', day: 'numeric', year: 'numeric'
            })}
            {' · '}
            {INSPECTIONS[0].totalDetections} detections
          </p>
          <button
            className="db-btn-primary"
            onClick={() => navigate('/dashboard/inspections')}
            id="dashboard-view-inspection-btn"
          >
            View Details
          </button>
        </section>
      </div>

      {/* ── Detection activity bar chart ── */}
      <section className="db-card db-overview__activity" aria-label="Detection activity today">
        <header className="db-card__header">
          <h2 className="db-card__title">Detection Activity (sample timeline)</h2>
        </header>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={ACTIVITY_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: 'var(--db-ink-3)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--db-ink-3)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: '#fff',
                border: '1px solid var(--db-border)',
                borderRadius: '4px',
                fontSize: '0.8rem',
              }}
            />
            <Bar dataKey="detections" fill="var(--teal)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
