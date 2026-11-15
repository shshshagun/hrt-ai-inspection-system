/**
 * Centralized API & Inference endpoint configuration.
 * Guards against baked localhost env vars when running on HTTPS (Vercel).
 */
export const PRODUCTION_GATEWAY = 'https://hrt-mongo-gateway.onrender.com';

export function resolveApiBase() {
  const envUrl =
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL)) ||
    '';

  const isLocalBrowser =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  if (envUrl) {
    const clean = String(envUrl).trim().replace(/\/$/, '');
    if (isLocalBrowser || !clean.includes('localhost')) {
      return clean;
    }
  }

  return isLocalBrowser ? 'http://localhost:3000' : PRODUCTION_GATEWAY;
}

export const API_BASE = resolveApiBase();

export function resolveInferApi() {
  const envUrl =
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_INFER_API_URL) ||
    '';

  const isLocalBrowser =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  if (envUrl) {
    const clean = String(envUrl).trim().replace(/\/$/, '');
    if (isLocalBrowser || !clean.includes('localhost')) {
      return clean;
    }
  }

  return isLocalBrowser ? 'http://localhost:8000' : null;
}
