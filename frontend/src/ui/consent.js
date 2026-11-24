import { useSyncExternalStore } from 'react';

// The visitor's storage choice. 'all' lets the site remember preferences (colour theme) in this browser;
// 'essential' keeps only what the site needs to work (the sign-in token and demo flag, which last for the tab).
// Until a choice is made the value is null and preferences are not saved.
const KEY = 'hrt-consent';
const THEME_KEY = 'hrt-theme';
const listeners = new Set();

function read() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'all' || v === 'essential' ? v : null;
  } catch { return null; }
}

let current = typeof window === 'undefined' ? null : read();

export function getConsent() { return current; }
/** True when the visitor agreed to remembering preferences. */
export function preferencesAllowed() { return current === 'all'; }

export function setConsent(choice) {
  current = choice === 'all' ? 'all' : 'essential';
  try {
    window.localStorage.setItem(KEY, current);
    if (current === 'essential') window.localStorage.removeItem(THEME_KEY);
  } catch { /* storage blocked: the choice lasts for this visit only */ }
  listeners.forEach((l) => l());
}

/** Forget the choice (and the saved theme) so the banner appears again. */
export function resetConsent() {
  current = null;
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(THEME_KEY);
  } catch { /* nothing to clear */ }
  listeners.forEach((l) => l());
}

export function useConsent() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => null);
}
