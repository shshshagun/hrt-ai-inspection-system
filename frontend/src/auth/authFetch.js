import { getToken, clearToken, AUTH_EXPIRED_EVENT } from './tokenStore';

/**
 * fetch() that adds the Bearer token. When the server answers 401 (missing, invalid or expired token)
 * the stored token is cleared and an event tells AuthProvider to send the user to the login page.
 */
export async function authFetch(url, options = {}) {
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
