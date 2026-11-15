/**
 * Session token storage. sessionStorage is used on purpose: the token disappears when the
 * browser tab is closed. Every access is wrapped because storage can be blocked by the browser.
 */
const KEY = 'hrt_auth_token';
export const AUTH_EXPIRED_EVENT = 'hrt-auth-expired';

export function getToken() {
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

export function setToken(token) {
  try { window.sessionStorage.setItem(KEY, token); } catch { /* storage blocked */ }
}

export function clearToken() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
