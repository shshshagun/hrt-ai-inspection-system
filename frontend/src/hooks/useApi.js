/**
 * hooks/useApi.js
 * ─────────────────────────────────────────────────────────────
 * Centralised data-fetching hooks for the HRT AI Inspection System.
 *
 * Each hook:
 *  - calls the real backend at VITE_API_BASE_URL (default: http://localhost:3000)
 *  - falls back gracefully to mock data when the API is unreachable
 *  - returns { data, loading, error } so callers only need to check those keys
 *
 * Usage:
 *   const { data: detections, loading, error } = useDetections({ severity: 'Critical' });
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import {
  DETECTIONS,
  INSPECTIONS,
  KPI_SUMMARY,
  DEFECT_TYPE_DISTRIBUTION,
  SEVERITY_DISTRIBUTION,
  REPORTS,
} from '../data/mockData';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// ─── low-level fetcher ──────────────────────────────────────────────────────

async function apiFetch(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── generic hook factory ───────────────────────────────────────────────────

function useApiData(fetcher, fallback, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [isLive,  setIsLive]  = useState(false); // true = came from real API

  // stable reference via useCallback so eslint dep-array stays clean
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoFetcher = useCallback(fetcher, deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    memoFetcher()
      .then(result => {
        if (!cancelled) {
          setData(result);
          setIsLive(true);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('[useApi] API unavailable, using mock data:', err.message);
          setData(typeof fallback === 'function' ? fallback() : fallback);
          setIsLive(false);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoFetcher]);

  return { data, loading, error, isLive };
}

// ─── exported hooks ─────────────────────────────────────────────────────────

/**
 * useDetections(filters?)
 *
 * filters: { severity?, category?, page?, limit?, search? }
 * Returns paginated detections array.
 */
export function useDetections(filters = {}) {
  const { severity, category, page = 1, limit = 50, search } = filters;

  return useApiData(
    async () => {
      const params = new URLSearchParams();
      if (severity) params.set('severity',  severity);
      if (category) params.set('category',  category);
      if (search)   params.set('search',    search);
      params.set('page',  String(page));
      params.set('limit', String(limit));
      const json = await apiFetch(`/api/detections?${params}`);
      // Backend returns { data: [...], total, page, limit }
      return json.data ?? json;
    },
    () => {
      let list = [...DETECTIONS];
      if (severity) list = list.filter(d => d.severity  === severity);
      if (category) list = list.filter(d => d.category  === category);
      if (search)   list = list.filter(d =>
        `${d.id} ${d.category} ${d.subtype}`.toLowerCase().includes(search.toLowerCase())
      );
      return list;
    },
    [severity, category, page, limit, search],
  );
}

/**
 * useDetection(id)
 *
 * Fetches a single detection by its ID.
 */
export function useDetection(id) {
  return useApiData(
    async () => {
      const json = await apiFetch(`/api/detections?id=${encodeURIComponent(id)}&limit=1`);
      const list = json.data ?? json;
      if (!list.length) throw new Error(`Detection ${id} not found`);
      return list[0];
    },
    () => DETECTIONS.find(d => d.id === id) ?? null,
    [id],
  );
}

/**
 * useInspections()
 *
 * Returns the list of all inspection sessions.
 */
export function useInspections() {
  return useApiData(
    () => apiFetch('/api/inspections').then(json => json.data ?? json),
    () => INSPECTIONS,
    [],
  );
}

/**
 * useSpatialSummary(params?)
 *
 * params: { interval?, section? }
 * Returns chainage-binned spatial analytics array.
 */
export function useSpatialSummary(params = {}) {
  const { interval = 1, section } = params;

  return useApiData(
    async () => {
      const qs = new URLSearchParams({ interval: String(interval) });
      if (section) qs.set('section', section);
      return apiFetch(`/api/spatial-summary?${qs}`);
    },
    () => ({
      interval,
      bins: DEFECT_TYPE_DISTRIBUTION.map((t, i) => ({
        chainage_bin: i,
        chainage_km:  `${(i * interval).toFixed(1)}–${((i + 1) * interval).toFixed(1)}`,
        total:        t.value,
        critical:     Math.round(t.value * 0.2),
        major:        Math.round(t.value * 0.4),
        minor:        Math.round(t.value * 0.4),
        risk_level:   i === 0 ? 'HIGH' : i === 1 ? 'MEDIUM' : 'LOW',
      })),
    }),
    [interval, section],
  );
}

/**
 * useKpiSummary()
 *
 * Derives KPI numbers: tries /api/inspections and /api/detections summary.
 * Falls back to static KPI_SUMMARY from mockData.
 */
export function useKpiSummary() {
  return useApiData(
    async () => {
      const [inspJson, detJson] = await Promise.all([
        apiFetch('/api/inspections'),
        apiFetch('/api/detections?limit=1'),
      ]);
      const inspections = inspJson.data ?? inspJson;
      const total       = detJson.total ?? 0;
      return {
        totalInspections: inspections.length,
        defectsDetected:  total,
        criticalDefects:  detJson.criticalCount ?? KPI_SUMMARY.criticalDefects,
        inspectedKm:      inspections.reduce((s, i) => s + (parseFloat(i.coverage_km) || 0), 0)
                          || KPI_SUMMARY.inspectedKm,
        tunnelLengthKm:   KPI_SUMMARY.tunnelLengthKm,
      };
    },
    () => KPI_SUMMARY,
    [],
  );
}

/**
 * useReports()
 *
 * Returns the list of available inspection reports.
 * (Reports are stored in the DB in production; mock data used offline.)
 */
export function useReports() {
  return useApiData(
    async () => {
      // Reports endpoint will exist once the backend stores report metadata.
      // For now, derive from inspections.
      const json = await apiFetch('/api/inspections');
      const inspections = json.data ?? json;
      return inspections.map(insp => ({
        id:           `RPT-${insp.id}`,
        inspectionId: insp.id,
        title:        `Inspection Report — ${insp.id}`,
        date:         insp.started_at ? new Date(insp.started_at).toISOString().slice(0, 10) : '—',
        status:       insp.status === 'completed' ? 'complete' : 'draft',
        defectCount:  insp.total_detections ?? 0,
        criticalCount: insp.critical_count  ?? 0,
      }));
    },
    () => REPORTS,
    [],
  );
}

/**
 * useDefectDistributions()
 *
 * Returns { typeDistribution, severityDistribution } for dashboard pie/bar charts.
 * Falls back to static mock distribution data.
 */
export function useDefectDistributions() {
  return useApiData(
    async () => {
      const json = await apiFetch('/api/detections?limit=500');
      const list = json.data ?? json;

      const typeCounts = {};
      const sevCounts  = {};
      list.forEach(d => {
        typeCounts[d.category] = (typeCounts[d.category] || 0) + 1;
        sevCounts[d.severity]  = (sevCounts[d.severity]  || 0) + 1;
      });

      const TYPE_COLORS = {
        Crack: '#dc2626', Spalling: '#ea580c',
        Leakage: '#3b82f6', Corrosion: '#7c3aed', Other: '#6b7280',
      };
      const SEV_COLORS = {
        Critical: '#dc2626', Major: '#ea580c',
        Minor: '#ca8a04', Info: '#3b82f6',
      };

      return {
        typeDistribution: Object.entries(typeCounts).map(([name, value]) => ({
          name, value, color: TYPE_COLORS[name] || '#6b7280',
        })),
        severityDistribution: Object.entries(sevCounts).map(([name, value]) => ({
          name, value, color: SEV_COLORS[name] || '#6b7280',
        })),
      };
    },
    () => ({
      typeDistribution:     DEFECT_TYPE_DISTRIBUTION,
      severityDistribution: SEVERITY_DISTRIBUTION,
    }),
    [],
  );
}

/**
 * generateReport({ inspection_id, format })
 *
 * Fires POST /api/reports/generate and triggers a file download in the browser.
 * Returns a Promise that resolves on success or rejects on failure.
 */
export async function generateReport({ inspection_id, format = 'pdf' }) {
  const res = await fetch(`${API_BASE}/api/reports/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ inspection_id, format }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Report failed: ${res.status}`);
  }

  const blob     = await res.blob();
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const ext      = format === 'csv' ? 'csv' : 'pdf';
  a.href         = url;
  a.download     = `HRT_Report_${inspection_id || 'export'}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

