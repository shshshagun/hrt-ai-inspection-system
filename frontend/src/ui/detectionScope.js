import { useSyncExternalStore } from 'react';
import { preferencesAllowed } from './consent';

/**
 * Which detections the dashboard shows: only things that count, cracks and spalling (default), those plus detections still waiting for a
 * review, or everything including rejected ones. The choice is remembered in this browser.
 */
const KEY = 'hrt-detection-scope';
export const SCOPES = [
  { id: 'counted', label: 'Counted only', hint: 'Confirmed, or judged a crack or spalling by the system and not yet reviewed' },
  { id: 'not_rejected', label: 'Counted + awaiting review', hint: 'Also the detections nobody has reviewed yet' },
  { id: 'all', label: 'Everything', hint: 'Including rejected detections' },
];
const listeners = new Set();
const valid = (v) => SCOPES.some((s) => s.id === v);

function read() {
  if (!preferencesAllowed()) return 'counted';
  try { const v = window.localStorage.getItem(KEY); return valid(v) ? v : 'counted'; } catch { return 'counted'; }
}
let current = typeof window === 'undefined' ? 'counted' : read();

export const getScope = () => current;

export function setScope(next) {
  if (!valid(next) || next === current) return;
  current = next;
  // Saved only when the visitor agreed to remembering preferences (see the cookie notice)
  if (preferencesAllowed()) { try { window.localStorage.setItem(KEY, next); } catch { /* storage blocked: the choice lasts for this visit only */ } }
  listeners.forEach((l) => l());
}

export function useDetectionScope() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => 'counted');
}
