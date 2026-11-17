'use strict';
/**
 * Minimal Gemini generateContent client (plain REST, Node's built-in fetch). The API key goes in the
 * x-goog-api-key header, never in the URL, and is never logged.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;           // quota | auth | notfound | blocked | timeout | bad | network
    this.status = status;
    this.publicMessage = message;
  }
}

function classify(status, body) {
  const code = body?.error?.status;
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new GeminiError('quota', 'The AI service is at its free-plan limit right now. Please try again in a minute.', 429);
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') return new GeminiError('auth', 'The AI service rejected the server\'s API key. An administrator needs to check it.', 502);
  if (status === 404 || code === 'NOT_FOUND') return new GeminiError('notfound', 'The configured AI model was not found.', 502);
  if (status === 400) return new GeminiError('bad', 'The AI service could not process that request.', 502);
  return new GeminiError('network', 'The AI service is unavailable right now.', 502);
}

/**
 * Creates a `generate(body)` function. Tries the configured model first, and on "model not found" falls back through
 * `fallbacks` once, remembering whichever model worked.
 */
/** Picks the newest plain Flash / Flash-Lite model that supports generateContent, preferring Flash-Lite on a tie. */
function pickModel(list) {
  const scored = (list || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => {
      const name = String(m.name || '').replace(/^models\//, '');
      const hit = name.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/);
      return hit ? { name, version: parseFloat(hit[1]), lite: Boolean(hit[2]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.version - a.version || Number(b.lite) - Number(a.lite));
  return scored[0]?.name || null;
}

function createGemini({ apiKey, model, fallbacks = [], fetchImpl = fetch, timeoutMs = 25000 }) {
  let active = model;
  let discovered = false;
  const candidates = () => [active, ...[model, ...fallbacks].filter((m) => m !== active)].filter((m, i, a) => a.indexOf(m) === i);

  async function discover() {
    discovered = true; // ask Google at most once per server start
    try {
      const res = await fetchImpl(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) return null;
      return pickModel((await res.json().catch(() => ({}))).models);
    } catch { return null; }
  }

  async function once(m, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw classify(res.status, json);
      return json;
    } catch (err) {
      if (err instanceof GeminiError) throw err;
      if (err?.name === 'AbortError') throw new GeminiError('timeout', 'The AI service took too long to answer.', 504);
      throw new GeminiError('network', 'The AI service is unavailable right now.', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function generate(body) {
    let last;
    const tried = [];
    for (const m of candidates()) {
      tried.push(m);
      try {
        const json = await once(m, body);
        active = m;
        return json;
      } catch (err) {
        last = err;
        if (err.kind !== 'notfound') throw err;
      }
    }
    // None of the configured names exist for this key: ask Google which models it can use, once.
    if (!discovered) {
      const found = await discover();
      if (found && !tried.includes(found)) {
        const json = await once(found, body);
        active = found;
        console.warn(`Gemini model "${model}" was not found; using "${found}". Set GEMINI_MODEL=${found} to silence this.`);
        return json;
      }
    }
    last.publicMessage = `The configured AI model was not found (tried: ${tried.join(', ')}). An administrator should set GEMINI_MODEL to a model listed in Google AI Studio.`;
    throw last;
  };
}

module.exports = { createGemini, GeminiError, pickModel };
