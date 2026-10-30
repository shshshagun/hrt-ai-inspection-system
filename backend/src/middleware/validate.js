'use strict';

const { validationResult } = require('express-validator');

// ── Known valid UUIDs pattern ─────────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_SEVERITIES = ['critical', 'major', 'minor', 'info'];

/**
 * isValidUUID(str) → boolean
 * Pure helper — usable outside express-validator chains too.
 */
function isValidUUID(str) {
  return typeof str === 'string' && UUID_REGEX.test(str);
}

/**
 * isValidSeverity(str) → boolean
 */
function isValidSeverity(str) {
  return VALID_SEVERITIES.includes(str);
}

/**
 * validate(checks) → Express middleware
 *
 * Usage:
 *   router.get('/path', validate([
 *     query('limit').optional().isInt({ min: 1, max: 100 }),
 *   ]), handler);
 *
 * Returns HTTP 400 with structured error array if any check fails.
 */
function validate(checks) {
  return async (req, res, next) => {
    // Run all checks in parallel
    await Promise.all(checks.map((check) => check.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error:   'Validation failed',
        details: errors.array().map((e) => ({
          field:   e.path,
          message: e.msg,
          value:   e.value,
        })),
      });
    }

    return next();
  };
}

module.exports = { validate, isValidUUID, isValidSeverity };
