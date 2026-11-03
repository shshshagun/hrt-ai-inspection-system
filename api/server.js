require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
// Receives JSON from predict.py and inserts it into MongoDB
app.post('/api/detections', async (req, res) => {
  const { class_label, confidence, bbox, frame_index, timestamp, x, y, z } = req.body || {};
  
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
      confidence: Number(confidence),
      bbox, // MongoDB can store the nested bbox object directly!
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
    const detections = await db.collection('detections')
      .find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
      
    res.json(detections);
  } catch (error) {
    console.error("Error fetching detections:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
