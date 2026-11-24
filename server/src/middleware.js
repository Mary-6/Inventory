const { HttpError } = require('./util');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return next(new HttpError(401, 'Authentication required'));
}

// Lightweight CSRF protection for the session-cookie API:
// mutating requests must send the X-Requested-With header (set by axios).
function csrfGuard(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();
  if (req.get('X-Requested-With') === 'fetch') return next();
  return next(new HttpError(403, 'Invalid request origin'));
}

module.exports = { requireAuth, csrfGuard };
