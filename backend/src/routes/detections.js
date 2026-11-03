/**
 * HRT AI Inspection System — Detections Route (Module 3)
 *
 * Exposes:
 *   POST /api/detections  — Ingest a single crack-detection event from the
 *                           AI pipeline ROV video processor.
 *
 * Design goals:
 *   • Validate every field before touching the database.
 *   • Return well-structured JSON for every outcome (201 / 400 / 503).
 *   • Stay under 50 ms end-to-end on a local Postgres instance.
 *   • Be resilient: a DB failure must NOT crash the process.
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query }      = require('../db/pool');

const router = express.Router();

// ---------------------------------------------------------------------------
// Validation rules for the incoming detection payload
// ---------------------------------------------------------------------------

/**
 * Rules are defined as an array so they can be composed / reused in tests.
 *
 * Field mapping (payload → DB column):
 *   class_label  → class_label     VARCHAR(64)  NOT NULL
 *   confidence   → confidence      FLOAT 0–1
 *   bbox.*       → bbox_x1 … height
 *   frame_index  → frame_index     INTEGER ≥ 0
 *   timestamp    → timestamp       TIMESTAMPTZ
 *   x / y / z   → coord_x/y/z     FLOAT
 */
const detectionValidationRules = [
  // --- class_label ---
  body('class_label')
    .isString()
    .withMessage('class_label must be a string')
    .trim()
    .notEmpty()
    .withMessage('class_label must not be empty'),

  // --- confidence ---
  body('confidence')
    .isFloat({ min: 0.0, max: 1.0 })
    .withMessage('confidence must be a float between 0.0 and 1.0'),

  // --- bbox ---
  body('bbox')
    .exists({ checkNull: true })
    .withMessage('bbox object is required'),

  body('bbox.x1')
    .isFloat()
    .withMessage('bbox.x1 must be a float'),

  body('bbox.y1')
    .isFloat()
    .withMessage('bbox.y1 must be a float'),

  body('bbox.x2')
    .isFloat()
    .withMessage('bbox.x2 must be a float'),

  body('bbox.y2')
    .isFloat()
    .withMessage('bbox.y2 must be a float'),

  // width & height are derived but validated if present
  body('bbox.width')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('bbox.width must be a non-negative float'),

  body('bbox.height')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('bbox.height must be a non-negative float'),

  // --- frame_index ---
  body('frame_index')
    .isInt({ min: 0 })
    .withMessage('frame_index must be a non-negative integer'),

  // --- timestamp ---
  body('timestamp')
    .isISO8601()
    .withMessage('timestamp must be a valid ISO 8601 date-time string'),

  // --- spatial coordinates ---
  body('x')
    .isFloat()
    .withMessage('x (spatial coordinate) must be a float'),

  body('y')
    .isFloat()
    .withMessage('y (spatial coordinate) must be a float'),

  body('z')
    .isFloat()
    .withMessage('z (spatial coordinate) must be a float'),

  // --- optional inspection_id ---
  body('inspection_id')
    .optional({ nullable: true })
    .isUUID(4)
    .withMessage('inspection_id must be a valid UUIDv4'),
];

// ---------------------------------------------------------------------------
// POST /api/detections
// ---------------------------------------------------------------------------

/**
 * Ingest a single detection event emitted by the AI pipeline.
 *
 * Request body example (sent by ai_pipeline/api_client.py):
 * {
 *   "class_label": "crack",
 *   "confidence": 0.87,
 *   "bbox": { "x1": 120.5, "y1": 80.2, "x2": 340.1, "y2": 200.8,
 *             "width": 219.6, "height": 120.6 },
 *   "frame_index": 142,
 *   "timestamp": "2026-10-31T08:00:00Z",
 *   "x": 1.23,
 *   "y": -0.45,
 *   "z": 45.30
 * }
 *
 * Responses:
 *   201 Created      — detection persisted successfully
 *   400 Bad Request  — one or more validation errors
 *   503 Unavailable  — PostgreSQL unreachable / query failed
 */
router.post(
  '/',
  detectionValidationRules,
  async (req, res) => {
    // Performance baseline — logged in development to catch regressions.
    const t0 = Date.now();

    // -----------------------------------------------------------------------
    // 1. Validation
    // -----------------------------------------------------------------------
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error:  'Validation failed',
        errors: errors.array(),   // array of { field, message, value }
      });
    }

    // -----------------------------------------------------------------------
    // 2. Extract validated fields
    // -----------------------------------------------------------------------
    const {
      class_label,
      confidence,
      bbox,
      frame_index,
      timestamp,
      x,
      y,
      z,
      inspection_id = null,
    } = req.body;

    const {
      x1: bbox_x1,
      y1: bbox_y1,
      x2: bbox_x2,
      y2: bbox_y2,
      width:  bbox_width  = null,  // optional — stored if provided
      height: bbox_height = null,
    } = bbox;

    // Generate a stable UUID for this detection record.
    const detection_id = uuidv4();

    // -----------------------------------------------------------------------
    // 3. Persist to PostgreSQL
    // -----------------------------------------------------------------------
    const SQL = `
      INSERT INTO detections (
        detection_id,
        inspection_id,
        class_label,
        confidence,
        bbox_x1,
        bbox_y1,
        bbox_x2,
        bbox_y2,
        bbox_width,
        bbox_height,
        frame_index,
        timestamp,
        coord_x,
        coord_y,
        coord_z,
        verified_status,
        created_at
      ) VALUES (
        $1,  $2,  $3,  $4,
        $5,  $6,  $7,  $8,  $9,  $10,
        $11, $12,
        $13, $14, $15,
        'pending', NOW()
      )
      RETURNING detection_id, created_at;
    `;

    const params = [
      detection_id,          // $1
      inspection_id,         // $2  — nullable UUID
      class_label,           // $3
      confidence,            // $4
      bbox_x1,               // $5
      bbox_y1,               // $6
      bbox_x2,               // $7
      bbox_y2,               // $8
      bbox_width,            // $9  — nullable
      bbox_height,           // $10 — nullable
      frame_index,           // $11
      timestamp,             // $12
      x,                     // $13 — coord_x
      y,                     // $14 — coord_y
      z,                     // $15 — coord_z
    ];

    try {
      const result = await query(SQL, params);
      const row    = result.rows[0];

      // Development timing log — safe to remove / disable in production.
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[POST /api/detections] Inserted ${row.detection_id} in ${Date.now() - t0} ms`);
      }

      return res.status(201).json({
        success:      true,
        detection_id: row.detection_id,
        created_at:   row.created_at,
      });

    } catch (dbErr) {
      // Log the full error server-side for ops visibility, but never expose
      // raw Postgres internals to the caller.
      console.error('[POST /api/detections] DB error:', dbErr.message);

      return res.status(503).json({
        error:  'Database unavailable',
        detail: process.env.NODE_ENV !== 'production'
          ? dbErr.message
          : 'The database could not be reached. Please try again later.',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = router;
