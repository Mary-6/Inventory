import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { fmt, num, Field, Spinner } from '../ui';

const METHODS = ['cash', 'bank_transfer', 'mobile_money', 'other'];

export default function NewSale() {
  const navigate = useNavigate();
  const [products, setProducts] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // {product, unit, quantity, unit_price}
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/products').then(r => setProducts(r.data.filter(p => p.is_active)));
    api.get('/customers').then(r => {
      setCustomers(r.data.filter(c => ['Walk-in Customer', 'Online Customer'].includes(c.name)));
      const w = r.data.find(c => c.name === 'Walk-in Customer');
      if (w) setCustomerId(String(w.id));
    });
  }, []);

  const add = (p, unit) => {
    const key = `${p.id}-${unit}`;
    setCart(c => {
      const ex = c.find(x => x.key === key);
      const price = unit === 'pallet' ? (p.pallet_price ?? p.selling_price * p.bottles_per_pallet) : p.selling_price;
      return ex ? c.map(x => x.key === key ? { ...x, quantity: x.quantity + 1 } : x)
                : [...c, { key, product: p, unit, quantity: 1, unit_price: price }];
    });
  };
  const setQty = (key, v) => setCart(c => v <= 0 ? c.filter(x => x.key !== key) : c.map(x => x.key === key ? { ...x, quantity: v } : x));
  const setPrice = (key, v) => setCart(c => c.map(x => x.key === key ? { ...x, unit_price: v } : x));

  const subtotal = cart.reduce((a, x) => a + x.quantity * (+x.unit_price || 0), 0);
  const total = Math.max(0, subtotal - (+discount || 0));
  const paidN = paid === '' ? total : +paid;
  const balance = Math.max(0, total - paidN);

  const submit = async () => {
    setErr('');
    if (!cart.length) return setErr('Cart is empty');
    if (balance > 0 && !customerId) return setErr('Select a customer for credit sales');
    setBusy(true);
    try {
      const r = await api.post('/sales', {
        customer_id: customerId || null,
        items: cart.map(x => ({ product_id: x.product.id, unit: x.unit, quantity: x.quantity, unit_price: x.unit_price })),
        discount: +discount || 0, paid_amount: paidN, payment_method: method, notes,
      });
      navigate('/sales', { state: { openId: r.data.id } });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (!products) return <Spinner />;
  const shown = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.brand || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <div className="xl:col-span-3 space-y-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">New sale</h2>
        <input className="input" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[65vh] overflow-y-auto pr-1">
          {shown.map(p => (
            <div key={p.id} className={`card p-3 ${p.stock_bottles === 0 ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-2">
                {p.image_path ? <img src={`/${p.image_path}`} className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-navy-50 flex items-center justify-center">🍾</div>}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-navy-900 truncate">{p.name}</div>
                  <div className="text-xs text-navy-600">
                    {p.bottles_per_pallet > 1 ? `${p.stock_pallets} ${p.pack_label} · ${p.stock_loose_bottles} btl` : `${p.stock_bottles} btl`}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                {p.bottles_per_pallet > 1 && (
                  <button className="btn-primary flex-1 text-xs py-1.5" disabled={p.stock_pallets === 0} onClick={() => add(p, 'pallet')}>
                    {p.type === 'wine' ? 'Carton' : 'Pallet'} · {fmt(p.pallet_price ?? p.selling_price * p.bottles_per_pallet)}
                  </button>
                )}
                <button className={`${p.bottles_per_pallet > 1 ? 'btn-ghost' : 'btn-primary'} flex-1 text-xs py-1.5`} disabled={p.stock_bottles === 0} onClick={() => add(p, 'bottle')}>
                  Bottle · {fmt(p.selling_price)}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="xl:col-span-2">
        <div className="card p-4 space-y-3 sticky top-4">
          <h3 className="font-semibold text-navy-800">Cart ({cart.length})</h3>
          {cart.length === 0 && <p className="text-sm text-navy-600">Click a product to add it.</p>}
          {cart.map(x => (
            <div key={x.key} className="border-b border-navy-50 pb-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-navy-900">{x.product.name}</span>
                <button className="text-red-500" onClick={() => setQty(x.key, 0)}>×</button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="badge bg-navy-100 text-navy-700">{x.unit}</span>
                <input type="number" min="1" className="input w-16 py-1 text-center" value={x.quantity} onChange={e => setQty(x.key, +e.target.value)} />
                <span className="text-xs text-navy-600">×</span>
                <input type="number" min="0" className="input w-24 py-1 text-right" value={x.unit_price} onChange={e => setPrice(x.key, e.target.value)} />
                <span className="ml-auto text-sm font-medium">{fmt(x.quantity * (+x.unit_price || 0))}</span>
              </div>
            </div>
          ))}

          <Field label="Customer">
            <select className="input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.balance > 0 ? ` — owes ${num(c.balance)}` : ''}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Discount"><input className="input" type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} /></Field>
            <Field label="Paid amount"><input className="input" type="number" min="0" placeholder={total} value={paid} onChange={e => setPaid(e.target.value)} /></Field>
          </div>
          <Field label="Payment method">
            <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Notes"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>

          <div className="pt-2 border-t border-navy-100 space-y-1 text-sm">
            <div className="flex justify-between text-navy-600"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="flex justify-between text-navy-600"><span>Discount</span><span>−{fmt(discount || 0)}</span></div>
            <div className="flex justify-between font-bold text-lg text-navy-900"><span>Total</span><span>{fmt(total)}</span></div>
            {balance > 0 && <div className="flex justify-between text-red-600 font-medium"><span>Balance (debt)</span><span>{fmt(balance)}</span></div>}
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
          <button className="btn-gold w-full justify-center py-2.5" disabled={busy || !cart.length} onClick={submit}>
            {busy ? 'Processing…' : 'Confirm sale'}
          </button>
        </div>
      </div>
    </div>
  );
}
