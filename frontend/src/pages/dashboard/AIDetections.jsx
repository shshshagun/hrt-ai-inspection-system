import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, ChevronUp, ChevronDown, ArrowRight } from 'lucide-react';
import { DETECTIONS, DEFECT_CATEGORIES, SEVERITY_LEVELS } from '../../data/mockData';
import './AIDetections.css';

const SEV_COLOR = {
  Critical: 'var(--critical)',
  Major:    'var(--major)',
  Minor:    'var(--minor)',
  Info:     'var(--info)',
};

const STATUS_COLOR = {
  pending:   'var(--minor)',
  confirmed: 'var(--info)',
  flagged:   'var(--critical)',
};

export default function AIDetections() {
  const navigate = useNavigate();
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [filterSev, setFilterSev]   = useState('');
  const [sortKey, setSortKey]       = useState('detectedAt');
  const [sortDir, setSortDir]       = useState('desc');
  const [page, setPage]             = useState(1);
  const PER_PAGE = 10;

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const filtered = DETECTIONS
    .filter(d => {
      if (search && !`${d.id} ${d.category} ${d.subtype}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCat && d.category !== filterCat) return false;
      if (filterSev && d.severity !== filterSev) return false;
      return true;
    })
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
      <h1 className="det-page__title">AI Detections</h1>

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
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Table ── */}
      <div className="det-table-wrap">
        <table className="det-table" aria-label="AI detection records">
          <thead>
            <tr>
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
                <td colSpan={8} className="det-empty">
                  No detections match the current filters.
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
                <td className="det-td det-td--mono">{d.chainage.toFixed(2)} km</td>
                <td className="det-td det-td--mono">{d.timestamp}</td>
                <td className="det-td">
                  <span
                    className="det-badge det-badge--status"
                    style={{ color: STATUS_COLOR[d.reviewStatus] || 'var(--db-ink-3)' }}
                  >
                    {d.reviewStatus}
                  </span>
                </td>
                <td className="det-td det-td--action">
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
