'use strict';
/**
 * Local demo server for the login flow: the real auth routes and middleware on an in-memory user
 * store, plus stub detection endpoints. No database or secrets needed.
 *   node api/auth/devServer.js          (port 5055)
 * Accounts: admin@example.com / AdminPass123 (Administrator); operator@example.com, engineer@example.com,
 * manager@example.com / Password123.
 */
const express = require('express');
const { AuthService } = require('./authService');
const { InMemoryUserRepository } = require('./userRepository');
const { createAuthMiddleware } = require('./middleware');
const { createAuthRouter } = require('./routes');
const { PERMISSIONS } = require('./roles');

(async () => {
  const service = new AuthService({ repository: new InMemoryUserRepository(), jwtSecret: 'local-demo-secret-0123456789', bcryptRounds: 4 });
  await service.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123', name: 'Demo Admin' });
  for (const role of ['Operator', 'Engineer', 'Manager']) {
    await service.createUser({ email: `${role.toLowerCase()}@example.com`, password: 'Password123', role, name: `Demo ${role}` });
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  const mw = createAuthMiddleware(() => service);
  app.use(createAuthRouter(() => service, mw));
  app.get('/api/detections', ...mw.guard(PERMISSIONS.DETECTIONS_READ), (_q, r) => r.json([]));
  app.get('/api/inspections', ...mw.guard(PERMISSIONS.INSPECTIONS_READ), (_q, r) => r.json([]));
  app.delete('/api/detections/:id', ...mw.guard(PERMISSIONS.DETECTIONS_DELETE), (_q, r) => r.json({ deleted: true }));
  app.post('/api/reports/generate', ...mw.guard(PERMISSIONS.REPORTS_GENERATE), (_q, r) => r.status(200).type('text/csv').send('ok'));
  app.get('/health', (_q, r) => r.send('OK'));
  const port = process.env.PORT || 5055;
  app.listen(port, () => console.log(`Auth demo server on http://localhost:${port}`));
})();
