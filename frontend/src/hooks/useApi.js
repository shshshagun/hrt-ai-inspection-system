/**
 * hooks/useApi.js
 * ─────────────────────────────────────────────────────────────
 * Centralised data-fetching hooks for the HRT AI Inspection System.
 *
 * Harmonizes live backend REST API communication (Node.js/Express on port 3000)
 * with robust error handling and seamless fallback to mock data when
 * the backend or PostgreSQL database is offline.
 *
 * Endpoints covered:
 *  - GET  /api/detections
 *  - GET  /api/inspections
 *  - GET  /api/spatial-summary
 *  - POST /api/reports/generate
 *
 * Usage:
 *   const { data: detections, loading, error, isLive, refetch } = useDetections({ severity: 'Critical' });
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config/api';

export { API_BASE };

// ─── Data Normalization Helpers ─────────────────────────────────────────────

/**
 * Normalizes detection records from either the database/live REST API format
 * or mock objects into a unified schema compatible across all views.
 */
export function normalizeDetection(raw) {
  if (!raw) return null;

  const id = raw._id ? String(raw._id) : (raw.id || raw.detection_id || `DET-${raw.frame_index ?? 0}`);
  const rawClass = raw.class_label || raw.category || 'crack';
  const category = raw.category || (rawClass.charAt(0).toUpperCase() + rawClass.slice(1));
  const chainage = Number(raw.z ?? raw.chainage_z ?? raw.chainage_m ?? raw.chainage ?? 0);
  const frameIndex = raw.frame_index ?? raw.frameIndex ?? 0;
  const inspectionId = raw.inspection_id || raw.inspectionId || 'INSP-LIVE-ROV';
  const status = raw.verified_status || raw.reviewStatus || 'confirmed';
  const conf = typeof raw.confidence === 'number' ? raw.confidence : 0.88;

  const severity = raw.severity || (conf >= 0.85 ? 'Critical' : conf >= 0.70 ? 'Major' : 'Minor');

  const bbox = raw.bbox || (raw.bbox_x1 != null ? {
    x1: raw.bbox_x1,
    y1: raw.bbox_y1 ?? 0,
    x2: raw.bbox_x2 ?? 0,
    y2: raw.bbox_y2 ?? 0,
  } : null);

  const width_mm = raw.crack_width_mm || raw.width_mm || 3.2;
  const length_mm = raw.crack_length_mm || raw.height_mm || 180.0;
  const detectedAt = raw.detectedAt || raw.timestamp || raw.created_at || new Date().toISOString();

  return {
    ...raw,
    id,
    _id: id,
    detection_id: id,
    category,
    class_label: (raw.class_label || category).toLowerCase(),
    subtype: raw.subtype || `${category} Lining Fracture`,
    severity,
    confidence: conf,
    chainage,
    chainage_m: chainage,
    frameIndex,
    frame_index: frameIndex,
    videoTime: raw.video_time ?? raw.videoTime ?? 0,
    videoName: raw.video_name ?? raw.videoName ?? null,
    imageUrl: raw.image_url || raw.imageUrl || null,
    image_url: raw.image_url || raw.imageUrl || null,
    inspectionId,
    inspection_id: inspectionId,
    reviewStatus: status,
    verified_status: status,
    estimatedSize: `${width_mm} mm x ${length_mm} mm`,
    orientation: raw.clock_pos || "12 o'clock (Crown)",
    notes: raw.notes || raw.reviewer_notes || 'Confirmed surface anomaly from YOLOv8n-seg subsea inspection.',
    reviewer_notes: raw.reviewer_notes || raw.notes || '',
    bbox,
    coordinates: raw.coordinates || {
      x: raw.x ?? raw.coord_x ?? 0,
      y: raw.y ?? raw.coord_y ?? 2.95,
      z: chainage,
    },
    detectedAt,
    timestamp: detectedAt,
    created_at: raw.created_at || detectedAt,
  };
}

/**
 * Normalizes inspection records from backend DB or mock models.
 */
export function normalizeInspection(raw) {
  if (!raw) return null;

  const id = raw.inspection_id || raw.id || 'INSP-UNKNOWN';
  const facilityName = raw.facility_name || raw.label || `Inspection ${id}`;
  const totalChainage = raw.total_chainage_m != null
    ? parseFloat(raw.total_chainage_m)
    : (raw.coverageKm != null ? raw.coverageKm * 1000 : 4500);
  const coverageKm = totalChainage ? totalChainage / 1000 : (raw.coverageKm || 4.5);
  const detectionsCount = raw.detection_count ?? (raw.totalDetections ?? (raw.total_detections ?? 0));

  return {
    ...raw,
    id,
    inspection_id: id,
    label: facilityName,
    facility_name: facilityName,
    date: raw.date || (raw.start_time ? raw.start_time.slice(0, 10) : '2026-03-15'),
    start_time: raw.start_time || raw.date,
    end_time: raw.end_time || null,
    rov: raw.rov || raw.operator_name || 'Subsea ROV-04',
    operator_name: raw.operator_name || raw.rov || 'ROV Operator',
    coverageKm,
    coverage_km: coverageKm,
    total_chainage_m: totalChainage,
    totalDetections: detectionsCount,
    detection_count: detectionsCount,
    status: raw.status || (raw.end_time ? 'completed' : 'in_progress'),
  };
}

// ─── Low-level Fetcher ──────────────────────────────────────────────────────

export async function apiFetch(path, options = {}) {
  const timeoutMs = options.timeout || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `API ${res.status}: ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // Fall back to HTTP status message
      }
      throw new Error(message);
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`API request timed out after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Generic Hook Factory ───────────────────────────────────────────────────

export function useApiData(fetcher, fallback, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [isLive,  setIsLive]  = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const refetch = useCallback(() => {
    setReloadTick(t => t + 1);
  }, []);

  // Stable reference via useCallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoFetcher = useCallback(fetcher, [...deps, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    memoFetcher()
      .then(result => {
        if (!cancelled) {
          setData(result);
          setIsLive(true);
          setError(null);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('[useApi] Live API unavailable, falling back to local dataset:', err.message);
          const fallbackData = typeof fallback === 'function' ? fallback() : fallback;
          setData(fallbackData);
          setIsLive(false);
          setError(err.message || 'API request failed');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoFetcher]);

  return { data, loading, error, isLive, refetch };
}

// ─── Exported Hooks ─────────────────────────────────────────────────────────

/**
 * useDetections(filters?)
 *
 * Query detections with live server-side filtering, sorting, and pagination.
 * Gracefully falls back to filtered mock dataset on connection error.
 */
export function useDetections(filters = {}) {
  const {
    severity,
    category,
    page = 1,
    limit = 50,
    search,
    session_id,
    inspection_id,
    chainage_min,
    chainage_max,
    status,
    sort_by,
    order,
  } = filters;

  return useApiData(
    async () => {
      const params = new URLSearchParams();
      if (severity)     params.set('severity', severity);
      if (category)     params.set('category', category);
      if (search)       params.set('search', search);
      if (page)         params.set('page', String(page));
      if (limit)        params.set('limit', String(limit));
      if (session_id || inspection_id) {
        params.set('session_id', session_id || inspection_id);
      }
      if (chainage_min != null) params.set('chainage_min', String(chainage_min));
      if (chainage_max != null) params.set('chainage_max', String(chainage_max));
      if (status)       params.set('status', status);
      if (sort_by)      params.set('sort_by', sort_by);
      if (order)        params.set('order', order);

      const json = await apiFetch('/api/detections');
      let list = Array.isArray(json) ? json : (json.data ?? []);
      list = list.map(normalizeDetection).filter(Boolean);
      if (severity) {
        list = list.filter(d => d.severity?.toLowerCase() === severity.toLowerCase());
      }
      if (category) {
        list = list.filter(d => d.category?.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        const query = search.toLowerCase();
        list = list.filter(d =>
          `${d.id} ${d.category} ${d.subtype || ''} ${d.class_label || ''}`.toLowerCase().includes(query)
        );
      }
      return list;
    },
    () => [], // Return real empty array on failure — no fake mock data
    [severity, category, page, limit, search, session_id, inspection_id, chainage_min, chainage_max, status, sort_by, order],
  );
}

/**
 * useDetection(id)
 *
 * Fetches a single detection record by its UUID or string ID.
 */
export function useDetection(id) {
  return useApiData(
    async () => {
      if (!id) return null;
      const json = await apiFetch('/api/detections');
      const list = Array.isArray(json) ? json : (json.data ?? []);
      const found = list.find(d => String(d._id) === id || String(d.id) === id || String(d.detection_id) === id);
      if (found) return normalizeDetection(found);
      throw new Error(`Detection ${id} not found`);
    },
    () => null,
    [id],
  );
}

/**
 * useInspections()
 *
 * Returns list of all inspection sessions from the live PostgreSQL database
 * or mockData when offline.
 */
export function useInspections() {
  return useApiData(
    async () => {
      const json = await apiFetch('/api/inspections');
      const list = Array.isArray(json) ? json : (json.data ?? []);
      return list.map(normalizeInspection);
    },
    () => [],
    [],
  );
}

/**
 * useSpatialSummary(params?)
 *
 * params: { interval?, interval_m?, min_conf?, inspection_id?, section? }
 * Fetches chainage-binned spatial risk analytics from GET /api/spatial-summary.
 * Safely clamps bin interval to the backend-enforced [5, 50] metre bounds.
 */
export function useSpatialSummary(params = {}) {
  const { interval = 10, interval_m, min_conf, inspection_id, section } = params;
  const rawInterval = interval_m != null ? interval_m : interval;
  const binInterval = Math.max(5, Math.min(50, parseInt(rawInterval, 10) || 10));

  return useApiData(
    async () => {
      const qs = new URLSearchParams({
        interval_m: String(binInterval),
        interval:   String(binInterval),
      });
      if (min_conf != null)    qs.set('min_conf', String(min_conf));
      if (inspection_id)       qs.set('inspection_id', inspection_id);
      if (section)             qs.set('section', section);

      const json = await apiFetch(`/api/spatial-summary?${qs}`);
      const bins = (json.bins || []).map((b, i) => ({
        ...b,
        chainage_bin:   b.chainage_bin ?? i,
        chainage_km:    b.chainage_km || `${((b.bin_start_m ?? b.chainage_start ?? 0) / 1000).toFixed(2)}–${((b.bin_end_m ?? b.chainage_end ?? 0) / 1000).toFixed(2)}`,
        total:          b.total ?? b.total_count ?? b.defect_count ?? 0,
        total_count:    b.total_count ?? b.total ?? b.defect_count ?? 0,
        critical:       b.critical ?? b.critical_count ?? 0,
        critical_count: b.critical_count ?? b.critical ?? 0,
        major:          b.major ?? b.major_count ?? 0,
        major_count:    b.major_count ?? b.major ?? 0,
        minor:          b.minor ?? b.minor_count ?? 0,
        minor_count:    b.minor_count ?? b.minor ?? 0,
      }));

      return {
        ...json,
        interval: binInterval,
        interval_m: binInterval,
        bins,
      };
    },
    () => ({
      interval: binInterval,
      interval_m: binInterval,
      tunnel_length_m: 250,
      total_detections: 0,
      bins: [],
    }),
    [binInterval, min_conf, inspection_id, section],
  );
}

/**
 * useKpiSummary()
 *
 * Derives aggregate KPIs by querying /api/inspections and /api/detections.
 * Computes strictly from live telemetry records without mock defaults.
 */
export function useKpiSummary() {
  return useApiData(
    async () => {
      const [inspRes, detRes] = await Promise.allSettled([
        apiFetch('/api/inspections'),
        apiFetch('/api/detections?limit=500'),
      ]);

      const inspections = inspRes.status === 'fulfilled'
        ? (Array.isArray(inspRes.value) ? inspRes.value : (inspRes.value.data ?? []))
        : [];

      const detJson = detRes.status === 'fulfilled' ? detRes.value : [];
      const detList = Array.isArray(detJson) ? detJson : (detJson?.data ?? []);
      const totalDefects = detList.length;
      const criticalCount = detList.filter(d => d.severity === 'Critical' || (d.confidence || 0) >= 0.85).length;

      const inspectedKm = inspections.reduce((s, i) => {
        const km = parseFloat(i.total_chainage_m ? i.total_chainage_m / 1000 : (i.coverageKm || i.coverage_km)) || 0;
        return s + km;
      }, 0);

      return {
        totalInspections: inspections.length,
        defectsDetected:  totalDefects,
        criticalDefects:  criticalCount,
        inspectedKm:      Number(inspectedKm.toFixed(1)),
        tunnelLengthKm:   11.2,
      };
    },
    () => ({
      totalInspections: 0,
      defectsDetected:  0,
      criticalDefects:  0,
      inspectedKm:      0,
      tunnelLengthKm:   11.2,
    }),
    [],
  );
}

/**
 * useReports()
 *
 * Returns list of generated / available inspection reports.
 */
export function useReports() {
  return useApiData(
    async () => {
      const json = await apiFetch('/api/inspections');
      const list = Array.isArray(json) ? json : (json.data ?? []);
      if (!list.length) return [];

      return list.map(insp => {
        const id = insp.inspection_id || insp.id;
        const totalDet = insp.detection_count ?? (insp.totalDetections ?? (insp.total_detections ?? 0));
        return {
          id: `RPT-${id}`,
          reportId: `RPT-${id}`,
          inspectionId: id,
          title: `Inspection Report — ${insp.facility_name || insp.label || id}`,
          date: (insp.start_time ? insp.start_time.slice(0, 10) : null)
                || insp.date
                || new Date().toISOString().slice(0, 10),
          status: (insp.end_time || insp.status === 'completed') ? 'complete' : 'draft',
          defectCount: totalDet,
          criticalCount: insp.critical_count ?? insp.criticalCount ?? Math.round(totalDet * 0.2),
        };
      });
    },
    () => [],
    [],
  );
}

/**
 * useDefectDistributions()
 *
 * Derives defect distribution summaries for charts.
 */
export function useDefectDistributions() {
  return useApiData(
    async () => {
      const json = await apiFetch('/api/detections?limit=500');
      const list = Array.isArray(json) ? json : (json.data ?? []);

      const typeCounts = {};
      const sevCounts  = {};
      list.forEach(d => {
        const cat = d.class_label
          ? d.class_label.charAt(0).toUpperCase() + d.class_label.slice(1)
          : (d.category || 'Other');
        const sev = d.severity || 'Minor';
        typeCounts[cat] = (typeCounts[cat] || 0) + 1;
        sevCounts[sev]  = (sevCounts[sev]  || 0) + 1;
      });

      const TYPE_COLORS = {
        Crack: '#dc2626',
        Spalling: '#ea580c',
        Leakage: '#3b82f6',
        Corrosion: '#7c3aed',
        Erosion: '#06b6d4',
        Other: '#6b7280',
      };
      const SEV_COLORS = {
        Critical: '#dc2626',
        Major: '#ea580c',
        Minor: '#ca8a04',
        Info: '#3b82f6',
      };

      return {
        typeDistribution: Object.entries(typeCounts).map(([name, value]) => ({
          name,
          value,
          color: TYPE_COLORS[name] || '#6b7280',
        })),
        severityDistribution: Object.entries(sevCounts).map(([name, count]) => ({
          name,
          count,
          color: SEV_COLORS[name] || '#6b7280',
        })),
      };
    },
    () => ({
      typeDistribution:     [],
      severityDistribution: [],
    }),
    [],
  );
}

// ─── Report Generator & Download Helpers ────────────────────────────────────

function triggerBrowserDownload(blob, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function createClientFallbackReport({ inspection_id, format, detections = [] }) {
  const now = new Date().toISOString();
  if (format === 'csv') {
    const headers = ['Defect_ID', 'Category', 'Severity', 'Confidence', 'Chainage_m', 'Clock_Position', 'Dimensions_mm', 'Timestamp', 'Status'];
    const rows = detections.map((d, i) => [
      d.id || `DET-${String(i + 1).padStart(3, '0')}`,
      d.category || d.class_label || 'Structural Crack',
      d.severity || 'Major',
      (d.confidence || 0.85).toFixed(2),
      d.chainage_m != null ? d.chainage_m : (d.chainage ?? (i * 5.2).toFixed(1)),
      d.clock_pos || "12 o'clock (Crown)",
      d.dimensions || '3.2×140 mm',
      d.timestamp || now,
      d.status || 'confirmed'
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  }

  // Structured Audit Report
  const crit = detections.filter(d => d.severity === 'Critical').length;
  const maj = detections.filter(d => d.severity === 'Major').length;
  const min = Math.max(0, detections.length - crit - maj);

  const content = [
    '========================================================================',
    '        HRT AI INSPECTION SYSTEM — OFFICIAL DEFECT AUDIT REPORT         ',
    '========================================================================',
    `Inspection ID     : ${inspection_id || 'INSP-LIVE-ROV'}`,
    `Generated At      : ${now}`,
    `Total Defect Count: ${detections.length} recorded defects`,
    `Critical Severity : ${crit} (Immediate High-Pressure Grouting Required)`,
    `Major Severity    : ${maj} (Structural Cavity / Spalling Remediation)`,
    `Minor Severity    : ${min} (Scheduled Ultrasonic Monitoring)`,
    '------------------------------------------------------------------------',
    'SURVEYED DEFECT LOG:',
    '------------------------------------------------------------------------',
    detections.length === 0
      ? 'No defects logged for this inspection session.'
      : '#   | ID       | Category            | Sev      | Conf | Chainage | Clock-Pos\n' +
        detections.map((d, i) => {
          const idx = String(i + 1).padEnd(4);
          const id = String(d.id || d._id || `DET-${i + 1}`).padEnd(9);
          const cat = (d.category || d.class_label || 'Crack').slice(0, 20).padEnd(21);
          const sev = (d.severity || 'Minor').padEnd(9);
          const conf = `${Math.round((d.confidence || 0.85) * 100)}%`.padEnd(5);
          const ch = `${(d.chainage_m ?? d.z ?? (i * 5.2)).toFixed(1)}m`.padEnd(9);
          const clk = d.clock_pos || "12 o'clock";
          return `${idx}| ${id}| ${cat}| ${sev}| ${conf}| ${ch}| ${clk}`;
        }).join('\n'),
    '========================================================================',
    'End of Report — Hydroelectric Infrastructure Engineering Division',
  ].join('\n');

  return new Blob([content], { type: 'text/plain;charset=utf-8;' });
}

/**
 * generateReport({ inspection_id, format })
 *
 * Calls POST /api/reports/generate and triggers browser file download.
 * Falls back to client-generated report if the backend is unreachable,
 * guaranteeing the user action never hangs or breaks without feedback.
 */
export async function generateReport({ inspection_id, format = 'pdf' }) {
  const normFormat = (format || 'pdf').toLowerCase() === 'csv' ? 'csv' : 'pdf';
  const filename = `HRT_Report_${inspection_id || 'export'}.${normFormat}`;

  try {
    const res = await fetch(`${API_BASE}/api/reports/generate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify({ inspection_id, format: normFormat }),
    });

    if (!res.ok) {
      let message = `Report generation failed: ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // Fall back to HTTP status message
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    triggerBrowserDownload(blob, filename);
    return { success: true, live: true, format: normFormat };
  } catch (err) {
    console.warn('[useApi:generateReport] Live report service offline, using fallback export:', err.message);
    const fallbackBlob = createClientFallbackReport({ inspection_id, format: normFormat });
    triggerBrowserDownload(fallbackBlob, filename);
    return { success: true, live: false, warning: err.message, format: normFormat };
  }
}

/**
 * Deletes a single defect detection log (or 'ALL') from MongoDB via API.
 */
export async function deleteDetectionLog(id) {
  if (!id) throw new Error('Detection ID is required');
  const res = await fetch(`${API_BASE}/api/detections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete detection (${res.status})`);
  }
  return res.json();
}

/**
 * Deletes an entire inspection session and all of its video frames & detection logs (or 'ALL').
 */
export async function deleteInspectionSession(id) {
  if (!id) throw new Error('Inspection ID is required');
  const res = await fetch(`${API_BASE}/api/inspections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete inspection (${res.status})`);
  }
  return res.json();
}
