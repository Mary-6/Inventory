import React, { useEffect, useState } from 'react';
import api from '../api';
import { dstr, Field, Spinner, PasswordInput } from '../ui';

export default function Settings() {
  const [s, setS] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [backups, setBackups] = useState([]);
  const [audit, setAudit] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/settings').then(r => setS(r.data));
    api.get('/settings/backups').then(r => setBackups(r.data));
    api.get('/settings/audit').then(r => setAudit(r.data));
  };
  useEffect(load, []);

  const save = async e => {
    e.preventDefault(); setMsg(''); setErr('');
    try { await api.put('/settings', s); setMsg('Settings saved'); } catch (e2) { setErr(e2.message); }
  };
  const logo = async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('logo', f);
    const r = await api.post('/settings/logo', fd);
    setS({ ...s, logo_path: r.data.logo_path });
  };
  const changePw = async e => {
    e.preventDefault(); setMsg(''); setErr('');
    if (pw.next !== pw.confirm) return setErr('Passwords do not match');
    try { await api.put('/auth/password', { current: pw.current, next: pw.next }); setMsg('Password changed'); setPw({ current: '', next: '', confirm: '' }); }
    catch (e2) { setErr(e2.message); }
  };
  const runBackup = async () => {
    setErr('');
    try { const r = await api.post('/settings/backups'); setMsg(`Backup created: ${r.data.name}`); load(); }
    catch (e) { setErr(e.message); }
  };

  if (!s) return <Spinner />;
  const set = (k, v) => setS({ ...s, [k]: v });

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl font-bold text-navy-900">Settings</h2>
      {msg && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</div>}
      {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}

      <form onSubmit={save} className="card p-5 space-y-4">
        <h3 className="font-semibold text-navy-800">Business information</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Business name"><input className="input" value={s.business_name || ''} onChange={e => set('business_name', e.target.value)} /></Field>
          <Field label="Tagline"><input className="input" value={s.business_tagline || ''} onChange={e => set('business_tagline', e.target.value)} /></Field>
          <Field label="Address"><input className="input" value={s.business_address || ''} onChange={e => set('business_address', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" value={s.business_phone || ''} onChange={e => set('business_phone', e.target.value)} /></Field>
          <Field label="Email"><input className="input" value={s.business_email || ''} onChange={e => set('business_email', e.target.value)} /></Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {s.logo_path && <img src={`/${s.logo_path}`} className="h-10 w-10 rounded object-contain border border-navy-100" />}
              <input type="file" accept="image/*" onChange={logo} className="text-sm" />
            </div>
          </Field>
        </div>
        <h3 className="font-semibold text-navy-800 pt-2">Receipt & preferences</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Currency code"><input className="input" value={s.currency || 'XAF'} onChange={e => set('currency', e.target.value)} /></Field>
          <Field label="Currency symbol"><input className="input" value={s.currency_symbol || 'FCFA'} onChange={e => set('currency_symbol', e.target.value)} /></Field>
          <Field label="Receipt footer"><input className="input" value={s.receipt_footer || ''} onChange={e => set('receipt_footer', e.target.value)} /></Field>
          <Field label="Default bottles per pallet"><input className="input" type="number" min="1" value={s.default_bottles_per_pallet || 12} onChange={e => set('default_bottles_per_pallet', e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="showlogo" checked={s.receipt_show_logo === '1'} onChange={e => set('receipt_show_logo', e.target.checked ? '1' : '0')} />
          <label htmlFor="showlogo" className="text-sm text-navy-800">Show logo on receipts</label>
        </div>
        <button className="btn-primary">Save settings</button>
      </form>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <form onSubmit={changePw} className="card p-5 space-y-3">
          <h3 className="font-semibold text-navy-800">Change password</h3>
          <Field label="Current password"><PasswordInput required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password"><PasswordInput required minLength={6} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm new"><PasswordInput required value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <button className="btn-primary">Change password</button>
        </form>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-navy-800">Database backups</h3>
            <button className="btn-gold" onClick={runBackup}>Run backup now</button>
          </div>
          <table className="w-full"><tbody>
            {backups.map(b => (
              <tr key={b.name} className="border-b border-navy-50">
                <td className="td text-xs">{b.name}</td>
                <td className="td text-xs">{(b.size / 1024).toFixed(0)} KB</td>
                <td className="td text-xs">{dstr(b.created)}</td>
                <td className="td"><a className="text-gold-600 text-xs font-semibold" href={`/api/settings/backups/${b.name}/download`}>Download</a></td>
              </tr>
            ))}
          </tbody></table>
          {backups.length === 0 && <p className="text-sm text-navy-600">No backups yet.</p>}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-navy-800 mb-3">Audit log</h3>
        <table className="w-full">
          <thead><tr><th className="th">Time</th><th className="th">User</th><th className="th">Action</th><th className="th">Details</th></tr></thead>
          <tbody>
            {audit.map(a => (
              <tr key={a.id}>
                <td className="td text-xs">{dstr(a.created_at)}</td>
                <td className="td">{a.user_name || '—'}</td>
                <td className="td"><span className="badge bg-navy-100 text-navy-700">{a.action}</span></td>
                <td className="td text-xs text-navy-600">{a.meta ? JSON.stringify(a.meta) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
