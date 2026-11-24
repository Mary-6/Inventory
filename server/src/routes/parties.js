const express = require('express');
const { q, tx } = require('../db');
const { ah, str, int, money, bad, HttpError, audit, postEntry, methodAcct } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

const partyFields = b => ({
  name: str(b.name, 'Name', { required: true, max: 200 }),
  phone: str(b.phone, 'Phone', { max: 60 }),
  address: str(b.address, 'Address', { max: 300 }),
  notes: str(b.notes, 'Notes', { max: 500 }),
});

// ---- Customers ----
r.get('/customers', ah(async (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const { rows } = await q(
    `SELECT c.*, COALESCE(s.total_purchases,0) total_purchases, COALESCE(s.sale_count,0) sale_count
     FROM customers c LEFT JOIN (
       SELECT customer_id, SUM(total) total_purchases, COUNT(*) sale_count FROM sales WHERE status='completed' GROUP BY customer_id
     ) s ON s.customer_id=c.id
     WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.phone ILIKE $1) ORDER BY c.name`, [search]);
  res.json(rows);
}));

r.get('/customers/:id', ah(async (req, res) => {
  const c = (await q('SELECT * FROM customers WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw new HttpError(404, 'Customer not found');
  const sales = (await q('SELECT * FROM sales WHERE customer_id=$1 ORDER BY sale_date DESC LIMIT 100', [c.id])).rows;
  const payments = (await q('SELECT * FROM customer_payments WHERE customer_id=$1 ORDER BY paid_at DESC LIMIT 100', [c.id])).rows;
  res.json({ ...c, sales, payments });
}));

r.post('/customers', ah(async (req, res) => {
  const f = partyFields(req.body);
  const { rows } = await q('INSERT INTO customers(name,phone,address,notes) VALUES($1,$2,$3,$4) RETURNING *', [f.name, f.phone, f.address, f.notes]);
  res.status(201).json(rows[0]);
}));

r.put('/customers/:id', ah(async (req, res) => {
  const f = partyFields(req.body);
  const { rows } = await q('UPDATE customers SET name=$1,phone=$2,address=$3,notes=$4 WHERE id=$5 RETURNING *', [f.name, f.phone, f.address, f.notes, req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Customer not found');
  res.json(rows[0]);
}));

r.delete('/customers/:id', ah(async (req, res) => {
  const c = (await q('SELECT * FROM customers WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw new HttpError(404, 'Customer not found');
  if (c.balance > 0) throw bad('Cannot delete a customer with outstanding debt');
  await q('UPDATE sales SET customer_id=NULL WHERE customer_id=$1', [c.id]);
  await q('DELETE FROM customers WHERE id=$1', [c.id]);
  res.json({ ok: true });
}));

// Customer debt repayment: FIFO-allocates across unpaid sales.
r.post('/customers/:id/payments', ah(async (req, res) => {
  const amount = money(req.body.amount, 'Amount', { required: true });
  if (amount <= 0) throw bad('Amount must be positive');
  const method = str(req.body.method, 'Method') || 'cash';
  const note = str(req.body.note, 'Note', { max: 300 });
  const pay = await tx(async c => {
    const cust = (await c.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cust) throw new HttpError(404, 'Customer not found');
    if (amount > cust.balance) throw bad(`Amount exceeds outstanding balance (${cust.balance})`);
    const p = (await c.query('INSERT INTO customer_payments(customer_id,amount,method,note,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *', [cust.id, amount, method, note, req.session.userId])).rows[0];
    let left = amount;
    const open = (await c.query(`SELECT * FROM sales WHERE customer_id=$1 AND balance_due>0 ORDER BY sale_date FOR UPDATE`, [cust.id])).rows;
    for (const s of open) {
      if (left <= 0) break;
      const apply = Math.min(left, s.balance_due);
      const newBal = s.balance_due - apply;
      const newPaid = s.paid_amount + apply;
      await c.query(`UPDATE sales SET balance_due=$1, paid_amount=$2, payment_status=$3 WHERE id=$4`,
        [newBal, newPaid, newBal === 0 ? 'paid' : 'partial', s.id]);
      await c.query('INSERT INTO customer_payment_allocations(payment_id,sale_id,amount) VALUES($1,$2,$3)', [p.id, s.id, apply]);
      left -= apply;
    }
    await c.query('UPDATE customers SET balance = balance - $1 WHERE id=$2', [amount, cust.id]);
    await postEntry(c, { description: `Customer payment #${p.id}`, refType: 'customer_payment', refId: p.id, userId: req.session.userId,
      lines: [{ account: methodAcct(method), debit: amount }, { account: '1100', credit: amount }] });
    await audit(c, req.session.userId, 'customer.payment', 'customer', cust.id, { amount, method });
    return p;
  });
  res.status(201).json(pay);
}));

// ---- Suppliers ----
r.get('/suppliers', ah(async (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const { rows } = await q(
    `SELECT s.*, COALESCE(p.total_bought,0) total_bought, COALESCE(p.purchase_count,0) purchase_count
     FROM suppliers s LEFT JOIN (
       SELECT supplier_id, SUM(total) total_bought, COUNT(*) purchase_count FROM purchases WHERE status='received' GROUP BY supplier_id
     ) p ON p.supplier_id=s.id
     WHERE ($1::text IS NULL OR s.name ILIKE $1 OR s.phone ILIKE $1) ORDER BY s.name`, [search]);
  res.json(rows);
}));

r.get('/suppliers/:id', ah(async (req, res) => {
  const s = (await q('SELECT * FROM suppliers WHERE id=$1', [req.params.id])).rows[0];
  if (!s) throw new HttpError(404, 'Supplier not found');
  const purchases = (await q('SELECT * FROM purchases WHERE supplier_id=$1 ORDER BY purchase_date DESC LIMIT 100', [s.id])).rows;
  const payments = (await q('SELECT * FROM supplier_payments WHERE supplier_id=$1 ORDER BY paid_at DESC LIMIT 100', [s.id])).rows;
  res.json({ ...s, purchases, payments });
}));

r.post('/suppliers', ah(async (req, res) => {
  const f = partyFields(req.body);
  const { rows } = await q('INSERT INTO suppliers(name,phone,address,notes) VALUES($1,$2,$3,$4) RETURNING *', [f.name, f.phone, f.address, f.notes]);
  res.status(201).json(rows[0]);
}));

r.put('/suppliers/:id', ah(async (req, res) => {
  const f = partyFields(req.body);
  const { rows } = await q('UPDATE suppliers SET name=$1,phone=$2,address=$3,notes=$4 WHERE id=$5 RETURNING *', [f.name, f.phone, f.address, f.notes, req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Supplier not found');
  res.json(rows[0]);
}));

r.delete('/suppliers/:id', ah(async (req, res) => {
  const s = (await q('SELECT * FROM suppliers WHERE id=$1', [req.params.id])).rows[0];
  if (!s) throw new HttpError(404, 'Supplier not found');
  if (s.balance > 0) throw bad('Cannot delete a supplier with an outstanding balance');
  await q('UPDATE purchases SET supplier_id=NULL WHERE supplier_id=$1', [s.id]);
  await q('DELETE FROM suppliers WHERE id=$1', [s.id]);
  res.json({ ok: true });
}));

r.post('/suppliers/:id/payments', ah(async (req, res) => {
  const amount = money(req.body.amount, 'Amount', { required: true });
  if (amount <= 0) throw bad('Amount must be positive');
  const method = str(req.body.method, 'Method') || 'cash';
  const note = str(req.body.note, 'Note', { max: 300 });
  const pay = await tx(async c => {
    const sup = (await c.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!sup) throw new HttpError(404, 'Supplier not found');
    if (amount > sup.balance) throw bad(`Amount exceeds outstanding balance (${sup.balance})`);
    const p = (await c.query('INSERT INTO supplier_payments(supplier_id,amount,method,note,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *', [sup.id, amount, method, note, req.session.userId])).rows[0];
    let left = amount;
    const open = (await c.query(`SELECT * FROM purchases WHERE supplier_id=$1 AND balance_due>0 AND status='received' ORDER BY purchase_date FOR UPDATE`, [sup.id])).rows;
    for (const pu of open) {
      if (left <= 0) break;
      const apply = Math.min(left, pu.balance_due);
      const newBal = pu.balance_due - apply;
      await c.query(`UPDATE purchases SET balance_due=$1, paid_amount=$2, payment_status=$3 WHERE id=$4`,
        [newBal, pu.paid_amount + apply, newBal === 0 ? 'paid' : 'partial', pu.id]);
      await c.query('INSERT INTO supplier_payment_allocations(payment_id,purchase_id,amount) VALUES($1,$2,$3)', [p.id, pu.id, apply]);
      left -= apply;
    }
    await c.query('UPDATE suppliers SET balance = balance - $1 WHERE id=$2', [amount, sup.id]);
    await postEntry(c, { description: `Supplier payment #${p.id}`, refType: 'supplier_payment', refId: p.id, userId: req.session.userId,
      lines: [{ account: '2000', debit: amount }, { account: methodAcct(method), credit: amount }] });
    await audit(c, req.session.userId, 'supplier.payment', 'supplier', sup.id, { amount, method });
    return p;
  });
  res.status(201).json(pay);
}));

module.exports = r;
