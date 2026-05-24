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
    role TEXT,
    status TEXT,
    location TEXT,
    summary TEXT,
    notes TEXT,
    sheet TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_npcs_name ON npcs(name COLLATE NOCASE);

  -- NPCs are allocated to arbitrary cases (or none), the same way players are.
  -- The character sheet itself lives only on npcs.sheet; this join table is
  -- deliberately allocation-only so recurring NPCs do not drift per case.
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

// Generalise the Luck-adjustment ledger to any current stat (luck/hp/mp).
const adjColumns = db.prepare("PRAGMA table_info(session_luck_adjustments)").all();
if (adjColumns.length && !adjColumns.some((c) => c.name === 'stat')) {
  db.exec("ALTER TABLE session_luck_adjustments ADD COLUMN stat TEXT NOT NULL DEFAULT 'luck'");
}

// Per-case ruleset. 'rol' (default) hides SIZ and its CoC-style HP/Build
// derivations; 'coc' keeps them for groups running Call-of-Cthulhu-style play.
const setColumns = db.prepare("PRAGMA table_info(session_settings)").all();
if (setColumns.length && !setColumns.some((c) => c.name === 'ruleset')) {
  db.exec("ALTER TABLE session_settings ADD COLUMN ruleset TEXT NOT NULL DEFAULT 'rol'");
}

// Per-case portrait art-style. Free text appended to the auto-generated
// portrait prompt; empty/NULL falls back to the built-in default style so
// existing cases are unchanged.
const setColumns2 = db.prepare("PRAGMA table_info(session_settings)").all();
if (setColumns2.length && !setColumns2.some((c) => c.name === 'portrait_style')) {
  db.exec("ALTER TABLE session_settings ADD COLUMN portrait_style TEXT");
}

// Built-in editable cases, such as The Bookshop, are normal sessions with a
// stable system key. Their files are seeded from Rivers_of_London/canonical
// into data/sessions/<slug>/ and can be reset without touching the seed copy.
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all();
if (sessionColumns.length && !sessionColumns.some((c) => c.name === 'system_key')) {
  db.exec("ALTER TABLE sessions ADD COLUMN system_key TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_system_key ON sessions(system_key) WHERE system_key IS NOT NULL");

// The app keeps a single NPC sheet per NPC. Any legacy scenario-scoped NPC rows
// and per-case sheet copies are discarded; npc_sessions is allocation-only.
const npcColumns = db.prepare("PRAGMA table_info(npcs)").all();
const nsColumns = db.prepare("PRAGMA table_info(npc_sessions)").all();
const npcNames = new Set(npcColumns.map((c) => c.name));
const nsNames = new Set(nsColumns.map((c) => c.name));
const rebuildNpcs = npcColumns.length && (npcNames.has('scope') || npcNames.has('session_id') || !npcNames.has('sheet'));
const rebuildNpcSessions = nsColumns.length && nsNames.has('sheet');
if (rebuildNpcs || rebuildNpcSessions) {
  const sheetSelect = npcNames.has('sheet') ? 'sheet' : 'NULL AS sheet';
  const npcFilter = npcNames.has('scope') ? "WHERE scope = 'global'" : '';
  try {
    db.pragma('foreign_keys = OFF');
    if (rebuildNpcs) {
      db.exec(`
        DROP TABLE IF EXISTS npcs_new;
        CREATE TABLE npcs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          role TEXT,
          status TEXT,
          location TEXT,
          summary TEXT,
          notes TEXT,
          sheet TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO npcs_new (id, name, role, status, location, summary, notes, sheet, created_at, updated_at)
          SELECT id, name, role, status, location, summary, notes, ${sheetSelect}, created_at, updated_at
          FROM npcs
          ${npcFilter};
        DROP TABLE npcs;
        ALTER TABLE npcs_new RENAME TO npcs;
      `);
    }
    if (rebuildNpcSessions) {
      db.exec(`
        DROP TABLE IF EXISTS npc_sessions_new;
        CREATE TABLE npc_sessions_new (
          npc_id INTEGER NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          PRIMARY KEY (npc_id, session_id)
        );
        INSERT OR IGNORE INTO npc_sessions_new (npc_id, session_id)
          SELECT ns.npc_id, ns.session_id
          FROM npc_sessions ns
          JOIN npcs n ON n.id = ns.npc_id
          JOIN sessions s ON s.id = ns.session_id;
        DROP TABLE npc_sessions;
        ALTER TABLE npc_sessions_new RENAME TO npc_sessions;
      `);
    } else if (rebuildNpcs) {
      db.exec(`
        DELETE FROM npc_sessions
        WHERE npc_id NOT IN (SELECT id FROM npcs)
           OR session_id NOT IN (SELECT id FROM sessions);
      `);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
  if (fkProblems.length) {
    throw new Error(`Database migration left ${fkProblems.length} foreign-key problem(s)`);
  }
}
db.exec("CREATE INDEX IF NOT EXISTS idx_npcs_name ON npcs(name COLLATE NOCASE)");
db.exec("CREATE INDEX IF NOT EXISTS idx_npc_sessions_session ON npc_sessions(session_id)");

module.exports = db;
