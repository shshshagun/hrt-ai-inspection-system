require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Initialize Postgres Pool
// Render injects the DATABASE_URL environment variable automatically if linked
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Run migrations on startup to ensure the table exists
const initDB = async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS detections (
        id SERIAL PRIMARY KEY,
        class_label VARCHAR(50) NOT NULL,
        confidence REAL NOT NULL,
        bbox_x1 REAL,
        bbox_y1 REAL,
        bbox_x2 REAL,
        bbox_y2 REAL,
        bbox_width REAL,
        bbox_height REAL,
        frame_index INTEGER,
        timestamp TIMESTAMPTZ,
        x REAL,
        y REAL,
        z REAL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  try {
    await pool.query(schema);
    console.log("✅ Database schema initialized successfully.");
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
  }
};
initDB();

// ── POST /api/detections ──
// Receives JSON from predict.py and inserts it into PostgreSQL
app.post('/api/detections', async (req, res) => {
  const { class_label, confidence, bbox, frame_index, timestamp, x, y, z } = req.body;
  
  try {
    const query = `
      INSERT INTO detections (
        class_label, confidence, 
        bbox_x1, bbox_y1, bbox_x2, bbox_y2, bbox_width, bbox_height, 
        frame_index, timestamp, x, y, z
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const values = [
      class_label, confidence,
      bbox?.x1, bbox?.y1, bbox?.x2, bbox?.y2, bbox?.width, bbox?.height,
      frame_index, timestamp, x, y, z
    ];
    
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error inserting detection:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── GET /api/detections ──
// Returns the latest 100 detections
app.get('/api/detections', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM detections ORDER BY timestamp DESC LIMIT 100');
    res.json(result.rows);
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
