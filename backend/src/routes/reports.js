/**
 * Module 7 — PDF / CSV Inspection Report Engine
 *
 * POST /api/reports/generate
 *   Body: { inspection_id: string, format: "pdf" | "csv" }
 *
 * Queries the database for inspection metadata and all associated
 * detections, then streams the generated report back to the caller.
 *
 * When the database is unavailable the route falls back to a rich
 * demo payload so the frontend can be tested without a live Postgres
 * instance.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const { isValidUUID } = require('../middleware/validate');

let pool;
try {
  const db = require('../db/pool');
  pool = db.pool || db;
} catch (_) {
  pool = null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a fake inspection + detections payload for offline / demo use. */
function demoPayload(inspectionId) {
  const id = inspectionId || 'INS-2024-007';
  return {
    inspection: {
      id,
      section: 'Section 01 — Intake (Ch 0–4.2 km)',
      rov: 'ROV-04 "AquaScan"',
      started_at: '2024-10-15T09:00:00Z',
      coverage_km: 4.2,
      status: 'completed',
    },
    detections: [
      {
        id: 'DET-4782', category: 'Crack',     subtype: 'Structural Crack',
        severity: 'Critical', confidence: 0.92, chainage: 2.14,
        timestamp: '00:12:34', review_status: 'flagged',
        estimated_size: '45 cm × 1.2 cm', orientation: 'Vertical / Longitudinal',
      },
      {
        id: 'DET-4781', category: 'Spalling',  subtype: 'Surface Spalling',
        severity: 'Major',    confidence: 0.87, chainage: 2.43,
        timestamp: '00:14:21', review_status: 'confirmed',
        estimated_size: '30 cm × 22 cm', orientation: 'N/A',
      },
      {
        id: 'DET-4780', category: 'Leakage',   subtype: 'Seepage',
        severity: 'Minor',    confidence: 0.81, chainage: 3.12,
        timestamp: '00:16:55', review_status: 'pending',
        estimated_size: 'N/A', orientation: 'N/A',
      },
      {
        id: 'DET-4779', category: 'Crack',     subtype: 'Hairline Crack',
        severity: 'Minor',    confidence: 0.74, chainage: 1.85,
        timestamp: '00:10:12', review_status: 'confirmed',
        estimated_size: '12 cm × 0.2 cm', orientation: 'Horizontal',
      },
      {
        id: 'DET-4778', category: 'Corrosion', subtype: 'Rebar Corrosion',
        severity: 'Major',    confidence: 0.79, chainage: 3.74,
        timestamp: '00:20:30', review_status: 'pending',
        estimated_size: '20 cm × 15 cm', orientation: 'N/A',
      },
    ],
  };
}

/** Fetch real data from Postgres; throws if DB unavailable. */
async function fetchFromDb(inspectionId) {
  if (!pool || typeof pool.connect !== 'function') return null;
  if (!inspectionId || !isValidUUID(inspectionId)) return null;
  const client = await pool.connect();
  try {
    const inspRow = await client.query(
      `SELECT inspection_id AS id,
              CONCAT(facility_name, ' (', tunnel_id, ')') AS section,
              COALESCE(operator_name, 'ROV-01') AS rov,
              start_time AS started_at,
              total_chainage_m AS coverage_km,
              CASE WHEN end_time IS NULL THEN 'in_progress' ELSE 'completed' END AS status
       FROM inspections WHERE inspection_id = $1`,
      [inspectionId],
    );
    if (inspRow.rows.length === 0) return null;

    const detRows = await client.query(
      `SELECT detection_id AS id,
              class_label AS category,
              class_label AS subtype,
              CASE
                WHEN confidence >= 0.75 THEN 'Critical'
                WHEN confidence >= 0.50 THEN 'Major'
                WHEN confidence >= 0.35 THEN 'Minor'
                ELSE 'Info'
              END AS severity,
              confidence,
              coord_z AS chainage,
              TO_CHAR(timestamp, 'HH24:MI:SS') AS timestamp,
              verified_status AS review_status,
              'N/A' AS estimated_size,
              'N/A' AS orientation
       FROM detections WHERE inspection_id = $1
       ORDER BY coord_z ASC`,
      [inspectionId],
    );

    return { inspection: inspRow.rows[0], detections: detRows.rows };
  } finally {
    client.release();
  }
}

// ─── severity summary helper ─────────────────────────────────────────────────

function summarise(detections) {
  const counts = { Critical: 0, Major: 0, Minor: 0, Info: 0 };
  detections.forEach(d => {
    const sev = d.severity || 'Info';
    counts[sev] = (counts[sev] || 0) + 1;
  });
  return counts;
}

// ─── CSV generator ───────────────────────────────────────────────────────────

function buildCsv({ inspection, detections }) {
  const lines = [
    `# HRT AI Inspection Report — ${inspection.id}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Tunnel: Nathpa Jhakri HRT | Section: ${inspection.section}`,
    `# ROV: ${inspection.rov} | Coverage: ${inspection.coverage_km} km`,
    '',
    'Detection ID,Category,Subtype,Severity,Confidence,Chainage (km),Timestamp,Review Status,Estimated Size,Orientation',
    ...detections.map(d =>
      [
        d.id,
        d.category,
        d.subtype,
        d.severity,
        `${Math.round((d.confidence || 0) * 100)}%`,
        parseFloat(d.chainage || 0).toFixed(3),
        d.timestamp || '',
        d.review_status || '',
        `"${d.estimated_size || ''}"`,
        `"${d.orientation || ''}"`,
      ].join(',')
    ),
  ];
  return lines.join('\r\n');
}

// ─── PDF generator ───────────────────────────────────────────────────────────

function streamPdf(res, { inspection, detections = [] }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const ts = new Date().toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // ── page header ──
  doc.fontSize(20).font('Helvetica-Bold')
     .text('HRT AI Inspection Report', { align: 'center' });
  doc.fontSize(10).font('Helvetica')
     .text(`Generated: ${ts}`, { align: 'center' });
  doc.moveDown(1.5);

  // ── inspection metadata ──
  doc.fontSize(13).font('Helvetica-Bold').text('Inspection Details');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
  doc.moveDown(0.4);

  const meta = [
    ['Inspection ID',  inspection.id],
    ['Section',        inspection.section],
    ['ROV Unit',       inspection.rov],
    ['Coverage',       `${inspection.coverage_km} km`],
    ['Status',         (inspection.status || '').toUpperCase()],
    ['Date',           inspection.started_at
                         ? new Date(inspection.started_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
                         : '—'],
  ];

  doc.fontSize(10).font('Helvetica');
  meta.forEach(([label, value]) => {
    doc.text(`${label}:`, { continued: true, width: 160 })
       .font('Helvetica-Bold').text(` ${value}`).font('Helvetica');
  });

  doc.moveDown(1.5);

  // ── summary ──
  const counts = summarise(detections);
  doc.fontSize(13).font('Helvetica-Bold').text('Detection Summary');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
  doc.moveDown(0.4);

  doc.fontSize(10).font('Helvetica');
  doc.text(`Total Detections: `, { continued: true }).font('Helvetica-Bold').text(`${detections.length}`).font('Helvetica');
  doc.text(`Critical:  ${counts.Critical}   Major: ${counts.Major}   Minor: ${counts.Minor}   Info: ${counts.Info}`);

  doc.moveDown(1.5);

  // ── detections table ──
  doc.fontSize(13).font('Helvetica-Bold').text('Detection Records');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
  doc.moveDown(0.6);

  const colWidths = [75, 80, 55, 55, 65, 55, 60];
  const headers   = ['ID', 'Category', 'Severity', 'Confidence', 'Chainage', 'Timestamp', 'Status'];

  // header row
  doc.font('Helvetica-Bold').fontSize(9);
  let startX = 50;
  headers.forEach((h, i) => {
    doc.text(h, startX, doc.y, { width: colWidths[i], lineBreak: false });
    startX += colWidths[i];
  });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#999999');
  doc.moveDown(0.4);

  // data rows
  doc.font('Helvetica').fontSize(8);
  if (!detections || detections.length === 0) {
    doc.moveDown(0.3);
    doc.fillColor('#666666').font('Helvetica-Oblique')
       .text('No defect anomalies detected during this inspection session.', 50, doc.y);
    doc.moveDown(1.5);
  } else {
    detections.forEach((d, idx) => {
      // alternate row shading
      const rowY = doc.y;
      if (idx % 2 === 0) {
        doc.rect(50, rowY - 2, 495, 14).fill('#f5f5f5').stroke('#f5f5f5');
      }

      const cells = [
        d.id,
        d.subtype || d.category,
        d.severity,
        `${Math.round((d.confidence || 0) * 100)}%`,
        `${parseFloat(d.chainage || 0).toFixed(2)} km`,
        d.timestamp || '—',
        d.review_status || '—',
      ];

      startX = 50;
      doc.fillColor('#222222');
      cells.forEach((cell, i) => {
        doc.text(cell, startX, rowY, { width: colWidths[i], lineBreak: false });
        startX += colWidths[i];
      });

      doc.moveDown(0.7);

      // page break guard
      if (doc.y > 750 && idx < detections.length - 1) {
        doc.addPage();
      }
    });
  }

  // ── footer ──
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#888888').font('Helvetica')
     .text(
       'This report was generated automatically by the HRT AI Inspection System (YOLOv8s). '
       + 'All detections are AI-generated predictions and require verification by a qualified structural engineer before initiating repair works.',
       { align: 'center' }
     );

  doc.end();
  return doc;
}

// ─── route ───────────────────────────────────────────────────────────────────

/**
 * POST /api/reports/generate
 *
 * Body: { inspection_id?: string, format?: "pdf" | "csv" }
 *
 * Returns a streaming PDF or CSV file download.
 */
router.post('/generate', async (req, res) => {
  const { inspection_id, format = 'pdf' } = req.body || {};

  if (format !== 'pdf' && format !== 'csv') {
    return res.status(400).json({ error: '`format` must be "pdf" or "csv"' });
  }

  try {
    let payload;

    if (pool && inspection_id && isValidUUID(inspection_id)) {
      // Try real DB first
      try {
        const dbResult = await fetchFromDb(inspection_id);
        if (dbResult === null) {
          return res.status(404).json({ error: `Inspection ${inspection_id} not found` });
        }
        payload = dbResult;
      } catch (dbErr) {
        console.warn('[Reports] DB query failed, falling back to demo data:', dbErr.message);
        payload = demoPayload(inspection_id);
      }
    } else {
      payload = demoPayload(inspection_id);
    }

    const safeId = (payload.inspection.id || 'report').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'csv') {
      const csv = buildCsv(payload);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="HRT_Report_${safeId}.csv"`);
      return res.send(csv);
    }

    // PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="HRT_Report_${safeId}.pdf"`);

    streamPdf(res, payload);

  } catch (err) {
    console.error('[Reports] Unexpected error:', err);
    res.status(500).json({ error: 'Report generation failed', detail: err.message });
  }
});

module.exports = router;

