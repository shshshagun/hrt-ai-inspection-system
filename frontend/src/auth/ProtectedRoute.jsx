import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './useAuth';

/**
 * Wraps routes that need a signed-in user, and optionally one permission.
 * Signed-out visitors go to /login and return here afterwards; signed-in users whose role
 * lacks the permission see an "access denied" message instead of the page.
 */
export default function ProtectedRoute({ permission, children }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="auth-loading" role="status" aria-live="polite">Checking your session…</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (permission && !can(permission)) {
    return (
      <div className="auth-denied" role="alert">
        <ShieldAlert size={40} aria-hidden="true" />
        <h2>Access denied</h2>
        {user.demo
          ? <p>This page changes data, so it is not part of the read-only demo. <a href="/login">Sign in</a> to use it.</p>
          : <p>Your role ({user.role}) is not allowed to open this page.</p>}
      </div>
    );
  }
  return children;
}
