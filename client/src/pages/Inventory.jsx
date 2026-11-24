import React, { useEffect, useState } from 'react';
import api from '../api';
import { fmt, num, dstr, Modal, Field, Empty, Spinner } from '../ui';

const STATUS = { out: ['bg-red-100 text-red-700', 'OUT'], low: ['bg-amber-100 text-amber-800', 'LOW'], watch: ['bg-gold-100 text-gold-600', 'WATCH'], ok: ['bg-emerald-100 text-emerald-800', 'OK'] };

export default function Inventory() {
  const [tab, setTab] = useState('stock');
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [movs, setMovs] = useState(null);
  const [movProduct, setMovProduct] = useState('');
  const [movType, setMovType] = useState('');
  const [filters, setFilters] = useState({ search: '', category: '', status: '' });
  const [adj, setAdj] = useState(null);
  const [form, setForm] = useState({ type: 'damage', quantity: '', note: '' });
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState('');

  const load = () => api.get('/inventory').then(r => setRows(r.data));
  const loadMovs = (pid = movProduct, type = movType) =>
    api.get('/inventory/movements', { params: { product_id: pid || undefined } }).then(r => setMovs(r.data));
  useEffect(() => {
    load(); loadMovs('', '');
    api.get('/categories').then(r => setCats(r.data));
  }, []);

  const submitAdj = async e => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/inventory/adjust', { ...form, product_id: adj.id });
      setAdj(null); setForm({ type: 'damage', quantity: '', note: '' });
      load(); loadMovs('', '');
    } catch (e2) { setErr(e2.message); }
  };

  const postCount = async () => {
    const items = Object.entries(counts).filter(([, v]) => v !== '').map(([id, v]) => ({ product_id: +id, counted: +v }));
    if (!items.length) return alert('Enter at least one counted quantity');
    try {
      const r = await api.post('/inventory/count', { items });
      alert(`Count posted — ${r.data.changed} adjustment(s) recorded.`);
      setCounts({}); load(); loadMovs('', '');
    } catch (e) { alert(e.message); }
  };

  const exportFile = format => api.get('/reports/stock', { params: { format }, responseType: 'blob' }).then(r => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data);
    a.download = `inventory.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    a.click();
  });

  if (!rows) return <Spinner />;
  const shown = rows.filter(p =>
    (!filters.search || p.name.toLowerCase().includes(filters.search.toLowerCase()) || (p.brand || '').toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.category || p.category_id === +filters.category) &&
    (!filters.status || p.status === filters.status));
  const costVal = shown.reduce((a, p) => a + p.stock_value, 0);
  const sellVal = shown.reduce((a, p) => a + p.retail_value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">Inventory</h2>
        <div className="flex gap-2">
          {['stock', 'movements', 'count'].map(t => (
            <button key={t} className={`btn ${tab === t ? 'bg-navy-800 text-white' : 'btn-ghost'}`}
              onClick={() => { setTab(t); if (t === 'movements') loadMovs('', ''); }}>
              {t === 'count' ? 'Physical count' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button className="btn-ghost text-xs" onClick={() => exportFile('pdf')}>PDF</button>
          <button className="btn-ghost text-xs" onClick={() => exportFile('xlsx')}>Excel</button>
        </div>
      </div>

      {tab === 'stock' && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-navy-100 flex gap-2 flex-wrap items-center">
            <input className="input w-52" placeholder="Search name or brand…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
            <select className="input w-44" value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
              <option value="">All categories</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input w-40" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All statuses</option>
              <option value="ok">In stock</option><option value="watch">Approaching min</option>
              <option value="low">Low stock</option><option value="out">Out of stock</option>
            </select>
            <div className="ml-auto text-sm text-navy-700">
              Cost value: <b>{fmt(costVal)}</b> · Sell value: <b className="text-gold-600">{fmt(sellVal)}</b>
            </div>
          </div>
          <table className="w-full">
            <thead><tr>
              <th className="th">Product</th><th className="th">Category</th><th className="th">Packs</th><th className="th">Total btl</th>
              <th className="th">Cost / btl</th><th className="th">Cost value</th><th className="th">Sell value</th><th className="th">Min</th><th className="th">Status</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id} className={!p.is_active ? 'opacity-50' : ''}>
                  <td className="td"><div className="font-medium">{p.name}</div><div className="text-xs text-navy-600">{p.brand}</div></td>
                  <td className="td">{p.category_name || '—'}</td>
                  <td className="td">{p.stock_pallets === null ? '—' : `${p.stock_pallets} ${p.pack_label} · ${p.loose} btl`}</td>
                  <td className="td font-medium">{num(p.stock_bottles)}</td>
                  <td className="td">{fmt(p.cost_price)}</td>
                  <td className="td">{fmt(p.stock_value)}</td>
                  <td className="td text-gold-600">{fmt(p.retail_value)}</td>
                  <td className="td">{num(p.min_stock)}</td>
                  <td className="td"><span className={`badge ${STATUS[p.status][0]}`}>{STATUS[p.status][1]}</span></td>
                  <td className="td"><button className="btn-ghost text-xs" onClick={() => { setAdj(p); setErr(''); }}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty />}
        </div>
      )}

      {tab === 'movements' && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-navy-100 flex gap-2 items-center">
            <select className="input w-64" value={movProduct} onChange={e => { setMovProduct(e.target.value); loadMovs(e.target.value, movType); }}>
              <option value="">All products</option>
              {rows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input w-44" value={movType} onChange={e => { setMovType(e.target.value); loadMovs(movProduct, e.target.value); }}>
              <option value="">All types</option>
              {['purchase','sale','return','damage','missing','adjustment','void_purchase','void_sale'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {!movs ? <Spinner /> : (
            <table className="w-full">
              <thead><tr><th className="th">Date</th><th className="th">Product</th><th className="th">Type</th><th className="th">Qty (btl)</th><th className="th">After</th><th className="th">Reference</th><th className="th">Note</th><th className="th">By</th></tr></thead>
              <tbody>
                {movs.filter(m => !movType || m.type === movType).map(m => (
                  <tr key={m.id}>
                    <td className="td">{dstr(m.created_at)}</td>
                    <td className="td">{m.product_name}</td>
                    <td className="td"><span className={`badge ${m.quantity > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{m.type}</span></td>
                    <td className="td">{m.quantity > 0 ? '+' : ''}{num(m.quantity)}</td>
                    <td className="td">{num(m.stock_after)}</td>
                    <td className="td text-xs text-navy-600">{m.ref_type ? `${m.ref_type} #${m.ref_id}` : '—'}</td>
                    <td className="td">{m.note || '—'}</td>
                    <td className="td">{m.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {movs && movs.filter(m => !movType || m.type === movType).length === 0 && <Empty msg="No movements" />}
        </div>
      )}

      {tab === 'count' && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-navy-100 flex justify-between items-center">
            <p className="text-sm text-navy-600">Enter physically counted <b>bottles</b>. Variances post as audited adjustments.</p>
            <button className="btn-gold" onClick={postCount}>Post count</button>
          </div>
          <table className="w-full">
            <thead><tr><th className="th">Product</th><th className="th">System (btl)</th><th className="th">Packs</th><th className="th">Counted (btl)</th><th className="th">Variance</th></tr></thead>
            <tbody>
              {rows.filter(p => p.is_active).map(p => {
                const v = counts[p.id];
                const variance = v === '' || v === undefined ? null : +v - p.stock_bottles;
                return (
                  <tr key={p.id}>
                    <td className="td font-medium">{p.name}</td>
                    <td className="td">{num(p.stock_bottles)}</td>
                    <td className="td">{p.stock_pallets === null ? '—' : `${p.stock_pallets} ${p.pack_label} · ${p.loose} btl`}</td>
                    <td className="td"><input type="number" min="0" className="input w-28 py-1 text-center" value={v ?? ''} onChange={e => setCounts({ ...counts, [p.id]: e.target.value })} /></td>
                    <td className="td">{variance === null ? '—' : <span className={variance === 0 ? 'text-emerald-700' : 'text-red-600 font-medium'}>{variance > 0 ? '+' : ''}{num(variance)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adj && (
        <Modal title={`Adjust stock — ${adj.name}`} onClose={() => setAdj(null)}>
          <p className="text-sm text-navy-600 mb-3">Current: {num(adj.stock_bottles)} bottles{adj.stock_pallets !== null && ` (${adj.stock_pallets} ${adj.pack_label} + ${adj.loose})`}</p>
          <form onSubmit={submitAdj} className="space-y-3">
            <Field label="Reason type">
              <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="damage">Damaged / broken (deduct)</option>
                <option value="missing">Missing / lost (deduct)</option>
                <option value="return">Customer return (add)</option>
                <option value="adjustment">Manual correction (+/-)</option>
              </select>
            </Field>
            <Field label={form.type === 'adjustment' ? 'Quantity (bottles, use − to deduct)' : 'Quantity (bottles)'}>
              <input className="input" type="number" required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <Field label="Reason (required)"><input className="input" required value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setAdj(null)}>Cancel</button>
              <button className="btn-primary">Apply adjustment</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
