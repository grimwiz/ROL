const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NPC_DIR = path.join(REPO_ROOT, 'Rivers_of_London', 'globaldata', 'npcs');

function slugify(value) {
  return String(value || 'npc').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'npc';
}

function readNpcFiles() {
  if (!fs.existsSync(NPC_DIR)) return [];
  return fs.readdirSync(NPC_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => {
      try {
        return { file: f, npc: JSON.parse(fs.readFileSync(path.join(NPC_DIR, f), 'utf8')) };
      } catch (e) {
        console.error(`Skipping ${f}: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

// Insert any global NPC whose name is not already present. Mirrors the global
// Markdown seeding: only fills gaps, never overwrites GM edits in the DB.
function seedGlobalNpcs(db) {
  const find = db.prepare("SELECT id FROM npcs WHERE scope = 'global' AND name = ? COLLATE NOCASE");
  const insert = db.prepare(`
    INSERT INTO npcs (name, scope, session_id, role, status, location, summary, notes, sheet, updated_at)
    VALUES (?, 'global', NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  let added = 0;
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
    added += 1;
  }
  if (added) console.log(`Seeded ${added} global NPC sheet(s) from globaldata/npcs/.`);
  return added;
}

// Write current global NPC sheets in the DB back out to globaldata/npcs/ so a
// GM can correct a sheet in the web app and persist it as the canonical copy.
function exportGlobalNpcs(db) {
  fs.mkdirSync(NPC_DIR, { recursive: true });
  const rows = db.prepare("SELECT * FROM npcs WHERE scope = 'global' ORDER BY name COLLATE NOCASE").all();
  let written = 0;
  for (const row of rows) {
    let sheet = null;
    try { sheet = row.sheet ? JSON.parse(row.sheet) : null; } catch { sheet = null; }
    const out = {
      name: row.name,
      scope: 'global',
      role: row.role || '',
      status: row.status || '',
      location: row.location || '',
      summary: row.summary || '',
      notes: row.notes || '',
      sheet
    };
    fs.writeFileSync(path.join(NPC_DIR, `${slugify(row.name)}.json`), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    written += 1;
  }
  return written;
}

module.exports = { seedGlobalNpcs, exportGlobalNpcs, NPC_DIR };
