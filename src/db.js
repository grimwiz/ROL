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

  DROP TABLE IF EXISTS domestic_sheets;
`);

// NPC character-sheet JSON (added after the table may already exist).
const npcColumns = db.prepare("PRAGMA table_info(npcs)").all();
if (!npcColumns.some((c) => c.name === 'sheet')) {
  db.exec('ALTER TABLE npcs ADD COLUMN sheet TEXT');
}

module.exports = db;
