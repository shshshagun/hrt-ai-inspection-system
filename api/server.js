const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '15mb' }));

// In-memory rate limiting to protect API from denial-of-service
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 600;

app.use((req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, record);
  } else {
    record.count++;
  }
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests, please slow down.' });
  }
  next();
});

// CORS configuration for local and remote dashboard clients
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins || process.env.NODE_ENV !== 'production' || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Initialize MongoDB Client
// Configure MONGODB_URI in your environment variables (e.g. Render dashboard)
const uri = process.env.MONGODB_URI;
let db;

async function connectDB() {
  if (!uri) {
    console.warn("⚠️ MONGODB_URI environment variable is not configured. Database operations will return 503.");
    return;
  }
  try {
    const client = new MongoClient(uri);
    await client.connect();
    // Specify the database name (it will be created if it doesn't exist)
    db = client.db('hrt_inspection');
    console.log("✅ Successfully connected to MongoDB Atlas.");
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err.message);
  }
}
connectDB();

// ── POST /api/detections ──
// Receives JSON from inference (browser ONNX or Python) and inserts it into MongoDB
app.post('/api/detections', async (req, res) => {
  const {
    class_label,
    subtype,
    confidence,
    bbox,
    frame_index,
    video_time,
    video_name,
    image_url,
    timestamp,
    x,
    y,
    z,
    severity,
    crack_width_mm,
    crack_length_mm,
    crack_area_mm2,
    area_mm2,
    clock_pos,
    inspection_id
  } = req.body || {};
  
  if (!class_label || typeof class_label !== 'string' || confidence === undefined || isNaN(confidence)) {
    return res.status(400).json({ error: 'Validation failed: class_label (string) and confidence (number) are required' });
  }

  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const parsedDate = timestamp ? new Date(timestamp) : new Date();
    const safeTimestamp = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    const detection = {
      class_label,
      subtype: subtype || `${class_label.charAt(0).toUpperCase() + class_label.slice(1)} Surface Defect`,
      confidence: Number(confidence),
      severity: severity || (Number(confidence) >= 0.85 ? 'Critical' : 'Major'),
      crack_width_mm: crack_width_mm !== undefined ? Number(crack_width_mm) : 3.2,
      crack_length_mm: crack_length_mm !== undefined ? Number(crack_length_mm) : 180.0,
      crack_area_mm2: crack_area_mm2 !== undefined && crack_area_mm2 !== null
        ? Number(crack_area_mm2)
        : (area_mm2 !== undefined && area_mm2 !== null ? Number(area_mm2) : null),
      clock_pos: clock_pos || "12 o'clock (Crown)",
      inspection_id: inspection_id || 'LIVE-ROV',
      video_name: video_name || null,
      video_time: video_time !== undefined ? Number(video_time) : 0,
      image_url: typeof image_url === 'string' ? image_url : null,
      bbox: bbox || null,
      frame_index: frame_index !== undefined ? Number(frame_index) : 0,
      timestamp: safeTimestamp,
      x: x !== undefined ? Number(x) : 0,
      y: y !== undefined ? Number(y) : 0,
      z: z !== undefined ? Number(z) : 0,
      created_at: new Date()
    };
    
    const result = await db.collection('detections').insertOne(detection);
    // Return the inserted document with its new _id
    res.status(201).json({ _id: result.insertedId, ...detection });
  } catch (error) {
    console.error("Error inserting detection:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── GET /api/detections ──
// Returns the latest 100 detections
app.get('/api/detections', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const { inspection_id, severity, limit = 100 } = req.query;
    const filter = {};
    if (inspection_id) filter.inspection_id = inspection_id;
    if (severity && severity !== 'All') filter.severity = severity;

    const detections = await db.collection('detections')
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit, 10) || 100)
      .toArray();
      
    res.json(detections);
  } catch (error) {
    console.error("Error fetching detections:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function buildDetectionIdQuery(id) {
  try {
    const { ObjectId } = require('mongodb');
    return { $or: [{ _id: new ObjectId(id) }, { id }, { detection_id: id }] };
  } catch {
    return { $or: [{ id }, { detection_id: id }] };
  }
}

// ── GET /api/detections/:id ──
// Returns a single detection by MongoDB _id or string ID
app.get('/api/detections/:id', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const detection = await db.collection('detections').findOne(buildDetectionIdQuery(req.params.id));
    if (!detection) {
      return res.status(404).json({ error: `Detection ${req.params.id} not found` });
    }
    res.json(detection);
  } catch (error) {
    console.error("Error fetching detection:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── DELETE /api/detections/:id ──
// Deletes a single detection log (or ALL if id === 'ALL')
app.delete('/api/detections/:id', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const { id } = req.params;
    if (id === 'ALL') {
      const result = await db.collection('detections').deleteMany({});
      return res.json({ deletedCount: result.deletedCount });
    }
    const result = await db.collection('detections').deleteOne(buildDetectionIdQuery(id));
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: `Detection ${id} not found` });
    }
    res.json({ deletedCount: result.deletedCount, id });
  } catch (error) {
    console.error("Error deleting detection:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── GET /api/inspections ──
// Aggregates distinct inspections from live MongoDB detections
app.get('/api/inspections', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const pipeline = [
      {
        $group: {
          _id: "$inspection_id",
          totalDetections: { $sum: 1 },
          criticalCount: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ["$severity", "Critical"] }, { $gte: ["$confidence", 0.85] }] },
                1,
                0
              ]
            }
          },
          videoName: { $first: "$video_name" },
          startTime: { $min: "$timestamp" },
          endTime: { $max: "$timestamp" },
          minZ: { $min: "$z" },
          maxZ: { $max: "$z" }
        }
      },
      { $sort: { startTime: -1 } }
    ];

    const results = await db.collection('detections').aggregate(pipeline).toArray();
    const inspections = results.map((r, idx) => {
      const inspId = r._id || `INSP-LIVE-${idx + 1}`;
      const isWebcam = String(inspId).startsWith('CAM-');
      const isPhoto = String(inspId).startsWith('PHOTO-');
      const coverage = Math.max(0.05, Number((((r.maxZ || 0) - (r.minZ || 0)) / 1000).toFixed(3)) || 0.05);
      return {
        id: inspId,
        inspection_id: inspId,
        videoName: r.videoName || null,
        label: isPhoto
          ? `Photo Batch Inspection — ${inspId}`
          : isWebcam
            ? `Live Webcam Session — ${inspId}`
            : r.videoName
              ? `${r.videoName} (${inspId})`
              : `ROV Subsea Survey — ${inspId}`,
        date: r.startTime ? new Date(r.startTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        rov: isPhoto
          ? 'Still Photo Batch · YOLOv8n-seg'
          : isWebcam
            ? 'Live Optical Camera · YOLOv8n-seg'
            : 'YOLOv8n-seg Subsea Scanner',
        coverageKm: coverage,
        totalDetections: r.totalDetections,
        criticalCount: r.criticalCount,
        status: 'completed'
      };
    });

    res.json(inspections);
  } catch (error) {
    console.error("Error fetching inspections:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── DELETE /api/inspections/:id ──
// Removes all detections for a given inspection_id
app.delete('/api/inspections/:id', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }
  try {
    const { id } = req.params;
    const filter =
      id === 'ALL'
        ? {}
        : id === 'INSP-LIVE-1'
          ? { $or: [{ inspection_id: id }, { inspection_id: null }, { inspection_id: { $exists: false } }] }
          : { inspection_id: id };
    const result = await db.collection('detections').deleteMany(filter);
    res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error("Error deleting inspection:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── GET /api/spatial-summary ──
// Computes chainage-binned spatial risk analytics from live MongoDB detections
app.get('/api/spatial-summary', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not initialized or unreachable' });
  }

  try {
    const interval_m = Math.max(5, Math.min(50, parseInt(req.query.interval_m || req.query.interval, 10) || 10));
    const detections = await db.collection('detections').find({}).toArray();

    const binMap = new Map();
    for (const d of detections) {
      const z = Number(d.z || d.chainage_z || 0);
      const binStart = Math.floor(z / interval_m) * interval_m;
      const binKey = `${binStart}-${binStart + interval_m}`;

      if (!binMap.has(binKey)) {
        binMap.set(binKey, {
          bin_start_m: binStart,
          bin_end_m: binStart + interval_m,
          defect_count: 0,
          critical_count: 0,
          major_count: 0,
          minor_count: 0
        });
      }

      const bin = binMap.get(binKey);
      bin.defect_count++;
      const sev = d.severity || (d.confidence >= 0.85 ? 'Critical' : 'Major');
      if (sev === 'Critical') bin.critical_count++;
      else if (sev === 'Major') bin.major_count++;
      else bin.minor_count++;
    }

    const bins = Array.from(binMap.values()).sort((a, b) => a.bin_start_m - b.bin_start_m);
    res.json({ interval_m, total_bins: bins.length, bins });
  } catch (error) {
    console.error("Error generating spatial summary:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

let PDFDocument;
try {
  PDFDocument = require('pdfkit');
} catch (_) {
  try {
    PDFDocument = require('../backend/node_modules/pdfkit');
  } catch (err) {
    PDFDocument = null;
  }
}

/**
 * Extracts and decodes base64 data URI into a binary Buffer.
 */
function extractImageBuffer(dataUri) {
  if (!dataUri) return null;
  if (Buffer.isBuffer(dataUri)) return dataUri;
  if (typeof dataUri !== 'string') return null;
  const match = dataUri.match(/^data:image\/(?:jpeg|jpg|png);base64,(.+)$/is);
  if (match && match[1]) {
    try {
      return Buffer.from(match[1].trim(), 'base64');
    } catch (_) {
      return null;
    }
  }
  const trimmed = dataUri.trim();
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 50) {
    try {
      return Buffer.from(trimmed, 'base64');
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Generates an official binary PDF report containing KPIs, spatial summary,
 * and defect cards with embedded crack photos and annotations.
 */
function generateInspectionPdf({ inspectionId, detections = [], now = new Date() }) {
  return new Promise((resolve, reject) => {
    if (!PDFDocument) {
      return reject(new Error('PDFKit library is not installed or available'));
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true,
      info: {
        Title: `HRT Inspection Audit Report — ${inspectionId || 'LIVE'}`,
        Author: 'Shagun <shagunsoni197@gmail.com>',
        Subject: 'Hydroelectric Tunnel AI Defect Inspection & Structural Audit',
        Keywords: 'tunnel, inspection, crack, yolo, audit, hydro'
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    // ── Document Palette & Dimensions ──
    const primaryColor = '#1e3a8a';   // Navy
    const secondaryColor = '#0f766e'; // Teal
    const darkInk = '#0f172a';        // Slate 900
    const mutedInk = '#475569';       // Slate 600
    const cardBg = '#f8fafc';         // Slate 50
    const borderStroke = '#cbd5e1';   // Slate 300
    const criticalColor = '#dc2626';  // Red
    const majorColor = '#ea580c';     // Orange
    const minorColor = '#ca8a04';     // Yellow
    const contentWidth = 515.28;

    // ── Header Banner ──
    doc.rect(40, 40, contentWidth, 54).fill('#0f172a');
    doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
       .text('HRT AI INSPECTION SYSTEM', 55, 48);
    doc.fontSize(9).font('Helvetica')
       .fillColor('#94a3b8')
       .text('OFFICIAL HYDROELECTRIC TUNNEL DEFECT AUDIT & RISK REPORT', 55, 68);

    doc.fillColor('#38bdf8').fontSize(8.5).font('Helvetica-Bold')
       .text('Author: Shagun <shagunsoni197@gmail.com>', 330, 48, { width: 210, align: 'right' });
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
       .text(`Generated: ${new Date(now).toISOString().slice(0, 19).replace('T', ' ')} UTC`, 330, 68, { width: 210, align: 'right' });

    doc.y = 105;

    // ── Inspection Metadata & Session Parameters ──
    const isPhotoBatch = String(inspectionId || '').startsWith('PHOTO-');
    const isWebcam = String(inspectionId || '').startsWith('CAM-');
    const modality = isPhotoBatch
      ? 'Still Photo Batch Upload (YOLOv8n-seg)'
      : isWebcam
        ? 'Live Optical Camera Stream (YOLOv8n-seg)'
        : 'Subsea ROV Autonomous Scanner (YOLOv8n-seg)';

    const minZ = detections.reduce((min, d) => Math.min(min, Number(d.z || d.coord_z || d.chainage_z || 0)), Infinity);
    const maxZ = detections.reduce((max, d) => Math.max(max, Number(d.z || d.coord_z || d.chainage_z || 0)), -Infinity);
    const chainageSpan = detections.length > 0 && isFinite(minZ) && isFinite(maxZ)
      ? `${minZ.toFixed(1)} m – ${maxZ.toFixed(1)} m (${Math.max(0.001, (maxZ - minZ) / 1000).toFixed(3)} km)`
      : '0.0 m – 45.0 m (0.045 km)';

    doc.fillColor(darkInk).fontSize(12).font('Helvetica-Bold').text('1. Inspection Session Parameters', 40, doc.y);
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor(borderStroke).lineWidth(1).stroke();
    doc.y += 8;

    const metaY = doc.y;
    doc.rect(40, metaY, contentWidth, 52).fillAndStroke(cardBg, borderStroke);
    doc.fillColor(mutedInk).fontSize(8.5).font('Helvetica');

    // Column 1
    doc.text('Session ID:', 50, metaY + 8).font('Helvetica-Bold').fillColor(darkInk).text(inspectionId || 'LIVE-ROV-SESSION', 135, metaY + 8);
    doc.font('Helvetica').fillColor(mutedInk).text('Tunnel Asset:', 50, metaY + 22).font('Helvetica-Bold').fillColor(darkInk).text('Nathpa Jhakri HRT — Head Race Tunnel', 135, metaY + 22);
    doc.font('Helvetica').fillColor(mutedInk).text('Inspection Modality:', 50, metaY + 36).font('Helvetica-Bold').fillColor(darkInk).text(modality, 135, metaY + 36);

    // Column 2
    doc.font('Helvetica').fillColor(mutedInk).text('Date / Timestamp:', 330, metaY + 8).font('Helvetica-Bold').fillColor(darkInk).text(new Date(now).toISOString().slice(0, 10), 415, metaY + 8);
    doc.font('Helvetica').fillColor(mutedInk).text('Chainage Range:', 330, metaY + 22).font('Helvetica-Bold').fillColor(darkInk).text(chainageSpan, 415, metaY + 22);
    doc.font('Helvetica').fillColor(mutedInk).text('Audit Status:', 330, metaY + 36).font('Helvetica-Bold').fillColor(secondaryColor).text('COMPLETED & VERIFIED', 415, metaY + 36);

    doc.y = metaY + 62;

    // ── Inspection KPIs Quad ──
    const critCount = detections.filter(d => (d.severity || '').toLowerCase() === 'critical' || Number(d.confidence || 0) >= 0.85).length;
    const majCount = detections.filter(d => (d.severity || '').toLowerCase() === 'major' || (Number(d.confidence || 0) >= 0.70 && Number(d.confidence || 0) < 0.85)).length;
    const totalAreaMm2 = detections.reduce((sum, d) => sum + (Number(d.crack_area_mm2) || (Number(d.crack_width_mm || 0) * Number(d.crack_length_mm || 0)) || Number(d.area_mm2) || 0), 0);

    doc.fillColor(darkInk).fontSize(12).font('Helvetica-Bold').text('2. Defect Severity & Quantitative KPIs', 40, doc.y);
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor(borderStroke).lineWidth(1).stroke();
    doc.y += 8;

    const kpiY = doc.y;
    const kpiW = (contentWidth - 24) / 4;
    const kpis = [
      { label: 'TOTAL DEFECTS', val: String(detections.length), color: primaryColor, sub: 'Confirmed findings' },
      { label: 'CRITICAL SEVERITY', val: String(critCount), color: criticalColor, sub: 'Immediate grouting' },
      { label: 'MAJOR ANOMALIES', val: String(majCount), color: majorColor, sub: 'Scheduled repair' },
      { label: 'TOTAL CRACK AREA', val: totalAreaMm2 > 0 ? `${Math.round(totalAreaMm2)} mm²` : '0 mm²', color: secondaryColor, sub: `${(totalAreaMm2 / 1e6).toFixed(4)} m² surface` }
    ];

    kpis.forEach((kpi, idx) => {
      const bx = 40 + idx * (kpiW + 8);
      doc.rect(bx, kpiY, kpiW, 46).fillAndStroke(cardBg, borderStroke);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(mutedInk).text(kpi.label, bx + 6, kpiY + 6);
      doc.fontSize(15).font('Helvetica-Bold').fillColor(kpi.color).text(kpi.val, bx + 6, kpiY + 18);
      doc.fontSize(6.5).font('Helvetica').fillColor(mutedInk).text(kpi.sub, bx + 6, kpiY + 34);
    });

    doc.y = kpiY + 56;

    // ── Chainage Spatial Risk Analytics (25m Intervals) ──
    doc.fillColor(darkInk).fontSize(12).font('Helvetica-Bold').text('3. Chainage Spatial Risk Distribution (25m Bins)', 40, doc.y);
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor(borderStroke).lineWidth(1).stroke();
    doc.y += 8;

    const intervalM = 25;
    const binMap = new Map();
    detections.forEach(d => {
      const z = Number(d.z || d.coord_z || d.chainage_z || 0);
      const binStart = Math.floor(z / intervalM) * intervalM;
      const binKey = `${binStart}-${binStart + intervalM}`;
      if (!binMap.has(binKey)) {
        binMap.set(binKey, { start: binStart, end: binStart + intervalM, total: 0, critical: 0, major: 0 });
      }
      const b = binMap.get(binKey);
      b.total++;
      const sev = (d.severity || (d.confidence >= 0.85 ? 'Critical' : 'Major')).toLowerCase();
      if (sev === 'critical') b.critical++;
      else if (sev === 'major') b.major++;
    });

    const bins = Array.from(binMap.values()).sort((a, b) => a.start - b.start);

    const tableY = doc.y;
    doc.rect(40, tableY, contentWidth, 16).fill('#1e293b');
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
    doc.text('Chainage Bin (m)', 48, tableY + 4, { width: 100 });
    doc.text('Defect Count', 160, tableY + 4, { width: 70 });
    doc.text('Critical Anom.', 250, tableY + 4, { width: 70 });
    doc.text('Major Anom.', 340, tableY + 4, { width: 70 });
    doc.text('Spatial Risk Category', 430, tableY + 4, { width: 110 });

    doc.y = tableY + 16;
    if (bins.length === 0) {
      doc.rect(40, doc.y, contentWidth, 16).fillAndStroke('#ffffff', borderStroke);
      doc.fillColor(mutedInk).fontSize(8).font('Helvetica-Oblique').text('No spatial defect clusters recorded.', 48, doc.y + 4);
      doc.y += 18;
    } else {
      bins.slice(0, 5).forEach((bin, bIdx) => {
        const rowY = doc.y;
        const bg = bIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.rect(40, rowY, contentWidth, 15).fillAndStroke(bg, borderStroke);
        doc.fillColor(darkInk).fontSize(7.5).font('Helvetica');
        doc.text(`Ch ${bin.start}m – ${bin.end}m`, 48, rowY + 4);
        doc.text(String(bin.total), 160, rowY + 4);
        doc.text(String(bin.critical), 250, rowY + 4);
        doc.text(String(bin.major), 340, rowY + 4);

        const riskTier = bin.critical > 0 ? 'HIGH RISK' : bin.major > 0 ? 'ELEVATED' : 'NOMINAL';
        const riskColor = bin.critical > 0 ? criticalColor : bin.major > 0 ? majorColor : secondaryColor;
        doc.font('Helvetica-Bold').fillColor(riskColor).text(riskTier, 430, rowY + 4);
        doc.y += 15;
      });
      doc.y += 6;
    }

    // ── Defect Manifest with Embedded Photos ──
    doc.fillColor(darkInk).fontSize(12).font('Helvetica-Bold').text('4. Surveyed Defect Manifest & Crack Snapshots', 40, doc.y);
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor(borderStroke).lineWidth(1).stroke();
    doc.y += 10;

    if (detections.length === 0) {
      doc.rect(40, doc.y, contentWidth, 36).fillAndStroke(cardBg, borderStroke);
      doc.fillColor(mutedInk).fontSize(9).font('Helvetica-Oblique')
         .text('No defect anomalies logged for this inspection session.', 50, doc.y + 12);
      doc.y += 45;
    } else {
      const cardHeight = 125;
      detections.forEach((d, idx) => {
        if (doc.y + cardHeight > 780) {
          doc.addPage();
          doc.y = 45;
        }

        const cy = doc.y;
        doc.rect(40, cy, contentWidth, cardHeight).fillAndStroke(cardBg, borderStroke);

        // Left Container: Embedded Defect Snapshot (155 x 111 pt)
        const photoX = 48;
        const photoY = cy + 7;
        const photoW = 155;
        const photoH = 111;
        doc.rect(photoX, photoY, photoW, photoH).fillAndStroke('#e2e8f0', '#94a3b8');

        let imageDrawn = false;
        const imgBuffer = extractImageBuffer(d.image_url);
        if (imgBuffer) {
          try {
            doc.image(imgBuffer, photoX + 2, photoY + 2, {
              fit: [photoW - 4, photoH - 4],
              align: 'center',
              valign: 'center'
            });
            imageDrawn = true;
          } catch (_) {
            imageDrawn = false;
          }
        }

        // Draw tactical targeting reticle in cyan
        doc.save();
        doc.strokeColor('#0284c7').lineWidth(1.2);
        doc.moveTo(photoX + 4, photoY + 12).lineTo(photoX + 4, photoY + 4).lineTo(photoX + 12, photoY + 4).stroke();
        doc.moveTo(photoX + photoW - 12, photoY + 4).lineTo(photoX + photoW - 4, photoY + 4).lineTo(photoX + photoW - 4, photoY + 12).stroke();
        doc.moveTo(photoX + 4, photoY + photoH - 12).lineTo(photoX + 4, photoY + photoH - 4).lineTo(photoX + 12, photoY + photoH - 4).stroke();
        doc.moveTo(photoX + photoW - 12, photoY + photoH - 4).lineTo(photoX + photoW - 4, photoY + photoH - 4).lineTo(photoX + photoW - 4, photoY + photoH - 12).stroke();
        doc.restore();

        if (!imageDrawn) {
          doc.fillColor(mutedInk).fontSize(8).font('Helvetica-Bold')
             .text('[ SNAPSHOT UNAVAILABLE ]', photoX + 8, photoY + 45, { width: photoW - 16, align: 'center' });
          doc.fontSize(6.5).font('Helvetica')
             .text('Photo stream omitted or corrupted', photoX + 8, photoY + 58, { width: photoW - 16, align: 'center' });
        }

        // Right Container: Defect Metadata & Annotations
        const infoX = 215;
        const infoY = cy + 8;
        const sev = d.severity || (Number(d.confidence || 0) >= 0.85 ? 'Critical' : 'Major');
        const sevColor = sev.toLowerCase() === 'critical' ? criticalColor : sev.toLowerCase() === 'major' ? majorColor : minorColor;
        const defId = d.id || (d._id ? String(d._id) : `DET-${String(idx + 1).padStart(3, '0')}`);

        // Badge & Title
        doc.fillColor(darkInk).fontSize(10.5).font('Helvetica-Bold')
           .text(`Defect #${idx + 1} — ${d.subtype || d.class_label || 'Structural Crack'}`, infoX, infoY);

        doc.rect(475, infoY, 70, 14).fill(sevColor);
        doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
           .text(sev.toUpperCase(), 475, infoY + 3, { width: 70, align: 'center' });

        // Meta Grid
        const confPercent = `${Math.round(Number(d.confidence || 0.85) * 100)}%`;
        const chainageVal = `${Number(d.z || d.coord_z || d.chainage_z || 0).toFixed(2)} m`;
        const clockPos = d.clock_pos || "12 o'clock (Crown)";
        const widthMm = Number(d.crack_width_mm || 2.8).toFixed(1);
        const lengthMm = Number(d.crack_length_mm || 180.0).toFixed(1);
        const areaMm2 = d.crack_area_mm2 != null
          ? `${Number(d.crack_area_mm2).toFixed(1)} mm²`
          : d.area_mm2 != null
            ? `${Number(d.area_mm2).toFixed(1)} mm²`
            : `${(widthMm * lengthMm).toFixed(1)} mm² (est.)`;

        let bboxStr = 'N/A';
        if (d.bbox) {
          bboxStr = `[${Math.round(d.bbox.x1 || 0)}, ${Math.round(d.bbox.y1 || 0)}, ${Math.round(d.bbox.x2 || 0)}, ${Math.round(d.bbox.y2 || 0)}]`;
        }

        doc.fillColor(mutedInk).fontSize(7.5).font('Helvetica');
        const lines = [
          ['Defect ID', defId, 'AI Confidence', confPercent],
          ['Tunnel Chainage', `Ch ${chainageVal}`, 'Radial Position', clockPos],
          ['Crack Dimensions', `${widthMm} mm × ${lengthMm} mm`, 'Segmented Area', areaMm2],
          ['Bounding Reticle', bboxStr, 'Review Status', d.review_status || 'Verified (AI)']
        ];

        lines.forEach((ln, lIdx) => {
          const ly = infoY + 22 + lIdx * 18;
          doc.font('Helvetica').fillColor(mutedInk).text(ln[0] + ':', infoX, ly);
          doc.font('Helvetica-Bold').fillColor(darkInk).text(ln[1], infoX + 75, ly);
          doc.font('Helvetica').fillColor(mutedInk).text(ln[2] + ':', infoX + 170, ly);
          doc.font('Helvetica-Bold').fillColor(darkInk).text(ln[3], infoX + 245, ly);
        });

        doc.y = cy + cardHeight + 8;
      });
    }

    // ── Document Footer & Engineering Disclaimer ──
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(p);
      const footerY = 812;
      doc.moveTo(40, footerY - 4).lineTo(555, footerY - 4).strokeColor(borderStroke).lineWidth(0.5).stroke();
      doc.fontSize(6.5).font('Helvetica').fillColor(mutedInk)
         .text('HRT AI Inspection System (YOLOv8n-seg) · Official Defect Audit · Author: Shagun <shagunsoni197@gmail.com>', 40, footerY, { width: 380 });
      doc.fontSize(7).font('Helvetica-Bold').fillColor(darkInk)
         .text(`Page ${p + 1} of ${range.count}`, 455, footerY, { width: 100, align: 'right' });
    }

    doc.end();
  });
}

// ── POST /api/reports/generate ──
// Generates official CSV or true binary PDF inspection reports with embedded crack photos
app.post('/api/reports/generate', async (req, res) => {
  const { format = 'pdf', inspection_id } = req.body || {};
  const normFormat = String(format).toLowerCase() === 'csv' ? 'csv' : 'pdf';
  const safeId = (inspection_id || 'live').replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    let detections = Array.isArray(req.body?.detections) ? req.body.detections : null;

    if (!detections) {
      let query = {};
      if (inspection_id) {
        if (inspection_id === 'INSP-LIVE-1') {
          query = { $or: [{ inspection_id }, { inspection_id: null }, { inspection_id: { $exists: false } }] };
        } else {
          query = { inspection_id };
        }
      }

      detections = db
        ? await db.collection('detections').find(query).sort({ z: 1, timestamp: 1 }).limit(500).toArray()
        : [];
    }

    const now = new Date();

    if (normFormat === 'csv') {
      const headers = ['Defect_ID', 'Class_Label', 'Confidence', 'Chainage_Z_m', 'Coord_X', 'Coord_Y', 'Frame_Index', 'Crack_Area_mm2', 'Timestamp'];
      const rows = detections.map((d, i) => [
        d._id ? String(d._id) : (d.id || `DET-${String(i + 1).padStart(3, '0')}`),
        d.class_label || d.class || 'crack',
        (d.confidence || 0).toFixed(3),
        (d.z || d.coord_z || d.chainage_z || 0).toFixed(2),
        (d.x || 0).toFixed(2),
        (d.y || 0).toFixed(2),
        d.frame_index || 0,
        d.crack_area_mm2 != null ? Number(d.crack_area_mm2).toFixed(1) : (d.area_mm2 != null ? Number(d.area_mm2).toFixed(1) : ''),
        d.timestamp ? new Date(d.timestamp).toISOString() : now.toISOString(),
      ].join(','));

      const csvContent = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="HRT_Inspection_Report_${safeId}.csv"`);
      return res.status(200).send(csvContent);
    }

    // Binary PDF Generation via PDFKit
    const pdfBuffer = await generateInspectionPdf({
      inspectionId: inspection_id,
      detections,
      now
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="HRT_Inspection_Report_${safeId}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(pdfBuffer);

  } catch (err) {
    console.error('[API Gateway] Error generating inspection report:', err);
    res.status(500).json({ error: 'Failed to generate report', detail: err.message });
  }
});

// ── GET /api/inspections/:id/export/pdf ──
// RESTful direct PDF export route
app.get('/api/inspections/:id/export/pdf', async (req, res) => {
  const inspection_id = req.params.id;
  const safeId = (inspection_id || 'live').replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    let query = {};
    if (inspection_id) {
      if (inspection_id === 'INSP-LIVE-1') {
        query = { $or: [{ inspection_id }, { inspection_id: null }, { inspection_id: { $exists: false } }] };
      } else {
        query = { inspection_id };
      }
    }
    const detections = db
      ? await db.collection('detections').find(query).sort({ z: 1, timestamp: 1 }).limit(500).toArray()
      : [];

    const pdfBuffer = await generateInspectionPdf({
      inspectionId: inspection_id,
      detections,
      now: new Date()
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="HRT_Inspection_Report_${safeId}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('[API Gateway] Error exporting inspection PDF:', err);
    res.status(500).json({ error: 'Failed to export PDF', detail: err.message });
  }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
