const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { signToken, requireAuth, requireGM, COOKIE_NAME, COOKIE_OPTS } = require('./auth');
const { loadDomesticAdventure } = require('./domesticAdventure');

const router = express.Router();
const DOMESTIC_SYSTEM_DESCRIPTION = '__SYSTEM_DOMESTIC__';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS_PER_IP = 25;
const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 8;
const loginAttemptStore = new Map();

function normaliseLoginName(username) {
  return String(username || '').trim().toLowerCase();
}

function loginStoreKey(kind, value) {
  return `${kind}:${value}`;
}

function getClientAddress(req) {
  return String(req.ip || req.connection?.remoteAddress || 'unknown');
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, entry] of loginAttemptStore.entries()) {
    const recent = entry.filter((ts) => now - ts < LOGIN_WINDOW_MS);
    if (recent.length) loginAttemptStore.set(key, recent);
    else loginAttemptStore.delete(key);
  }
}

function recordLoginFailure(req, username) {
  const now = Date.now();
  pruneLoginAttempts(now);
  const ipKey = loginStoreKey('ip', getClientAddress(req));
  const accountKey = loginStoreKey('acct', `${getClientAddress(req)}|${normaliseLoginName(username)}`);
  [ipKey, accountKey].forEach((key) => {
    const attempts = loginAttemptStore.get(key) || [];
    attempts.push(now);
    loginAttemptStore.set(key, attempts);
  });
}

function clearLoginFailures(req, username) {
  const ipKey = loginStoreKey('ip', getClientAddress(req));
  const accountKey = loginStoreKey('acct', `${getClientAddress(req)}|${normaliseLoginName(username)}`);
  loginAttemptStore.delete(accountKey);
  const ipAttempts = (loginAttemptStore.get(ipKey) || []).filter(Boolean);
  if (ipAttempts.length <= 1) loginAttemptStore.delete(ipKey);
  else loginAttemptStore.set(ipKey, ipAttempts.slice(0, -1));
}

function getRetryAfterMs(req, username) {
  const now = Date.now();
  pruneLoginAttempts(now);
  const ipKey = loginStoreKey('ip', getClientAddress(req));
  const accountKey = loginStoreKey('acct', `${getClientAddress(req)}|${normaliseLoginName(username)}`);
  const ipAttempts = loginAttemptStore.get(ipKey) || [];
  const accountAttempts = loginAttemptStore.get(accountKey) || [];
  if (ipAttempts.length >= LOGIN_MAX_ATTEMPTS_PER_IP) {
    return LOGIN_WINDOW_MS - (now - ipAttempts[0]);
  }
  if (accountAttempts.length >= LOGIN_MAX_ATTEMPTS_PER_ACCOUNT) {
    return LOGIN_WINDOW_MS - (now - accountAttempts[0]);
  }
  return 0;
}

function getDomesticSystemSession() {
  return db.prepare('SELECT * FROM sessions WHERE description = ? ORDER BY id LIMIT 1').get(DOMESTIC_SYSTEM_DESCRIPTION);
}

function getNamedDomesticSession() {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE name = ? COLLATE NOCASE
    ORDER BY CASE WHEN description = ? THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get('The Domestic', DOMESTIC_SYSTEM_DESCRIPTION);
}

function ensureDomesticSystemSession() {
  let session = getNamedDomesticSession() || getDomesticSystemSession();
  if (session) return session;
  const result = db.prepare('INSERT INTO sessions (name, description) VALUES (?, ?)').run('The Domestic', DOMESTIC_SYSTEM_DESCRIPTION);
  session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
  return session;
}

function getDomesticSheetRow(userId) {
  let session = db.prepare(`
    SELECT s.* FROM sessions s
    JOIN character_sheets cs ON cs.session_id = s.id
    WHERE cs.user_id = ? AND s.name = ? COLLATE NOCASE
    ORDER BY CASE WHEN s.description = ? THEN 0 ELSE 1 END, s.id
    LIMIT 1
  `).get(userId, 'The Domestic', DOMESTIC_SYSTEM_DESCRIPTION);

  if (!session) session = ensureDomesticSystemSession();

  const sheet = db.prepare('SELECT * FROM character_sheets WHERE session_id = ? AND user_id = ?').get(session.id, userId);
  return { session, sheet };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const retryAfterMs = getRetryAfterMs(req, username);
  if (retryAfterMs > 0) {
    const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.set('Retry-After', String(retrySeconds));
    return res.status(429).json({ error: `Too many login attempts. Try again in ${retrySeconds} seconds.` });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    recordLoginFailure(req, username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    recordLoginFailure(req, username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  clearLoginFailures(req, username);
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
      WHERE COALESCE(s.description, '') != ?
      GROUP BY s.id ORDER BY s.created_at DESC
    `).all(DOMESTIC_SYSTEM_DESCRIPTION);
  } else {
    sessions = db.prepare(`
      SELECT s.* FROM sessions s
      JOIN session_players sp ON s.id = sp.session_id
      WHERE sp.user_id = ? AND COALESCE(s.description, '') != ? ORDER BY s.created_at DESC
    `).all(req.user.id, DOMESTIC_SYSTEM_DESCRIPTION);
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


router.get('/adventure/domestic', requireAuth, (req, res) => {
  const adventure = loadDomesticAdventure();
  if (!adventure) {
    return res.status(404).json({ error: 'The Domestic adventure markdown is not available on the server.' });
  }
  res.json(adventure);
});

router.get('/adventure/domestic/progress', requireAuth, (req, res) => {
  const row = db.prepare('SELECT current_step, updated_at FROM domestic_progress WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ current_step: null });
  res.json(row);
});

router.put('/adventure/domestic/progress', requireAuth, (req, res) => {
  const adventure = loadDomesticAdventure();
  if (!adventure) {
    return res.status(404).json({ error: 'The Domestic adventure markdown is not available on the server.' });
  }
  const currentStep = parseInt(req.body && req.body.current_step, 10);
  if (!Number.isInteger(currentStep)) {
    return res.status(400).json({ error: 'A valid adventure step is required.' });
  }
  const exists = adventure.steps.some((step) => step.step === currentStep);
  if (!exists) {
    return res.status(400).json({ error: 'That adventure step does not exist.' });
  }
  db.prepare(`
    INSERT INTO domestic_progress (user_id, current_step, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET current_step = excluded.current_step, updated_at = excluded.updated_at
  `).run(req.user.id, currentStep);
  res.json({ ok: true, current_step: currentStep });
});

router.get('/adventure/domestic/sheet', requireAuth, (req, res) => {
  const { session, sheet } = getDomesticSheetRow(req.user.id);
  if (!sheet) return res.json({ session_id: session.id, data: {} });
  res.json({ ...sheet, session_id: session.id, data: JSON.parse(sheet.data) });
});

router.put('/adventure/domestic/sheet', requireAuth, (req, res) => {
  const session = ensureDomesticSystemSession();
  const data = JSON.stringify(req.body.data || {});
  db.prepare(`
    INSERT INTO character_sheets (session_id, user_id, data, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(session.id, req.user.id, data);
  res.json({ ok: true, session_id: session.id });
});

router.delete('/adventure/domestic/sheet', requireAuth, (req, res) => {
  const session = ensureDomesticSystemSession();
  db.prepare('DELETE FROM character_sheets WHERE session_id = ? AND user_id = ?').run(session.id, req.user.id);
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

// ── Portrait proxy (ComfyUI + PhotoMaker) ─────────────────────────────────────
//
// The browser can't reach the ComfyUI server directly (it's LAN-only HTTP, and
// mixed-content rules would block HTTPS→HTTP fetches anyway). These endpoints
// forward the four requests the portrait test page needs through the Folly
// server over its authenticated HTTPS origin.
//
// Configure with COMFYUI_URL env var (default: http://192.168.37.51:8188).

const COMFYUI_URL = (process.env.COMFYUI_URL || 'http://192.168.37.51:8188').replace(/\/+$/, '');
const PORTRAIT_NEGATIVE_PROMPT = 'lowres, blurry, distorted face, text, watermark, signature, extra fingers, photographic, 3d render, cgi, low quality';
const PORTRAIT_WORKFLOW_TEMPLATE = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'aZovyaRPGArtistTools_v4VAE.safetensors' } },
  '2': { class_type: 'LoadImage', inputs: { image: 'portrait_input.jpg' } },
  '3': { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['1', 2] } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: PORTRAIT_NEGATIVE_PROMPT } },
  '6': { class_type: 'KSampler', inputs: {
    model: ['1', 0], seed: 42, steps: 28, cfg: 5.5,
    sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 0.5,
    positive: ['4', 0], negative: ['5', 0], latent_image: ['3', 0]
  } },
  '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
  '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'ROL_portrait' } }
};

function cleanPortraitText(value, maxLen = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function inferPortraitSubject(pronouns) {
  const p = cleanPortraitText(pronouns, 60).toLowerCase();
  if (/\b(she|her|hers)\b/.test(p)) return 'woman';
  if (/\b(he|him|his)\b/.test(p)) return 'man';
  return 'person';
}

function parseAdvantagesText(value) {
  return String(value || '')
    .split(',')
    .map((part) => cleanPortraitText(part, 80))
    .filter(Boolean);
}

function collectPortraitSkillDetails(sheet) {
  const defaults = new Map([
    ['athletics', 30],
    ['drive', 30],
    ['navigate', 30],
    ['observation', 30],
    ['read person', 30],
    ['research', 30],
    ['sense vestigia', 30],
    ['social', 30],
    ['stealth', 30],
    ['fighting', 30],
    ['firearms', 30]
  ]);
  const skills = [];
  const pushSkill = (item) => {
    const name = cleanPortraitText(item && item.name, 60);
    const value = parseInt(item && item.value, 10);
    if (!name || !Number.isFinite(value) || value <= 0) return;
    const baseline = defaults.has(name.toLowerCase()) ? defaults.get(name.toLowerCase()) : 0;
    if (value <= baseline) return;
    skills.push({ name, value });
  };
  []
    .concat(Array.isArray(sheet.common_skills) ? sheet.common_skills : [])
    .concat(Array.isArray(sheet.combat_skills) ? sheet.combat_skills : [])
    .concat(Array.isArray(sheet.mandatory_skills) ? sheet.mandatory_skills : [])
    .concat(Array.isArray(sheet.additional_skills) ? sheet.additional_skills : [])
    .forEach(pushSkill);
  skills.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return skills.slice(0, 3).map((skill) => `${skill.name} ${skill.value}%`);
}

function collectPortraitWeaponNames(sheet) {
  return (Array.isArray(sheet.weapons) ? sheet.weapons : [])
    .map((weapon) => cleanPortraitText(weapon && weapon.name, 60))
    .filter(Boolean)
    .slice(0, 2);
}

function buildPortraitPromptFromSheet(sheet) {
  const subject = inferPortraitSubject(sheet.pronouns);
  const occupation = cleanPortraitText(sheet.occupation, 80) || 'investigator';
  const age = cleanPortraitText(sheet.age, 20);
  const socialClass = cleanPortraitText(sheet.social_class, 80);
  const reputation = cleanPortraitText(sheet.reputation, 120);
  const tradition = cleanPortraitText(sheet.magic_tradition, 80);
  const notableSkills = collectPortraitSkillDetails(sheet);
  const weaponNames = collectPortraitWeaponNames(sheet);
  const advantages = parseAdvantagesText(sheet.advantages);
  const magical = advantages.some((adv) => /^magical\b/i.test(adv)) || !!tradition
    || (Array.isArray(sheet.magic_spells) && sheet.magic_spells.some((spell) => cleanPortraitText(spell && spell.name, 80)));

  const descriptors = [occupation];
  if (age) descriptors.push(`${age} years old`);
  if (socialClass) descriptors.push(socialClass);
  if (reputation) descriptors.push(reputation);
  if (magical && tradition) descriptors.push(`subtle signs of ${tradition} magic`);
  else if (magical) descriptors.push('subtle signs of magic');
  if (advantages.length) descriptors.push(advantages.slice(0, 2).join(' and ').toLowerCase());
  if (notableSkills.length) descriptors.push(`known for ${notableSkills.join(', ')}`);
  if (weaponNames.length) descriptors.push(`equipped with ${weaponNames.join(' and ')}`);

  return `head-and-shoulders portrait of a ${subject}, ${descriptors.join(', ')}, `
    + 'contemporary London setting, Alphonse Mucha art nouveau style, painterly linework, '
    + 'decorative halo and floral border motifs, muted earthy palette with a single accent colour, '
    + 'soft flat lighting, serious expression, three-quarters view, illustration, no text, no watermark';
}

// Upload a source photo. The browser POSTs multipart/form-data here; we stream
// the body straight through to ComfyUI's /upload/image without parsing it.
router.post('/portrait/upload', requireAuth, async (req, res, next) => {
  try {
    const headers = { 'content-type': req.headers['content-type'] || 'application/octet-stream' };
    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

    const upstream = await fetch(`${COMFYUI_URL}/upload/image`, {
      method: 'POST',
      headers,
      body: req,
      duplex: 'half'
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(buf);
  } catch (e) { next(e); }
});

// Queue a tightly-controlled portrait workflow on ComfyUI. The browser may
// provide sheet fields plus the uploaded image name, but not arbitrary node
// graphs or raw prompts.
router.post('/portrait/prompt', requireAuth, async (req, res, next) => {
  try {
    const imageName = path.basename(cleanPortraitText(req.body && req.body.image, 160));
    if (!imageName) {
      return res.status(400).json({ error: 'Uploaded image name is required.' });
    }
    const sheet = (req.body && typeof req.body.sheet === 'object' && req.body.sheet) || {};
    const workflow = JSON.parse(JSON.stringify(PORTRAIT_WORKFLOW_TEMPLATE));
    workflow['2'].inputs.image = imageName;
    workflow['4'].inputs.text = buildPortraitPromptFromSheet(sheet);
    workflow['6'].inputs.seed = Math.floor(Math.random() * 2 ** 31);

    const upstream = await fetch(`${COMFYUI_URL}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });
    const text = await upstream.text();
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(text);
  } catch (e) { next(e); }
});

// Poll for completion of a queued prompt.
router.get('/portrait/history/:id', requireAuth, async (req, res, next) => {
  try {
    const upstream = await fetch(`${COMFYUI_URL}/history/${encodeURIComponent(req.params.id)}`);
    const text = await upstream.text();
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(text);
  } catch (e) { next(e); }
});

// Fetch a generated image. Streams bytes straight through.
router.get('/portrait/view', requireAuth, async (req, res, next) => {
  try {
    const url = new URL(`${COMFYUI_URL}/view`);
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') url.searchParams.set(k, v);
    }
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).send(await upstream.text());
    }
    res.status(200).type(upstream.headers.get('content-type') || 'application/octet-stream');
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) { next(e); }
});

module.exports = router;
