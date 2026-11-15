/**
 * Read-only demo mode: a visitor can explore the dashboard, the 3D twin and the reports with sample data and no account.
 * The flag lives in sessionStorage, so closing the tab ends the demo.
 */
const KEY = 'hrt_demo';

export function isDemo() {
  try { return window.sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function enterDemoFlag() {
  try { window.sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
}

export function exitDemoFlag() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

/** The pseudo-user shown while the demo runs. It can only read; the server is never contacted. */
export const DEMO_USER = Object.freeze({
  id: 'demo',
  email: 'demo@hrt.local',
  name: 'Demo visitor',
  role: 'Demo',
  permissions: Object.freeze(['detections:read', 'inspections:read', 'reports:generate']),
  active: true,
  demo: true,
});
