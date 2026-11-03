'use strict';

/**
 * rateLimiter.js
 * In-memory token bucket / sliding window rate limiter middleware.
 * Protects PostgreSQL connection pool from exhaustion during high-FPS ingestion
 * and shields compute-heavy report generation from denial-of-service.
 */

/**
 * Parses the client IP address from the request.
 * Prioritizes the first IP in the X-Forwarded-For header if present (e.g., behind proxies/load balancers),
 * falling back to req.socket.remoteAddress or req.ip.
 */
function getClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const firstIp = raw.split(',')[0].trim();
      if (firstIp) return firstIp;
    }
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function createRateLimiter({
  windowMs = 60000,
  max = 120,
  message = 'Too many requests, please try again later.',
  now = () => Date.now(),
} = {}) {
  // Map of clientKey -> Array of timestamps (in epoch ms)
  const hits = new Map();

  // Periodic cleanup so memory does not grow unbounded
  const cleanupTimer = setInterval(() => {
    const currentNow = typeof now === 'function' ? now() : Date.now();
    const threshold = currentNow - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const valid = timestamps.filter((ts) => ts > threshold);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, Math.max(windowMs, 30000));

  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  function rateLimiter(req, res, next) {
    const clientKey = getClientIp(req);
    const currentTime = typeof now === 'function' ? now() : Date.now();
    const windowStart = currentTime - windowMs;

    let timestamps = hits.get(clientKey);
    if (!timestamps) {
      timestamps = [];
    } else {
      // Sliding window: purge timestamps outside the active window
      timestamps = timestamps.filter((ts) => ts > windowStart);
    }

    if (timestamps.length >= max) {
      // Rejection: Window capacity exceeded
      hits.set(clientKey, timestamps);
      const oldest = timestamps[0];
      const resetTimeMs = (oldest !== undefined ? oldest : currentTime) + windowMs;
      const retryAfterSec = Math.max(1, Math.ceil((resetTimeMs - currentTime) / 1000));
      const resetEpochSec = Math.ceil(resetTimeMs / 1000);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', resetEpochSec);
      res.setHeader('Retry-After', retryAfterSec);

      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSec,
      });
    }

    // Within quota: log timestamp and advance
    timestamps.push(currentTime);
    hits.set(clientKey, timestamps);

    const remaining = Math.max(0, max - timestamps.length);
    const resetTimeMs = timestamps[0] + windowMs;
    const resetEpochSec = Math.ceil(resetTimeMs / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetEpochSec);

    next();
  }

  rateLimiter.reset = () => hits.clear();
  return rateLimiter;
}

module.exports = { createRateLimiter, getClientIp };
