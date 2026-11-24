const express = require('express');
const { q, tx } = require('../db');
const { ah, str, int, money, bad, HttpError, audit, postEntry, methodAcct, dateStr } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

// GL account balances as of a date (inclusive). debit-normal: positive = debit balance.
async function glBalances(asOf) {
  const { rows } = await q(
    `SELECT l.account_code, SUM(l.debit) dr, SUM(l.credit) cr
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE ($1::date IS NULL OR e.entry_date::date <= $1)
     GROUP BY l.account_code`, [asOf || null]);
  const m = {};
  for (const r2 of rows) m[r2.account_code] = { dr: +r2.dr, cr: +r2.cr, net: +r2.dr - +r2.cr };
  return m;
}

// ---- BALANCE SHEET ----
r.get('/balance-sheet', ah(async (req, res) => {
  const asOf = req.query.date || new Date().toISOString().slice(0, 10);
  const b = await glBalances(asOf);
  const d = c => b[c] ? b[c].net : 0;                        // raw debit-net balance
  const c = code => b[code] ? Math.max(0, -b[code].net) : 0; // credit balances
  const assets = {
    cash_on_hand: Math.max(0, d('1000')), bank: Math.max(0, d('1010')), mobile_money: Math.max(0, d('1020')),
    receivables: Math.max(0, d('1100')), inventory: Math.max(0, d('1200')),
  };
  assets.total = Object.values(assets).reduce((a, v) => a + v, 0);
  // A cash account spending beyond its recorded inflows shows as an overdraft liability.
  const overdraft = ['1000', '1010', '1020'].reduce((a, code) => a + Math.max(0, -d(code)), 0);
  const liabilities = { payables: c('2000'), cash_overdraft: overdraft };
  liabilities.total = liabilities.payables + liabilities.cash_overdraft;
  const retained = ['4000', '5000', '6000', '6100'].reduce((a, code) => a - (b[code] ? b[code].net : 0), 0)
    - (b['4100'] ? b['4100'].net : 0);
  const equity = { capital: c('3000'), drawings: d('3100'), retained_earnings: retained };
  equity.total = equity.capital - equity.drawings + equity.retained_earnings;
  res.json({ as_of: asOf, assets, liabilities, equity, check: assets.total - liabilities.total - equity.total });
}));

// ---- PROFIT & LOSS ----
r.get('/pnl', ah(async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await q(
    `SELECT l.account_code, SUM(l.debit) dr, SUM(l.credit) cr
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE ($1::date IS NULL OR e.entry_date::date >= $1) AND ($2::date IS NULL OR e.entry_date::date <= $2)
       AND l.account_code IN ('4000','4100','5000','6000','6100')
     GROUP BY l.account_code`, [from || null, to || null]);
  const m = {}; for (const x of rows) m[x.account_code] = { dr: +x.dr, cr: +x.cr };
  const gross = (m['4000'] ? m['4000'].cr - m['4000'].dr : 0);
  const returns = (m['4100'] ? m['4100'].dr - m['4100'].cr : 0);
  const cogs = (m['5000'] ? m['5000'].dr - m['5000'].cr : 0);
  const expenses = (m['6000'] ? m['6000'].dr - m['6000'].cr : 0);
  const stockAdj = (m['6100'] ? m['6100'].dr - m['6100'].cr : 0);
  const net = gross - returns;
  const grossProfit = net - cogs;
  res.json({ from, to, gross_sales: gross, sales_returns: returns, net_sales: net, cogs,
    gross_profit: grossProfit, operating_expenses: expenses, stock_adjustments: stockAdj,
    net_profit: grossProfit - expenses - stockAdj });
}));

// ---- CASH FLOW (cash + bank + mobile money) ----
r.get('/cash-flow', ah(async (req, res) => {
  const { from, to } = req.query;
  const cashCodes = ['1000', '1010', '1020'];
  const openB = await glBalances(from ? (new Date(new Date(from).getTime() - 864e5)).toISOString().slice(0, 10) : null);
  const opening = cashCodes.reduce((a, c2) => a + (openB[c2] ? openB[c2].net : 0), 0);
  const { rows } = await q(
    `SELECT l.account_code, SUM(l.debit) dr, SUM(l.credit) cr
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.account_code = ANY($1)
       AND ($2::date IS NULL OR e.entry_date::date >= $2) AND ($3::date IS NULL OR e.entry_date::date <= $3)
     GROUP BY l.account_code`, [cashCodes, from || null, to || null]);
  let inflow = 0, outflow = 0;
  const byAcct = {};
  for (const x of rows) { inflow += +x.dr; outflow += +x.cr; byAcct[x.account_code] = { in: +x.dr, out: +x.cr }; }
  res.json({ from, to, opening, received: inflow, paid_out: outflow, closing: opening + inflow - outflow,
    by_account: byAcct, note: 'Cash flow measures actual money movement; it differs from accrual profit.' });
}));

// ---- ACCOUNTS RECEIVABLE: invoice-level, tied to unpaid/partial credit sales ----
r.get('/receivables', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT s.id, s.receipt_no invoice, c.name customer, c.phone, s.sale_date::date::text date,
       s.total, s.paid_amount, s.balance_due, s.due_date,
       (s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE) overdue
     FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
     WHERE s.status='completed' AND s.balance_due > 0
     ORDER BY s.sale_date`);
  res.json({ total: rows.reduce((a, x) => a + +x.balance_due, 0), invoices: rows });
}));

// ---- ACCOUNTS PAYABLE: purchase-level, tied to unpaid/partial supplier purchases ----
r.get('/payables', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT p.id, p.reference, s.name supplier, s.phone, p.purchase_date::date::text date,
       p.total, p.paid_amount, p.balance_due
     FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
     WHERE p.status='received' AND p.balance_due > 0
     ORDER BY p.purchase_date`);
  res.json({ total: rows.reduce((a, x) => a + +x.balance_due, 0), purchases: rows });
}));

// ---- GENERAL LEDGER ----
r.get('/ledger', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT e.id, e.entry_date, e.description, e.ref_type, e.ref_id, l.account_code, a.name account_name, l.debit, l.credit
     FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.code=l.account_code
     WHERE ($1::date IS NULL OR e.entry_date::date >= $1) AND ($2::date IS NULL OR e.entry_date::date <= $2)
     ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000`, [req.query.from || null, req.query.to || null]);
  res.json(rows);
}));

// ---- OWNER CAPITAL / DRAWINGS ----
r.post('/capital', ah(async (req, res) => {
  const kind = str(req.body.type, 'Type', { required: true });
  if (!['contribution', 'withdrawal'].includes(kind)) throw bad('Type must be contribution or withdrawal');
  const amount = money(req.body.amount, 'Amount', { required: true });
  if (amount <= 0) throw bad('Amount must be positive');
  const method = str(req.body.method, 'Method') || 'cash';
  const note = str(req.body.note, 'Note', { max: 300 });
  const acct = methodAcct(method);
  const id = await tx(async c => {
    const lines = kind === 'contribution'
      ? [{ account: acct, debit: amount }, { account: '3000', credit: amount }]
      : [{ account: '3100', debit: amount }, { account: acct, credit: amount }];
    const eid = await postEntry(c, { description: `Owner ${kind}${note ? ': ' + note : ''}`, refType: 'capital', userId: req.session.userId, lines });
    await audit(c, req.session.userId, `capital.${kind}`, 'journal_entry', eid, { amount, method });
    return eid;
  });
  res.status(201).json({ ok: true, entry_id: id });
}));

// ---- DAILY CLOSING ----
async function daySummary(date) {
  const day = `date_trunc('day', x AT TIME ZONE 'UTC')`;
  const sales = (await q(
    `SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(paid_amount),0) paid, COALESCE(SUM(balance_due),0) credit,
       COALESCE(SUM(CASE WHEN payment_method='cash' THEN paid_amount END),0) cash,
       COALESCE(SUM(CASE WHEN payment_method='mobile_money' THEN paid_amount END),0) momo,
       COALESCE(SUM(CASE WHEN payment_method='bank_transfer' THEN paid_amount END),0) bank
     FROM sales WHERE status='completed' AND sale_date::date=$1`, [date])).rows[0];
  const returns = (await q(`SELECT COALESCE(SUM(returned_amount),0) v FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='completed' AND si.returned_qty>0 AND s.sale_date::date=$1`, [date])).rows[0].v;
  const repay = (await q(`SELECT COALESCE(SUM(amount),0) v FROM customer_payments WHERE paid_at::date=$1`, [date])).rows[0].v;
  const supPay = (await q(`SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE paid_at::date=$1`, [date])).rows[0].v;
  const purch = (await q(`SELECT COALESCE(SUM(total),0) t, COALESCE(SUM(paid_amount),0) p, COALESCE(SUM(balance_due),0) b, COUNT(*) n FROM purchases WHERE status='received' AND purchase_date::date=$1`, [date])).rows[0];
  const exp = (await q(`SELECT COALESCE(SUM(amount),0) t, COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount END),0) cash FROM expenses WHERE expense_date=$1`, [date])).rows[0];
  const expByCat = (await q(`SELECT category, SUM(amount) total FROM expenses WHERE expense_date=$1 GROUP BY category ORDER BY total DESC`, [date])).rows;
  return {
    total_sales: +sales.total, cash_sales: +sales.cash, momo_sales: +sales.momo, bank_sales: +sales.bank,
    credit_sales: +sales.credit, sale_paid: +sales.paid, sales_returns: +returns, debt_repayments: +repay,
    supplier_payments: +supPay,
    purchases_total: +purch.t, purchases_paid: +purch.p, purchases_balance: +purch.b, purchase_count: +purch.n,
    expenses_total: +exp.t, expenses_cash: +exp.cash, expenses_by_category: expByCat,
  };
}

// opening cash = all cash-method movements strictly before date (business records, matches GL going forward)
async function openingCash(date) {
  const inn = (await q(`SELECT COALESCE(SUM(paid_amount),0) v FROM sales WHERE status='completed' AND payment_method='cash' AND sale_date::date < $1`, [date])).rows[0].v;
  const rep = (await q(`SELECT COALESCE(SUM(amount),0) v FROM customer_payments WHERE method='cash' AND paid_at::date < $1`, [date])).rows[0].v;
  const pp = (await q(`SELECT COALESCE(SUM(paid_amount),0) v FROM purchases WHERE status='received' AND payment_method='cash' AND purchase_date::date < $1`, [date])).rows[0].v;
  const sp = (await q(`SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE method='cash' AND paid_at::date < $1`, [date])).rows[0].v;
  const ex = (await q(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE payment_method='cash' AND expense_date < $1`, [date])).rows[0].v;
  // Floor at 0: a negative result means unrecorded owner funding (absorbed into opening capital in the GL).
  return Math.max(0, +inn + +rep - +pp - +sp - +ex);
}

r.get('/closing', ah(async (req, res) => {
  const date = dateStr(req.query.date, 'Date') || new Date().toISOString().slice(0, 10);
  const s = await daySummary(date);
  const opening = await openingCash(date);
  const cashReceived = s.cash_sales + +(await q(`SELECT COALESCE(SUM(amount),0) v FROM customer_payments WHERE method='cash' AND paid_at::date=$1`, [date])).rows[0].v;
  const cashPaid = +(await q(`SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE method='cash' AND paid_at::date=$1`, [date])).rows[0].v
    + +(await q(`SELECT COALESCE(SUM(paid_amount),0) v FROM purchases WHERE status='received' AND payment_method='cash' AND purchase_date::date=$1`, [date])).rows[0].v
    + s.expenses_cash;
  const existing = (await q('SELECT * FROM daily_closings WHERE close_date=$1', [date])).rows[0] || null;
  res.json({ date, ...s, opening_cash: opening, cash_received: cashReceived, cash_paid: cashPaid,
    expected_closing: opening + cashReceived - cashPaid, closing: existing });
}));

r.get('/closings', ah(async (req, res) => {
  const { rows } = await q(`SELECT d.*, u.name closed_by_name FROM daily_closings d LEFT JOIN users u ON u.id=d.closed_by ORDER BY close_date DESC LIMIT 365`);
  res.json(rows);
}));

r.post('/closing', ah(async (req, res) => {
  const date = dateStr(req.body.date, 'Date', { required: true });
  const actual = money(req.body.actual_cash, 'Counted cash', { required: true });
  if (actual < 0) throw bad('Counted cash cannot be negative');
  const notes = str(req.body.notes, 'Notes', { max: 500 });
  const result = await tx(async c => {
    const dup = (await c.query('SELECT id FROM daily_closings WHERE close_date=$1 FOR UPDATE', [date])).rows[0];
    if (dup) throw bad(`Business day ${date} is already closed (record #${dup.id}). Corrections go through audit — edit is not permitted.`);
    const s = await daySummary(date);
    const opening = await openingCash(date);
    const cashIn = s.cash_sales + +(await c.query(`SELECT COALESCE(SUM(amount),0) v FROM customer_payments WHERE method='cash' AND paid_at::date=$1`, [date])).rows[0].v;
    const cashOut = +(await c.query(`SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE method='cash' AND paid_at::date=$1`, [date])).rows[0].v
      + +(await c.query(`SELECT COALESCE(SUM(paid_amount),0) v FROM purchases WHERE status='received' AND payment_method='cash' AND purchase_date::date=$1`, [date])).rows[0].v
      + s.expenses_cash;
    const expected = opening + cashIn - cashOut;
    const { rows } = await c.query(
      `INSERT INTO daily_closings(close_date,expected_cash,actual_cash,difference,total_sales,total_received,total_paid,notes,closed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [date, expected, actual, actual - expected, s.total_sales, s.sale_paid + s.debt_repayments, s.supplier_payments + s.purchases_paid + s.expenses_total, notes, req.session.userId]);
    await audit(c, req.session.userId, 'closing.create', 'daily_closing', rows[0].id, { date, expected, actual, difference: actual - expected });
    return rows[0];
  });
  res.status(201).json(result);
}));

module.exports = r;
