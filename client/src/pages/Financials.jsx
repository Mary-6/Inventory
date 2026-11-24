import React from 'react';
import api from '../api';
import { fmt, ddate, Spinner, Empty, Field } from '../ui';

const TABS = ['Balance Sheet', 'Profit & Loss', 'Cash Flow', 'Receivables', 'Payables', 'Ledger'];

export default function Financials() {
  const [tab, setTab] = React.useState(TABS[0]);
  const [from, setFrom] = React.useState(new Date().toISOString().slice(0, 8) + '01');
  const [to, setTo] = React.useState(new Date().toISOString().slice(0, 10));
  const [asOf, setAsOf] = React.useState(to);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const load = async () => {
    setLoading(true); setMsg('');
    try {
      const map = {
        'Balance Sheet': `/financials/balance-sheet?date=${asOf}`,
        'Profit & Loss': `/financials/pnl?from=${from}&to=${to}`,
        'Cash Flow': `/financials/cash-flow?from=${from}&to=${to}`,
        Receivables: '/financials/receivables', Payables: '/financials/payables',
        Ledger: `/financials/ledger?from=${from}&to=${to}`,
      };
      if (map[tab]) setData((await api.get(map[tab])).data); else setData(null);
    } catch (e) { setMsg(e.response?.data?.error || 'Failed to load'); }
    setLoading(false);
  };
  React.useEffect(() => { load(); }, [tab, asOf, from, to]);

  const R = ({ label, value, bold, indent }) => (
    <div className={`flex justify-between py-1.5 ${bold ? 'font-bold border-t border-line mt-1 pt-2' : ''} ${indent ? 'pl-4 text-sm' : ''}`}>
      <span className={bold ? '' : 'text-muted'}>{label}</span><span>{fmt(value)}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Financial Statements</h1>
        <button className="btn-ghost no-print" onClick={() => window.print()}>Print</button>
      </div>
      <div className="flex flex-wrap gap-2 no-print">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={tab === t ? 'btn-primary' : 'btn-ghost'}>{t}</button>)}
      </div>
      <div className="card flex flex-wrap items-end gap-3 no-print">
        {(tab === 'Balance Sheet')
          ? <Field label="As of"><input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} /></Field>
          : tab !== 'Receivables' && tab !== 'Payables' && tab !== 'Owner Capital' && <>
            <Field label="From"><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></Field>
          </>}
        {msg && <span className="text-sm text-brand-700">{msg}</span>}
      </div>
      {loading ? <Spinner /> : (
        <div className="card max-w-3xl">
          {tab === 'Balance Sheet' && data && <>
            <h2 className="font-semibold mb-2">Balance Sheet — as of {ddate(data.as_of)}</h2>
            <p className="font-semibold text-sm mt-3 text-brand-700">ASSETS</p>
            <R label="Cash on hand" value={data.assets.cash_on_hand} indent />
            <R label="Bank" value={data.assets.bank} indent />
            <R label="Mobile money" value={data.assets.mobile_money} indent />
            <R label="Customer receivables" value={data.assets.receivables} indent />
            <R label="Inventory (cost)" value={data.assets.inventory} indent />
            <R label="Total assets" value={data.assets.total} bold />
            <p className="font-semibold text-sm mt-3 text-brand-700">LIABILITIES</p>
            <R label="Supplier payables" value={data.liabilities.payables} indent />
            <R label="Cash overdraft" value={data.liabilities.cash_overdraft} indent />
            <R label="Total liabilities" value={data.liabilities.total} bold />
            <div className={`mt-3 text-sm font-semibold ${Math.abs(data.check) < 1 ? 'text-brand-700' : 'text-red-600'}`}>
              {Math.abs(data.check) < 1 ? '✓ Balanced: Assets = Liabilities + Equity' : `⚠ Out of balance by ${fmt(data.check)}`}
            </div>
          </>}
          {tab === 'Profit & Loss' && data && <>
            <h2 className="font-semibold mb-2">Profit &amp; Loss — {ddate(data.from)} → {ddate(data.to)}</h2>
            <R label="Gross sales" value={data.gross_sales} />
            <R label="Less: sales returns" value={-data.sales_returns} indent />
            <R label="Net sales" value={data.net_sales} bold />
            <R label="Cost of goods sold" value={-data.cogs} />
            <R label="Gross profit" value={data.gross_profit} bold />
            <R label="Operating expenses" value={-data.operating_expenses} />
            <R label="Stock adjustments (damage/missing)" value={-data.stock_adjustments} />
            <R label="Net profit" value={data.net_profit} bold />
          </>}
          {tab === 'Cash Flow' && data && <>
            <h2 className="font-semibold mb-2">Cash Flow — {ddate(data.from)} → {ddate(data.to)}</h2>
            <R label="Opening cash & bank" value={data.opening} />
            <R label="Money received" value={data.received} />
            <R label="Money paid out" value={-data.paid_out} />
            <R label="Closing cash & bank" value={data.closing} bold />
            <p className="text-xs text-muted mt-2">{data.note}</p>
          </>}
          {tab === 'Receivables' && data && <>
            <h2 className="font-semibold mb-2">Accounts Receivable — total {fmt(data.total)}</h2>
            {!(data.invoices || []).length ? <Empty msg="No outstanding receivables — all customer invoices are fully paid." /> :
              <table className="table"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th><th>Due date</th></tr></thead>
                <tbody>{data.invoices.map(v => <tr key={v.id}><td className="font-mono text-xs">{v.invoice}</td><td>{v.customer}</td><td>{ddate(v.date)}</td>
                  <td className="text-right">{fmt(v.total)}</td><td className="text-right">{fmt(v.paid_amount)}</td>
                  <td className="text-right font-semibold">{fmt(v.balance_due)}</td>
                  <td className={v.overdue ? 'text-red-600 font-semibold' : ''}>{v.due_date ? ddate(v.due_date) : '—'}{v.overdue ? ' (overdue)' : ''}</td></tr>)}</tbody></table>}
          </>}
          {tab === 'Payables' && data && <>
            <h2 className="font-semibold mb-2">Accounts Payable — total {fmt(data.total)}</h2>
            {!(data.purchases || []).length ? <Empty msg="No outstanding payables — all supplier purchases are fully paid." /> :
              <table className="table"><thead><tr><th>Reference</th><th>Supplier</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead>
                <tbody>{data.purchases.map(p => <tr key={p.id}><td className="font-mono text-xs">{p.reference}</td><td>{p.supplier}</td><td>{ddate(p.date)}</td>
                  <td className="text-right">{fmt(p.total)}</td><td className="text-right">{fmt(p.paid_amount)}</td>
                  <td className="text-right font-semibold">{fmt(p.balance_due)}</td></tr>)}</tbody></table>}
          </>}
          {tab === 'Ledger' && data && <>
            <h2 className="font-semibold mb-2">General Ledger</h2>
            {!(Array.isArray(data) ? data : []).length ? <Empty /> :
              <table className="table"><thead><tr><th>Date</th><th>Entry</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                <tbody>{data.map((l, i) => <tr key={i}><td className="text-xs">{ddate(l.entry_date)}</td><td className="text-xs">{l.description}</td><td className="text-xs">{l.account_code} {l.account_name}</td><td className="text-right">{l.debit ? fmt(l.debit) : ''}</td><td className="text-right">{l.credit ? fmt(l.credit) : ''}</td></tr>)}</tbody></table>}
          </>}
        </div>
      )}
    </div>
  );
}
