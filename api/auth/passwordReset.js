'use strict';
/**
 * Forgot password with a one-time code (OTP) sent by e-mail.
 *
 * Rules that matter for security:
 *  - the answer to "forgot password" is always the same, whether or not the e-mail belongs to an account (no account enumeration);
 *  - the 6-digit code comes from crypto.randomInt, is stored only as a keyed hash (HMAC with the server secret), is single use,
 *    expires after 10 minutes and locks after 5 wrong tries;
 *  - a new request replaces the previous code, and a code can be requested at most once a minute and 5 times an hour per address;
 *  - Administrator accounts are provisioned from the server configuration and cannot be reset by e-mail;
 *  - after a reset every session issued before it stops working (see AuthService.verifyToken).
 */
const crypto = require('node:crypto');
const { AuthError, AuthService } = require('./authService');

const OTP_RE = /^\d{6}$/;
const GENERIC_SENT = 'If an account exists for that e-mail, a 6-digit code has been sent. It expires in 10 minutes.';
const BAD_CODE = 'That code is invalid or has expired. Request a new one.';

class InMemoryResetStore {
  #rows = new Map();
  async get(userId) { return this.#rows.get(String(userId)) || null; }
  async put(row) { this.#rows.set(String(row.userId), { ...row, attempts: 0 }); }
  async bumpAttempts(userId) { const r = this.#rows.get(String(userId)); if (!r) return 0; r.attempts += 1; return r.attempts; }
  async remove(userId) { this.#rows.delete(String(userId)); }
  dump() { return [...this.#rows.values()].map((r) => ({ ...r })); }
}

class MongoResetStore {
  #col;
  constructor(db) { this.#col = db.collection('password_resets'); }
  async init() {
    await this.#col.createIndex({ userId: 1 }, { unique: true });
    await this.#col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB removes expired codes by itself
  }
  async get(userId) { return this.#col.findOne({ userId: String(userId) }); }
  async put(row) { await this.#col.replaceOne({ userId: String(row.userId) }, { ...row, userId: String(row.userId), attempts: 0 }, { upsert: true }); }
  async bumpAttempts(userId) {
    const r = await this.#col.findOneAndUpdate({ userId: String(userId) }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    return r ? r.attempts : 0;
  }
  async remove(userId) { await this.#col.deleteOne({ userId: String(userId) }); }
}

/** Counts events per key inside a time window. */
class WindowCounter {
  #max; #windowMs; #hits = new Map();
  constructor(max, windowMs) { this.#max = max; this.#windowMs = windowMs; }
  #recent(key, now) { const l = (this.#hits.get(key) || []).filter((t) => now - t < this.#windowMs); this.#hits.set(key, l); return l; }
  full(key, now) { return this.#recent(key, now).length >= this.#max; }
  add(key, now) { this.#recent(key, now).push(now); }
  clear(key) { this.#hits.delete(key); }
}

class PasswordResetService {
  #auth; #store; #mailer; #pepper; #now; #ttlMs; #maxAttempts; #cooldownMs;
  #sendPerHour = new WindowCounter(5, 60 * 60 * 1000);
  #requestPerIp = new WindowCounter(10, 60 * 60 * 1000);
  #failPerKey = new WindowCounter(10, 15 * 60 * 1000);

  /**
   * @param {object} o
   * @param {AuthService} o.authService
   * @param {object} o.store      InMemoryResetStore or MongoResetStore
   * @param {{send: Function}} o.mailer
   * @param {string} o.pepper     server secret used to key the code hash
   */
  constructor({ authService, store, mailer, pepper, now = () => Date.now(), ttlMs = 10 * 60 * 1000, maxAttempts = 5, cooldownMs = 60 * 1000 }) {
    if (!pepper || String(pepper).length < 16) throw new Error('A server secret of at least 16 characters is required');
    this.#auth = authService; this.#store = store; this.#mailer = mailer; this.#pepper = pepper;
    this.#now = now; this.#ttlMs = ttlMs; this.#maxAttempts = maxAttempts; this.#cooldownMs = cooldownMs;
  }

  #hash(userId, otp) { return crypto.createHmac('sha256', this.#pepper).update(`${userId}:${otp}`).digest('hex'); }

  /** Always resolves with the same message. Only a per-address flood limit can make it throw. */
  async requestCode({ email, ip = 'unknown' }) {
    const now = this.#now();
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new AuthError(400, 'A valid e-mail address is required');
    if (this.#requestPerIp.full(ip, now)) throw new AuthError(429, 'Too many requests. Try again later.');
    this.#requestPerIp.add(ip, now);

    const address = email.trim().toLowerCase();
    const user = await this.#auth.findByEmail(address);
    // unknown, disabled and Administrator accounts get the same answer and no e-mail
    if (!user || !user.active || user.roleName === 'Administrator') return GENERIC_SENT;

    const existing = await this.#store.get(user.id);
    if (existing && now - existing.createdAt < this.#cooldownMs) return GENERIC_SENT; // sent a moment ago
    if (this.#sendPerHour.full(address, now)) return GENERIC_SENT;
    this.#sendPerHour.add(address, now);

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await this.#store.put({ userId: user.id, hash: this.#hash(user.id, otp), createdAt: now, expiresAt: new Date(now + this.#ttlMs) });
    try {
      await this.#mailer.send({
        to: address,
        subject: 'Your HRT password reset code',
        text: `Your HRT password reset code is ${otp}.\n\nIt expires in ${Math.round(this.#ttlMs / 60000)} minutes and can be used once. If you did not ask to reset your password, ignore this message; your password has not changed.`,
      });
    } catch (err) {
      await this.#store.remove(user.id); // no usable code if the message never left
      console.error('Password reset e-mail could not be sent:', err.message); // never log the code
    }
    return GENERIC_SENT;
  }

  /** Checks the code and sets the new password. Every failure looks the same to the caller. */
  async resetPassword({ email, otp, password, ip = 'unknown' }) {
    const now = this.#now();
    AuthService.validate({ email, password });
    if (typeof otp !== 'string' || !OTP_RE.test(otp.trim())) throw new AuthError(400, BAD_CODE);
    const address = email.trim().toLowerCase();
    const key = `${ip}|${address}`;
    if (this.#failPerKey.full(key, now)) throw new AuthError(429, 'Too many attempts. Try again later.');

    const user = await this.#auth.findByEmail(address);
    const row = user && user.active && user.roleName !== 'Administrator' ? await this.#store.get(user.id) : null;
    // compare against a dummy value when there is no code, so the response time does not reveal accounts
    const expected = Buffer.from(row ? row.hash : '0'.repeat(64), 'hex');
    const given = Buffer.from(this.#hash(user ? user.id : 'none', otp.trim()), 'hex');
    const match = expected.length === given.length && crypto.timingSafeEqual(expected, given);
    const live = row && new Date(row.expiresAt).getTime() > now && (row.attempts || 0) < this.#maxAttempts;

    if (!live || !match) {
      this.#failPerKey.add(key, now);
      if (row) {
        const attempts = await this.#store.bumpAttempts(user.id);
        if (attempts >= this.#maxAttempts) await this.#store.remove(user.id); // locked: a new code is needed
      }
      throw new AuthError(400, BAD_CODE);
    }

    await this.#store.remove(user.id); // single use
    await this.#auth.setPassword(user.id, password);
    this.#failPerKey.clear(key);
    return 'Your password was changed. Sign in with the new password.';
  }
}

module.exports = { PasswordResetService, InMemoryResetStore, MongoResetStore, GENERIC_SENT, BAD_CODE };
