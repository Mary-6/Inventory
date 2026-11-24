const express = require('express');
const { q, tx } = require('../db');
const { ah, str, int, money, bad, HttpError, audit, moveStock, postEntry, methodAcct } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const { from, to, search } = req.query;
  const { rows } = await q(
    `SELECT p.*, s.name supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
     WHERE ($1::date IS NULL OR p.purchase_date::date >= $1) AND ($2::date IS NULL OR p.purchase_date::date <= $2)
       AND ($3::text IS NULL OR p.reference ILIKE $3 OR s.name ILIKE $3)
     ORDER BY p.purchase_date DESC LIMIT 500`,
    [from || null, to || null, search ? `%${search}%` : null]);
  res.json(rows);
}));

r.get('/:id', ah(async (req, res) => {
  const { rows } = await q('SELECT p.*, s.name supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Purchase not found');
  const items = (await q('SELECT * FROM purchase_items WHERE purchase_id=$1', [req.params.id])).rows;
  res.json({ ...rows[0], items });
}));

r.post('/', ah(async (req, res) => {
  const supplierId = int(req.body.supplier_id, 'Supplier');
  const reference = str(req.body.reference, 'Reference') || `PO-${Date.now()}`;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one item');
  const paidAmount = money(req.body.paid_amount, 'Paid amount', { def: 0 });
  const payMethod = str(req.body.payment_method, 'Payment method') || 'cash';
  const notes = str(req.body.notes, 'Notes', { max: 500 });

  const purchase = await tx(async c => {
    let total = 0;
    const lines = [];
    for (const it of items) {
      const pid = int(it.product_id, 'Product', { required: true });
      const qty = int(it.quantity, 'Quantity', { min: 1, required: true });
      const unit = it.unit === 'pallet' ? 'pallet' : 'bottle';
      const unitCost = money(it.unit_cost, 'Unit cost', { required: true });
      const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!p) throw bad('Invalid product');
      if (unit === 'pallet' && p.bottles_per_pallet <= 1) throw bad(`"${p.name}" is not bought in bulk units`);
      const factor = unit === 'pallet' ? p.bottles_per_pallet : 1;
      const base = qty * factor;
      total += qty * unitCost;
      lines.push({ p, unit, factor, qty, base, unitCost, lineTotal: qty * unitCost, bottleCost: unitCost / factor });
    }
    if (paidAmount > total) throw bad('Paid amount exceeds total');
    const balance = total - paidAmount;
    if (balance > 0 && !supplierId) throw bad('A supplier is required for unpaid purchases');
    const status = balance === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    const ins = await c.query(
      `INSERT INTO purchases(reference,supplier_id,total,paid_amount,balance_due,payment_status,payment_method,notes,user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [reference, supplierId, total, paidAmount, balance, status, payMethod, notes, req.session.userId]);
    const pu = ins.rows[0];

    for (const l of lines) {
      const newCost = (l.p.stock_bottles + l.base) > 0
        ? Math.round((l.p.stock_bottles * l.p.cost_price + l.base * l.bottleCost) / (l.p.stock_bottles + l.base))
        : Math.round(l.bottleCost);
      await moveStock(c, { productId: l.p.id, type: 'purchase', quantity: l.base, refType: 'purchase', refId: pu.id, userId: req.session.userId, updateCost: newCost });
      await c.query(
        `INSERT INTO purchase_items(purchase_id,product_id,product_name,unit_label,unit_factor,quantity,base_qty,unit_cost,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pu.id, l.p.id, l.p.name, l.unit === 'pallet' ? `${l.p.type === 'wine' ? 'Carton' : 'Pallet'} (${l.factor})` : 'Bottle', l.factor, l.qty, l.base, l.unitCost, l.lineTotal]);
    }
    if (supplierId && balance > 0)
      await c.query('UPDATE suppliers SET balance = balance + $1 WHERE id=$2', [balance, supplierId]);
    const pLines = [{ account: '1200', debit: total }];
    if (paidAmount > 0) pLines.push({ account: methodAcct(payMethod), credit: paidAmount });
    if (balance > 0) pLines.push({ account: '2000', credit: balance });
    await postEntry(c, { description: `Purchase ${reference}`, refType: 'purchase', refId: pu.id, userId: req.session.userId, lines: pLines });
    await audit(c, req.session.userId, 'purchase.create', 'purchase', pu.id, { reference, total, balance });
    return pu;
  });
  res.status(201).json(purchase);
}));

// Void a received purchase: reverses stock; only allowed when no supplier payments were allocated.
r.post('/:id/void', ah(async (req, res) => {
  const result = await tx(async c => {
    const pu = (await c.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!pu) throw new HttpError(404, 'Purchase not found');
    if (pu.status === 'voided') throw bad('Already voided');
    const allocs = await c.query('SELECT COUNT(*)::int n FROM supplier_payment_allocations WHERE purchase_id=$1', [pu.id]);
    if (allocs.rows[0].n > 0) throw bad('Cannot void: supplier payments were applied to this purchase');
    const items = (await c.query('SELECT * FROM purchase_items WHERE purchase_id=$1', [pu.id])).rows;
    for (const it of items)
      await moveStock(c, { productId: it.product_id, type: 'void_purchase', quantity: -it.base_qty, note: `Void ${pu.reference}`, refType: 'purchase', refId: pu.id, userId: req.session.userId });
    if (pu.supplier_id && pu.balance_due > 0)
      await c.query('UPDATE suppliers SET balance = GREATEST(0, balance - $1) WHERE id=$2', [pu.balance_due, pu.supplier_id]);
    await c.query(`UPDATE purchases SET status='voided', balance_due=0, payment_status='paid' WHERE id=$1`, [pu.id]);
    const vLines = [{ account: '1200', credit: +pu.total }];
    if (+pu.paid_amount > 0) vLines.unshift({ account: methodAcct(pu.payment_method || 'cash'), debit: +pu.paid_amount });
    if (+pu.balance_due > 0) vLines.unshift({ account: '2000', debit: +pu.balance_due });
    await postEntry(c, { description: `Void purchase ${pu.reference}`, refType: 'purchase', refId: pu.id, userId: req.session.userId, lines: vLines });
    await audit(c, req.session.userId, 'purchase.void', 'purchase', pu.id, { reference: pu.reference });
    return { ok: true };
  });
  res.json(result);
}));

module.exports = r;
