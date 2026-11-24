import React, { useState } from 'react';
import api from '../api';
import { fmt, Empty, Spinner } from '../ui';

const TYPES = [
  ['sales', 'Sales report'],
  ['profitability', 'Product profitability'],
  ['purchases', 'Purchase history'],
  ['purchase-register', 'Daily purchase register'],
  ['expenses', 'Expense report'],
  ['stock', 'Stock / inventory'],
  ['debts', 'Outstanding debts'],
  ['closing', 'Daily closing report'],
  ['net-profit', 'Net profit'],
];

export default function Reports() {
  const [type, setType] = useState('sales');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try { setData((await api.get(`/reports/${type}`, { params: range })).data); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const exp = format => {
    const p = new URLSearchParams({ ...range, format });
    api.get(`/reports/${type}?${p}`, { responseType: 'blob' }).then(r => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = `${type}-report.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
      a.click();
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold text-navy-900">Reports</h2>
      <div className="card p-4 flex items-end gap-3 flex-wrap">
        <div><label className="label">Report</label>
          <select className="input w-56" value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><label className="label">From</label><input type="date" className="input w-40" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label className="label">To</label><input type="date" className="input w-40" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
        <button className="btn-primary" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Generate'}</button>
        {data && <>
          <button className="btn-ghost" onClick={() => exp('pdf')}>Export PDF</button>
          <button className="btn-ghost" onClick={() => exp('xlsx')}>Export Excel</button>
        </>}
      </div>

      {busy && <Spinner />}
      {data && !busy && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-navy-100 flex justify-between items-center">
            <h3 className="font-semibold text-navy-800">{data.title}</h3>
            <div className="flex gap-4 text-sm">
              {Object.entries(data.summary).map(([k, v]) => (
                <span key={k} className="text-navy-700">{k}: <b className="text-gold-600">{typeof v === 'number' ? fmt(v) : v}</b></span>
              ))}
            </div>
          </div>
          <table className="w-full">
            <thead><tr>{data.columns.map(c => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="td">{typeof cell === 'number' && j > 0 ? cell.toLocaleString() : cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <Empty />}
        </div>
      )}
    </div>
  );
}
