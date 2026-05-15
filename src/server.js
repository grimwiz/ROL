const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.disable('x-powered-by');
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === undefined || trustProxy === '') app.set('trust proxy', 1);
else if (/^\d+$/.test(trustProxy)) app.set('trust proxy', Number(trustProxy));
else if (/^(true|false)$/i.test(trustProxy)) app.set('trust proxy', /^true$/i.test(trustProxy));
else app.set('trust proxy', trustProxy);

// Portrait data URLs can push a single sheet well past the default 100KB limit;
// 20MB is plenty for a JPEG/PNG of a reasonable subject and leaves headroom for
// the rest of the sheet JSON.
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/rules-files', requireAuth, express.static(path.join(__dirname, '..', 'Rivers_of_London')));

app.use('/api', require('./routes'));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  // Surface body-parser failures (oversized payload, malformed JSON) with their
  // real status so the client can show something more useful than "Internal  // server error". Everything else still becomes a generic 500.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Upload too large. Try a smaller image.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body.' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`The Folly case files running on ${HOST}:${PORT}`);

  // Create default GM account if no users exist
  const db = require('./db');
  const { seedGlobalNpcs } = require('./npcSeed');
  try { seedGlobalNpcs(db); } catch (e) { console.error(`NPC seeding failed: ${e.message}`); }
  const bcrypt = require('bcryptjs');
  const existing = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (existing.n === 0) {
    const buildBootstrapPassword = () => {
      if (process.env.GM_INITIAL_PASSWORD) return process.env.GM_INITIAL_PASSWORD;
      const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const lower = 'abcdefghijklmnopqrstuvwxyz';
      const digits = '0123456789';
      const all = upper + lower + digits;
      const take = (chars) => chars[crypto.randomInt(chars.length)];
      const chars = [
        take(upper),
        take(lower),
        take(digits)
      ];
      while (chars.length < 24) chars.push(take(all));
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      return chars.join('');
    };
    const bootstrapPassword = buildBootstrapPassword();
    const hash = bcrypt.hashSync(bootstrapPassword, 12);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('gm', ?, 'gm')").run(hash);
    console.log(`Default GM account created — username: gm, password: ${bootstrapPassword}`);
    console.log('IMPORTANT: Store this password securely and change it immediately via the GM settings panel.');
  }
});
