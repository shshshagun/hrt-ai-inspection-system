import { API_BASE } from '../config/api';
import { authFetch } from '../auth/authFetch';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the gateway. On the free hosting plan the server needs a few seconds to wake up and connect to its
 * database, and answers 503 in the meantime, so a 503 is retried once after a short pause.
 */
async function call(path, body, retried = false) {
  let res;
  try {
    res = await authFetch(`${API_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Could not reach the server. It may be waking up (free hosting); try again in a few seconds.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && !retried && !/assistant is not configured/i.test(data.error || '')) {
    await wait(5000);
    return call(path, body, true);
  }
  if (!res.ok) {
    const starting = res.status === 503 && /authentication is not configured|database/i.test(data.error || '');
    throw Object.assign(new Error(starting ? 'The server is still starting up. Please try again in a few seconds.' : (data.error || `Request failed (${res.status})`)), { status: res.status });
  }
  return data;
}

/** { enabled } : whether the server has an AI key configured. */
export const assistantStatus = () => call('/api/assistant/status');

/** messages: [{ role: 'user' | 'assistant', text }]. Returns { answer, sources, truncated }. */
export const askAssistant = (messages) => call('/api/assistant/chat', { messages });

/** Natural-language search. Returns { interpreted: string[], count, results }. */
export const aiSearch = (query) => call('/api/assistant/search', { query });
