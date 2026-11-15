'use strict';

const { User } = require('./user');

/**
 * Storage strategy for users. AuthService only depends on this interface:
 *   count(), findByEmail(email), findById(id), list(), create(data), update(id, fields)
 * so the same service runs on MongoDB in production and in memory in tests.
 */
class InMemoryUserRepository {
  #rows = new Map();
  #seq = 0;

  async count() { return this.#rows.size; }

  async findByEmail(email) {
    const e = String(email).trim().toLowerCase();
    for (const r of this.#rows.values()) if (r.email === e) return new User(r);
    return null;
  }

  async findById(id) {
    const r = this.#rows.get(String(id));
    return r ? new User(r) : null;
  }

  async list() { return [...this.#rows.values()].map((r) => new User(r)); }

  async create({ email, name, role, passwordHash }) {
    const id = String(++this.#seq);
    const row = { id, email: String(email).trim().toLowerCase(), name, role, passwordHash, active: true, createdAt: new Date() };
    this.#rows.set(id, row);
    return new User(row);
  }

  async update(id, fields) {
    const r = this.#rows.get(String(id));
    if (!r) return null;
    Object.assign(r, fields);
    return new User(r);
  }
}

class MongoUserRepository {
  #col;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#col = db.collection('users');
  }

  async init() {
    await this.#col.createIndex({ email: 1 }, { unique: true });
  }

  static #toUser(doc) {
    if (!doc) return null;
    return new User({
      id: doc._id, email: doc.email, name: doc.name, role: doc.role,
      passwordHash: doc.passwordHash, active: doc.active, createdAt: doc.createdAt,
    });
  }

  async count() { return this.#col.countDocuments(); }
  async findByEmail(email) { return MongoUserRepository.#toUser(await this.#col.findOne({ email: String(email).trim().toLowerCase() })); }

  async findById(id) {
    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(id)) return null;
    return MongoUserRepository.#toUser(await this.#col.findOne({ _id: new ObjectId(id) }));
  }

  async list() { return (await this.#col.find({}).sort({ createdAt: 1 }).toArray()).map(MongoUserRepository.#toUser); }

  async create({ email, name, role, passwordHash }) {
    const doc = { email: String(email).trim().toLowerCase(), name, role, passwordHash, active: true, createdAt: new Date() };
    const res = await this.#col.insertOne(doc);
    return MongoUserRepository.#toUser({ ...doc, _id: res.insertedId });
  }

  async update(id, fields) {
    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(id)) return null;
    const res = await this.#col.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: fields }, { returnDocument: 'after' });
    return MongoUserRepository.#toUser(res);
  }
}

module.exports = { InMemoryUserRepository, MongoUserRepository };
