import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useDive } from '../ui/contexts';
import { WakeNotice } from '../ui/Sonar';
import './Auth.css';

const TunnelScene = lazy(() => import('./TunnelScene'));

export default function Login() {
  const { user, login, loading, startDemo } = useAuth();
  const { dive } = useDive();
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
      dive(from);
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
      <Suspense fallback={null}><TunnelScene mono /></Suspense>
      <section className="auth-hero">
        <p className="auth-hero__tag">HRT / TUNNEL INSPECTION</p>
        <h2><span>Every crack,</span><span className="auth-hero__outline">located.</span></h2>
        <p>Video in, defects out: located to the metre and the clock position, tracked from one inspection to the next.</p>
      </section>
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand"><strong>HRT</strong><span>AI INSPECTION SYSTEM</span></div>
        <h1>Sign in</h1>
        <p className="auth-sub">Use the account created for you by an administrator.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {slow && <WakeNotice />}
        <label className="auth-field">E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="auth-field">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="auth-btn" type="submit" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="auth-btn auth-btn--ghost" onClick={() => { startDemo(); dive('/dashboard', 'Loading the demo…'); }}>Try the read-only demo</button>
        <p className="auth-hint">New here? <Link to="/register" state={{ from }}>Create an account</Link></p>
        <p className="auth-hint">The first sign-in after a quiet period can take up to 30 seconds while the server wakes up.</p>
      </form>
    </main>
  );
}
