const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { spawnSync } = require('child_process');
const { q, pool } = require('../db');
const { ah, str, bad, audit } = require('../util');
const { requireAuth } = require('../middleware');
const { uploadDir, backupDir, pgBin, databaseUrl } = require('../config');

const r = express.Router();
r.use(requireAuth);

const EDITABLE = ['business_name','business_tagline','business_address','business_phone','business_email','currency','currency_symbol','receipt_footer','receipt_show_logo','default_bottles_per_pallet','logo_path'];

r.get('/', ah(async (req, res) => {
  res.json(Object.fromEntries((await q('SELECT key,value FROM settings')).rows.map(x => [x.key, x.value])));
}));

r.put('/', ah(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!EDITABLE.includes(k) || k === 'logo_path') continue;
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, String(v ?? '')]);
  }
  res.json({ ok: true });
}));

// Logo upload
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (req, f, cb) => cb(null, `logo-${Date.now()}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(/^image\//.test(f.mimetype) ? null : bad('Only image files allowed'), true),
});
r.post('/logo', upload.single('logo'), ah(async (req, res) => {
  if (!req.file) throw bad('No file uploaded');
  const p = `uploads/${req.file.filename}`;
  await q(`INSERT INTO settings(key,value) VALUES('logo_path',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [p]);
  res.json({ logo_path: p });
}));

// ---- Backups (pg_dump) ----
fs.mkdirSync(backupDir, { recursive: true });
r.get('/backups', ah(async (req, res) => {
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'))
    .map(f => ({ name: f, size: fs.statSync(path.join(backupDir, f)).size, created: fs.statSync(path.join(backupDir, f)).mtime }));
  res.json(files.sort((a, b) => b.name.localeCompare(a.name)));
}));

r.post('/backups', ah(async (req, res) => {
  const pgDump = pgBin ? path.join(pgBin, 'pg_dump.exe') : 'pg_dump';
  const name = `backup-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.sql`;
  const out = path.join(backupDir, name);
  const u = new URL(databaseUrl);
  const result = spawnSync(pgDump, ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-f', out, decodeURIComponent(u.pathname.slice(1))],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
  if (result.status !== 0) { fs.existsSync(out) && fs.unlinkSync(out); throw bad(`pg_dump failed: ${result.stderr?.toString().slice(0, 300) || 'is PostgreSQL installed?'}`); }
  await audit(pool, req.session.userId, 'backup.create', null, null, { file: name });
  res.status(201).json({ name, size: fs.statSync(out).size });
}));

r.get('/backups/:name/download', ah(async (req, res) => {
  const name = path.basename(req.params.name);
  const p = path.join(backupDir, name);
  if (!fs.existsSync(p)) throw bad('Backup not found');
  res.download(p);
}));

// ---- Audit log view ----
r.get('/audit', ah(async (req, res) => {
  const { rows } = await q(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`);
  res.json(rows);
}));

module.exports = r;
