/**
 * HRT AI Inspection System — Express Application Entry Point
 *
 * Boots the REST API server, wires middleware, registers all route modules,
 * and installs a global error-handler so unhandled exceptions never leak
 * raw stack traces to clients.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const detectionsRouter      = require('./routes/detections');
const spatialRoutes         = require('./routes/spatial');
// Module 6: Defect query & filtering (GET /api/detections, PATCH /api/detections/:id/status)
const detectionsQueryRoutes = require('./routes/detections.query');
// Module 6: Inspection session management
const inspectionsRoutes     = require('./routes/inspections');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Global Middleware
// ---------------------------------------------------------------------------

// Allow all origins in development; tighten this in production via an
// allowlist derived from process.env.ALLOWED_ORIGINS.
app.use(cors());

// Parse incoming JSON bodies (limit kept at Express default: 100 kb).
app.use(express.json());

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Used by load-balancers and the AI pipeline client to confirm the API is up.
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'HRT Inspection API' });
});

// ---------------------------------------------------------------------------
// API Routes — Module 3: Real-Time Telemetry Ingestion
// ---------------------------------------------------------------------------

app.use('/api/detections', detectionsRouter);       // Module 3: ingestion (POST)
app.use('/api/detections', detectionsQueryRoutes);  // Module 6: query (GET) + status (PATCH)

// ---------------------------------------------------------------------------
// Placeholder Routes (future modules)
// ---------------------------------------------------------------------------

// Module 5 - Spatial Analytics & Chainage Aggregation
app.use('/api/spatial-summary', spatialRoutes);

app.use('/api/inspections', inspectionsRoutes);  // Module 6: inspection sessions

// ---------------------------------------------------------------------------
// 404 — Catch-all for unknown routes
// ---------------------------------------------------------------------------

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ---------------------------------------------------------------------------
// Global Error Handler
// Must be registered AFTER all routes (Express identifies it by arity = 4).
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Global Error Handler]', err);

  // Never expose raw internal errors in production.
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    error:  err.message || 'Internal Server Error',
    detail: isDev ? err.stack : undefined,
  });
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[HRT Backend] Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Graceful shutdown: allow in-flight requests to complete before exit.
process.on('SIGTERM', () => {
  console.log('[HRT Backend] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[HRT Backend] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[HRT Backend] SIGINT received — shutting down gracefully');
  server.close(() => {
    console.log('[HRT Backend] HTTP server closed');
    process.exit(0);
  });
});

module.exports = app; // exported for testing