-- =============================================================================
-- HRT AI Inspection System — Database Schema
-- =============================================================================
-- Run once to initialise the PostgreSQL database before starting the backend.
--
-- Usage (psql):
--   psql -U postgres -d hrt_inspection -f src/db/schema.sql
--
-- Or from within a psql session:
--   \c hrt_inspection
--   \i src/db/schema.sql
-- =============================================================================

-- Enable the uuid-ossp extension so DEFAULT uuid_generate_v4() works.
-- (Available in all standard PostgreSQL installations ≥ 9.4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLE: inspections
-- Represents a single ROV inspection session inside the Head Race Tunnel.
-- One inspection → many detections and many telemetry log entries.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inspections (
  inspection_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tunnel_id         VARCHAR(64)  NOT NULL,                 -- e.g. "HRT-NORTH-01"
  facility_name     VARCHAR(128) NOT NULL,                 -- e.g. "Nathpa Jhakri HRT"
  start_time        TIMESTAMPTZ  NOT NULL,
  end_time          TIMESTAMPTZ,                           -- NULL while in progress
  total_chainage_m  FLOAT,                                 -- total tunnel length covered
  operator_name     VARCHAR(64),                           -- human operator on duty
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: detections
-- One row per AI-detected anomaly event (crack, spall, joint, etc.) emitted
-- by the Python pipeline in real time.
-- =============================================================================

CREATE TABLE IF NOT EXISTS detections (
  detection_id    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Foreign key — nullable because detections can arrive before an inspection
  -- session is formally opened (e.g. during pipeline testing).
  inspection_id   UUID        REFERENCES inspections(inspection_id) ON DELETE SET NULL,

  -- AI classification output
  class_label     VARCHAR(64) NOT NULL,
  confidence      FLOAT       NOT NULL CHECK (confidence BETWEEN 0 AND 1),

  -- Bounding box in pixel-space (relative to the frame)
  bbox_x1         FLOAT       NOT NULL,
  bbox_y1         FLOAT       NOT NULL,
  bbox_x2         FLOAT       NOT NULL,
  bbox_y2         FLOAT       NOT NULL,
  bbox_width      FLOAT,       -- derived: x2 - x1
  bbox_height     FLOAT,       -- derived: y2 - y1

  -- Video source metadata
  frame_index     INTEGER     NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,   -- wall-clock time of the frame

  -- ROV spatial coordinates at the moment of detection
  coord_x         FLOAT,                  -- lateral offset (m)
  coord_y         FLOAT,                  -- vertical offset (m)
  coord_z         FLOAT,                  -- chainage / depth (m)

  -- Review workflow
  verified_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (verified_status IN ('pending', 'confirmed', 'flagged')),
  reviewer_notes  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: telemetry_logs
-- Raw ROV sensor readings at each frame — used for spatial correlation and
-- replay in the dashboard.
-- =============================================================================

CREATE TABLE IF NOT EXISTS telemetry_logs (
  telemetry_id    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id   UUID        REFERENCES inspections(inspection_id) ON DELETE CASCADE,
  frame_index     INTEGER     NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,
  depth_m         FLOAT,      -- water / tunnel depth at this position
  chainage_m      FLOAT,      -- distance along tunnel axis from portal
  roll            FLOAT,      -- ROV orientation (degrees)
  pitch           FLOAT,
  yaw             FLOAT,
  velocity_mps    FLOAT       -- ROV travel speed
);

-- =============================================================================
-- INDEXES
-- Composite B-tree indexes tuned for the most common query patterns:
--   • Spatial heat-map queries  (coord_z range, filtered by confidence)
--   • Dashboard confidence sort (confidence DESC)
--   • Per-session listing       (inspection_id)
--   • Telemetry frame lookup    (inspection_id + frame_index)
-- =============================================================================

-- Used by /api/spatial-summary: WHERE coord_z BETWEEN ? AND ? ORDER BY confidence DESC
CREATE INDEX IF NOT EXISTS idx_detections_spatial
  ON detections (coord_z, confidence, timestamp);

-- Used by dashboard "top detections" panel
CREATE INDEX IF NOT EXISTS idx_detections_conf
  ON detections (confidence);

-- Used by /api/inspections/:id/detections — list all detections for a session
CREATE INDEX IF NOT EXISTS idx_detections_session
  ON detections (inspection_id);

-- Used by telemetry replay endpoint — stream frames for a session in order
CREATE INDEX IF NOT EXISTS idx_telemetry_session
  ON telemetry_logs (inspection_id, frame_index);
