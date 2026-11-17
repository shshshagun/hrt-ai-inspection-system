'use strict';
/**
 * Tests for forgot password / reset with an e-mailed one-time code.
 * Run:  node api/auth/passwordReset.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { InMemoryUserRepository } = require('./userRepository');
const { AuthService } = require('./authService');
const { createAuthMiddleware } = require('./middleware');
const { createAuthRouter } = require('./routes');
const { PasswordResetService, InMemoryResetStore, GENERIC_SENT, BAD_CODE } = require('./passwordReset');
const { createMailer } = require('./mailer');

const SECRET = 'password-reset-test-secret-0123456789';
const OLD = 'OldPassword123';
const NEW = 'BrandNewPass456';

async function setup(opts = {}) {
  const clock = { t: 1_800_000_000_000 };
  const auth = new AuthService({ repository: new InMemoryUserRepository(), jwtSecret: SECRET, bcryptRounds: 4 });
  await auth.register({ email: 'viewer@example.com', password: OLD, name: 'Vera' });
  await auth.ensureAdministrator({ email: 'admin@example.com', password: 'AdminPass123' });
  const sent = [];
  const mailer = { send: async (m) => { if (opts.mailFails) throw new Error('smtp down'); sent.push(m); } };
  const store = new InMemoryResetStore();
  const reset = new PasswordResetService({ authService: auth, store, mailer, pepper: SECRET, now: () => clock.t, ...opts.service });
  const codeOf = (m) => (m.text.match(/code is (\d{6})/) || [])[1];
  return { auth, reset, store, sent, clock, codeOf };
}

test('the full flow: request a code, reset with it, sign in with the new password only', async () => {
  const { auth, reset, sent, codeOf } = await setup();
  const before = (await auth.login({ email: 'viewer@example.com', password: OLD })).token;
  assert.equal(await reset.requestCode({ email: 'Viewer@Example.com' }), GENERIC_SENT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'viewer@example.com');
  const otp = codeOf(sent[0]);
  assert.match(otp, /^\d{6}$/);

  await new Promise((r) => setTimeout(r, 1100)); // tokens carry whole seconds
  await reset.resetPassword({ email: 'viewer@example.com', otp, password: NEW });
  await assert.rejects(auth.login({ email: 'viewer@example.com', password: OLD }), /Invalid e-mail or password/);
  assert.ok((await auth.login({ email: 'viewer@example.com', password: NEW })).token);
  await assert.rejects(auth.verifyToken(before), /password was changed/, 'sessions from before the reset end');
  await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp, password: 'Another123456' }), (e) => e.message === BAD_CODE, 'a code works once');
});

test('unknown, disabled and Administrator addresses get the same answer and no e-mail', async () => {
  const { auth, reset, sent } = await setup();
  const answers = [
    await reset.requestCode({ email: 'nobody@example.com' }),
    await reset.requestCode({ email: 'admin@example.com' }),
  ];
  const user = await auth.findByEmail('viewer@example.com');
  await auth.updateUser(user.id, { active: false }, 'x');
  answers.push(await reset.requestCode({ email: 'viewer@example.com' }));
  assert.ok(answers.every((a) => a === GENERIC_SENT));
  assert.equal(sent.length, 0);
});

test('a code is stored only as a hash and is never in a response', async () => {
  const { reset, store, sent, codeOf } = await setup();
  const answer = await reset.requestCode({ email: 'viewer@example.com' });
  const otp = codeOf(sent[0]);
  assert.ok(!answer.includes(otp));
  assert.ok(!JSON.stringify(store.dump()).includes(otp), 'only a keyed hash is kept');
});

test('five wrong tries lock the code, even for the right one afterwards', async () => {
  const { reset, sent, codeOf } = await setup();
  await reset.requestCode({ email: 'viewer@example.com' });
  const otp = codeOf(sent[0]);
  const wrong = otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp: wrong, password: NEW, ip: `ip${i}` }), (e) => e.status === 400 && e.message === BAD_CODE);
  }
  await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp, password: NEW, ip: 'ip-new' }), (e) => e.message === BAD_CODE);
});

test('a code expires after ten minutes', async () => {
  const { reset, sent, codeOf, clock } = await setup();
  await reset.requestCode({ email: 'viewer@example.com' });
  clock.t += 10 * 60 * 1000 + 1;
  await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp: codeOf(sent[0]), password: NEW }), (e) => e.message === BAD_CODE);
});

test('one request a minute: a quick second request sends nothing, a later one replaces the old code', async () => {
  const { reset, sent, codeOf, clock } = await setup();
  await reset.requestCode({ email: 'viewer@example.com' });
  await reset.requestCode({ email: 'viewer@example.com' });
  assert.equal(sent.length, 1);
  clock.t += 61 * 1000;
  await reset.requestCode({ email: 'viewer@example.com' });
  assert.equal(sent.length, 2);
  const [first, second] = [codeOf(sent[0]), codeOf(sent[1])];
  if (first !== second) {
    await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp: first, password: NEW }), (e) => e.message === BAD_CODE, 'the old code no longer works');
  }
  await reset.resetPassword({ email: 'viewer@example.com', otp: second, password: NEW });
});

test('at most five e-mails an hour per address', async () => {
  const { reset, sent, clock } = await setup();
  for (let i = 0; i < 8; i += 1) { await reset.requestCode({ email: 'viewer@example.com', ip: `ip${i}` }); clock.t += 61 * 1000; }
  assert.equal(sent.length, 5);
});

test('input is validated, and a weak new password is refused', async () => {
  const { reset, sent, codeOf } = await setup();
  await assert.rejects(reset.requestCode({ email: 'not-an-email' }), (e) => e.status === 400);
  await reset.requestCode({ email: 'viewer@example.com' });
  const otp = codeOf(sent[0]);
  await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp, password: 'short' }), (e) => e.status === 400 && /at least 8/.test(e.message));
  await assert.rejects(reset.resetPassword({ email: 'viewer@example.com', otp: '12ab56', password: NEW }), (e) => e.message === BAD_CODE);
  await reset.resetPassword({ email: 'viewer@example.com', otp, password: NEW }); // the failed tries above did not use the code up
});

test('if the e-mail cannot be sent there is no usable code', async () => {
  const { reset, store } = await setup({ mailFails: true });
  const original = console.error;
  console.error = () => {};
  try { assert.equal(await reset.requestCode({ email: 'viewer@example.com' }), GENERIC_SENT); } finally { console.error = original; }
  assert.equal(store.dump().length, 0);
});

test('one address cannot flood the request endpoint', async () => {
  const { reset } = await setup();
  for (let i = 0; i < 10; i += 1) await reset.requestCode({ email: `n${i}@example.com`, ip: '9.9.9.9' });
  await assert.rejects(reset.requestCode({ email: 'n11@example.com', ip: '9.9.9.9' }), (e) => e.status === 429);
});

test('mailer: nothing configured means off; console is refused in production', () => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ MAIL_TRANSPORT: 'console', NODE_ENV: 'production' }), null);
  assert.equal(createMailer({ MAIL_TRANSPORT: 'console' }).kind, 'console');
  assert.equal(createMailer({ SMTP_HOST: 'smtp.example.com' }), null, 'a sender address is required');
  assert.equal(createMailer({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'me@example.com', SMTP_PASS: 'x' }).kind, 'smtp');
});

test('HTTP: 503 until e-mail is set up, then the same generic answer for every address', async () => {
  const { auth, reset } = await setup();
  const serve = async (resetService) => {
    const app = express();
    app.use(express.json());
    app.use(createAuthRouter(() => auth, createAuthMiddleware(() => auth), { getResetService: () => resetService }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, body) => {
      const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { call, close: () => new Promise((r) => server.close(r)) };
  };
  const off = await serve(null);
  assert.equal((await off.call('/api/auth/config')).body.passwordResetEnabled, false);
  assert.equal((await off.call('/api/auth/forgot-password', { email: 'viewer@example.com' })).status, 503);
  assert.equal((await off.call('/api/auth/reset-password', { email: 'viewer@example.com', otp: '123456', password: NEW })).status, 503);
  await off.close();

  const on = await serve(reset);
  assert.equal((await on.call('/api/auth/config')).body.passwordResetEnabled, true);
  const real = await on.call('/api/auth/forgot-password', { email: 'viewer@example.com' });
  const fake = await on.call('/api/auth/forgot-password', { email: 'ghost@example.com' });
  assert.deepEqual(real, fake, 'a known and an unknown address cannot be told apart');
  const bad = await on.call('/api/auth/reset-password', { email: 'viewer@example.com', otp: '000000', password: NEW });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, BAD_CODE);
  await on.close();
});
