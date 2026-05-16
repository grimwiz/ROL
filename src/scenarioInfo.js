const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const SESSIONS_ROOT = path.join(DATA_ROOT, 'sessions');
const GLOBAL_ROOT = path.join(REPO_ROOT, 'Rivers_of_London', 'globaldata');
const DOMESTIC_SYSTEM_DESCRIPTION = '__SYSTEM_DOMESTIC__';
const GM_NAME = 'Stu Bentley';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://openwebui37.dragon-net.local:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6_36b:codex';
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '262144', 10);
// Hard upper bound for a single section generation (default 30 min). Streaming
// keeps the connection alive during generation; this only catches a truly
// stuck call. Also the seam a future "cancel" button drives.
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '1800000', 10);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';

// Best-effort no-timeout dispatcher. Node's global fetch is undici; with
// stream:false a long generation never sends headers before undici's ~5 min
// headersTimeout fires ("fetch failed"). We both stream AND (if undici is
// importable) drop the header/body timeouts entirely.
let ollamaDispatcher = null;
try {
  const { Agent } = require('undici');
  ollamaDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60000 });
} catch {
  ollamaDispatcher = null;
}

// In-process view of whether a generation is running, for a future busyness
// monitor. Kept here so the single Ollama path owns the truth.
const ollamaActivity = { active: 0, startedAt: null, lastSection: null };
function ollamaStatus() {
  return {
    busy: ollamaActivity.active > 0,
    active: ollamaActivity.active,
    started_at: ollamaActivity.startedAt,
    last_section: ollamaActivity.lastSection,
    url: OLLAMA_URL,
    model: OLLAMA_MODEL
  };
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const GRAPHIC_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const ASSET_EXTENSIONS = new Set([...MARKDOWN_EXTENSIONS, ...GRAPHIC_EXTENSIONS, '.pdf']);
const GENERATED_FILENAMES = new Set([
  'scenario-info.json',
  'gm-analysis.json',
  'player-refresh-instructions.md',
  'gm-refresh-instructions.md',
  'refresh-instructions.md'
]);
const RESTRICTED_KEYS = new Set([
  'gm_notes',
  'gm_note',
  'secret',
  'secrets',
  'private_notes',
  'internal_notes',
  'spoilers'
]);

function normaliseSlash(value) {
  return String(value || '').split(path.sep).join('/');
}

function repoRelative(filePath) {
  return normaliseSlash(path.relative(REPO_ROOT, filePath));
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function slugifySessionName(value) {
  const slug = String(value || 'session')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || 'session';
}

function sessionFolderName(session) {
  return slugifySessionName(session.name);
}

function legacySessionFolderName(session) {
  return `${session.id}-${slugifySessionName(session.name)}`;
}

function getSessionFolder(session) {
  return path.join(SESSIONS_ROOT, sessionFolderName(session));
}

function getLegacySessionFolder(session) {
  return path.join(SESSIONS_ROOT, legacySessionFolderName(session));
}

function getSessionPaths(session) {
  const root = getSessionFolder(session);
  const input = path.join(root, 'input');
  const gmInput = path.join(root, 'GM');
  const outputPlayer = path.join(root, 'output_player');
  const outputGm = path.join(root, 'output_gm');
  return {
    root,
    input,
    gmInput,
    outputPlayer,
    outputGm,
    sources: input,
    publicSource: path.join(input, 'player.md'),
    gmSource: path.join(gmInput, 'gm.md'),
    playerSections: path.join(root, 'player_sections.json'),
    gmSections: path.join(root, 'gm_sections.json'),
    scenarioInfo: path.join(outputPlayer, 'scenario-info.json'),
    gmAnalysis: path.join(outputGm, 'gm-analysis.json')
  };
}

function getSessionById(db, sessionId) {
  const id = parseInt(sessionId, 10);
  if (!Number.isInteger(id)) return null;
  return db.prepare(`
    SELECT * FROM sessions
    WHERE id = ? AND COALESCE(description, '') != ?
  `).get(id, DOMESTIC_SYSTEM_DESCRIPTION) || null;
}

function getFirstScenarioSession(db) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE COALESCE(description, '') != ?
    ORDER BY created_at, id
    LIMIT 1
  `).get(DOMESTIC_SYSTEM_DESCRIPTION) || null;
}

function findSessionByToken(db, token) {
  const text = String(token || '').trim();
  if (!text) return getFirstScenarioSession(db);
  const id = parseInt(text, 10);
  if (Number.isInteger(id)) return getSessionById(db, id);
  return db.prepare(`
    SELECT * FROM sessions
    WHERE COALESCE(description, '') != ? AND name LIKE ? COLLATE NOCASE
    ORDER BY id
    LIMIT 1
  `).get(DOMESTIC_SYSTEM_DESCRIPTION, `%${text}%`) || null;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isMissingOrEmpty(filePath) {
  return !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;
}

function copyIfMissingOrEmpty(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) return false;
  if (!isMissingOrEmpty(targetPath)) return false;
  ensureParentDir(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function walkFiles(root, callback) {
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, callback);
      continue;
    }
    if (entry.isFile()) callback(fullPath, entry);
  }
}

function migrateFileIfUseful(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) return false;
  ensureParentDir(targetPath);
  if (isMissingOrEmpty(targetPath)) {
    fs.renameSync(sourcePath, targetPath);
    return true;
  }
  return false;
}

function removeDirIfEmpty(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
  if (fs.readdirSync(dirPath).length) return false;
  fs.rmdirSync(dirPath);
  return true;
}

function migrateLegacySessionLayout(session, paths) {
  const legacyRoot = getLegacySessionFolder(session);
  if (legacyRoot !== paths.root && fs.existsSync(legacyRoot) && !fs.existsSync(paths.root)) {
    fs.renameSync(legacyRoot, paths.root);
  }

  const legacySources = path.join(paths.root, 'sources');
  migrateFileIfUseful(path.join(legacySources, 'public.md'), paths.publicSource);
  migrateFileIfUseful(path.join(legacySources, 'private.md'), paths.gmSource);
  migrateFileIfUseful(path.join(paths.input, 'gm.md'), paths.gmSource);
  migrateFileIfUseful(path.join(paths.root, 'scenario-info.json'), paths.scenarioInfo);
  migrateFileIfUseful(path.join(paths.root, 'gm-analysis.json'), paths.gmAnalysis);
  migrateFileIfUseful(path.join(paths.root, 'output', 'scenario-info.json'), paths.scenarioInfo);
  migrateFileIfUseful(path.join(paths.root, 'output', 'gm-analysis.json'), paths.gmAnalysis);
  migrateFileIfUseful(path.join(paths.root, 'output_gm', 'scenario-info.json'), paths.scenarioInfo);
  migrateFileIfUseful(path.join(paths.root, 'output_player', 'gm-analysis.json'), paths.gmAnalysis);

  walkFiles(legacySources, (fullPath) => {
    const ext = path.extname(fullPath).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) return;
    const relative = path.relative(legacySources, fullPath);
    migrateFileIfUseful(fullPath, path.join(paths.input, relative));
  });

  const legacyLocalGlobal = path.join(paths.input, 'global');
  walkFiles(legacyLocalGlobal, (fullPath) => {
    const ext = path.extname(fullPath).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) return;
    const relative = path.relative(legacyLocalGlobal, fullPath);
    migrateFileIfUseful(fullPath, path.join(paths.root, relative));
  });
  removeDirIfEmpty(legacyLocalGlobal);
  removeDirIfEmpty(legacySources);
  removeDirIfEmpty(path.join(paths.root, 'media'));
}

function classifyGlobalVisibility(relativePath) {
  const normalised = normaliseSlash(relativePath).toLowerCase();
  const parts = normalised.split('/');
  if (parts.some((part) => ['gm', 'private', 'secrets', 'secret'].includes(part))) return 'gm';
  if (/(^|[-_.])gm([-_.]|$)/.test(path.basename(normalised))) return 'gm';
  if (/private|secret|spoiler/.test(path.basename(normalised))) return 'gm';
  return 'player';
}

function classifySessionFileVisibility(fullPath, paths) {
  const rootRelative = normaliseSlash(path.relative(paths.root, fullPath));
  if (rootRelative === 'gm_sections.json') return 'gm';
  if (rootRelative === 'GM' || rootRelative.startsWith('GM/')) return 'gm';
  if (rootRelative === 'output_gm' || rootRelative.startsWith('output_gm/')) return 'gm';
  return 'player';
}

function seedGlobalSessionFiles(paths) {
  for (const file of listGlobalFiles()) {
    const sourcePath = path.join(REPO_ROOT, file.path);
    const relative = path.relative(GLOBAL_ROOT, sourcePath);
    copyIfMissingOrEmpty(sourcePath, path.join(paths.root, relative));
  }
}

function defaultPlayerSections() {
  return {
    summary: [
      'what_has_happened',
      'session_summaries'
    ],
    entities: [
      'locations',
      'npcs',
      'items',
      'characters'
    ],
    item_guidance: [
      'For each entity, identify interesting aspects, current state, relationships, story significance, known_by, and source references.',
      'For each player character, maintain an individual story view: what they have been up to, how they have interacted with the GM or scenario, and what currently involves them.',
      'Weave investigative leads, actions in flight, and open questions into the what-has-happened and per-session analysis as natural prose. Do not produce a discrete to-do or to-investigate list: a checklist of leads is itself a spoiler.'
    ]
  };
}

function defaultGmSections() {
  return {
    gm_analysis: [
      'scenario_progress',
      'plans_by_player',
      'next_deliverables',
      'fairness_engagement',
      'quiet_players',
      'gm_actions'
    ],
    item_guidance: [
      'Track what must happen to keep the scenario on track.',
      'Track planned beats and useful next deliverables per player character.',
      'Track spotlight, engagement, quiet players, and concrete prompts that may bring players back into the session.'
    ]
  };
}

const SCENARIO_SECTIONS = {
  'player.summary.what_has_happened': {
    id: 'player.summary.what_has_happened',
    title: 'What Has Happened So Far',
    artifact: 'player',
    path: ['summary', 'what_has_happened'],
    type: 'object',
    goal: 'Create player-safe analysis of what has happened in the game so far, carrying through all pertinent case-specific facts, decisions, unresolved implications, and relevant background only where it clarifies the case. Present it as a readable, well-structured Markdown brief — headings, bold key terms, indented bullets — not a wall of text. Weave outstanding leads, actions in flight, and open questions into the prose where they help players follow the case; never emit a discrete to-investigate checklist, which is itself a spoiler. Do not reveal hidden causes or GM-only material.',
    schemaHint: [
      'Return ONE JSON object:',
      '```json',
      '{',
      '  "title": "What Has Happened So Far",',
      '  "presentation": "scene",',
      '  "content": "Markdown string — see rules below",',
      '  "known_by": ["all"],',
      '  "sources": [ { "path": "data/sessions/<slug>/input/player.md" } ]',
      '}',
      '```',
      '- `presentation` is `"scene"` when the party investigates together (organise the Markdown as chronological scenes/locations) or `"player"` when the party has clearly fragmented and characters are following separate threads (organise it per character). For THIS section prefer `"scene"` unless the material is overwhelmingly fragmented.',
      '- `content` is GitHub-flavoured Markdown and is the only place the narrative goes. Use `##` for the main sections (these are turned into a clickable index — keep them short and specific), `###` for sub-points, `**bold**` for key terms and clues, `-` bullet lists for beats, and `>` for in-world quotes. Aim for 3–8 `##` sections. No raw HTML, no tables, and no separate "to investigate" list — fold leads into the prose.',
      '- Player-safe only: no hidden causes, GM-only material, or future plans.'
    ].join('\n')
  },
  'player.summary.session_summaries': {
    id: 'player.summary.session_summaries',
    title: 'Session Summaries',
    artifact: 'player',
    path: ['summary', 'session_summaries'],
    type: 'array',
    goal: 'Maintain per-session player-safe analysis, extending the overall "what has happened" section with the specific facts, decisions, clues, actions, and implications from each session, as readable structured Markdown. Indicate unresolved leads, in-flight actions, and open questions inside each session\'s prose rather than as a separate list.',
    schemaHint: [
      'Return a JSON array, preserving chronological order and stable ids. Each element:',
      '```json',
      '{',
      '  "id": "session-<n-or-slug>",',
      '  "title": "e.g. Session 2 — 25 April",',
      '  "presentation": "player",',
      '  "content": "Markdown string — same rules as below",',
      '  "known_by": ["all"],',
      '  "sources": [ { "path": "..." } ]',
      '}',
      '```',
      '- For each session prefer `"presentation":"player"`: one `##` heading per player character covering what they did and where their thread stands. Use `"scene"` only if that whole session was played as one shared scene.',
      '- `content` is GitHub-flavoured Markdown: `##` headings (turned into the index), `###` sub-points, `**bold**`, `-` bullets, `>` quotes. No raw HTML, no tables, no separate to-investigate list.',
      '- Player-safe only. Preserve existing sessions unchanged unless the sources materially change them.'
    ].join('\n')
  },
  'player.entities.locations': {
    id: 'player.entities.locations',
    title: 'Locations',
    artifact: 'player',
    path: ['entities', 'locations'],
    type: 'array',
    goal: 'Extract locations with interesting aspects, current state, relationships, story significance, source references, and known_by access.'
  },
  'player.entities.npcs': {
    id: 'player.entities.npcs',
    title: 'NPCs',
    artifact: 'player',
    path: ['entities', 'npcs'],
    type: 'array',
    goal: 'Extract NPCs known to players with interesting aspects, relationships, current state, story significance, source references, and known_by access.'
  },
  'player.entities.items': {
    id: 'player.entities.items',
    title: 'Things',
    artifact: 'player',
    path: ['entities', 'items'],
    type: 'array',
    goal: 'Extract notable objects, artefacts, documents, and pieces of evidence known to players: interesting aspects, current state and whereabouts, who holds or controls them, story significance, source references, and known_by access.'
  },
  'player.entities.characters': {
    id: 'player.entities.characters',
    title: 'Player Characters',
    artifact: 'player',
    path: ['entities', 'characters'],
    type: 'array',
    goal: 'Extract individual player-character story records: what each character has been up to, interactions with the GM or scenario, current involvement, active threads, and known_by access.'
  },
  'gm.scenario_progress': {
    id: 'gm.scenario_progress',
    title: 'Scenario Progress',
    artifact: 'gm',
    path: ['scenario_progress'],
    type: 'array',
    goal: 'Assess how the scenario is progressing, what is drifting or stalled, and what the GM should do to keep it on track.'
  },
  'gm.plans_by_player': {
    id: 'gm.plans_by_player',
    title: 'Plans By Player',
    artifact: 'gm',
    path: ['plans_by_player'],
    type: 'array',
    goal: 'Identify private planned beats, risks, and notes for each player character.'
  },
  'gm.next_deliverables': {
    id: 'gm.next_deliverables',
    title: 'Next Deliverables',
    artifact: 'gm',
    path: ['next_deliverables'],
    type: 'array',
    goal: 'Identify useful next clues, scenes, prompts, or deliverables for each player character.'
  },
  'gm.fairness_engagement': {
    id: 'gm.fairness_engagement',
    title: 'Fairness / Engagement',
    artifact: 'gm',
    path: ['fairness_engagement'],
    type: 'array',
    goal: 'Track spotlight, engagement, quiet players, overloaded players, and evidence for those assessments.'
  },
  'gm.quiet_players': {
    id: 'gm.quiet_players',
    title: 'Quiet Players',
    artifact: 'gm',
    path: ['quiet_players'],
    type: 'array',
    goal: 'Identify players or characters who may need a nudge and draft concrete GM prompts.'
  },
  'gm.gm_actions': {
    id: 'gm.gm_actions',
    title: 'GM Actions',
    artifact: 'gm',
    path: ['gm_actions'],
    type: 'array',
    goal: 'Extract concrete GM actions for the next session or async update, including priority and rationale.'
  }
};

function writeJsonIfMissingOrEmpty(filePath, value) {
  if (!isMissingOrEmpty(filePath)) return false;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return true;
}

function ensureSessionDataFolders(session) {
  const paths = getSessionPaths(session);
  migrateLegacySessionLayout(session, paths);
  fs.mkdirSync(paths.input, { recursive: true });
  fs.mkdirSync(paths.gmInput, { recursive: true });
  fs.mkdirSync(paths.outputPlayer, { recursive: true });
  fs.mkdirSync(paths.outputGm, { recursive: true });
  if (!fs.existsSync(paths.publicSource)) {
    fs.writeFileSync(paths.publicSource, `# ${session.name} Player Source\n\nAdd player-visible scenario notes here.\n`, 'utf8');
  }
  if (!fs.existsSync(paths.gmSource)) {
    fs.writeFileSync(paths.gmSource, `# ${session.name} GM Source\n\nAdd GM-only scenario notes, plans, secrets, and pacing notes here.\n`, 'utf8');
  }
  seedGlobalSessionFiles(paths);
  writeJsonIfMissingOrEmpty(paths.playerSections, defaultPlayerSections());
  writeJsonIfMissingOrEmpty(paths.gmSections, defaultGmSections());
  return paths;
}

function ensureSessionDataFolderById(db, sessionId) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  return { session, paths: ensureSessionDataFolders(session) };
}

function renameSessionDataFolder(sessionId, previousName, nextName) {
  const previousSession = { id: sessionId, name: previousName };
  const nextSession = { id: sessionId, name: nextName };
  const previousRoot = getSessionFolder(previousSession);
  const nextRoot = getSessionFolder(nextSession);
  if (previousRoot === nextRoot) {
    fs.mkdirSync(nextRoot, { recursive: true });
    return { path: repoRelative(nextRoot), renamed: false };
  }

  fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
  if (fs.existsSync(previousRoot) && !fs.existsSync(nextRoot)) {
    fs.renameSync(previousRoot, nextRoot);
    return { path: repoRelative(nextRoot), renamed: true };
  }
  if (!fs.existsSync(nextRoot)) {
    fs.mkdirSync(nextRoot, { recursive: true });
  }
  return { path: repoRelative(nextRoot), renamed: false };
}

function getFileKind(ext) {
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (GRAPHIC_EXTENSIONS.has(ext)) return 'graphic';
  if (ext === '.pdf') return 'pdf';
  return 'file';
}

function listSessionSourceFiles(session, options = {}) {
  const { includePrivate = false } = options;
  const paths = ensureSessionDataFolders(session);
  const files = [];

  function addFile(fullPath, entry) {
    const ext = path.extname(entry.name).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) return;
    if (GENERATED_FILENAMES.has(entry.name)) return;
    const visibility = classifySessionFileVisibility(fullPath, paths);
    if (!includePrivate && visibility === 'gm') return;

    const stat = fs.statSync(fullPath);
    files.push({
      path: repoRelative(fullPath),
      kind: getFileKind(ext),
      visibility,
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString()
    });
  }

  if (fs.existsSync(paths.root)) {
    const rootEntries = fs.readdirSync(paths.root, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile()) continue;
      addFile(path.join(paths.root, entry.name), entry);
    }
  }
  walkFiles(paths.input, addFile);
  if (includePrivate) walkFiles(paths.gmInput, addFile);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function listMarkdownSpeakers(sourceFiles) {
  const counts = new Map();
  for (const file of sourceFiles || []) {
    if (file.kind !== 'markdown') continue;
    const fullPath = path.join(REPO_ROOT, file.path);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, 'utf8');
    const matches = text.matchAll(/^\\?##\s+(.+?)\s*$/gm);
    for (const match of matches) {
      const speaker = String(match[1] || '')
        .replace(/\s+\(.*?\)\s*$/g, '')
        .replace(/\s+\d{4}\.\d{2}\.\d{2}.*$/g, '')
        .replace(/\s+\d{1,2}:\d{2}.*$/g, '')
        .trim();
      if (!speaker) continue;
      counts.set(speaker, (counts.get(speaker) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, posts]) => ({ name, posts }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name));
}


function listGlobalFiles() {
  const files = [];
  if (!fs.existsSync(GLOBAL_ROOT)) return files;
  walkFiles(GLOBAL_ROOT, (fullPath, entry) => {
    const ext = path.extname(entry.name).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) return;
    const relative = path.relative(GLOBAL_ROOT, fullPath);
    const stat = fs.statSync(fullPath);
    files.push({
      path: repoRelative(fullPath),
      kind: getFileKind(ext),
      visibility: classifyGlobalVisibility(relative),
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString()
    });
  });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function parseSheetData(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function listRoster(db, sessionId = null) {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username').all();
  const params = [DOMESTIC_SYSTEM_DESCRIPTION];
  let sessionFilter = '';
  const parsedSessionId = parseInt(sessionId, 10);
  if (Number.isInteger(parsedSessionId)) {
    sessionFilter = ' AND s.id = ?';
    params.push(parsedSessionId);
  }

  const sheetRows = db.prepare(`
    SELECT
      u.id AS user_id,
      u.username,
      u.role,
      s.id AS session_id,
      s.name AS session_name,
      cs.data
    FROM character_sheets cs
    JOIN users u ON u.id = cs.user_id
    JOIN sessions s ON s.id = cs.session_id
    WHERE COALESCE(s.description, '') != ?${sessionFilter}
    ORDER BY s.created_at DESC, u.username
  `).all(...params);

  const characters = sheetRows
    .map((row) => {
      const data = parseSheetData(row.data);
      const characterName = String(data.name || '').trim();
      return {
        user_id: row.user_id,
        username: row.username,
        role: row.role,
        session_id: row.session_id,
        session_name: row.session_name,
        character_name: characterName || null,
        occupation: String(data.occupation || '').trim() || null
      };
    })
    .filter((row) => row.character_name);

  if (Number.isInteger(parsedSessionId)) {
    const assignedPlayers = db.prepare(`
      SELECT u.id, u.username, u.role, s.name AS session_name
      FROM session_players sp
      JOIN users u ON u.id = sp.user_id
      JOIN sessions s ON s.id = sp.session_id
      WHERE sp.session_id = ?
      ORDER BY u.username
    `).all(parsedSessionId);
    const usersWithCharacters = new Set(characters.map((row) => row.user_id));
    for (const user of assignedPlayers) {
      if (usersWithCharacters.has(user.id)) continue;
      characters.push({
        user_id: user.id,
        username: user.username,
        role: user.role,
        session_id: parsedSessionId,
        session_name: user.session_name,
        character_name: user.username,
        occupation: null
      });
    }
  }

  return {
    gm_name: GM_NAME,
    users,
    characters: characters.sort((a, b) => {
      const sessionCompare = String(a.session_name || '').localeCompare(String(b.session_name || ''));
      if (sessionCompare) return sessionCompare;
      return String(a.character_name || '').localeCompare(String(b.character_name || ''));
    })
  };
}

function getViewerSubjects(user, db, sessionId) {
  if (!user) return [];
  if (user.role === 'gm') return [GM_NAME, 'GM'];
  const roster = listRoster(db, sessionId);
  const names = roster.characters
    .filter((entry) => entry.user_id === user.id)
    .map((entry) => entry.character_name)
    .filter(Boolean);
  if (!names.length && user.username) names.push(user.username);
  return [...new Set(names)];
}

function normaliseName(value) {
  return String(value || '').trim().toLowerCase();
}

function readAccessList(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const raw = entry.known_by ?? entry.visible_to ?? entry.access;
  if (Array.isArray(raw)) return raw.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function canViewEntry(entry, viewerSubjects, isGM, missingAccessIsVisible = false) {
  if (isGM) return true;
  if (!entry || typeof entry !== 'object') return true;
  if (entry.gm_only === true || entry.gmOnly === true) return false;
  const access = readAccessList(entry);
  if (!access.length) return missingAccessIsVisible;
  const publicNames = new Set(['all', 'everyone', 'players', 'party', 'public']);
  if (access.some((name) => publicNames.has(normaliseName(name)))) return true;
  const subjectSet = new Set((viewerSubjects || []).map(normaliseName));
  return access.some((name) => subjectSet.has(normaliseName(name)));
}

function filterValueForViewer(value, viewerSubjects, isGM, nested = false) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        return canViewEntry(item, viewerSubjects, isGM, nested);
      })
      .map((item) => filterValueForViewer(item, viewerSubjects, isGM, true));
  }

  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isGM && RESTRICTED_KEYS.has(key)) continue;
    if (!isGM && (key === 'known_by' || key === 'visible_to' || key === 'access' || key === 'gm_only' || key === 'gmOnly')) continue;
    out[key] = filterValueForViewer(child, viewerSubjects, isGM, true);
  }
  return out;
}

function filterEntryList(list, viewerSubjects, isGM) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => canViewEntry(entry, viewerSubjects, isGM, false))
    .map((entry) => filterValueForViewer(entry, viewerSubjects, isGM, true));
}

function filterEntryObject(entry, viewerSubjects, isGM) {
  if (!entry || typeof entry !== 'object') return entry || null;
  if (!canViewEntry(entry, viewerSubjects, isGM, false)) return null;
  return filterValueForViewer(entry, viewerSubjects, isGM, true);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listEditableMarkdownSources(paths, includePrivate = true) {
  const sources = [];
  function addFile(fullPath, entry) {
    const ext = path.extname(entry.name).toLowerCase();
    if (!MARKDOWN_EXTENSIONS.has(ext)) return;
    const visibility = classifySessionFileVisibility(fullPath, paths);
    if (!includePrivate && visibility === 'gm') return;
    sources.push({
      path: repoRelative(fullPath),
      relative_path: normaliseSlash(path.relative(paths.root, fullPath)),
      visibility,
      content: fs.readFileSync(fullPath, 'utf8')
    });
  }

  if (fs.existsSync(paths.root)) {
    const rootEntries = fs.readdirSync(paths.root, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile()) continue;
      addFile(path.join(paths.root, entry.name), entry);
    }
  }
  walkFiles(paths.input, addFile);
  if (includePrivate) walkFiles(paths.gmInput, addFile);
  return sources.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function resolveEditableMarkdownSourcePath(paths, source) {
  const rawPath = String((source && (source.path || source.relative_path)) || '').replace(/^\/+/, '');
  if (!rawPath) return null;
  const fullPath = path.resolve(
    rawPath.startsWith('data/') ? path.join(REPO_ROOT, rawPath) : path.join(paths.root, rawPath)
  );
  if (!isInside(paths.root, fullPath)) return null;
  const ext = path.extname(fullPath).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(ext)) return null;
  const rootRelative = normaliseSlash(path.relative(paths.root, fullPath));
  if (rootRelative.startsWith('output_player/') || rootRelative.startsWith('output_gm/')) return null;
  return fullPath;
}

function emptyScenarioInfoPayload(session, user, db, error = null) {
  const paths = ensureSessionDataFolders(session);
  const isGM = user && user.role === 'gm';
  return {
    generated: false,
    generated_at: null,
    error,
    session: { id: session.id, name: session.name, folder: repoRelative(paths.root) },
    viewer: {
      role: user && user.role,
      character_names: getViewerSubjects(user, db, session.id)
    },
    roster: isGM ? listRoster(db, session.id) : undefined,
    source_files: listSessionSourceFiles(session, { includePrivate: isGM }),
    summary: {
      what_has_happened: null,
      session_summaries: []
    },
    entities: {
      locations: [],
      npcs: [],
      items: [],
      characters: []
    },
    gm_analysis: isGM ? emptyGmAnalysis() : undefined
  };
}

function emptyGmAnalysis() {
  return {
    generated: false,
    scenario_progress: [],
    plans_by_player: [],
    next_deliverables: [],
    fairness_engagement: [],
    quiet_players: [],
    gm_actions: []
  };
}

function loadSessionScenarioInfoForUser(sessionId, user, db) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const paths = ensureSessionDataFolders(session);
  const isGM = user && user.role === 'gm';
  let parsed;
  try {
    parsed = readJsonFile(paths.scenarioInfo);
  } catch (e) {
    return emptyScenarioInfoPayload(session, user, db, `Could not read scenario-info.json: ${e.message}`);
  }
  if (!parsed) return emptyScenarioInfoPayload(session, user, db);

  const viewerSubjects = getViewerSubjects(user, db, session.id);
  const sourceFiles = listSessionSourceFiles(session, { includePrivate: isGM });
  const summary = parsed.summary || {};
  const entities = parsed.entities || {};
  let gmAnalysis = emptyGmAnalysis();
  if (isGM) {
    try {
      gmAnalysis = readJsonFile(paths.gmAnalysis) || gmAnalysis;
      gmAnalysis.generated = !!readJsonFile(paths.gmAnalysis);
    } catch (e) {
      gmAnalysis = { ...gmAnalysis, error: `Could not read gm-analysis.json: ${e.message}` };
    }
  }

  // `threads` (to_investigate / actions_in_flight / open_questions) is a removed
  // category. Older artifacts may still carry it on disk; never ship it — leads
  // now belong inside the prose, and a discrete list is a spoiler.
  const filteredParsed = filterValueForViewer(parsed, viewerSubjects, isGM, true);
  delete filteredParsed.threads;

  return {
    ...filteredParsed,
    generated: true,
    session: { id: session.id, name: session.name, folder: repoRelative(paths.root) },
    viewer: {
      role: user && user.role,
      character_names: viewerSubjects
    },
    roster: isGM ? listRoster(db, session.id) : undefined,
    source_files: sourceFiles,
    summary: {
      ...filterValueForViewer(summary, viewerSubjects, isGM, true),
      what_has_happened: filterEntryObject(summary.what_has_happened, viewerSubjects, isGM),
      session_summaries: filterEntryList(summary.session_summaries, viewerSubjects, isGM)
    },
    entities: {
      ...filterValueForViewer(entities, viewerSubjects, isGM, true),
      locations: filterEntryList(entities.locations, viewerSubjects, isGM),
      npcs: filterEntryList(entities.npcs, viewerSubjects, isGM),
      items: filterEntryList(entities.items, viewerSubjects, isGM),
      characters: filterEntryList(entities.characters, viewerSubjects, isGM)
    },
    gm_analysis: isGM ? gmAnalysis : undefined
  };
}

function readSessionSources(session) {
  const paths = ensureSessionDataFolders(session);
  return {
    session: { id: session.id, name: session.name, folder: repoRelative(paths.root) },
    public_source: fs.readFileSync(paths.publicSource, 'utf8'),
    public_source_path: repoRelative(paths.publicSource),
    private_source: fs.readFileSync(paths.gmSource, 'utf8'),
    private_source_path: repoRelative(paths.gmSource),
    markdown_sources: listEditableMarkdownSources(paths, true),
    source_files: listSessionSourceFiles(session, { includePrivate: true })
  };
}

function writeSessionSources(session, body) {
  const paths = ensureSessionDataFolders(session);
  if (Object.prototype.hasOwnProperty.call(body || {}, 'public_source')) {
    fs.writeFileSync(paths.publicSource, String(body.public_source || ''), 'utf8');
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'private_source')) {
    fs.writeFileSync(paths.gmSource, String(body.private_source || ''), 'utf8');
  }
  if (Array.isArray(body && body.markdown_sources)) {
    for (const source of body.markdown_sources) {
      const targetPath = resolveEditableMarkdownSourcePath(paths, source);
      if (!targetPath) continue;
      ensureParentDir(targetPath);
      fs.writeFileSync(targetPath, String(source.content || ''), 'utf8');
    }
  }
  return readSessionSources(session);
}

function sectionBackupDir(paths, config) {
  return path.join(config.artifact === 'gm' ? paths.outputGm : paths.outputPlayer, 'section-backups');
}

function sectionBackupPath(paths, config) {
  return path.join(sectionBackupDir(paths, config), `${config.id.replace(/[^a-z0-9_.-]+/gi, '_')}.json`);
}

function artifactPathForSection(paths, config) {
  return config.artifact === 'gm' ? paths.gmAnalysis : paths.scenarioInfo;
}

function emptyArtifactForSection(session, config) {
  if (config.artifact === 'gm') {
    return {
      generated_at: null,
      session: { id: session.id, name: session.name },
      scenario_progress: [],
      plans_by_player: [],
      next_deliverables: [],
      fairness_engagement: [],
      quiet_players: [],
      gm_actions: []
    };
  }

  return {
    generated_at: null,
    campaign: session.name,
    session: { id: session.id, name: session.name },
    source_files: [],
    summary: {
      what_has_happened: null,
      session_summaries: []
    },
    entities: {
      locations: [],
      npcs: [],
      items: [],
      characters: []
    }
  };
}

function readArtifactForSection(session, paths, config) {
  return readExistingJsonForPrompt(artifactPathForSection(paths, config)) || emptyArtifactForSection(session, config);
}

function getPathValue(object, parts) {
  let node = object;
  for (const part of parts) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function setPathValue(object, parts, value) {
  let node = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function normaliseSectionValue(config, value) {
  if (config.type === 'array') return Array.isArray(value) ? value : [value].filter((item) => item !== null && item !== undefined);
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { title: config.title, body: String(value || '').trim() };
}

function writeArtifactForSection(session, paths, config, artifact) {
  if (config.artifact === 'player') {
    artifact.session = { id: session.id, name: session.name };
    artifact.source_files = listSessionSourceFiles(session, { includePrivate: false });
    // Prune the removed `threads` category from older artifacts as they are rewritten.
    delete artifact.threads;
  } else {
    artifact.session = { id: session.id, name: session.name };
  }
  artifact.generated_at = new Date().toISOString();
  const artifactPath = artifactPathForSection(paths, config);
  ensureParentDir(artifactPath);
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function saveSectionBackup(paths, config, value) {
  const backupPath = sectionBackupPath(paths, config);
  ensureParentDir(backupPath);
  fs.writeFileSync(backupPath, `${JSON.stringify({
    section_id: config.id,
    backed_up_at: new Date().toISOString(),
    value
  }, null, 2)}\n`, 'utf8');
}

function readScenarioSection(session, sectionId) {
  const config = SCENARIO_SECTIONS[sectionId];
  if (!config) return null;
  const paths = ensureSessionDataFolders(session);
  const artifact = readArtifactForSection(session, paths, config);
  return {
    config,
    paths,
    artifact,
    value: getPathValue(artifact, config.path)
  };
}

function renderRosterMarkdown(roster) {
  const cell = (value) => String(value || '').replace(/\|/g, '\\|');
  const lines = [];
  lines.push(`GM identity: ${cell(roster.gm_name)}`);
  lines.push('');
  lines.push('| Username | Role | Character | Scenario | Occupation |');
  lines.push('|---|---|---|---|---|');
  for (const row of roster.characters) {
    lines.push(`| ${cell(row.username)} | ${cell(row.role)} | ${cell(row.character_name)} | ${cell(row.session_name)} | ${cell(row.occupation)} |`);
  }
  const gmUsers = roster.users.filter((user) => user.role === 'gm').map((user) => user.username);
  lines.push('');
  lines.push(`GM user accounts: ${cell(gmUsers.join(', ') || '(none listed)')}`);
  return lines.join('\n');
}

function renderSourceMarkdown(sourceFiles) {
  if (!sourceFiles.length) return 'No markdown or graphics source files were found for this session.';
  return sourceFiles
    .map((file) => `- ${file.path} (${file.kind}, ${file.visibility}, ${file.size_bytes} bytes, modified ${file.modified_at})`)
    .join('\n');
}

function renderSpeakersMarkdown(speakers) {
  if (!speakers.length) return 'No markdown speakers were detected.';
  return speakers.map((speaker) => `- ${speaker.name} (${speaker.posts} post${speaker.posts === 1 ? '' : 's'})`).join('\n');
}

function readExistingJsonForPrompt(filePath) {
  try {
    return readJsonFile(filePath) || null;
  } catch (e) {
    return { _error: `Could not parse ${repoRelative(filePath)}: ${e.message}` };
  }
}

function renderJsonBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value ?? null, null, 2)}\n\`\`\``;
}

function readTextForPrompt(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return `Could not read ${repoRelative(filePath)}: ${e.message}`;
  }
}

function sourcePromptRank(file) {
  const filePath = String(file && file.path || '');
  if (filePath.includes('/GM/')) return 0;
  if (filePath.includes('/input/player.md')) return 1;
  if (filePath.includes('/input/')) return 2;
  if (filePath.startsWith('data/sessions/')) return 3;
  return 4;
}

function sortPromptSources(sourceFiles) {
  return [...(sourceFiles || [])].sort((a, b) => {
    const rank = sourcePromptRank(a) - sourcePromptRank(b);
    if (rank) return rank;
    return String(a.path || '').localeCompare(String(b.path || ''));
  });
}

function isCaseSourceFile(file) {
  // What actually happened in THIS game: the WhatsApp transcript + GM-authored
  // case material live under input/ and GM/. The seeded session-root files are
  // generic Rivers of London world reference, not events.
  const p = String(file && file.path || '');
  return p.includes('/input/') || p.includes('/GM/');
}

function renderPromptFileBundle(sourceFiles) {
  const ordered = sortPromptSources(sourceFiles);
  const markdownFiles = ordered.filter((file) => file.kind === 'markdown');
  const otherFiles = ordered.filter((file) => file.kind !== 'markdown');
  const caseFiles = markdownFiles.filter(isCaseSourceFile);
  const worldFiles = markdownFiles.filter((f) => !isCaseSourceFile(f));
  const sections = [];

  const dumpFiles = (files) => {
    for (const file of files) {
      sections.push(`### ${file.path}`, '', '````markdown', readTextForPrompt(path.join(REPO_ROOT, file.path)), '````');
    }
  };

  sections.push('## Authoritative Case Sources — what actually happened');
  sections.push('');
  sections.push('Everything the investigators have done, found, said, met, or been told comes ONLY from these files (the WhatsApp play transcript and GM-authored case material). Every statement you write about events, people met, places visited, clues, and timing must be grounded here.');
  sections.push('');
  if (caseFiles.length) dumpFiles(caseFiles);
  else sections.push('_No case source files were found._');

  sections.push('');
  sections.push('## World Reference — background definitions only (NOT events)');
  sections.push('');
  sections.push('These describe what people, places, organisations, and terms *are* in the Rivers of London setting generally. They are NOT a record of this game. Do NOT assert that any investigator met, visited, knows, contacted, or interacted with anyone or anywhere because it appears here. Use them only to briefly clarify a name or term that already appears in the Authoritative Case Sources, and never let them introduce people, locations, meetings, or timeline that the case sources do not establish.');
  sections.push('');
  if (worldFiles.length) dumpFiles(worldFiles);
  else sections.push('_No world reference files were found._');

  if (otherFiles.length) {
    sections.push('');
    sections.push('## Non-Markdown Source Assets');
    sections.push('');
    sections.push('These files are available as referenced assets. If your runtime cannot inspect binary or image files, keep their paths as references rather than inventing visual detail.');
    sections.push('');
    sections.push(renderSourceMarkdown(otherFiles));
  }

  return sections.join('\n');
}

function renderCommonPromptContext(session, db, sourceFiles) {
  const roster = listRoster(db, session.id);
  const speakers = listMarkdownSpeakers(sourceFiles);

  return [
    '## Application Roster',
    '',
    'Use the application database roster below to map player knowledge to character names. Access control must use character names, not player names or account usernames.',
    '',
    renderRosterMarkdown(roster),
    '',
    '## Markdown Speakers',
    '',
    `The play-log markdown may use real/player display names in headings. Reconcile these speakers with the roster where the mapping is clear. Treat ${GM_NAME} as the GM narrator/director, not as a player character.`,
    '',
    renderSpeakersMarkdown(speakers)
  ].join('\n');
}

function renderSectionPrompt(session, db, config, artifact, currentValue, sourceFiles) {
  const expected = config.type === 'array' ? 'a JSON array' : 'a JSON object';
  const orderedSourceFiles = sortPromptSources(sourceFiles);
  const accessRules = config.artifact === 'player'
    ? [
        '- This is a player-visible section. Never include secrets, future plans, hidden causes, or private GM interpretation.',
        '- Every top-level item must include known_by. Use ["all"] for table-wide public information, or exact character names from the roster for character-specific knowledge.',
        '- Use current source paths from the source list. Replace stale references to old sources/ folders or old session folder names.'
      ].join('\n')
    : [
        '- This is GM-only analysis. It may include private plans, pacing advice, hidden causes, and player engagement guidance.',
        '- Do not write player-facing prose; write practical GM support material.'
      ].join('\n');

  return `# Section Regeneration Task

You are regenerating exactly one section of The Folly web app's scenario information.

Session: ${session.name} (id ${session.id})
Section id: ${config.id}
Section title: ${config.title}
Destination JSON path: ${config.path.join('.')}
Expected response: ${expected}

## Goal

${config.goal}
${config.schemaHint ? `
## Response Shape

${config.schemaHint}
` : ''}
## Rules

- Return only valid JSON for this one section. No markdown fences, commentary, planning text, or wrapper object.
- GROUNDING: every statement about what happened — who did or found something, who met whom, where they went, what they were told, and when — must trace to the **Authoritative Case Sources** (the WhatsApp transcript and GM-authored case files). If the case sources do not establish it, do not write it. Never introduce people, places, organisations, meetings, relationships, or timeline from the World Reference; those files only explain what an already-mentioned name or term *is*. When in doubt, leave it out rather than guess.
- COMPLETENESS: this is the players' primary record of the case — they do not read the raw files. Surface ALL pertinent case information for this section: facts, decisions, clues, leads, who did what, current state, and consequences. Do not omit relevant detail to be brief; for case facts, favour completeness over concision. It is an analysis task, not a terse summary.
- COHESION: the whole artifact must read as one consistent account. Treat "what has happened" as the spine; this section must agree with it and with the other sections — reuse the exact same entity names and IDs, do not contradict them, and reflect cross-references (e.g., a location entry should reflect what the summary says happened there).
- The session transcript comes from WhatsApp. Message headings identify the speaker and time, and replies/linkage clarify the thread of conversation. Follow those conversational threads; do not treat a message heading as a story event in itself.
- Do not create generic timeline fields or timeline paragraphs. If chronology matters, write it naturally inside the analysis for the item.
- Preserve stable IDs from the current section where an item still represents the same thing. Keep useful existing facts unless the sources make them stale, unsafe, or incorrect.
- Prefer factual prose over speculation. Preserve ambiguity explicitly: "unknown", "unconfirmed", or "requires sign-off".
- Cite sources with repo-relative paths in sources[].path, preferring the Authoritative Case Sources.
${accessRules}

${renderCommonPromptContext(session, db, sourceFiles)}

## Current Complete Artifact

This is the rest of the player/GM record. Make this section cohere with it: same names, same IDs, no contradictions. "What has happened" is the spine — session summaries extend it, and entities/threads must be consistent with both. Extend and reconcile; do not regress detail another section already captured.

${renderJsonBlock(artifact)}

## Current Section Value

${renderJsonBlock(currentValue ?? (config.type === 'array' ? [] : null))}

${renderPromptFileBundle(orderedSourceFiles)}

Return ${expected} now.`;
}

function extractJsonCandidate(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const arrayStart = raw.indexOf('[');
  const objectStart = raw.indexOf('{');
  const starts = [arrayStart, objectStart].filter((index) => index >= 0);
  if (!starts.length) return raw;
  const start = Math.min(...starts);
  const endArray = raw.lastIndexOf(']');
  const endObject = raw.lastIndexOf('}');
  const end = Math.max(endArray, endObject);
  return end >= start ? raw.slice(start, end + 1).trim() : raw.slice(start).trim();
}

// Streams Ollama's /api/chat NDJSON and accumulates the assistant text.
// Streaming is the actual fix for "fetch failed": with stream:false a big
// section returns nothing until generation completes, so undici tears the
// socket down on headersTimeout. `options.signal` lets a caller cancel.
async function callOllama(prompt, { signal, label, onProgress } = {}) {
  const startedMs = Date.now();
  const controller = new AbortController();
  const linkAbort = () => controller.abort(signal && signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', linkAbort, { once: true });
  }
  const timer = OLLAMA_TIMEOUT_MS > 0
    ? setTimeout(() => controller.abort(new Error(`Ollama timed out after ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s`)), OLLAMA_TIMEOUT_MS)
    : null;

  ollamaActivity.active += 1;
  ollamaActivity.startedAt = ollamaActivity.startedAt || new Date().toISOString();
  if (label) ollamaActivity.lastSection = label;

  try {
    const response = await fetch(`${OLLAMA_URL.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...(ollamaDispatcher ? { dispatcher: ollamaDispatcher } : {}),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: {
          num_ctx: Number.isInteger(OLLAMA_NUM_CTX) ? OLLAMA_NUM_CTX : 262144,
          temperature: 0.2
        },
        messages: [
          {
            role: 'system',
            content: 'You update structured JSON artifacts for a Rivers of London tabletop RPG web app. You obey data visibility boundaries exactly and return only valid JSON when asked.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let detail = errText;
      try { const j = JSON.parse(errText); if (j && j.error) detail = j.error; } catch { /* keep raw */ }
      throw new Error(`Ollama request failed (${response.status}): ${detail}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const consume = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try { obj = JSON.parse(trimmed); } catch { return; }
      if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
      if (obj.message && typeof obj.message.content === 'string') content += obj.message.content;
    };
    let lastTick = 0;
    let firstByte = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      if (typeof onProgress === 'function') {
        const now = Date.now();
        if (!firstByte || now - lastTick >= 400) {
          firstByte = true;
          lastTick = now;
          try { onProgress({ label, chars: content.length, elapsedMs: now - startedMs }); } catch { /* progress is best-effort */ }
        }
      }
    }
    consume(buffer);
    if (!content.trim()) throw new Error('Ollama returned an empty response');
    return content;
  } catch (e) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const err = new Error(reason && reason.message ? reason.message : 'Ollama request cancelled');
      err.cancelled = true;
      throw err;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', linkAbort);
    ollamaActivity.active = Math.max(0, ollamaActivity.active - 1);
    if (ollamaActivity.active === 0) ollamaActivity.startedAt = null;
  }
}

async function regenerateScenarioSection(sessionId, sectionId, db, opts = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const section = readScenarioSection(session, sectionId);
  if (!section) {
    const error = new Error('Unknown scenario section');
    error.statusCode = 404;
    throw error;
  }
  const { config, paths, artifact, value: currentValue } = section;
  const sourceFiles = listSessionSourceFiles(session, { includePrivate: config.artifact === 'gm' });
  const prompt = renderSectionPrompt(session, db, config, artifact, currentValue, sourceFiles);
  const raw = await callOllama(prompt, { label: config.id, signal: opts.signal, onProgress: opts.onProgress });
  let parsed;
  try {
    parsed = JSON.parse(extractJsonCandidate(raw));
  } catch (e) {
    const error = new Error(`Ollama returned invalid JSON for ${config.id}: ${e.message}`);
    error.ollama_response = raw;
    throw error;
  }

  saveSectionBackup(paths, config, currentValue ?? (config.type === 'array' ? [] : null));
  const nextValue = normaliseSectionValue(config, parsed);
  setPathValue(artifact, config.path, nextValue);
  writeArtifactForSection(session, paths, config, artifact);
  return {
    section_id: config.id,
    title: config.title,
    value: nextValue,
    artifact: config.artifact,
    output_path: repoRelative(artifactPathForSection(paths, config))
  };
}

function listScenarioSectionIds(options = {}) {
  const allIds = Object.keys(SCENARIO_SECTIONS);
  let ids = allIds;
  if (Array.isArray(options.sections) && options.sections.length) {
    const allowed = new Set(allIds);
    ids = options.sections.filter((id) => allowed.has(id));
  }
  if (options.artifact) ids = ids.filter((id) => SCENARIO_SECTIONS[id].artifact === options.artifact);
  return ids;
}

// Single generation path: regenerate one, many, or all scenario sections via the
// same Ollama call used by the web app. `options.sections` selects a page's worth
// of sections; omitting it regenerates everything (the bulk path). The CLI script
// calls straight through here so a manual run does exactly what the web app does.
async function regenerateScenarioSections(sessionId, db, options = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const ids = listScenarioSectionIds(options);
  if (!ids.length) {
    const error = new Error('No matching scenario sections to regenerate');
    error.statusCode = 400;
    throw error;
  }
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const regenerated = [];
  const errors = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    onEvent({ type: 'start', id, index: i + 1, total: ids.length });
    try {
      const result = await regenerateScenarioSection(session.id, id, db, {
        signal: options.signal,
        onProgress: (p) => onEvent({ type: 'progress', id, index: i + 1, total: ids.length, ...p })
      });
      regenerated.push(result);
      onEvent({ type: 'done', id, index: i + 1, total: ids.length, output_path: result.output_path });
    } catch (e) {
      errors.push({ section_id: id, error: e.message, ollama_response: e.ollama_response });
      onEvent({ type: 'error', id, index: i + 1, total: ids.length, error: e.message });
    }
  }
  return {
    session: { id: session.id, name: session.name },
    requested: ids,
    regenerated,
    errors
  };
}

function revertScenarioSection(sessionId, sectionId, db) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const section = readScenarioSection(session, sectionId);
  if (!section) {
    const error = new Error('Unknown scenario section');
    error.statusCode = 404;
    throw error;
  }
  const { config, paths, artifact } = section;
  const backupPath = sectionBackupPath(paths, config);
  if (!fs.existsSync(backupPath)) {
    const error = new Error('No saved previous value for this section');
    error.statusCode = 404;
    throw error;
  }
  const backup = readJsonFile(backupPath);
  const value = backup ? backup.value : null;
  setPathValue(artifact, config.path, normaliseSectionValue(config, value));
  writeArtifactForSection(session, paths, config, artifact);
  return {
    section_id: config.id,
    title: config.title,
    value: getPathValue(artifact, config.path),
    artifact: config.artifact,
    output_path: repoRelative(artifactPathForSection(paths, config))
  };
}

function resolveSessionAssetPath(sessionId, requestPath, db, isGM = false) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const fullPath = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, fullPath)) return null;
  const ext = path.extname(fullPath).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) return null;
  if (!isGM && classifySessionFileVisibility(fullPath, paths) === 'gm') return null;
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return fullPath;
}

function npcStatLine(sheet) {
  if (!sheet || typeof sheet !== 'object') return '';
  const derived = sheet.derived || {};
  const base = ['str', 'con', 'dex', 'int', 'pow', 'siz']
    .map((k) => (sheet[k] ? `${k.toUpperCase()} ${sheet[k]}` : '')).filter(Boolean).join(', ');
  const der = ['hp', 'san', 'mp', 'build', 'move']
    .map((k) => (derived[k] ? `${k.toUpperCase()} ${derived[k]}` : '')).filter(Boolean).join(', ');
  return [base, der].filter(Boolean).join(' · ');
}

function npcSkillLine(sheet) {
  const pick = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((s) => s && s.name).map((s) => `${s.name} ${s.value}`).join(', ');
  return [pick(sheet.common_skills), pick(sheet.mandatory_skills), pick(sheet.combat_skills)]
    .filter(Boolean).join('; ');
}

// Writes data/sessions/<slug>/NPC.md summarising the NPCs allocated to a case so
// the scenario LLM can see who is on the team. Regenerated whenever a case's NPC
// allocations change or an allocated NPC's sheet is edited.
function writeSessionNpcSummary(sessionId, db) {
  const session = getSessionById(db, sessionId);
  if (!session) return false;
  const paths = ensureSessionDataFolders(session);
  const rows = db.prepare(`
    SELECT n.* FROM npcs n
    JOIN npc_sessions ns ON ns.npc_id = n.id
    WHERE ns.session_id = ?
    ORDER BY n.name COLLATE NOCASE
  `).all(session.id);

  const lines = [
    `# NPCs — ${session.name}`,
    '',
    '_Auto-generated from the Admin NPC allocations whenever this case\'s NPCs change. Edits here are overwritten._',
    ''
  ];
  if (!rows.length) {
    lines.push('No NPCs are currently allocated to this case.');
  } else {
    for (const row of rows) {
      let sheet = null;
      try { sheet = row.sheet ? JSON.parse(row.sheet) : null; } catch { sheet = null; }
      const occupation = (sheet && sheet.occupation) || row.role || '';
      lines.push(`## ${row.name}${occupation ? ` — ${occupation}` : ''}`, '');
      const blurb = (sheet && (sheet.reputation || sheet.backstory)) || row.summary || '';
      if (blurb) lines.push(blurb, '');
      const stats = npcStatLine(sheet);
      if (stats) lines.push(`**Stats:** ${stats}`, '');
      const traits = sheet ? [sheet.advantages, sheet.disadvantages].filter(Boolean).join('; ') : '';
      if (traits) lines.push(`**Advantages / Flaws:** ${traits}`, '');
      const skills = sheet ? npcSkillLine(sheet) : '';
      if (skills) lines.push(`**Skills:** ${skills}`, '');
      const spells = sheet && Array.isArray(sheet.magic_spells)
        ? sheet.magic_spells.filter((s) => s && s.name).map((s) => (s.order ? `${s.name} (${s.order})` : s.name)).join(', ')
        : '';
      if (spells) lines.push(`**Spells:** ${spells}`, '');
    }
  }
  fs.writeFileSync(path.join(paths.root, 'NPC.md'), `${lines.join('\n').trim()}\n`, 'utf8');
  return true;
}

function regenerateNpcSummaries(db, sessionIds) {
  const ids = [...new Set((sessionIds || []).map(Number).filter((n) => Number.isInteger(n)))];
  for (const id of ids) {
    try { writeSessionNpcSummary(id, db); } catch { /* non-fatal: a bad case must not block the NPC write */ }
  }
}

module.exports = {
  DATA_ROOT,
  SESSIONS_ROOT,
  GLOBAL_ROOT,
  DOMESTIC_SYSTEM_DESCRIPTION,
  GM_NAME,
  slugifySessionName,
  getSessionById,
  getFirstScenarioSession,
  findSessionByToken,
  ensureSessionDataFolders,
  ensureSessionDataFolderById,
  renameSessionDataFolder,
  listSessionSourceFiles,
  listGlobalFiles,
  listRoster,
  loadSessionScenarioInfoForUser,
  readSessionSources,
  writeSessionSources,
  SCENARIO_SECTIONS,
  listScenarioSectionIds,
  regenerateScenarioSection,
  regenerateScenarioSections,
  revertScenarioSection,
  resolveSessionAssetPath,
  writeSessionNpcSummary,
  regenerateNpcSummaries,
  ollamaStatus
};
