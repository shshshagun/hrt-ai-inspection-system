/**
 * Client-side mirror of the server's permission names (api/auth/roles.js).
 * The server is the authority: these constants only decide what the interface shows.
 */
export const PERMISSIONS = Object.freeze({
  DETECTIONS_READ: 'detections:read',
  DETECTIONS_CREATE: 'detections:create',
  DETECTIONS_REVIEW: 'detections:review',
  DETECTIONS_DELETE: 'detections:delete',
  INSPECTIONS_READ: 'inspections:read',
  INSPECTIONS_DELETE: 'inspections:delete',
  REPORTS_GENERATE: 'reports:generate',
  USERS_MANAGE: 'users:manage',
});

export const ROLE_NAMES = ['Operator', 'Engineer', 'Manager', 'Administrator'];

/** Used only when VITE_AUTH_ENABLED=false (local development without a login). */
export const DEV_USER = Object.freeze({
  id: 'dev',
  email: 'dev@localhost.local',
  name: 'Development',
  role: 'Administrator',
  permissions: Object.values(PERMISSIONS),
  active: true,
});
