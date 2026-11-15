'use strict';
/**
 * Tests for authentication and role-based access control.
 * Run:  node api/auth/auth.test.js
 * Uses an in-memory user repository, so no database is needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { PERMISSIONS, ROLE_NAMES, RoleFactory, Role, ReadOnlyRole, Operator, Administrator } = require('./roles');
const { User } = require('./user');
const { InMemoryUserRepository } = require('./userRepository');
const { AuthService, AuthError, LoginThrottle } = require('./authService');
const { createAuthMiddleware } = require('./middleware');
const { createAuthRouter } = require('./routes');

const SECRET = 'unit-test-secret-0123456789';

function makeService(opts = {}) {
  return new AuthService({ repository: new InMemoryUserRepository(), jwtSecret: SECRET, bcryptRounds: 4, ...opts });
}

async function startApp(service, enabled = true) {
  const app = express();
  app.use(express.json());
  const mw = createAuthMiddleware(() => service, { enabled });
  app.use(createAuthRouter(() => service, mw));
  app.get('/api/detections', ...mw.guard(PERMISSIONS.DETECTIONS_READ), (_req, res) => res.json({ ok: true }));
  app.post('/api/detections', ...mw.guard(PERMISSIONS.DETECTIONS_CREATE), (_req, res) => res.status(201).json({ ok: true }));
  app.delete('/api/detections/:id', ...mw.guard(PERMISSIONS.DETECTIONS_DELETE), (_req, res) => res.json({ deleted: true }));
  app.post('/api/reports/generate', ...mw.guard(PERMISSIONS.REPORTS_GENERATE), (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

async function seeded() {
  const service = makeService();
  await service.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123' });
  const app = await startApp(service);
  const admin = (await app.call('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.token;
  const tokens = { Administrator: admin };
  for (const role of ['Operator', 'Engineer', 'Manager']) {
    await app.call('POST', '/api/users', { token: admin, body: { email: `${role.toLowerCase()}@example.com`, password: 'Password123', role, name: role } });
    tokens[role] = (await app.call('POST', '/api/auth/login', { body: { email: `${role.toLowerCase()}@example.com`, password: 'Password123' } })).body.token;
  }
  return { service, app, tokens };
}

test('Role is abstract and the hierarchy shares read access', () => {
  assert.throws(() => new Role('x', []), TypeError);
  assert.ok(RoleFactory.create('Operator') instanceof ReadOnlyRole);
  assert.ok(RoleFactory.create('Operator') instanceof Operator);
  assert.ok(RoleFactory.create('Administrator') instanceof Administrator);
  assert.ok(!(RoleFactory.create('Administrator') instanceof ReadOnlyRole));
  assert.equal(RoleFactory.create('Engineer'), RoleFactory.create('Engineer'), 'roles are shared instances');
  assert.throws(() => RoleFactory.create('Guest'), RangeError);
});

test('permission matrix per role', () => {
  const can = (r, p) => RoleFactory.create(r).can(p);
  for (const r of ROLE_NAMES) {
    assert.ok(can(r, PERMISSIONS.DETECTIONS_READ), `${r} reads detections`);
    assert.ok(can(r, PERMISSIONS.INSPECTIONS_READ), `${r} reads inspections`);
  }
  assert.ok(can('Operator', PERMISSIONS.DETECTIONS_CREATE));
  assert.ok(!can('Engineer', PERMISSIONS.DETECTIONS_CREATE));
  assert.ok(can('Engineer', PERMISSIONS.DETECTIONS_REVIEW));
  assert.ok(can('Manager', PERMISSIONS.REPORTS_GENERATE));
  assert.ok(!can('Operator', PERMISSIONS.REPORTS_GENERATE));
  for (const r of ['Operator', 'Engineer', 'Manager']) {
    assert.ok(!can(r, PERMISSIONS.DETECTIONS_DELETE), `${r} cannot delete`);
    assert.ok(!can(r, PERMISSIONS.USERS_MANAGE), `${r} cannot manage users`);
  }
  for (const p of Object.values(PERMISSIONS)) assert.ok(can('Administrator', p), `Administrator has ${p}`);
});

test('User keeps its state private and never exposes the password hash', () => {
  const u = new User({ id: 1, email: ' A@B.CO ', name: 'A', role: 'Manager', passwordHash: 'secret-hash' });
  assert.equal(u.email, 'a@b.co');
  assert.equal(JSON.stringify(u.toPublic()).includes('secret-hash'), false);
  assert.equal(Object.keys(u).length, 0, 'no enumerable own fields (state is private)');
  assert.throws(() => new User({ id: 1, email: 'a@b.co', role: 'Root', passwordHash: 'x' }), RangeError);
});

test('passwords are stored hashed, login validates input', async () => {
  const service = makeService();
  const u = await service.createUser({ email: 'x@y.zz', password: 'GoodPass123', role: 'Operator' });
  assert.notEqual(u.passwordHash, 'GoodPass123');
  assert.match(u.passwordHash, /^\$2[aby]\$/);
  await assert.rejects(service.createUser({ email: 'x@y.zz', password: 'GoodPass123', role: 'Operator' }), (e) => e instanceof AuthError && e.status === 409);
  await assert.rejects(service.createUser({ email: 'bad', password: 'GoodPass123', role: 'Operator' }), (e) => e.status === 400);
  await assert.rejects(service.createUser({ email: 'a@b.co', password: 'short', role: 'Operator' }), (e) => e.status === 400);
  await assert.rejects(service.createUser({ email: 'a@b.co', password: 'GoodPass123', role: 'Root' }), (e) => e.status === 400);
});

test('login: correct credentials return a token, wrong ones return 401 with the same message', async () => {
  const service = makeService();
  await service.createUser({ email: 'x@y.zz', password: 'GoodPass123', role: 'Engineer' });
  const ok = await service.login({ email: 'X@Y.ZZ', password: 'GoodPass123' });
  assert.ok(ok.token); assert.equal(ok.user.role, 'Engineer'); assert.equal('passwordHash' in ok.user, false);
  const wrongPw = await service.login({ email: 'x@y.zz', password: 'nope-nope-nope' }).catch((e) => e);
  const unknown = await service.login({ email: 'nobody@y.zz', password: 'nope-nope-nope' }).catch((e) => e);
  assert.equal(wrongPw.status, 401); assert.equal(unknown.status, 401); assert.equal(wrongPw.message, unknown.message);
});

test('login throttling blocks after repeated failures', async () => {
  const service = makeService({ throttle: new LoginThrottle({ max: 3, windowMs: 60000 }) });
  await service.createUser({ email: 'x@y.zz', password: 'GoodPass123', role: 'Operator' });
  for (let i = 0; i < 3; i++) await service.login({ email: 'x@y.zz', password: 'wrong-wrong', ip: '1.1.1.1' }).catch(() => {});
  const blocked = await service.login({ email: 'x@y.zz', password: 'GoodPass123', ip: '1.1.1.1' }).catch((e) => e);
  assert.equal(blocked.status, 429);
  const otherIp = await service.login({ email: 'x@y.zz', password: 'GoodPass123', ip: '2.2.2.2' });
  assert.ok(otherIp.token, 'another client is not blocked');
});

test('token verification: tampered, expired and disabled-account tokens are rejected', async () => {
  const service = makeService();
  const user = await service.createUser({ email: 'x@y.zz', password: 'GoodPass123', role: 'Operator' });
  const { token } = await service.login({ email: 'x@y.zz', password: 'GoodPass123' });
  assert.equal((await service.verifyToken(token)).id, user.id);
  await assert.rejects(service.verifyToken(token + 'x'), (e) => e.status === 401);
  const expired = jwt.sign({ sub: user.id, role: 'Operator' }, SECRET, { expiresIn: -10 });
  await assert.rejects(service.verifyToken(expired), (e) => e.status === 401 && /expired/i.test(e.message));
  const wrongSecret = jwt.sign({ sub: user.id }, 'another-secret-0123456789');
  await assert.rejects(service.verifyToken(wrongSecret), (e) => e.status === 401);
  const noneAlg = jwt.sign({ sub: user.id }, '', { algorithm: 'none' });
  await assert.rejects(service.verifyToken(noneAlg), (e) => e.status === 401);
  await service.updateUser(user.id, { active: false }, 'someone-else');
  await assert.rejects(service.verifyToken(token), (e) => e.status === 401);
});

test('API: unauthenticated requests get 401, bad tokens 401', async () => {
  const { app } = await seeded();
  assert.equal((await app.call('GET', '/api/detections')).status, 401);
  assert.equal((await app.call('GET', '/api/detections', { token: 'garbage' })).status, 401);
  assert.equal((await app.call('GET', '/api/auth/me')).status, 401);
  await app.close();
});

test('API: every role is allowed or refused (403) according to the matrix', async () => {
  const { app, tokens } = await seeded();
  const expected = {
    'GET /api/detections': { Operator: 200, Engineer: 200, Manager: 200, Administrator: 200 },
    'POST /api/detections': { Operator: 201, Engineer: 403, Manager: 403, Administrator: 201 },
    'DELETE /api/detections/1': { Operator: 403, Engineer: 403, Manager: 403, Administrator: 200 },
    'POST /api/reports/generate': { Operator: 403, Engineer: 403, Manager: 200, Administrator: 200 },
    'GET /api/users': { Operator: 403, Engineer: 403, Manager: 403, Administrator: 200 },
  };
  for (const [route, perRole] of Object.entries(expected)) {
    const [method, path] = route.split(' ');
    for (const [role, status] of Object.entries(perRole)) {
      const r = await app.call(method, path, { token: tokens[role] });
      assert.equal(r.status, status, `${role} ${route} expected ${status} got ${r.status}`);
    }
  }
  const me = await app.call('GET', '/api/auth/me', { token: tokens.Manager });
  assert.equal(me.body.user.role, 'Manager');
  await app.close();
});

test('API: user management and last-administrator protection', async () => {
  const { app, tokens, service } = await seeded();
  const list = await app.call('GET', '/api/users', { token: tokens.Administrator });
  assert.equal(list.body.users.length, 4);
  assert.ok(list.body.users.every((u) => !('passwordHash' in u)));
  const adminId = list.body.users.find((u) => u.role === 'Administrator').id;
  const operatorId = list.body.users.find((u) => u.role === 'Operator').id;
  assert.equal((await app.call('PATCH', `/api/users/${adminId}`, { token: tokens.Administrator, body: { role: 'Operator' } })).status, 400);
  assert.equal((await app.call('PATCH', `/api/users/${adminId}`, { token: tokens.Administrator, body: { active: false } })).status, 400);
  assert.equal((await app.call('PATCH', `/api/users/${operatorId}`, { token: tokens.Administrator, body: { role: 'Bogus' } })).status, 400);
  assert.equal((await app.call('PATCH', '/api/users/does-not-exist', { token: tokens.Administrator, body: { role: 'Manager' } })).status, 404);
  const promoted = await app.call('PATCH', `/api/users/${operatorId}`, { token: tokens.Administrator, body: { role: 'Manager' } });
  assert.equal(promoted.body.user.role, 'Manager');
  // the old Operator token now carries Manager rights because the role is read from the store
  assert.equal((await app.call('POST', '/api/reports/generate', { token: tokens.Operator })).status, 200);
  assert.equal((await app.call('POST', '/api/users', { token: tokens.Administrator, body: { email: 'admin@example.com', password: 'Password123', role: 'Operator' } })).status, 409);
  await app.close();
});

test('AUTH_ENABLED=false bypasses checks and an unconfigured server fails closed', async () => {
  const open = await startApp(null, false);
  assert.equal((await open.call('GET', '/api/detections')).status, 200);
  await open.close();
  const unconfigured = await startApp(null, true);
  assert.equal((await unconfigured.call('GET', '/api/detections')).status, 503, 'fails closed when auth is not configured');
  await unconfigured.close();
});

test('AuthService refuses a weak signing secret', () => {
  assert.throws(() => new AuthService({ repository: new InMemoryUserRepository(), jwtSecret: 'short' }));
});
