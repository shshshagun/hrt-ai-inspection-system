import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, ChevronUp, ChevronDown, ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { useDetections, deleteDetectionLog, bulkReviewDetections } from '../../hooks/useApi';
import { useAuth } from '../../auth/useAuth';
import { PERMISSIONS } from '../../auth/permissions';
import { REJECT_REASONS, countsAsCrack, reviewState } from '../../utils/crackVerdict';
import { useToast } from '../../ui/contexts';
import QuickReview from './QuickReview';
import './AIDetections.css';

const DEFECT_CATEGORIES = ['Crack', 'Spalling', 'Leakage', 'Corrosion', 'Erosion', 'Joint Displacement'];
const SEVERITY_LEVELS = ['Critical', 'Major', 'Minor', 'Info'];

const SEV_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--major)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

const STATUS_COLOR = {
  pending:   'var(--minor)',
  confirmed: 'var(--info)',
  rejected:  'var(--ink-3)',
  flagged:   'var(--critical)',
};

// the review queue: what each tab asks the server for
const TABS = [
  { id: 'counted', label: 'Counted', hint: 'Confirmed, or judged a crack or spalling by the system and not yet reviewed' },
  { id: 'pending', label: 'Awaiting review', hint: 'Not judged a crack by the system and nobody has reviewed them' },
  { id: 'rejected', label: 'Rejected', hint: 'Marked as not a crack' },
  { id: 'all', label: 'All', hint: 'Everything stored' },
];
const REASON_LABEL = { shadow: 'Shadow', stain: 'Stain or water streak', ring_joint: 'Ring joint or seam', debris: 'Debris', texture: 'Concrete texture', other: 'Something else' };
/** What a counted detection is: the texture check finds spalling and exposed rebar, the model finds cracks */
const kindOf = (d) => (String(d.class_label || d.category || '').toLowerCase().startsWith('spall') ? 'spalling' : 'crack');
const VERDICT_WHY = { texture_heuristic: 'texture check, not a trained model', texture_weak: 'the texture is not rough enough', low_confidence: 'low confidence', blob_shape: 'blob-shaped, not thin', too_small: 'very small', compact_box: 'compact box', few_frames: 'seen in few frames', classifier_not_crack: 'the crack checker says no', classifier_unsure: 'the crack checker is not sure', classifier_unavailable: 'the crack checker could not load', low_score: 'the checks together fall just short' };

export default function AIDetections() {
  const navigate = useNavigate();
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [filterSev, setFilterSev]   = useState('');
  const [sortKey, setSortKey]       = useState('detectedAt');
  const [sortDir, setSortDir]       = useState('desc');
  const [page, setPage]             = useState(1);
  const [tab, setTab]               = useState('counted');
  const [picked, setPicked]         = useState(() => new Set());
  const [rejectReason, setRejectReason] = useState('shadow');
  const [reviewing, setReviewing]    = useState(false);
  const [quick, setQuick]            = useState(false);
  const { can } = useAuth();
  const canReview = can(PERMISSIONS.DETECTIONS_REVIEW);
  const PER_PAGE = 10;

  const [deletingId, setDeletingId]       = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll]     = useState(false);

  // Module 8 — live API
  const { data: allDetections, loading, error, refetch } = useDetections({
    category: filterCat || undefined,
    severity: filterSev || undefined,
    search:   search    || undefined,
    view:     tab,
  });

  const toast = useToast();

  async function handleDeleteOne(e, id) {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteDetectionLog(id);
      toast.success('Defect deleted.');
      refetch?.();
    } catch (err) {
      toast.error(err.message || 'The defect could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClearAll() {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      return;
    }
    setClearingAll(true);
    try {
      await deleteDetectionLog('ALL');
      toast.success('All defects deleted.');
      setConfirmClearAll(false);
      refetch?.();
    } catch (err) {
      toast.error(err.message || 'The defects could not be deleted.');
      setConfirmClearAll(false);
    } finally {
      setClearingAll(false);
    }
  }

  async function review(status) {
    if (!picked.size) return;
    setReviewing(true);
    try {
      const out = await bulkReviewDetections([...picked], status, status === 'rejected' ? rejectReason : undefined);
      toast.success(`${out.modified} detection${out.modified === 1 ? '' : 's'} ${status === 'confirmed' ? 'confirmed as real defects' : status === 'rejected' ? 'rejected' : 'sent back to review'}.`);
      setPicked(new Set());
      refetch?.();
    } catch (err) {
      toast.error(err.message || 'The review could not be saved.');
    } finally {
      setReviewing(false);
    }
  }

  const togglePick = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const source = allDetections ?? [];
  const filtered = [...source]
    .sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageData = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function SortIcon({ col }) {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  return (
    <div className="det-page">
      <div className="det-page__topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h1 className="det-page__title">AI Detections</h1>
        {source.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {confirmClearAll && (
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                style={{
                  background: '#111318',
                  border: '1px solid #1f2530',
                  color: '#94a3b8',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearingAll}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: confirmClearAll ? '#ef4444' : '#1a1114',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: confirmClearAll ? '#ffffff' : '#f87171',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {clearingAll ? <Loader2 size={14} className="sp-dl-btn__spin" /> : <Trash2 size={14} />}
              {confirmClearAll ? 'Confirm Clear All Logs' : 'Clear All Logs'}
            </button>
          </div>
        )}
      </div>

      {/* ── Review queue tabs ── */}
      <div className="det-tabs" role="tablist" aria-label="Which detections to list">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} title={t.hint} className={`det-tab${tab === t.id ? ' det-tab--on' : ''}`}
            onClick={() => { setTab(t.id); setPage(1); setPicked(new Set()); }}>{t.label}</button>
        ))}
      </div>
      {tab === 'pending' && <p className="det-note">The system could not tell whether these are cracks. Confirm the real ones and reject the rest; a rejected detection never counts and teaches the checker what a crack is not.</p>}
      {tab === 'pending' && canReview && filtered.length > 0 && (
        <button type="button" className="det-quick" onClick={() => setQuick(true)}>Quick review ({filtered.length}): swipe or use the arrow keys</button>
      )}
      {quick && <QuickReview items={filtered} onClose={() => { setQuick(false); refetch?.(); }} />}

      {/* ── Filters ── */}
      <div className="det-filters" role="search">
        <div className="det-search">
          <Search size={15} className="det-search__icon" aria-hidden="true" />
          <input
            type="search"
            className="det-search__input"
            placeholder="Search by ID, category…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search detections"
          />
        </div>
        <div className="det-filter-group">
          <Filter size={14} aria-hidden="true" />
          <select
            className="det-select"
            value={filterCat}
            onChange={e => { setFilterCat(e.target.value); setPage(1); }}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {DEFECT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            className="det-select"
            value={filterSev}
            onChange={e => { setFilterSev(e.target.value); setPage(1); }}
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="det-count" aria-live="polite">
          {loading ? (
            <><Loader2 size={12} className="sp-dl-btn__spin" /> Loading…</>
          ) : (
            <>{filtered.length} result{filtered.length !== 1 ? 's' : ''}{error ? ' (offline)' : ''}</>
          )}
        </p>
      </div>

      {canReview && picked.size > 0 && (
        <div className="det-bulk" role="region" aria-label="Review the selected detections">
          <b>{picked.size} selected</b>
          <button type="button" className="det-bulk__btn det-bulk__btn--ok" disabled={reviewing} onClick={() => review('confirmed')}>Confirm as cracks</button>
          <label>Reject as
            <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="button" className="det-bulk__btn" disabled={reviewing} onClick={() => review('rejected')}>Reject</button>
          {tab !== 'pending' && <button type="button" className="det-bulk__btn" disabled={reviewing} onClick={() => review('pending')}>Back to review</button>}
          <button type="button" className="det-link" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="det-table-wrap">
        <table className="det-table" aria-label="AI detection records">
          <thead>
            <tr>
              {canReview && (
                <th className="det-th" style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Select this page" checked={pageData.length > 0 && pageData.every((d) => picked.has(d.id))}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); pageData.forEach((d) => (e.target.checked ? n.add(d.id) : n.delete(d.id))); return n; })} />
                </th>
              )}
              {[
                { key: 'id',          label: 'Detection ID' },
                { key: 'category',    label: 'Category' },
                { key: 'severity',    label: 'Severity' },
                { key: 'confidence',  label: 'Confidence' },
                { key: 'chainage',    label: 'Chainage' },
                { key: 'timestamp',   label: 'Timestamp' },
                { key: 'reviewStatus',label: 'Status' },
              ].map(col => (
                <th
                  key={col.key}
                  className="det-th"
                  onClick={() => toggleSort(col.key)}
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && toggleSort(col.key)}
                >
                  <span className="det-th__inner">
                    {col.label}
                    <SortIcon col={col.key} />
                  </span>
                </th>
              ))}
              <th className="det-th" />
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={9} className="det-empty" style={{ padding: '48px 16px', textAlign: 'center' }}>
                  {tab === 'counted' ? <>No detections count yet. Check <strong>Awaiting review</strong>, or run <strong>New Inspection</strong>.</> : 'Nothing here.'}
                </td>
              </tr>
            ) : pageData.map(d => (
              <tr
                key={d.id}
                className="det-tr"
                onClick={() => navigate(`/dashboard/detections/${d.id}`)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/dashboard/detections/${d.id}`)}
                aria-label={`View defect ${d.id}`}
              >
                {canReview && (
                  <td className="det-td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${d.id}`} checked={picked.has(d.id)} onChange={() => togglePick(d.id)} />
                  </td>
                )}
                <td className="det-td det-td--id">{d.id}</td>
                <td className="det-td">{d.subtype}</td>
                <td className="det-td">
                  <span
                    className="det-badge"
                    style={{ color: SEV_COLOR[d.severity], borderColor: SEV_COLOR[d.severity] }}
                  >
                    {d.severity}
                  </span>
                </td>
                <td className="det-td det-td--conf">
                  {Math.round(d.confidence * 100)}%
                </td>
                <td className="det-td det-td--mono">{d.chainage.toFixed(1)} m</td>
                <td className="det-td det-td--mono">{d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '10:14:22'}</td>
                <td className="det-td">
                  <span
                    className="det-badge det-badge--status"
                    style={{ color: STATUS_COLOR[d.reviewStatus] || 'var(--db-ink-3)' }}
                  >
                    {reviewState(d) === 'rejected' ? `rejected${d.reject_reason ? `: ${REASON_LABEL[d.reject_reason] || d.reject_reason}` : ''}` : countsAsCrack(d) ? (reviewState(d) === 'confirmed' ? `confirmed ${kindOf(d)}` : `${kindOf(d)} (unreviewed)`) : 'awaiting review'}
                  </span>
                  {!countsAsCrack(d) && reviewState(d) === 'pending' && d.verdict_reason?.length > 0 && (
                    <small className="det-why">{d.verdict_reason.map((r) => VERDICT_WHY[r] || r).join(', ')}</small>
                  )}
                </td>
                <td className="det-td det-td--action" style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteOne(e, d.id)}
                    disabled={deletingId === d.id}
                    title="Delete defect log"
                    aria-label={`Delete detection ${d.id}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f87171',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {deletingId === d.id ? <Loader2 size={14} className="sp-dl-btn__spin" /> : <Trash2 size={14} />}
                  </button>
                  <ArrowRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <nav className="det-pagination" aria-label="Pagination">
          <button
            className="det-page-btn"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label="Previous page"
          >
            ←
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              className={`det-page-btn ${p === page ? 'det-page-btn--active' : ''}`}
              onClick={() => setPage(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          ))}
          <button
            className="det-page-btn"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            →
          </button>
        </nav>
      )}
    </div>
  );
}
