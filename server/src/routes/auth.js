const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { ah, str, bad, HttpError, audit } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();

r.post('/login', ah(async (req, res) => {
  const email = str(req.body.email, 'Email', { required: true }).toLowerCase();
  const password = str(req.body.password, 'Password', { required: true });
  const { rows } = await q('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    throw new HttpError(401, 'Invalid email or password');
  await new Promise((ok, no) => req.session.regenerate(e => e ? no(e) : ok()));
  req.session.userId = user.id;
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

r.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

r.get('/me', ah(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { rows } = await q('SELECT id,name,email,role FROM users WHERE id=$1', [req.session.userId]);
  res.json({ user: rows[0] || null });
}));

r.put('/password', requireAuth, ah(async (req, res) => {
  const current = str(req.body.current, 'Current password', { required: true });
  const next = str(req.body.next, 'New password', { required: true });
  if (next.length < 6) throw bad('New password must be at least 6 characters');
  const { rows } = await q('SELECT * FROM users WHERE id=$1', [req.session.userId]);
  if (!(await bcrypt.compare(current, rows[0].password_hash))) throw bad('Current password is incorrect');
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(next, 10), req.session.userId]);
  res.json({ ok: true });
}));

module.exports = r;
