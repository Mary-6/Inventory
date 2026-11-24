// Tests the core business workflows against a real Postgres database.
// Requires DATABASE_URL_TEST pointing at a scratch database.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('dotenv').config();
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
const { pool, q, tx } = require('../src/db');
const { moveStock } = require('../src/util');

let pid, custId, suppId;

before(async () => {
  // Fresh schema
  const migDir = path.join(__dirname, '../src/migrations');
  for (const f of fs.readdirSync(migDir).filter(x => x.endsWith('.sql')).sort())
    await pool.query(fs.readFileSync(path.join(migDir, f), 'utf8')).catch(() => {});
  for (const t of ['customer_payment_allocations','supplier_payment_allocations','customer_payments','supplier_payments','sale_items','sales','purchase_items','purchases','stock_movements','expenses','products','customers','suppliers','categories','users','settings','audit_logs'])
    await q(`TRUNCATE ${t} RESTART IDENTITY CASCADE`).catch(() => {});
  const u = (await q(`INSERT INTO users(name,email,password_hash) VALUES('t','t@t','x') RETURNING id`)).rows[0].id;
  global.uid = u;
  custId = (await q(`INSERT INTO customers(name) VALUES('Buyer') RETURNING id`)).rows[0].id;
  suppId = (await q(`INSERT INTO suppliers(name) VALUES('Vendor') RETURNING id`)).rows[0].id;
  pid = (await q(`INSERT INTO products(name,type,bottles_per_pallet,cost_price,selling_price,pallet_price,stock_bottles)
    VALUES('Cola','wholesale_drink',12,300,500,5700,0) RETURNING id`)).rows[0].id;
});

after(() => pool.end());

test('purchase of 10 pallets adds 120 bottles and sets weighted cost', async () => {
  await tx(async c => {
    const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
    const base = 10 * p.bottles_per_pallet;
    const cost = Math.round((p.stock_bottles * p.cost_price + base * (3600 / 12)) / (p.stock_bottles + base));
    await moveStock(c, { productId: pid, type: 'purchase', quantity: base, refType: 'purchase', refId: 1, userId: global.uid, updateCost: cost });
  });
  const p = (await q('SELECT * FROM products WHERE id=$1', [pid])).rows[0];
  assert.equal(p.stock_bottles, 120);
  assert.equal(p.cost_price, 300);
});

test('selling 2 pallets deducts 24 bottles', async () => {
  await tx(c => moveStock(c, { productId: pid, type: 'sale', quantity: -24, refType: 'sale', refId: 1, userId: global.uid }));
  assert.equal((await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0].stock_bottles, 96);
});

test('insufficient stock sale is rejected', async () => {
  await assert.rejects(
    tx(c => moveStock(c, { productId: pid, type: 'sale', quantity: -1000, userId: global.uid })),
    /Insufficient stock/);
  assert.equal((await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0].stock_bottles, 96);
});

test('transaction rolls back stock when a later item fails', async () => {
  await assert.rejects(tx(async c => {
    await moveStock(c, { productId: pid, type: 'sale', quantity: -10, userId: global.uid });
    throw new Error('simulated failure');
  }));
  assert.equal((await q('SELECT stock_bottles FROM products WHERE id=$1', [pid])).rows[0].stock_bottles, 96);
});

test('customer payment FIFO-allocates to unpaid sales', async () => {
  const s1 = (await q(`INSERT INTO sales(receipt_no,customer_id,subtotal,total,paid_amount,balance_due,payment_status)
    VALUES('T1',$1,10000,10000,4000,6000,'partial') RETURNING id`, [custId])).rows[0].id;
  const s2 = (await q(`INSERT INTO sales(receipt_no,customer_id,subtotal,total,paid_amount,balance_due,payment_status)
    VALUES('T2',$1,5000,5000,0,5000,'unpaid') RETURNING id`, [custId])).rows[0].id;
  await q('UPDATE customers SET balance=11000 WHERE id=$1', [custId]);

  await tx(async c => {
    const p = (await c.query(`INSERT INTO customer_payments(customer_id,amount,method) VALUES($1,8000,'cash') RETURNING id`, [custId])).rows[0].id;
    let left = 8000;
    const open = (await c.query(`SELECT * FROM sales WHERE customer_id=$1 AND balance_due>0 ORDER BY sale_date FOR UPDATE`, [custId])).rows;
    for (const s of open) {
      if (left <= 0) break;
      const apply = Math.min(left, s.balance_due);
      const nb = s.balance_due - apply;
      await c.query(`UPDATE sales SET balance_due=$1, paid_amount=paid_amount+$2, payment_status=$3 WHERE id=$4`, [nb, apply, nb === 0 ? 'paid' : 'partial', s.id]);
      await c.query('INSERT INTO customer_payment_allocations(payment_id,sale_id,amount) VALUES($1,$2,$3)', [p, s.id, apply]);
      left -= apply;
    }
    await c.query('UPDATE customers SET balance=balance-8000 WHERE id=$1', [custId]);
  });

  const a = (await q('SELECT * FROM sales WHERE id=$1', [s1])).rows[0];
  const b = (await q('SELECT * FROM sales WHERE id=$1', [s2])).rows[0];
  assert.equal(a.balance_due, 0); assert.equal(a.payment_status, 'paid');
  assert.equal(b.balance_due, 3000); assert.equal(b.payment_status, 'partial');
  assert.equal((await q('SELECT balance FROM customers WHERE id=$1', [custId])).rows[0].balance, 3000);
  assert.equal((await q('SELECT COUNT(*)::int n FROM customer_payment_allocations')).rows[0].n, 2);
});

test('gross and net profit math', async () => {
  // revenue 15000, COGS for T1+T2 via sale_items
  await q(`INSERT INTO sale_items(sale_id,product_id,product_name,unit_label,unit_factor,quantity,base_qty,unit_price,unit_cost,line_total,line_cost)
    SELECT id,$1,'Cola','Pallet (12)',12,1,12,10000,3600,10000,3600 FROM sales WHERE receipt_no='T1'`, [pid]);
  await q(`INSERT INTO sale_items(sale_id,product_id,product_name,unit_label,unit_factor,quantity,base_qty,unit_price,unit_cost,line_total,line_cost)
    SELECT id,$1,'Cola','Bottle',1,10,10,500,300,5000,3000 FROM sales WHERE receipt_no='T2'`, [pid]);
  const s = (await q(`SELECT SUM(total) rev, SUM(i.cogs) cogs FROM sales s JOIN (SELECT sale_id,SUM(line_cost) cogs FROM sale_items GROUP BY sale_id) i ON i.sale_id=s.id`)).rows[0];
  await q(`INSERT INTO expenses(category,amount) VALUES('Rent',2000)`);
  const gross = +s.rev - +s.cogs;
  const net = gross - 2000;
  assert.equal(+s.rev, 15000);
  assert.equal(gross, 8400);
  assert.equal(net, 6400);
});
