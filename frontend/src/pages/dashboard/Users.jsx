import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../config/api';
import { authFetch } from '../../auth/authFetch';
import { useAuth } from '../../auth/useAuth';
import { ROLE_NAMES } from '../../auth/permissions';
import '../../auth/Auth.css';

async function call(method, path, body) {
  const res = await authFetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'Operator' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setUsers((await call('GET', '/api/users')).users); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    let active = true;
    call('GET', '/api/users')
      .then((d) => { if (active) { setUsers(d.users); setError(''); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await call('POST', '/api/users', form);
      setForm({ name: '', email: '', password: '', role: 'Operator' });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function update(id, changes) {
    try { await call('PATCH', `/api/users/${id}`, changes); await load(); } catch (err) { setError(err.message); await load(); }
  }

  return (
    <section className="users-page">
      <h1>User management</h1>
      <p className="users-sub">Create accounts, change roles and disable access. Role changes apply on the user's next request.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}

      <form className="users-form" onSubmit={create}>
        <label className="auth-field">Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="auth-field">E-mail
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="auth-field">Initial password (min 8)
          <input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <label className="auth-field">Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLE_NAMES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button className="auth-btn" type="submit" disabled={busy}>Add user</button>
      </form>

      <table className="users-table">
        <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name || '—'}{u.id === me?.id ? ' (you)' : ''}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} aria-label={`Role of ${u.email}`}>
                  {ROLE_NAMES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
              <td><span className={`users-badge ${u.active ? '' : 'users-badge--off'}`}>{u.active ? 'Active' : 'Disabled'}</span></td>
              <td><button type="button" onClick={() => update(u.id, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
