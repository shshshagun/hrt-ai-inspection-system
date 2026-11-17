'use strict';
const express = require('express');
const { PERMISSIONS } = require('../auth/roles');
const { createProviders } = require('./providers');
const { runAgent, runSearch, toolExecutor, AssistantError } = require('./service');

const MAX_MESSAGES = 12;
const MAX_TEXT = 1000;

/** Fixed-window limiter: `limit` hits per minute per key. */
function windowLimiter(limit) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now > rec.reset) { hits.set(key, { n: 1, reset: now + 60000 }); return true; }
    rec.n += 1;
    return rec.n <= limit;
  };
}

/**
 * /api/assistant/*: status, chat and natural-language search. Disabled (503) until GEMINI_API_KEY or GROQ_API_KEY is set; when both are, the second is a backup.
 * The key lives only in the server environment.
 */
function createAssistantRouter({ auth, getDb, env = process.env, fetchImpl }) {
  const router = express.Router();
  const providers = createProviders(env, fetchImpl);
  const enabled = providers.enabled;
  const generate = providers.generate;

  const perUser = windowLimiter(Number(env.ASSISTANT_RPM_USER) || 8);
  const global = windowLimiter(Number(env.ASSISTANT_RPM_GLOBAL) || 12);
  const busy = new Set();
  const guard = auth.guard(PERMISSIONS.DETECTIONS_READ);

  function fail(res, err) {
    const status = err.status || (err.name === 'FilterError' ? 422 : 500);
    if (status >= 500 && !err.publicMessage) console.error('assistant error:', err.message);
    res.status(status).json({ error: err.publicMessage || 'The assistant ran into a problem.' });
  }

  async function limited(req, res, work) {
    if (!enabled) return res.status(503).json({ error: 'The assistant is not configured on this server.' });
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'The database is not available right now.' });
    const who = req.user?.id || req.user?.email || req.ip;
    if (!perUser(`u:${who}`) || !global('all')) return res.status(429).json({ error: 'The assistant is getting a lot of questions. Please wait a minute and try again.' });
    if (busy.has(who)) return res.status(429).json({ error: 'Please wait for the previous answer first.' });
    busy.add(who);
    try { return await work(db); } catch (err) { return fail(res, err); } finally { busy.delete(who); }
  }

  router.get('/api/assistant/status', ...guard, (req, res) => {
    res.json({ enabled, providers: providers.names });
  });

  router.post('/api/assistant/chat', ...guard, (req, res) => limited(req, res, async (db) => {
    const raw = req.body?.messages;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_MESSAGES) throw new AssistantError(`Send between 1 and ${MAX_MESSAGES} messages.`, 400);
    // Only plain {role, text} turns are accepted from the browser: never function calls or tool results.
    const history = raw.map((m) => {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string' || !m.text.trim() || m.text.length > MAX_TEXT) {
        throw new AssistantError(`Each message needs a role (user or assistant) and text up to ${MAX_TEXT} characters.`, 400);
      }
      return { role: m.role, text: m.text.trim() };
    });
    if (history[history.length - 1].role !== 'user') throw new AssistantError('The last message must be from the user.', 400);
    const out = await runAgent({ history, generate, execute: toolExecutor(db) });
    res.json(out);
  }));

  router.post('/api/assistant/search', ...guard, (req, res) => limited(req, res, async (db) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (query.length < 2 || query.length > 200) throw new AssistantError('Type a search of 2 to 200 characters.', 400);
    res.json(await runSearch({ query, generate, db }));
  }));

  return router;
}

module.exports = { createAssistantRouter };
