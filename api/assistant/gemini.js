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

/** A short, safe reason from Google (its own error text never contains our key) so failures can be diagnosed. */
function detail(body) {
  const msg = body?.error?.message;
  return typeof msg === 'string' && msg ? `: ${msg.replace(/\s+/g, ' ').slice(0, 160)}` : '';
}

function classify(status, body) {
  const code = body?.error?.status;
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new GeminiError('quota', 'The AI service is at its free-plan limit right now. Please try again in a minute.', 429);
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') return new GeminiError('auth', `The AI service rejected the server's API key (HTTP ${status}${detail(body)}). An administrator needs to check it.`, 502);
  if (status === 404 || code === 'NOT_FOUND') return new GeminiError('notfound', 'The configured AI model was not found.', 502);
  if (status === 400) return new GeminiError('bad', `The AI service could not process that request (HTTP 400${detail(body)}).`, 502);
  if (status >= 500) return new GeminiError('server', `The AI service had a problem (HTTP ${status}${detail(body)}). Please try again.`, 502);
  return new GeminiError('network', `The AI service answered unexpectedly (HTTP ${status}${detail(body)}).`, 502);
}

// Text models that Google's pricing page lists as free of charge on the Free tier (checked 2026-11-17). Anything else
// (Gemini 4 Carbon and Argon, the Pro models, retired models) is refused unless GEMINI_ALLOW_PAID=true, so a key can never
// be spent by accident.
const FREE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen'];
const isFree = (name) => FREE_MODELS.includes(String(name).replace(/^models\//, ''));

const SKIP = /image|tts|embed|live|audio|robot|veo|imagen|computer|vision|aqa|learnlm|gemma|native/i;

/** Names of the models that can generate text for this key, best choice first: Flash-Lite, then Flash, then anything else; newest first. */
function usableModels(list, { allowPaid = false } = {}) {
  const rows = (list || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((name) => /^gemini-/.test(name) && !SKIP.test(name) && (allowPaid || isFree(name)));
  const rank = (n) => (/-flash-lite/.test(n) ? 0 : /-flash/.test(n) ? 1 : 2);
  const version = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
  return rows.sort((a, b) => rank(a) - rank(b) || version(b) - version(a) || (/preview|exp/.test(a) ? 1 : 0) - (/preview|exp/.test(b) ? 1 : 0));
}

function createGemini({ apiKey, model, fallbacks = [], fetchImpl = fetch, timeoutMs = 25000, retryDelayMs = 1200, allowPaid = false }) {
  let active = model;
  let discovered = false;
  const candidates = () => [active, ...[model, ...fallbacks].filter((m) => m !== active)].filter((m, i, a) => a.indexOf(m) === i);

  let available = [];
  async function discover() {
    discovered = true; // ask Google at most once per server start
    try {
      const res = await fetchImpl(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) { console.error(`Gemini model list answered HTTP ${res.status}`); return null; }
      available = usableModels((await res.json().catch(() => ({}))).models, { allowPaid });
      console.warn(`Gemini models this key can use: ${available.slice(0, 15).join(', ') || 'none'}`);
      return available[0] || null;
    } catch (err) { console.error('Gemini model list failed:', err?.message); return null; }
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
      if (!res.ok) {
        console.error(`Gemini ${m} answered HTTP ${res.status}:`, json?.error?.status || '', String(json?.error?.message || '').slice(0, 200));
        throw classify(res.status, json);
      }
      return json;
    } catch (err) {
      if (err instanceof GeminiError) throw err;
      if (err?.name === 'AbortError') throw new GeminiError('timeout', 'The AI service took too long to answer.', 504);
      // fetch itself failed (DNS, TLS, a bad header value...): keep the technical reason for the server log and the message
      const why = [err?.message, err?.cause?.code || err?.cause?.message].filter(Boolean).join(' / ').slice(0, 120);
      console.error('Gemini request failed:', why);
      throw new GeminiError('network', `The server could not reach the AI service (${why || 'network error'}).`, 502);
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
        let json;
        try { json = await once(m, body); }
        catch (err) {
          if (err.kind !== 'server') throw err;
          await new Promise((r) => setTimeout(r, retryDelayMs)); // transient overload: one more try
          json = await once(m, body);
        }
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
    const usable = available.slice(0, 8);
    last.publicMessage = `The configured AI model was not found (tried: ${tried.join(', ')}). ${usable.length ? `Models this key can use: ${usable.join(', ')}. Set GEMINI_MODEL to one of them.` : 'Google did not list any usable model for this key, so check the key in Google AI Studio.'}`;
    throw last;
  };
}

module.exports = { createGemini, GeminiError, usableModels, FREE_MODELS, isFree };
