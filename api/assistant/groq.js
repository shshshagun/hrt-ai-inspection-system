'use strict';
/**
 * Groq adapter (OpenAI-compatible chat completions). The assistant speaks one internal format, the Gemini request and response
 * shape, so this module translates to and from Groq's. That keeps the tool loop in service.js provider-neutral.
 * The key goes in the Authorization header only and is never logged.
 */
const { GeminiError } = require('./gemini');

const URL = 'https://api.groq.com/openai/v1/chat/completions';
// Production models Groq's docs list for tool use that are not marked Enterprise / contact-sales (checked 2026-11-17).
const GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

function detail(body) {
  const msg = body?.error?.message;
  return typeof msg === 'string' && msg ? `: ${msg.replace(/\s+/g, ' ').slice(0, 160)}` : '';
}

function classify(status, body) {
  if (status === 429) return new GeminiError('quota', 'The backup AI service is at its free-plan limit right now. Please try again in a minute.', 429);
  if (status === 401 || status === 403) return new GeminiError('auth', `The backup AI service rejected the server's API key (HTTP ${status}${detail(body)}).`, 502);
  if (status === 404) return new GeminiError('notfound', `The backup AI model was not found (HTTP 404${detail(body)}).`, 502);
  if (status === 400) return new GeminiError('bad', `The backup AI service could not process that request (HTTP 400${detail(body)}).`, 502);
  if (status >= 500) return new GeminiError('server', `The backup AI service had a problem (HTTP ${status}${detail(body)}).`, 502);
  return new GeminiError('network', `The backup AI service answered unexpectedly (HTTP ${status}${detail(body)}).`, 502);
}

/** Internal (Gemini-shaped) request -> OpenAI chat messages. */
function toMessages(body) {
  const messages = [];
  const system = (body.systemInstruction?.parts || []).map((p) => p.text).filter(Boolean).join('\n');
  if (system) messages.push({ role: 'system', content: system });

  let pending = []; // tool calls the last assistant message made and the next tool results must answer
  (body.contents || []).forEach((turn, i) => {
    const parts = turn.parts || [];
    if (turn.role === 'model') {
      const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
      const calls = parts.filter((p) => p.functionCall).map((p, j) => ({
        id: p.functionCall.id || `call_${i}_${j}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
      }));
      pending = calls.map((c) => ({ id: c.id, name: c.function.name }));
      messages.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) });
      return;
    }
    const results = parts.filter((p) => p.functionResponse);
    if (results.length) {
      for (const p of results) {
        const fr = p.functionResponse;
        const at = fr.id ? pending.findIndex((c) => c.id === fr.id) : pending.findIndex((c) => c.name === fr.name);
        const matched = at >= 0 ? pending.splice(at, 1)[0] : null;
        messages.push({ role: 'tool', tool_call_id: fr.id || matched?.id || `call_${i}`, name: fr.name, content: JSON.stringify(fr.response?.result ?? fr.response ?? {}) });
      }
      return;
    }
    messages.push({ role: 'user', content: parts.map((p) => p.text).filter(Boolean).join('\n') });
  });
  return messages;
}

function toRequest(model, body) {
  const decls = (body.tools || []).flatMap((t) => t.functionDeclarations || []);
  const req = { model, messages: toMessages(body) };
  if (decls.length) {
    req.tools = decls.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters || { type: 'object', properties: {} } } }));
    const cfg = body.toolConfig?.functionCallingConfig;
    if (cfg?.mode === 'ANY' && cfg.allowedFunctionNames?.length === 1) req.tool_choice = { type: 'function', function: { name: cfg.allowedFunctionNames[0] } };
  }
  const max = body.generationConfig?.maxOutputTokens;
  if (max) req.max_completion_tokens = max;
  return req;
}

/** OpenAI response -> internal (Gemini-shaped) response. */
function fromResponse(json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message;
  if (!msg) return { candidates: [] };
  const parts = [];
  if (typeof msg.content === 'string' && msg.content) parts.push({ text: msg.content });
  (msg.tool_calls || []).forEach((tc, j) => {
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
    parts.push({ functionCall: { id: tc.id || `call_${j}`, name: tc.function?.name, args: args && typeof args === 'object' ? args : {} } });
  });
  return { candidates: [{ content: { role: 'model', parts }, finishReason: choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP' }] };
}

function createGroq({ apiKey, model, fetchImpl = fetch, timeoutMs = 45000 }) {
  return async function generate(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(toRequest(model, body)),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`Groq ${model} answered HTTP ${res.status}:`, String(json?.error?.message || '').slice(0, 200));
        throw classify(res.status, json);
      }
      return fromResponse(json);
    } catch (err) {
      if (err instanceof GeminiError) throw err;
      if (err?.name === 'AbortError') throw new GeminiError('timeout', 'The backup AI service took too long to answer.', 504);
      const why = [err?.message, err?.cause?.code || err?.cause?.message].filter(Boolean).join(' / ').slice(0, 120);
      console.error('Groq request failed:', why);
      throw new GeminiError('network', `The server could not reach the backup AI service (${why || 'network error'}).`, 502);
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createGroq, GROQ_MODELS, toMessages, toRequest, fromResponse };
