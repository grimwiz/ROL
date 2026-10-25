const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const generated = crypto.randomBytes(48).toString('base64url');
  console.warn('WARNING: JWT_SECRET not set. Generated an ephemeral signing secret for this process; all sessions will be invalidated on restart.');
  return generated;
})();

const COOKIE_NAME = 'folly_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000 // 8 hours
};

function signToken(user) {
  return jwt.sign({ id: user.id, authVersion: authVersion(user.password_hash) }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h' });
}

// Bind sessions to the current credentials without putting the password hash in
// a readable JWT. A password reset invalidates every token issued before it.
function authVersion(passwordHash) {
  return crypto.createHmac('sha256', JWT_SECRET).update(passwordHash).digest('base64url');
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: undefined });
    return res.status(401).json({ error: 'Session expired' });
  }
  const user = Number.isSafeInteger(claims.id)
    ? require('./db').prepare('SELECT id, username, role, password_hash FROM users WHERE id = ?').get(claims.id)
    : null;
  if (!user || claims.authVersion !== authVersion(user.password_hash)) {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: undefined });
    return res.status(401).json({ error: 'Session expired' });
  }
  // Always use the live role: demotion and deletion take effect immediately.
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

function requireGM(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'gm') return res.status(403).json({ error: 'GM access required' });
    next();
  });
}

module.exports = { signToken, requireAuth, requireGM, COOKIE_NAME, COOKIE_OPTS };
