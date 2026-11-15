'use strict';
/**
 * Tests for self-registration and server-side Administrator provisioning.
 * Run:  node api/auth/registration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { PERMISSIONS, ROLE_NAMES, ASSIGNABLE_ROLES, RoleFactory, ReadOnlyRole, Viewer } = require('./roles');
const { InMemoryUserRepository } = require('./userRepository');
const { AuthService, LoginThrottle } = require('./authService');
const { createAuthMiddleware } = require('./middleware');
const { createAuthRouter } = require('./routes');

const SECRET = 'registration-test-secret-0123456789';
const makeService = (opts = {}) => new AuthService({ repository: new InMemoryUserRepository(), jwtSecret: SECRET, bcryptRounds: 4, ...opts });

async function startApp(service, allowRegistration = true) {
  const app = express();
  app.use(express.json());
  const mw = createAuthMiddleware(() => service);
  app.use(createAuthRouter(() => service, mw, { allowRegistration }));
  app.get('/api/detections', ...mw.guard(PERMISSIONS.DETECTIONS_READ), (_q, r) => r.json({ ok: true }));
  app.post('/api/detections', ...mw.guard(PERMISSIONS.DETECTIONS_CREATE), (_q, r) => r.status(201).json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('Viewer is a read-only role and Administrator is not assignable', () => {
  assert.ok(RoleFactory.create('Viewer') instanceof Viewer && RoleFactory.create('Viewer') instanceof ReadOnlyRole);
  assert.deepEqual(RoleFactory.create('Viewer').permissions, [PERMISSIONS.DETECTIONS_READ, PERMISSIONS.INSPECTIONS_READ].sort());
  assert.ok(ROLE_NAMES.includes('Administrator'));
  assert.ok(!ASSIGNABLE_ROLES.includes('Administrator'));
});

test('sign-up creates a Viewer, returns a working token and cannot choose a role', async () => {
  const service = makeService();
  const app = await startApp(service);
  const res = await app.call('POST', '/api/auth/register', { body: { email: 'New.User@Example.com', password: 'GoodPass123', name: 'New User', role: 'Administrator' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'Viewer', 'a requested role is ignored');
  assert.equal(res.body.user.email, 'new.user@example.com');
  assert.equal('passwordHash' in res.body.user, false);
  const token = res.body.token;
  assert.equal((await app.call('GET', '/api/detections', { token })).status, 200);
  assert.equal((await app.call('POST', '/api/detections', { token })).status, 403, 'a Viewer cannot create detections');
  const login = await app.call('POST', '/api/auth/login', { body: { email: 'new.user@example.com', password: 'GoodPass123' } });
  assert.equal(login.status, 200);
  await app.close();
});

test('sign-up validates input and rejects duplicates', async () => {
  const app = await startApp(makeService());
  assert.equal((await app.call('POST', '/api/auth/register', { body: { email: 'not-an-email', password: 'GoodPass123' } })).status, 400);
  assert.equal((await app.call('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'short' } })).status, 400);
  assert.equal((await app.call('POST', '/api/auth/register', { body: {} })).status, 400);
  assert.equal((await app.call('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'GoodPass123' } })).status, 201);
  assert.equal((await app.call('POST', '/api/auth/register', { body: { email: 'A@B.co', password: 'GoodPass123' } })).status, 409);
  await app.close();
});

test('sign-up is rate limited per client and can be switched off', async () => {
  const limited = makeService({ registerThrottle: new LoginThrottle({ max: 2, windowMs: 60000 }) });
  const app = await startApp(limited);
  for (let i = 0; i < 2; i++) assert.equal((await app.call('POST', '/api/auth/register', { body: { email: `u${i}@b.co`, password: 'GoodPass123' } })).status, 201);
  assert.equal((await app.call('POST', '/api/auth/register', { body: { email: 'u9@b.co', password: 'GoodPass123' } })).status, 429);
  await app.close();
  const off = await startApp(makeService(), false);
  assert.equal((await off.call('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'GoodPass123' } })).status, 403);
  assert.equal((await off.call('GET', '/api/auth/config')).body.registrationEnabled, false);
  await off.close();
});

test('Administrator accounts cannot be created or granted through the API', async () => {
  const service = makeService();
  await service.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123' });
  const app = await startApp(service);
  const admin = (await app.call('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.token;
  const create = await app.call('POST', '/api/users', { token: admin, body: { email: 'x@y.zz', password: 'GoodPass123', role: 'Administrator' } });
  assert.equal(create.status, 400); assert.match(create.body.error, /server configuration/);
  assert.equal((await app.call('POST', '/api/users', { token: admin, body: { email: 'x@y.zz', password: 'GoodPass123' } })).status, 400, 'a role is required');
  const reg = await app.call('POST', '/api/auth/register', { body: { email: 'v@y.zz', password: 'GoodPass123' } });
  const viewerId = reg.body.user.id;
  const promote = await app.call('PATCH', `/api/users/${viewerId}`, { token: admin, body: { role: 'Administrator' } });
  assert.equal(promote.status, 400);
  const ok = await app.call('PATCH', `/api/users/${viewerId}`, { token: admin, body: { role: 'Operator' } });
  assert.equal(ok.body.user.role, 'Operator', 'an Administrator can raise a Viewer to another role');
  await app.close();
});

test('ensureAdministrator creates, repairs and is idempotent (configuration is the source of truth)', async () => {
  const service = makeService();
  assert.equal(await service.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123' }), 'created');
  assert.equal(await service.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123' }), 'unchanged');
  assert.equal(await service.countAdministrators(), 1);
  // a new password in the configuration replaces the old one
  assert.equal(await service.ensureAdministrator({ email: 'admin@example.com', password: 'Rotated-Pass-456' }), 'updated');
  assert.ok((await service.login({ email: 'admin@example.com', password: 'Rotated-Pass-456' })).token);
  await assert.rejects(service.login({ email: 'admin@example.com', password: 'AdminPass123' }), (e) => e.status === 401);
  // a registered user listed in the configuration becomes an Administrator
  await service.register({ email: 'boss@example.com', password: 'BossPass123' });
  assert.equal(await service.ensureAdministrator({ email: 'boss@example.com', password: 'BossPass123' }), 'updated');
  assert.equal(await service.countAdministrators(), 2);
  await assert.rejects(service.ensureAdministrator({ email: 'bad', password: 'BossPass123' }), (e) => e.status === 400);
});
