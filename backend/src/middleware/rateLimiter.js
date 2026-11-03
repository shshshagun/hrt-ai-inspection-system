'use strict';

/**
 * rateLimiter.js
 * In-memory token bucket / sliding window rate limiter middleware.
 * Protects PostgreSQL connection pool from exhaustion during high-FPS ingestion
 * and shields compute-heavy report generation from denial-of-service.
 */

function createRateLimiter({
  windowMs = 60000,
  max = 120,
  message = 'Too many requests, please try again later.',
} = {}) {
  const hits = new Map();

  // Periodic cleanup so memory does not grow unbounded
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.max(windowMs, 30000));

  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return function rateLimiter(req, res, next) {
    const clientKey = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let record = hits.get(clientKey);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(clientKey, record);
    } else {
      record.count++;
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      return res.status(429).json({
        error: message,
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
