'use strict';

/**
 * detections.query.js
 * READ + STATUS-UPDATE operations on the `detections` table.
 *
 * Endpoints:
 *   GET  /api/detections          — multi-attribute filtered query with pagination
 *   PATCH /api/detections/:id/status — update verified_status + reviewer_notes
 */

const express  = require('express');
const { query: dbQuery } = require('../db/pool');
const { isValidUUID }    = require('../middleware/validate');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

/** Whitelist for ORDER BY column — prevents SQL injection via sort_by param */
const ALLOWED_SORT_COLUMNS = {
  confidence:  'd.confidence',
  timestamp:   'd.timestamp',
  coord_z:     'd.coord_z',
  created_at:  'd.created_at',
};

const ALLOWED_ORDERS = ['asc', 'desc'];

const VALID_STATUSES   = ['pending', 'confirmed', 'flagged'];

/**
 * Map severity label → confidence range for optional pre-filter.
 * When `severity` param is provided it overrides / intersects min_conf/max_conf.
 */
const SEVERITY_RANGES = {
  critical: { min: 0.75, max: 1.0  },
  major:    { min: 0.50, max: 0.7499 },
  minor:    { min: 0.35, max: 0.4999 },
  info:     { min: 0.0,  max: 0.3499 },
};

/**
 * Compute severity label from a numeric confidence value.
 * Used to enrich each returned row.
 */
function confidenceToSeverity(confidence) {
  if (confidence >= 0.75) return 'critical';
  if (confidence >= 0.50) return 'major';
  if (confidence >= 0.35) return 'minor';
  return 'info';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * parsePositiveInt(value, defaultVal, max) → integer
 * Clamps and defaults query integer params safely.
 */
function parsePositiveInt(value, defaultVal, max) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
  return max !== undefined ? Math.min(parsed, max) : parsed;
}

function parseFloat_(value, defaultVal) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultVal : parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/detections
// Multi-attribute filtered, paginated query
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      session_id,
      min_conf,
      max_conf,
      chainage_min,
      chainage_max,
      severity,
      status,
      class_label,
      page:    rawPage,
      limit:   rawLimit,
      sort_by: rawSortBy,
      order:   rawOrder,
    } = req.query;

    // ── Parameter parsing & defaults ─────────────────────────────────────────
    const page     = parsePositiveInt(rawPage,  1);
    const limit    = parsePositiveInt(rawLimit, 20, 100);
    const offset   = (page - 1) * limit;

    // Sort column: WHITELIST check — never interpolate req.query directly
    const sortColumn = ALLOWED_SORT_COLUMNS[rawSortBy] || ALLOWED_SORT_COLUMNS.created_at;
    const sortOrder  = ALLOWED_ORDERS.includes((rawOrder || '').toLowerCase())
      ? rawOrder.toLowerCase()
      : 'desc';

    // Confidence bounds
    let confMin = parseFloat_(min_conf, 0.0);
    let confMax = parseFloat_(max_conf, 1.0);

    // Severity overrides confidence bounds when provided
    if (severity && SEVERITY_RANGES[severity]) {
      const range = SEVERITY_RANGES[severity];
      confMin = range.min;
      confMax = range.max;
    }

    // Chainage bounds (mapped to coord_z which stores chainage along tunnel)
    const chainageMin = parseFloat_(chainage_min, 0);
    const chainageMax = parseFloat_(chainage_max, 250);

    // ── Dynamic WHERE clause (parameterized) ─────────────────────────────────
    const conditions = [];  // SQL fragments using $N placeholders
    const params     = [];  // Corresponding values (NEVER interpolated)

    /**
     * Helper to push a condition + its value(s) and return the next $N marker.
     * All user-controlled values flow through this → params[] array only.
     */
    function addParam(value) {
      params.push(value);
      return `$${params.length}`;
    }

    // Filter by single detection ID (used by useDetection hook)
    const targetId = req.query.id || req.query.detection_id;
    if (targetId) {
      if (!isValidUUID(targetId)) {
        return res.status(400).json({ error: 'Invalid id: must be a valid UUID' });
      }
      conditions.push(`d.detection_id = ${addParam(targetId)}`);
    }

    // session_id / inspection_id filter
    const activeSessionId = session_id || req.query.inspection_id;
    if (activeSessionId) {
      if (!isValidUUID(activeSessionId)) {
        return res.status(400).json({ error: 'Invalid session_id: must be a valid UUID' });
      }
      conditions.push(`d.inspection_id = ${addParam(activeSessionId)}`);
    }

    // Confidence range (always applied — defaults 0.0–1.0)
    conditions.push(`d.confidence >= ${addParam(confMin)}`);
    conditions.push(`d.confidence <= ${addParam(confMax)}`);

    // Chainage range (coord_z represents distance along tunnel axis)
    conditions.push(`d.coord_z >= ${addParam(chainageMin)}`);
    conditions.push(`d.coord_z <= ${addParam(chainageMax)}`);

    // Verified status filter
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          error:   'Invalid status',
          allowed: VALID_STATUSES,
        });
      }
      conditions.push(`d.verified_status = ${addParam(status)}`);
    }

    // Class label / category (case-insensitive LIKE)
    const filterClass = class_label || req.query.category;
    if (filterClass) {
      conditions.push(`d.class_label ILIKE ${addParam(`%${filterClass}%`)}`);
    }

    // Free text search (matches class_label or reviewer_notes)
    if (req.query.search) {
      const sParam = addParam(`%${req.query.search}%`);
      conditions.push(`(d.class_label ILIKE ${sParam} OR COALESCE(d.reviewer_notes, '') ILIKE ${sParam})`);
    }

    // ── Assemble WHERE string ─────────────────────────────────────────────────
    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // ── COUNT query (same WHERE, no limit/offset) ─────────────────────────────
    const countSql = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE d.confidence >= 0.75) AS critical_count
      FROM   detections d
      ${whereClause}
    `;

    // ── Data query ────────────────────────────────────────────────────────────
    // sortColumn is from our WHITELIST object — safe to interpolate
    const dataSql = `
      SELECT
        d.detection_id,
        d.inspection_id,
        d.class_label,
        d.confidence,
        d.bbox_x1,
        d.bbox_y1,
        d.bbox_x2,
        d.bbox_y2,
        d.frame_index,
        d.timestamp,
        d.coord_x,
        d.coord_y,
        d.coord_z,
        d.verified_status,
        d.reviewer_notes,
        d.created_at
      FROM   detections d
      ${whereClause}
      ORDER  BY ${sortColumn} ${sortOrder}
      LIMIT  ${addParam(limit)}
      OFFSET ${addParam(offset)}
    `;

    // Execute both queries in parallel
    const [countResult, dataResult] = await Promise.all([
      dbQuery(countSql, params.slice(0, params.length - 2)),  // count uses same params minus limit/offset
      dbQuery(dataSql,  params),
    ]);

    const total          = parseInt(countResult.rows[0].total, 10);
    const critical_count = parseInt(countResult.rows[0].critical_count || 0, 10);
    const total_pages    = Math.ceil(total / limit);

    // ── Shape each row into the API response format ───────────────────────────
    const data = dataResult.rows.map((row) => ({
      detection_id:    row.detection_id,
      inspection_id:   row.inspection_id,
      class_label:     row.class_label,
      confidence:      parseFloat(row.confidence),
      severity:        confidenceToSeverity(parseFloat(row.confidence)),
      bbox: {
        x1: parseFloat(row.bbox_x1),
        y1: parseFloat(row.bbox_y1),
        x2: parseFloat(row.bbox_x2),
        y2: parseFloat(row.bbox_y2),
      },
      frame_index:     row.frame_index,
      timestamp:       row.timestamp,
      coordinates: {
        x: row.coord_x !== null ? parseFloat(row.coord_x) : null,
        y: row.coord_y !== null ? parseFloat(row.coord_y) : null,
        z: row.coord_z !== null ? parseFloat(row.coord_z) : null,
      },
      chainage_m:      row.coord_z !== null ? parseFloat(row.coord_z) : null,
      verified_status: row.verified_status,
      reviewer_notes:  row.reviewer_notes,
      created_at:      row.created_at,
    }));

    return res.status(200).json({
      page,
      limit,
      total,
      total_pages,
      critical_count,
      criticalCount: critical_count,
      data,
    });

  } catch (err) {
    console.error('[GET /api/detections] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/detections/:id/status
// Update verified_status (and optional reviewer_notes) for a detection
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewer_notes } = req.body;

    // ── Validate :id ──────────────────────────────────────────────────────────
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid detection id: must be a valid UUID' });
    }

    // ── Validate status ───────────────────────────────────────────────────────
    if (!status) {
      return res.status(400).json({
        error:   'Missing required field: status',
        allowed: VALID_STATUSES,
      });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error:   `Invalid status "${status}"`,
        allowed: VALID_STATUSES,
      });
    }

    // Optional reviewer_notes must be a string when provided
    if (reviewer_notes !== undefined && typeof reviewer_notes !== 'string') {
      return res.status(400).json({ error: 'reviewer_notes must be a string' });
    }

    // ── Update — fully parameterized ──────────────────────────────────────────
    const updateSql = `
      UPDATE detections
      SET
        verified_status = $1,
        reviewer_notes  = COALESCE($2, reviewer_notes)
      WHERE detection_id = $3
      RETURNING
        detection_id,
        inspection_id,
        class_label,
        confidence,
        verified_status,
        reviewer_notes,
        created_at
    `;

    const result = await dbQuery(updateSql, [
      status,
      reviewer_notes !== undefined ? reviewer_notes : null,
      id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Detection not found: ${id}` });
    }

    const row = result.rows[0];
    return res.status(200).json({
      detection_id:    row.detection_id,
      inspection_id:   row.inspection_id,
      class_label:     row.class_label,
      confidence:      parseFloat(row.confidence),
      severity:        confidenceToSeverity(parseFloat(row.confidence)),
      verified_status: row.verified_status,
      reviewer_notes:  row.reviewer_notes,
      created_at:      row.created_at,
    });

  } catch (err) {
    console.error('[PATCH /api/detections/:id/status] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
