import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../config/api';
import { AUTH_EXPIRED_EVENT, clearToken, getToken, setToken } from './tokenStore';
import { DEV_USER } from './permissions';
import { AUTH_ENABLED, AuthContext } from './useAuth';

async function readError(res, fallback) {
  try { const b = await res.json(); return b?.error || fallback; } catch { return fallback; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(AUTH_ENABLED ? null : DEV_USER);
  const [loading, setLoading] = useState(AUTH_ENABLED && Boolean(getToken()));

  // The gateway runs on a free tier that sleeps when idle: ping it as soon as the app loads so it is awake by the time the user signs in.
  useEffect(() => { fetch(`${API_BASE}/health`).catch(() => {}); }, []);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!AUTH_ENABLED) return undefined;
    const token = getToken();
    if (!token) return undefined;
    let cancelled = false;
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error('session');
        const body = await res.json();
        if (!cancelled) setUser(body.user);
      })
      .catch(() => { clearToken(); if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // authFetch() raises this when the server rejects the token.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000); // free-tier servers can take ~30 s to wake up
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readError(res, `Login failed (${res.status})`));
      const body = await res.json();
      setToken(body.token);
      setUser(body.user);
      return body.user;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server did not answer in time. Please try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const register = useCallback(async ({ name, email, password }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readError(res, `Sign-up failed (${res.status})`));
      const body = await res.json();
      setToken(body.token);
      setUser(body.user);
      return body.user;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server did not answer in time. Please try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const logout = useCallback(() => { clearToken(); setUser(null); }, []);

  const can = useCallback((permission) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo(() => ({ user, loading, login, register, logout, can, authEnabled: AUTH_ENABLED }), [user, loading, login, register, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

