import React, { useEffect, useState } from 'react';
import api from '../api';
import { fmt, num, dstr, Badge, Modal, Field, Empty, Spinner, useForm } from '../ui';

export default function Customers() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [detail, setDetail] = useState(null);
  const [payAmt, setPayAmt] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [form, set, setForm] = useForm({ name: '', phone: '', address: '', notes: '' });
  const [err, setErr] = useState('');

  const load = () => api.get('/customers', { params: { search } }).then(r => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async e => {
    e.preventDefault(); setErr('');
    try {
      if (edit?.id) await api.put(`/customers/${edit.id}`, form);
      else await api.post('/customers', form);
      setEdit(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const openDetail = id => api.get(`/customers/${id}`).then(r => { setDetail(r.data); setPayAmt(''); });
  const pay = async e => {
    e.preventDefault(); setErr('');
    try {
      await api.post(`/customers/${detail.id}/payments`, { amount: +payAmt, method: payMethod });
      openDetail(detail.id); load();
    } catch (e2) { setErr(e2.message); }
  };

  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">Customers</h2>
        <div className="flex gap-2">
          <input className="input w-52" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
          <button className="btn-gold" onClick={() => { setForm({ name: '', phone: '', address: '', notes: '' }); setEdit({}); setErr(''); }}>+ Add customer</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Name</th><th className="th">Phone</th><th className="th">Purchases</th><th className="th">Total bought</th><th className="th">Debt</th><th className="th"></th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td">{c.phone || '—'}</td>
                <td className="td">{c.sale_count}</td>
                <td className="td">{fmt(c.total_purchases)}</td>
                <td className="td">{c.balance > 0 ? <span className="text-red-600 font-medium">{fmt(c.balance)}</span> : '—'}</td>
                <td className="td text-right space-x-2">
                  <button className="btn-ghost text-xs" onClick={() => openDetail(c.id)}>Details</button>
                  <button className="btn-ghost text-xs" onClick={() => { setForm(c); setEdit(c); setErr(''); }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty />}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit customer' : 'New customer'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Name"><input className="input" required value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="Address"><input className="input" value={form.address || ''} onChange={e => set('address', e.target.value)} /></Field>
            <Field label="Notes"><input className="input" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></Field>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary">Save</button></div>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
            <div>Phone: {detail.phone || '—'}</div><div>Address: {detail.address || '—'}</div>
            <div className="text-right">Debt: <b className="text-red-600">{fmt(detail.balance)}</b></div>
          </div>
          {detail.balance > 0 && (
            <form onSubmit={pay} className="flex gap-2 items-end mb-4 bg-gold-100 rounded-lg p-3">
              <Field label="Repayment amount"><input className="input" type="number" min="1" max={detail.balance} required value={payAmt} onChange={e => setPayAmt(e.target.value)} /></Field>
              <Field label="Method"><select className="input w-36" value={payMethod} onChange={e => setPayMethod(e.target.value)}><option value="cash">cash</option><option value="bank_transfer">bank transfer</option><option value="mobile_money">mobile money</option><option value="other">other</option></select></Field>
              <button className="btn-primary mb-0.5">Record payment</button>
            </form>
          )}
          {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold text-navy-800 mb-2 text-sm">Purchases</h4>
              <table className="w-full"><tbody>
                {detail.sales.map(s => (
                  <tr key={s.id} className="border-b border-navy-50">
                    <td className="td">{s.receipt_no}</td><td className="td">{dstr(s.sale_date)}</td>
                    <td className="td">{fmt(s.total)}</td><td className="td"><Badge status={s.payment_status} /></td>
                  </tr>
                ))}
              </tbody></table>
              {detail.sales.length === 0 && <Empty msg="No purchases" />}
            </div>
            <div>
              <h4 className="font-semibold text-navy-800 mb-2 text-sm">Payments</h4>
              <table className="w-full"><tbody>
                {detail.payments.map(p => (
                  <tr key={p.id} className="border-b border-navy-50">
                    <td className="td">{dstr(p.paid_at)}</td><td className="td capitalize">{p.method}</td><td className="td text-emerald-700">{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
              {detail.payments.length === 0 && <Empty msg="No payments" />}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
