const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const SETTINGS = [
  ['business_name', "ROMARICK'S VINTAGE"],
  ['business_tagline', 'Premium Wholesale Drinks & Wine'],
  ['business_address', ''],
  ['business_phone', ''],
  ['business_email', ''],
  ['currency', 'XAF'],
  ['currency_symbol', 'FCFA'],
  ['receipt_footer', 'Thank you for your business!'],
  ['receipt_show_logo', '1'],
  ['default_bottles_per_pallet', '12'],
  ['logo_path', ''],
];

const CATEGORIES = ['Soft Drinks', 'Bottled Water', 'Energy Drinks', 'Juices', 'Red Wines', 'White Wines', 'Rosé Wines', 'Sparkling Wines'];

const PRODUCTS = [
  // [name, brand, category, type, bpp, cost, bottle price, pallet price, stock, min]
  ['Coca-Cola', 'Coca-Cola', 'Soft Drinks', 'wholesale_drink', 12, 350, 500, 5700, 240, 48],
  ['Fanta Orange', 'Coca-Cola', 'Soft Drinks', 'wholesale_drink', 12, 350, 500, 5700, 120, 48],
  ['Sprite', 'Coca-Cola', 'Soft Drinks', 'wholesale_drink', 12, 350, 500, 5700, 96, 48],
  ['Top Water 1.5L', 'Source du Pays', 'Bottled Water', 'wholesale_drink', 12, 150, 300, 3300, 360, 60],
  ['Supermont Water', 'SEMC', 'Bottled Water', 'wholesale_drink', 12, 150, 300, 3300, 240, 60],
  ['Reaktor Energy', 'SABC', 'Energy Drinks', 'wholesale_drink', 12, 500, 800, 9000, 72, 24],
  ['Planète Juice', 'Planète', 'Juices', 'wholesale_drink', 6, 400, 650, 3600, 96, 24],
  ['Top Grenadine', 'Top', 'Juices', 'wholesale_drink', 6, 350, 600, 3300, 72, 24],
  ['Bordeaux Rouge 2019', 'Château Margot', 'Red Wines', 'wine', 1, 3500, 5500, null, 24, 6],
  ['Cabernet Sauvignon', 'Villa Rosa', 'Red Wines', 'wine', 1, 4200, 6500, null, 18, 6],
  ['Merlot Reserve', 'Domaine Laval', 'Red Wines', 'wine', 1, 5000, 7500, null, 12, 6],
  ['Chardonnay Blanc', 'Villa Rosa', 'White Wines', 'wine', 1, 3800, 6000, null, 15, 6],
  ['Sauvignon Blanc', 'Domaine Laval', 'White Wines', 'wine', 1, 4500, 7000, null, 9, 6],
  ['Rosé de Provence', 'Château Margot', 'Rosé Wines', 'wine', 6, 4000, 6500, 36000, 12, 6],
  ['Brut Champagne', 'Maison Dorée', 'Sparkling Wines', 'wine', 1, 9000, 14000, null, 6, 3],
];

async function seed() {
  const existing = await pool.query('SELECT COUNT(*)::int c FROM users');
  if (existing.rows[0].c > 0) { console.log('already seeded'); await pool.end(); return; }

  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('Administrator','admin@romaricks.local',$1,'admin')`, [hash]);
  for (const [k, v] of SETTINGS) await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [k, v]);
  const catIds = {};
  for (const c of CATEGORIES) {
    const r = await pool.query('INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [c]);
    catIds[c] = r.rows[0].id;
  }
  for (const [name, brand, cat, type, bpp, cost, price, pallet, stock, min] of PRODUCTS) {
    await pool.query(
      `INSERT INTO products(category_id,name,brand,type,bottles_per_pallet,cost_price,selling_price,pallet_price,stock_bottles,min_stock)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [catIds[cat], name, brand, type, bpp, cost, price, pallet, stock, min]
    );
  }
  await pool.query(`INSERT INTO customers(name,phone) VALUES('Online Customer',NULL)`);
  await pool.query(`INSERT INTO customers(name,phone) VALUES('Walk-in Customer',NULL)`);
  await pool.end();
  console.log('seeded: admin@romaricks.local / admin123');
}

seed().catch(e => { console.error(e); process.exit(1); });
