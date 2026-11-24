import React, { useEffect, useState } from 'react';
import api from '../api';
import { fmt, ddate, Modal, Field, Empty, Spinner, useForm } from '../ui';

export default function Expenses() {
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', category: '' });
  const [modal, setModal] = useState(false);
  const [form, set, setForm] = useForm({ category: 'Transportation', description: '', amount: '', expense_date: '' });
  const [err, setErr] = useState('');

  const load = () => api.get('/expenses', { params: filters }).then(r => setRows(r.data));
  useEffect(() => { load(); api.get('/expenses/categories').then(r => setCats(r.data)); }, []);

  const save = async e => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/expenses', form);
      setModal(false); setForm({ category: 'Transportation', description: '', amount: '', expense_date: '' });
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const del = async id => { if (confirm('Delete this expense?')) { await api.delete(`/expenses/${id}`); load(); } };

  if (!rows) return <Spinner />;
  const total = rows.reduce((a, e) => a + +e.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">Expenses</h2>
        <div className="flex gap-2 flex-wrap">
          <input type="date" className="input w-36" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" className="input w-36" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          <select className="input w-40" value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
            <option value="">All categories</option>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
          <button className="btn-primary" onClick={load}>Filter</button>
          <button className="btn-gold" onClick={() => { setModal(true); setErr(''); }}>+ Record expense</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-navy-100 text-sm text-navy-700">Total: <b className="text-red-600">{fmt(total)}</b></div>
        <table className="w-full">
          <thead><tr><th className="th">Date</th><th className="th">Category</th><th className="th">Description</th><th className="th">Amount</th><th className="th">By</th><th className="th"></th></tr></thead>
          <tbody>
            {rows.map(e => (
              <tr key={e.id}>
                <td className="td">{ddate(e.expense_date)}</td>
                <td className="td"><span className="badge bg-navy-100 text-navy-700">{e.category}</span></td>
                <td className="td">{e.description || '—'}</td>
                <td className="td font-medium">{fmt(e.amount)}</td>
                <td className="td">{e.user_name || '—'}</td>
                <td className="td"><button className="btn-danger text-xs" onClick={() => del(e.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty />}
      </div>

      {modal && (
        <Modal title="Record expense" onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Category">
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                {cats.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Description"><input className="input" value={form.description} onChange={e => set('description', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (FCFA)"><input className="input" type="number" min="1" required value={form.amount} onChange={e => set('amount', e.target.value)} /></Field>
              <Field label="Date"><input className="input" type="date" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} /></Field>
              <Field label="Paid via"><select className="input" value={form.payment_method || 'cash'} onChange={e => set('payment_method', e.target.value)}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option></select></Field>
              <Field label="Reference"><input className="input" value={form.reference || ''} onChange={e => set('reference', e.target.value)} /></Field>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setModal(false)}>Cancel</button><button className="btn-primary">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
