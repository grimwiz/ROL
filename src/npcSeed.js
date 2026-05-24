const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NPC_DIR = path.join(REPO_ROOT, 'Rivers_of_London', 'globaldata', 'npcs');
const CANONICAL_CASES_DIR = path.join(REPO_ROOT, 'Rivers_of_London', 'canonical', 'cases');

function slugify(value) {
  return String(value || 'npc').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'npc';
}

function readJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => {
      try {
        return { file: f, path: path.join(root, f), npc: JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) };
      } catch (e) {
        console.error(`Skipping ${f}: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function readNpcFiles() {
  const files = readJsonFiles(NPC_DIR);
  if (fs.existsSync(CANONICAL_CASES_DIR)) {
    for (const entry of fs.readdirSync(CANONICAL_CASES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      files.push(...readJsonFiles(path.join(CANONICAL_CASES_DIR, entry.name, 'npcs')));
    }
  }
  return files;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeScope(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return [...new Set(raw
    .map((v) => String(v || '').trim())
    .filter((v) => v && normalizeKey(v) !== 'global'))];
}

function sessionScopeIndex(db) {
  const rows = db.prepare('SELECT id, name, system_key FROM sessions').all();
  const index = new Map();
  for (const row of rows) {
    for (const key of [row.name, row.system_key, normalizeKey(row.name), normalizeKey(row.system_key)]) {
      const normalized = normalizeKey(key);
      if (normalized && !index.has(normalized)) index.set(normalized, row.id);
    }
  }
  return index;
}

function npcScopes(db, npcId) {
  return db.prepare(`
    SELECT s.name
    FROM sessions s
    JOIN npc_sessions ns ON ns.session_id = s.id
    WHERE ns.npc_id = ?
    ORDER BY s.name COLLATE NOCASE
  `).all(npcId).map((row) => row.name);
}

// Insert any archived NPC whose name is not already present, then surface NPCs
// in cases named by the JSON `scope` array. Seeding only fills gaps and creates
// missing allocation links; it never overwrites GM edits in the DB.
function seedNpcArchives(db, options = {}) {
  const sessionIndex = sessionScopeIndex(db);
  const scopeFilter = new Set((options.scopes || []).map(normalizeKey).filter(Boolean));
  const scopeFilterSessions = new Set([...scopeFilter].map((key) => sessionIndex.get(key)).filter(Boolean));
  const find = db.prepare("SELECT id FROM npcs WHERE name = ? COLLATE NOCASE");
  const insert = db.prepare(`
    INSERT INTO npcs (name, role, status, location, summary, notes, sheet, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const findLink = db.prepare('SELECT 1 FROM npc_sessions WHERE npc_id = ? AND session_id = ?');
  const insertLink = db.prepare('INSERT INTO npc_sessions (npc_id, session_id) VALUES (?, ?)');
  let seeded = 0;
  let allocated = 0;
  let unresolved = 0;
  const touchedSessions = new Set();

  const tx = db.transaction(() => {
    for (const { npc } of readNpcFiles()) {
      const name = String(npc && npc.name || '').trim();
      if (!name || find.get(name)) continue;
      insert.run(
        name,
        String(npc.role || ''),
        String(npc.status || ''),
        String(npc.location || ''),
        String(npc.summary || ''),
        String(npc.notes || ''),
        npc.sheet ? JSON.stringify(npc.sheet) : null
      );
      seeded += 1;
    }
  });
  tx();

  const allocationTx = db.transaction(() => {
    for (const { npc } of readNpcFiles()) {
      const name = String(npc && npc.name || '').trim();
      if (!name) continue;
      const scopes = normalizeScope(npc.scope);
      if (!scopes.length) continue;
      const row = find.get(name);
      if (!row) continue;
      for (const scope of scopes) {
        const scopeKey = normalizeKey(scope);
        const sessionId = sessionIndex.get(scopeKey);
        if (scopeFilter.size && !scopeFilter.has(scopeKey) && !scopeFilterSessions.has(sessionId)) continue;
        if (!sessionId) {
          unresolved += 1;
          continue;
        }
        if (findLink.get(row.id, sessionId)) continue;
        insertLink.run(row.id, sessionId);
        touchedSessions.add(sessionId);
        allocated += 1;
      }
    }
  });
  allocationTx();

  if (touchedSessions.size) {
    const { regenerateNpcSummaries } = require('./scenarioInfo');
    regenerateNpcSummaries(db, [...touchedSessions]);
  }

  if (seeded || allocated) {
    console.log(`Seeded ${seeded} NPC sheet(s) and allocated ${allocated} case link(s) from archived NPC JSON.`);
  }
  if (unresolved) {
    console.warn(`Skipped ${unresolved} NPC scope value(s) that did not match an existing case.`);
  }
  return { seeded, allocated, unresolved };
}

function seedGlobalNpcs(db) {
  return seedNpcArchives(db);
}

// Write current NPC sheets in the DB back out to their archive JSON files so a
// GM can correct a sheet in the web app and persist it as the canonical copy.
function exportGlobalNpcs(db) {
  fs.mkdirSync(NPC_DIR, { recursive: true });
  const archivePaths = new Map();
  for (const { npc, path: archivePath } of readNpcFiles()) {
    const name = normalizeKey(npc && npc.name);
    if (name && !archivePaths.has(name)) archivePaths.set(name, archivePath);
  }
  const rows = db.prepare("SELECT * FROM npcs ORDER BY name COLLATE NOCASE").all();
  let written = 0;
  for (const row of rows) {
    let sheet = null;
    try { sheet = row.sheet ? JSON.parse(row.sheet) : null; } catch { sheet = null; }
    const out = {
      name: row.name,
      scope: npcScopes(db, row.id),
      role: row.role || '',
      status: row.status || '',
      location: row.location || '',
      summary: row.summary || '',
      notes: row.notes || '',
      sheet
    };
    const target = archivePaths.get(normalizeKey(row.name)) || path.join(NPC_DIR, `${slugify(row.name)}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    written += 1;
  }
  return written;
}

module.exports = { seedNpcArchives, seedGlobalNpcs, exportGlobalNpcs, NPC_DIR };
