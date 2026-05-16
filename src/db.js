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
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS domestic_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS npcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','scenario')),
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT,
    status TEXT,
    location TEXT,
    summary TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    CHECK(scope = 'global' OR session_id IS NOT NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_npcs_scope_session ON npcs(scope, session_id);
  CREATE INDEX IF NOT EXISTS idx_npcs_name ON npcs(name COLLATE NOCASE);

  -- NPCs are allocated to arbitrary cases (or none), the same way players are.
  CREATE TABLE IF NOT EXISTS npc_sessions (
    npc_id INTEGER NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (npc_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_npc_sessions_session ON npc_sessions(session_id);

  -- Per-case settings (extensible). advantage_mode governs how the GM-assigned
  -- roll handles advantage/disadvantage.
  CREATE TABLE IF NOT EXISTS session_settings (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    advantage_mode TEXT NOT NULL DEFAULT 'rol' CHECK(advantage_mode IN ('simple','rol')),
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
  -- no longer relevant. Never mutates the permanent sheet.
  CREATE TABLE IF NOT EXISTS session_character_state (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hurt INTEGER NOT NULL DEFAULT 0,
    bloodied INTEGER NOT NULL DEFAULT 0,
    down INTEGER NOT NULL DEFAULT 0,
    impaired INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_id)
  );

  -- GM-entered temporary Luck deltas (+/-) with a note; clearable like roll spends.
  CREATE TABLE IF NOT EXISTS session_luck_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    cleared_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_luck_adj_session ON session_luck_adjustments(session_id, user_id);

  DROP TABLE IF EXISTS domestic_sheets;
`);

// NPC character-sheet JSON (added after the table may already exist).
const npcColumns = db.prepare("PRAGMA table_info(npcs)").all();
if (!npcColumns.some((c) => c.name === 'sheet')) {
  db.exec('ALTER TABLE npcs ADD COLUMN sheet TEXT');
}

// Generalise the Luck-adjustment ledger to any current stat (luck/hp/mp).
const adjColumns = db.prepare("PRAGMA table_info(session_luck_adjustments)").all();
if (adjColumns.length && !adjColumns.some((c) => c.name === 'stat')) {
  db.exec("ALTER TABLE session_luck_adjustments ADD COLUMN stat TEXT NOT NULL DEFAULT 'luck'");
}

module.exports = db;
