/**
 * HRT AI Inspection System — PostgreSQL Connection Pool
 *
 * Exports a shared `pg.Pool` instance and a convenience `query()` helper.
 * All database access in this service goes through this module so that
 * connection settings are configured in exactly one place.
 *
 * Configuration is read entirely from environment variables (set in .env
 * during development, and from the deployment environment in production).
 */

'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Pool Configuration
// ---------------------------------------------------------------------------

/**
 * `max` is intentionally kept modest (10) for a single-node dev setup.
 * Raise it (or use PgBouncer) for production workloads.
 *
 * `idleTimeoutMillis` — how long a client may sit idle before being closed.
 * `connectionTimeoutMillis` — how long to wait for an available client before
 *   throwing an error (prevents request pile-ups when the DB is overloaded).
 */
const pool = new Pool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '5432', 10),
  database:           process.env.DB_NAME     || 'hrt_inspection',
  user:               process.env.DB_USER     || 'postgres',
  password:           process.env.DB_PASSWORD || '',
  max:                10,
  idleTimeoutMillis:  30_000,   // 30 s
  connectionTimeoutMillis: 5_000, // 5 s — keeps 503 responses snappy
});

// Log pool-level errors (e.g. unexpected client disconnections) so they don't
// crash the process silently.
pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Execute a parameterised SQL query against the shared pool.
 *
 * @param {string}  text   — SQL statement with $1, $2 … placeholders
 * @param {Array}   params — Positional parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
