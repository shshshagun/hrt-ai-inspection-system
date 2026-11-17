import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { isDemo } from '../demo/demoMode';
import { useToast } from '../ui/contexts';
import { WakeNotice } from '../ui/Sonar';
import { usePageTitle } from '../ui/usePageTitle';
import { useAuth } from './useAuth';
import './Auth.css';

const TunnelScene = lazy(() => import('./TunnelScene'));
const COOLDOWN_S = 60;

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the server. It may be waking up (free hosting); try again in a few seconds.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Forgot password: ask for a 6-digit code by e-mail, then set a new password with it. */
export default function ForgotPassword() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  usePageTitle('Reset your password');

  const [step, setStep] = useState('email'); // email | code
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [wait, setWait] = useState(0); // seconds until another code can be requested

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  async function run(work) {
    setError('');
    setBusy(true);
    const timer = setTimeout(() => setSlow(true), 4000);
    try { await work(); } catch (err) { setError(err.message); } finally { clearTimeout(timer); setSlow(false); setBusy(false); }
  }

  const sendCode = (e) => {
    e?.preventDefault();
    return run(async () => {
      const out = await post('/api/auth/forgot-password', { email: email.trim() });
      setInfo(out.message);
      setStep('code');
      setWait(COOLDOWN_S);
    });
  };

  const changePassword = (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return undefined; }
    if (password !== confirm) { setError('The two passwords do not match.'); return undefined; }
    return run(async () => {
      const out = await post('/api/auth/reset-password', { email: email.trim(), otp: code.trim(), password });
      toast.success(out.message);
      navigate('/login', { replace: true });
    });
  };

  return (
    <main className="auth-page">
      <Suspense fallback={null}><TunnelScene mono /></Suspense>
      <section className="auth-hero">
        <p className="auth-hero__tag">HRT / ACCOUNT</p>
        <h2><span>Back in</span><span className="auth-hero__outline">a minute.</span></h2>
        <p>We will e-mail you a 6-digit code. It works once and expires in 10 minutes.</p>
      </section>

      <form className="auth-card" onSubmit={step === 'email' ? sendCode : changePassword} noValidate>
        <div className="auth-brand"><strong>HRT</strong><span>AI INSPECTION SYSTEM</span></div>
        <h1>{step === 'email' ? 'Forgot password' : 'Enter the code'}</h1>
        {isDemo() && <div className="auth-error" role="status">The demo has no server, so passwords cannot be reset here. Sign out of the demo first.</div>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {slow && <WakeNotice />}

        {step === 'email' ? (
          <>
            <p className="auth-sub">Enter the e-mail address of your account.</p>
            <label className="auth-field">E-mail
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <button className="auth-btn" type="submit" disabled={busy || !email.trim() || isDemo()}>{busy ? 'Sending…' : 'Send the code'}</button>
          </>
        ) : (
          <>
            <p className="auth-sub" role="status">{info}</p>
            <label className="auth-field">6-digit code
              <input inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus
                style={{ letterSpacing: '0.4em', fontFamily: "'JetBrains Mono', monospace", fontSize: 20 }} />
            </label>
            <label className="auth-field">New password (at least 8 characters)
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <label className="auth-field">Repeat the new password
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            <button className="auth-btn" type="submit" disabled={busy || code.length !== 6 || !password || isDemo()}>{busy ? 'Changing…' : 'Change password'}</button>
            <button type="button" className="auth-btn auth-btn--ghost" disabled={busy || wait > 0} onClick={sendCode}>{wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
            <p className="auth-hint"><button type="button" className="auth-linkbtn" onClick={() => { setStep('email'); setCode(''); setError(''); }}>Use a different e-mail</button></p>
          </>
        )}
        <p className="auth-hint"><Link to="/login">Back to sign in</Link></p>
      </form>
    </main>
  );
}
