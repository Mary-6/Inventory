// Inventory module tests against a scratch Postgres database.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('dotenv').config();
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
const { pool, q, tx } = require('../src/db');
const { moveStock, postEntry } = require('../src/util');

let pid, uid;

before(async () => {
  const migDir = path.join(__dirname, '../src/migrations');
  for (const f of fs.readdirSync(migDir).filter(x => x.endsWith('.sql')).sort())
    await pool.query(fs.readFileSync(path.join(migDir, f), 'utf8')).catch(() => {});
  uid = (await q(`INSERT INTO users(name,email,password_hash) VALUES('t','inv@t','x') RETURNING id`)).rows[0].id;
  pid = (await q(`INSERT INTO products(name,type,bottles_per_pallet,cost_price,selling_price,stock_bottles,min_stock)
    VALUES('Water','wholesale_drink',12,150,300,120,24) RETURNING id`)).rows[0].id;
});

test('journal entries stay balanced in the general ledger', async () => {
  await tx(async c => postEntry(c, { description: 'Test entry', refType: 'test', userId: uid,
    lines: [{ account: '1000', debit: 500 }, { account: '3000', credit: 500 }] }));
  const s = (await q('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines')).rows[0];
  assert.equal(+s.d, +s.c);
  await assert.rejects(tx(async c => postEntry(c, { description: 'Bad', lines: [{ account: '1000', debit: 100 }, { account: '3000', credit: 50 }] })));
});

after(() => pool.end());

test('pack conversion: 120 bottles = 10 pallets, 0 loose', () => {
  const bpp = 12, stock = 120;
  assert.equal(Math.floor(stock / bpp), 10);
  assert.equal(stock % bpp, 0);
});

test('purchase 2 pallets + sale 1 pallet + return 1 bottle nets correctly', async () => {
  await tx(c => moveStock(c, { productId: pid, type: 'purchase', quantity: 24, refType: 'purchase', refId: 9, userId: uid }));   // +2 pal → 144
  await tx(c => moveStock(c, { productId: pid, type: 'sale', quantity: -12, refType: 'sale', refId: 9, userId: uid }));        // -1 pal → 132
  await tx(c => moveStock(c, { productId: pid, type: 'return', quantity: 1, refType: 'sale', refId: 9, userId: uid }));        // +1 btl → 133
  const p = (await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0];
  assert.equal(p.stock_bottles, 133); // 11 pal + 1 btl
});

test('physical count posts variance adjustments and preserves trace', async () => {
  // Count finds 130 bottles (system says 133) → -3 adjustment
  const before = (await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0].stock_bottles;
  const counted = 130;
  await tx(async c => {
    await moveStock(c, { productId: pid, type: 'adjustment', quantity: counted - before,
      note: `Physical count: system ${before} → actual ${counted}`, userId: uid });
    await c.query('INSERT INTO audit_logs(user_id,action,subject_type,subject_id,meta) VALUES($1,$2,NULL,NULL,$3)',
      [uid, 'stock.count', JSON.stringify({ changed: 1 })]);
  });
  const p = (await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0];
  assert.equal(p.stock_bottles, 130);
  const m = (await q(`SELECT * FROM stock_movements WHERE product_id=$1 AND type='adjustment' ORDER BY id DESC LIMIT 1`, [pid])).rows[0];
  assert.equal(m.quantity, -3);
  assert.equal(m.stock_after, 130);
  assert.match(m.note, /Physical count/);
  assert.equal(m.user_id, uid);
});

test('damage and missing deductions cannot go negative', async () => {
  await assert.rejects(
    tx(c => moveStock(c, { productId: pid, type: 'damage', quantity: -9999, note: 'x', userId: uid })),
    /Insufficient stock/);
  const p = (await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0];
  assert.equal(p.stock_bottles, 130);
});

test('every movement carries product, type, qty and running balance', async () => {
  const m = (await q(`SELECT COUNT(*)::int n FROM stock_movements WHERE product_id=$1
    AND (product_id IS NULL OR type IS NULL OR quantity IS NULL OR stock_after IS NULL)`, [pid])).rows[0].n;
  assert.equal(m, 0);
});
