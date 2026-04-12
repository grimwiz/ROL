const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', require('./routes'));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`The Folly case files running on port ${PORT}`);

  // Create default GM account if no users exist
  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const existing = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (existing.n === 0) {
    const defaultPassword = process.env.GM_INITIAL_PASSWORD || 'changeme123';
    const hash = bcrypt.hashSync(defaultPassword, 12);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('gm', ?, 'gm')").run(hash);
    console.log(`Default GM account created — username: gm, password: ${defaultPassword}`);
    console.log('IMPORTANT: Change this password immediately via the GM settings panel.');
  }
});
