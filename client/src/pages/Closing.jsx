import React from 'react';
import api from '../api';
import { fmt, ddate, Spinner, Field } from '../ui';

export default function Closing() {
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [d, setD] = React.useState(null);
  const [closings, setClosings] = React.useState([]);
  const [actual, setActual] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const load = async () => {
    const [c, list] = await Promise.all([api.get(`/financials/closing?date=${date}`), api.get('/financials/closings')]);
    setD(c.data); setClosings(list.data);
  };
  React.useEffect(() => { load(); }, [date]);

  const close = async e => {
    e.preventDefault(); setMsg('');
    if (!window.confirm(`Close business day ${date}? A duplicate cannot be created afterwards.`)) return;
    try {
      await api.post('/financials/closing', { date, actual_cash: +actual, notes });
      setActual(''); setNotes(''); await load();
      setMsg('Day closed and saved.');
    } catch (e2) { setMsg(e2.response?.data?.error || 'Failed'); }
  };

  if (!d) return <Spinner />;
  const R = ({ label, value, bold }) => (
    <div className={`flex justify-between py-1 ${bold ? 'font-bold border-t border-line pt-2' : ''}`}>
      <span className={bold ? '' : 'text-muted'}>{label}</span><span>{value}</span></div>);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Daily Business Closing</h1>
        <div className="flex gap-2 no-print">
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn-ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card space-y-1">
          <h2 className="font-semibold text-brand-700">SALES — {ddate(date)}</h2>
          <R label="Total sales" value={fmt(d.total_sales)} />
          <R label="Cash sales" value={fmt(d.cash_sales)} />
          <R label="Mobile money sales" value={fmt(d.momo_sales)} />
          <R label="Bank transfer sales" value={fmt(d.bank_sales)} />
          <R label="Credit sales" value={fmt(d.credit_sales)} />
          <R label="Sales returns" value={fmt(d.sales_returns)} />
          <h2 className="font-semibold text-brand-700 pt-3">PAYMENTS</h2>
          <R label="Actual money received (sales + repayments)" value={fmt(d.sale_paid + d.debt_repayments)} />
          <R label="Customer debt repayments" value={fmt(d.debt_repayments)} />
          <R label="Supplier payments" value={fmt(d.supplier_payments)} />
          <h2 className="font-semibold text-brand-700 pt-3">PURCHASES</h2>
          <R label={`Total purchases (${d.purchase_count})`} value={fmt(d.purchases_total)} />
          <R label="Amount paid" value={fmt(d.purchases_paid)} />
          <R label="Outstanding" value={fmt(d.purchases_balance)} />
          <h2 className="font-semibold text-brand-700 pt-3">EXPENSES — total {fmt(d.expenses_total)}</h2>
          {d.expenses_by_category.map(c => <R key={c.category} label={c.category} value={fmt(c.total)} />)}
        </div>
        <div className="space-y-4">
          <div className="card space-y-1">
            <h2 className="font-semibold text-brand-700">CASH SUMMARY</h2>
            <R label="Opening cash" value={fmt(d.opening_cash)} />
            <R label="Cash received" value={fmt(d.cash_received)} />
            <R label="Cash paid out" value={fmt(-d.cash_paid)} />
            <R label="Expected closing cash" value={fmt(d.expected_closing)} bold />
            {d.closing && <>
              <R label="Counted closing cash" value={fmt(d.closing.actual_cash)} />
              <R label="Difference" value={fmt(d.closing.difference)} bold />
              <p className="text-sm text-muted pt-1">Closed record #{d.closing.id} — corrections are audit-logged only.</p>
            </>}
          </div>
          {!d.closing && (
            <form onSubmit={close} className="card space-y-3 no-print">
              <h2 className="font-semibold">Close this business day</h2>
              <Field label="Actual counted cash"><input type="number" min="0" required className="input" value={actual} onChange={e => setActual(e.target.value)} placeholder="Count the till and enter the total" /></Field>
              {actual !== '' && <p className="text-sm">Difference vs expected: <b className={+actual - d.expected_closing === 0 ? 'text-brand-700' : 'text-red-600'}>{fmt(+actual - d.expected_closing)}</b></p>}
              <Field label="Notes"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
              <button className="btn-primary">Save closing</button>
            </form>
          )}
          {msg && <p className="text-sm text-brand-700 no-print">{msg}</p>}
          <div className="card">
            <h2 className="font-semibold mb-2">Closing history</h2>
            {closings.length === 0 ? <p className="text-sm text-muted">No days closed yet.</p> :
              <table className="table"><thead><tr><th>Date</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Diff</th></tr></thead>
                <tbody>{closings.map(c => <tr key={c.id}><td>{ddate(c.close_date)}</td><td className="text-right">{fmt(c.expected_cash)}</td><td className="text-right">{fmt(c.actual_cash)}</td>
                  <td className={`text-right font-semibold ${+c.difference === 0 ? 'text-brand-700' : 'text-red-600'}`}>{fmt(c.difference)}</td></tr>)}</tbody></table>}
          </div>
        </div>
      </div>
    </div>
  );
}
