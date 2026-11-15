'use strict';

const express = require('express');
const { PERMISSIONS, ROLE_NAMES } = require('./roles');

/**
 * Authentication and user-management routes.
 *   POST   /api/auth/login        public
 *   POST   /api/auth/register     public (read-only Viewer role); can be switched off
 *   GET    /api/auth/me           any signed-in user
 *   GET    /api/users             users:manage
 *   POST   /api/users             users:manage
 *   PATCH  /api/users/:id         users:manage
 *   GET    /api/roles             any signed-in user (role names and permissions)
 */
function createAuthRouter(getService, middleware, { allowRegistration = true } = {}) {
  const router = express.Router();
  const { authenticate, guard, sendError } = middleware;
  const need = () => ({ error: 'Authentication is not configured on the server' });

  router.post('/api/auth/login', async (req, res) => {
    const service = getService();
    if (!service) return res.status(503).json(need());
    try {
      const { email, password } = req.body || {};
      const result = await service.login({ email, password, ip: req.ip || req.socket?.remoteAddress });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  router.post('/api/auth/register', async (req, res) => {
    if (!allowRegistration) return res.status(403).json({ error: 'Self-registration is disabled. Ask an Administrator for an account.' });
    const service = getService();
    if (!service) return res.status(503).json(need());
    try {
      const { email, password, name } = req.body || {};
      const result = await service.register({ email, password, name: typeof name === 'string' ? name : '', ip: req.ip || req.socket?.remoteAddress });
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });

  router.get('/api/auth/config', (_req, res) => res.json({ registrationEnabled: allowRegistration }));

  router.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user.toPublic() }));

  router.get('/api/roles', authenticate, (_req, res) => {
    const { RoleFactory } = require('./roles');
    res.json({ roles: ROLE_NAMES.map((n) => ({ name: n, permissions: RoleFactory.create(n).permissions })) });
  });

  router.get('/api/users', ...guard(PERMISSIONS.USERS_MANAGE), async (_req, res) => {
    try { res.json({ users: (await getService().listUsers()).map((u) => u.toPublic()) }); } catch (err) { sendError(res, err); }
  });

  router.post('/api/users', ...guard(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
      const user = await getService().createUser(req.body || {});
      res.status(201).json({ user: user.toPublic() });
    } catch (err) { sendError(res, err); }
  });

  router.patch('/api/users/:id', ...guard(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
      const user = await getService().updateUser(req.params.id, req.body || {}, req.user.id);
      res.json({ user: user.toPublic() });
    } catch (err) { sendError(res, err); }
  });

  return router;
}

module.exports = { createAuthRouter };
