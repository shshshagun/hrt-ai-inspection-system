import { getToken, clearToken, AUTH_EXPIRED_EVENT } from './tokenStore';
import { isDemo } from '../demo/demoMode';
import { DEMO_DETECTIONS, DEMO_INSPECTIONS } from '../demo/sampleData';
import { matchesView } from '../utils/crackVerdict';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers API calls from the bundled sample data while the read-only demo is running. */
function demoResponse(url, options) {
  const method = (options.method || 'GET').toUpperCase();
  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname;
  if (method !== 'GET') return json({ error: 'The demo is read-only. Sign in to change data.' }, 403);
  if (path === '/health') return new Response('OK');
  if (path === '/api/detections') return json(DEMO_DETECTIONS.filter((d) => matchesView(d, parsed.searchParams.get('view') || 'all')));
  if (path.startsWith('/api/detections/')) {
    const id = decodeURIComponent(path.split('/').pop());
    const hit = DEMO_DETECTIONS.find((d) => d._id === id);
    return hit ? json(hit) : json({ error: 'Detection not found' }, 404);
  }
  if (path === '/api/inspections') return json(DEMO_INSPECTIONS);
  if (path === '/api/spatial-summary') return json({ bins: [] });
  return json({ error: 'Not available in the demo' }, 404);
}

/**
 * fetch() that adds the Bearer token. When the server answers 401 (missing, invalid or expired token)
 * the stored token is cleared and an event tells AuthProvider to send the user to the login page.
 * In demo mode nothing leaves the browser: the sample data answers instead.
 */
export async function authFetch(url, options = {}) {
  if (isDemo()) return demoResponse(url, options);
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}
