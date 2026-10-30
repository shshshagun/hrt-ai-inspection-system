/**
 * spatial.js — HRT AI Inspection System
 * Route: GET /api/spatial-summary
 *
 * Returns a chainage-based density histogram grouping detections
 * into equal-width bins along the tunnel axis (coord_z, 0–250 m).
 * Powers the structural risk charts on the frontend dashboard.
 */

'use strict';

const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

// ─── Constants ────────────────────────────────────────────────────────────────
const TUNNEL_LENGTH_M  = 250;   // nominal tunnel length in metres
const DEFAULT_INTERVAL = 10;    // metres per bin
const MIN_INTERVAL     = 5;
const MAX_INTERVAL     = 50;

// ─── Risk level classifier ────────────────────────────────────────────────────
/**
 * Derive a human-readable risk level for a single chainage bin.
 *
 * @param {number} criticalCount  detections with confidence >= 0.75
 * @param {number} majorCount     detections with confidence in [0.50, 0.75)
 * @param {number} avgConfidence  mean confidence for the bin
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
function classifyRisk(criticalCount, majorCount, avgConfidence) {
  if (criticalCount > 0 || avgConfidence >= 0.75) return 'HIGH';
  if (majorCount   > 0 || avgConfidence >= 0.50)  return 'MEDIUM';
  return 'LOW';
}

// ─── Parameter validation helpers ─────────────────────────────────────────────
/**
 * Parse and validate `interval_m` query param.
 * Returns { value, error } where error is a string if invalid.
 */
function parseInterval(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: DEFAULT_INTERVAL, error: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { value: null, error: `interval_m must be an integer (got: "${raw}")` };
  }
  if (n < MIN_INTERVAL || n > MAX_INTERVAL) {
    return {
      value: null,
      error: `interval_m must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} m (got: ${n})`,
    };
  }
  return { value: n, error: null };
}

/**
 * Parse and validate `min_conf` query param.
 * Returns { value, error }.
 */
function parseMinConf(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: 0.0, error: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return {
      value: null,
      error: `min_conf must be a float between 0.0 and 1.0 (got: "${raw}")`,
    };
  }
  return { value: n, error: null };
}

// ─── Route handler ─────────────────────────────────────────────────────────────
/**
 * GET /api/spatial-summary
 *
 * Query parameters:
 *   interval_m    {integer}  Bin width in metres. Default 10, range [5, 50].
 *   min_conf      {float}    Minimum confidence threshold. Default 0.0.
 *   inspection_id {uuid}     Optional – restrict to a single inspection session.
 */
router.get('/', async (req, res) => {
  // ── Validate interval_m ──
  const { value: intervalM, error: intervalErr } = parseInterval(req.query.interval_m);
  if (intervalErr) {
    return res.status(400).json({ error: intervalErr });
  }

  // ── Validate min_conf ──
  const { value: minConf, error: confErr } = parseMinConf(req.query.min_conf);
  if (confErr) {
    return res.status(400).json({ error: confErr });
  }

  // ── Optional inspection_id ──
  const inspectionId = req.query.inspection_id || null;

  // ── Build parameterised SQL ───────────────────────────────────────────────
  //
  // Positions ($1, $2, ...) map to:
  //   $1  → intervalM     (numeric interval in metres)
  //   $2  → minConf       (confidence lower bound)
  //   $3  → inspectionId  (UUID or NULL — used only when provided)
  //
  // We use FLOOR(coord_z / $1) * $1 to bucket into equal-width bins and
  // conditional COUNT FILTER aggregates for severity tiers.

  const params = [intervalM, minConf];

  let inspectionFilter = '';
  if (inspectionId) {
    params.push(inspectionId);
    inspectionFilter = `AND inspection_id = $${params.length}`;
  }

  const sql = `
    SELECT
      FLOOR(coord_z / $1) * $1                                          AS chainage_start,
      (FLOOR(coord_z / $1) + 1) * $1                                    AS chainage_end,
      COUNT(*)                                                           AS total_count,
      COUNT(*) FILTER (WHERE confidence >= 0.75)                        AS critical_count,
      COUNT(*) FILTER (WHERE confidence >= 0.50 AND confidence < 0.75)  AS major_count,
      COUNT(*) FILTER (WHERE confidence >= 0.35 AND confidence < 0.50)  AS minor_count,
      ROUND(AVG(confidence)::numeric, 3)                                 AS avg_confidence,
      MAX(confidence)                                                    AS max_confidence
    FROM detections
    WHERE coord_z IS NOT NULL
      AND confidence >= $2
      ${inspectionFilter}
    GROUP BY FLOOR(coord_z / $1)
    ORDER BY chainage_start ASC;
  `;

  // ── Execute query ─────────────────────────────────────────────────────────
  let rows;
  try {
    const result = await query(sql, params);
    rows = result.rows;
  } catch (dbErr) {
    console.error('[spatial-summary] Database error:', dbErr.message);
    return res.status(503).json({
      error: 'Database unavailable. Please try again later.',
    });
  }

  // ── Enrich rows with risk level ───────────────────────────────────────────
  const bins = rows.map((row) => {
    const criticalCount  = parseInt(row.critical_count,  10);
    const majorCount     = parseInt(row.major_count,     10);
    const avgConfidence  = parseFloat(row.avg_confidence);

    return {
      chainage_start: parseFloat(row.chainage_start),
      chainage_end:   parseFloat(row.chainage_end),
      total_count:    parseInt(row.total_count,    10),
      critical_count: criticalCount,
      major_count:    majorCount,
      minor_count:    parseInt(row.minor_count,    10),
      avg_confidence: avgConfidence,
      max_confidence: parseFloat(row.max_confidence),
      risk_level:     classifyRisk(criticalCount, majorCount, avgConfidence),
    };
  });

  const totalDetections = bins.reduce((sum, b) => sum + b.total_count, 0);

  // ── Success response ──────────────────────────────────────────────────────
  return res.status(200).json({
    interval_m:       intervalM,
    tunnel_length_m:  TUNNEL_LENGTH_M,
    total_detections: totalDetections,
    bins,
  });
});

module.exports = router;
