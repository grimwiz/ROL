const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { signToken, requireAuth, requireGM, COOKIE_NAME, COOKIE_OPTS } = require('./auth');

const router = express.Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ id: user.id, username: user.username, role: user.role });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// ── Users (GM only) ───────────────────────────────────────────────────────────

router.get('/users', requireGM, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username').all();
  res.json(users);
});

router.post('/users', requireGM, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role required' });
  if (!['gm', 'player'].includes(role)) return res.status(400).json({ error: 'role must be gm or player' });

  const hash = await bcrypt.hash(password, 12);
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    res.status(201).json({ id: result.lastInsertRowid, username, role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.put('/users/:id/password', requireGM, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

router.delete('/users/:id', requireGM, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get('/sessions', requireAuth, (req, res) => {
  let sessions;
  if (req.user.role === 'gm') {
    sessions = db.prepare(`
      SELECT s.*, COUNT(sp.user_id) as player_count
      FROM sessions s
      LEFT JOIN session_players sp ON s.id = sp.session_id
      GROUP BY s.id ORDER BY s.created_at DESC
    `).all();
  } else {
    sessions = db.prepare(`
      SELECT s.* FROM sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE sp.user_id = ? ORDER BY s.created_at DESC
    `).all(req.user.id);
  }
  res.json(sessions);
});

router.post('/sessions', requireGM, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO sessions (name, description) VALUES (?, ?)').run(name, description || null);
  res.status(201).json({ id: result.lastInsertRowid, name, description });
});

router.put('/sessions/:id', requireGM, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('UPDATE sessions SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

router.delete('/sessions/:id', requireGM, (req, res) => {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

// Session player assignments

router.get('/sessions/:id/players', requireAuth, (req, res) => {
  const sessionId = req.params.id;
  if (req.user.role !== 'gm') {
    const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Not assigned to this session' });
  }
  const players = db.prepare(`
    SELECT u.id, u.username FROM users u
    JOIN session_players sp ON u.id = sp.user_id
    WHERE sp.session_id = ? ORDER BY u.username
  `).all(sessionId);
  res.json(players);
});

router.post('/sessions/:id/players', requireGM, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    db.prepare('INSERT INTO session_players (session_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Player already assigned' });
    if (e.message.includes('FOREIGN KEY')) return res.status(404).json({ error: 'Session or user not found' });
    throw e;
  }
});

router.delete('/sessions/:id/players/:userId', requireGM, (req, res) => {
  db.prepare('DELETE FROM session_players WHERE session_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// ── Character Sheets ──────────────────────────────────────────────────────────

router.get('/sessions/:id/sheets', requireAuth, (req, res) => {
  const sessionId = req.params.id;
  if (req.user.role !== 'gm') {
    const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Not assigned to this session' });
  }
  const sheets = db.prepare(`
    SELECT cs.id, cs.user_id, cs.updated_at, u.username, cs.data
    FROM character_sheets cs
    JOIN users u ON cs.user_id = u.id
    WHERE cs.session_id = ? ORDER BY u.username
  `).all(sessionId);
  res.json(sheets.map(s => ({ ...s, data: JSON.parse(s.data) })));
});

router.get('/sessions/:sessionId/sheets/:userId', requireAuth, (req, res) => {
  const { sessionId, userId } = req.params;
  if (req.user.role !== 'gm' && req.user.id !== parseInt(userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const sheet = db.prepare('SELECT * FROM character_sheets WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  if (!sheet) return res.json({ data: {} });
  res.json({ ...sheet, data: JSON.parse(sheet.data) });
});

router.put('/sessions/:sessionId/sheets/:userId', requireAuth, (req, res) => {
  const { sessionId, userId } = req.params;
  if (req.user.role !== 'gm' && req.user.id !== parseInt(userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  if (!assigned) return res.status(403).json({ error: 'Player not assigned to this session' });

  const data = JSON.stringify(req.body.data || {});
  db.prepare(`
    INSERT INTO character_sheets (session_id, user_id, data, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(sessionId, userId, data);
  res.json({ ok: true });
});

// ── Rules library ────────────────────────────────────────────────────────────

const rulesRoot = path.join(__dirname, '..', 'Rivers_of_London');
const rulesBaseName = 'cha3200_-_rivers_of_london_1.4';
const rulesMdPath = path.join(rulesRoot, `${rulesBaseName}.md`);
const rulesHtmlPath = path.join(rulesRoot, `${rulesBaseName}.html`);

function loadRulesIndex() {
  if (!fs.existsSync(rulesMdPath) || !fs.existsSync(rulesHtmlPath)) {
    return null;
  }

  const markdown = fs.readFileSync(rulesMdPath, 'utf8');
  const lines = markdown.split(/\r?\n/);
  return {
    markdown,
    lines,
    htmlPath: `/rules-files/${rulesBaseName}.html`,
    markdownPath: `/rules-files/${rulesBaseName}.md`
  };
}

router.get('/rules', requireAuth, (req, res) => {
  const rulesIndex = loadRulesIndex();
  if (!rulesIndex) {
    return res.status(404).json({ error: 'Rules files are not available on the server.' });
  }
  res.json({
    files: {
      html: rulesIndex.htmlPath,
      markdown: rulesIndex.markdownPath
    }
  });
});

router.get('/rules/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Search query is required.' });

  const rulesIndex = loadRulesIndex();
  if (!rulesIndex) {
    return res.status(404).json({ error: 'Rules files are not available on the server.' });
  }

  const qLower = q.toLowerCase();
  const maxResults = 25;
  const contextRadius = 1;
  const results = [];

  for (let i = 0; i < rulesIndex.lines.length && results.length < maxResults; i += 1) {
    const line = rulesIndex.lines[i];
    if (!line.toLowerCase().includes(qLower)) continue;

    const title = line.replace(/^#+\s*/, '').trim() || `Line ${i + 1}`;
    const snippetStart = Math.max(0, i - contextRadius);
    const snippetEnd = Math.min(rulesIndex.lines.length - 1, i + contextRadius);
    const snippet = rulesIndex.lines
      .slice(snippetStart, snippetEnd + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    results.push({
      line: i + 1,
      title,
      snippet: snippet.length > 300 ? `${snippet.slice(0, 297)}...` : snippet
    });
  }

  res.json({
    query: q,
    count: results.length,
    results,
    files: {
      html: rulesIndex.htmlPath,
      markdown: rulesIndex.markdownPath
    }
  });
});

module.exports = router;
