'use strict';

/**
 * inspections.js
 * CRUD for the `inspections` table.
 *
 * Endpoints:
 *   GET  /api/inspections        — paginated list with detection_count per session
 *   GET  /api/inspections/:id    — single inspection + severity breakdown
 *   POST /api/inspections        — create new inspection session
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { query: dbQuery } = require('../db/pool');
const { isValidUUID }    = require('../middleware/validate');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePositiveInt(value, defaultVal, max) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
  return max !== undefined ? Math.min(parsed, max) : parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inspections
// Paginated list of inspection sessions with detection count
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const limit  = parsePositiveInt(req.query.limit, 10, 50);
    const page   = parsePositiveInt(req.query.page,  1);
    const offset = (page - 1) * limit;

    // Total count
    const countResult = await dbQuery(
      'SELECT COUNT(*) AS total FROM inspections',
      []
    );
    const total       = parseInt(countResult.rows[0].total, 10);
    const total_pages = Math.ceil(total / limit);

    // Paginated list + detection_count via correlated subquery
    const dataSql = `
      SELECT
        i.inspection_id,
        i.tunnel_id,
        i.facility_name,
        i.start_time,
        i.end_time,
        i.total_chainage_m,
        i.operator_name,
        i.created_at,
        (
          SELECT COUNT(*)
          FROM   detections d
          WHERE  d.inspection_id = i.inspection_id
        ) AS detection_count
      FROM   inspections i
      ORDER  BY i.created_at DESC
      LIMIT  $1
      OFFSET $2
    `;

    const dataResult = await dbQuery(dataSql, [limit, offset]);

    const data = dataResult.rows.map((row) => ({
      inspection_id:    row.inspection_id,
      tunnel_id:        row.tunnel_id,
      facility_name:    row.facility_name,
      start_time:       row.start_time,
      end_time:         row.end_time,
      total_chainage_m: row.total_chainage_m !== null
        ? parseFloat(row.total_chainage_m) : null,
      operator_name:    row.operator_name,
      created_at:       row.created_at,
      detection_count:  parseInt(row.detection_count, 10),
    }));

    return res.status(200).json({ page, limit, total, total_pages, data });

  } catch (err) {
    console.error('[GET /api/inspections] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inspections/:id
// Single inspection detail + severity breakdown
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid inspection id: must be a valid UUID' });
    }

    // Fetch inspection row
    const inspResult = await dbQuery(
      'SELECT * FROM inspections WHERE inspection_id = $1',
      [id]
    );

    if (inspResult.rowCount === 0) {
      return res.status(404).json({ error: `Inspection not found: ${id}` });
    }

    const insp = inspResult.rows[0];

    // Severity breakdown: count detections bucketed by confidence thresholds
    const severitySql = `
      SELECT
        COUNT(*) FILTER (WHERE confidence >= 0.75)                           AS critical,
        COUNT(*) FILTER (WHERE confidence >= 0.50 AND confidence < 0.75)     AS major,
        COUNT(*) FILTER (WHERE confidence >= 0.35 AND confidence < 0.50)     AS minor,
        COUNT(*) FILTER (WHERE confidence < 0.35)                            AS info,
        COUNT(*)                                                              AS total
      FROM   detections
      WHERE  inspection_id = $1
    `;

    const severityResult = await dbQuery(severitySql, [id]);
    const sv = severityResult.rows[0];

    return res.status(200).json({
      inspection_id:    insp.inspection_id,
      tunnel_id:        insp.tunnel_id,
      facility_name:    insp.facility_name,
      start_time:       insp.start_time,
      end_time:         insp.end_time,
      total_chainage_m: insp.total_chainage_m !== null
        ? parseFloat(insp.total_chainage_m) : null,
      operator_name:    insp.operator_name,
      created_at:       insp.created_at,
      severity_breakdown: {
        critical: parseInt(sv.critical, 10),
        major:    parseInt(sv.major,    10),
        minor:    parseInt(sv.minor,    10),
        info:     parseInt(sv.info,     10),
        total:    parseInt(sv.total,    10),
      },
    });

  } catch (err) {
    console.error('[GET /api/inspections/:id] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inspections
// Create a new inspection session
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { tunnel_id, facility_name, start_time, operator_name } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    const missing = [];
    if (!tunnel_id)      missing.push('tunnel_id');
    if (!facility_name)  missing.push('facility_name');
    if (!start_time)     missing.push('start_time');
    if (!operator_name)  missing.push('operator_name');

    if (missing.length > 0) {
      return res.status(400).json({
        error:   'Missing required fields',
        missing,
      });
    }

    // Validate start_time is a parseable date
    const startDate = new Date(start_time);
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid start_time: must be a valid ISO 8601 timestamp' });
    }

    // String length guards (prevents DB constraint violations with a clear message)
    if (typeof tunnel_id     !== 'string' || tunnel_id.trim().length     === 0) {
      return res.status(400).json({ error: 'tunnel_id must be a non-empty string' });
    }
    if (typeof facility_name !== 'string' || facility_name.trim().length === 0) {
      return res.status(400).json({ error: 'facility_name must be a non-empty string' });
    }
    if (typeof operator_name !== 'string' || operator_name.trim().length === 0) {
      return res.status(400).json({ error: 'operator_name must be a non-empty string' });
    }

    const inspection_id = uuidv4();

    const insertSql = `
      INSERT INTO inspections (
        inspection_id,
        tunnel_id,
        facility_name,
        start_time,
        operator_name,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;

    const result = await dbQuery(insertSql, [
      inspection_id,
      tunnel_id.trim(),
      facility_name.trim(),
      startDate.toISOString(),
      operator_name.trim(),
    ]);

    const row = result.rows[0];

    return res.status(201).json({
      inspection_id:    row.inspection_id,
      tunnel_id:        row.tunnel_id,
      facility_name:    row.facility_name,
      start_time:       row.start_time,
      end_time:         row.end_time,
      total_chainage_m: row.total_chainage_m !== null
        ? parseFloat(row.total_chainage_m) : null,
      operator_name:    row.operator_name,
      created_at:       row.created_at,
    });

  } catch (err) {
    console.error('[POST /api/inspections] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
