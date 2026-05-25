const fs = require('fs');
const path = require('path');
const { sheetScope, scopeNameKey } = require('./characterScope');

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

function nameKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function archiveScope(npc) {
  const raw = Array.isArray(npc.scope)
    ? npc.scope
    : typeof npc.scope === 'string' ? npc.scope.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const name = String(v == null ? '' : v).trim();
    if (!name) continue;
    const key = scopeNameKey(name);
    if (!key || key === 'global') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function buildSheetData(npc) {
  const sheet = (npc.sheet && typeof npc.sheet === 'object' && !Array.isArray(npc.sheet)) ? npc.sheet : {};
  const data = { ...sheet };
  if (npc.name) data.name = String(npc.name);
  for (const k of ['role', 'status', 'location', 'summary', 'notes']) {
    if (npc[k] != null && npc[k] !== '' && data[k] == null) data[k] = String(npc[k]);
  }
  data.scope = archiveScope(npc);
  return data;
}

function npcUserId(db) {
  if (db.NPC_USER_ID) return db.NPC_USER_ID;
  const row = db.prepare("SELECT id FROM users WHERE username = 'NPC'").get();
  return row ? row.id : null;
}

function existingNpcsByNameKey(db, npcUid) {
  const out = new Map();
  for (const row of db.prepare("SELECT id, data FROM character_sheets WHERE user_id = ?").all(npcUid)) {
    let parsed;
    try { parsed = JSON.parse(row.data || '{}'); } catch { parsed = {}; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    const key = nameKey(parsed.name);
    if (key && !out.has(key)) out.set(key, { id: row.id, data: parsed });
  }
  return out;
}

function mergeScopeNames(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      const name = String(v == null ? '' : v).trim();
      if (!name) continue;
      const key = scopeNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Insert any archived NPC whose name is not already present in character_sheets
// as a row owned by the NPC sentinel user. If a matching name is present, the
// existing row's data.scope is extended to include any cases the archive
// declares — sheet data is left untouched so GM edits are never overwritten.
// `options.scopes`, if provided, restricts seeding to archive NPCs whose own
// scope intersects with the given case-name keys; an empty filter seeds all.
function seedNpcArchives(db, options = {}) {
  const npcUid = npcUserId(db);
  if (!npcUid) throw new Error("NPC sentinel user not found; db.js bootstrap did not run");
  const scopeFilter = new Set(
    (options.scopes || [])
      .map((v) => scopeNameKey(v))
      .filter((k) => k && k !== 'global')
  );
  const insert = db.prepare(
    "INSERT INTO character_sheets (user_id, data, updated_at) VALUES (?, ?, datetime('now'))"
  );
  const updateScope = db.prepare(
    "UPDATE character_sheets SET data = ?, updated_at = datetime('now') WHERE id = ?"
  );
  let seeded = 0;
  let extended = 0;
  let unresolved = 0;

  const tx = db.transaction(() => {
    const existing = existingNpcsByNameKey(db, npcUid);
    for (const { npc } of readNpcFiles()) {
      const name = String(npc && npc.name || '').trim();
      if (!name) continue;
      const data = buildSheetData(npc);
      const archiveScope = Array.isArray(data.scope) ? data.scope : [];
      if (scopeFilter.size) {
        const npcScopeKeys = archiveScope.map(scopeNameKey).filter(Boolean);
        if (!npcScopeKeys.some((k) => scopeFilter.has(k))) continue;
      }
      const entry = existing.get(nameKey(name));
      if (entry) {
        // Existing NPC — extend scope only, never overwrite sheet data.
        const beforeScope = sheetScope(entry.data);
        const merged = mergeScopeNames(beforeScope, archiveScope);
        if (merged.length === beforeScope.length) continue;
        const next = { ...entry.data, scope: merged };
        updateScope.run(JSON.stringify(next), entry.id);
        entry.data = next;
        extended += 1;
        continue;
      }
      insert.run(npcUid, JSON.stringify(data));
      existing.set(nameKey(name), { id: null, data });
      seeded += 1;
    }
  });
  tx();

  if (seeded || extended) {
    const parts = [];
    if (seeded) parts.push(`seeded ${seeded} new NPC sheet(s)`);
    if (extended) parts.push(`extended scope on ${extended} existing NPC sheet(s)`);
    console.log(`NPC seed: ${parts.join('; ')}.`);
  }
  return { seeded, extended, allocated: 0, unresolved };
}

function seedGlobalNpcs(db) {
  return seedNpcArchives(db);
}

// Write current NPC sheets in the DB back out to their archive JSON files so a
// GM can correct a sheet in the web app and persist it as the canonical copy.
// The archive shape preserves top-level biographical fields plus the full sheet
// under `sheet`, matching what readNpcFiles() expects on the next seed pass.
function exportGlobalNpcs(db) {
  const npcUid = npcUserId(db);
  if (!npcUid) throw new Error("NPC sentinel user not found; db.js bootstrap did not run");
  fs.mkdirSync(NPC_DIR, { recursive: true });
  const archivePaths = new Map();
  for (const { npc, path: archivePath } of readNpcFiles()) {
    const key = nameKey(npc && npc.name);
    if (key && !archivePaths.has(key)) archivePaths.set(key, archivePath);
  }
  const rows = db.prepare("SELECT data FROM character_sheets WHERE user_id = ?").all(npcUid);
  let written = 0;
  for (const row of rows) {
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const name = String(data.name || '').trim();
    if (!name) continue;
    const sheet = { ...data };
    for (const k of ['scope', 'role', 'status', 'location', 'summary', 'notes']) delete sheet[k];
    const out = {
      name,
      scope: sheetScope(data),
      role: data.role || '',
      status: data.status || '',
      location: data.location || '',
      summary: data.summary || '',
      notes: data.notes || '',
      sheet
    };
    const target = archivePaths.get(nameKey(name)) || path.join(NPC_DIR, `${slugify(name)}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    written += 1;
  }
  return written;
}

module.exports = { seedNpcArchives, seedGlobalNpcs, exportGlobalNpcs, NPC_DIR };
