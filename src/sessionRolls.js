// GM-assigned rolls a player resolves in-app (Phase 1: no Luck ledger yet).
// Pure dice/outcome helpers are exported for direct testing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSessionById, ensureSessionDataFolders } = require('./scenarioInfo');

const REPO_ROOT = path.join(__dirname, '..');
const repoRel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

const DIFFICULTIES = new Set(['regular', 'hard', 'extreme']);
const MODIFIERS = new Set(['none', 'advantage', 'disadvantage']);

// ── Pure dice / outcome ──────────────────────────────────────────────────────
function d10() {
  return crypto.randomInt(0, 10); // 0..9
}

function percentileFrom(tens, units) {
  const v = tens * 10 + units;
  return v === 0 ? 100 : v; // '00' + '0' = 100 (BRP/RoL)
}

// modifier: none|advantage|disadvantage ; mode: simple|rol
function rollDice(modifier, mode) {
  if (modifier === 'none' || !MODIFIERS.has(modifier)) {
    const tens = d10();
    const units = d10();
    return { result: percentileFrom(tens, units), dice: { mode, modifier: 'none', tens, units } };
  }
  if (mode === 'simple') {
    const a = percentileFrom(d10(), d10());
    const b = percentileFrom(d10(), d10());
    const result = modifier === 'advantage' ? Math.min(a, b) : Math.max(a, b);
    return { result, dice: { mode, modifier, rolls: [a, b], kept: result } };
  }
  // RoL bonus/penalty die: one units die, two tens dice, keep better/worse tens.
  const units = d10();
  const t1 = d10();
  const t2 = d10();
  const tens = modifier === 'advantage' ? Math.min(t1, t2) : Math.max(t1, t2);
  return { result: percentileFrom(tens, units), dice: { mode, modifier, units, tensDice: [t1, t2], keptTens: tens } };
}

function thresholds(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return { regular: value, hard: Math.floor(value / 2), extreme: Math.floor(value / 5) };
}

// Success level + whether it meets the assigned difficulty.
function computeOutcome(result, value, difficulty) {
  const th = thresholds(value);
  if (!th) return { outcome: 'unadjudicated', passed: null };
  const fumble = result === 100 || (value < 50 && result >= 96);
  if (fumble) return { outcome: 'fumble', passed: false };
  if (result === 1) return { outcome: 'critical', passed: true };
  let outcome;
  if (result <= th.extreme) outcome = 'extreme';
  else if (result <= th.hard) outcome = 'hard';
  else if (result <= th.regular) outcome = 'regular';
  else outcome = 'failure';
  const need = th[difficulty] != null ? th[difficulty] : th.regular;
  return { outcome, passed: result <= need };
}

// Pull a skill / characteristic % from a character sheet by free-text label.
function skillValueFromSheet(sheet, label) {
  if (!sheet || typeof sheet !== 'object' || !label) return null;
  const want = String(label).trim().toLowerCase();
  const num = (v) => {
    const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  for (const key of ['common_skills', 'mandatory_skills', 'additional_skills', 'combat_skills']) {
    for (const row of Array.isArray(sheet[key]) ? sheet[key] : []) {
      if (row && String(row.name || '').trim().toLowerCase() === want) return num(row.value);
    }
  }
  const chars = { str: 'str', con: 'con', dex: 'dex', int: 'int', pow: 'pow', siz: 'siz', luck: 'luck' };
  if (chars[want] && sheet[want] != null) return num(sheet[want]);
  if (sheet.derived && sheet.derived[want] != null) return num(sheet.derived[want]);
  return null;
}

// ── Settings ─────────────────────────────────────────────────────────────────
function getSettings(db, sessionId) {
  const row = db.prepare('SELECT advantage_mode FROM session_settings WHERE session_id = ?').get(sessionId);
  return { advantage_mode: (row && row.advantage_mode) || 'rol' };
}

function setSettings(db, sessionId, advantageMode) {
  const mode = advantageMode === 'simple' ? 'simple' : 'rol';
  db.prepare(`
    INSERT INTO session_settings (session_id, advantage_mode, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET advantage_mode = excluded.advantage_mode, updated_at = datetime('now')
  `).run(sessionId, mode);
  return getSettings(db, sessionId);
}

// ── Rolls ────────────────────────────────────────────────────────────────────
function rowToRoll(row) {
  let dice = null;
  try { dice = row.rolls ? JSON.parse(row.rolls) : null; } catch { dice = null; }
  return {
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    character_name: row.character_name || '',
    skill_label: row.skill_label,
    skill_value: row.skill_value,
    difficulty: row.difficulty,
    modifier: row.modifier,
    comment: row.comment || '',
    status: row.status,
    // pending + already rolled = waiting for the player's Luck decision.
    awaiting_luck: row.status === 'pending' && row.result != null,
    dice,
    result: row.result,
    raw_result: dice && dice.rawResult != null ? dice.rawResult : row.result,
    outcome: row.outcome,
    passed: row.passed == null ? null : !!row.passed,
    luck_spent: row.luck_spent || 0,
    restored_at: row.restored_at || null,
    created_at: row.created_at,
    resolved_at: row.resolved_at
  };
}

// Base Luck (from the player's sheet for this case) minus unrestored Luck
// already spent on resolved rolls this session. The sheet stat is never written.
function luckForUser(db, sessionId, userId) {
  const sheetRow = db.prepare('SELECT data FROM character_sheets WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  let base = 0;
  try {
    const sheet = sheetRow && sheetRow.data ? JSON.parse(sheetRow.data) : null;
    const n = sheet ? parseInt(String(sheet.luck).replace(/[^0-9-]/g, ''), 10) : NaN;
    base = Number.isFinite(n) ? n : 0;
  } catch { base = 0; }
  const spentRow = db.prepare("SELECT COALESCE(SUM(luck_spent),0) s FROM session_rolls WHERE session_id = ? AND user_id = ? AND status = 'resolved' AND restored_at IS NULL").get(sessionId, userId);
  const spent = spentRow ? spentRow.s : 0;
  return { base, spent, effective: base - spent };
}

// Max Luck spendable on a just-rolled result (RoL caps).
function luckCap(result, outcome, skillValue, available) {
  if (skillValue == null) return 0;          // unadjudicated — GM decides
  if (outcome === 'fumble') return 0;        // can't buy out of a fumble
  return Math.max(0, Math.min(available, result - 2)); // can't reach a Critical (1)
}

function luckLedger(db, sessionId) {
  const players = db.prepare(`
    SELECT sp.user_id, u.username FROM session_players sp
    JOIN users u ON u.id = sp.user_id WHERE sp.session_id = ?
  `).all(sessionId);
  return players.map((p) => {
    const sheetRow = db.prepare('SELECT data FROM character_sheets WHERE session_id = ? AND user_id = ?').get(sessionId, p.user_id);
    let name = p.username;
    try { const s = sheetRow && sheetRow.data ? JSON.parse(sheetRow.data) : null; if (s && String(s.name || '').trim()) name = String(s.name).trim(); } catch { /* keep username */ }
    return { user_id: p.user_id, character_name: name, ...luckForUser(db, sessionId, p.user_id) };
  });
}

function listRolls(db, sessionId, opts = {}) {
  let rows;
  if (opts.userId != null) {
    rows = db.prepare('SELECT * FROM session_rolls WHERE session_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC').all(sessionId, opts.userId);
  } else {
    rows = db.prepare('SELECT * FROM session_rolls WHERE session_id = ? ORDER BY created_at DESC, id DESC').all(sessionId);
  }
  return rows.map((row) => {
    const r = rowToRoll(row);
    if (r.awaiting_luck) {
      const a = luckForUser(db, sessionId, r.user_id);
      r.luck_available = a.effective;
      r.luck_cap = luckCap(r.raw_result, r.outcome, r.skill_value, a.effective);
    }
    return r;
  });
}

function createRoll(db, sessionId, gmUserId, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const userId = parseInt(p.user_id, 10);
  if (!Number.isInteger(userId)) return { error: 'A target player is required' };
  const assigned = db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  if (!assigned) return { error: 'That player is not assigned to this case' };

  const label = String(p.skill_label || '').trim();
  if (!label) return { error: 'A roll / skill label is required' };
  const difficulty = DIFFICULTIES.has(p.difficulty) ? p.difficulty : 'regular';
  const modifier = MODIFIERS.has(p.modifier) ? p.modifier : 'none';
  const comment = p.comment ? String(p.comment).trim().slice(0, 2000) : null;

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  const sheetRow = db.prepare('SELECT data FROM character_sheets WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  let sheet = null;
  try { sheet = sheetRow && sheetRow.data ? JSON.parse(sheetRow.data) : null; } catch { sheet = null; }
  const characterName = (sheet && String(sheet.name || '').trim()) || (user && user.username) || 'Unknown';

  let skillValue = null;
  if (p.skill_value !== '' && p.skill_value != null && Number.isFinite(parseInt(p.skill_value, 10))) {
    skillValue = parseInt(p.skill_value, 10);
  } else {
    skillValue = skillValueFromSheet(sheet, label);
  }

  const result = db.prepare(`
    INSERT INTO session_rolls (session_id, user_id, character_name, skill_label, skill_value, difficulty, modifier, comment, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
  `).run(sessionId, userId, characterName, label, skillValue, difficulty, modifier, comment, gmUserId);
  return { roll: rowToRoll(db.prepare('SELECT * FROM session_rolls WHERE id = ?').get(result.lastInsertRowid)) };
}

function rollWithLuck(db, sessionId, row) {
  const roll = rowToRoll(row);
  if (row.status !== 'pending' || row.result == null) return roll;
  const avail = luckForUser(db, sessionId, row.user_id);
  return {
    ...roll,
    luck_available: avail.effective,
    luck_cap: luckCap(row.result, row.outcome, row.skill_value, avail.effective)
  };
}

// Step 1: roll the dice (idempotent — re-calling returns the same roll so it
// can't be re-rolled). Status stays 'pending' until the player finalises with
// their Luck decision.
function resolveRoll(db, sessionId, rollId, actingUser) {
  const row = db.prepare('SELECT * FROM session_rolls WHERE id = ? AND session_id = ?').get(rollId, sessionId);
  if (!row) return { error: 'Roll not found', statusCode: 404 };
  const isGM = actingUser && actingUser.role === 'gm';
  if (!isGM && row.user_id !== (actingUser && actingUser.id)) return { error: 'Not your roll', statusCode: 403 };
  if (row.status !== 'pending') return { error: `Roll already ${row.status}`, statusCode: 409 };
  if (row.result != null) return { roll: rollWithLuck(db, sessionId, row) }; // already rolled

  const { advantage_mode } = getSettings(db, sessionId);
  const { result, dice } = rollDice(row.modifier, advantage_mode);
  const { outcome, passed } = computeOutcome(result, row.skill_value, row.difficulty);
  db.prepare(`
    UPDATE session_rolls SET rolls = ?, result = ?, outcome = ?, passed = ?
    WHERE id = ?
  `).run(JSON.stringify(dice), result, outcome, passed == null ? null : (passed ? 1 : 0), rollId);
  return { roll: rollWithLuck(db, sessionId, db.prepare('SELECT * FROM session_rolls WHERE id = ?').get(rollId)) };
}

// Step 2: apply the (optional) Luck spend and finalise. Luck lowers the result
// point-for-point, capped by RoL rules + the player's effective Luck.
function finalizeRoll(db, sessionId, rollId, actingUser, luckSpentRaw) {
  const row = db.prepare('SELECT * FROM session_rolls WHERE id = ? AND session_id = ?').get(rollId, sessionId);
  if (!row) return { error: 'Roll not found', statusCode: 404 };
  const isGM = actingUser && actingUser.role === 'gm';
  if (!isGM && row.user_id !== (actingUser && actingUser.id)) return { error: 'Not your roll', statusCode: 403 };
  if (row.status !== 'pending') return { error: `Roll already ${row.status}`, statusCode: 409 };
  if (row.result == null) return { error: 'Roll has not been rolled yet', statusCode: 409 };

  const avail = luckForUser(db, sessionId, row.user_id);
  const cap = luckCap(row.result, row.outcome, row.skill_value, avail.effective);
  let luckSpent = parseInt(luckSpentRaw, 10);
  if (!Number.isFinite(luckSpent) || luckSpent < 0) luckSpent = 0;
  luckSpent = Math.min(luckSpent, cap);

  const rawResult = row.result;
  const finalResult = rawResult - luckSpent;
  const { outcome, passed } = computeOutcome(finalResult, row.skill_value, row.difficulty);
  let dice = {};
  try { dice = row.rolls ? JSON.parse(row.rolls) : {}; } catch { dice = {}; }
  dice.rawResult = rawResult;
  dice.luckSpent = luckSpent;
  db.prepare(`
    UPDATE session_rolls
    SET status = 'resolved', rolls = ?, result = ?, outcome = ?, passed = ?, luck_spent = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(dice), finalResult, outcome, passed == null ? null : (passed ? 1 : 0), luckSpent, rollId);
  return { roll: rowToRoll(db.prepare('SELECT * FROM session_rolls WHERE id = ?').get(rollId)) };
}

// GM clears a Luck loss (refresh) — it stops counting against effective Luck.
function restoreRollLuck(db, sessionId, rollId) {
  const r = db.prepare("UPDATE session_rolls SET restored_at = datetime('now') WHERE id = ? AND session_id = ? AND status = 'resolved' AND luck_spent > 0 AND restored_at IS NULL").run(rollId, sessionId);
  if (!r.changes) return { error: 'No restorable Luck loss on that roll', statusCode: 404 };
  return { ok: true };
}

function cancelRoll(db, sessionId, rollId) {
  const r = db.prepare("UPDATE session_rolls SET status = 'cancelled' WHERE id = ? AND session_id = ? AND status = 'pending'").run(rollId, sessionId);
  if (!r.changes) return { error: 'Roll not found or not pending', statusCode: 404 };
  return { ok: true };
}

// ── Markdown mirrors ─────────────────────────────────────────────────────────
const DIFF_LABEL = { regular: 'Regular', hard: 'Hard', extreme: 'Extreme' };
const MOD_LABEL = { none: '', advantage: ' (advantage)', disadvantage: ' (disadvantage)' };

function rollHeadline(r) {
  const diff = DIFF_LABEL[r.difficulty] || r.difficulty;
  const tgt = r.skill_value == null ? '' : ` [${r.skill_value}%]`;
  return `${r.character_name} — ${r.skill_label}${tgt} (${diff})${MOD_LABEL[r.modifier] || ''}`;
}

function rollOutcomeText(r) {
  if (r.status !== 'resolved') return r.awaiting_luck ? 'rolled — awaiting Luck decision' : r.status;
  const luck = r.luck_spent ? ` (spent ${r.luck_spent} Luck; raw ${r.raw_result})` : '';
  if (r.outcome === 'unadjudicated') return `rolled ${r.result} (no target set — GM to adjudicate)${luck}`;
  const pass = r.passed == null ? '' : (r.passed ? ' — PASS' : ' — FAIL');
  return `rolled ${r.result} → ${r.outcome}${pass}${luck}`;
}

function writeRollMirrors(db, sessionId) {
  const session = getSessionById(db, sessionId);
  if (!session) return;
  const paths = ensureSessionDataFolders(session);
  const rolls = db.prepare("SELECT * FROM session_rolls WHERE session_id = ? AND status != 'cancelled' ORDER BY created_at, id").all(sessionId).map(rowToRoll);

  // GM ledger — everything, including the GM comment and Luck.
  const gm = [`# Assigned Rolls — ${session.name}`, '', '_Auto-generated GM ledger. Editable but overwritten on the next roll change._', ''];
  if (!rolls.length) gm.push('No rolls assigned yet.');
  for (const r of rolls) {
    gm.push(`## ${rollHeadline(r)}`, '');
    gm.push(`- Status: ${r.status} — ${rollOutcomeText(r)}`);
    if (r.luck_spent) gm.push(`- Luck spent: ${r.luck_spent}${r.restored_at ? ' (restored by GM)' : ' (counts against this session)'}`);
    if (r.comment) gm.push(`- GM note: ${r.comment}`);
    gm.push('');
  }
  fs.writeFileSync(path.join(paths.gmInput, 'rolls.md'), `${gm.join('\n').trim()}\n`, 'utf8');

  // Shared — resolved outcomes only, no GM comment (player + LLM visible).
  const resolved = rolls.filter((r) => r.status === 'resolved');
  const shared = [`# Rolls — ${session.name}`, '', '_Resolved dice rolls in this case (auto-generated)._', ''];
  if (!resolved.length) shared.push('No resolved rolls yet.');
  for (const r of resolved) {
    shared.push(`- **${rollHeadline(r)}** — ${rollOutcomeText(r)}`);
  }
  fs.writeFileSync(path.join(paths.root, 'rolls.md'), `${shared.join('\n').trim()}\n`, 'utf8');

  return { gm: repoRel(path.join(paths.gmInput, 'rolls.md')), shared: repoRel(path.join(paths.root, 'rolls.md')) };
}

module.exports = {
  // pure helpers (tested directly)
  rollDice,
  computeOutcome,
  thresholds,
  skillValueFromSheet,
  percentileFrom,
  // db ops
  getSettings,
  setSettings,
  listRolls,
  createRoll,
  resolveRoll,
  finalizeRoll,
  restoreRollLuck,
  cancelRoll,
  luckLedger,
  luckForUser,
  luckCap,
  writeRollMirrors
};
