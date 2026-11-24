import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useDive } from '../ui/contexts';
import { WakeNotice } from '../ui/Sonar';
import { usePageTitle } from '../ui/usePageTitle';
import LegalLinks from '../ui/LegalLinks';
import './Auth.css';

const TunnelScene = lazy(() => import('./TunnelScene'));

export default function Register() {
  const { user, register, loading } = useAuth();
  const { dive } = useDive();
  usePageTitle('Create an account');
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const from = location.state?.from || '/dashboard';

  if (!loading && user) return <Navigate to={from} replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      dive(from, 'Welcome aboard…');
    } catch (err) {
      setError(err.message || 'Sign-up failed');
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
        <h1>Create an account</h1>
        <p className="auth-sub">New accounts can view detections and inspections. An administrator can give you more access later.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {slow && <WakeNotice />}
        <label className="auth-field">Name
          <input autoComplete="name" value={form.name} onChange={set('name')} />
        </label>
        <label className="auth-field">E-mail
          <input type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
        </label>
        <label className="auth-field">Password (at least 8 characters)
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
        </label>
        <label className="auth-field">Repeat password
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </label>
        <p className="auth-hint">By creating an account you agree to the <Link to="/terms">Terms of Use</Link> and the <Link to="/privacy">Privacy Policy</Link>.</p>
        <button className="auth-btn" type="submit" disabled={busy || !form.email || !form.password}>{busy ? 'Creating account…' : 'Create account'}</button>
        <LegalLinks className="auth-legal" />
        <p className="auth-hint">Already have an account? <Link to="/login" state={{ from }}>Sign in</Link></p>
      </form>
    </main>
  );
}
