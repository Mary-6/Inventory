import React, { useEffect, useState } from 'react';
import api from '../api';
import { fmt, dstr, Badge, Modal, Field, Empty, Spinner } from '../ui';

export default function Purchases() {
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [modal, setModal] = useState(null); // 'new' | purchase detail
  const [form, setForm] = useState({ supplier_id: '', reference: '', paid_amount: '', payment_method: 'cash', notes: '' });
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');

  const load = () => api.get('/purchases').then(r => setRows(r.data));
  useEffect(() => {
    load();
    api.get('/products').then(r => setProducts(r.data));
    api.get('/suppliers').then(r => setSuppliers(r.data));
  }, []);

  const addLine = p => {
    const unit = p.type === 'wholesale_drink' ? 'pallet' : 'bottle';
    setLines(l => [...l, { product: p, unit, quantity: 1, unit_cost: p.type === 'wholesale_drink' ? p.cost_price * p.bottles_per_pallet : p.cost_price }]);
  };
  const total = lines.reduce((a, l) => a + l.quantity * (+l.unit_cost || 0), 0);

  const submit = async e => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/purchases', {
        supplier_id: form.supplier_id || null, reference: form.reference || null,
        paid_amount: form.paid_amount === '' ? total : +form.paid_amount, payment_method: form.payment_method, notes: form.notes,
        items: lines.map(l => ({ product_id: l.product.id, unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost })),
      });
      setModal(null); setLines([]); setForm({ supplier_id: '', reference: '', paid_amount: '', notes: '' });
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const voidP = async p => {
    if (!confirm(`Void purchase ${p.reference}? Stock will be reversed.`)) return;
    try { await api.post(`/purchases/${p.id}/void`); load(); setModal(null); }
    catch (e) { alert(e.message); }
  };

  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-navy-900">Purchases</h2>
        <button className="btn-gold" onClick={() => { setModal('new'); setErr(''); }}>+ Record purchase</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Reference</th><th className="th">Date</th><th className="th">Supplier</th><th className="th">Total</th><th className="th">Paid</th><th className="th">Balance</th><th className="th">Payment</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className={p.status === 'voided' ? 'opacity-50' : ''}>
                <td className="td font-medium">{p.reference}</td>
                <td className="td">{dstr(p.purchase_date)}</td>
                <td className="td">{p.supplier_name || '—'}</td>
                <td className="td font-medium">{fmt(p.total)}</td>
                <td className="td">{fmt(p.paid_amount)}</td>
                <td className="td">{p.balance_due > 0 ? <span className="text-red-600">{fmt(p.balance_due)}</span> : '—'}</td>
                <td className="td"><Badge status={p.payment_status} /></td>
                <td className="td"><Badge status={p.status} /></td>
                <td className="td"><button className="btn-ghost text-xs" onClick={() => api.get(`/purchases/${p.id}`).then(r => setModal(r.data))}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty />}
      </div>

      {modal === 'new' && (
        <Modal title="Record purchase" onClose={() => setModal(null)} wide>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier">
                <select className="input" value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">— No supplier (paid in full) —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Reference (auto if empty)"><input className="input" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></Field>
            </div>
            <Field label="Add product">
              <select className="input" value="" onChange={e => { const p = products.find(x => x.id === +e.target.value); if (p) addLine(p); }}>
                <option value="">Select product…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.bottles_per_pallet > 1 ? (p.type === 'wine' ? 'cartons' : 'pallets') : 'bottles'})</option>)}
              </select>
            </Field>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-sm border-b border-navy-50 pb-2">
                <span className="flex-1 font-medium">{l.product.name} <span className="badge bg-navy-100 text-navy-700">{l.unit}</span></span>
                {l.product.bottles_per_pallet > 1 && (
                  <select className="input w-24 py-1" value={l.unit} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}>
                    <option value="pallet">{l.product.type === 'wine' ? 'carton' : 'pallet'}</option><option value="bottle">bottle</option>
                  </select>
                )}
                <input type="number" min="1" className="input w-16 py-1 text-center" value={l.quantity}
                  onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, quantity: +e.target.value } : x))} />
                <span className="text-xs text-navy-600">× cost</span>
                <input type="number" min="0" className="input w-28 py-1 text-right" value={l.unit_cost}
                  onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, unit_cost: e.target.value } : x))} />
                <span className="w-28 text-right font-medium">{fmt(l.quantity * (+l.unit_cost || 0))}</span>
                <button type="button" className="text-red-500" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid now"><input className="input" type="number" min="0" placeholder={total} value={form.paid_amount} onChange={e => setForm({ ...form, paid_amount: e.target.value })} /></Field>
              <Field label="Paid via"><select className="input" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option></select></Field>
              <Field label="Notes"><input className="input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t border-navy-100">
              <span>Total</span><span>{fmt(total)}</span>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" disabled={!lines.length}>Confirm & receive stock</button>
            </div>
          </form>
        </Modal>
      )}

      {modal && modal !== 'new' && (
        <Modal title={`Purchase ${modal.reference}`} onClose={() => setModal(null)} wide>
          <div className="text-sm text-navy-600 mb-3">{dstr(modal.purchase_date)} · {modal.supplier_name || 'No supplier'} · <Badge status={modal.status} /></div>
          <table className="w-full">
            <thead><tr><th className="th">Item</th><th className="th">Unit</th><th className="th">Qty</th><th className="th">Bottles</th><th className="th">Cost</th><th className="th text-right">Total</th></tr></thead>
            <tbody>
              {modal.items.map(i => (
                <tr key={i.id}><td className="td">{i.product_name}</td><td className="td">{i.unit_label}</td><td className="td">{i.quantity}</td><td className="td">{i.base_qty}</td><td className="td">{fmt(i.unit_cost)}</td><td className="td text-right">{fmt(i.line_total)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="text-sm space-y-0.5 pt-3">
            <div className="flex justify-between font-bold"><span>Total</span><span>{fmt(modal.total)}</span></div>
            <div className="flex justify-between"><span>Paid</span><span>{fmt(modal.paid_amount)}</span></div>
            {modal.balance_due > 0 && <div className="flex justify-between text-red-600"><span>Balance owed</span><span>{fmt(modal.balance_due)}</span></div>}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {modal.status === 'received' && <button className="btn-danger" onClick={() => voidP(modal)}>Void & reverse stock</button>}
            <button className="btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
