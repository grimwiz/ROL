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
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Session expired' });
  }
}

function requireGM(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'gm') return res.status(403).json({ error: 'GM access required' });
    next();
  });
}

module.exports = { signToken, requireAuth, requireGM, COOKIE_NAME, COOKIE_OPTS };
