'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { RoleFactory, ROLE_NAMES, ASSIGNABLE_ROLES } = require('./roles');

/** An error that carries the HTTP status the API should answer with. */
class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Sliding-window limiter for failed logins, keyed by IP + e-mail. */
class LoginThrottle {
  #max;
  #windowMs;
  #hits = new Map();

  constructor({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  #recent(key, now) {
    const list = (this.#hits.get(key) || []).filter((t) => now - t < this.#windowMs);
    this.#hits.set(key, list);
    return list;
  }

  isBlocked(key, now = Date.now()) { return this.#recent(key, now).length >= this.#max; }
  recordFailure(key, now = Date.now()) { this.#recent(key, now).push(now); }
  reset(key) { this.#hits.delete(key); }
}

const ADMIN_ONLY_MESSAGE = 'Administrator accounts can only be added through the server configuration (ADMIN_ACCOUNTS)';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

class AuthService {
  #repo;
  #secret;
  #expiresIn;
  #throttle;
  #registerThrottle;
  #rounds;

  /**
   * @param {object} opts
   * @param {object} opts.repository user repository (see userRepository.js)
   * @param {string} opts.jwtSecret  signing secret, from the JWT_SECRET environment variable
   * @param {string|number} [opts.expiresIn='8h'] token lifetime
   */
  constructor({ repository, jwtSecret, expiresIn = '8h', throttle = new LoginThrottle(), registerThrottle = new LoginThrottle({ max: 5, windowMs: 60 * 60 * 1000 }), bcryptRounds = 10 }) {
    if (!jwtSecret || String(jwtSecret).length < 16) throw new Error('JWT secret must be at least 16 characters');
    this.#repo = repository;
    this.#secret = jwtSecret;
    this.#expiresIn = expiresIn;
    this.#throttle = throttle;
    this.#registerThrottle = registerThrottle;
    this.#rounds = bcryptRounds;
  }

  static validate({ email, password, role, name }, { requirePassword = true } = {}) {
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) throw new AuthError(400, 'A valid e-mail address is required');
    if (requirePassword && (typeof password !== 'string' || password.length < MIN_PASSWORD)) {
      throw new AuthError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (role !== undefined && !RoleFactory.isValid(role)) throw new AuthError(400, `Role must be one of: ${ROLE_NAMES.join(', ')}`);
    if (name !== undefined && typeof name !== 'string') throw new AuthError(400, 'Name must be text');
  }

  async #create({ email, name = '', password, role }) {
    AuthService.validate({ email, password, role, name });
    if (await this.#repo.findByEmail(email)) throw new AuthError(409, 'A user with this e-mail already exists');
    const passwordHash = await bcrypt.hash(password, this.#rounds);
    return this.#repo.create({ email, name: name.trim(), role, passwordHash });
  }

  /** Creates a user with a role chosen by an Administrator. Administrator accounts cannot be created here. */
  async createUser(data) {
    if (data && data.role === 'Administrator') throw new AuthError(400, ADMIN_ONLY_MESSAGE);
    if (!data || !ASSIGNABLE_ROLES.includes(data.role)) throw new AuthError(400, `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    return this.#create(data);
  }

  /**
   * Public sign-up. The new account always gets the read-only Viewer role; an Administrator can raise it later.
   * Limited per client address so the form cannot be used to flood the user store.
   */
  async register({ email, password, name = '', ip = 'unknown' }) {
    if (this.#registerThrottle.isBlocked(ip)) throw new AuthError(429, 'Too many sign-ups from this address. Try again later.');
    AuthService.validate({ email, password, name });
    this.#registerThrottle.recordFailure(ip);
    const user = await this.#create({ email, password, name, role: 'Viewer' });
    return { token: this.issueToken(user), user: user.toPublic() };
  }

  /**
   * Makes sure an Administrator account exists for a configured address (ADMIN_ACCOUNTS / ADMIN_EMAIL on the server).
   * The configuration is the source of truth: the account is created, re-activated, given the Administrator role
   * and its password is set to the configured one. Returns 'created', 'updated' or 'unchanged'.
   */
  async ensureAdministrator({ email, password, name = 'Administrator' }) {
    AuthService.validate({ email, password, name });
    const existing = await this.#repo.findByEmail(email);
    if (!existing) { await this.#create({ email, password, name, role: 'Administrator' }); return 'created'; }
    const changes = {};
    if (existing.roleName !== 'Administrator') changes.role = 'Administrator';
    if (!existing.active) changes.active = true;
    if (!(await bcrypt.compare(password, existing.passwordHash))) { changes.passwordHash = await bcrypt.hash(password, this.#rounds); changes.passwordChangedAt = new Date(); }
    if (Object.keys(changes).length === 0) return 'unchanged';
    await this.#repo.update(existing.id, changes);
    return 'updated';
  }

  /** Looks a user up by e-mail (used by the password reset flow). */
  findByEmail(email) { return this.#repo.findByEmail(email); }

  /** Sets a new password, and ends every session that was issued before now. */
  async setPassword(id, password) {
    AuthService.validate({ email: 'x@y.zz', password });
    const passwordHash = await bcrypt.hash(password, this.#rounds);
    return this.#repo.update(id, { passwordHash, passwordChangedAt: new Date() });
  }

  countAdministrators() { return this.#repo.list().then((us) => us.filter((u) => u.roleName === 'Administrator' && u.active).length); }

  async login({ email, password, ip = 'unknown' }) {
    const key = `${ip}|${String(email || '').trim().toLowerCase()}`;
    if (this.#throttle.isBlocked(key)) throw new AuthError(429, 'Too many failed login attempts. Try again later.');
    AuthService.validate({ email, password: password || 'x'.repeat(MIN_PASSWORD) }, { requirePassword: false });
    const user = await this.#repo.findByEmail(email);
    // Compare against a dummy hash when the user is unknown so timing does not reveal valid e-mails.
    const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
    const ok = typeof password === 'string' && (await bcrypt.compare(password, hash)) && user;
    if (!ok || !user.active) {
      this.#throttle.recordFailure(key);
      throw new AuthError(401, 'Invalid e-mail or password');
    }
    this.#throttle.reset(key);
    return { token: this.issueToken(user), user: user.toPublic() };
  }

  issueToken(user) {
    return jwt.sign({ sub: user.id, role: user.roleName }, this.#secret, { algorithm: 'HS256', expiresIn: this.#expiresIn });
  }

  /** Verifies a bearer token and returns the current (active) user. */
  async verifyToken(token) {
    let payload;
    try {
      payload = jwt.verify(token, this.#secret, { algorithms: ['HS256'] });
    } catch (e) {
      throw new AuthError(401, e.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid authentication token');
    }
    const user = await this.#repo.findById(payload.sub);
    if (!user || !user.active) throw new AuthError(401, 'Account is not available');
    // a password change ends older sessions (compared in whole seconds, the resolution of a token's issue time)
    if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) throw new AuthError(401, 'Your password was changed. Please log in again.');
    return user; // role is read from the store, so a role change takes effect immediately
  }

  listUsers() { return this.#repo.list(); }

  async updateUser(id, { role, active, name, password }, actingUserId) {
    if (role === 'Administrator') throw new AuthError(400, ADMIN_ONLY_MESSAGE);
    AuthService.validate({ email: 'x@y.zz', role, name, password: password ?? 'x'.repeat(MIN_PASSWORD) }, { requirePassword: password !== undefined });
    const target = await this.#repo.findById(id);
    if (!target) throw new AuthError(404, 'User not found');
    const changes = {};
    if (role !== undefined) changes.role = role;
    if (name !== undefined) changes.name = name.trim();
    if (active !== undefined) changes.active = Boolean(active);
    if (password !== undefined) { changes.passwordHash = await bcrypt.hash(password, this.#rounds); changes.passwordChangedAt = new Date(); }
    const demotes = (changes.role && changes.role !== 'Administrator') || changes.active === false;
    if (demotes && target.roleName === 'Administrator') {
      const admins = (await this.#repo.list()).filter((u) => u.roleName === 'Administrator' && u.active);
      if (admins.length <= 1) throw new AuthError(400, 'The last active Administrator cannot be demoted or disabled');
      if (String(actingUserId) === String(target.id)) throw new AuthError(400, 'You cannot demote or disable your own account');
    }
    return this.#repo.update(id, changes);
  }
}

module.exports = { AuthService, AuthError, LoginThrottle };
