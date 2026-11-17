import { API_BASE } from '../config/api';
import { authFetch } from '../auth/authFetch';

async function call(path, body) {
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
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

/** { enabled } : whether the server has an AI key configured. */
export const assistantStatus = () => call('/api/assistant/status');

/** messages: [{ role: 'user' | 'assistant', text }]. Returns { answer, sources, truncated }. */
export const askAssistant = (messages) => call('/api/assistant/chat', { messages });

/** Natural-language search. Returns { interpreted: string[], count, results }. */
export const aiSearch = (query) => call('/api/assistant/search', { query });
