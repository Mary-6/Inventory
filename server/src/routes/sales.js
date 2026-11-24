const express = require('express');
const { q, tx } = require('../db');
const { ah, str, int, money, bad, HttpError, audit, moveStock, postEntry, methodAcct } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const { from, to, search, status } = req.query;
  const { rows } = await q(
    `SELECT s.*, c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
     WHERE ($1::date IS NULL OR s.sale_date::date >= $1) AND ($2::date IS NULL OR s.sale_date::date <= $2)
       AND ($3::text IS NULL OR s.receipt_no ILIKE $3 OR c.name ILIKE $3)
       AND ($4::text IS NULL OR s.payment_status=$4)
     ORDER BY s.sale_date DESC LIMIT 500`,
    [from || null, to || null, search ? `%${search}%` : null, status || null]);
  res.json(rows);
}));

r.get('/:id', ah(async (req, res) => {
  const { rows } = await q('SELECT s.*, c.name customer_name, c.phone customer_phone, c.address customer_address FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=$1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Sale not found');
  const items = (await q('SELECT * FROM sale_items WHERE sale_id=$1', [req.params.id])).rows;
  res.json({ ...rows[0], items });
}));

r.post('/', ah(async (req, res) => {
  const customerId = int(req.body.customer_id, 'Customer');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one item');
  const discount = money(req.body.discount, 'Discount', { def: 0 });
  const paidAmount = money(req.body.paid_amount, 'Paid amount', { def: 0 });
  const method = str(req.body.payment_method, 'Payment method') || 'cash';
  const notes = str(req.body.notes, 'Notes', { max: 500 });

  const sale = await tx(async c => {
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const pid = int(it.product_id, 'Product', { required: true });
      const qty = int(it.quantity, 'Quantity', { min: 1, required: true });
      const unit = it.unit === 'pallet' ? 'pallet' : 'bottle';
      const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!p || !p.is_active) throw bad('Invalid product');
      if (unit === 'pallet' && p.bottles_per_pallet <= 1) throw bad(`"${p.name}" is not sold in bulk units`);
      const factor = unit === 'pallet' ? p.bottles_per_pallet : 1;
      const base = qty * factor;
      const defaultPrice = unit === 'pallet' ? (p.pallet_price ?? p.selling_price * factor) : p.selling_price;
      const price = it.unit_price === undefined || it.unit_price === null || it.unit_price === '' ? defaultPrice : money(it.unit_price, 'Unit price');
      const lineTotal = qty * price;
      subtotal += lineTotal;
      lines.push({ p, unit, factor, qty, base, price, lineTotal });
    }
    const total = subtotal - discount;
    if (total < 0) throw bad('Discount exceeds total');
    if (paidAmount > total) throw bad('Paid amount exceeds total');
    const balance = total - paidAmount;
    if (balance > 0 && !customerId) throw bad('A customer is required for credit sales');
    const status = balance === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    const seq = (await c.query(`SELECT COUNT(*)::int n FROM sales WHERE sale_date::date = CURRENT_DATE`)).rows[0].n + 1;
    const receipt = `RV-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
    const ins = await c.query(
      `INSERT INTO sales(receipt_no,customer_id,subtotal,discount,total,paid_amount,balance_due,payment_method,payment_status,notes,user_id,due_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [receipt, customerId, subtotal, discount, total, paidAmount, balance, method, status, notes, req.session.userId,
       balance > 0 ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : null]);
    const s = ins.rows[0];

    for (const l of lines) {
      await moveStock(c, { productId: l.p.id, type: 'sale', quantity: -l.base, refType: 'sale', refId: s.id, userId: req.session.userId });
      await c.query(
        `INSERT INTO sale_items(sale_id,product_id,product_name,unit_label,unit_factor,quantity,base_qty,unit_price,unit_cost,line_total,line_cost)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [s.id, l.p.id, l.p.name, l.unit === 'pallet' ? `${l.p.type === 'wine' ? 'Carton' : 'Pallet'} (${l.factor})` : 'Bottle', l.factor, l.qty, l.base, l.price, l.p.cost_price * l.factor, l.lineTotal, l.base * l.p.cost_price]);
    }
    if (customerId && balance > 0)
      await c.query('UPDATE customers SET balance = balance + $1 WHERE id=$2', [balance, customerId]);
    const cogs = lines.reduce((a, l) => a + l.base * l.p.cost_price, 0);
    const revLines = [{ account: '4000', credit: total }];
    if (paidAmount > 0) revLines.unshift({ account: methodAcct(method), debit: paidAmount });
    if (balance > 0) revLines.unshift({ account: '1100', debit: balance });
    await postEntry(c, { description: `Sale ${receipt}`, refType: 'sale', refId: s.id, userId: req.session.userId, lines: revLines });
    if (cogs > 0) await postEntry(c, { description: `COGS ${receipt}`, refType: 'sale', refId: s.id, userId: req.session.userId,
      lines: [{ account: '5000', debit: cogs }, { account: '1200', credit: cogs }] });
    await audit(c, req.session.userId, 'sale.create', 'sale', s.id, { receipt, total, balance });
    return s;
  });
  res.status(201).json(sale);
}));

// Partial return: items[{sale_item_id, qty}]. Restores stock, reduces sale totals
// (net revenue/COGS stay accurate), clears debt first then reduces paid amount (refund).
r.post('/:id/return', ah(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Select items to return');
  const result = await tx(async c => {
    const s = (await c.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!s) throw new HttpError(404, 'Sale not found');
    if (s.status === 'voided') throw bad('Sale is voided');
    let retTotal = 0, retCost = 0;
    for (const it of items) {
      const line = (await c.query('SELECT * FROM sale_items WHERE id=$1 AND sale_id=$2 FOR UPDATE', [it.sale_item_id, s.id])).rows[0];
      if (!line) throw bad('Invalid sale item');
      const qty = int(it.qty, 'Return quantity', { min: 1, required: true });
      const bottles = qty * line.unit_factor;
      if (line.returned_qty + qty > line.quantity) throw bad(`Cannot return more than sold for "${line.product_name}"`);
      const retAmt = Math.round(line.line_total * qty / line.quantity);
      const itemCost = Math.round(line.line_cost * qty / line.quantity);
      retTotal += retAmt; retCost += itemCost;
      await moveStock(c, { productId: line.product_id, type: 'return', quantity: bottles, note: `Return ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId });
      await c.query(`UPDATE sale_items SET returned_qty=returned_qty+$1, returned_amount=returned_amount+$2, line_total=line_total-$2, line_cost=line_cost-$3 WHERE id=$4`,
        [qty, retAmt, itemCost, line.id]);
    }
    const newTotal = s.total - retTotal;
    const debtClear = Math.min(s.balance_due, retTotal);
    const newBalance = s.balance_due - debtClear;
    const newPaid = newTotal - newBalance;
    const status = newBalance === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
    await c.query('UPDATE sales SET total=$1, paid_amount=$2, balance_due=$3, payment_status=$4, subtotal=subtotal-$5 WHERE id=$6',
      [newTotal, newPaid, newBalance, status, retTotal, s.id]);
    if (s.customer_id && debtClear > 0)
      await c.query('UPDATE customers SET balance = GREATEST(0, balance - $1) WHERE id=$2', [debtClear, s.customer_id]);
    const refund = retTotal - debtClear;
    const retLines = [{ account: '4100', debit: retTotal }];
    if (debtClear > 0) retLines.push({ account: '1100', credit: debtClear });
    if (refund > 0) retLines.push({ account: methodAcct(s.payment_method), credit: refund });
    await postEntry(c, { description: `Return ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId, lines: retLines });
    if (retCost > 0) await postEntry(c, { description: `Return COGS ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId,
      lines: [{ account: '1200', debit: retCost }, { account: '5000', credit: retCost }] });
    await audit(c, req.session.userId, 'sale.return', 'sale', s.id, { receipt: s.receipt_no, returned: retTotal });
    return { ok: true, returned: retTotal, refund_due: refund };
  });
  res.json(result);
}));

// Void a sale: restores stock and cancels remaining customer debt.
// Blocked when customer repayments were already allocated to it.
r.post('/:id/void', ah(async (req, res) => {
  const result = await tx(async c => {
    const s = (await c.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!s) throw new HttpError(404, 'Sale not found');
    if (s.status === 'voided') throw bad('Already voided');
    const allocs = await c.query('SELECT COUNT(*)::int n FROM customer_payment_allocations WHERE sale_id=$1', [s.id]);
    if (allocs.rows[0].n > 0) throw bad('Cannot void: customer debt payments were applied to this sale');
    const items = (await c.query('SELECT * FROM sale_items WHERE sale_id=$1', [s.id])).rows;
    for (const it of items)
      await moveStock(c, { productId: it.product_id, type: 'void_sale', quantity: it.base_qty, note: `Void ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId });
    if (s.customer_id && s.balance_due > 0)
      await c.query('UPDATE customers SET balance = GREATEST(0, balance - $1) WHERE id=$2', [s.balance_due, s.customer_id]);
    await c.query(`UPDATE sales SET status='voided', balance_due=0 WHERE id=$1`, [s.id]);
    const voidCogs = items.reduce((a, i) => a + +i.line_cost, 0);
    const vLines = [{ account: '4000', debit: +s.total }];
    if (+s.paid_amount > 0) vLines.push({ account: methodAcct(s.payment_method), credit: +s.paid_amount });
    if (+s.balance_due > 0) vLines.push({ account: '1100', credit: +s.balance_due });
    await postEntry(c, { description: `Void ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId, lines: vLines });
    if (voidCogs > 0) await postEntry(c, { description: `Void COGS ${s.receipt_no}`, refType: 'sale', refId: s.id, userId: req.session.userId,
      lines: [{ account: '1200', debit: voidCogs }, { account: '5000', credit: voidCogs }] });
    await audit(c, req.session.userId, 'sale.void', 'sale', s.id, { receipt: s.receipt_no, total: s.total });
    return { ok: true };
  });
  res.json(result);
}));

module.exports = r;
