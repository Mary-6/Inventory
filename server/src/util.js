// Shared helpers: async wrapper, validation, audit logging.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);

function str(v, name, { required = false, max = 500 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  if (v.length > max) throw bad(`${name} too long`);
  return v.trim();
}
function int(v, name, { min = null, max = null, required = false, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return def;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  if (min !== null && n < min) throw bad(`${name} must be at least ${min}`);
  if (max !== null && n > max) throw bad(`${name} must be at most ${max}`);
  return n;
}
function money(v, name, opts = {}) { return int(v, name, { min: 0, ...opts }); }
function dateStr(v, name) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${name} must be YYYY-MM-DD`);
  return v;
}

async function audit(client, userId, action, subjectType, subjectId, meta) {
  await client.query(
    'INSERT INTO audit_logs(user_id, action, subject_type, subject_id, meta) VALUES($1,$2,$3,$4,$5)',
    [userId, action, subjectType, subjectId, meta ? JSON.stringify(meta) : null]
  );
}

// Record a signed stock change inside a transaction. Throws on insufficient stock.
async function moveStock(client, { productId, type, quantity, note, refType, refId, userId, updateCost }) {
  const r = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
  if (!r.rowCount) throw bad('Product not found');
  const p = r.rows[0];
  const after = p.stock_bottles + quantity;
  if (after < 0) throw bad(`Insufficient stock for "${p.name}" (${p.stock_bottles} bottles available)`);
  let costSql = '';
  const params = [after, productId];
  if (updateCost !== undefined) { costSql = ', cost_price=$3'; params.push(Math.round(updateCost)); }
  await client.query(`UPDATE products SET stock_bottles=$1, updated_at=now()${costSql} WHERE id=$2`, params);
  await client.query(
    'INSERT INTO stock_movements(product_id,type,quantity,stock_after,note,ref_type,ref_id,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [productId, type, quantity, after, note || null, refType || null, refId || null, userId || null]
  );
  return after;
}

const methodAcct = m => m === 'bank_transfer' ? '1010' : m === 'mobile_money' ? '1020' : '1000';

// Post a balanced journal entry inside a transaction.
// lines: [{account, debit?, credit?}]
async function postEntry(client, { description, refType, refId, userId, date, lines }) {
  const dr = lines.reduce((a, l) => a + (l.debit || 0), 0);
  const cr = lines.reduce((a, l) => a + (l.credit || 0), 0);
  if (dr !== cr || dr === 0) throw bad(`Unbalanced journal entry (${dr} DR / ${cr} CR)`);
  const e = await client.query(
    'INSERT INTO journal_entries(entry_date,description,ref_type,ref_id,user_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [date || new Date(), description, refType || null, refId || null, userId || null]);
  for (const l of lines) {
    if (!l.debit && !l.credit) continue;
    await client.query('INSERT INTO journal_lines(entry_id,account_code,debit,credit) VALUES($1,$2,$3,$4)',
      [e.rows[0].id, l.account, l.debit || 0, l.credit || 0]);
  }
  return e.rows[0].id;
}

module.exports = { ah, HttpError, bad, str, int, money, dateStr, audit, moveStock, postEntry, methodAcct };
