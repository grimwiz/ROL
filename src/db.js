const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'folly.db');
const JOURNAL_MODE = String(process.env.SQLITE_JOURNAL_MODE || 'DELETE').toUpperCase();
const ALLOWED_JOURNAL_MODES = new Set(['DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'WAL', 'OFF']);

const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

if (!ALLOWED_JOURNAL_MODES.has(JOURNAL_MODE)) {
  throw new Error(`Unsupported SQLITE_JOURNAL_MODE: ${JOURNAL_MODE}`);
}

// DELETE mode keeps the deployment simpler: after each transaction, the main
// database lives in a single file on disk rather than a persistent .db + .wal
// pair. If WAL is ever wanted again for concurrency, opt back in with
// SQLITE_JOURNAL_MODE=WAL.
db.pragma(`journal_mode = ${JOURNAL_MODE}`);
db.pragma('foreign_keys = ON');

// All character sheets — player and NPC — live in character_sheets. NPC rows
// are owned by the sentinel `users` row whose username is 'NPC' (no functional
// account, password_hash='!'). Case membership is stored inside the sheet JSON
// as data.scope = [case_name, ...]. There is no per-session character row.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('gm','player')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_players (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS character_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_character_sheets_user ON character_sheets(user_id);

  CREATE TABLE IF NOT EXISTS domestic_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Per-case settings (extensible). advantage_mode governs how the GM-assigned
  -- roll handles advantage/disadvantage.
  CREATE TABLE IF NOT EXISTS session_settings (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    advantage_mode TEXT NOT NULL DEFAULT 'rol' CHECK(advantage_mode IN ('simple','rol')),
    ruleset TEXT NOT NULL DEFAULT 'rol' CHECK(ruleset IN ('rol','coc')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- GM-assigned rolls a player resolves in-app. luck_spent / restored_at are
  -- inert in P1 (the Luck ledger is P2) but present so P2 needs no migration.
  CREATE TABLE IF NOT EXISTS session_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    character_name TEXT,
    skill_label TEXT NOT NULL,
    skill_value INTEGER,
    difficulty TEXT NOT NULL DEFAULT 'regular' CHECK(difficulty IN ('regular','hard','extreme')),
    modifier TEXT NOT NULL DEFAULT 'none' CHECK(modifier IN ('none','advantage','disadvantage')),
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','cancelled')),
    rolls TEXT,
    result INTEGER,
    outcome TEXT,
    passed INTEGER,
    luck_spent INTEGER NOT NULL DEFAULT 0,
    restored_at TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_session_rolls_session ON session_rolls(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_rolls_user ON session_rolls(session_id, user_id);

  -- Per-session temporary character state (wounds), GM-managed, cleared when
  -- no longer relevant. Keyed by character_id so one NPC catalogue row can
  -- still carry wounds in each case it appears in.
  CREATE TABLE IF NOT EXISTS session_character_state (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
    hurt INTEGER NOT NULL DEFAULT 0,
    bloodied INTEGER NOT NULL DEFAULT 0,
    down INTEGER NOT NULL DEFAULT 0,
    impaired INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, character_id)
  );

  -- GM-entered temporary stat deltas with a note; clearable like roll spends.
  CREATE TABLE IF NOT EXISTS session_luck_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    note TEXT,
    stat TEXT NOT NULL DEFAULT 'luck',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    cleared_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_luck_adj_session ON session_luck_adjustments(session_id, character_id);

  DROP TABLE IF EXISTS domestic_sheets;
`);

// Pre-migration column adds against legacy tables. These run before the
// table-shape migration below so we read the most complete data we have.
const setColumns = db.prepare("PRAGMA table_info(session_settings)").all();
if (setColumns.length && !setColumns.some((c) => c.name === 'ruleset')) {
  db.exec("ALTER TABLE session_settings ADD COLUMN ruleset TEXT NOT NULL DEFAULT 'rol'");
}
const setColumns2 = db.prepare("PRAGMA table_info(session_settings)").all();
if (setColumns2.length && !setColumns2.some((c) => c.name === 'portrait_style')) {
  db.exec("ALTER TABLE session_settings ADD COLUMN portrait_style TEXT");
}
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all();
if (sessionColumns.length && !sessionColumns.some((c) => c.name === 'system_key')) {
  db.exec("ALTER TABLE sessions ADD COLUMN system_key TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_system_key ON sessions(system_key) WHERE system_key IS NOT NULL");

const adjColumns = db.prepare("PRAGMA table_info(session_luck_adjustments)").all();
if (adjColumns.length && !adjColumns.some((c) => c.name === 'stat')) {
  db.exec("ALTER TABLE session_luck_adjustments ADD COLUMN stat TEXT NOT NULL DEFAULT 'luck'");
}

// Sentinel users row that owns every NPC character sheet. Password is the
// literal '!' (cannot match any bcrypt hash) so the account can't be logged
// into. Role is 'gm' because that's what the existing CHECK constraint allows;
// admin queries that list real users should filter username='NPC' out.
db.prepare("INSERT OR IGNORE INTO users (username, password_hash, role) VALUES ('NPC', '!', 'gm')").run();
const NPC_USER_ID = db.prepare("SELECT id FROM users WHERE username = 'NPC'").get().id;

// ── Schema migration: drop session_id on character_sheets, fold npcs + npc_sessions
// into character_sheets (NPC rows owned by NPC_USER_ID), and re-key wound/luck
// tables on character_id. Idempotent — detects state per-table and exits early
// on a fresh DB.
const csColumns = db.prepare("PRAGMA table_info(character_sheets)").all();
const csHasSessionId = csColumns.some((c) => c.name === 'session_id');
const npcsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npcs'").get();
const npcSessionsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_sessions'").get();
const scsColumns = db.prepare("PRAGMA table_info(session_character_state)").all();
const scsHasUserId = scsColumns.some((c) => c.name === 'user_id');
const slaColumns = db.prepare("PRAGMA table_info(session_luck_adjustments)").all();
const slaHasUserId = slaColumns.some((c) => c.name === 'user_id');

if (csHasSessionId || npcsTable || scsHasUserId || slaHasUserId) {
  db.pragma('foreign_keys = OFF');
  try {
    function scopeKey(name) {
      return String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, ' ');
    }
    function mergeScope(...lists) {
      const out = [];
      const seen = new Set();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const v of list) {
          const name = String(v == null ? '' : v).trim();
          if (!name) continue;
          const key = scopeKey(name);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(name);
        }
      }
      return out;
    }

    const migrate = db.transaction(() => {
      const sessionNameById = new Map(
        db.prepare('SELECT id, name FROM sessions').all().map((s) => [s.id, s.name])
      );

      // 1. character_sheets table-swap. Drops session_id; folds the old session
      //    name into data.scope. (session_id, user_id) → new id map is needed so
      //    the wound/luck rebuilds can resolve their references; the row id stays.
      const oldCharByKey = new Map();
      if (csHasSessionId) {
        const oldSheets = db.prepare('SELECT id, session_id, user_id, data, updated_at FROM character_sheets').all();
        db.exec("ALTER TABLE character_sheets RENAME TO character_sheets_old_migrate");
        db.exec(`
          CREATE TABLE character_sheets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            data TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now'))
          );
        `);
        const insertSheet = db.prepare(
          "INSERT INTO character_sheets (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)"
        );
        for (const row of oldSheets) {
          let parsed;
          try { parsed = JSON.parse(row.data || '{}'); } catch { parsed = {}; }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
          const sessionName = sessionNameById.get(row.session_id);
          parsed.scope = mergeScope(parsed.scope, sessionName ? [sessionName] : []);
          // Older codex schemas stored NPCs with user_id IS NULL; reseat them
          // on the NPC sentinel user so the new NOT NULL constraint holds.
          const ownerId = row.user_id != null ? row.user_id : NPC_USER_ID;
          insertSheet.run(row.id, ownerId, JSON.stringify(parsed), row.updated_at);
          oldCharByKey.set(`${row.session_id}:${row.user_id == null ? 'NPC' : row.user_id}`, row.id);
        }
        db.exec("DROP TABLE character_sheets_old_migrate");
      }

      // 2. npcs + npc_sessions → character_sheets (user_id = NPC_USER_ID). One-to-one
      //    copy; legacy duplicates are preserved as-is and cleaned manually.
      if (npcsTable) {
        const npcSessionScopes = new Map(); // npc_id → [session_name,...]
        if (npcSessionsTable) {
          const links = db.prepare('SELECT npc_id, session_id FROM npc_sessions').all();
          for (const link of links) {
            const name = sessionNameById.get(link.session_id);
            if (!name) continue;
            if (!npcSessionScopes.has(link.npc_id)) npcSessionScopes.set(link.npc_id, []);
            npcSessionScopes.get(link.npc_id).push(name);
          }
        }
        const npcCols = db.prepare("PRAGMA table_info(npcs)").all().map((c) => c.name);
        const has = (n) => npcCols.includes(n);
        const selectCols = ['id', 'name'];
        for (const c of ['role', 'status', 'location', 'summary', 'notes', 'sheet', 'updated_at']) {
          if (has(c)) selectCols.push(c);
        }
        const rows = db.prepare(`SELECT ${selectCols.join(',')} FROM npcs`).all();
        const insertNpc = db.prepare(
          "INSERT INTO character_sheets (user_id, data, updated_at) VALUES (?, ?, ?)"
        );
        for (const row of rows) {
          let sheet = {};
          if (has('sheet') && row.sheet) {
            try {
              const parsed = JSON.parse(row.sheet);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) sheet = parsed;
            } catch { /* fall through */ }
          }
          const data = { ...sheet };
          if (!data.name && row.name) data.name = row.name;
          for (const k of ['role', 'status', 'location', 'summary', 'notes']) {
            if (has(k) && row[k] != null && row[k] !== '' && data[k] == null) data[k] = row[k];
          }
          data.scope = mergeScope(sheet.scope, npcSessionScopes.get(row.id));
          const updatedAt = (has('updated_at') && row.updated_at) || new Date().toISOString();
          insertNpc.run(NPC_USER_ID, JSON.stringify(data), updatedAt);
        }
        if (npcSessionsTable) db.exec("DROP TABLE npc_sessions");
        db.exec("DROP TABLE npcs");
      }

      // 3. session_character_state: (session_id, user_id) → (session_id, character_id).
      if (scsHasUserId) {
        const oldState = db.prepare('SELECT session_id, user_id, hurt, bloodied, down, impaired, updated_at FROM session_character_state').all();
        db.exec("ALTER TABLE session_character_state RENAME TO session_character_state_old_migrate");
        db.exec(`
          CREATE TABLE session_character_state (
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
            hurt INTEGER NOT NULL DEFAULT 0,
            bloodied INTEGER NOT NULL DEFAULT 0,
            down INTEGER NOT NULL DEFAULT 0,
            impaired INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (session_id, character_id)
          );
        `);
        const insState = db.prepare(`
          INSERT OR IGNORE INTO session_character_state
          (session_id, character_id, hurt, bloodied, down, impaired, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of oldState) {
          const charId = oldCharByKey.get(`${s.session_id}:${s.user_id}`);
          if (!charId) continue; // No matching sheet — orphan wound row, drop.
          insState.run(s.session_id, charId, s.hurt || 0, s.bloodied || 0, s.down || 0, s.impaired || 0, s.updated_at);
        }
        db.exec("DROP TABLE session_character_state_old_migrate");
      }

      // 4. session_luck_adjustments: (session_id, user_id) → (session_id, character_id).
      if (slaHasUserId) {
        const cols = db.prepare("PRAGMA table_info(session_luck_adjustments)").all().map((c) => c.name);
        const hasStat = cols.includes('stat');
        const oldLuck = db.prepare(`
          SELECT id, session_id, user_id, delta, note, ${hasStat ? 'stat' : "'luck' AS stat"},
                 created_by, created_at, cleared_at
          FROM session_luck_adjustments
        `).all();
        db.exec("ALTER TABLE session_luck_adjustments RENAME TO session_luck_adjustments_old_migrate");
        db.exec(`
          CREATE TABLE session_luck_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
            delta INTEGER NOT NULL,
            note TEXT,
            stat TEXT NOT NULL DEFAULT 'luck',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT (datetime('now')),
            cleared_at TEXT
          );
        `);
        const insLuck = db.prepare(`
          INSERT INTO session_luck_adjustments
          (id, session_id, character_id, delta, note, stat, created_by, created_at, cleared_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of oldLuck) {
          const charId = oldCharByKey.get(`${r.session_id}:${r.user_id}`);
          if (!charId) continue;
          insLuck.run(r.id, r.session_id, charId, r.delta, r.note, r.stat || 'luck', r.created_by, r.created_at, r.cleared_at);
        }
        db.exec("DROP TABLE session_luck_adjustments_old_migrate");
        db.exec("CREATE INDEX IF NOT EXISTS idx_luck_adj_session ON session_luck_adjustments(session_id, character_id)");
      }
    });
    migrate();

    const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
    if (fkProblems.length) {
      throw new Error(`Database migration left ${fkProblems.length} foreign-key problem(s)`);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

db.NPC_USER_ID = NPC_USER_ID;
module.exports = db;
