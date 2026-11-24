const express = require('express');
const { q, tx } = require('../db');
const { ah, str, money, dateStr, HttpError, postEntry, methodAcct, audit } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

const CATEGORIES = ['Transportation', 'Rent', 'Utilities', 'Staff', 'Maintenance', 'Supplies', 'Other'];

r.get('/', ah(async (req, res) => {
  const { from, to, category } = req.query;
  const { rows } = await q(
    `SELECT e.*, u.name user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
     WHERE ($1::date IS NULL OR e.expense_date >= $1) AND ($2::date IS NULL OR e.expense_date <= $2)
       AND ($3::text IS NULL OR e.category=$3)
     ORDER BY e.expense_date DESC, e.id DESC LIMIT 500`, [from || null, to || null, category || null]);
  res.json(rows);
}));

r.get('/categories', (req, res) => res.json(CATEGORIES));

r.post('/', ah(async (req, res) => {
  const category = str(req.body.category, 'Category', { required: true });
  if (!CATEGORIES.includes(category)) throw new (require('../util').HttpError)(400, 'Invalid category');
  const description = str(req.body.description, 'Description', { max: 300 });
  const amount = money(req.body.amount, 'Amount', { required: true });
  if (amount <= 0) throw new (require('../util').HttpError)(400, 'Amount must be positive');
  const date = dateStr(req.body.expense_date, 'Date') || new Date().toISOString().slice(0, 10);
  const method = str(req.body.payment_method, 'Payment method') || 'cash';
  const reference = str(req.body.reference, 'Reference', { max: 120 });
  const row = await tx(async c => {
    const e = (await c.query('INSERT INTO expenses(category,description,amount,expense_date,payment_method,reference,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [category, description, amount, date, method, reference, req.session.userId])).rows[0];
    await postEntry(c, { description: `Expense: ${description || category}`, refType: 'expense', refId: e.id, userId: req.session.userId, date,
      lines: [{ account: '6000', debit: amount }, { account: methodAcct(method), credit: amount }] });
    await audit(c, req.session.userId, 'expense.create', 'expense', e.id, { amount, category });
    return e;
  });
  res.status(201).json(row);
}));

r.delete('/:id', ah(async (req, res) => {
  const { rows } = await q('DELETE FROM expenses WHERE id=$1 RETURNING *', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Expense not found');
  await tx(async c => postEntry(c, { description: `Expense reversal: ${rows[0].description || rows[0].category}`, refType: 'expense', refId: rows[0].id, userId: req.session.userId,
    lines: [{ account: methodAcct(rows[0].payment_method || 'cash'), debit: +rows[0].amount }, { account: '6000', credit: +rows[0].amount }] }));
  res.json({ ok: true });
}));

module.exports = r;
