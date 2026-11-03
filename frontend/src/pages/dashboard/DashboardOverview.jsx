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

const HOURS = ['08:00','10:00','12:00','14:00','16:00'];
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

  // Module 8 — live API data with graceful fallbacks
  const { data: kpi }   = useKpiSummary();
  const { data: dists } = useDefectDistributions();
  const { data: dets }  = useDetections();

  const kpiData    = kpi   ?? KPI_SUMMARY;
  const distData   = dists ?? { typeDistribution: DEFECT_TYPE_DISTRIBUTION };
  const detData    = dets  ?? DETECTIONS;

  const pct        = Math.round((kpiData.inspectedKm / kpiData.tunnelLengthKm) * 100);
  const recentDets = detData.slice(0, 3);
  const [activeDefectMarker, setActiveDefectMarker] = useState(null);

  const schematicDefects = [
    {
      id: 'DET-4782',
      type: 'Structural Crack',
      severity: 'Critical',
      chainage: 2.14,
      confidence: 0.92,
      top: '38%',
      left: '28%',
      color: 'var(--critical)',
      cssClass: 'critical',
    },
    {
      id: 'DET-4781',
      type: 'Surface Spalling',
      severity: 'Major',
      chainage: 2.43,
      confidence: 0.87,
      top: '60%',
      left: '58%',
      color: 'var(--major)',
      cssClass: 'major',
    },
    {
      id: 'DET-4780',
      type: 'Seepage / Leakage',
      severity: 'Minor',
      chainage: 3.12,
      confidence: 0.81,
      top: '25%',
      left: '68%',
      color: 'var(--minor)',
      cssClass: 'minor',
    },
  ];

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
          value={kpiData.totalInspections}
          Icon={Activity}
          color="var(--teal)"
        />
        <KpiCard
          label="Defects Detected"
          value={kpiData.defectsDetected}
          Icon={AlertTriangle}
          color="var(--major)"
          sub="From detections API"
        />
        <KpiCard
          label="Critical Defects"
          value={kpiData.criticalDefects}
          Icon={ShieldAlert}
          color="var(--critical)"
          sub="Requires review"
        />
        <KpiCard
          label="Tunnel Coverage"
          value={`${pct}%`}
          unit=""
          Icon={Activity}
          color="var(--info)"
          sub={`${kpiData.inspectedKm} / ${kpiData.tunnelLengthKm} km`}
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
                  className={`db-defect-marker db-defect-marker--${d.cssClass} ${isSelected ? 'db-defect-marker--selected' : ''}`}
                  style={{ top: d.top, left: d.left }}
                  title={`${d.id} — ${d.severity} ${d.type}`}
                  aria-label={`${d.severity} defect at Ch ${d.chainage}km`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDefectMarker(isSelected ? null : d);
                  }}
                >
                  <span className="db-defect-marker__pulse" />
                </button>
              );
            })}

            {/* Interactive Defect Telemetry Popover */}
            {activeDefectMarker && (
              <div
                className="db-defect-popover"
                style={{
                  top: `calc(${activeDefectMarker.top} - 120px)`,
                  left: `calc(${activeDefectMarker.left} - 60px)`,
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
                    <Eye size={12} /> Details
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
                data={distData.typeDistribution}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={88}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {distData.typeDistribution.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid var(--db-border)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="db-donut-legend" aria-label="Defect type legend">
            {distData.typeDistribution.map(d => (
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
