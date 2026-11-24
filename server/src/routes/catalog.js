const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { q } = require('../db');
const { ah, str, int, money, bad, HttpError, audit } = require('../util');
const { requireAuth } = require('../middleware');
const { uploadDir } = require('../config');

const r = express.Router();
r.use(requireAuth);

fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(/^image\//.test(file.mimetype) ? null : bad('Only image files allowed'), /^image\//.test(file.mimetype)),
});

// ---- Categories ----
r.get('/categories', ah(async (req, res) => {
  res.json((await q('SELECT * FROM categories ORDER BY name')).rows);
}));
r.post('/categories', ah(async (req, res) => {
  const name = str(req.body.name, 'Name', { required: true, max: 100 });
  const { rows } = await q('INSERT INTO categories(name) VALUES($1) RETURNING *', [name]);
  res.status(201).json(rows[0]);
}));
r.delete('/categories/:id', ah(async (req, res) => {
  await q('DELETE FROM categories WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---- Products ----
const productView = p => ({
  ...p,
  stock_pallets: p.bottles_per_pallet > 1 ? Math.floor(p.stock_bottles / p.bottles_per_pallet) : 0,
  stock_loose_bottles: p.bottles_per_pallet > 1 ? p.stock_bottles % p.bottles_per_pallet : p.stock_bottles,
  pack_label: p.type === 'wine' ? 'ctn' : 'pal',
  low_stock: p.stock_bottles <= p.min_stock,
});

r.get('/products', ah(async (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const type = req.query.type || null;
  const { rows } = await q(
    `SELECT p.*, c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id
     WHERE ($1::text IS NULL OR p.name ILIKE $1 OR p.brand ILIKE $1)
       AND ($2::text IS NULL OR p.type=$2)
     ORDER BY p.name`, [search, type]);
  res.json(rows.map(productView));
}));

r.get('/products/:id', ah(async (req, res) => {
  const { rows } = await q('SELECT p.*, c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Product not found');
  res.json(productView(rows[0]));
}));

function productFields(b) {
  const type = str(b.type, 'Type') || 'wholesale_drink';
  if (!['wholesale_drink', 'wine'].includes(type)) throw bad('Invalid product type');
  const bpp = int(b.bottles_per_pallet, type === 'wine' ? 'Bottles per carton' : 'Bottles per pallet', { min: 1, max: 10000, def: type === 'wine' ? 1 : 12 });
  return {
    category_id: int(b.category_id, 'Category') || null,
    name: str(b.name, 'Name', { required: true, max: 200 }),
    brand: str(b.brand, 'Brand', { max: 120 }),
    type,
    bottles_per_pallet: bpp,
    cost_price: money(b.cost_price, 'Purchase price', { def: 0 }),
    selling_price: money(b.selling_price, 'Selling price', { def: 0 }),
    pallet_price: b.pallet_price === '' || b.pallet_price == null ? null : money(b.pallet_price, type === 'wine' ? 'Carton price' : 'Pallet price'),
    min_stock: int(b.min_stock, 'Minimum stock', { min: 0, def: 0 }),
    is_active: b.is_active !== false && b.is_active !== 'false',
  };
}

r.post('/products', upload.single('image'), ah(async (req, res) => {
  const f = productFields(req.body);
  const image = req.file ? `uploads/${req.file.filename}` : null;
  const { rows } = await q(
    `INSERT INTO products(category_id,name,brand,type,bottles_per_pallet,cost_price,selling_price,pallet_price,min_stock,image_path,is_active)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [f.category_id, f.name, f.brand, f.type, f.bottles_per_pallet, f.cost_price, f.selling_price, f.pallet_price, f.min_stock, image, f.is_active]);
  await audit(req.app.locals.pool ? req.app.locals.pool : require('../db').pool, req.session.userId, 'product.create', 'product', rows[0].id, { name: f.name });
  res.status(201).json(productView(rows[0]));
}));

r.put('/products/:id', upload.single('image'), ah(async (req, res) => {
  const f = productFields(req.body);
  const imgSql = req.file ? ', image_path=$11' : '';
  const params = [f.category_id, f.name, f.brand, f.type, f.bottles_per_pallet, f.cost_price, f.selling_price, f.pallet_price, f.min_stock, f.is_active];
  if (req.file) params.push(`uploads/${req.file.filename}`);
  params.push(req.params.id);
  const { rows } = await q(
    `UPDATE products SET category_id=$1,name=$2,brand=$3,type=$4,bottles_per_pallet=$5,cost_price=$6,selling_price=$7,pallet_price=$8,min_stock=$9,is_active=$10,updated_at=now()${imgSql}
     WHERE id=$${params.length} RETURNING *`, params);
  if (!rows[0]) throw new HttpError(404, 'Product not found');
  await audit(require('../db').pool, req.session.userId, 'product.update', 'product', rows[0].id, { name: f.name });
  res.json(productView(rows[0]));
}));

r.delete('/products/:id', ah(async (req, res) => {
  const used = await q('SELECT 1 FROM sale_items WHERE product_id=$1 UNION ALL SELECT 1 FROM purchase_items WHERE product_id=$1 LIMIT 1', [req.params.id]);
  if (used.rowCount) {
    await q('UPDATE products SET is_active=false WHERE id=$1', [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await q('DELETE FROM products WHERE id=$1', [req.params.id]);
  await audit(require('../db').pool, req.session.userId, 'product.delete', 'product', +req.params.id);
  res.json({ ok: true, archived: false });
}));

module.exports = r;
