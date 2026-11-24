import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api';
import { fmt, num, dstr, Badge, Modal, Empty, Spinner } from '../ui';

export default function Sales() {
  const location = useLocation();
  const [rows, setRows] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', search: '', status: '' });
  const [detail, setDetail] = useState(null);
  const [settings, setSettings] = useState({});

  const load = () => api.get('/sales', { params: filters }).then(r => setRows(r.data));
  useEffect(() => { load(); api.get('/settings').then(r => setSettings(r.data)); }, []);
  useEffect(() => { if (location.state?.openId) api.get(`/sales/${location.state.openId}`).then(r => setDetail(r.data)); }, [location.state]);

  const openDetail = id => api.get(`/sales/${id}`).then(r => setDetail(r.data));

  const [returns, setReturns] = useState({});
  const doReturn = async () => {
    const items = Object.entries(returns).filter(([, q]) => +q > 0).map(([id, q]) => ({ sale_item_id: +id, qty: +q }));
    if (!items.length) return alert('Enter quantities to return');
    try {
      const r = await api.post(`/sales/${detail.id}/return`, { items });
      alert(`Returned ${items.length} line(s). ${r.data.refund_due > 0 ? `Refund due: ${r.data.refund_due.toLocaleString()} FCFA` : 'Applied against outstanding balance.'}`);
      setReturns({}); openDetail(detail.id); load();
    } catch (e) { alert(e.message); }
  };

  const voidSale = async () => {
    if (!confirm(`Void sale ${detail.receipt_no}? Stock will be restored${detail.paid_amount > 0 ? ' — remember to refund the paid amount.' : '.'}`)) return;
    try {
      await api.post(`/sales/${detail.id}/void`);
      openDetail(detail.id); load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl font-bold text-navy-900">Sales</h2>
        <div className="flex gap-2 flex-wrap">
          <input type="date" className="input w-36" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" className="input w-36" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          <select className="input w-32" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All status</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option>
          </select>
          <input className="input w-44" placeholder="Receipt / customer…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} onKeyDown={e => e.key === 'Enter' && load()} />
          <button className="btn-primary" onClick={load}>Filter</button>
          <Link to="/sales/new" className="btn-gold">+ New sale</Link>
        </div>
      </div>

      {!rows ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Receipt</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Total</th><th className="th">Paid</th><th className="th">Balance</th><th className="th">Method</th><th className="th">Status</th><th className="th"></th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className={s.status === 'voided' ? 'opacity-50' : ''}>
                  <td className="td font-medium">{s.receipt_no}</td>
                  <td className="td">{dstr(s.sale_date)}</td>
                  <td className="td">{s.customer_name || 'Walk-in'}</td>
                  <td className="td font-medium">{fmt(s.total)}</td>
                  <td className="td">{fmt(s.paid_amount)}</td>
                  <td className="td">{s.balance_due > 0 ? <span className="text-red-600">{fmt(s.balance_due)}</span> : '—'}</td>
                  <td className="td capitalize">{s.payment_method.replace('_', ' ')}</td>
                  <td className="td"><Badge status={s.status === 'voided' ? 'voided' : s.payment_status} /></td>
                  <td className="td"><button className="btn-ghost text-xs" onClick={() => openDetail(s.id)}>View / Receipt</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty />}
        </div>
      )}

      {detail && (
        <Modal title={`Sale ${detail.receipt_no}`} onClose={() => setDetail(null)} wide>
          <div id="print-area" className="space-y-3">
            <div className="text-center border-b-2 border-dashed border-navy-200 pb-3">
              {settings.logo_path && settings.receipt_show_logo === '1' && <img src={`/${settings.logo_path}`} className="h-14 mx-auto mb-1 object-contain" />}
              <div className="font-display text-xl font-bold text-navy-900">{settings.business_name || "ROMARICK'S VINTAGE"}</div>
              {settings.business_tagline && <div className="text-xs text-gold-600">{settings.business_tagline}</div>}
              {settings.business_address && <div className="text-xs text-navy-600">{settings.business_address}</div>}
              {settings.business_phone && <div className="text-xs text-navy-600">Tel: {settings.business_phone}</div>}
              <div className="text-xs mt-1">{dstr(detail.sale_date)} · {detail.receipt_no}</div>
            </div>
            {detail.customer_name && <div className="text-sm">Customer: <b>{detail.customer_name}</b>{detail.customer_phone && ` · ${detail.customer_phone}`}</div>}
            <table className="w-full">
              <thead><tr><th className="th">Item</th><th className="th">Qty</th><th className="th">Price</th><th className="th text-right">Total</th></tr></thead>
              <tbody>
                {detail.items.map(i => (
                  <tr key={i.id}>
                    <td className="td">{i.product_name} <span className="text-xs text-navy-600">({i.unit_label})</span>
                      {i.returned_qty > 0 && <span className="badge bg-gray-200 text-gray-600 ml-1">returned {i.returned_qty}</span>}
                    </td>
                    <td className="td">{i.quantity}</td>
                    <td className="td">{fmt(i.unit_price)}</td>
                    <td className="td text-right">{fmt(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm space-y-0.5 pt-2 border-t border-navy-100">
              <div className="flex justify-between"><span>Subtotal</span><span>{fmt(detail.subtotal)}</span></div>
              {detail.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>−{fmt(detail.discount)}</span></div>}
              <div className="flex justify-between font-bold text-base"><span>Total</span><span>{fmt(detail.total)}</span></div>
              <div className="flex justify-between"><span>Paid ({detail.payment_method.replace('_', ' ')})</span><span>{fmt(detail.paid_amount)}</span></div>
              {detail.balance_due > 0 && <div className="flex justify-between text-red-600 font-medium"><span>Balance due</span><span>{fmt(detail.balance_due)}</span></div>}
            </div>
            <div className="text-center text-xs text-navy-600 pt-2 border-t border-dashed border-navy-200">{settings.receipt_footer || 'Thank you for your business!'}</div>
          </div>
          {detail.status !== 'voided' && detail.items.some(i => i.quantity - i.returned_qty > 0) && (
            <div className="mt-3 rounded-lg border border-gold-300 bg-gold-100/50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-navy-600 mb-2">Return items</div>
              {detail.items.filter(i => i.quantity - i.returned_qty > 0).map(i => (
                <div key={i.id} className="flex items-center gap-2 text-sm py-1">
                  <span className="flex-1">{i.product_name} <span className="text-navy-600">({i.unit_label})</span></span>
                  <input type="number" min="0" max={i.quantity - i.returned_qty} className="input w-20 py-1 text-center"
                    placeholder={`max ${i.quantity - i.returned_qty}`}
                    value={returns[i.id] || ''} onChange={e => setReturns({ ...returns, [i.id]: e.target.value })} />
                </div>
              ))}
              <button className="btn-ghost text-xs mt-2" onClick={doReturn}>Process return</button>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            {detail.status === 'voided'
              ? <span className="badge bg-gray-200 text-gray-600 self-center mr-auto">VOIDED — stock restored</span>
              : <button className="btn-danger mr-auto" onClick={voidSale}>Void sale</button>}
            <button className="btn-ghost" onClick={() => setDetail(null)}>Close</button>
            <button className="btn-primary" onClick={() => window.print()}>Print receipt</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
