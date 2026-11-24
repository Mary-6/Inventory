const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const { pool } = require('./db');
const config = require('./config');
const { csrfGuard } = require('./middleware');
const { HttpError } = require('./util');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '2mb' }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production' && process.env.COOKIE_SECURE === '1',
    maxAge: 12 * 60 * 60 * 1000,
  },
}));
app.use(csrfGuard);

app.use('/uploads', express.static(config.uploadDir));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/catalog'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api', require('./routes/parties'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/financials', require('./routes/financials'));
app.use('/api/settings', require('./routes/settings'));

// Serve built client (production) with SPA fallback.
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((req, res, next) => next(new HttpError(404, 'Not found')));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

app.listen(config.port, () => {
  console.log(`Romarick's Vintage API on http://127.0.0.1:${config.port}`);
  autoBackup();
  ensureBootstrap();
});

// First-run bootstrap: creates the admin account, default settings, categories and
// the two customer channels — only when the users table is empty. Demo data is NOT
// seeded; override credentials via ADMIN_EMAIL / ADMIN_PASSWORD env vars.
async function ensureBootstrap() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int c FROM users');
    if (rows[0].c > 0) return;
    const bcrypt = require('bcryptjs');
    const email = process.env.ADMIN_EMAIL || 'admin@romaricks.local';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('Administrator',$1,$2,'admin')`, [email, hash]);
    const SETTINGS = [
      ['business_name', "ROMARICK'S VINTAGE"], ['business_tagline', 'Premium Wholesale Drinks & Wine'],
      ['business_address', ''], ['business_phone', ''], ['business_email', ''],
      ['currency', 'XAF'], ['currency_symbol', 'FCFA'], ['receipt_footer', 'Thank you for your business!'],
      ['receipt_show_logo', '1'], ['default_bottles_per_pallet', '12'], ['logo_path', ''],
    ];
    for (const [k, v] of SETTINGS) await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [k, v]);
    for (const c of ['Soft Drinks', 'Bottled Water', 'Energy Drinks', 'Juices', 'Red Wines', 'White Wines', 'Rosé Wines', 'Sparkling Wines'])
      await pool.query('INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [c]);
    await pool.query(`INSERT INTO customers(name) VALUES('Online Customer'),('Walk-in Customer') ON CONFLICT DO NOTHING`);
    console.log(`Bootstrap: admin account created (${email})`);
  } catch (e) { console.error('Bootstrap check failed:', e.message); }
}

// Automated daily backup: runs pg_dump on startup when the newest backup is >24h old.
function autoBackup() {
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const files = fs.readdirSync(config.backupDir).filter(f => f.endsWith('.sql'));
    const newest = files.map(f => fs.statSync(path.join(config.backupDir, f)).mtimeMs).sort().pop() || 0;
    if (Date.now() - newest < 24 * 60 * 60 * 1000 || !config.pgBin) return;
    const { spawnSync } = require('child_process');
    const name = `auto-${new Date().toISOString().slice(0, 10)}.sql`;
    const u = new URL(config.databaseUrl);
    const r = spawnSync(path.join(config.pgBin, 'pg_dump.exe'),
      ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-f', path.join(config.backupDir, name), decodeURIComponent(u.pathname.slice(1))],
      { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
    console.log(r.status === 0 ? `Auto-backup created: ${name}` : `Auto-backup failed: ${r.stderr}`);
  } catch (e) { console.error('Auto-backup error:', e.message); }
}
