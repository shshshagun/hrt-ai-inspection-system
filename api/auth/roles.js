'use strict';

/**
 * roles.js
 * Role hierarchy for role-based access control (RBAC).
 *
 *   Role (abstract)
 *   ├── ReadOnlyRole            – may read detections and inspections
 *   │   ├── Operator            – + create detections
 *   │   ├── Engineer            – + review detections
 *   │   └── Manager             – + generate reports
 *   └── Administrator           – every permission, including deletes and user management
 *
 * RoleFactory maps the role name stored with a user to a Role instance.
 */

const PERMISSIONS = Object.freeze({
  DETECTIONS_READ: 'detections:read',
  DETECTIONS_CREATE: 'detections:create',
  DETECTIONS_REVIEW: 'detections:review',
  DETECTIONS_DELETE: 'detections:delete',
  INSPECTIONS_READ: 'inspections:read',
  INSPECTIONS_DELETE: 'inspections:delete',
  REPORTS_GENERATE: 'reports:generate',
  USERS_MANAGE: 'users:manage',
});

class Role {
  #permissions;

  constructor(name, permissions) {
    if (new.target === Role) throw new TypeError('Role is abstract');
    this.name = name;
    this.#permissions = new Set(permissions);
  }

  /** @param {string} permission one of PERMISSIONS */
  can(permission) {
    return this.#permissions.has(permission);
  }

  get permissions() {
    return [...this.#permissions].sort();
  }
}

class ReadOnlyRole extends Role {
  constructor(name, extra = []) {
    super(name, [PERMISSIONS.DETECTIONS_READ, PERMISSIONS.INSPECTIONS_READ, ...extra]);
  }
}

class Operator extends ReadOnlyRole {
  constructor() { super('Operator', [PERMISSIONS.DETECTIONS_CREATE]); }
}

class Engineer extends ReadOnlyRole {
  constructor() { super('Engineer', [PERMISSIONS.DETECTIONS_REVIEW]); }
}

class Manager extends ReadOnlyRole {
  constructor() { super('Manager', [PERMISSIONS.REPORTS_GENERATE]); }
}

class Administrator extends Role {
  constructor() { super('Administrator', Object.values(PERMISSIONS)); }
}

const ROLE_NAMES = Object.freeze(['Operator', 'Engineer', 'Manager', 'Administrator']);

class RoleFactory {
  static #classes = { Operator, Engineer, Manager, Administrator };
  static #cache = new Map();

  static isValid(name) {
    return Object.prototype.hasOwnProperty.call(RoleFactory.#classes, name);
  }

  /** @returns {Role} shared (immutable) instance for the role name */
  static create(name) {
    if (!RoleFactory.isValid(name)) throw new RangeError(`Unknown role: ${name}`);
    if (!RoleFactory.#cache.has(name)) RoleFactory.#cache.set(name, new RoleFactory.#classes[name]());
    return RoleFactory.#cache.get(name);
  }
}

module.exports = { PERMISSIONS, ROLE_NAMES, Role, ReadOnlyRole, Operator, Engineer, Manager, Administrator, RoleFactory };
