import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Compass } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useDetections, useInspections } from '../../hooks/useApi';
import { useAuth } from '../../auth/useAuth';
import CountUp from '../../components/insight/CountUp';
import TunnelRadar from '../../components/insight/TunnelRadar';
import ChainageStrip from '../../components/insight/ChainageStrip';
import ChainageScrubber from '../../components/insight/ChainageScrubber';
import WhatChanged from '../../components/insight/WhatChanged';
import Skeleton from '../../ui/Skeleton';
import { buildBrief, chainageOf, TUNNEL_LENGTH_M } from '../../utils/defectHistory';
import '../../components/insight/insight.css';
import '../../components/insight/console.css';
import './DashboardOverview.css';

const MiniTwin = lazy(() => import('../../components/insight/MiniTwin'));
const WINDOW_M = 15; // defects within this distance of the marker count as "near"

const TYPE_COLORS = { Cracks: '#ff5d5d', Spalling: '#ffb347', Leakage: '#ffd66b', Erosion: '#8fd3ff' };

export default function DashboardOverview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: dets, loading: detsLoading } = useDetections();
  const detData = useMemo(() => dets ?? [], [dets]);
  const { data: rawInspections } = useInspections();
  const inspections = useMemo(() => rawInspections || [], [rawInspections]);

  const [chainage, setChainage] = useState(TUNNEL_LENGTH_M / 2);

  const total = detData.length;
  const critical = detData.filter((d) => d.severity === 'Critical').length;
  const maxChainage = total ? Math.max(...detData.map(chainageOf)) : 0;
  const coverage = Math.min(100, Math.round((maxChainage / TUNNEL_LENGTH_M) * 100));
  const [hour] = useState(() => new Date().getHours());
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (user?.name || '').split(' ')[0];
  const brief = useMemo(() => buildBrief(detData), [detData]);

  const near = useMemo(() => detData
    .map((d) => ({ d, gap: Math.abs(chainageOf(d) - chainage) }))
    .filter((x) => x.gap <= WINDOW_M)
    .sort((a, b) => a.gap - b.gap), [detData, chainage]);

  const kpis = [
    { label: 'Inspections', value: <CountUp value={inspections.length} />, sub: 'sessions on record' },
    { label: 'Defects', value: <CountUp value={total} />, sub: 'across all inspections' },
    { label: 'Critical', value: <CountUp value={critical} />, sub: critical ? 'need an engineer review' : 'none right now' },
    { label: 'Coverage', value: <CountUp value={coverage} />, unit: '%', sub: `${Math.round(maxChainage)} of ${TUNNEL_LENGTH_M} m` },
  ];

  const typeData = ['Cracks', 'Spalling', 'Leakage', 'Erosion'].map((name) => ({
    name,
    value: detData.filter((d) => (d.class_label || d.category || '').toLowerCase().includes(name.toLowerCase().slice(0, 5))).length,
    color: TYPE_COLORS[name],
  }));
  const recent = detData.slice(0, 3);

  return (
    <div className="db-overview">
      <header className="db-overview__header">
        <div>
          <p className="db-overview__greeting">{greeting}{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="db-overview__title">The tunnel, end to end</h1>
          <p className="db-overview__sub">Drag the marker along the ruler. The cross-section, the 3D view and the defect list follow it.</p>
        </div>
      </header>

      <ChainageScrubber defects={detData} value={chainage} onChange={setChainage} kpis={kpis} />

      <WhatChanged detections={detData} onJump={setChainage} />

      <div className="console-grid">
        <section className="console-panel" aria-label="Tunnel cross-section">
          <h2>Cross-section</h2>
          {detsLoading && !detData.length ? (
            <Skeleton height={320} style={{ borderRadius: '50%', maxWidth: 320 }} />
          ) : (
            <>
              <TunnelRadar defects={detData} focus={chainage} window={WINDOW_M} />
              <ChainageStrip defects={detData} />
            </>
          )}
        </section>

        <section className="console-panel" aria-label={`Inside the tunnel at ${chainage} metres`}>
          <h2>Inside, at {chainage} m</h2>
          <Suspense fallback={<Skeleton height={260} />}>
            <MiniTwin chainage={chainage} defects={detData} height={260} />
          </Suspense>
          {near.length ? (
            <ul className="near" aria-label="Defects near the marker">
              {near.slice(0, 5).map(({ d, gap }) => (
                <li key={d.id}>
                  <Link to={`/dashboard/detections/${d.id}`}>
                    <i className={(d.severity || 'Minor').toLowerCase()} />
                    <span>{d.category} <small>{chainageOf(d).toFixed(1)} m</small></span>
                    <small>{gap < 0.5 ? 'here' : `${gap.toFixed(1)} m away`}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="near__empty">No defects within {WINDOW_M} m of this point.</p>
          )}
          <Link className="console-link" to={`/tunnel-twin?chainage=${chainage}`}><Compass size={15} /> Open the full 3D twin here</Link>
        </section>
      </div>

      <div className="console-grid">
        <section className="console-panel" aria-label="Summary">
          <h2>Brief</h2>
          <ul className="brief-list">{brief.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>

        <section className="console-panel" aria-label="Defect types">
          <h2>Defect types</h2>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={typeData} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
                {typeData.map((e) => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--db-surface)', border: '1px solid var(--db-border)', borderRadius: 6, color: 'var(--ink)', fontSize: '0.8rem' }} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="db-donut-legend" aria-label="Defect type legend">
            {typeData.map((t) => (
              <li key={t.name} className="db-donut-legend__item">
                <span className="db-donut-legend__swatch" style={{ background: t.color }} />
                <span className="db-donut-legend__label">{t.name}</span>
                <span className="db-donut-legend__count">{t.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="console-panel" aria-label="Recent detections" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ display: 'flex', justifyContent: 'space-between' }}>
          Recent detections
          <button className="db-link-btn" onClick={() => navigate('/dashboard/detections')} aria-label="View all detections">View all <ArrowUpRight size={14} /></button>
        </h2>
        {recent.length === 0 ? (
          <p className="near__empty">No detections yet. Upload footage in New Inspection, or open the demo.</p>
        ) : (
          <div className="db-recent-grid">
            {recent.map((d) => (
              <button key={d.id} className="db-recent-card" onClick={() => navigate(`/dashboard/detections/${d.id}`)} aria-label={`${d.category}, ${Math.round(d.confidence * 100)}% confidence`}>
                <div className="db-recent-card__thumb" aria-hidden="true">
                  {d.imageUrl ? <img src={d.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="db-recent-card__thumbnail-bg" />}
                </div>
                <p className="db-recent-card__category">{d.category.toUpperCase()}</p>
                <p className="db-recent-card__conf">{Math.round(d.confidence * 100)}% confidence · {chainageOf(d).toFixed(0)} m</p>
                <p className="db-recent-card__date">{new Date(d.detectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
