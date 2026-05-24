const fs = require('fs');
const path = require('path');
const {
  ensureSessionDataFolders,
  slugifySessionName
} = require('./scenarioInfo');

const REPO_ROOT = path.join(__dirname, '..');
const CANONICAL_ROOT = path.join(REPO_ROOT, 'Rivers_of_London', 'canonical');
const CANONICAL_CASES_ROOT = path.join(CANONICAL_ROOT, 'cases');

const BUILT_IN_CASES = [
  {
    systemKey: 'bookshop',
    canonicalSlug: 'bookshop',
    fallbackTitle: 'The Bookshop',
    fallbackDescription: 'Built-in introductory case for testing scenario preparation, GM notes, player-facing material, handouts, maps, and AI Support.'
  }
];

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readManifest(config) {
  const manifestPath = path.join(CANONICAL_CASES_ROOT, config.canonicalSlug, 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function defaultPlayerStub(sessionName) {
  return `# ${sessionName} Player Source\n\nAdd player-visible scenario notes here.\n`;
}

function defaultGmStub(sessionName) {
  return `# ${sessionName} GM Source\n\nAdd GM-only scenario notes, plans, secrets, and pacing notes here.\n`;
}

function shouldSeedTarget(targetPath, sessionName, overwrite) {
  if (overwrite) return true;
  if (!fs.existsSync(targetPath)) return true;
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) return false;
  if (stat.size === 0) return true;
  const normalised = targetPath.split(path.sep).join('/');
  if (!normalised.endsWith('/input/player.md') && !normalised.endsWith('/GM/gm.md')) return false;
  const text = fs.readFileSync(targetPath, 'utf8');
  return text === defaultPlayerStub(sessionName) || text === defaultGmStub(sessionName);
}

function walkFiles(root, callback) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

function copyCanonicalCaseFiles(session, config, options = {}) {
  const overwrite = !!options.overwrite;
  const sourceRoot = path.join(CANONICAL_CASES_ROOT, config.canonicalSlug);
  if (!isInside(CANONICAL_CASES_ROOT, sourceRoot) || !fs.existsSync(sourceRoot)) {
    return { copied: 0, skipped: 0, source_missing: true };
  }

  const paths = ensureSessionDataFolders(session);
  let copied = 0;
  let skipped = 0;

  walkFiles(sourceRoot, (sourcePath) => {
    const relative = path.relative(sourceRoot, sourcePath);
    if (relative === 'manifest.json') return;
    if (relative.split(path.sep)[0] === 'npcs') return;
    const targetPath = path.join(paths.root, relative);
    if (!isInside(sourceRoot, sourcePath) || !isInside(paths.root, targetPath)) {
      skipped += 1;
      return;
    }
    if (!shouldSeedTarget(targetPath, session.name, overwrite)) {
      skipped += 1;
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  });

  return {
    copied,
    skipped,
    path: path.relative(REPO_ROOT, paths.root).split(path.sep).join('/')
  };
}

function ensureBuiltInCase(db, config) {
  const manifest = readManifest(config);
  const title = String(manifest.title || config.fallbackTitle).trim();
  const description = String(manifest.description || config.fallbackDescription).trim();
  const systemKey = String(manifest.system_key || config.systemKey).trim();

  let session = db.prepare('SELECT * FROM sessions WHERE system_key = ? LIMIT 1').get(systemKey);

  if (!session) {
    const result = db.prepare('INSERT INTO sessions (name, description, system_key) VALUES (?, ?, ?)')
      .run(title, description || null, systemKey);
    session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);
  } else if (session.name !== title || (session.description || null) !== (description || null)) {
    db.prepare('UPDATE sessions SET name = ?, description = ? WHERE id = ?')
      .run(title, description || null, session.id);
    session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
  }

  return { session, seed: copyCanonicalCaseFiles(session, config, { overwrite: false }) };
}

function ensureBuiltInCases(db) {
  return BUILT_IN_CASES.map((config) => ensureBuiltInCase(db, config));
}

function resetCanonicalCase(db, sessionId) {
  const id = parseInt(sessionId, 10);
  if (!Number.isInteger(id)) {
    const e = new Error('Session not found');
    e.statusCode = 404;
    throw e;
  }
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) {
    const e = new Error('Session not found');
    e.statusCode = 404;
    throw e;
  }
  const config = BUILT_IN_CASES.find((item) => item.systemKey === session.system_key);
  if (!config) {
    const e = new Error('This case does not have a canonical reset source');
    e.statusCode = 400;
    throw e;
  }
  const manifest = readManifest(config);
  const seed = copyCanonicalCaseFiles(session, config, { overwrite: true });
  const { seedNpcArchives } = require('./npcSeed');
  seed.npcs = seedNpcArchives(db, { scopes: [session.name, config.systemKey, config.canonicalSlug, manifest.title] });
  return seed;
}

module.exports = {
  CANONICAL_ROOT,
  BUILT_IN_CASES,
  ensureBuiltInCases,
  resetCanonicalCase,
  slugifySessionName
};
