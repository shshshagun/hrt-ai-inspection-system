'use strict';

const { RoleFactory } = require('./roles');

/** A user account. State is private; use toPublic() for anything sent to clients. */
class User {
  #id;
  #email;
  #name;
  #roleName;
  #passwordHash;
  #active;
  #createdAt;

  constructor({ id, email, name, role, passwordHash, active = true, createdAt = new Date() }) {
    this.#id = String(id);
    this.#email = String(email).trim().toLowerCase();
    this.#name = String(name || '').trim();
    this.#roleName = RoleFactory.create(role).name; // throws on an unknown role
    this.#passwordHash = passwordHash;
    this.#active = Boolean(active);
    this.#createdAt = createdAt;
  }

  get id() { return this.#id; }
  get email() { return this.#email; }
  get name() { return this.#name; }
  get roleName() { return this.#roleName; }
  get role() { return RoleFactory.create(this.#roleName); }
  get active() { return this.#active; }
  get passwordHash() { return this.#passwordHash; }

  can(permission) { return this.#active && this.role.can(permission); }

  /** Fields that are safe to return in an API response (never the password hash). */
  toPublic() {
    return {
      id: this.#id,
      email: this.#email,
      name: this.#name,
      role: this.#roleName,
      permissions: this.role.permissions,
      active: this.#active,
      createdAt: this.#createdAt,
    };
  }
}

module.exports = { User };
