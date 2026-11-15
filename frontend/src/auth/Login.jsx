import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import './Auth.css';

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const from = location.state?.from || '/dashboard';

  if (!loading && user) return <Navigate to={from} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand"><strong>HRT</strong><span>AI INSPECTION SYSTEM</span></div>
        <h1>Sign in</h1>
        <p className="auth-sub">Use the account created for you by an administrator.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {slow && <div className="auth-wake" role="status">The server is waking up (free hosting). This can take up to 30 seconds, please wait…</div>}
        <label className="auth-field">E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="auth-field">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="auth-btn" type="submit" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="auth-hint">The first sign-in after a quiet period can take up to 30 seconds while the server wakes up.</p>
      </form>
    </main>
  );
}
