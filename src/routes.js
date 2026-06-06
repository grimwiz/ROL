const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./db');
const { signToken, requireAuth, requireGM, COOKIE_NAME, COOKIE_OPTS } = require('./auth');
const { loadDomesticAdventure } = require('./domesticAdventure');
const {
  DATA_ROOT,
  findSessionCover,
  ensureSessionDataFolderById,
  renameSessionDataFolder,
  loadSessionScenarioInfoForUser,
  readSessionSources,
  writeSessionSources,
  refreshScenarioIndexes,
  regenerateScenarioSection,
  regenerateScenarioSections,
  revertScenarioSection,
  resolveSessionAssetPath,
  regenerateNpcSummaries,
  streamGmChat,
  streamRulesChat,
  listNpcPersonas,
  resolveNpcPersona,
  seedNpcPersonaIntoCase,
  streamNpcChat,
  writeGmChatExport,
  ollamaStatus,
  cancelOllama,
  isCloudLlm,
  saveSessionHandout,
  setSessionAssetVisibility,
  createSessionFile,
  replaceSessionFile,
  renameSessionFile,
  deleteSessionFile,
  saveSessionFilePrompt,
  generateEntityImagePrompt,
  effectiveOllamaModel,
  setOllamaModel,
  ollamaContextConfig,
  setOllamaNumCtx,
  listOllamaModels,
  listOllamaModelsDetailed,
  ollamaPs,
  freeOllama,
  effectiveComfyuiUrl,
  effectiveWhisperxUrl,
  readCharacterPersonality,
  writeCharacterPersonality,
  readCaseGlossaryTerms,
  readCaseKeyNpcs,
  revertSeededFile,
  loadVoiceRegistry,
  saveVoiceRegistry,
  matchVoice,
  setVoiceCharacter,
  mergeVoice,
  deleteVoice,
  listVoices,
  liveBufferState,
  liveBufferReset,
  liveBufferAppend,
  liveBufferAdvanceCursor,
  liveBufferWindowWav,
  setServiceUrl,
  servicesConfig,
  effectiveBoostAlpha,
  setBoostAlpha,
  effectiveComfyuiImageModel,
  effectiveComfyuiEditModel,
  setComfyuiModel,
  comfyModelsConfig
} = require('./scenarioInfo');
const sessionRolls = require('./sessionRolls');
const { resetCanonicalCase } = require('./canonicalContent');
const { buildPdf } = require('../scripts/export-character-sheet');
const { sheetScope, sheetHasCase, addCaseToScope, scopeNameKey } = require('./characterScope');

const router = express.Router();
const DOMESTIC_SYSTEM_DESCRIPTION = '__SYSTEM_DOMESTIC__';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS_PER_IP = 25;
const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 8;
const loginAttemptStore = new Map();
const ALLOWED_DICE_FORMULAS = new Set([
  '1d100',
  '2d10+50',
  '1d20',
  '1d12',
  '1d10',
  '1d8',
  '1d6',
  '1d4'
]);

function normaliseLoginName(username) {
  return String(username || '').trim().toLowerCase();
}

function loginStoreKey(kind, value) {
  return `${kind}:${value}`;
}

function getClientAddress(req) {
  return String(req.ip || req.connection?.remoteAddress || 'unknown');
}

function toSingleLineLogValue(value, maxLen = 500) {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text;
  if (typeof value === 'string') text = value;
  else text = JSON.stringify(value);
  if (text.length > maxLen) text = `${text.slice(0, maxLen - 3)}...`;
  return JSON.stringify(text);
}

function logLine(tag, fields) {
  const parts = Object.entries(fields || {})
    .map(([key, value]) => {
      const rendered = toSingleLineLogValue(value);
      return rendered === null ? null : `${key}=${rendered}`;
    })
    .filter(Boolean);
  console.info(`[${tag}]${parts.length ? ` ${parts.join(' ')}` : ''}`);
}

function logAudit(event, details) {
  logLine(`audit.${event}`, details);
}

function parseStoredSheetData(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function getSessionNameById(sessionId) {
  const row = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId);
  return row ? row.name : null;
}

function getUsernameById(userId) {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  return row ? row.username : null;
}

function summarizeSheetData(data) {
  const sheet = data && typeof data === 'object' ? data : {};
  const advantages = String(sheet.advantages || '')
    .split(/,|;|\n|\band\b/gi)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return {
    name: String(sheet.name || '').trim() || null,
    occupation: String(sheet.occupation || '').trim() || null,
    age: String(sheet.age || '').trim() || null,
    hasPortrait: !!String(sheet.portrait || '').trim(),
    advantagesCount: advantages.length,
    weaponCount: Array.isArray(sheet.weapons) ? sheet.weapons.filter((weapon) => weapon && Object.values(weapon).some(Boolean)).length : 0,
    spellCount: Array.isArray(sheet.magic_spells) ? sheet.magic_spells.filter((spell) => spell && Object.values(spell).some(Boolean)).length : 0
  };
}

function listChangedSheetFields(previousData, nextData) {
  const previous = previousData && typeof previousData === 'object' ? previousData : {};
  const next = nextData && typeof nextData === 'object' ? nextData : {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys]
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null))
    .sort();
}

function parseDiceFormula(formula) {
  const match = String(formula || '').trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = parseInt(match[3] || '0', 10);
  if (!Number.isInteger(count) || !Number.isInteger(sides) || !Number.isInteger(modifier)) return null;
  if (count < 1 || count > 20) return null;
  if (sides < 2 || sides > 1000) return null;
  if (Math.abs(modifier) > 1000) return null;
  return { count, sides, modifier };
}

function rollDiceFormula(formula) {
  const normalized = String(formula || '').trim().toLowerCase();
  if (!ALLOWED_DICE_FORMULAS.has(normalized)) return null;
  const parsed = parseDiceFormula(normalized);
  if (!parsed) return null;
  const rolls = [];
  for (let i = 0; i < parsed.count; i += 1) {
    rolls.push(crypto.randomInt(1, parsed.sides + 1));
  }
  return {
    formula: normalized,
    rolls,
    modifier: parsed.modifier,
    total: rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier
  };
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

// Find the character sheet a user owns that is scoped to the given case name.
// Returns the raw character_sheets row (data still JSON) or null.
function findUserSheetInCase(userId, caseName) {
  const rows = db.prepare('SELECT * FROM character_sheets WHERE user_id = ?').all(userId);
  for (const row of rows) {
    const data = parseStoredSheetData(row.data);
    if (sheetHasCase(data, caseName)) return row;
  }
  return null;
}

// Resolve a scope array of case names to {id, name} session rows. Names match
// case-insensitively; entries that don't resolve to a known session are dropped.
function sessionsForScope(scope) {
  if (!Array.isArray(scope) || !scope.length) return [];
  const all = db.prepare('SELECT id, name FROM sessions').all();
  const byKey = new Map();
  for (const s of all) byKey.set(scopeNameKey(s.name), s);
  const out = [];
  const seen = new Set();
  for (const name of scope) {
    const key = scopeNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match = byKey.get(key);
    if (match) out.push(match);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

function getAccessibleSession(req, res, sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND COALESCE(description, \'\') != ?').get(sessionId, DOMESTIC_SYSTEM_DESCRIPTION);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  if (req.user.role !== 'gm') {
    const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!assigned) {
      res.status(403).json({ error: 'Not assigned to this session' });
      return null;
    }
  }
  return session;
}

function cleanOptionalText(value, maxLen = 10000) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLen) : null;
}

function setUserSessions(userId, sessionIds) {
  if (!Array.isArray(sessionIds)) return;
  const valid = db.prepare("SELECT id FROM sessions WHERE id = ? AND COALESCE(description, '') != ?");
  const ids = [...new Set(sessionIds.map((v) => parseInt(v, 10)).filter(Number.isInteger))]
    .filter((id) => valid.get(id, DOMESTIC_SYSTEM_DESCRIPTION));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_players WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR IGNORE INTO session_players (session_id, user_id) VALUES (?, ?)');
    for (const id of ids) ins.run(id, userId);
  });
  tx();
}

// Convert a character_sheets row into the API shape used by the unified
// Characters tab. owner='NPC' when user_id IS NULL, otherwise 'player'.
function rowToCharacter(row) {
  const data = parseStoredSheetData(row.data);
  const scope = sheetScope(data);
  const sessions = sessionsForScope(scope);
  const isNpc = row.user_id == null;
  return {
    id: row.id,
    user_id: isNpc ? null : row.user_id,
    owner: isNpc ? 'NPC' : 'player',
    name: String(data.name || '').trim(),
    sheet: data,
    scope,
    sessions,
    session_ids: sessions.map((s) => s.id),
    updated_at: row.updated_at
  };
}

// Parse a character-sheet create/update body. Accepts either a full `data`
// object or the legacy NPC shape (top-level name/role/status/etc + nested
// `sheet`). The result always has a single merged `data` object.
function readCharacterPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  let data;
  if (payload.data && typeof payload.data === 'object') {
    data = { ...payload.data };
  } else if (payload.sheet && typeof payload.sheet === 'object') {
    data = { ...payload.sheet };
  } else {
    data = {};
  }
  if (payload.name != null) {
    const name = cleanOptionalText(payload.name, 200);
    if (name) data.name = name;
  }
  for (const k of ['role', 'status', 'location']) {
    if (payload[k] != null) {
      const v = cleanOptionalText(payload[k], k === 'location' ? 300 : 200);
      if (v != null) data[k] = v;
    }
  }
  if (payload.summary != null) {
    const v = cleanOptionalText(payload.summary, 3000);
    if (v != null) data.summary = v;
  }
  if (payload.notes != null) {
    const v = cleanOptionalText(payload.notes, 10000);
    if (v != null) data.notes = v;
  }
  // The caller may pass scope/session_ids explicitly; otherwise we surface the
  // omission so an update route can preserve the existing row's scope rather
  // than wipe it. SheetForm.collect() never returns a scope field, so a sheet
  // save would otherwise silently drop the character off every case.
  let scopeExplicit = false;
  if (Array.isArray(payload.scope)) {
    data.scope = payload.scope.map((s) => String(s || '').trim()).filter(Boolean);
    scopeExplicit = true;
  } else if (Array.isArray(payload.session_ids)) {
    const ids = payload.session_ids.map((v) => parseInt(v, 10)).filter(Number.isInteger);
    data.scope = ids
      .map((id) => db.prepare('SELECT name FROM sessions WHERE id = ?').get(id))
      .filter(Boolean)
      .map((s) => s.name);
    scopeExplicit = true;
  }
  const name = String(data.name || '').trim();
  if (!name) return { error: 'name required' };
  data.name = name;
  const json = JSON.stringify(data);
  if (json.length > 200000) return { error: 'sheet too large' };
  return { data, json, scopeExplicit };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const retryAfterMs = getRetryAfterMs(req, username);
  if (retryAfterMs > 0) {
    const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    logAudit('login.blocked', {
      username: normaliseLoginName(username),
      ip: getClientAddress(req),
      retryAfterSeconds: retrySeconds
    });
    res.set('Retry-After', String(retrySeconds));
    return res.status(429).json({ error: `Too many login attempts. Try again in ${retrySeconds} seconds.` });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    recordLoginFailure(req, username);
    logAudit('login.failed', {
      username: normaliseLoginName(username),
      ip: getClientAddress(req),
      reason: 'invalid_credentials'
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    recordLoginFailure(req, username);
    logAudit('login.failed', {
      username: normaliseLoginName(username),
      ip: getClientAddress(req),
      userId: user.id,
      reason: 'invalid_credentials'
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  clearLoginFailures(req, username);
  logAudit('login.success', {
    userId: user.id,
    username: user.username,
    role: user.role,
    ip: getClientAddress(req)
  });
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
  const sessionsFor = db.prepare(`
    SELECT s.id, s.name
    FROM session_players sp
    JOIN sessions s ON s.id = sp.session_id
    WHERE sp.user_id = ? AND COALESCE(s.description, '') != ?
    ORDER BY s.name COLLATE NOCASE
  `);
  res.json(users.map((u) => {
    const sessions = sessionsFor.all(u.id, DOMESTIC_SYSTEM_DESCRIPTION);
    return { ...u, sessions, session_ids: sessions.map((s) => s.id) };
  }));
});

// Allocate a user to arbitrary cases (same model NPCs use).
router.put('/users/:id/sessions', requireGM, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  setUserSessions(user.id, (req.body && req.body.session_ids) || []);
  const sessions = db.prepare(`
    SELECT s.id, s.name FROM session_players sp
    JOIN sessions s ON s.id = sp.session_id
    WHERE sp.user_id = ? AND COALESCE(s.description, '') != ?
    ORDER BY s.name COLLATE NOCASE
  `).all(user.id, DOMESTIC_SYSTEM_DESCRIPTION);
  res.json({ ok: true, sessions, session_ids: sessions.map((s) => s.id) });
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

// ── Character sheets (GM only) ────────────────────────────────────────────────
// Generic CRUD for player and NPC sheets alike. NPCs are character_sheets rows
// with user_id IS NULL; players are owned by their own user row.
// Case membership lives inside data.scope, an array of case names.

function sessionIdsForScope(scope) {
  return sessionsForScope(scope).map((s) => s.id);
}

router.get('/character-sheets', requireGM, (req, res) => {
  const ownerFilter = String(req.query.owner || '').toLowerCase();
  let caseName = req.query.case ? String(req.query.case) : null;
  if (!caseName && req.query.case_id != null) {
    const id = parseInt(req.query.case_id, 10);
    if (Number.isInteger(id)) {
      const s = db.prepare('SELECT name FROM sessions WHERE id = ?').get(id);
      if (s) caseName = s.name;
    }
  }
  const where = [];
  const params = [];
  if (ownerFilter === 'npc') { where.push('user_id IS NULL'); }
  else if (ownerFilter === 'player') { where.push('user_id IS NOT NULL'); }
  const sql = `SELECT * FROM character_sheets${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
  let rows = db.prepare(sql).all(...params);
  if (caseName) rows = rows.filter((r) => sheetHasCase(parseStoredSheetData(r.data), caseName));
  // Stable, name-sorted output. Empty names sort last.
  rows.sort((a, b) => {
    const an = String(parseStoredSheetData(a.data).name || '').toLowerCase();
    const bn = String(parseStoredSheetData(b.data).name || '').toLowerCase();
    if (!an && bn) return 1;
    if (an && !bn) return -1;
    return an.localeCompare(bn);
  });
  res.json(rows.map(rowToCharacter));
});

router.get('/character-sheets/:id', requireGM, (req, res) => {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(rowToCharacter(row));
});

router.post('/character-sheets', requireGM, (req, res) => {
  const parsed = readCharacterPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  // owner: 'NPC' (default) → user_id IS NULL. 'player' → explicit user_id.
  const ownerHint = String(req.body && req.body.owner || 'NPC').toLowerCase();
  let ownerId;
  if (ownerHint === 'player') {
    const uid = parseInt(req.body && req.body.user_id, 10);
    if (!Number.isInteger(uid)) {
      return res.status(400).json({ error: 'user_id required for player character' });
    }
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) {
      return res.status(404).json({ error: 'User not found' });
    }
    ownerId = uid;
  } else {
    ownerId = null;
  }
  const result = db.prepare(
    "INSERT INTO character_sheets (user_id, data, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(ownerId, parsed.json);
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(result.lastInsertRowid);
  if (ownerId == null) {
    regenerateNpcSummaries(db, sessionIdsForScope(sheetScope(parsed.data)));
  }
  res.status(201).json(rowToCharacter(row));
});

router.put('/character-sheets/:id', requireGM, (req, res) => {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  const parsed = readCharacterPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const beforeScope = sheetScope(parseStoredSheetData(row.data));
  // Generic sheet saves don't carry scope (SheetForm.collect() omits it); use
  // the dedicated /scope route to change case allocations. Preserve the
  // existing scope here so a save doesn't drop the character off every case.
  if (!parsed.scopeExplicit) parsed.data.scope = beforeScope;
  const dataJson = JSON.stringify(parsed.data);
  db.prepare("UPDATE character_sheets SET data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(dataJson, req.params.id);
  const updated = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (updated.user_id == null) {
    const affected = [...new Set([...sessionIdsForScope(beforeScope), ...sessionIdsForScope(sheetScope(parsed.data))])];
    regenerateNpcSummaries(db, affected);
  }
  res.json(rowToCharacter(updated));
});

router.put('/character-sheets/:id/scope', requireGM, (req, res) => {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const data = parseStoredSheetData(row.data);
  const beforeScope = sheetScope(data);
  if (Array.isArray(body.scope)) {
    data.scope = body.scope.map((s) => String(s || '').trim()).filter(Boolean);
  } else if (Array.isArray(body.session_ids)) {
    const ids = body.session_ids.map((v) => parseInt(v, 10)).filter(Number.isInteger);
    data.scope = ids
      .map((id) => db.prepare('SELECT name FROM sessions WHERE id = ?').get(id))
      .filter(Boolean)
      .map((s) => s.name);
  } else {
    return res.status(400).json({ error: 'scope or session_ids required' });
  }
  db.prepare("UPDATE character_sheets SET data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(data), req.params.id);
  const updated = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (updated.user_id == null) {
    // For each newly-added case, copy this NPC's canonical personality file into
    // the case's player area if it isn't there yet.
    const beforeKeys = new Set(beforeScope.map((s) => String(s).toLowerCase()));
    const npcName = String(parseStoredSheetData(updated.data).name || '').trim();
    if (npcName) {
      for (const caseName of sheetScope(data)) {
        if (beforeKeys.has(String(caseName).toLowerCase())) continue;
        const caseRow = db.prepare('SELECT * FROM sessions WHERE name = ?').get(caseName);
        if (caseRow) {
          try { seedNpcPersonaIntoCase(caseRow, npcName); } catch { /* non-fatal */ }
        }
      }
    }
    const affected = [...new Set([...sessionIdsForScope(beforeScope), ...sessionIdsForScope(sheetScope(data))])];
    regenerateNpcSummaries(db, affected);
  }
  res.json(rowToCharacter(updated));
});

// Set or clear a character's owner. null = NPC (no owner). Switching from a
// player to NPC (or vice versa) re-fires the per-case NPC summary regen so the
// scenario file stays in sync.
router.put('/character-sheets/:id/owner', requireGM, (req, res) => {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  const raw = req.body && Object.prototype.hasOwnProperty.call(req.body, 'user_id') ? req.body.user_id : undefined;
  let nextUserId;
  if (raw === null || raw === '' || raw === undefined) {
    nextUserId = null;
  } else {
    const uid = parseInt(raw, 10);
    if (!Number.isInteger(uid)) return res.status(400).json({ error: 'user_id must be an integer or null' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) {
      return res.status(404).json({ error: 'User not found' });
    }
    nextUserId = uid;
  }
  db.prepare("UPDATE character_sheets SET user_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(nextUserId, req.params.id);
  const updated = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  const ownerChanged = (row.user_id == null) !== (nextUserId == null);
  if (ownerChanged) {
    regenerateNpcSummaries(db, sessionIdsForScope(sheetScope(parseStoredSheetData(updated.data))));
  }
  res.json(rowToCharacter(updated));
});

router.delete('/character-sheets/:id', requireGM, (req, res) => {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  const affectedSessionIds = row.user_id == null
    ? sessionIdsForScope(sheetScope(parseStoredSheetData(row.data)))
    : [];
  db.prepare('DELETE FROM character_sheets WHERE id = ?').run(req.params.id);
  if (affectedSessionIds.length) regenerateNpcSummaries(db, affectedSessionIds);
  res.json({ ok: true });
});

// Cases an NPC/account can be allocated to: every GM case.
router.get('/allocatable-cases', requireGM, (req, res) => {
  const cases = db.prepare(`
    SELECT id, name FROM sessions
    WHERE COALESCE(description, '') != ?
    ORDER BY name COLLATE NOCASE
  `).all(DOMESTIC_SYSTEM_DESCRIPTION).map((s) => ({ ...s, domestic: false }));
  res.json(cases);
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get('/sessions', requireAuth, (req, res) => {
  const isGM = req.user.role === 'gm';
  let sessions;
  if (isGM) {
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
  // Attach a cover image per session, scoped to the viewer's role: players
  // only see a cover that lives in the player-visible Gallery.
  sessions = sessions.map((s) => ({ ...s, cover_image: findSessionCover(s, isGM) || null }));
  res.json(sessions);
});

router.post('/sessions', requireGM, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO sessions (name, description) VALUES (?, ?)').run(name, description || null);
  ensureSessionDataFolderById(db, result.lastInsertRowid);
  res.status(201).json({ id: result.lastInsertRowid, name, description });
});

router.put('/sessions/:id', requireGM, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const previous = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!previous) return res.status(404).json({ error: 'Session not found' });
  if (previous.system_key) return res.status(400).json({ error: 'Built-in case files cannot be renamed. Edit the case files or use Reset instead.' });
  const result = db.prepare('UPDATE sessions SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Session not found' });
  if (previous.description !== DOMESTIC_SYSTEM_DESCRIPTION && description !== DOMESTIC_SYSTEM_DESCRIPTION) {
    renameSessionDataFolder(previous.id, previous.name, name);
    ensureSessionDataFolderById(db, previous.id);
  }
  res.json({ ok: true });
});

router.delete('/sessions/:id', requireGM, (req, res) => {
  const previous = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (previous && previous.system_key) return res.status(400).json({ error: 'Built-in case files cannot be deleted. Use Reset to restore the canonical copy.' });
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

router.post('/sessions/:id/reset-canonical', requireGM, (req, res) => {
  try {
    res.json({ ok: true, ...resetCanonicalCase(db, req.params.id) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Reset failed' });
  }
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
  const session = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (req.user.role !== 'gm') {
    const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Not assigned to this session' });
  }
  // Every character — player or NPC — whose scope includes this case's name.
  // Players see only player sheets (NPC presence is GM-only).
  const allowNpc = req.user.role === 'gm';
  const rows = db.prepare(`
    SELECT cs.*, u.username
    FROM character_sheets cs
    LEFT JOIN users u ON cs.user_id = u.id
    ${allowNpc ? '' : 'WHERE cs.user_id IS NOT NULL'}
  `).all().filter((r) => sheetHasCase(parseStoredSheetData(r.data), session.name));
  rows.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
  const caseSettings = sessionRolls.getSettings(db, sessionId);
  const ruleset = caseSettings.ruleset;
  const rules_tier = caseSettings.rules_tier;
  res.json(rows.map((s) => ({
    id: s.id,
    user_id: s.user_id == null ? null : s.user_id,
    owner: s.user_id == null ? 'NPC' : 'player',
    username: s.user_id == null ? null : s.username,
    updated_at: s.updated_at,
    data: parseStoredSheetData(s.data),
    ruleset,
    rules_tier
  })));
});

router.get('/sessions/:sessionId/sheets/:userId', requireAuth, (req, res) => {
  const { sessionId, userId } = req.params;
  if (req.user.role !== 'gm' && req.user.id !== parseInt(userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const session = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const caseSettings = sessionRolls.getSettings(db, sessionId);
  const ruleset = caseSettings.ruleset;
  const rules_tier = caseSettings.rules_tier;
  const sheet = findUserSheetInCase(userId, session.name);
  if (!sheet) return res.json({ data: {}, ruleset, rules_tier });
  res.json({ ...sheet, data: parseStoredSheetData(sheet.data), ruleset, rules_tier });
});

router.put('/sessions/:sessionId/sheets/:userId', requireAuth, (req, res) => {
  const { sessionId, userId } = req.params;
  if (req.user.role !== 'gm' && req.user.id !== parseInt(userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const session = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  if (!assigned) return res.status(403).json({ error: 'Player not assigned to this session' });

  const previousRow = findUserSheetInCase(userId, session.name);
  const previousData = parseStoredSheetData(previousRow && previousRow.data);
  const nextData = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
  // The session's case name must remain in the sheet's scope after save.
  nextData.scope = sheetScope(addCaseToScope(nextData, session.name));
  const dataJson = JSON.stringify(nextData);
  if (previousRow) {
    db.prepare("UPDATE character_sheets SET data = ?, updated_at = datetime('now') WHERE id = ?")
      .run(dataJson, previousRow.id);
  } else {
    db.prepare("INSERT INTO character_sheets (user_id, data, updated_at) VALUES (?, ?, datetime('now'))")
      .run(userId, dataJson);
  }
  const changedFields = listChangedSheetFields(previousData, nextData);
  logAudit('sheet.saved', {
    actorUserId: req.user.id,
    actorUsername: req.user.username,
    actorRole: req.user.role,
    ip: getClientAddress(req),
    scope: 'session',
    mode: previousRow ? 'update' : 'create',
    sessionId: Number(sessionId),
    sessionName: session.name,
    sheetUserId: Number(userId),
    sheetUsername: getUsernameById(userId),
    changedFieldCount: changedFields.length,
    changedFields: changedFields.slice(0, 20),
    summary: summarizeSheetData(nextData)
  });
  res.json({ ok: true });
});


router.get('/adventure/domestic', requireAuth, (req, res) => {
  const adventure = loadDomesticAdventure();
  if (!adventure) {
    return res.status(404).json({ error: 'The Domestic adventure markdown is not available on the server.' });
  }
  res.json(adventure);
});

// The Domestic solo adventure's sheet and progress live in the player's
// browser localStorage; the server holds only the shared markdown content
// served by GET /adventure/domestic above.

router.post('/dice/rolls', requireAuth, (req, res) => {
  const formula = String(req.body && req.body.formula || '').trim();
  const preset = String(req.body && req.body.preset || '').trim();
  const rolled = rollDiceFormula(formula);
  if (!rolled) {
    return res.status(400).json({ error: 'A valid dice formula is required.' });
  }
  logAudit('dice.roll', {
    userId: req.user.id,
    username: req.user.username,
    role: req.user.role,
    ip: getClientAddress(req),
    formula: rolled.formula,
    preset: preset || null,
    rolls: rolled.rolls,
    modifier: rolled.modifier,
    total: rolled.total
  });
  res.json({ ok: true, ...rolled });
});

// ── Scenario information ─────────────────────────────────────────────────────

router.get('/sessions/:id/scenario-info', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  // A GM can preview exactly what one player sees via ?as_user=<id>. The
  // impersonated viewer is forced to the player role so GM-only fields and
  // other players' private knowledge are filtered out server-side.
  let effectiveUser = req.user;
  if (req.query.as_user && req.user.role === 'gm') {
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(parseInt(req.query.as_user, 10));
    if (target) effectiveUser = { id: target.id, username: target.username, role: 'player' };
  }
  const payload = loadSessionScenarioInfoForUser(session.id, effectiveUser, db);
  if (!payload) return res.status(404).json({ error: 'Session not found' });
  res.json(payload);
});

router.get('/sessions/:id/scenario-sources', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const sources = readSessionSources(session);
  if (req.user.role !== 'gm') {
    delete sources.private_source;
    delete sources.private_source_path;
    sources.markdown_sources = (sources.markdown_sources || []).filter((file) => file.visibility !== 'gm');
    sources.source_files = sources.source_files.filter((file) => file.visibility !== 'gm');
  }
  res.json(sources);
});

router.put('/sessions/:id/scenario-sources', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  res.json(writeSessionSources(session, req.body));
});

// ── Character personality (in-tab dictation editor) ─────────────────────────
// Personality handout for any character in the case, keyed by sheet id. The
// focused character owns the text: a GM may edit any character (incl. NPCs); a
// player only their own. Same file the talk-to-character AI reads.
function personalityCharacter(req, res, session) {
  const row = db.prepare('SELECT * FROM character_sheets WHERE id = ?').get(req.params.cid);
  if (!row) { res.status(404).json({ error: 'No such character.' }); return null; }
  const data = parseStoredSheetData(row.data);
  if (!sheetHasCase(data, session.name)) { res.status(404).json({ error: 'Character is not in this case.' }); return null; }
  if (req.user.role !== 'gm' && row.user_id !== req.user.id) { res.status(403).json({ error: 'Not your character.' }); return null; }
  return { row, name: String(data.name || '').trim() };
}

router.get('/sessions/:id/characters/:cid/personality', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const c = personalityCharacter(req, res, session);
  if (!c) return;
  res.json({ name: c.name, content: c.name ? readCharacterPersonality(session, c.name) : '' });
});

router.put('/sessions/:id/characters/:cid/personality', requireAuth, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const c = personalityCharacter(req, res, session);
    if (!c) return;
    if (!c.name) return res.status(400).json({ error: 'Give the character a name on the sheet first.' });
    const saved = writeCharacterPersonality(session, c.name, req.body && req.body.content);
    res.json({ ok: true, name: c.name, path: saved });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Build case-scoped speech biasing from the case's own canon files, so the
// case glossary.md / key-npcs.md stay the single source of truth (no hardcoded
// vocab here). Priority order matters — we cap to stay within Whisper's prompt
// budget: the case's PC names first (most likely spoken), then key NPCs
// (key-npcs.md), then glossary terms (glossary.md), then other NPC personas.
function buildCaseBias(session) {
  const ordered = [];
  const seen = new Set();
  const add = (n) => { const v = String(n || '').trim(); const k = v.toLowerCase(); if (v && !seen.has(k)) { seen.add(k); ordered.push(v); } };
  try {
    for (const row of db.prepare('SELECT data FROM character_sheets WHERE user_id IS NOT NULL').all()) {
      const data = parseStoredSheetData(row.data);
      if (data && sheetHasCase(data, session.name) && data.name) add(data.name);
    }
  } catch { /* ignore */ }
  try { for (const n of readCaseKeyNpcs(session)) add(n); } catch { /* ignore */ }
  try { for (const t of readCaseGlossaryTerms(session)) add(t); } catch { /* ignore */ }
  try { for (const p of listNpcPersonas(session)) { if (p && p.name) add(p.name); } } catch { /* ignore */ }
  // Newline-delimited so each term (incl. multi-word names like "Beverley Brook")
  // stays a discrete recognition-time boost phrase for the Parakeet STT service.
  const hotwords = ordered.slice(0, 150).join('\n');
  return { hotwords, initial_prompt: 'A Rivers of London tabletop session set in London.' };
}

// Glossary-boost strength is a GM dial in ROL (Admin page → effectiveBoostAlpha),
// sent to the general-purpose speech box per request — the box does not own it.

// Proxy a short audio clip to the WhisperX STT service and return the transcript.
// Body: { audio_base64, mime?, hotwords?, initial_prompt? }. The server seeds
// RoL-vocabulary biasing from the case; client hotwords (if any) are appended.
// Stateless: the audio is forwarded to the speech box and not stored here.
router.post('/sessions/:id/transcribe', requireAuth, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const b64 = req.body && req.body.audio_base64;
    if (!b64) return res.status(400).json({ error: 'audio_base64 required.' });
    const buf = Buffer.from(String(b64), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Empty audio.' });
    const bias = buildCaseBias(session);
    const hotwords = [bias.hotwords, req.body && req.body.hotwords].filter(Boolean).join('\n').trim();
    const initial_prompt = (req.body && req.body.initial_prompt) || bias.initial_prompt;
    const form = new FormData();
    form.append('file', new Blob([buf], { type: (req.body && req.body.mime) || 'audio/webm' }), 'clip.webm');
    if (hotwords) form.append('hotwords', hotwords);
    form.append('boost_alpha', String(effectiveBoostAlpha()));
    if (initial_prompt) form.append('initial_prompt', initial_prompt);
    let upstream;
    try {
      upstream = await fetch(`${effectiveWhisperxUrl()}/v1/transcribe`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(120000)
      });
    } catch (e) {
      return res.status(502).json({ error: 'Speech service unreachable.' });
    }
    if (!upstream.ok) return res.status(502).json({ error: `Speech service error ${upstream.status}.` });
    const j = await upstream.json().catch(() => ({}));
    const out = { text: (j && j.text) || '' };
    // Voiceprint embedding: needed for explicit embed requests (legacy client
    // clustering) and for personality-editor dictation that ENROLLS the speaker's
    // voice as a character. Enrollment keeps only the derived label in the
    // registry — never the audio — which is the GDPR-minimising path. Optional and
    // non-fatal — falls back to text-only if the embed service isn't available.
    if (req.body && (req.body.embed || req.body.enroll_character)) {
      try {
        const ef = new FormData();
        ef.append('file', new Blob([buf], { type: (req.body && req.body.mime) || 'audio/webm' }), 'clip.webm');
        const er = await fetch(`${effectiveWhisperxUrl()}/v1/embed`, { method: 'POST', body: ef, signal: AbortSignal.timeout(120000) });
        if (er.ok) {
          const ej = await er.json().catch(() => ({}));
          if (Array.isArray(ej.embedding)) {
            if (req.body.enroll_character) {
              const reg = loadVoiceRegistry(session);
              const { voice } = matchVoice(reg, ej.embedding);
              const ch = String(req.body.enroll_character).trim();
              if (ch) voice.character = ch;
              if (!voice.sample && out.text) voice.sample = out.text.trim().slice(0, 60);
              saveVoiceRegistry(session, reg);
              out.voice = voice.id;   // label only; raw embedding is not returned
            }
            if (req.body.embed) out.embedding = ej.embedding;
          }
        }
      } catch { /* embedding/enrollment optional */ }
    }
    res.json(out);
  } catch (e) { next(e); }
});

// ── Session-audio diarization (Part B) ──────────────────────────────────────
// Diarize one audio chunk, fold its speakers into the case's voiceprint registry,
// and return segments labelled with canonical voice ids + character names. The
// registry keeps SPEAKER identity consistent across chunks and sessions.
// Diarize one audio buffer via WhisperX and fold its speakers into the case's
// canonical voiceprint registry. Returns segments labelled with voice ids +
// character names. Throws Error with .statusCode on upstream failure.
async function diarizeAudioBuffer(session, buf, mime) {
  const bias = buildCaseBias(session);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/wav' }), 'chunk.wav');
  form.append('diarize', 'true');
  if (bias.hotwords) form.append('hotwords', bias.hotwords);
  form.append('boost_alpha', String(effectiveBoostAlpha()));
  if (bias.initial_prompt) form.append('initial_prompt', bias.initial_prompt);
  let upstream;
  try {
    upstream = await fetch(`${effectiveWhisperxUrl()}/v1/transcribe`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(1800000)  // diarization is slow
    });
  } catch (e) { const err = new Error('Speech service unreachable.'); err.statusCode = 502; throw err; }
  if (!upstream.ok) { const err = new Error(`Speech service error ${upstream.status}.`); err.statusCode = 502; throw err; }
  const j = await upstream.json().catch(() => ({}));
  const segments = (j && j.segments) || [];
  const speakers = (j && j.speakers) || {};

  // Fold each raw speaker into the persistent canonical voice registry.
  const reg = loadVoiceRegistry(session);
  const rawToVoice = {};
  for (const [raw, emb] of Object.entries(speakers)) {
    if (!(Array.isArray(emb) && emb.length)) continue;
    // No words, no voice: skip pyannote speakers that carry no actual speech
    // (it over-segments noise/silence in short windows, spawning empty v3/v4).
    const said = segments.filter((s) => s.speaker === raw && (s.text || '').trim());
    if (!said.length) continue;
    const { voice } = matchVoice(reg, emb);
    rawToVoice[raw] = voice;
    if (!voice.sample) {
      const best = said.reduce((a, b) => (b.text.trim().length > a.text.trim().length ? b : a));
      voice.sample = best.text.trim().slice(0, 60);
    }
  }
  // Delete any voice that has no words and no assigned character — a voice can't
  // exist without speech. (Current-fold voices always have a sample, so this only
  // removes pre-existing ghosts.)
  reg.voices = reg.voices.filter((v) => (v.sample && v.sample.trim()) || v.character);
  saveVoiceRegistry(session, reg);

  const out = segments.map((s) => {
    const v = rawToVoice[s.speaker];
    return { start: s.start, end: s.end, text: s.text,
             voice: v ? v.id : null, character: v ? (v.character || null) : null };
  });
  return { segments: out, voices: listVoices(session), text: (j && j.text) || '' };
}

router.post('/sessions/:id/diarize-chunk', requireGM, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const b64 = req.body && req.body.audio_base64;
    if (!b64) return res.status(400).json({ error: 'audio_base64 required.' });
    const buf = Buffer.from(String(b64), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Empty audio.' });
    const r = await diarizeAudioBuffer(session, buf, (req.body && req.body.mime) || 'audio/webm');
    res.json(r);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// ── Streaming session capture (Part B) ──────────────────────────────────────
// Audio is streamed from the browser as it is captured: /live/start resets the
// per-session buffer, /ingest appends raw PCM slices, and /diarize-window
// diarizes the next un-processed sliding window over the accumulated buffer.
// Short window → low latency: the GPU diarizes a window in ~seconds, so the lag is the
// window-wait, not compute. 20s keeps current speech becoming a diarized paragraph fast.
// Paragraph-bounded: the browser flushes complete, pause-delimited chunks (always
// final=true), so there is no sliding window and no overlap to re-transcribe — each
// chunk is diarized exactly once and appended. OVERLAP=0 = clean, append-only edges.
const LIVE_WINDOW_SEC = 20, LIVE_OVERLAP_SEC = 0;
// Hard cap on how much audio ANY single diarize call processes. A session may run
// for hours — a call must never read "cursor → total" unbounded. We diarize at most
// this many seconds per call, advance the cursor by exactly that, and tell the client
// (`more`) to come back for the next slice until it has caught up.
const DIAR_WINDOW_MAX_SEC = 90;

router.post('/sessions/:id/live/start', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const s = liveBufferReset(session, req.body && req.body.rate);
  res.json({ ok: true, rate: s.rate });
});

router.post('/sessions/:id/ingest', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const b64 = req.body && req.body.pcm_base64;
    if (!b64) return res.status(400).json({ error: 'pcm_base64 required.' });
    const buf = Buffer.from(String(b64), 'base64');
    const s = liveBufferAppend(session, buf);
    res.json({ total: s.total, rate: s.rate });
  } catch (e) { next(e); }
});

router.post('/sessions/:id/diarize-window', requireGM, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const st = liveBufferState(session);
    const final = !!(req.body && req.body.final);
    const ready = st.total - st.cursor;
    // Wait until a full window has accumulated (unless flushing the tail on stop).
    if (!final && ready < LIVE_WINDOW_SEC * st.rate) {
      return res.json({ pending: true, have_sec: ready / st.rate, voices: listVoices(session) });
    }
    // Diarize AT MOST one bounded window per call — never "cursor → total", which on
    // a multi-hour session would be an enormous block. `more` = backlog remains.
    // Prefer to END on the real pause the client found (`until`), so no speaker
    // straddles the cut (a mid-turn cut fragments one voice into several).
    const startSample = st.cursor;
    let endSample = Math.min(st.total, startSample + DIAR_WINDOW_MAX_SEC * st.rate);
    const untilSample = Math.round((Number(req.body && req.body.until) || 0) * st.rate);
    if (untilSample > startSample && untilSample < endSample) endSample = untilSample;
    if (endSample - startSample < st.rate * 0.4) {   // <0.4s of new audio — nothing worth diarizing
      return res.json({ pending: false, segments: [], voices: listVoices(session), cursor_sec: st.cursor / st.rate, more: false });
    }
    const wav = liveBufferWindowWav(session, startSample, endSample);
    let r;
    try { r = await diarizeAudioBuffer(session, wav, 'audio/wav'); }
    catch (e) { return res.status(e.statusCode || 502).json({ error: e.message }); }
    const offsetSec = startSample / st.rate;
    liveBufferAdvanceCursor(session, endSample);
    res.json({
      pending: false,
      segments: r.segments.map((s) => ({ ...s, start: s.start + offsetSec, end: s.end + offsetSec })),
      voices: r.voices,
      cursor_sec: endSample / st.rate,
      more: endSample < st.total
    });
  } catch (e) { next(e); }
});

// The case's canonical voices (for the GM voice→character mapping UI).
router.get('/sessions/:id/voices', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  res.json({ voices: listVoices(session) });
});

// Map a canonical voice to a character (persists; '' clears it).
router.put('/sessions/:id/voices/:voiceId', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const v = setVoiceCharacter(session, req.params.voiceId, req.body && req.body.character);
    res.json({ ok: true, voice: { id: v.id, character: v.character, count: v.count } });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Merge a falsely-split voice into another (combines the voiceprints, drops the
// source). Body: { into: '<voiceId>' }.
router.post('/sessions/:id/voices/:voiceId/merge', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const voices = mergeVoice(session, req.params.voiceId, req.body && req.body.into);
    res.json({ ok: true, voices });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Delete a spurious voice outright.
router.delete('/sessions/:id/voices/:voiceId', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const voices = deleteVoice(session, req.params.voiceId);
    res.json({ ok: true, voices });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Single generation path. Body may carry { sections: [...] } for a page-level
// regenerate or { artifact: 'player' | 'gm' }; an empty body regenerates every
// section (bulk). The CLI script calls the same scenarioInfo function.
router.post('/sessions/:id/scenario-info/regenerate', requireGM, async (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  if (await gateLlmStart(res)) return; // local: 409 before streaming; cloud: no gate

  const t0 = Date.now();
  const stepAt = new Map();
  // Stream NDJSON progress so the client sees live per-section timing/metrics
  // and can cancel through /llm/cancel. A disconnect still aborts this
  // request's controller as a fallback.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client cancelled')); });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (obj) => { if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`); };
  try {
    logLine('scenario.regenerate.begin', { session: session.id });
    send({ type: 'begin', session: session.id });
    const result = await regenerateScenarioSections(session.id, db, {
      sections: Array.isArray(req.body && req.body.sections) ? req.body.sections : null,
      artifact: (req.body && req.body.artifact) || null,
      signal: controller.signal,
      onEvent: (ev) => {
        if (ev.type === 'start') {
          stepAt.set(ev.id, Date.now());
          logLine('scenario.step.start', { id: ev.id, step: `${ev.index}/${ev.total}` });
        } else if (ev.type === 'done') {
          ev.ms = Date.now() - (stepAt.get(ev.id) || Date.now());
          logLine('scenario.step.done', { id: ev.id, step: `${ev.index}/${ev.total}`, ms: ev.ms });
        } else if (ev.type === 'error') {
          ev.ms = Date.now() - (stepAt.get(ev.id) || Date.now());
          logLine('scenario.step.error', { id: ev.id, step: `${ev.index}/${ev.total}`, ms: ev.ms, error: ev.error });
        }
        send(ev); // start | progress (incl. metrics) | done | error
      }
    });
    if (!result) { send({ type: 'fatal', error: 'Session not found' }); return res.end(); }
    for (const f of result.errors || []) {
      logLine('scenario.step.fail', { id: f.section_id, error: f.error, ollama_response: f.ollama_response });
    }
    logLine('scenario.regenerate.done', {
      session: session.id, sections: (result.requested || []).length,
      ok: (result.regenerated || []).length, errors: (result.errors || []).length,
      ms_total: Date.now() - t0
    });
    send({
      type: 'complete', ok: (result.regenerated || []).length,
      errors: result.errors || [], sections: (result.requested || []).length,
      ms_total: Date.now() - t0
    });
  } catch (e) {
    const cancelled = controller.signal.aborted || e.cancelled;
    logLine(cancelled ? 'scenario.regenerate.cancelled' : 'scenario.regenerate.error', {
      session: session.id, ms_total: Date.now() - t0, error: e.message, ollama_response: e.ollama_response
    });
    send({ type: cancelled ? 'cancelled' : 'fatal', error: e.message || 'Scenario regeneration failed' });
  }
  res.end();
});

// Lightweight LLM busyness probe so the UI can show generation progress and
// stop GMs from firing duplicate regenerations.
// ── Single-GPU AI exclusivity ─────────────────────────────────────────────────
// Ollama and ComfyUI share one GPU; two large models co-loading OOMs it. Every
// AI-initiating endpoint refuses to start while EITHER subsystem is busy
// (multi-user safe — can't be enforced client-side). ComfyUI busyness is its
// live queue; if ComfyUI is unreachable it's treated as free so a dead image
// host never blocks the language model.
let comfyQueueCache = { at: 0, busy: false };
async function comfyBusy() {
  const now = Date.now();
  if (now - comfyQueueCache.at < 1500) return comfyQueueCache.busy;
  try {
    const r = await fetch(`${effectiveComfyuiUrl()}/prompt`, { signal: AbortSignal.timeout(2500) });
    const j = r.ok ? await r.json() : null;
    const remaining = j && j.exec_info ? Number(j.exec_info.queue_remaining) : 0;
    comfyQueueCache = { at: now, busy: Number.isFinite(remaining) && remaining > 0 };
  } catch {
    comfyQueueCache = { at: now, busy: false };
  }
  return comfyQueueCache.busy;
}

async function aiBusyState() {
  const o = ollamaStatus();
  // A cloud LLM runs off-box, so it never contends for the local GPU and is not
  // a reason to block other AI work; only local-model generation gates here.
  if (!o.cloud && o.busy) return { busy: true, kind: 'llm', label: o.last_section || 'language model' };
  if (await comfyBusy()) return { busy: true, kind: 'image', label: 'image generation' };
  return { busy: false, kind: null, label: null };
}

// Returns true (and sends 409) when the GPU is already running an AI task.
async function rejectIfAiBusy(res) {
  const s = await aiBusyState();
  if (!s.busy) return false;
  const what = s.kind === 'llm' ? 'the language model' : 'image generation';
  res.status(409).json({ error: `AI is busy with ${what}${s.label && s.kind === 'llm' ? ` (${s.label})` : ''}. Only one AI task runs at a time on the shared GPU — try again in a moment.` });
  return true;
}

// Gate the start of an LLM-initiating endpoint. With a local model the LLM shares
// the GPU, so enforce the single-flight lock and hand the GPU off from ComfyUI.
// With a cloud model there is no local contention: skip the gate entirely and let
// each browser self-limit (it owns its own busy/cancel state). Returns true when
// the caller should stop (a 409 was sent).
async function gateLlmStart(res) {
  if (isCloudLlm()) return false;
  if (await rejectIfAiBusy(res)) return true;
  await prepareGpuForLlm();
  return false;
}

// Logged once per model load (the split/ctx don't change for a resident
// model). Re-logs if the model reloads with a different VRAM split or ctx.
let lastPsSig = null;
router.get('/llm/status', requireAuth, async (req, res) => {
  const o = ollamaStatus();
  const ps = await ollamaPs().catch(() => null);
  if (ps) {
    const sig = `${ps.name}|${ps.vram}|${ps.total}|${ps.ctx}`;
    if (sig !== lastPsSig) {
      lastPsSig = sig;
      logLine('llm.ps', {
        model: ps.name, gpu_pct: ps.gpu_pct, cpu_pct: ps.cpu_pct,
        ctx: ps.ctx, total_gb: ps.total_gb, vram_gb: ps.vram_gb
      });
    }
  } else {
    lastPsSig = null; // unloaded → next load logs again
  }
  if (!o.busy && await comfyBusy()) {
    return res.json({ ...o, ps, busy: true, kind: 'image', can_cancel: false, last_section: 'image generation' });
  }
  res.json({ ...o, ps, kind: o.busy ? 'llm' : null });
});

router.post('/llm/cancel', requireGM, (req, res) => {
  const result = cancelOllama('cancelled by GM');
  logLine('llm.cancel', { cancelled: result.cancelled, active: result.active, last_section: result.last_section });
  res.json(result);
});

// Installed Ollama models for the Admin selector. On Ollama failure still
// return current/default so the UI can fall back to manual entry.
// Models are returned as { name, context }. Filtered to >=128K context
// (smaller models can't hold the case data); models whose context can't be
// read are kept (don't hide on a metadata hiccup), and the currently-selected
// model is always kept so the selector stays consistent.
router.get('/llm/models', requireGM, async (req, res) => {
  const s = ollamaStatus();
  const MIN_CTX = 131072;
  let context = null;
  try {
    context = await ollamaContextConfig();
  } catch (e) {
    context = { error: e.message || 'Could not read context settings' };
  }
  try {
    const detailed = await listOllamaModelsDetailed();
    const models = detailed.filter((m) =>
      m.name === s.model || m.context == null || m.context >= MIN_CTX);
    res.json({ models, current: s.model, default: s.default_model, context });
  } catch (e) {
    res.status(200).json({ models: [], current: s.model, default: s.default_model, context, error: e.message || 'Could not reach Ollama' });
  }
});

router.put('/llm/model', requireGM, (req, res) => {
  try {
    const model = setOllamaModel(req.body && req.body.model);
    res.json({ model, default: ollamaStatus().default_model });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not set the model' });
  }
});

router.put('/llm/context', requireGM, async (req, res) => {
  try {
    const context = await setOllamaNumCtx(req.body && req.body.num_ctx);
    res.json(context);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not set the LLM context' });
  }
});

// Effective + default base URLs for the AI services (Ollama, ComfyUI).
router.get('/llm/services', requireGM, (req, res) => {
  res.json(servicesConfig());
});

// Override either service URL. Body: { ollama_url?, comfyui_url? }. An empty
// string clears that override (falls back to the env default). Keys absent
// from the body are left unchanged.
router.put('/llm/services', requireGM, (req, res) => {
  try {
    const body = req.body || {};
    if (body.ollama_url !== undefined) setServiceUrl('ollama', body.ollama_url);
    if (body.comfyui_url !== undefined) setServiceUrl('comfyui', body.comfyui_url);
    if (body.whisperx_url !== undefined) setServiceUrl('whisperx', body.whisperx_url);
    if (body.boost_alpha !== undefined) setBoostAlpha(body.boost_alpha);
    res.json(servicesConfig());
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not set the service URL' });
  }
});

// ComfyUI diffusion-model picker (Admin). Lists installed models so the GM
// can choose which drives raw generation vs. image-edit restyle. On a ComfyUI
// failure still return current/defaults so the UI can fall back to manual.
router.get('/comfy/models', requireGM, async (req, res) => {
  const cfg = comfyModelsConfig();
  try {
    res.json({ models: await fetchComfyModelNames('diffusion_models', true), ...cfg });
  } catch (e) {
    res.status(200).json({ models: [], ...cfg, error: e.message || 'Could not reach ComfyUI' });
  }
});

// Body: { image_model?, edit_model? }. Empty string clears that override
// (falls back to the env/built-in default). Absent keys are left unchanged.
router.put('/comfy/models', requireGM, (req, res) => {
  try {
    const body = req.body || {};
    if (body.image_model !== undefined) setComfyuiModel('image', body.image_model);
    if (body.edit_model !== undefined) setComfyuiModel('edit', body.edit_model);
    res.json(comfyModelsConfig());
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not set the ComfyUI model' });
  }
});

router.post('/sessions/:id/scenario-info/sections/:sectionId/regenerate', requireGM, async (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  if (await gateLlmStart(res)) return; // local: 409 before streaming; cloud: no gate

  const t0 = Date.now();
  const sectionId = req.params.sectionId;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client cancelled')); });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (obj) => { if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`); };
  try {
    logLine('scenario.step.start', { id: sectionId, session: session.id });
    send({ type: 'start', id: sectionId, index: 1, total: 1 });
    const result = await regenerateScenarioSection(session.id, sectionId, db, {
      signal: controller.signal,
      onProgress: (p) => send({ type: 'progress', id: sectionId, index: 1, total: 1, ...p })
    });
    if (!result) { send({ type: 'fatal', error: 'Session not found' }); return res.end(); }
    const ms = Date.now() - t0;
    logLine('scenario.step.done', { id: sectionId, session: session.id, ms });
    send({ type: 'done', id: sectionId, index: 1, total: 1, ms });
    send({ type: 'complete', ok: 1, errors: [], sections: 1, ms_total: ms });
  } catch (e) {
    const cancelled = controller.signal.aborted || e.cancelled;
    logLine(cancelled ? 'scenario.step.cancelled' : 'scenario.step.error', {
      id: sectionId, session: session.id, ms: Date.now() - t0,
      error: e.message, ollama_response: e.ollama_response
    });
    send({
      type: cancelled ? 'cancelled' : 'error', id: sectionId, index: 1, total: 1,
      error: e.message || 'Section regeneration failed', ollama_response: e.ollama_response
    });
    if (!cancelled) send({ type: 'fatal', error: e.message || 'Section regeneration failed' });
  }
  res.end();
});

router.post('/sessions/:id/scenario-info/sections/:sectionId/revert', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  try {
    const result = revertScenarioSection(session.id, req.params.sectionId, db);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Section revert failed' });
  }
});

router.post('/sessions/:id/scenario-info/refresh-index', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  try {
    const sections = Array.isArray(req.body && req.body.sections) ? req.body.sections : null;
    const result = refreshScenarioIndexes(session.id, db, { sections });
    if (!result) return res.status(404).json({ error: 'Session not found' });
    logLine('scenario.index.refresh', {
      session: session.id,
      sections: (result.refreshed || []).length,
      output_paths: result.output_paths
    });
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not refresh scenario indexes' });
  }
});

router.get('/sessions/:id/scenario-info/assets/*', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const filePath = resolveSessionAssetPath(session.id, req.params[0], db, req.user.role === 'gm');
  if (!filePath) return res.status(404).json({ error: 'Scenario asset not found' });
  if (req.query.download) return res.download(filePath, path.basename(filePath));
  // Regenerate-in-place keeps the filename, so the browser must revalidate
  // every time (no-cache) rather than reuse a stale in-session copy. ETag /
  // Last-Modified stay on, so an unchanged file is a cheap 304.
  res.sendFile(filePath, { cacheControl: false, headers: { 'Cache-Control': 'no-cache' } });
});

// GM-only brainstorming chat for a case. Streams NDJSON: {delta} lines then
// {done:true}, or {error}. Aborts the Ollama call if the client disconnects.
router.post('/sessions/:id/chat', requireGM, async (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  if (await gateLlmStart(res)) return;
  const controller = new AbortController();
  // Detect a real client disconnect via the RESPONSE close (guarded by
  // writableEnded). req 'close' fires as soon as the request body is read,
  // which would abort the generation immediately.
  res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client disconnected')); });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const t0 = Date.now();
  try {
    logLine('gmchat.start', { session: session.id });
    await streamGmChat(session.id, db, req.body && req.body.messages, {
      signal: controller.signal,
      onToken: (delta) => res.write(`${JSON.stringify({ delta })}\n`)
    });
    logLine('gmchat.done', { session: session.id, ms: Date.now() - t0 });
    res.write(`${JSON.stringify({ done: true })}\n`);
  } catch (e) {
    const cancelled = controller.signal.aborted || e.cancelled;
    logLine(cancelled ? 'gmchat.cancelled' : 'gmchat.error', { session: session.id, ms: Date.now() - t0, error: e.message });
    res.write(`${JSON.stringify(cancelled ? { cancelled: true, error: e.message || 'Chat cancelled' } : { error: e.message || 'Chat failed' })}\n`);
  }
  res.end();
});

// Save the current GM chat verbatim as a Markdown file in the session GM/ area.
router.post('/sessions/:id/chat/export', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  try {
    const result = writeGmChatExport(session.id, db, req.body && req.body.messages);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Export failed' });
  }
});

// ── Per-case settings + assigned rolls ───────────────────────────────────────
router.get('/sessions/:id/settings', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  res.json(sessionRolls.getSettings(db, session.id));
});

router.put('/sessions/:id/settings', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  res.json(sessionRolls.setSettings(db, session.id, req.body || {}));
});

router.get('/sessions/:id/rolls', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const isGM = req.user.role === 'gm';
  const rolls = sessionRolls.listRolls(db, session.id, isGM ? {} : { userId: req.user.id });
  res.json({ rolls, luck: isGM ? sessionRolls.luckLedger(db, session.id) : null });
});

router.post('/sessions/:id/rolls', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.createRoll(db, session.id, req.user.id, req.body);
  if (out.error) return res.status(400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.status(201).json(out.roll);
});

// A player initiates their own roll (unprompted) for one of their skills.
router.post('/sessions/:id/rolls/self', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.createRoll(db, session.id, req.user.id, { ...req.body, user_id: req.user.id });
  if (out.error) return res.status(400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.status(201).json(out.roll);
});

// Step 1 — roll (preview); does not finalise, so no mirror write yet.
router.post('/sessions/:id/rolls/:rollId/resolve', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.resolveRoll(db, session.id, req.params.rollId, req.user);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  res.json(out.roll);
});

// Step 2 — finalise with the player's Luck decision.
router.post('/sessions/:id/rolls/:rollId/finalize', requireAuth, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.finalizeRoll(db, session.id, req.params.rollId, req.user, req.body && req.body.luck_spent);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.json(out.roll);
});

// GM clears (refreshes) a Luck loss so it stops counting this session.
router.post('/sessions/:id/rolls/:rollId/restore-luck', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.restoreRollLuck(db, session.id, req.params.rollId);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.json({ ok: true });
});

router.post('/sessions/:id/rolls/:rollId/cancel', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.cancelRoll(db, session.id, req.params.rollId);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.json({ ok: true });
});

// Per-session wounds (GM).
router.put('/sessions/:id/players/:userId/wounds', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const w = sessionRolls.setWounds(db, session.id, parseInt(req.params.userId, 10), req.body || {});
  sessionRolls.writeRollMirrors(db, session.id);
  res.json(w);
});

// GM applies / clears a current-stat modifier (stat = luck | hp | mp).
router.post('/sessions/:id/players/:userId/stat-adjustment', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const b = req.body || {};
  const out = sessionRolls.addStatAdjustment(db, session.id, parseInt(req.params.userId, 10), b.stat, b.delta, b.note, req.user.id);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.json({ ok: true });
});

router.post('/sessions/:id/stat-adjustments/:adjId/clear', requireGM, (req, res) => {
  const session = getAccessibleSession(req, res, req.params.id);
  if (!session) return;
  const out = sessionRolls.clearStatAdjustment(db, session.id, req.params.adjId);
  if (out.error) return res.status(out.statusCode || 400).json({ error: out.error });
  sessionRolls.writeRollMirrors(db, session.id);
  res.json({ ok: true });
});

// ── Rules library ────────────────────────────────────────────────────────────

const rulesRoot = path.join(__dirname, '..', 'Rivers_of_London', 'rules');
const rulesAdvancedRoot = path.join(__dirname, '..', 'Rivers_of_London', 'rules-advanced');

function rulesRootForVariant(variant) {
  return variant === 'advanced' ? rulesAdvancedRoot : rulesRoot;
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownInline(value) {
  return htmlEscape(value)
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
}

function stripPublicRulesComments(markdown) {
  return String(markdown || '').replace(/<!--[\s\S]*?-->\s*/g, '').trim();
}

function firstMarkdownHeading(markdown, fallback) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function listRuleDocuments(root = rulesRoot) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => /^\d{2}-.*\.md$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const filePath = path.join(root, filename);
      const markdown = stripPublicRulesComments(fs.readFileSync(filePath, 'utf8'));
      return {
        filename,
        title: firstMarkdownHeading(markdown, filename.replace(/\.md$/i, '')),
        markdown
      };
    });
}

function rulesIndexTitle(variant) {
  const base = 'Rivers of London Compact Rules Reference';
  return variant === 'advanced' ? `${base} (Advanced)` : base;
}

function loadRulesIndex(variant = 'core') {
  const documents = listRuleDocuments(rulesRootForVariant(variant));
  if (!documents.length) return null;
  const title = rulesIndexTitle(variant);
  const markdown = [
    `# ${title}`,
    '',
    ...documents.flatMap((doc) => [doc.markdown, ''])
  ].join('\n').trim();
  const lines = markdown.split(/\r?\n/);
  const suffix = variant === 'advanced' ? '?variant=advanced' : '';
  return {
    variant,
    title,
    documents,
    markdown,
    lines,
    htmlPath: `/api/rules/print${suffix}`,
    markdownPath: `/api/rules/markdown${suffix}`
  };
}

// Build the "What's New in Advanced" changelog by reading the per-mutation
// provenance markers in the advanced corpus. Each advanced change is preceded
// by `<!-- Advanced: <label> | add|supersede|supplement -->`; we capture the
// block that follows so a player migrating from Core can see exactly what each
// advanced rule adds, replaces, or extends.
const ADVANCED_MARKER = /^<!--\s*Advanced:\s*(.+?)\s*\|\s*(add|supersede|supplement)\s*-->$/;

function buildAdvancedChanges() {
  if (!fs.existsSync(rulesAdvancedRoot)) return null;
  const files = fs.readdirSync(rulesAdvancedRoot)
    .filter((name) => /^\d{2}-.*\.md$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const groups = [];
  for (const filename of files) {
    const raw = fs.readFileSync(path.join(rulesAdvancedRoot, filename), 'utf8').replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    const numMatch = filename.match(/^(\d{2})-/);
    const chapterTitle = firstMarkdownHeading(stripPublicRulesComments(raw), filename.replace(/\.md$/i, ''));
    const chapter = numMatch ? `${numMatch[1]} ${chapterTitle}` : chapterTitle;
    const entries = [];

    for (let i = 0; i < lines.length; i += 1) {
      const marker = lines[i].trim().match(ADVANCED_MARKER);
      if (!marker) continue;
      const klass = marker[2];
      const commentLabel = marker[1];

      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) continue;

      const headingMatch = lines[j].trim().match(/^(#{2,6})\s+(.+?)\s*#*$/);
      let title;
      let bodyStart;
      let end = lines.length;

      if (headingMatch) {
        const level = headingMatch[1].length;
        title = headingMatch[2].replace(/\s*\(Advanced option\)\s*$/i, '').trim();
        bodyStart = j + 1;
        for (let k = j + 1; k < lines.length; k += 1) {
          const t = lines[k].trim();
          const hm = t.match(/^(#{1,6})\s+/);
          if (hm && hm[1].length <= level) { end = k; break; }
          if (ADVANCED_MARKER.test(t)) { end = k; break; }
        }
      } else {
        title = commentLabel.replace(/\s*\(.*?\)\s*$/, '').trim();
        bodyStart = j;
        for (let k = j; k < lines.length; k += 1) {
          const t = lines[k].trim();
          if (/^#{1,6}\s+/.test(t)) { end = k; break; }
          if (k > j && ADVANCED_MARKER.test(t)) { end = k; break; }
        }
      }

      const bodyMd = lines.slice(bodyStart, end)
        .join('\n')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
      entries.push({ class: klass, title, html: renderRulesMarkdownHtml(bodyMd) });
    }

    if (entries.length) groups.push({ filename, chapter, entries });
  }
  return { title: "What's New in Advanced", groups };
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseMarkdownTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderRulesMarkdownHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let inList = false;
  let inCode = false;
  let codeLines = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${markdownInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!inList) return;
    out.push('</ul>');
    inList = false;
  };
  const flushCode = () => {
    out.push(`<pre><code>${htmlEscape(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      flushParagraph();
      closeList();
      const headers = parseMarkdownTableRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(parseMarkdownTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push('<table>');
      out.push(`<thead><tr>${headers.map((cell) => `<th>${markdownInline(cell)}</th>`).join('')}</tr></thead>`);
      out.push(`<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${markdownInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`);
      out.push('</table>');
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const tag = `h${Math.min(level, 4)}`;
      out.push(`<${tag}>${markdownInline(heading[2].replace(/#+\s*$/, '').trim())}</${tag}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${markdownInline(bullet[1].trim())}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  if (inCode) flushCode();
  flushParagraph();
  closeList();
  return out.join('\n');
}

function renderRulesPrintableHtml(rulesIndex) {
  const body = renderRulesMarkdownHtml(rulesIndex.markdown);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(rulesIndex.title || 'Rivers of London Compact Rules Reference')}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f4f2ed; color: #1f2428; font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 2rem 2.25rem 3rem; background: #fff; min-height: 100vh; box-shadow: 0 0 0 1px #ddd7cc; }
    h1, h2, h3, h4 { line-height: 1.2; margin: 1.6rem 0 0.65rem; break-after: avoid; }
    h1 { font-size: 2rem; border-bottom: 2px solid #222; padding-bottom: 0.35rem; }
    h2 { font-size: 1.45rem; border-bottom: 1px solid #cfc7ba; padding-bottom: 0.25rem; }
    h3 { font-size: 1.15rem; }
    p, li { max-width: 76ch; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.92rem; break-inside: avoid; }
    th, td { border: 1px solid #cfc7ba; padding: 0.42rem 0.5rem; vertical-align: top; }
    th { background: #eee8dc; text-align: left; }
    code { background: #f0eee8; padding: 0.05rem 0.22rem; border-radius: 3px; }
    pre { background: #f0eee8; padding: 0.75rem; overflow-x: auto; }
    .print-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-bottom: 1rem; }
    .print-actions button { border: 1px solid #777; background: #fff; padding: 0.35rem 0.65rem; border-radius: 4px; cursor: pointer; }
    @media print {
      body { background: #fff; }
      main { max-width: none; margin: 0; padding: 0; box-shadow: none; }
      .print-actions { display: none; }
      h1 { page-break-before: auto; }
      h1:not(:first-of-type) { page-break-before: always; }
    }
  </style>
</head>
<body>
  <main>
    <div class="print-actions"><button type="button" onclick="window.print()">Print</button></div>
    ${body}
  </main>
</body>
</html>`;
}

function normaliseSheetRuleset(value) {
  return value === 'coc' ? 'coc' : 'rol';
}

const COC_STYLE_SHEET_KEYS = new Set([
  'siz',
  'hp', 'basehp', 'currenthp', 'maxhp', 'hpbase', 'hpcurrent', 'hpmax',
  'hitpoint', 'hitpoints', 'basehitpoints', 'currenthitpoints', 'maxhitpoints',
  'hitpointsbase', 'hitpointscurrent', 'hitpointsmax',
  'san', 'sanity', 'basesan', 'currentsan', 'maxsan', 'sanbase', 'sancurrent', 'sanmax',
  'basesanity', 'currentsanity', 'maxsanity', 'sanitybase', 'sanitycurrent', 'sanitymax',
  'build'
]);

function isCocStyleSheetKey(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return COC_STYLE_SHEET_KEYS.has(k);
}

function isMasteredSpellText(value) {
  const text = String(value || '').toLowerCase();
  if (/\bunmastered\b|\bnot\s+mastered\b/.test(text)) return false;
  return /\bmastered\b|\bmastery\b/.test(text);
}

function masteredSpellCountForSheet(sheet) {
  return (Array.isArray(sheet && sheet.magic_spells) ? sheet.magic_spells : []).filter((spell) => {
    if (!spell || typeof spell !== 'object') return false;
    if (spell.mastered === true) return true;
    if (spell.mastered === false) return false;
    if (!String(spell.name || '').trim()) return false;
    return isMasteredSpellText(spell.order);
  }).length;
}

function calculatedMagicPointsForSheet(sheet) {
  const pow = parseInt(String(sheet && sheet.pow == null ? '' : sheet.pow).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(pow) && pow > 0 ? Math.round(pow / 5) + masteredSpellCountForSheet(sheet) : '';
}

// Drop base64 image payloads from a sheet (they're not useful as text to the
// LLM). In the default Rivers-of-London ruleset, also remove CoC-style fields
// so the AI never receives hidden/disabled mechanics as character data. Long
// prose strings — backgrounds, motivations, history, notes — pass through
// unchanged; they directly inform how the LLM answers questions about a
// character.
function stripSheetValuesForRulesAi(value, ruleset) {
  const sheetRuleset = normaliseSheetRuleset(ruleset);
  if (Array.isArray(value)) return value.map((child) => stripSheetValuesForRulesAi(child, sheetRuleset));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^data:image\//i.test(value)) return '[image data omitted]';
    return value;
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (sheetRuleset !== 'coc' && isCocStyleSheetKey(key)) {
      continue;
    } else if (/portrait|image/i.test(key) && typeof child === 'string' && child.length > 200) {
      out[key] = '[image data omitted]';
    } else {
      out[key] = stripSheetValuesForRulesAi(child, sheetRuleset);
    }
  }
  return out;
}

function sheetForRulesAi(value, ruleset) {
  const sheet = stripSheetValuesForRulesAi(value, ruleset);
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return sheet;
  const calculatedMp = calculatedMagicPointsForSheet(sheet);
  if (calculatedMp === '') return sheet;
  const derived = sheet.derived && typeof sheet.derived === 'object' && !Array.isArray(sheet.derived) ? { ...sheet.derived } : {};
  const storedMp = parseInt(String(derived.mp == null ? '' : derived.mp).replace(/[^0-9-]/g, ''), 10);
  if (!Number.isFinite(storedMp) || storedMp < calculatedMp) {
    derived.mp = String(calculatedMp);
    sheet.derived = derived;
  }
  return sheet;
}

function loadRulesCharacterContext(user, sessionId) {
  const activeSessionId = Number.isFinite(Number(sessionId)) ? Number(sessionId) : null;
  const activeSession = activeSessionId
    ? db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(activeSessionId)
    : null;
  const activeSessionName = activeSession ? activeSession.name : null;
  const activeRuleset = activeSessionId
    ? normaliseSheetRuleset(sessionRolls.getSettings(db, activeSessionId).ruleset)
    : normaliseSheetRuleset('rol');

  // Always include the requesting user's own character sheets. Filter to the
  // active session by scope when one is given.
  const ownRows = db.prepare(
    'SELECT id, user_id, updated_at, data FROM character_sheets WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(user.id);
  const characters = [];
  for (const row of ownRows) {
    const data = parseStoredSheetData(row.data);
    if (activeSessionName && !sheetHasCase(data, activeSessionName)) continue;
    characters.push({
      id: row.id,
      session_id: activeSessionId,
      user_id: row.user_id,
      session_name: activeSessionName || (sheetScope(data)[0] || ''),
      updated_at: row.updated_at,
      ruleset: activeRuleset,
      sheet: sheetForRulesAi(data, activeRuleset)
    });
  }

  // GM in a specific session: surface every other character — player and NPC —
  // whose scope includes the active case so "tell me about Andrew" works.
  const npcs = [];
  if (activeSessionId && user.role === 'gm') {
    const allRows = db.prepare(`
      SELECT cs.id, cs.user_id, u.username, cs.updated_at, cs.data
      FROM character_sheets cs LEFT JOIN users u ON u.id = cs.user_id
    `).all();
    for (const row of allRows) {
      const data = parseStoredSheetData(row.data);
      if (!sheetHasCase(data, activeSessionName)) continue;
      if (row.user_id == null) {
        npcs.push({
          id: row.id,
          name: String(data.name || '').trim(),
          ruleset: activeRuleset,
          sheet: sheetForRulesAi(data, activeRuleset)
        });
      } else if (!characters.some((c) => c.id === row.id)) {
        characters.push({
          id: row.id,
          session_id: activeSessionId,
          user_id: row.user_id,
          username: row.username,
          session_name: activeSessionName,
          updated_at: row.updated_at,
          ruleset: activeRuleset,
          sheet: sheetForRulesAi(data, activeRuleset)
        });
      }
    }
  }

  return {
    user: { id: user.id, username: user.username, role: user.role },
    characters,
    npcs
  };
}

function rulesVariantFromReq(req) {
  return (req.query && req.query.variant === 'advanced') ? 'advanced' : 'core';
}

// The rules-grounded AI chat uses the corpus chosen for the active case in
// Admin → Case Settings (rules_tier). No case (global rules chat) ⇒ core.
function rulesVariantForSession(sessionId) {
  if (!sessionId) return 'core';
  try {
    return sessionRolls.getSettings(db, sessionId).rules_tier === 'advanced' ? 'advanced' : 'core';
  } catch {
    return 'core';
  }
}

router.get('/rules', requireAuth, (req, res) => {
  const variant = rulesVariantFromReq(req);
  const rulesIndex = loadRulesIndex(variant);
  if (!rulesIndex) {
    return res.status(404).json({ error: 'Rules files are not available on the server.' });
  }
  // Pre-rendered HTML lets the client embed the rules inline (no iframe) and
  // hand the same HTML to the print-doc overlay used by Case Files → Overview.
  res.json({
    variant,
    title: rulesIndex.title,
    advancedAvailable: !!loadRulesIndex('advanced'),
    sections: rulesIndex.documents.map((doc) => ({ filename: doc.filename, title: doc.title })),
    html: renderRulesMarkdownHtml(rulesIndex.markdown)
  });
});

router.get('/rules/changes', requireAuth, (req, res) => {
  const changes = buildAdvancedChanges();
  if (!changes || !changes.groups.length) {
    return res.status(404).json({ error: 'Advanced rules are not available on the server.' });
  }
  res.json(changes);
});

router.get('/rules/markdown', requireAuth, (req, res) => {
  const rulesIndex = loadRulesIndex(rulesVariantFromReq(req));
  if (!rulesIndex) {
    return res.status(404).json({ error: 'Rules files are not available on the server.' });
  }
  res.type('text/markdown').send(`${rulesIndex.markdown}\n`);
});

router.get('/rules/print', requireAuth, (req, res) => {
  const rulesIndex = loadRulesIndex(rulesVariantFromReq(req));
  if (!rulesIndex) {
    return res.status(404).send('Rules files are not available on the server.');
  }
  res.type('html').send(renderRulesPrintableHtml(rulesIndex));
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

router.post('/rules/chat', requireAuth, async (req, res) => {
  const sessionId = req.body && Number.isFinite(Number(req.body.sessionId)) ? Number(req.body.sessionId) : null;
  const variant = rulesVariantForSession(sessionId);
  const rulesIndex = loadRulesIndex(variant) || loadRulesIndex('core');
  if (!rulesIndex) {
    return res.status(404).json({ error: 'Rules files are not available on the server.' });
  }
  if (await gateLlmStart(res)) return;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client disconnected')); });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const t0 = Date.now();
  try {
    logLine('ruleschat.start', { userId: req.user.id, sessionId, rulesVariant: rulesIndex.variant });
    await streamRulesChat(rulesIndex.markdown, loadRulesCharacterContext(req.user, sessionId), req.body && req.body.messages, {
      signal: controller.signal,
      onToken: (delta) => res.write(`${JSON.stringify({ delta })}\n`)
    });
    logLine('ruleschat.done', { userId: req.user.id, ms: Date.now() - t0 });
    res.write(`${JSON.stringify({ done: true })}\n`);
  } catch (e) {
    const cancelled = controller.signal.aborted || e.cancelled;
    logLine(cancelled ? 'ruleschat.cancelled' : 'ruleschat.error', { userId: req.user.id, ms: Date.now() - t0, error: e.message });
    res.write(`${JSON.stringify(cancelled ? { cancelled: true, error: e.message || 'Rules chat cancelled' } : { error: e.message || 'Rules chat failed' })}\n`);
  }
  res.end();
});

// ── NPC persona chat ──────────────────────────────────────────────────────────
// Chat in-character with an NPC. Personas are Markdown (canonical seed in
// globaldata, overridable by a "<Name> - personality.md" case handout). Any
// authenticated user may chat with any NPC (POC: no state/visibility gating).
router.get('/sessions/:id/npc-personas', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) || null;
  // Attach each NPC's portrait (from its character sheet, matched by name) so
  // the chat can show a small avatar on that character's messages.
  const portraitByName = new Map();
  for (const row of db.prepare('SELECT data FROM character_sheets WHERE user_id IS NULL').all()) {
    const data = parseStoredSheetData(row.data);
    const name = String(data.name || '').trim().toLowerCase();
    if (name && data.portrait) portraitByName.set(name, data.portrait);
  }
  const npcs = listNpcPersonas(session).map((n) => ({
    ...n,
    portrait: portraitByName.get(String(n.name).toLowerCase()) || ''
  }));
  res.json({ npcs });
});

router.post('/sessions/:id/npc-chat', requireAuth, async (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) || null;
  const slug = req.body && typeof req.body.slug === 'string' ? req.body.slug : '';
  const persona = resolveNpcPersona(session, slug);
  if (!persona) {
    return res.status(404).json({ error: 'That character has no personality file yet.' });
  }
  if (await gateLlmStart(res)) return;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('client disconnected')); });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const t0 = Date.now();
  try {
    logLine('npcchat.start', { userId: req.user.id, slug: persona.slug, source: persona.source });
    await streamNpcChat(persona, req.body && req.body.messages, {
      signal: controller.signal,
      onToken: (delta) => res.write(`${JSON.stringify({ delta })}\n`)
    });
    logLine('npcchat.done', { userId: req.user.id, ms: Date.now() - t0 });
    res.write(`${JSON.stringify({ done: true })}\n`);
  } catch (e) {
    const cancelled = controller.signal.aborted || e.cancelled;
    logLine(cancelled ? 'npcchat.cancelled' : 'npcchat.error', { userId: req.user.id, ms: Date.now() - t0, error: e.message });
    res.write(`${JSON.stringify(cancelled ? { cancelled: true, error: e.message || 'NPC chat cancelled' } : { error: e.message || 'NPC chat failed' })}\n`);
  }
  res.end();
});

// ── Portrait proxy (ComfyUI + PhotoMaker) ─────────────────────────────────────
//
// The browser can't reach the ComfyUI server directly (it's LAN-only HTTP, and
// mixed-content rules would block HTTPS→HTTP fetches anyway). These endpoints
// forward the four requests the portrait test page needs through the Folly
// server over its authenticated HTTPS origin.
//
// Base URL comes from effectiveComfyuiUrl(): the admin override in
// app-config.json if set, else the COMFYUI_URL env var (default
// http://192.168.37.51:8188). Resolved per-call so an admin change to the
// host takes effect without a redeploy.

// ── ComfyUI idle unload ───────────────────────────────────────────────────────
// The ComfyUI GPU is shared with Ollama; a resident ~20 GB image model starves
// it. We can't unload after every job — that would make each Regenerate press
// pay a full cold-load. Instead a single shared timer is re-armed on EVERY
// portrait-subsystem interaction (prompt submit, history poll, image fetch).
// Rapid Regenerate keeps it warm; once nobody has touched it for the idle
// window, we ask ComfyUI to free the model so VRAM returns to Ollama. Re-arming
// on every interaction (not just submit) means a long generation can't be
// unloaded mid-job. One shared timer ⇒ inherently multi-user safe.
//
// COMFYUI_IDLE_UNLOAD_MS: idle window in ms (default 300000 = 5 min). Set 0 to
// disable (model stays resident as before).
const COMFYUI_IDLE_UNLOAD_MS = (() => {
  const raw = process.env.COMFYUI_IDLE_UNLOAD_MS;
  if (raw === undefined || raw === '') return 300000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 300000;
})();
let comfyUnloadTimer = null;

// Free ComfyUI's VRAM (unload diffusion models). Best-effort with a short
// timeout so a down/asleep ComfyUI never stalls an LLM request.
async function freeComfy(reason) {
  try {
    const r = await fetch(`${effectiveComfyuiUrl()}/free`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(5000)
    });
    logLine('comfy.free', { reason: reason || 'idle', ok: r.ok, status: r.status });
  } catch (e) {
    // Best-effort: ComfyUI may be down/asleep. Nothing to recover.
    logLine('comfy.free_error', { reason: reason || 'idle', error: String((e && e.message) || e) });
  }
}

async function runComfyUnload() {
  comfyUnloadTimer = null;
  await freeComfy('idle');
}

// Explicit single-GPU handoff. Ollama and ComfyUI cannot be co-resident, so
// before starting one we evict the other's model and wait for the VRAM back.
// Called by every AI-initiating route AFTER its busy-gate passes.
async function prepareGpuForImage() {
  try {
    const r = await freeOllama();
    logLine('gpu.handoff', { to: 'image', ollama_freed: !!(r && r.freed), detail: r });
  } catch (e) {
    logLine('gpu.handoff_error', { to: 'image', error: String((e && e.message) || e) });
  }
}
async function prepareGpuForLlm() {
  // Cancel any pending idle-unload (we're freeing it now) then free it.
  if (comfyUnloadTimer) { clearTimeout(comfyUnloadTimer); comfyUnloadTimer = null; }
  await freeComfy('llm-handoff');
}

function touchComfyActivity() {
  if (!COMFYUI_IDLE_UNLOAD_MS) return;
  if (comfyUnloadTimer) clearTimeout(comfyUnloadTimer);
  comfyUnloadTimer = setTimeout(runComfyUnload, COMFYUI_IDLE_UNLOAD_MS);
  if (comfyUnloadTimer.unref) comfyUnloadTimer.unref();
}

// Portrait storage size targets the printed PDF box (164 × 187 pt, ~7:8).
// 672 × 768 is divisible by 64 for SD3 latents and renders crisply at print
// resolution (~4× the target points).
const PORTRAIT_STORAGE_SIZE = { width: 672, height: 768 };
// Handout size presets (all divisible by 64 for the SD3 latent). "character"
// matches the character-sheet portrait box; "intricate" is high-res for maps.
const HANDOUT_SIZES = {
  character: { width: 672, height: 768 },
  portrait:  { width: 768, height: 1024 },
  landscape: { width: 1024, height: 768 },
  square:    { width: 768, height: 768 },
  intricate: { width: 1280, height: 960 }
};
const HANDOUT_SIZE_DEFAULT = 'portrait';
const QWEN_IMAGE_MODELS = {
  diffusionModel: process.env.COMFYUI_QWEN_DIFFUSION_MODEL || 'qwen_image_2512_fp8_e4m3fn.safetensors',
  textEncoder: process.env.COMFYUI_QWEN_TEXT_ENCODER || 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: process.env.COMFYUI_QWEN_VAE || 'qwen_image_vae.safetensors'
};
let comfyModelCache = { expiresAt: 0, folders: null };
const PORTRAIT_NEGATIVE_PROMPT = '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲';
// Framing/composition is held fixed so every case's portrait still crops
// cleanly into the printed character-sheet box, whatever the art style.
const PORTRAIT_COMPOSITION = 'serious expression, three-quarters view, bust portrait, full head and hair fully visible, generous space above the head, clear face, clear eyes';
// The art-style half of the prompt. Per-case overridable via session_settings
// .portrait_style; this is the fallback when a case has none set. Note the
// "not photorealistic" clause lives here (it is style-specific), unlike the
// style-agnostic quality negatives in PORTRAIT_NEGATIVE_PROMPT.
const DEFAULT_PORTRAIT_STYLE = 'Art Nouveau portrait styling with a restrained Art Deco frame around the portrait, clean elegant linework, muted earthy palette with antique gold accents, painterly illustration, not photorealistic, not modern snapshot';
// Aspect-neutral art style for index-entity graphics (places, objects, scenes,
// people). Deliberately carries NO "portrait", framing, or composition wording
// — those break sites and objects. Conveys only medium/era/palette.
const DEFAULT_ENTITY_ART_STYLE = 'painterly period illustration, clean elegant linework, muted earthy palette with antique gold accents, atmospheric naturalistic lighting, not photorealistic, not a modern photo';
const PORTRAIT_RANDOM_WORKFLOW_TEMPLATE = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: QWEN_IMAGE_MODELS.diffusionModel, weight_dtype: 'default' } },
  '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
  '3': { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_IMAGE_MODELS.textEncoder, type: 'qwen_image', device: 'default' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: '' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: PORTRAIT_NEGATIVE_PROMPT } },
  '6': { class_type: 'VAELoader', inputs: { vae_name: QWEN_IMAGE_MODELS.vae } },
  '7': { class_type: 'EmptySD3LatentImage', inputs: { width: PORTRAIT_STORAGE_SIZE.width, height: PORTRAIT_STORAGE_SIZE.height, batch_size: 1 } },
  '8': { class_type: 'KSampler', inputs: {
    model: ['2', 0], seed: 42, steps: 50, cfg: 4.0,
    sampler_name: 'euler', scheduler: 'simple',
    positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0], denoise: 1
  } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['6', 0] } },
  '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'ROL_portrait' } }
};

// Qwen-Image-Edit-2511 (image→image) restyle. The 2511 edit model needs the
// **Plus** text-encode node (TextEncodeQwenImageEditPlus, image1 input): it
// builds the reference from vae+image so identity is preserved while the
// prompt fully re-styles palette/linework/rendering. The init latent is a
// VAEEncode of the source and KSampler runs at denoise 1.0 — the reference
// lives in the conditioning, NOT in a partial-denoise of the source. (The
// older base TextEncodeQwenImageEdit node + low denoise produced a near-copy
// with no restyle — verified against the live box.)
const PORTRAIT_RESTYLE_WORKFLOW_TEMPLATE = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
  '3': { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_IMAGE_MODELS.textEncoder, type: 'qwen_image', device: 'default' } },
  '6': { class_type: 'VAELoader', inputs: { vae_name: QWEN_IMAGE_MODELS.vae } },
  '11': { class_type: 'LoadImage', inputs: { image: 'ROL_source.png' } },
  '4': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['6', 0], image1: ['11', 0], prompt: '' } },
  '5': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['6', 0], image1: ['11', 0], prompt: PORTRAIT_NEGATIVE_PROMPT } },
  '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['6', 0] } },
  '8': { class_type: 'KSampler', inputs: {
    model: ['2', 0], seed: 42, steps: 30, cfg: 3.5,
    sampler_name: 'euler', scheduler: 'simple',
    positive: ['4', 0], negative: ['5', 0], latent_image: ['12', 0], denoise: 1.0
  } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['6', 0] } },
  '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'ROL_restyle' } }
};

// Edit instruction: a direct "redraw in this style, keep the identity"
// command. Verified on the live box to fully restyle palette/linework while
// keeping the person recognisable. Do NOT tell it to "keep the same framing"
// — that suppresses the restyle.
function buildRestyleInstruction(style) {
  const styleText = (typeof style === 'string' && style.trim()) ? style.trim() : DEFAULT_PORTRAIT_STYLE;
  return `Redraw this photograph in the following art style: ${styleText}. Preserve the person's identity and facial likeness, but fully restyle the colours, palette, linework and rendering to match. ${PORTRAIT_COMPOSITION}. No text, no watermark.`;
}

// Decode a data: URL (or raw base64) into { buffer, ext }.
function decodeImageDataUrl(value) {
  const s = String(value || '').trim();
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(s);
  if (!m) { const e = new Error('A portrait image is required'); e.statusCode = 400; throw e; }
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) {
    const e = new Error('Portrait image is empty or too large (max 12 MB)'); e.statusCode = 400; throw e;
  }
  return { buffer, ext };
}

// Push an image into ComfyUI's input area and return the stored filename.
async function uploadImageToComfy(buffer, ext) {
  const filename = `ROL_source_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
  const form = new FormData();
  form.append('image', new Blob([buffer]), filename);
  form.append('overwrite', 'true');
  const up = await fetch(`${effectiveComfyuiUrl()}/upload/image`, { method: 'POST', body: form });
  if (!up.ok) {
    const e = new Error(`ComfyUI rejected the image upload (HTTP ${up.status})`); e.statusCode = 502; throw e;
  }
  const j = await up.json().catch(() => ({}));
  // ComfyUI returns { name, subfolder, type }. LoadImage wants "name" (or
  // "subfolder/name" when nested).
  const name = j && j.name ? j.name : filename;
  return j && j.subfolder ? `${j.subfolder}/${name}` : name;
}

function cleanPortraitText(value, maxLen = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function inferPortraitSubject(pronouns) {
  const p = cleanPortraitText(pronouns, 60).toLowerCase();
  if (/\b(she|her|hers)\b/.test(p)) return 'woman';
  if (/\b(he|him|his)\b/.test(p)) return 'man';
  return 'person';
}

function inferPortraitPresentation(pronouns) {
  const p = cleanPortraitText(pronouns, 60).toLowerCase();
  if (/\b(she|her|hers)\b/.test(p)) return 'female-presenting';
  if (/\b(he|him|his)\b/.test(p)) return 'male-presenting';
  return 'androgynous or non-binary presentation';
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
    .concat(Array.isArray(sheet.expert_skills) ? sheet.expert_skills : [])
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

function collectTopPortraitStats(sheet) {
  const labels = {
    str: 'strong',
    con: 'hardy',
    dex: 'agile',
    int: 'intelligent',
    pow: 'strong-willed',
    siz: 'imposing'
  };
  return ['str', 'con', 'dex', 'int', 'pow', 'siz']
    .map((key) => ({ key, value: parseInt(sheet && sheet[key], 10), label: labels[key] }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((entry) => entry.label);
}

function buildPortraitBaseConcept(sheet) {
  const subject = inferPortraitSubject(sheet.pronouns);
  const occupation = cleanPortraitText(sheet.occupation, 80);
  const age = cleanPortraitText(sheet.age, 20);
  const pronouns = cleanPortraitText(sheet.pronouns, 40);
  const presentation = inferPortraitPresentation(sheet.pronouns);

  const parts = [`head-and-shoulders portrait of a ${subject}`];
  if (occupation) parts.push(`${occupation}`);
  else parts.push('modern Rivers of London character');
  if (age) parts.push(`${age} years old`);
  if (pronouns) parts.push(`pronouns ${pronouns}`);
  else parts.push(presentation);
  return parts.join(', ');
}

async function fetchComfyModelNames(folder, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && comfyModelCache.folders && comfyModelCache.expiresAt > now && comfyModelCache.folders[folder]) {
    return comfyModelCache.folders[folder];
  }
  const upstream = await fetch(`${effectiveComfyuiUrl()}/models/${encodeURIComponent(folder)}`);
  if (!upstream.ok) {
    throw new Error(`Could not query ComfyUI model folder ${folder} (HTTP ${upstream.status}).`);
  }
  const payload = await upstream.json();
  const rawNames = Array.isArray(payload) ? payload : Array.isArray(payload.models) ? payload.models : [];
  const names = rawNames
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        return cleanPortraitText(entry.name || entry.filename || entry.model_name, 200);
      }
      return '';
    })
    .filter(Boolean);
  comfyModelCache = {
    expiresAt: now + 60 * 1000,
    folders: { ...(comfyModelCache.folders || {}), [folder]: names }
  };
  return names;
}

// Verify the workflow's models are present in ComfyUI. `diffusionModel`
// defaults to the configured image (txt→img) model; the restyle endpoint
// passes the edit model instead.
async function ensureQwenPortraitAssets(diffusionModel) {
  const wanted = diffusionModel || effectiveComfyuiImageModel();
  const [diffusionModels, textEncoders, vaes] = await Promise.all([
    fetchComfyModelNames('diffusion_models'),
    fetchComfyModelNames('text_encoders'),
    fetchComfyModelNames('vae')
  ]);
  const missing = [];
  if (!diffusionModels.includes(wanted)) missing.push(`diffusion model ${wanted}`);
  if (!textEncoders.includes(QWEN_IMAGE_MODELS.textEncoder)) missing.push(`text encoder ${QWEN_IMAGE_MODELS.textEncoder}`);
  if (!vaes.includes(QWEN_IMAGE_MODELS.vae)) missing.push(`vae ${QWEN_IMAGE_MODELS.vae}`);
  return missing;
}

function inferPortraitBackdrop(occupation) {
  const text = cleanPortraitText(occupation, 120).toLowerCase();
  if (!text) return 'a subtle London backdrop suited to their profession';
  if (/(police|detective|officer|forensic|constable|investigator|security)/.test(text)) {
    return 'a subtle Folly caseboard or investigative office backdrop';
  }
  if (/(doctor|nurse|surgeon|medic|paramedic|therapist|chemist|scientist|researcher|physicist|biologist)/.test(text)) {
    return 'a subtle laboratory or consulting-room backdrop';
  }
  if (/(journalist|writer|author|editor|librarian|academic|historian|archivist|teacher|lecturer)/.test(text)) {
    return 'a subtle study or library backdrop';
  }
  if (/(musician|singer|actor|actress|artist|painter|magician|performer|dancer|stage)/.test(text)) {
    return 'a subtle theatrical or studio backdrop';
  }
  if (/(builder|engineer|mechanic|electrician|plumber|smith|technician|driver|pilot)/.test(text)) {
    return 'a subtle workshop or transport backdrop';
  }
  if (/(chef|cook|baker|bartender|barista|publican)/.test(text)) {
    return 'a subtle kitchen or bar backdrop';
  }
  if (/(lawyer|solicitor|barrister|judge|clerk|civil servant|banker|accountant|broker)/.test(text)) {
    return 'a subtle formal office backdrop';
  }
  if (/(river|boat|sailor|fisher|marine|dock|water)/.test(text)) {
    return 'a subtle Thames-side backdrop';
  }
  if (/(magical|wizard|practitioner|occult|medium|witch)/.test(text)) {
    return 'a subtle occult London interior backdrop';
  }
  return 'a subtle London backdrop suited to their profession';
}

function inferPortraitAttire(occupation) {
  const text = cleanPortraitText(occupation, 120).toLowerCase();
  if (!text) return 'contemporary 21st-century London clothing appropriate to their role';
  if (/(police|detective|officer|forensic|constable|security)/.test(text)) {
    return 'contemporary 21st-century British policing or investigative attire, practical and recognisable';
  }
  if (/(doctor|nurse|surgeon|medic|paramedic|therapist|chemist|scientist|researcher|physicist|biologist)/.test(text)) {
    return 'contemporary 21st-century professional attire appropriate to a clinician or researcher';
  }
  if (/(journalist|writer|author|editor|librarian|academic|historian|archivist|teacher|lecturer)/.test(text)) {
    return 'contemporary 21st-century smart-casual or academic clothing';
  }
  if (/(musician|singer|actor|actress|artist|painter|magician|performer|dancer|stage)/.test(text)) {
    return 'contemporary 21st-century performance or creative-professional clothing, stylish but modern';
  }
  if (/(builder|engineer|mechanic|electrician|plumber|smith|technician|driver|pilot)/.test(text)) {
    return 'contemporary 21st-century practical workwear or technical clothing';
  }
  if (/(chef|cook|baker|bartender|barista|publican)/.test(text)) {
    return 'contemporary 21st-century hospitality or kitchen-appropriate clothing';
  }
  if (/(lawyer|solicitor|barrister|judge|clerk|civil servant|banker|accountant|broker)/.test(text)) {
    return 'contemporary 21st-century professional office clothing';
  }
  return 'contemporary 21st-century London clothing appropriate to their profession';
}

function buildPortraitPromptFromSheet(sheet, style) {
  const occupation = cleanPortraitText(sheet.occupation, 80);
  const age = cleanPortraitText(sheet.age, 20);
  const socialClass = cleanPortraitText(sheet.social_class, 80);
  const reputation = cleanPortraitText(sheet.reputation, 120);
  const tradition = cleanPortraitText(sheet.magic_tradition, 80);
  const notableSkills = collectPortraitSkillDetails(sheet);
  const weaponNames = collectPortraitWeaponNames(sheet);
  const topStats = collectTopPortraitStats(sheet);
  const advantages = parseAdvantagesText(sheet.advantages);
  const backdrop = inferPortraitBackdrop(occupation);
  const attire = inferPortraitAttire(occupation);
  const magical = advantages.some((adv) => /^magical\b/i.test(adv)) || !!tradition
    || (Array.isArray(sheet.magic_spells) && sheet.magic_spells.some((spell) => cleanPortraitText(spell && spell.name, 80)));

  const descriptors = [];
  if (socialClass) descriptors.push(socialClass);
  if (reputation) descriptors.push(reputation);
  if (magical && tradition) descriptors.push(`subtle signs of ${tradition} magic`);
  else if (magical) descriptors.push('subtle signs of magic');
  if (advantages.length) descriptors.push(advantages.slice(0, 2).join(' and ').toLowerCase());
  if (notableSkills.length) descriptors.push(`known for ${notableSkills.join(', ')}`);
  if (topStats.length) descriptors.push(topStats.join(' and '));
  if (weaponNames.length) descriptors.push(`equipped with ${weaponNames.join(' and ')}`);

  const subjectPrompt = buildPortraitBaseConcept(sheet);
  const detailPrompt = descriptors.length ? `${descriptors.join(', ')}, ` : '';

  const styleText = (typeof style === 'string' && style.trim()) ? style.trim() : DEFAULT_PORTRAIT_STYLE;
  return `${subjectPrompt}, `
    + `${detailPrompt}`
    + `${attire}, no robes or fantasy costume, `
    + `${backdrop}, `
    + `${PORTRAIT_COMPOSITION}, `
    + `${styleText}, `
    + 'no text, no watermark';
}

// Queue a tightly-controlled random portrait workflow on ComfyUI from sheet data.
router.post('/portrait/random', requireAuth, async (req, res, next) => {
  try {
    if (await rejectIfAiBusy(res)) return;
    const missingAssets = await ensureQwenPortraitAssets();
    if (missingAssets.length) {
      return res.status(503).json({
        error: `Qwen portrait workflow is not fully installed in ComfyUI: missing ${missingAssets.join(', ')}.`
      });
    }
    const sheet = (req.body && typeof req.body.sheet === 'object' && req.body.sheet) || {};
    // Resolve this case's portrait art-style (falls back to the built-in
    // default). The client sends the case id it already has in context;
    // unknown/missing ids just yield the default style.
    const sessionId = parseInt(req.body && req.body.sessionId, 10);
    let caseStyle = '';
    if (Number.isInteger(sessionId)) {
      try { caseStyle = sessionRolls.getSettings(db, sessionId).portrait_style || ''; } catch { caseStyle = ''; }
    }
    const workflow = JSON.parse(JSON.stringify(PORTRAIT_RANDOM_WORKFLOW_TEMPLATE));
    workflow['1'].inputs.unet_name = effectiveComfyuiImageModel();
    const promptText = buildPortraitPromptFromSheet(sheet, caseStyle);
    const seed = Math.floor(Math.random() * 2 ** 31);
    workflow['4'].inputs.text = promptText;
    workflow['8'].inputs.seed = seed;

    logLine('portrait.random', {
      userId: req.user.id,
      workflow: 'qwen_image',
      diffusionModel: QWEN_IMAGE_MODELS.diffusionModel,
      textEncoder: QWEN_IMAGE_MODELS.textEncoder,
      vae: QWEN_IMAGE_MODELS.vae,
      width: PORTRAIT_STORAGE_SIZE.width,
      height: PORTRAIT_STORAGE_SIZE.height,
      seed,
      prompt: promptText
    });

    await prepareGpuForImage();
    touchComfyActivity();
    const upstream = await fetch(`${effectiveComfyuiUrl()}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });
    const text = await upstream.text();
    try {
      const payload = JSON.parse(text);
      if (payload && payload.node_errors && Object.keys(payload.node_errors).length) {
        logLine('portrait.random.queue_error', {
          userId: req.user.id,
          workflow: 'qwen_image',
          prompt: promptText,
          node_errors: payload.node_errors
        });
      }
    } catch {}
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(text);
  } catch (e) { next(e); }
});

// Restyle an uploaded portrait into the case's art-style (Qwen-Image-Edit).
// Reuses /portrait/history + /portrait/view for polling/fetch.
router.post('/portrait/restyle', requireAuth, async (req, res, next) => {
  try {
    if (await rejectIfAiBusy(res)) return;
    const editModel = effectiveComfyuiEditModel();
    const missingAssets = await ensureQwenPortraitAssets(editModel);
    if (missingAssets.length) {
      return res.status(503).json({
        error: `Qwen image-edit workflow is not fully installed in ComfyUI: missing ${missingAssets.join(', ')}.`
      });
    }
    const { buffer, ext } = decodeImageDataUrl(req.body && req.body.image);
    const sessionId = parseInt(req.body && req.body.sessionId, 10);
    let caseStyle = '';
    if (Number.isInteger(sessionId)) {
      try { caseStyle = sessionRolls.getSettings(db, sessionId).portrait_style || ''; } catch { caseStyle = ''; }
    }
    // strength → denoise. With the Plus reference conditioning the restyle
    // wants denoise 1.0; lowering it pulls back toward the literal source
    // (≈ no restyle), so default 1.0 and don't allow it below 0.6.
    let denoise = parseFloat(req.body && req.body.strength);
    if (!Number.isFinite(denoise)) denoise = 1.0;
    denoise = Math.min(1, Math.max(0.6, denoise));

    const uploadedName = await uploadImageToComfy(buffer, ext);
    const instruction = buildRestyleInstruction(caseStyle);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const workflow = JSON.parse(JSON.stringify(PORTRAIT_RESTYLE_WORKFLOW_TEMPLATE));
    workflow['1'].inputs.unet_name = editModel;
    workflow['11'].inputs.image = uploadedName;
    workflow['4'].inputs.prompt = instruction;
    workflow['8'].inputs.seed = seed;
    workflow['8'].inputs.denoise = denoise;

    logLine('portrait.restyle', {
      userId: req.user.id,
      workflow: 'qwen_image_edit',
      editModel,
      sourceImage: uploadedName,
      seed,
      denoise,
      prompt: instruction
    });

    await prepareGpuForImage();
    touchComfyActivity();
    const upstream = await fetch(`${effectiveComfyuiUrl()}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });
    const text = await upstream.text();
    try {
      const payload = JSON.parse(text);
      if (payload && payload.node_errors && Object.keys(payload.node_errors).length) {
        logLine('portrait.restyle.queue_error', { userId: req.user.id, node_errors: payload.node_errors });
      }
    } catch {}
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(text);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Poll for completion of a queued prompt.
router.get('/portrait/history/:id', requireAuth, async (req, res, next) => {
  try {
    touchComfyActivity();
    const upstream = await fetch(`${effectiveComfyuiUrl()}/history/${encodeURIComponent(req.params.id)}`);
    const text = await upstream.text();
    try {
      const payload = JSON.parse(text);
      const entry = payload && payload[req.params.id];
      if (entry && entry.status && entry.status.status_str === 'error') {
        logLine('portrait.random.history_error', {
          promptId: req.params.id,
          status: entry.status
        });
      }
    } catch {}
    res.status(upstream.status)
       .type(upstream.headers.get('content-type') || 'application/json')
       .send(text);
  } catch (e) { next(e); }
});

// Fetch a generated image. Streams bytes straight through.
router.get('/portrait/view', requireAuth, async (req, res, next) => {
  try {
    touchComfyActivity();
    const url = new URL(`${effectiveComfyuiUrl()}/view`);
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

// ── GM handouts (text prompt → ComfyUI image, saved GM-only) ─────────────────
// Reuses the Qwen image workflow and the generic /portrait/history + /portrait/
// view proxies; only the submit differs (free-text prompt, page-ish size).
router.post('/sessions/:id/handouts/generate', requireGM, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const prompt = String((req.body && req.body.prompt) || '').trim();
    if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });
    if (await rejectIfAiBusy(res)) return;
    const missingAssets = await ensureQwenPortraitAssets();
    if (missingAssets.length) {
      return res.status(503).json({ error: `Qwen image workflow is not fully installed in ComfyUI: missing ${missingAssets.join(', ')}.` });
    }
    const sizeKey = HANDOUT_SIZES[req.body && req.body.size] ? req.body.size : HANDOUT_SIZE_DEFAULT;
    const size = HANDOUT_SIZES[sizeKey];
    const workflow = JSON.parse(JSON.stringify(PORTRAIT_RANDOM_WORKFLOW_TEMPLATE));
    workflow['1'].inputs.unet_name = effectiveComfyuiImageModel();
    const seed = Math.floor(Math.random() * 2 ** 31);
    workflow['4'].inputs.text = prompt;
    workflow['7'].inputs.width = size.width;
    workflow['7'].inputs.height = size.height;
    workflow['8'].inputs.seed = seed;
    workflow['10'].inputs.filename_prefix = 'ROL_handout';
    logLine('handout.generate', { userId: req.user.id, sessionId: session.id, seed, size: sizeKey, width: size.width, height: size.height, prompt });
    await prepareGpuForImage();
    touchComfyActivity();
    const upstream = await fetch(`${effectiveComfyuiUrl()}/prompt`, {
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

// Persist a chosen ComfyUI result into the session's GM-only handout area.
router.post('/sessions/:id/handouts/save', requireGM, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const { filename, subfolder, type, name, prompt, replace_path } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'Missing image reference.' });
    touchComfyActivity();
    const url = new URL(`${effectiveComfyuiUrl()}/view`);
    url.searchParams.set('filename', String(filename));
    if (subfolder) url.searchParams.set('subfolder', String(subfolder));
    url.searchParams.set('type', String(type || 'output'));
    const up = await fetch(url);
    if (!up.ok) return res.status(502).json({ error: `Could not fetch the image from ComfyUI (HTTP ${up.status}).` });
    const buf = Buffer.from(await up.arrayBuffer());
    const ext = path.extname(String(filename)).toLowerCase() || '.png';
    const saved = saveSessionHandout(session.id, db, { bytes: buf, name, ext, prompt, replacePath: replace_path });
    res.json({ ok: true, ...saved });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Toggle a saved asset (handout, etc.) between GM-only and player-visible by
// moving it between the GM/ and input/ subtrees.
router.post('/sessions/:id/assets/visibility', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const { path: assetPath, visibility } = req.body || {};
    if (!assetPath) return res.status(400).json({ error: 'Missing asset path.' });
    res.json(setSessionAssetVisibility(session.id, db, assetPath, visibility));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Body → Buffer. `text` (UTF-8) for Create, `content_base64` for Upload/Replace.
function fileBytesFromBody(body) {
  if (body && typeof body.text === 'string') return Buffer.from(body.text, 'utf8');
  if (body && typeof body.content_base64 === 'string' && body.content_base64) {
    return Buffer.from(body.content_base64.replace(/^data:[^,]*,/, ''), 'base64');
  }
  return null;
}

// Create a new file, or upload one (text or base64 bytes).
router.post('/sessions/:id/files', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const bytes = fileBytesFromBody(req.body);
    if (bytes === null) return res.status(400).json({ error: 'Provide text or content_base64.' });
    res.json(createSessionFile(session.id, db, {
      name: req.body && req.body.name,
      bytes,
      area: (req.body && req.body.area) === 'player' ? 'player' : 'gm'
    }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Rename a file in place (same folder, visibility unchanged).
router.post('/sessions/:id/files/rename', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    res.json(renameSessionFile(session.id, db, {
      path: req.body && req.body.path,
      name: req.body && req.body.name
    }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Replace an existing file's contents in place (keeps path/visibility).
router.post('/sessions/:id/files/replace', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const bytes = fileBytesFromBody(req.body);
    if (bytes === null) return res.status(400).json({ error: 'Provide text or content_base64.' });
    res.json(replaceSessionFile(session.id, db, { path: req.body && req.body.path, bytes }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Delete a file (Edit Files). Structural sources/artifacts are refused
// server-side; a graphic's .prompt.txt sidecar is removed alongside it.
// Restore a globaldata-seeded file to its globaldata version. Body:
// { relative_path }. These files are re-seeded when missing, so the Edit Files
// UI offers Revert (not Delete) for them.
router.post('/sessions/:id/files/revert', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    const saved = revertSeededFile(session, req.body && req.body.relative_path);
    res.json({ ok: true, path: saved });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

router.post('/sessions/:id/files/delete', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    res.json(deleteSessionFile(session.id, db, { path: req.body && req.body.path }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Save an edited image prompt (its "<file>.prompt.txt" sidecar) without
// regenerating the picture.
router.post('/sessions/:id/files/prompt', requireGM, (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    res.json(saveSessionFilePrompt(session.id, db, {
      path: req.body && req.body.path,
      text: req.body && req.body.text
    }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Have the LLM draft a text-to-image prompt for an index entity, using the
// per-case art style. Subject to the shared single-AI-task gate.
router.post('/sessions/:id/entities/graphic-prompt', requireGM, async (req, res, next) => {
  try {
    const session = getAccessibleSession(req, res, req.params.id);
    if (!session) return;
    if (await gateLlmStart(res)) return;
    // Index-entity graphics are NOT character-sheet portraits — never reuse the
    // per-case portrait_style here; it would force portrait aspect/framing onto
    // places and objects.
    const result = await generateEntityImagePrompt(session.id, db, {
      name: req.body && req.body.name,
      kind: req.body && req.body.kind,
      description: req.body && req.body.description,
      style: DEFAULT_ENTITY_ART_STYLE
    });
    res.json(result);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// Render an in-memory sheet to PDF using the canonical buildPdf() from
// scripts/export-character-sheet.js. Accepts the sheet object so the browser
// can export unsaved edits — no DB lookup needed.
router.post('/sheet/render-pdf', requireAuth, async (req, res) => {
  try {
    const sheet = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
    const blankPath = path.join(__dirname, '..', 'Rivers_of_London', 'RoL_Charsheet.pdf');
    const pdfBytes = await buildPdf(sheet, blankPath);
    const slug = (String(sheet.name || 'character')
      .replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')) || 'character';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.setHeader('Content-Length', pdfBytes.length);
    res.end(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('PDF render failed:', e);
    res.status(500).json({ error: e.message || 'PDF render failed' });
  }
});

// GM-only: stream a .zip of the entire data/ folder (SQLite DB, case files,
// galleries, app-config) for an out-of-band backup. Spawned `zip` writes the
// archive to stdout — no temp file, no buffering, no dependency. Archive
// entries are rooted at `data/...` so it restores cleanly over the repo.
router.get('/admin/backup', requireGM, (req, res) => {
  const parent = path.dirname(DATA_ROOT);
  const base = path.basename(DATA_ROOT);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="rol-backup-${stamp}.zip"`);
  const zip = spawn('zip', ['-r', '-q', '-', base], { cwd: parent });
  let failed = false;
  zip.on('error', (e) => {
    failed = true;
    logLine('admin.backup_error', { error: String((e && e.message) || e) });
    if (!res.headersSent) res.status(500).json({ error: 'zip is not available on the server' });
    else res.end();
  });
  zip.stdout.pipe(res);
  zip.on('close', (code) => {
    if (!failed && code !== 0) logLine('admin.backup_error', { code });
    if (!res.writableEnded) res.end();
  });
  // Client aborted the download — don't leave a zip process running.
  req.on('close', () => { try { zip.kill('SIGKILL'); } catch (_) { /* gone */ } });
  logLine('admin.backup', { userId: req.user && req.user.id });
});

module.exports = router;
