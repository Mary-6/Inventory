import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../App';
import { PasswordInput } from '../ui';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post('/auth/login', form);
      setUser(r.data.user);
      navigate('/');
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-gold-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/uploads/rv-logo.svg" alt="Romarick's Vintage" className="h-24 w-24 mx-auto mb-4" />
          <h1 className="font-display text-3xl font-bold text-gold-600">ROMARICK'S</h1>
          <div className="text-xs tracking-[.4em] text-navy-700 mt-1">V I N T A G E</div>
          <p className="text-navy-600 text-sm mt-3">Premium Wholesale Drinks & Wine</p>
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required autoFocus value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Password</label>
            <PasswordInput required value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
          <button className="btn-gold w-full justify-center py-2.5" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
