import { createContext, useContext } from 'react';

/** Set VITE_AUTH_ENABLED=false to run the front end without a login (local development only). */
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false';

export const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
