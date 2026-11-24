const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT now())`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM _migrations WHERE name=$1', [file]);
    if (done.rowCount) { console.log('skip', file); continue; }
    console.log('run ', file);
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO _migrations(name) VALUES($1)', [file]);
  }
  await pool.end();
  console.log('migrations complete');
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
