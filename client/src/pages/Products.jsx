import React, { useEffect, useState } from 'react';
import api from '../api';
import { fmt, num, Modal, Field, Empty, Spinner, useForm } from '../ui';

const blank = { name: '', brand: '', category_id: '', type: 'wholesale_drink', bottles_per_pallet: 12, cost_price: '', selling_price: '', pallet_price: '', min_stock: 0, is_active: true };

export default function Products() {
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState(null); // {product?}
  const [form, set, setForm] = useForm(blank);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [newCat, setNewCat] = useState('');

  const load = () => api.get('/products', { params: { search, type: typeFilter } }).then(r => setRows(r.data)).catch(e => setErr(e.message));
  useEffect(() => { load(); api.get('/categories').then(r => setCats(r.data)); }, [typeFilter]);

  const open = p => {
    setErr('');
    setForm(p ? { ...blank, ...p, category_id: p.category_id || '', pallet_price: p.pallet_price ?? '' } : blank);
    setFile(null);
    setModal({ product: p });
  };

  const save = async e => {
    e.preventDefault(); setErr('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (file) fd.append('image', file);
      if (modal.product) await api.put(`/products/${modal.product.id}`, fd);
      else await api.post('/products', fd);
      setModal(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const del = async p => {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const r = await api.delete(`/products/${p.id}`);
    if (r.data.archived) alert('Product has transaction history — it was deactivated instead of deleted.');
    load();
  };

  const addCat = async () => {
    if (!newCat.trim()) return;
    await api.post('/categories', { name: newCat.trim() });
    setNewCat('');
    api.get('/categories').then(r => setCats(r.data));
  };

  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">Products</h2>
        <div className="flex gap-2 flex-wrap">
          <input className="input w-56" placeholder="Search name or brand…" value={search}
            onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
          <select className="input w-44" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            <option value="wholesale_drink">Wholesale Drinks</option>
            <option value="wine">Wines</option>
          </select>
          <button className="btn-gold" onClick={() => open(null)}>+ Add product</button>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <th className="th"></th><th className="th">Product</th><th className="th">Category</th><th className="th">Type</th>
            <th className="th">Stock</th><th className="th">Cost / btl</th><th className="th">Price / btl</th><th className="th">Pallet price</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className={!p.is_active ? 'opacity-50' : ''}>
                <td className="td">{p.image_path ? <img src={`/${p.image_path}`} className="h-9 w-9 rounded object-cover" /> : <span className="text-navy-200">—</span>}</td>
                <td className="td"><div className="font-medium">{p.name}</div><div className="text-xs text-navy-600">{p.brand}</div></td>
                <td className="td">{p.category_name || '—'}</td>
                <td className="td">{p.type === 'wine' ? (p.bottles_per_pallet > 1 ? `Wine (ctn of ${p.bottles_per_pallet})` : 'Wine') : `Wholesale (pal of ${p.bottles_per_pallet})`}</td>
                <td className="td">
                  {p.bottles_per_pallet > 1
                    ? <span>{p.stock_pallets} {p.pack_label} · {p.stock_loose_bottles} btl</span>
                    : <span>{p.stock_bottles} btl</span>}
                  {p.low_stock && <span className="badge bg-red-100 text-red-700 ml-2">low</span>}
                </td>
                <td className="td">{fmt(p.cost_price)}</td>
                <td className="td">{fmt(p.selling_price)}</td>
                <td className="td">{p.bottles_per_pallet > 1 ? fmt(p.pallet_price ?? p.selling_price * p.bottles_per_pallet) : '—'}</td>
                <td className="td text-right space-x-2">
                  <button className="btn-ghost text-xs" onClick={() => open(p)}>Edit</button>
                  <button className="btn-danger text-xs" onClick={() => del(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty />}
      </div>

      {modal && (
        <Modal title={modal.product ? 'Edit product' : 'New product'} onClose={() => setModal(null)}>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className="input" required value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Brand"><input className="input" value={form.brand || ''} onChange={e => set('brand', e.target.value)} /></Field>
            <Field label="Type">
              <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="wholesale_drink">Wholesale Drink (pallets)</option>
                <option value="wine">Wine (bottles)</option>
              </select>
            </Field>
            <Field label="Category">
              <div className="flex gap-1">
                <select className="input" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                  <option value="">—</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </Field>
            <Field label={form.type === 'wine' ? 'Bottles per carton (1 = bottle only)' : 'Bottles per pallet'}>
              <input className="input" type="number" min="1" value={form.bottles_per_pallet} onChange={e => set('bottles_per_pallet', e.target.value)} />
            </Field>
            <Field label="Min. stock (bottles)"><input className="input" type="number" min="0" value={form.min_stock} onChange={e => set('min_stock', e.target.value)} /></Field>
            <Field label="Purchase cost / bottle"><input className="input" type="number" min="0" value={form.cost_price} onChange={e => set('cost_price', e.target.value)} /></Field>
            <Field label="Selling price / bottle"><input className="input" type="number" min="0" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} /></Field>
            {+form.bottles_per_pallet > 1 && (
              <Field label={form.type === 'wine' ? 'Carton price (optional)' : 'Pallet price (optional)'}><input className="input" type="number" min="0" placeholder={`Default ${(form.selling_price || 0) * form.bottles_per_pallet}`} value={form.pallet_price} onChange={e => set('pallet_price', e.target.value)} /></Field>
            )}
            <Field label="Image"><input className="input" type="file" accept="image/*" onChange={e => setFile(e.target.files[0])} /></Field>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="act" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
              <label htmlFor="act" className="text-sm text-navy-800">Active (available for sale)</label>
            </div>
            {err && <div className="col-span-2 text-sm text-red-600">{err}</div>}
            <div className="col-span-2 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary">Save product</button>
            </div>
          </form>
          <div className="mt-4 pt-3 border-t border-navy-100 flex gap-2">
            <input className="input" placeholder="New category name…" value={newCat} onChange={e => setNewCat(e.target.value)} />
            <button className="btn-ghost whitespace-nowrap" onClick={addCat}>+ Category</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
