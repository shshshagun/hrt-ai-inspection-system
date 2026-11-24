import { useSyncExternalStore } from 'react';
import { preferencesAllowed } from './consent';

const KEY = 'hrt-theme';
const listeners = new Set();

function read() {
  try { return window.localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

let current = typeof window === 'undefined' ? 'dark' : (document.documentElement.dataset.theme === 'light' ? 'light' : read());

function apply(theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  // Saved only when the visitor agreed to remembering preferences (see the cookie notice)
  if (preferencesAllowed()) { try { window.localStorage.setItem(KEY, theme); } catch { /* storage blocked: the choice lasts for this visit only */ } }
  listeners.forEach((l) => l());
}

export function toggleTheme() { apply(current === 'light' ? 'dark' : 'light'); }

/** 'dark' (default) or 'light'. The choice is remembered in this browser. */
export function useTheme() {
  const theme = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => 'dark');
  return { theme, toggle: toggleTheme };
}
