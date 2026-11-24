import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../api';
import { fmt, num, dstr, Badge, Spinner } from '../ui';

const fmtDay = v => {
  const d = new Date(v + 'T00:00:00');
  return isNaN(d) ? v : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function Kpi({ icon, label, value, sub, tone = 'text-navy-900' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-gold-100 text-gold-600 flex items-center justify-center text-base shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-600 truncate">{label}</div>
        <div className={`mt-0.5 text-xl font-bold font-display ${tone}`}>{value}</div>
        {sub && <div className="text-xs text-navy-600">{sub}</div>}
      </div>
    </div>
  );
}

const ALERT = { out: ['bg-red-100 text-red-700', 'OUT'], low: ['bg-amber-100 text-amber-800', 'LOW'], approaching: ['bg-gold-100 text-gold-600', 'WATCH'] };

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [period, setPeriod] = useState('daily');

  const load = (p = period) => api.get('/dashboard', { params: { ...range, period: p } }).then(r => setD(r.data)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const setP = p => { setPeriod(p); load(p); };

  if (err) return <div className="text-red-600">{err}</div>;
  if (!d) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-navy-900">Dashboard</h2>
          <p className="text-xs text-navy-600 mt-0.5">Business performance at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-40" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} />
          <span className="text-navy-600 text-sm">to</span>
          <input type="date" className="input w-40" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} />
          <button className="btn-primary" onClick={() => load()}>Apply</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <Kpi icon="💰" label="Revenue" value={fmt(d.revenue)} sub={`${d.sale_count} sales`} />
        <Kpi icon="📈" label="Gross profit" value={fmt(d.gross_profit)} tone="text-emerald-700" />
        <Kpi icon="💸" label="Expenses" value={fmt(d.expenses)} tone="text-red-600" />
        <Kpi icon="🏆" label="Net profit" value={fmt(d.net_profit)} tone={d.net_profit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        <Kpi icon="🧾" label="Payments received" value={fmt(d.payments_received)} sub={`paid out ${fmt(d.payments_made)}`} />
        <Kpi icon="⚖" label="Net cash flow" value={fmt(d.net_cash_flow)} tone={d.net_cash_flow >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        <Kpi icon="👥" label="Customer debts" value={fmt(d.customer_debt)} tone="text-gold-600" sub={`we owe ${fmt(d.supplier_debt)}`} />
        <Kpi icon="📦" label="Stock value" value={fmt(d.stock_value)} sub={`${num(d.total_bottles)} bottles`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="card p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-navy-800">Sales trend</h3>
            <div className="flex rounded-lg border border-navy-100 overflow-hidden">
              {['daily', 'weekly', 'monthly'].map(p => (
                <button key={p} onClick={() => setP(p)}
                  className={`px-3 py-1 text-xs font-medium capitalize ${period === p ? 'bg-gold-500 text-navy-900' : 'bg-white text-navy-600 hover:bg-gold-100'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {d.series.length === 0 ? (
            <p className="text-sm text-navy-600 py-16 text-center">No sales in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf0" />
                <XAxis dataKey="label" tickFormatter={fmtDay} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v, n) => n === 'total' ? [fmt(v), 'Sales'] : [v, n]}
                  labelFormatter={v => new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} />
                <Bar dataKey="total" fill="#84cc16" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card p-4">
          <h3 className="font-semibold text-navy-800 mb-3">Top products</h3>
          {d.top_products.length === 0 ? <p className="text-sm text-navy-600">No sales in this period.</p> :
            <table className="w-full"><tbody>
              {d.top_products.map((p, i) => (
                <tr key={i} className="border-b border-navy-50 last:border-0">
                  <td className="py-2 text-sm text-navy-800">{p.name}</td>
                  <td className="py-2 text-sm text-right text-navy-600">{p.bottles} btl</td>
                  <td className="py-2 text-sm text-right font-medium text-gold-600">{fmt(p.revenue)}</td>
                </tr>
              ))}
            </tbody></table>}
          <h3 className="font-semibold text-navy-800 mt-5 mb-2">Payments by method</h3>
          {d.payment_methods.map((m, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="capitalize text-navy-700">{m.method.replace('_', ' ')}</span>
              <span className="text-navy-800">{fmt(m.amount)} <span className="text-navy-600">({m.count})</span></span>
            </div>
          ))}
          <h3 className="font-semibold text-navy-800 mt-5 mb-2">Stock movements · 7 days</h3>
          <div className="flex flex-wrap gap-1.5">
            {d.movement_summary.map(m => (
              <span key={m.type} className="badge bg-navy-100 text-navy-700">{m.type} {m.qty > 0 ? '+' : ''}{num(m.qty)}</span>
            ))}
            {d.movement_summary.length === 0 && <span className="text-sm text-navy-600">No recent movements</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-navy-800">Recent sales</h3>
            <Link to="/sales" className="text-xs text-gold-600 font-semibold hover:underline">View all →</Link>
          </div>
          <table className="w-full"><tbody>
            {d.recent_sales.map(s => (
              <tr key={s.id} className="border-b border-navy-50 last:border-0">
                <td className="py-2 text-sm font-medium text-navy-800">{s.receipt_no}</td>
                <td className="py-2 text-sm text-navy-600">{s.customer_name || 'Walk-in'}</td>
                <td className="py-2 text-sm text-navy-600">{dstr(s.sale_date)}</td>
                <td className="py-2 text-right"><Badge status={s.status === 'voided' ? 'voided' : s.payment_status} /></td>
                <td className="py-2 text-sm text-right font-medium">{fmt(s.total)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="card p-4">
          <h3 className="font-semibold text-navy-800 mb-1">Stock alerts</h3>
          <p className="text-xs text-navy-600 mb-3">
            {d.out_count} out of stock · {d.low_count} low · {d.approaching_count} approaching minimum · {d.products} products
          </p>
          {d.low_stock.length === 0 ? <p className="text-sm text-emerald-700">All products comfortably stocked.</p> :
            <table className="w-full"><tbody>
              {d.low_stock.map(p => (
                <tr key={p.id} className="border-b border-navy-50 last:border-0">
                  <td className="py-2 text-sm text-navy-800">{p.name}</td>
                  <td className="py-2"><span className={`badge ${ALERT[p.alert][0]}`}>{ALERT[p.alert][1]}</span></td>
                  <td className="py-2 text-sm text-right text-navy-700">
                    {p.bottles_per_pallet > 1
                      ? `${Math.floor(p.stock_bottles / p.bottles_per_pallet)} ${p.type === 'wine' ? 'ctn' : 'pal'} · ${p.stock_bottles % p.bottles_per_pallet} btl`
                      : `${p.stock_bottles} btl`}
                  </td>
                </tr>
              ))}
            </tbody></table>}
        </div>
      </div>
    </div>
  );
}
