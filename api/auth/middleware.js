'use strict';

const { AuthError } = require('./authService');

/**
 * Express middleware factory for authentication and permission checks.
 *
 * @param {() => (import('./authService').AuthService|null)} getService returns the AuthService, or null when authentication is not configured
 * @param {{enabled?: boolean}} [opts] enabled=false (AUTH_ENABLED=false) lets every request through as a development Administrator
 */
function createAuthMiddleware(getService, { enabled = true } = {}) {
  const { User } = require('./user');
  const devAdmin = new User({ id: 'dev', email: 'dev@localhost.local', name: 'Development', role: 'Administrator', passwordHash: '-' });

  function sendError(res, err) {
    const status = err instanceof AuthError ? err.status : 500;
    return res.status(status).json({ error: status === 500 ? 'Internal Server Error' : err.message });
  }

  /** Requires a valid Bearer token; attaches req.user. */
  async function authenticate(req, res, next) {
    if (!enabled) { req.user = devAdmin; return next(); }
    const service = getService();
    if (!service) return res.status(503).json({ error: 'Authentication is not configured on the server' });
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return res.status(401).json({ error: 'Authentication required' });
    try {
      req.user = await service.verifyToken(match[1]);
      return next();
    } catch (err) {
      return sendError(res, err);
    }
  }

  /** Requires authenticate() to have run, and the user's role to grant `permission`. */
  function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      if (!req.user.can(permission)) return res.status(403).json({ error: `Your role (${req.user.roleName}) is not allowed to perform this action` });
      return next();
    };
  }

  /** authenticate + requirePermission in one call, for route definitions. */
  function guard(permission) {
    const check = requirePermission(permission);
    return [authenticate, check];
  }

  return { authenticate, requirePermission, guard, sendError };
}

module.exports = { createAuthMiddleware };
