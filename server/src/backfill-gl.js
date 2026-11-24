// One-time GL opening-balances entry: brings the general ledger in line with
// existing business records. Safe to re-run (skips if an opening entry exists).
const { q, tx, pool } = require('./db');
const { postEntry } = require('./util');

async function main() {
  const existing = await q(`SELECT id FROM journal_entries WHERE description='Opening balances' LIMIT 1`);
  if (existing.rows[0]) { console.log('Opening balances already posted — skipping.'); return; }

  // Cash received by method = sale paid_amount (includes allocated repayments).
  const rec = await q(`SELECT payment_method m, COALESCE(SUM(paid_amount),0) v FROM sales WHERE status='completed' GROUP BY payment_method`);
  const paidPurch = await q(`SELECT COALESCE(SUM(paid_amount),0) v FROM purchases WHERE status='received'`);
  const supPay = await q(`SELECT method m, COALESCE(SUM(amount),0) v FROM supplier_payments GROUP BY method`);
  const exp = await q(`SELECT payment_method m, COALESCE(SUM(amount),0) v FROM expenses GROUP BY payment_method`);

  const acct = m => m === 'bank_transfer' ? '1010' : m === 'mobile_money' ? '1020' : '1000';
  const cash = { '1000': 0, '1010': 0, '1020': 0 };
  for (const r of rec.rows) cash[acct(r.m)] += +r.v;
  cash['1000'] -= +paidPurch.rows[0].v; // historical purchases all treated as cash-paid portion
  for (const r of supPay.rows) cash[acct(r.m)] -= +r.v;
  for (const r of exp.rows) cash[acct(r.m)] -= +r.v;

  const ar = +(await q(`SELECT COALESCE(SUM(balance),0) v FROM customers`)).rows[0].v;
  const ap = +(await q(`SELECT COALESCE(SUM(balance),0) v FROM suppliers`)).rows[0].v;
  const inv = +(await q(`SELECT COALESCE(SUM(stock_bottles*cost_price),0) v FROM products WHERE is_active`)).rows[0].v;

  // Cash can't be negative — a computed shortfall means unrecorded owner funding,
  // which is absorbed into the opening capital plug below.
  const lines = [];
  for (const [a, v] of Object.entries(cash)) if (v > 0) lines.push({ account: a, debit: v });
  else if (v < 0) console.log(`note: account ${a} computed ${v} — floored at 0, absorbed into capital`);
  if (ar) lines.push({ account: '1100', debit: ar });
  if (inv) lines.push({ account: '1200', debit: inv });
  if (ap) lines.push({ account: '2000', credit: ap });
  const drTotal = lines.filter(l => l.debit).reduce((a, l) => a + l.debit, 0);
  const capital = drTotal - ap;
  if (capital <= 0) throw new Error(`Opening position is negative (capital plug ${capital}) — check records`);
  lines.push({ account: '3000', credit: capital });

  await tx(async c => postEntry(c, { description: 'Opening balances', refType: 'opening', lines }));
  console.log(`Opening balances posted. Cash ${cash['1000']}, Bank ${cash['1010']}, MoMo ${cash['1020']}, AR ${ar}, Inventory ${inv}, AP ${ap}, Capital ${capital}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
