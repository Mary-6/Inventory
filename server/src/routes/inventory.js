const express = require('express');
const { q, tx, pool } = require('../db');
const { ah, str, int, bad, audit, moveStock, postEntry } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

// Stock list with valuation
r.get('/', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.name`);
  res.json(rows.map(p => ({
    id: p.id, name: p.name, brand: p.brand, type: p.type, category_name: p.category_name,
    stock_bottles: p.stock_bottles,
    stock_pallets: p.bottles_per_pallet > 1 ? Math.floor(p.stock_bottles / p.bottles_per_pallet) : null,
    loose: p.bottles_per_pallet > 1 ? p.stock_bottles % p.bottles_per_pallet : null,
    pack_label: p.type === 'wine' ? 'ctn' : 'pal',
    bottles_per_pallet: p.bottles_per_pallet,
    cost_price: p.cost_price, selling_price: p.selling_price,
    stock_value: p.stock_bottles * p.cost_price,
    retail_value: p.stock_bottles * p.selling_price,
    min_stock: p.min_stock, is_active: p.is_active, category_id: p.category_id,
    status: p.stock_bottles === 0 ? 'out' : p.stock_bottles <= p.min_stock ? 'low' : p.stock_bottles <= p.min_stock * 1.5 ? 'watch' : 'ok',
  })));
}));

r.get('/movements', ah(async (req, res) => {
  const pid = int(req.query.product_id, 'product_id');
  const { rows } = await q(
    `SELECT m.*, p.name product_name, u.name user_name FROM stock_movements m
     JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
     WHERE ($1::int IS NULL OR m.product_id=$1)
     ORDER BY m.created_at DESC LIMIT 300`, [pid]);
  res.json(rows);
}));

// Authorized adjustment: type = damage | missing | adjustment | return. quantity signed bottles.
r.post('/adjust', ah(async (req, res) => {
  const productId = int(req.body.product_id, 'Product', { required: true });
  const type = str(req.body.type, 'Type', { required: true });
  if (!['damage', 'missing', 'adjustment', 'return'].includes(type)) throw bad('Invalid adjustment type');
  const note = str(req.body.note, 'Reason', { required: true, max: 300 });
  let qty = int(req.body.quantity, 'Quantity', { required: true });
  if (qty === 0) throw bad('Quantity cannot be zero');
  if (type === 'damage' || type === 'missing') qty = -Math.abs(qty);
  if (type === 'return') qty = Math.abs(qty);

  const after = await tx(async c => {
    const a = await moveStock(c, { productId, type, quantity: qty, note, userId: req.session.userId });
    const p = (await c.query('SELECT cost_price FROM products WHERE id=$1', [productId])).rows[0];
    const val = Math.abs(qty) * (+p.cost_price || 0);
    if (val > 0) {
      const lines = qty < 0
        ? [{ account: '6100', debit: val }, { account: '1200', credit: val }]
        : [{ account: '1200', debit: val }, { account: '6100', credit: val }];
      await postEntry(c, { description: `Stock ${type}: ${note}`, refType: 'stock_adjust', refId: productId, userId: req.session.userId, lines });
    }
    await audit(c, req.session.userId, `stock.${type}`, 'product', productId, { quantity: qty, note });
    return a;
  });
  res.json({ ok: true, stock_after: after });
}));

// Bulk physical count: {items:[{product_id, counted}]}. Atomic, audited adjustments.
r.post('/count', ah(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Nothing to post');
  const result = await tx(async c => {
    let changed = 0;
    for (const it of items) {
      const pid = int(it.product_id, 'Product', { required: true });
      const counted = int(it.counted, 'Counted quantity', { min: 0, required: true });
      const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!p) throw bad(`Unknown product #${pid}`);
      const variance = counted - p.stock_bottles;
      if (variance === 0) continue;
      await moveStock(c, {
        productId: pid, type: 'adjustment', quantity: variance,
        note: `Physical count: system ${p.stock_bottles} → actual ${counted}`,
        userId: req.session.userId,
      });
      const val = Math.abs(variance) * (+p.cost_price || 0);
      if (val > 0) {
        const lines = variance < 0
          ? [{ account: '6100', debit: val }, { account: '1200', credit: val }]
          : [{ account: '1200', debit: val }, { account: '6100', credit: val }];
        await postEntry(c, { description: `Physical count adjustment: ${p.name}`, refType: 'stock_count', refId: pid, userId: req.session.userId, lines });
      }
      changed++;
    }
    await audit(c, req.session.userId, 'stock.count', null, null, { items: items.length, changed });
    return { ok: true, changed };
  });
  res.json(result);
}));

module.exports = r;
