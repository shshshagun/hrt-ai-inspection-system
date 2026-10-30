require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// Initialize MongoDB Client
// Configure MONGODB_URI in your environment variables (e.g. Render dashboard)
const uri = process.env.MONGODB_URI;
let db;

async function connectDB() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    // Specify the database name (it will be created if it doesn't exist)
    db = client.db('hrt_inspection');
    console.log("✅ Successfully connected to MongoDB Atlas.");
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
  }
}
connectDB();

// ── POST /api/detections ──
// Receives JSON from predict.py and inserts it into MongoDB
app.post('/api/detections', async (req, res) => {
  const { class_label, confidence, bbox, frame_index, timestamp, x, y, z } = req.body;
  
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }

  try {
    const detection = {
      class_label,
      confidence,
      bbox, // MongoDB can store the nested bbox object directly!
      frame_index,
      timestamp: new Date(timestamp),
      x,
      y,
      z,
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
    return res.status(500).json({ error: 'Database not initialized' });
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
