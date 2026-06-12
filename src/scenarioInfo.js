const fs = require('fs');
const path = require('path');
const { sheetHasCase, sheetScope, scopeNameKey } = require('./characterScope');

const REPO_ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const SESSIONS_ROOT = path.join(DATA_ROOT, 'sessions');
const GLOBAL_ROOT = path.join(REPO_ROOT, 'Rivers_of_London', 'globaldata');
// GM-facing setting corpus extracted from the rulebook's scenario chapters.
// Persona `lore:` tags may name files here as well as in globaldata/.
const SCENARIO_ROOT = path.join(REPO_ROOT, 'Rivers_of_London', 'rules', 'scenario');
const DOMESTIC_SYSTEM_DESCRIPTION = '__SYSTEM_DOMESTIC__';
const GM_NAME = 'Stu Bentley';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://openwebui37.dragon-net.local:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6_36b:codex';
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '262144', 10);
const OLLAMA_CONTEXT_OPTIONS = [131072, 262144];
// Hard upper bound for a single section generation (default 30 min). Streaming
// keeps the connection alive during generation; this only catches a truly
// stuck call. The server-side cancel endpoint also aborts through this path.
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

// In-process view of whether a generation is running. Kept here so the single
// Ollama path owns the truth for status polling and server-side cancellation.
const ollamaActivity = { active: 0, startedAt: null, lastSection: null };
const ollamaControllers = new Set();

// Global app config (model override etc.) persisted outside the per-case DB.
const APP_CONFIG_PATH = path.join(DATA_ROOT, 'app-config.json');
function readAppConfig() {
  try { return JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8')) || {}; }
  catch { return {}; }
}
function writeAppConfig(cfg) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(APP_CONFIG_PATH, JSON.stringify(cfg || {}, null, 2) + '\n', 'utf8');
}
function effectiveOllamaModel() {
  const m = readAppConfig().ollama_model;
  return (typeof m === 'string' && m.trim()) ? m.trim() : OLLAMA_MODEL;
}

// Ollama cloud models (tag suffix `-cloud` or `:cloud`) run off-box, so they
// neither contend for the local GPU nor need the server-side single-flight lock;
// in that mode each browser owns its own AI busy/cancel state.
function isCloudLlm() {
  return /[-:]cloud\b/i.test(effectiveOllamaModel());
}
function setOllamaModel(model) {
  const m = String(model == null ? '' : model).trim();
  if (!m) { const e = new Error('A model name is required'); e.statusCode = 400; throw e; }
  const cfg = readAppConfig();
  cfg.ollama_model = m;
  writeAppConfig(cfg);
  return effectiveOllamaModel();
}

// Model max context, read from Ollama /api/show metadata (manifest/GGUF —
// NOT a model load). Cached per model. We must never request more context
// than the model supports: a 2x over-request (e.g. num_ctx 262144 on
// gemma4:e4b's real 131072) gives no usable attention, silently drops prompt
// content ("lost in the middle"), and bloats the shared-GPU KV cache.
const modelCtxCache = new Map(); // model name -> { max:number|null, at:ms }
async function modelMaxContext(model) {
  const cached = modelCtxCache.get(model);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.max;
  let max = null;
  try {
    const r = await fetch(`${effectiveOllamaUrl()}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const j = await r.json();
      const mi = (j && j.model_info) || {};
      const key = Object.keys(mi).find((k) => k.endsWith('.context_length'));
      const v = key ? Number(mi[key]) : NaN;
      if (Number.isFinite(v) && v > 0) max = v;
    }
  } catch { /* unreachable / no metadata — fall back to the configured size */ }
  modelCtxCache.set(model, { max, at: Date.now() });
  return max;
}

function formatContextSize(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 1024 ? `${Math.round(v / 1024)}K` : String(n);
}

function defaultOllamaNumCtx() {
  return OLLAMA_CONTEXT_OPTIONS.includes(OLLAMA_NUM_CTX) ? OLLAMA_NUM_CTX : 262144;
}

function configuredOllamaNumCtx() {
  const n = Number(readAppConfig().ollama_num_ctx);
  return OLLAMA_CONTEXT_OPTIONS.includes(n) ? n : defaultOllamaNumCtx();
}

function supportedContextOptions(max) {
  return OLLAMA_CONTEXT_OPTIONS.filter((n) => !(Number.isFinite(max) && max > 0) || n <= max);
}

async function ollamaContextConfig() {
  const max = await modelMaxContext(effectiveOllamaModel());
  const current = configuredOllamaNumCtx();
  const effective = (Number.isFinite(max) && max > 0) ? Math.min(current, max) : current;
  return {
    current,
    effective,
    default: defaultOllamaNumCtx(),
    model_max: max,
    options: supportedContextOptions(max),
    all_options: OLLAMA_CONTEXT_OPTIONS.slice()
  };
}

async function setOllamaNumCtx(value) {
  const n = Number(value);
  if (!OLLAMA_CONTEXT_OPTIONS.includes(n)) {
    const e = new Error('Context must be 128K or 256K');
    e.statusCode = 400;
    throw e;
  }
  const max = await modelMaxContext(effectiveOllamaModel());
  if (Number.isFinite(max) && max > 0 && n > max) {
    const e = new Error(`The active model only supports ${formatContextSize(max)} context`);
    e.statusCode = 400;
    throw e;
  }
  const cfg = readAppConfig();
  cfg.ollama_num_ctx = n;
  writeAppConfig(cfg);
  return ollamaContextConfig();
}

// num_ctx to request: the persisted size, clamped only to the model's real
// maximum (so we never ask for more than the model supports). The large
// window is intentional: sections analyse a lot of source data.
async function resolveNumCtx() {
  const configured = configuredOllamaNumCtx();
  const max = await modelMaxContext(effectiveOllamaModel());
  return (Number.isFinite(max) && max > 0) ? Math.min(configured, max) : configured;
}

// Per-service base-URL overrides for the AI hosts (Ollama, ComfyUI). Each
// independently overrides its env/default base URL; a blank value clears the
// override and falls back to the env default. Persisted in app-config.json so
// the GM can repoint either service from the Admin page without a redeploy.
const COMFYUI_URL_DEFAULT = process.env.COMFYUI_URL || 'http://192.168.37.51:8188';
// STT service (now Parakeet on stt201). NOTE: stt201 currently has no DNS and a
// volatile IP — set WHISPERX_URL env or the Admin-page URL to its real address; the
// fix is a DHCP reservation/DNS for stt201, then this default should become a hostname.
const WHISPERX_URL_DEFAULT = process.env.WHISPERX_URL || 'http://192.168.1.94:9000';
function effectiveOllamaUrl() {
  const u = readAppConfig().ollama_url;
  return ((typeof u === 'string' && u.trim()) ? u.trim() : OLLAMA_URL).replace(/\/+$/, '');
}
function effectiveComfyuiUrl() {
  const u = readAppConfig().comfyui_url;
  return ((typeof u === 'string' && u.trim()) ? u.trim() : COMFYUI_URL_DEFAULT).replace(/\/+$/, '');
}
function effectiveWhisperxUrl() {
  const u = readAppConfig().whisperx_url;
  return ((typeof u === 'string' && u.trim()) ? u.trim() : WHISPERX_URL_DEFAULT).replace(/\/+$/, '');
}
// Glossary-boost strength ROL sends to the speech service. GM-tunable from the
// Admin page (persisted in app-config.json) — the speech box is general-purpose and
// must not own this. Lower = gentler (won't force a glossary name onto a similar
// ordinary word, e.g. "dandelions"); 0 disables boosting.
const BOOST_ALPHA_DEFAULT = Number(process.env.ROL_BOOST_ALPHA || 0.5);
function effectiveBoostAlpha() {
  const v = Number(readAppConfig().stt_boost_alpha);
  return (Number.isFinite(v) && v >= 0) ? v : BOOST_ALPHA_DEFAULT;
}
function setBoostAlpha(v) {
  const cfg = readAppConfig();
  if (v === '' || v == null) { delete cfg.stt_boost_alpha; }
  else {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 5) {
      const e = new Error('Glossary boost must be a number between 0 and 5.'); e.statusCode = 400; throw e;
    }
    cfg.stt_boost_alpha = n;
  }
  writeAppConfig(cfg);
  return servicesConfig();
}
function setServiceUrl(key, url) {
  const cfgKey = key === 'comfyui' ? 'comfyui_url' : key === 'whisperx' ? 'whisperx_url' : 'ollama_url';
  const u = String(url == null ? '' : url).trim();
  if (u && !/^https?:\/\//i.test(u)) {
    const e = new Error('Service URL must start with http:// or https://');
    e.statusCode = 400; throw e;
  }
  const cfg = readAppConfig();
  if (u) cfg[cfgKey] = u; else delete cfg[cfgKey];
  writeAppConfig(cfg);
  return servicesConfig();
}
function servicesConfig() {
  return {
    ollama: { url: effectiveOllamaUrl(), default: OLLAMA_URL.replace(/\/+$/, '') },
    comfyui: { url: effectiveComfyuiUrl(), default: COMFYUI_URL_DEFAULT.replace(/\/+$/, '') },
    whisperx: { url: effectiveWhisperxUrl(), default: WHISPERX_URL_DEFAULT.replace(/\/+$/, ''),
                boost_alpha: effectiveBoostAlpha(), boost_default: BOOST_ALPHA_DEFAULT }
  };
}

// Per-purpose ComfyUI diffusion-model selection, GM-pickable from the Admin
// page (mirrors the Ollama model picker) and persisted in app-config.json:
//   image — raw text→image generation (Random portrait, GM handouts)
//   edit  — image→image restyle ("Style this picture")
// Blank ⇒ env/built-in default. Lets the GM swap in smaller/newer models
// without a redeploy and experiment with efficiency.
const COMFYUI_IMAGE_MODEL_DEFAULT = process.env.COMFYUI_QWEN_DIFFUSION_MODEL || 'qwen_image_2512_fp8_e4m3fn.safetensors';
const COMFYUI_EDIT_MODEL_DEFAULT = process.env.COMFYUI_QWEN_EDIT_MODEL || 'qwen_image_edit_2511_fp8mixed.safetensors';
function effectiveComfyuiImageModel() {
  const m = readAppConfig().comfyui_image_model;
  return (typeof m === 'string' && m.trim()) ? m.trim() : COMFYUI_IMAGE_MODEL_DEFAULT;
}
function effectiveComfyuiEditModel() {
  const m = readAppConfig().comfyui_edit_model;
  return (typeof m === 'string' && m.trim()) ? m.trim() : COMFYUI_EDIT_MODEL_DEFAULT;
}
function setComfyuiModel(kind, name) {
  const cfgKey = kind === 'edit' ? 'comfyui_edit_model' : 'comfyui_image_model';
  const m = String(name == null ? '' : name).trim();
  const cfg = readAppConfig();
  if (m) cfg[cfgKey] = m; else delete cfg[cfgKey];
  writeAppConfig(cfg);
  return comfyModelsConfig();
}
function comfyModelsConfig() {
  return {
    image: { current: effectiveComfyuiImageModel(), default: COMFYUI_IMAGE_MODEL_DEFAULT },
    edit: { current: effectiveComfyuiEditModel(), default: COMFYUI_EDIT_MODEL_DEFAULT }
  };
}
// Pull installed models from the Ollama server's /api/tags.
async function listOllamaModels() {
  const resp = await fetch(`${effectiveOllamaUrl()}/api/tags`);
  if (!resp.ok) {
    const e = new Error(`Ollama /api/tags returned HTTP ${resp.status}`);
    e.statusCode = 502; throw e;
  }
  const data = await resp.json().catch(() => ({}));
  return (Array.isArray(data.models) ? data.models : [])
    .map((x) => x && x.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// Runtime view of the currently-loaded model from /api/ps: how much of it is
// resident in VRAM vs spilled to CPU, and the context it was actually loaded
// with. Reports the effective model when present, else the first loaded one.
// null when nothing is loaded or Ollama is unreachable.
async function ollamaPs() {
  let r;
  try {
    r = await fetch(`${effectiveOllamaUrl()}/api/ps`, { signal: AbortSignal.timeout(4000) });
  } catch { return null; }
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const models = (j && Array.isArray(j.models)) ? j.models : [];
  if (!models.length) return null;
  const want = effectiveOllamaModel();
  const m = models.find((x) => x && (x.name === want || x.model === want)) || models[0];
  const total = Number(m.size) || 0;
  const vram = Number(m.size_vram) || 0;
  const gpuPct = total ? Math.round((vram / total) * 100) : null;
  return {
    name: m.name || m.model || null,
    total, vram,
    total_gb: total ? +(total / 1e9).toFixed(2) : null,
    vram_gb: vram ? +(vram / 1e9).toFixed(2) : null,
    gpu_pct: gpuPct,
    cpu_pct: gpuPct == null ? null : 100 - gpuPct,
    ctx: Number(m.context_length) || null
  };
}

// Evict the resident Ollama model from VRAM and wait until /api/ps confirms
// nothing is loaded. Used before a ComfyUI job so the image model has the GPU
// (Ollama + a diffusion model co-resident OOMs the shared card). Fast no-op
// when nothing is loaded; best-effort but verified by polling.
async function freeOllama() {
  let ps;
  try { ps = await ollamaPs(); } catch { ps = null; }
  if (!ps || !ps.name) return { freed: true, was_loaded: false };
  // keep_alive:0 with no prompt makes Ollama unload the model immediately.
  try {
    await fetch(`${effectiveOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ps.name, keep_alive: 0 }),
      signal: AbortSignal.timeout(8000)
    });
  } catch { /* best-effort: poll below decides success */ }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    let now;
    try { now = await ollamaPs(); } catch { now = null; }
    if (!now) return { freed: true, was_loaded: true };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { freed: false, was_loaded: true, reason: 'timeout waiting for Ollama to unload' };
}

// Installed models enriched with each one's max context (cached,
// metadata-only via /api/show). `context` is null when it can't be read.
async function listOllamaModelsDetailed() {
  const names = await listOllamaModels();
  return Promise.all(names.map(async (name) => ({ name, context: await modelMaxContext(name) })));
}

function ollamaStatus() {
  return {
    cloud: isCloudLlm(),
    busy: ollamaActivity.active > 0,
    active: ollamaActivity.active,
    can_cancel: ollamaControllers.size > 0,
    started_at: ollamaActivity.startedAt,
    last_section: ollamaActivity.lastSection,
    url: effectiveOllamaUrl(),
    default_url: OLLAMA_URL.replace(/\/+$/, ''),
    model: effectiveOllamaModel(),
    default_model: OLLAMA_MODEL,
    num_ctx: configuredOllamaNumCtx()
  };
}

function cancelOllama(reason = 'Ollama request cancelled') {
  const controllers = [...ollamaControllers].filter((controller) => controller && !controller.signal.aborted);
  for (const controller of controllers) controller.abort(new Error(reason));
  return {
    cancelled: controllers.length,
    active: ollamaActivity.active,
    busy: ollamaActivity.active > 0,
    last_section: ollamaActivity.lastSection
  };
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const GRAPHIC_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const ASSET_EXTENSIONS = new Set([...MARKDOWN_EXTENSIONS, ...GRAPHIC_EXTENSIONS, '.pdf']);
const GENERATED_FILENAMES = new Set([
  'scenario-info.json',
  'gm-analysis.json',
  'seed-manifest.json',
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

// Look for a "cover image" for the session — a graphic file in the session's
// Gallery whose slugified stem equals the slugified session name. Read-only:
// never creates folders. Returns repo-relative path or null. Players only see
// the player Gallery; GMs fall back to GM/Gallery if no player-visible cover.
function findSessionCover(session, isGM) {
  if (!session || !session.name) return null;
  const targetSlug = slugifySessionName(session.name);
  const root = getSessionFolder(session);
  const dirs = [path.join(root, 'Gallery')];
  if (isGM) dirs.push(path.join(root, 'GM', 'Gallery'));
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (!GRAPHIC_EXTENSIONS.has(ext)) continue;
      const stem = name.slice(0, -ext.length);
      if (slugifySessionName(stem) === targetSlug) {
        return repoRelative(path.join(dir, name));
      }
    }
  }
  return null;
}

// Keep cover-image filenames in sync when the session is renamed. Any graphic
// in either gallery whose slugified stem matches the OLD session slug gets
// renamed to `<newSlug>.<ext>`. Quiet on missing folders / collisions.
function syncSessionCoverOnRename(session, oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  const root = getSessionFolder(session);
  const dirs = [path.join(root, 'Gallery'), path.join(root, 'GM', 'Gallery')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (!GRAPHIC_EXTENSIONS.has(ext)) continue;
      const stem = name.slice(0, -ext.length);
      if (slugifySessionName(stem) !== oldSlug) continue;
      const dest = path.join(dir, `${newSlug}${ext}`);
      if (fs.existsSync(dest)) continue;
      try { fs.renameSync(path.join(dir, name), dest); } catch { /* best-effort */ }
    }
  }
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
    gallery: path.join(root, 'Gallery'),       // player-visible artifacts
    gmGallery: path.join(gmInput, 'Gallery'),  // GM-only artifacts
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

// ── Seed provenance manifest ────────────────────────────────────────────────
// Per-case record of which seeded files came from where, with the size+mtime
// captured at seed time (the pristine baseline). The file lister uses this to
// decide — with a cheap stat, no content read — whether a seeded file has been
// edited, and so whether to offer "Revert". Lives in the case root and is
// excluded from the file lists (it is JSON, which no source lister includes).
// Users edit files only through the app, which rewrites the file and therefore
// always changes its mtime, so a stat baseline is exact (timestamps cannot be
// spoofed via the app).
const SEED_MANIFEST_NAME = 'seed-manifest.json';
function seedManifestPath(paths) { return path.join(paths.root, SEED_MANIFEST_NAME); }
function readSeedManifest(paths) {
  try { const o = JSON.parse(fs.readFileSync(seedManifestPath(paths), 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch { return {}; }
}
function writeSeedManifest(paths, manifest) {
  try { fs.writeFileSync(seedManifestPath(paths), `${JSON.stringify(manifest, null, 2)}\n`); } catch { /* non-fatal */ }
}
function fileBaseline(destPath) {
  const st = fs.statSync(destPath);
  return { size: st.size, mtime_ms: Math.round(st.mtimeMs) };
}
// Record a fresh pristine baseline (after a seed copy or a revert).
function recordSeedBaseline(manifest, rel, sourceRepoRel, destPath) {
  manifest[normaliseSlash(rel)] = { source: normaliseSlash(sourceRepoRel), ...fileBaseline(destPath) };
}
// Backfill an entry for a file seeded before this manifest existed (one-time,
// content-compared so an already-edited file is correctly flagged diverged).
// Returns true if the manifest changed.
function ensureSeedEntry(manifest, rel, sourceRepoRel, destPath, sourcePath) {
  rel = normaliseSlash(rel);
  if (manifest[rel]) return false;
  if (!fs.existsSync(destPath) || !fs.existsSync(sourcePath)) return false;
  try {
    const same = fs.readFileSync(sourcePath).equals(fs.readFileSync(destPath));
    manifest[rel] = same
      ? { source: normaliseSlash(sourceRepoRel), ...fileBaseline(destPath) }
      : { source: normaliseSlash(sourceRepoRel), diverged: true };
  } catch { return false; }
  return true;
}
// Seed state for any case file (markdown, image, pdf, txt — all treated the
// same): is it seeded, where from, and does it still match the seed? Divergence
// is a cheap size+mtime check against the recorded baseline — no content read.
function seedStateForFile(manifest, paths, fullPath) {
  const rel = normaliseSlash(path.relative(paths.root, fullPath));
  const m = manifest[rel];
  if (!m || !m.source) return { seeded: false, seed_identical: false, seed_source: null };
  let identical = false;
  if (!m.diverged) {
    try { const st = fs.statSync(fullPath); identical = (st.size === m.size && Math.round(st.mtimeMs) === m.mtime_ms); }
    catch { /* treat as diverged */ }
  }
  return { seeded: true, seed_identical: identical, seed_source: m.source };
}
// Where a file could have moved to if a GM toggled its visibility (GM <-> player),
// mirroring setSessionAssetVisibility's mapping. Used so seeding doesn't treat a
// merely-relocated seeded file as "missing" and re-copy it (which duplicates it).
function visibilityAltRels(rel) {
  rel = normaliseSlash(rel);
  if (rel.startsWith('GM/Gallery/')) return ['Gallery/' + rel.slice('GM/Gallery/'.length)];
  if (rel.startsWith('Gallery/')) return ['GM/Gallery/' + rel.slice('Gallery/'.length)];
  if (rel.startsWith('GM/')) return ['input/' + rel.slice('GM/'.length)];
  if (rel.startsWith('input/')) return ['GM/' + rel.slice('input/'.length)];
  if (!rel.includes('/')) return ['GM/' + rel, 'input/' + rel]; // a root-level file
  return [];
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
  // Auto-generated GM/LLM references — stat blocks and the key-NPC list (which
  // names characters the players shouldn't know yet). Never player handouts.
  if (rootRelative === 'NPC.md' || rootRelative === 'key-npcs.md') return 'gm';
  if (rootRelative === 'GM' || rootRelative.startsWith('GM/')) return 'gm';
  if (rootRelative === 'output_gm' || rootRelative.startsWith('output_gm/')) return 'gm';
  return 'player';
}

// Files whose visibility cannot be toggled: the canonical player/GM source stubs,
// the auto-generated GM references (NPC.md, key-npcs.md — forced GM but living at
// the case root, so "moving" them to the player area resolves to themselves), and
// control/generated JSON. The Edit Files tab greys out the toggle for these.
function isVisibilityFixed(fullPath, paths) {
  const rel = normaliseSlash(path.relative(paths.root, fullPath));
  const base = path.basename(rel);
  return GENERATED_FILENAMES.has(base)
    || base === 'player.md' || base === 'gm.md'
    || rel === 'NPC.md' || rel === 'key-npcs.md'
    || rel === 'gm_sections.json' || rel === 'player_sections.json';
}

function seedGlobalSessionFiles(paths) {
  const manifest = readSeedManifest(paths);
  let dirty = false;
  for (const file of listGlobalFiles()) {
    const sourcePath = path.join(REPO_ROOT, file.path);
    const relative = normaliseSlash(path.relative(GLOBAL_ROOT, sourcePath));
    const dest = path.join(paths.root, relative);
    // Locate the file: at its seed path, or — if a GM toggled its visibility —
    // the GM<->player counterpart. Either counts as present, so we never re-seed
    // a file that was merely moved (which would duplicate it).
    let locatedRel = !isMissingOrEmpty(dest) ? relative
      : (visibilityAltRels(relative).find((alt) => !isMissingOrEmpty(path.join(paths.root, alt))) || null);
    if (!locatedRel) {
      ensureParentDir(dest);
      fs.copyFileSync(sourcePath, dest);
      recordSeedBaseline(manifest, relative, file.path, dest);
      dirty = true;
    } else if (ensureSeedEntry(manifest, locatedRel, file.path, path.join(paths.root, locatedRel), sourcePath)) {
      dirty = true;
    }
  }
  if (dirty) writeSeedManifest(paths, manifest);
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
      '- Each `##` heading covers one situation of interest — one place, one person, one event, or one topic. If a section seems to span two distinct subjects, use separate consecutive `##` headings rather than joining them with `&` or `and`.',
      '- Player-safe only: no hidden causes, GM-only material, or future plans.'
    ].join('\n')
  },
  'player.summary.session_summaries': {
    id: 'player.summary.session_summaries',
    title: 'Session Summaries',
    artifact: 'player',
    path: ['summary', 'session_summaries'],
    type: 'array',
    goal: 'Maintain a FULL, detailed per-session player-safe account — for each session, everything meaningful that happened: every action taken, place visited, person spoken to, clue found, decision made, conversation of substance, and its consequence. This is the players\' only record of the session, so it must be thorough, not a 2–3 line digest; multiple paragraphs and sub-headings per session are expected. Indicate unresolved leads, in-flight actions, and open questions inside the prose rather than as a separate list.',
    schemaHint: [
      'Return a JSON array, preserving chronological order and stable ids. Each element:',
      '```json',
      '{',
      '  "id": "session-<n-or-slug>",',
      '  "title": "e.g. Session 2",',
      '  "presentation": "scene",',
      '  "content": "Markdown string — same rules as below",',
      '  "known_by": ["all"],',
      '  "sources": [ { "path": "..." } ]',
      '}',
      '```',
      '- Choose the best `presentation` for the actual source material: `"scene"` for chronological shared-table play, `"player"` for fragmented character-specific/WhatsApp threads, or `"location"` when the clearest recall structure is place-by-place. Do not force a character-centric layout when the party acted together.',
      '- `content` is GitHub-flavoured Markdown: `##` headings (turned into the index), `###` sub-points, `**bold**`, `-` bullets, `>` quotes. No raw HTML, no tables, no separate to-investigate list.',
      '- Each `##` heading covers one situation of interest — one place, one person, one event, or one topic. If a section seems to span two distinct subjects, use separate consecutive `##` headings rather than joining them with `&` or `and`.',
      '- DEPTH: each session\'s `content` must be a thorough narrative of that session — do not compress it to a few lines. Cover every meaningful beat, who did what, what was learned, and what it changed. Err on the side of more detail.',
      '- Player-safe only. Preserve existing sessions unchanged unless the sources materially change them.'
    ].join('\n')
  },
  'player.entities.locations': {
    id: 'player.entities.locations',
    title: 'Locations',
    artifact: 'player',
    path: ['entities', 'locations'],
    type: 'array',
    goal: 'Maintain a full player-safe entry for every location of note, centred on that location as the subject: what it is, what has happened there in this case, its current state, who/what is connected to it, and why it matters. Be specific and complete, not a one-liner.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "id": "loc-slug", "name": "Location name", "known_by": ["all"], "content": "Markdown", "sources": [ { "path": "..." } ] }',
      '```',
      '- `content` is GitHub-flavoured Markdown (**bold**, `-` bullets, optional `###` sub-headings). Write from the optic of this place as the organising subject, not from the optic of each player character. Cover: what the place is, everything that has happened there in THIS case, its current state, connected people/things, and its significance to the investigation.',
      '- Each entry is one situation of interest centred on a single place or event; give it a simple, meaningful `name` — the place or event itself, nothing more. Reuse a prior `name` when an entry still represents the same place or event.',
      '- Be thorough — this is the players\' only record. Every top-level item needs `known_by` (["all"] or exact roster character names). Never invent places or events not in the case sources.'
    ].join('\n')
  },
  'player.entities.npcs': {
    id: 'player.entities.npcs',
    title: 'NPCs',
    artifact: 'player',
    path: ['entities', 'npcs'],
    type: 'array',
    goal: 'Maintain a full player-safe entry for every NPC the players know of, centred on that NPC as the subject: who they are, every interaction the party has had with them, what they appear to want or did, relationships, current state, and significance. Specific and complete, not a one-liner.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "id": "npc-slug", "name": "NPC name", "known_by": ["all"], "content": "Markdown", "sources": [ { "path": "..." } ] }',
      '```',
      '- `content` is GitHub-flavoured Markdown. Write from the optic of this NPC as the organising subject, not from the optic of each player character. Cover: who they are (as the players understand it), every interaction the investigators have had with them, what they appear to want, relationships, current status/whereabouts, and why they matter.',
      '- Each entry is one situation of interest centred on a single person; give it a simple, meaningful `name` — that person, nothing more. Reuse a prior `name` when an entry still represents the same person.',
      '- Be thorough. Every item needs `known_by` (["all"] or exact roster character names). Only include NPCs and facts the players have actually encountered; never import people from the world-reference files.'
    ].join('\n')
  },
  'player.entities.items': {
    id: 'player.entities.items',
    title: 'Things',
    artifact: 'player',
    path: ['entities', 'items'],
    type: 'array',
    goal: 'Maintain a full player-safe entry for every notable object, artefact, document, or piece of evidence, centred on that thing as the subject: what it is, how the party came to know of it, what it does or reveals, where it is and who controls it, and why it matters. Specific and complete.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "id": "item-slug", "name": "Thing name", "known_by": ["all"], "content": "Markdown", "sources": [ { "path": "..." } ] }',
      '```',
      '- `content` is GitHub-flavoured Markdown. Write from the optic of this item as the organising subject, not from the optic of each player character. Cover: what it is, how/when it entered the case, what it does or reveals, current whereabouts and who holds/controls it, and its significance.',
      '- Each entry is one situation of interest centred on a single object, document or piece of evidence; give it a simple, meaningful `name` — that thing, nothing more. Reuse a prior `name` when an entry still represents the same thing.',
      '- Be thorough. Every item needs `known_by` (["all"] or exact roster character names). Only include things established in the case sources.'
    ].join('\n')
  },
  'player.entities.characters': {
    id: 'player.entities.characters',
    title: 'Player Characters',
    artifact: 'player',
    path: ['entities', 'characters'],
    type: 'array',
    goal: 'Maintain one EXHAUSTIVE per-player-character story whose purpose is to let that player instantly come back up to speed: what they did and WHY, who they dealt with, what is in flight (unresolved or awaiting a result), and what is planned next — fuller than the session analysis. DEFAULT PRESENCE: the player characters act as a group, so treat every character as PRESENT at each shared scene, location, or visit (e.g. if the party went to the house or to the canal, all of them went) UNLESS the sources clearly show that character was absent or split off; attribute shared/group actions to each present character, not only the one explicitly named. Cover everything they personally did, found, said, and decided across the whole case, with their motivation; multiple paragraphs and sub-headings per character are expected.',
    schemaHint: [
      'Return a JSON array, one element per player character (use the roster). Each element:',
      '```json',
      '{ "id": "char-slug", "name": "Character name", "known_by": ["Character name"], "content": "Markdown", "sources": [ { "path": "..." } ] }',
      '```',
      '- `content` is GitHub-flavoured Markdown using these `###` sub-headings in order: `### What they did & why`, `### Relationships`, `### In flight` (unresolved threads / awaiting a result), `### Planned / next` (their intended next steps). Use `**bold**` and `-` bullets within.',
      '- SHARED PRESENCE: unless the sources clearly show a character was absent or split off, treat them as present at every group scene/location/visit and write their personal account of it — do not omit a character from a shared event just because only another character was named in the transcript.',
      '- EXHAUSTIVE and chronological where it helps: do not summarise to a few lines — this must be the fullest account of that character\'s personal involvement (with motivation), richer than the per-session analysis.',
      '- Default `known_by` to just that character\'s own name (their personal story is theirs); use ["all"] only for parts the whole table plainly shares. Never invent actions the sources do not show (but shared presence at a group scene is the default, not an invention).'
    ].join('\n')
  },
  'gm.npc_knowledge': {
    id: 'gm.npc_knowledge',
    title: 'NPC Knowledge',
    artifact: 'gm',
    path: ['npc_knowledge'],
    type: 'array',
    goal: [
      'For each NPC allocated to this case, write a brief of what THAT NPC plausibly knows about this case AND the influence they have had on it, written from their own perspective — used so the character can answer questions in their own voice. Cover: who they are in this case, what they have personally witnessed or been told, what they believe (rightly or wrongly), their relationships and loyalties, what they want, what they are hiding or unsure of, AND what they have personally done, said, or set in motion this case (their influence — see below). Ground every statement in the case material; only include what this character could plausibly know or do (never omniscient); never invent major facts; it is fine to note what they do NOT know.',
      '',
      'INFERRING INFLUENCE FROM LIVE PLAY. The session transcripts are live play in which the GM voices the NPCs while the players act and discover. The transcript rarely labels who is speaking in what capacity, so you must infer it. Read what the GM tells the players and sort each thing into one of three kinds, then attribute only the right kinds to THIS NPC:',
      '- Game framework / out-of-character: the GM running the game — rules calls, dice, scene framing, recaps, table-talk. This is NOT in-world knowledge for any NPC; ignore it for the persona UNLESS this NPC is the in-world source of it (see the calibration note below).',
      '- Player discovery: things the players observed, examined, or worked out for themselves. An NPC knows these only if they were present or were later told; never give a character knowledge they could not plausibly have come by.',
      '- NPC-delivered: things an NPC told the players — dialogue the GM voiced in that NPC\'s role, briefings, instructions, or in-character documents from or about that NPC. This is both what that NPC knows and what they have already disclosed; attribute it to them.',
      'CALIBRATE TO THE NPC\'S ROLE. Weigh how central this character actually is before attributing anything. An NPC with only a walk-on (e.g. greeted the party, served a meal) knows almost nothing of the wider case — keep their influence short or omit it; never inflate a minor presence into case knowledge. But where the players operate within an institution this NPC heads or commands — they report to this NPC, work the case on their authority, or are tasked by them within the setting\'s structure — then the case\'s assignment, official status, protocol, and direction are in-world THIS NPC\'s briefing and influence, even when the GM delivered them as plain framework. Infer that and attribute it to them. In Rivers of London this most often applies to the senior Folly officer the players answer to (their SIO/handler).'
    ].join('\n'),
    schemaHint: [
      'Return a JSON array, one element per NPC. Each element:',
      '```json',
      '{ "id": "npc-slug", "name": "NPC name", "content": "Markdown", "sources": [ { "path": "..." } ] }',
      '```',
      '- `content` is GitHub-flavoured Markdown written from THIS NPC\'s optic, using these `###` sub-headings in order: `### Who they are in this case`, `### What they know`, `### What I have done and told the players this case`, `### Relationships & loyalties`, `### What they want`, `### What they are hiding or unsure of`. Use `**bold**` and `-` bullets within.',
      '- `### What I have done and told the players this case` is this NPC\'s influence on the case (explicit AND inferred, per the goal): what they have personally done in-scene, told or briefed the players, tasked them with, or set in motion. Derive it by sorting the live-play transcript into game-framework / player-discovery / NPC-delivered and keeping only what is this NPC\'s. For a peripheral walk-on this may be a single line or omitted entirely; for the officer the players answer to it may be substantial. Never inflate a minor NPC into a mover of the plot.',
      '- Only what this character could plausibly know — never make them omniscient. Ground every statement in the case sources; never invent major facts.',
      '- GM-only reference: it may contain secrets the players have not yet learned.'
    ].join('\n')
  },
  'gm.scenario_progress': {
    id: 'gm.scenario_progress',
    title: 'Scenario Progress',
    artifact: 'gm',
    path: ['scenario_progress'],
    type: 'array',
    goal: 'Assess how the scenario is progressing, what is drifting or stalled, and what the GM should do to keep it on track — written out as readable guidance prose, not bare labels.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "id": "progress-slug", "title": "Short heading", "content": "Markdown analysis" }',
      '```',
      '- `content` is the actual GM analysis as GitHub-flavoured Markdown prose (`**bold**`, `-` bullets). Write it out so the GM can read it — assessment, what is drifting/stalled, why, and concrete recommended actions. Do not return terse tag-like fields with no prose.'
    ].join('\n')
  },
  'gm.plans_by_player': {
    id: 'gm.plans_by_player',
    title: 'Plans By Player',
    artifact: 'gm',
    path: ['plans_by_player'],
    type: 'array',
    goal: 'For each player character, lay out the private planned beats, hooks, risks, and GM notes as readable prose guidance.',
    schemaHint: [
      'Return a JSON array, one element per player character. Each element:',
      '```json',
      '{ "character": "Character name", "content": "Markdown analysis" }',
      '```',
      '- `content` is prose Markdown the GM reads: planned beats/hooks for them, risks, and notes. Use `-` bullets for the beats. Write it out; do not return only short label fields.'
    ].join('\n')
  },
  'gm.next_deliverables': {
    id: 'gm.next_deliverables',
    title: 'Next Deliverables',
    artifact: 'gm',
    path: ['next_deliverables'],
    type: 'array',
    goal: 'For each player character, the useful next clues, scenes, prompts, or deliverables — written as actionable prose.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "character": "Character name", "timing": "next session | when they ask | ...", "content": "Markdown analysis" }',
      '```',
      '- `content` is prose Markdown: what to give them next, why, and how it moves their thread. Concrete and readable, not bare labels.'
    ].join('\n')
  },
  'gm.fairness_engagement': {
    id: 'gm.fairness_engagement',
    title: 'Fairness / Engagement',
    artifact: 'gm',
    path: ['fairness_engagement'],
    type: 'array',
    goal: 'Per player character, assess spotlight/engagement (quiet, balanced, overloaded) with the evidence and what to do about it, as prose.',
    schemaHint: [
      'Return a JSON array, one element per player character. Each element:',
      '```json',
      '{ "character": "Character name", "spotlight": "low|balanced|high", "engagement": "quiet|active|overloaded", "content": "Markdown analysis" }',
      '```',
      '- `content` is prose Markdown: the evidence from the sources for this assessment and a concrete suggestion. Write it out.'
    ].join('\n')
  },
  'gm.quiet_players': {
    id: 'gm.quiet_players',
    title: 'Quiet Players',
    artifact: 'gm',
    path: ['quiet_players'],
    type: 'array',
    goal: 'Identify characters who may need a nudge, why, and a concrete drafted prompt — as prose.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "character": "Character name", "content": "Markdown analysis" }',
      '```',
      '- `content` is prose Markdown: why they may need a nudge and a concrete, ready-to-use GM prompt/message (quote it). Write it out.'
    ].join('\n')
  },
  'gm.gm_actions': {
    id: 'gm.gm_actions',
    title: 'GM Actions',
    artifact: 'gm',
    path: ['gm_actions'],
    type: 'array',
    goal: 'Concrete GM actions for the next session or async update, with priority and rationale, as prose.',
    schemaHint: [
      'Return a JSON array. Each element:',
      '```json',
      '{ "id": "action-slug", "title": "Short action title", "priority": "low|medium|high", "content": "Markdown analysis" }',
      '```',
      '- `content` is prose Markdown: what to do, why, and how. Actionable and readable, not a bare label.'
    ].join('\n')
  }
};

function writeJsonIfMissingOrEmpty(filePath, value) {
  if (!isMissingOrEmpty(filePath)) return false;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return true;
}

function ensureSessionDataFolders(session, options = {}) {
  const paths = getSessionPaths(session);
  migrateLegacySessionLayout(session, paths);
  fs.mkdirSync(paths.input, { recursive: true });
  fs.mkdirSync(paths.gmInput, { recursive: true });
  fs.mkdirSync(paths.outputPlayer, { recursive: true });
  fs.mkdirSync(paths.outputGm, { recursive: true });
  // player.md / gm.md are seeded like any other default file — not written here.
  // A built-in case ships its own under canonical/cases/<slug>/; for everything
  // else they come from globaldata/input/player.md and globaldata/GM/gm.md via
  // the global seed below. Built-in case seeding passes deferGlobalSeed so it can
  // lay its own files down first and have the copy-if-missing global pass skip
  // them (see copyCanonicalCaseFiles).
  if (!options.deferGlobalSeed) seedGlobalSessionFiles(paths);
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
    syncSessionCoverOnRename(nextSession, slugifySessionName(previousName), slugifySessionName(nextName));
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
  const manifest = readSeedManifest(paths);
  const files = [];

  function addFile(fullPath, entry) {
    const ext = path.extname(entry.name).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) return;
    if (GENERATED_FILENAMES.has(entry.name)) return;
    const visibility = classifySessionFileVisibility(fullPath, paths);
    if (!includePrivate && visibility === 'gm') return;

    const stat = fs.statSync(fullPath);
    const kind = getFileKind(ext);
    // All file types are treated the same: every file carries its seed state
    // (seeded / seed_identical / seed_source) so the Edit Files tab can offer
    // Revert uniformly — image, pdf, md, txt alike.
    const record = {
      path: repoRelative(fullPath),
      relative_path: normaliseSlash(path.relative(paths.root, fullPath)),
      kind,
      visibility,
      visibility_fixed: isVisibilityFixed(fullPath, paths),
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      ...seedStateForFile(manifest, paths, fullPath)
    };
    // A graphic's generating prompt lives in a "<file>.prompt.txt" sidecar
    // (itself never listed). Surface it so the Edit Files / index table can
    // show and edit it without a second round-trip.
    if (kind === 'graphic') {
      try {
        const sidecar = `${fullPath}.prompt.txt`;
        if (fs.existsSync(sidecar)) {
          const raw = fs.readFileSync(sidecar, 'utf8').trim();
          record.prompt = raw;
          // Letters stash their compose-form definition (JSON) in this same
          // sidecar so the composer can reopen pre-filled; flag it so the UI
          // can offer "Edit letter" alongside the raw editor.
          if (raw.startsWith('{')) {
            try { const def = JSON.parse(raw); if (def && def._letter) record.letter = def; } catch { /* a plain prompt that merely starts with { */ }
          }
        }
      } catch { /* non-fatal */ }
      // A "<file>.excalidraw.json" sidecar means this graphic was drawn in the
      // diagram editor and can be reopened/edited there (vs. a flat raster).
      try {
        if (fs.existsSync(`${fullPath}.excalidraw.json`)) record.scene = true;
      } catch { /* non-fatal */ }
    }
    files.push(record);
  }

  if (fs.existsSync(paths.root)) {
    const rootEntries = fs.readdirSync(paths.root, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isFile()) continue;
      addFile(path.join(paths.root, entry.name), entry);
    }
  }
  walkFiles(paths.input, addFile);
  walkFiles(paths.gallery, addFile); // player-visible artifacts
  if (includePrivate) walkFiles(paths.gmInput, addFile); // includes GM/Gallery
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
  const users = db.prepare("SELECT id, username, role, created_at FROM users ORDER BY role, username").all();
  const parsedSessionId = parseInt(sessionId, 10);
  const allSessions = db.prepare(
    "SELECT id, name FROM sessions WHERE COALESCE(description, '') != ? ORDER BY created_at DESC"
  ).all(DOMESTIC_SYSTEM_DESCRIPTION);
  const sessionByKey = new Map();
  for (const s of allSessions) sessionByKey.set(scopeNameKey(s.name), s);
  const filterSession = Number.isInteger(parsedSessionId)
    ? db.prepare("SELECT id, name FROM sessions WHERE id = ?").get(parsedSessionId)
    : null;

  // Each character sheet is now one row whose data.scope lists every case it
  // appears in. The roster reports one entry per (sheet × case in scope).
  const sheetRows = db.prepare(`
    SELECT cs.id, cs.user_id, cs.data, u.username, u.role
    FROM character_sheets cs
    JOIN users u ON u.id = cs.user_id
    ORDER BY u.username
  `).all();

  const characters = [];
  for (const row of sheetRows) {
    const data = parseSheetData(row.data);
    const characterName = String(data.name || '').trim();
    if (!characterName) continue;
    const scope = sheetScope(data);
    const matched = [];
    for (const name of scope) {
      const sess = sessionByKey.get(scopeNameKey(name));
      if (!sess) continue;
      if (filterSession && sess.id !== filterSession.id) continue;
      matched.push(sess);
    }
    for (const sess of matched) {
      characters.push({
        user_id: row.user_id,
        username: row.username,
        role: row.role,
        session_id: sess.id,
        session_name: sess.name,
        character_name: characterName,
        occupation: String(data.occupation || '').trim() || null
      });
    }
  }

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
  const manifest = readSeedManifest(paths);
  function addFile(fullPath, entry) {
    const ext = path.extname(entry.name).toLowerCase();
    if (!MARKDOWN_EXTENSIONS.has(ext)) return;
    const visibility = classifySessionFileVisibility(fullPath, paths);
    if (!includePrivate && visibility === 'gm') return;
    const content = fs.readFileSync(fullPath, 'utf8');
    const rel = normaliseSlash(path.relative(paths.root, fullPath));
    sources.push({
      path: repoRelative(fullPath),
      relative_path: rel,
      visibility,
      visibility_fixed: isVisibilityFixed(fullPath, paths),
      content,
      ...seedStateForFile(manifest, paths, fullPath)
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

// Read-time join: copy each NPC's / player character's portrait from their
// sheet in the DB onto the matching narrative entity entry in `entities.npcs`
// and `entities.characters`. No caching — runs per request. Same source the
// character-sheet UI uses, so a portrait edit anywhere flows through.
function attachEntityPortraits(entities, session, db) {
  if (!entities || typeof entities !== 'object' || !session || !db) return;
  const byName = new Map();
  const norm = (s) => String(s || '').toLowerCase().trim();
  try {
    const rows = db.prepare('SELECT data FROM character_sheets').all();
    for (const r of rows) {
      let d; try { d = r.data ? JSON.parse(r.data) : null; } catch { d = null; }
      if (!d || !sheetHasCase(d, session.name)) continue;
      if (typeof d.portrait === 'string' && d.portrait && d.name) byName.set(norm(d.name), d.portrait);
    }
  } catch { /* best-effort */ }
  if (!byName.size) return;
  for (const k of ['npcs', 'characters']) {
    const arr = Array.isArray(entities[k]) ? entities[k] : null;
    if (!arr) continue;
    for (const it of arr) {
      if (it && typeof it === 'object' && it.name && !it.portrait) {
        const p = byName.get(norm(it.name));
        if (p) it.portrait = p;
      }
    }
  }
}

function loadSessionScenarioInfoForUser(sessionId, user, db) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const paths = ensureSessionDataFolders(session);
  const isGM = user && user.role === 'gm';
  // NPC portraits live in the sheet data (n.sheet.portrait) and are rendered
  // live from there wherever the UI shows a portrait — no extraction step.
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

  const result = {
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
  attachEntityPortraits(result.entities, session, db);
  return result;
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

function writeArtifactForSection(session, paths, config, artifact, options = {}) {
  if (config.artifact === 'player') {
    artifact.session = { id: session.id, name: session.name };
    artifact.source_files = listSessionSourceFiles(session, { includePrivate: false });
    // Prune the removed `threads` category from older artifacts as they are rewritten.
    delete artifact.threads;
  } else {
    artifact.session = { id: session.id, name: session.name };
  }
  if (options.touchGeneratedAt !== false) artifact.generated_at = new Date().toISOString();
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

function renderImageInventory(sourceFiles) {
  const imgs = (sourceFiles || []).filter((f) => f && f.kind === 'graphic' && f.path);
  if (!imgs.length) return '';
  const list = imgs.map((f) => `- ${String(f.path).split('/').pop()}`).join('\n');
  return [
    '## Available Images',
    '',
    'These image files are in scope for this section. When one is clearly about a place, person, thing, or topic you are writing about, embed it on its OWN line directly beneath the most relevant `##`/`###` heading inside that section\'s Markdown `content`, written exactly as `![concise caption](EXACT-FILENAME)`. At most one image per heading. Use a filename from this list **verbatim** — never invent, rename, alter, or path-qualify a filename, and never reference an image that is not listed. If none clearly fit, embed none.',
    '',
    list
  ].join('\n');
}

function renderCommonPromptContext(session, db, sourceFiles) {
  const roster = listRoster(db, session.id);
  const speakers = listMarkdownSpeakers(sourceFiles);
  const imageInventory = renderImageInventory(sourceFiles);

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
    renderSpeakersMarkdown(speakers),
    ...(imageInventory ? ['', imageInventory] : [])
  ].join('\n');
}

// Optional GM-authored override markdown. The GM creates a small .md under
// `input/overrides/` and it's appended to the section's prompt as the most-
// authoritative block — source-level guidance, no cache editing. Per-item file
// is preferred for looped sections; a section-wide file applies to every item.
function readSectionOverride(paths, sectionId, itemKey) {
  try {
    const dir = path.join(paths.input, 'overrides');
    const candidates = itemKey
      ? [`${sectionId}.${itemKey}.md`, `${sectionId}.md`]
      : [`${sectionId}.md`];
    for (const name of candidates) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    }
  } catch { /* best-effort */ }
  return '';
}

function renderOverrideBlock(text) {
  if (!text) return '';
  return `\n\n## GM Override for this Section (authoritative)

The Game Master has provided the following direction for this section. Treat it as authoritative — it overrides any priors shown in the Current Section Value above. Apply it now.

${text}
`;
}

function renderSectionPrompt(session, db, config, artifact, currentValue, sourceFiles) {
  const paths = ensureSessionDataFolders(session);
  const overrideBlock = renderOverrideBlock(readSectionOverride(paths, config.id));
  const expected = config.type === 'array' ? 'a JSON array' : 'a JSON object';
  const orderedSourceFiles = sortPromptSources(sourceFiles);
  const inScopeImageNames = (sourceFiles || [])
    .filter((f) => f && f.kind === 'graphic' && f.path)
    .map((f) => String(f.path).split('/').pop());
  const imageDirective = inScopeImageNames.length ? [
    '',
    '## REQUIRED: Embed Matching Images',
    '',
    'Before returning, check the image filenames below. For every item whose name or subject clearly matches one of these files, you MUST embed that image inside that item\'s Markdown content string: a line consisting of an exclamation mark, then a short caption in square brackets, then the exact filename in parentheses, placed on its own line directly under the most relevant heading. Example for an item about 1 Example Street with a file 1-example-street.png: the line would be exclamation-mark, [1 Example Street] then (1-example-street.png).',
    'This is expected output and overrides any reluctance from the JSON / no-raw-HTML rules (Markdown images are allowed; raw HTML is not). Match generously on subject: a file named for an address, place, person, or object matches the location / NPC / item about that thing. Use these filenames exactly and never invent one:',
    ...inScopeImageNames.map((n) => `- ${n}`),
    'If an item has no clearly matching file, add nothing for it.'
  ].join('\n') : '';
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

  // Ordered for prompt/prefix-cache reuse: everything that is identical for
  // every section of this artifact (the full source corpus, common context,
  // rules) comes FIRST as a stable prefix; the per-section ask and the
  // mutating artifact JSON come LAST. With the model resident (keep_alive)
  // and calls serialised (AI-exclusivity gate), sections 2..N reuse the
  // cached prefill of the corpus instead of re-processing ~all of it.
  return `# The Folly — Scenario Regeneration

You are regenerating scenario information for The Folly web app, one section at a time. Study all of the source material and rules below; the specific section to produce — and the current artifact — are given at the very end.

${renderPromptFileBundle(orderedSourceFiles)}
${imageDirective}

${renderCommonPromptContext(session, db, sourceFiles)}

## Rules

- Return only valid JSON for this one section. No markdown fences, commentary, planning text, or wrapper object.
- GROUNDING: every statement about what happened — who did or found something, who met whom, where they went, what they were told, and when — must trace to the **Authoritative Case Sources** (the WhatsApp transcript and GM-authored case files). If the case sources do not establish it, do not write it. Never introduce people, places, organisations, meetings, relationships, or timeline from the World Reference; those files only explain what an already-mentioned name or term *is*. When in doubt, leave it out rather than guess.
- COMPLETENESS: this is the players' primary record of the case — they do not read the raw files. Surface ALL pertinent case information for this section: facts, decisions, clues, leads, who did what, current state, and consequences. Do not omit relevant detail to be brief; for case facts, favour completeness over concision. It is an analysis task, not a terse summary.
- The session transcript comes from WhatsApp. Message headings identify the speaker and time, and replies/linkage clarify the thread of conversation. Follow those conversational threads; do not treat a message heading as a story event in itself.
- Do not create generic timeline fields or timeline paragraphs. If chronology matters, write it naturally inside the analysis for the item.
- The Current Section Value below is shown for reference only. Re-derive this section from the Authoritative Case Sources; do not echo, paraphrase, or "preserve facts" from the prior value if your fresh reading of the sources would phrase or structure them differently.
- Prefer factual prose over speculation. Preserve ambiguity explicitly: "unknown", "unconfirmed", or "requires sign-off".
- Cite sources with repo-relative paths in sources[].path, preferring the Authoritative Case Sources.
- IMAGES: the "no raw HTML" rule does NOT forbid Markdown images. If the "Available Images" section lists a file whose name clearly matches a place/person/thing/topic you describe, you SHOULD embed it: put a Markdown image (exclamation mark, [concise caption], then (EXACT-FILENAME) in parentheses) on its own line inside that item's Markdown content string, directly under the most relevant heading. Use filenames verbatim from that list only; never invent one.
${accessRules}

---

# The Section To Produce Now

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
## Current Complete Artifact

This is the rest of the player/GM record. Make this section cohere with it: same names, same IDs, no contradictions. "What has happened" is the spine — session summaries extend it, and entities/threads must be consistent with both. Extend and reconcile; do not regress detail another section already captured.

${renderJsonBlock(artifact)}

## Current Section Value

${renderJsonBlock(currentValue ?? (config.type === 'array' ? [] : null))}
${overrideBlock}
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
async function callOllama(prompt, { signal, label, onProgress, onToken, messages } = {}) {
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

  ollamaControllers.add(controller);
  ollamaActivity.active += 1;
  ollamaActivity.startedAt = ollamaActivity.startedAt || new Date().toISOString();
  if (label) ollamaActivity.lastSection = label;

  try {
    const numCtx = await resolveNumCtx();
    const requestedModel = effectiveOllamaModel();
    console.info(`[ai.call] requested=${requestedModel} ctx=${numCtx} label=${label ?? "?"}`);
    const response = await fetch(`${effectiveOllamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...(ollamaDispatcher ? { dispatcher: ollamaDispatcher } : {}),
      body: JSON.stringify({
        model: requestedModel,
        stream: true,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: {
          num_ctx: numCtx,
          temperature: 0.2
        },
        messages: Array.isArray(messages) && messages.length ? messages : [
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
    let stats = null;
    const consume = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try { obj = JSON.parse(trimmed); } catch { return; }
      if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
      if (obj.message && typeof obj.message.content === 'string' && obj.message.content) {
        content += obj.message.content;
        if (typeof onToken === 'function') {
          try { onToken(obj.message.content); } catch { /* token sink is best-effort */ }
        }
      }
      // Terminal object carries Ollama's eval stats. prompt_eval_count is the
      // prefix-cache tell: it collapses on a cache hit (only the new tail).
      if (obj.done) {
        const evalMs = Math.round((obj.eval_duration || 0) / 1e6);
        stats = {
          prompt_eval_count: obj.prompt_eval_count ?? null,
          eval_count: obj.eval_count ?? null,
          model: obj.model || null,
          prompt_eval_ms: Math.round((obj.prompt_eval_duration || 0) / 1e6),
          eval_ms: evalMs,
          total_ms: Math.round((obj.total_duration || 0) / 1e6),
          tok_per_s: (obj.eval_count && evalMs) ? +(obj.eval_count / (evalMs / 1000)).toFixed(1) : null
        };
      }
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
    if (typeof onProgress === 'function' && stats) {
      try { onProgress({ label, chars: content.length, elapsedMs: Date.now() - startedMs, metrics: { ...stats, num_ctx: numCtx } }); } catch { /* best-effort */ }
    }
    // Raw token figures for every AI call (local model = $0 actual; cost
    // mapping, if any, is done outside the app from these log lines).
    if (stats) {
      const lbl = label == null ? '' : String(label);
      console.info(`[ai.tokens] requested=${effectiveOllamaModel()} actual=${stats.model ?? '?'} label=${/\s/.test(lbl) ? JSON.stringify(lbl) : lbl} prompt_tokens=${stats.prompt_eval_count ?? ''} completion_tokens=${stats.eval_count ?? ''} total_ms=${stats.total_ms ?? ''}`);
    }
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
    ollamaControllers.delete(controller);
    ollamaActivity.active = Math.max(0, ollamaActivity.active - 1);
    if (ollamaActivity.active === 0) ollamaActivity.startedAt = null;
  }
}

// Normalise a name/heading/filename to a match key: lowercase, every run of
// non-alphanumerics (spaces, "/", "'", punctuation — anything illegal in a
// filename) collapses to a single "-". So entity "Digbeth / Floodgate Street"
// and file "digbeth-floodgate-street-map.png" both reduce to a comparable form.
function imgMatchKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Filename PREFIX match. Separators in the name are OPTIONAL in the file, so a
// name like "Regent's Canal reach" (key regent-s-canal-reach) matches stems
// "regents-canal-reach-...", "regent-s-canal-reach-...", "regentscanalreach-..."
// etc. A trailing "-" or end-of-stem keeps word boundaries (so "Mary" does not
// match "marylebone").
function imagesForName(name, imgs) {
  const key = imgMatchKey(name);
  if (key.replace(/-/g, '').length < 3) return [];
  const pat = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-?');
  const re = new RegExp(`^${pat}(?:-|$)`);
  return imgs.filter((im) => re.test(im.stem));
}

function mdHasImage(md, file) {
  return String(md || '').includes(`](${file})`);
}
// Auto-injected images carry NO caption: the matcher only attaches a file whose
// name prefix-matches the heading/entity it sits under, so any caption would just
// echo that heading — redundant, and a visible <figcaption> crowds the prose. A
// GM's own `![caption](file)` typed in source markdown is left alone (it is not
// a standalone auto-injected line). Empty alt → the client falls back to the
// filename for accessibility.
function imageLine(file) {
  return `![](${file})`;
}

// Remove EVERY standalone image line. Image delivery is fully deterministic:
// the indexer rebuilds refs from scratch each pass, so a stale, renamed,
// out-of-scope, portrait, or model-hallucinated `![](...)` line just vanishes
// — nothing is matched/whitelisted to decide what to keep.
function stripAutoImageLines(md) {
  return String(md || '').split('\n')
    .filter((line) => !/^!\[[^\]]*\]\([^)\s]+\)$/.test(line.trim()))
    .join('\n');
}

// Inject standalone image refs into a Markdown `content` string: under EVERY
// `##`/`###` heading whose text prefix-matches a file, plus (for entity items)
// the first content heading when the item's own name matches. Each file is
// injected at most once per content block (under the earliest heading it
// matches), so multi-section prose like the case summary shows a picture under
// each relevant heading without duplication. Idempotent.
function injectImagesIntoContent(content, itemName, imgs) {
  let md = stripAutoImageLines(String(content == null ? '' : content));
  const lines = md.split('\n');
  const out = [];
  let anyHeadingMatched = false;
  const pushImages = (matches) => {
    const pending = matches.filter((im) => !mdHasImage(out.join('\n'), im.file) && !mdHasImage(md, im.file));
    if (!pending.length) return false;
    for (const im of pending) out.push('', imageLine(im.file), '');
    return true;
  };

  // 1) Per-heading matches. EVERY heading gets its own prefix-matched image(s);
  // pushImages dedupes per file so a file lands under the first heading only.
  for (const line of lines) {
    out.push(line);
    const h = line.trim().match(/^#{2,4}\s+(.*?)\s*#*$/);
    if (h) {
      const matches = imagesForName(h[1], imgs);
      if (matches.length && pushImages(matches)) {
        anyHeadingMatched = true;
      }
    }
  }
  md = out.join('\n');

  // 2) Whole-item name fallback — only if no heading received any image.
  if (!anyHeadingMatched && itemName) {
    const matches = imagesForName(itemName, imgs).filter((im) => !mdHasImage(md, im.file));
    if (matches.length) {
      const itemLines = md.split('\n');
      const next = [];
      let placed = false;
      for (const line of itemLines) {
        next.push(line);
        if (!placed && line.trim().match(/^#{2,4}\s+(.*?)\s*#*$/)) {
          for (const im of matches) next.push('', imageLine(im.file), '');
          placed = true;
        }
      }
      md = placed
        ? next.join('\n')
        : `${matches.map((im) => imageLine(im.file)).join('\n\n')}\n\n${md}`;
    }
  }
  return md;
}

// Deterministic post-generation pass: surface in-scope images by matching
// their filename prefix to entity names / headings, so delivery never depends
// on the model emitting Markdown image syntax. sourceFiles is already
// visibility-scoped for this section.
function injectImagesIntoValue(value, config, sourceFiles) {
  if (value == null) return value;
  // In-scope graphics eligible for inline insertion. NPC portraits are excluded
  // here only — they render per entity card, so injecting them in prose too
  // would double up. (Stripping is unconditional, so nothing needs whitelisting
  // to be removed.)
  const imgs = (sourceFiles || [])
    .filter((f) => f && f.kind === 'graphic' && f.path)
    .map((f) => {
      const file = String(f.path).split('/').pop();
      return { file, stem: imgMatchKey(file.replace(/\.[^.]+$/, '')) };
    })
    .filter((im) => !/-?portrait$/.test(im.stem));

  const fixItem = (item) => {
    if (!item || typeof item !== 'object' || typeof item.content !== 'string') return item;
    const name = item.name || item.title || item.character || '';
    item.content = injectImagesIntoContent(item.content, name, imgs);
    return item;
  };

  if (Array.isArray(value)) return value.map(fixItem);
  if (typeof value === 'object' && typeof value.content === 'string') return fixItem(value);
  return value;
}

function scenarioSlug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Detected session transcripts in input/ (case-insensitive Session-NN.md).
function detectSessionItems(session, db, paths) {
  let names = [];
  try { names = fs.readdirSync(paths.input); } catch { return []; }
  const items = [];
  for (const name of names) {
    const m = /^session[-_ ]?0*(\d+)\.(?:md|markdown)$/i.exec(name);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    items.push({ key: `session-${n}`, n, title: `Session ${n}`, file: repoRelative(path.join(paths.input, name)) });
  }
  return items.sort((a, b) => a.n - b.n);
}

function loopPrereqError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// Player characters from assigned players' actual character sheets (one item
// each). This deliberately does not use listRoster()'s username fallback:
// regeneration needs a real character-name index before it spends an LLM call.
function listCharacterItems(session, db) {
  const players = db.prepare(`
    SELECT u.id AS user_id, u.username, u.role
    FROM session_players sp
    JOIN users u ON u.id = sp.user_id
    WHERE sp.session_id = ? AND u.role = 'player'
    ORDER BY u.username
  `).all(session.id);

  // For each assigned player, find the character sheet they own that has this
  // case in scope. Players with no matching sheet appear as `data:null` so the
  // downstream "missing name" diagnostic still fires correctly.
  const findSheet = db.prepare('SELECT data FROM character_sheets WHERE user_id = ?');
  const rows = players.map((p) => {
    const sheets = findSheet.all(p.user_id);
    const match = sheets.find((s) => sheetHasCase(parseSheetData(s.data), session.name));
    return { ...p, data: match ? match.data : null };
  });

  const missing = [];
  const invalidNames = [];
  const duplicateNames = [];
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const data = parseSheetData(row.data);
    const nm = String(data.name || '').trim();
    if (!nm) {
      missing.push(row.username);
      continue;
    }
    const slug = scenarioSlug(nm);
    if (!slug) {
      invalidNames.push(nm);
      continue;
    }
    const key = `char-${slug}`;
    if (seen.has(key)) {
      duplicateNames.push(nm);
      continue;
    }
    seen.add(key);
    items.push({ key, name: nm, title: nm });
  }
  if (missing.length) {
    throw loopPrereqError(`Cannot regenerate player character summaries: missing character sheet name for assigned player account(s): ${missing.join(', ')}.`);
  }
  if (invalidNames.length) {
    throw loopPrereqError(`Cannot regenerate player character summaries: character name(s) cannot produce stable output id(s): ${invalidNames.join(', ')}.`);
  }
  if (duplicateNames.length) {
    throw loopPrereqError(`Cannot regenerate player character summaries: duplicate character name(s) would produce the same output id: ${duplicateNames.join(', ')}.`);
  }
  if (!items.length) {
    throw loopPrereqError('Cannot regenerate player character summaries: no assigned player character sheet names were found.');
  }
  return items;
}

// Sections regenerated as a code-driven per-item loop (one small focused
// Ollama call per item, array assembled in code) instead of one call that
// must emit the whole array.
// NPCs allocated to this case, as loop items for per-NPC knowledge generation.
function listNpcItems(session, db) {
  const rows = db.prepare('SELECT data FROM character_sheets WHERE user_id IS NULL').all();
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const data = parseSheetData(r.data);
    if (!sheetHasCase(data, session.name)) continue;
    const nm = String(data.name || '').trim();
    if (!nm) continue;
    const slug = scenarioSlug(nm);
    if (!slug) continue;
    const key = `npc-${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, name: nm });
  }
  items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return items;
}

// Lowercased name-keys of the NPCs allocated to this case (the Admin NPC
// allocations — same source as the per-NPC knowledge loop). Used to gate the
// player-facing NPC chat down to the characters actually in this case. Matching
// is by lowercased name, consistent with getNpcCaseKnowledge().
function caseNpcNameKeys(session, db) {
  if (!session || !db) return new Set();
  try {
    return new Set(listNpcItems(session, db).map((i) => i.name.toLowerCase()));
  } catch {
    return new Set();
  }
}

const LOOPED_SECTIONS = {
  'player.summary.session_summaries': (session, db, paths) => detectSessionItems(session, db, paths),
  'player.entities.characters': (session, db) => listCharacterItems(session, db),
  'gm.npc_knowledge': (session, db) => listNpcItems(session, db)
};

function emptyLoopMessage(config) {
  if (config.id === 'player.summary.session_summaries') {
    return 'Cannot regenerate session summaries: no session transcript files matching session-NN.md were found under input/.';
  }
  if (config.id === 'player.entities.characters') {
    return 'Cannot regenerate player character summaries: no assigned player character sheet names were found.';
  }
  if (config.id === 'gm.npc_knowledge') {
    return 'Cannot regenerate NPC knowledge: no NPCs are allocated to this case.';
  }
  return `Cannot regenerate ${config.title}: no loop items were found.`;
}

function itemFocusPrompt(config, item) {
  const head = [
    '',
    '## OUTPUT OVERRIDE — one item only',
    'Disregard any instruction to return a JSON array. Return EXACTLY ONE JSON object',
    '(no array, no wrapper) matching the element shape described above, for THIS item only:'
  ];
  if (config.id === 'player.summary.session_summaries') {
    head.push(
      `- id: "${item.key}" (use exactly this id)`,
      `- title: based on "${item.title}"`,
      `Cover everything that happened in THIS session, grounded only in its transcript`,
      `(${item.file}) plus the World Reference for term clarification.`,
      '- Choose the `presentation` that best fits THIS session: "scene" for chronological shared-group play, "player" for fragmented character-specific/WhatsApp threads, or "location" for place-by-place recall. Do not make a session character-centric unless the transcript itself is fragmented that way.'
    );
  } else if (config.id === 'player.entities.characters') {
    head.push(
      `- id: "${item.key}" (use exactly this id)`,
      `- name: "${item.name}"`,
      `The fullest account of THIS player character across the whole case, grounded in the case sources.`
    );
  } else if (config.id === 'gm.npc_knowledge') {
    head.push(
      `- id: "${item.key}" (use exactly this id)`,
      `- name: "${item.name}"`,
      `Write what the NPC "${item.name}" knows about this case, from their own perspective, grounded in the case sources. Include only what this character could plausibly know — never make them omniscient — and note what they do not know where relevant.`,
      `Also infer "${item.name}"'s influence on the case from the live-play transcript: sort what the GM tells the players into game-framework / player-discovery / NPC-delivered, and attribute to "${item.name}" only what they witnessed, were told, did, disclosed, or — if the players operate under this character's authority within the setting — tasked and directed even where the GM delivered it as plain framework. Calibrate to how central "${item.name}" actually is: keep a walk-on's influence minimal or omit it; never inflate a minor presence.`
    );
  }
  head.push('', 'Return exactly one JSON object now.');
  return head.join('\n');
}

function loopedItemSourceFiles(config, item, sourceFiles) {
  const ordered = sortPromptSources(sourceFiles);
  if (config.id === 'player.summary.session_summaries' && item.file) {
    return ordered.filter((file) => {
      if (!file || file.kind !== 'markdown') return false;
      if (file.path === item.file) return true;
      if (String(file.path || '').endsWith('/input/player.md')) return true;
      return !isCaseSourceFile(file);
    });
  }
  return ordered.filter((file) => file && file.kind === 'markdown');
}

// Per-item prompt for looped sections. It is grounded in the original session
// .md files plus root reference .md files. It deliberately excludes the current
// generated artifact/section value, so character/session loops cannot compound
// old summary omissions or hallucinations.
function renderLoopedItemPrompt(session, db, config, item, sourceFiles) {
  const promptSources = loopedItemSourceFiles(config, item, sourceFiles);
  const paths = ensureSessionDataFolders(session);
  const overrideBlock = renderOverrideBlock(readSectionOverride(paths, config.id, item.key));
  const expected = 'one JSON object';
  const accessRules = config.artifact === 'player'
    ? [
        '- This is player-visible. Never include secrets, future plans, hidden causes, or private GM interpretation.',
        '- The `known_by` field must use exact character names from the application roster, or ["all"] only when the whole table plainly shares it.'
      ].join('\n')
    : '- This is GM-only analysis. It may include private plans, pacing advice, hidden causes, and player engagement guidance.';

  return `# The Folly — Scenario Item Regeneration

You are regenerating one item inside one scenario section for The Folly web app. Use the original Markdown sources below as the authority. Do not infer facts from any previously generated JSON; none is supplied.

${renderPromptFileBundle(promptSources)}

${renderCommonPromptContext(session, db, promptSources)}

## Rules

- Return only valid JSON for this one item. No markdown fences, commentary, planning text, or wrapper object.
- GROUNDING: every statement about what happened must trace to the Authoritative Case Sources above. If the source files do not establish it, omit it.
- The root/session-folder Markdown files outside input/ are world/reference material only. Use them to clarify terms already present in the case sources; do not turn them into events.
- Be exhaustive for this item. Surface concrete actions, discoveries, decisions, interactions, carried/controlled items, current state, and unresolved threads.
- Cite supplied source files with repo-relative paths in \`sources[].path\`.
- GitHub-flavoured Markdown is allowed only inside string fields; raw HTML is not allowed.
${accessRules}

---

# The Item To Produce Now

Session: ${session.name} (id ${session.id})
Section id: ${config.id}
Section title: ${config.title}
Destination JSON path: ${config.path.join('.')}
Expected response: ${expected}

## Goal

${config.goal}
${config.schemaHint ? `
## Element Shape

${config.schemaHint}
` : ''}
${itemFocusPrompt(config, item)}
${overrideBlock}`;
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
  // Optional debug dump of the byte-identical prompt + raw response per call,
  // for inspecting why the model is producing a given shape. Off by default;
  // set DEBUG_DUMP_PROMPTS=1 in the environment to enable. Writes into the
  // case folder so the trace travels with the case data.
  const dumpDebug = (key, ext, content) => {
    if (!process.env.DEBUG_DUMP_PROMPTS) return;
    try {
      const dir = path.join(paths.root, 'debug-prompts');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${key}.${ext}`), content);
    } catch { /* best-effort */ }
  };
  const sourceFiles = listSessionSourceFiles(session, { includePrivate: config.artifact === 'gm' });
  const loopedItems = LOOPED_SECTIONS[config.id];
  const items = loopedItems
    ? loopedItems(session, db, paths, sourceFiles)
    : null;

  let nextValue;
  if (loopedItems) {
    if (!items || !items.length) throw loopPrereqError(emptyLoopMessage(config));
    // Per-item loop: shared corpus prefix is identical across items (prefix
    // cache reuse); only the small focus tail + output differ.
    const out = [];
    for (let i = 0; i < items.length; i += 1) {
      if (opts.signal && opts.signal.aborted) throw new Error('cancelled');
      const it = items[i];
      const itemLabel = it.title || it.name || it.key;
      const itemProgress = (p = {}) => {
        if (typeof opts.onProgress === 'function') {
          try { opts.onProgress({ ...p, item: it.key, item_label: itemLabel, item_index: i + 1, item_total: items.length }); } catch { /* best-effort */ }
        }
      };
      itemProgress({ label: config.id });
      const prompt = renderLoopedItemPrompt(session, db, config, it, sourceFiles);
      dumpDebug(`${config.id}.${it.key}`, 'prompt.md', prompt);
      const raw = await callOllama(prompt, { label: itemLabel, signal: opts.signal, onProgress: itemProgress });
      dumpDebug(`${config.id}.${it.key}`, 'response.txt', raw);
      let obj;
      try {
        obj = JSON.parse(extractJsonCandidate(raw));
      } catch (e) {
        const error = new Error(`Ollama returned invalid JSON for ${config.id}:${it.key}: ${e.message}`);
        error.ollama_response = raw;
        throw error;
      }
      if (Array.isArray(obj)) obj = obj.find((x) => x && typeof x === 'object') || null;
      if (obj && typeof obj === 'object') {
        obj.id = it.key;                       // code-owned, deterministic
        if (!obj.title && it.title) obj.title = it.title;
        out.push(obj);
      }
    }
    saveSectionBackup(paths, config, currentValue ?? []);
    nextValue = injectImagesIntoValue(out, config, sourceFiles);
  } else {
    const prompt = renderSectionPrompt(session, db, config, artifact, currentValue, sourceFiles);
    dumpDebug(config.id, 'prompt.md', prompt);
    const raw = await callOllama(prompt, { label: config.id, signal: opts.signal, onProgress: opts.onProgress });
    dumpDebug(config.id, 'response.txt', raw);
    let parsed;
    try {
      parsed = JSON.parse(extractJsonCandidate(raw));
    } catch (e) {
      const error = new Error(`Ollama returned invalid JSON for ${config.id}: ${e.message}`);
      error.ollama_response = raw;
      throw error;
    }
    saveSectionBackup(paths, config, currentValue ?? (config.type === 'array' ? [] : null));
    nextValue = injectImagesIntoValue(normaliseSectionValue(config, parsed), config, sourceFiles);
  }
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

function cloneJsonValue(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

// Re-run deterministic post-processing (currently image insertion + artifact
// source-file refresh) without calling Ollama. The browser-rendered indexes are
// rebuilt on reload from the same stored JSON.
function refreshScenarioIndexes(sessionId, db, options = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) return null;
  const ids = listScenarioSectionIds(options);
  if (!ids.length) {
    const error = new Error('No matching scenario sections to refresh');
    error.statusCode = 400;
    throw error;
  }

  const refreshed = [];
  const outputPaths = new Set();
  for (const id of ids) {
    const section = readScenarioSection(session, id);
    if (!section) continue;
    const { config, paths, artifact, value } = section;
    const artifactPath = artifactPathForSection(paths, config);
    if (!fs.existsSync(artifactPath)) continue;
    if (value == null) continue;
    const sourceFiles = listSessionSourceFiles(session, { includePrivate: config.artifact === 'gm' });
    const nextValue = injectImagesIntoValue(cloneJsonValue(value), config, sourceFiles);
    setPathValue(artifact, config.path, nextValue);
    artifact.indexed_at = new Date().toISOString();
    writeArtifactForSection(session, paths, config, artifact, { touchGeneratedAt: false });
    refreshed.push(id);
    outputPaths.add(repoRelative(artifactPath));
  }
  return { session: session.id, refreshed, output_paths: [...outputPaths] };
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

// GM-only brainstorming assistant grounded in the full case material.
function buildGmChatSystemPrompt(session, db) {
  const paths = ensureSessionDataFolders(session);
  const sourceFiles = listSessionSourceFiles(session, { includePrivate: true });
  const scenarioInfo = readExistingJsonForPrompt(paths.scenarioInfo) || {};
  const gmAnalysis = readExistingJsonForPrompt(paths.gmAnalysis) || {};

  return [
    `# GM Brainstorming Assistant — ${session.name}`,
    '',
    'You are a Game Master\'s private brainstorming partner for this Rivers of London tabletop case. This conversation is GM-only and is never shown to players, so you may freely discuss secrets, hidden causes, villain plans, twists, and pacing.',
    '',
    '## How to help',
    '- Be a practical collaborator: offer concrete options, next beats, NPC motivations, clue placement, contingencies, and consequences.',
    '- Ground statements about what has actually happened in the Authoritative Case Sources below. You may speculate and invent freely when brainstorming, but clearly mark invention/speculation as such versus what the sources establish.',
    '- Do not claim the investigators met, went, found, or were told something unless the case sources show it. Proposing that they *could* is fine — label it as a suggestion.',
    '- Be concise and useful. This is prep, not prose for players.',
    '',
    // Caching: put the largest, most-stable blocks first (case source files incl.
    // seeded world lore, then roster/speakers) and the volatile, frequently
    // regenerated artifacts (scenario info / GM analysis) LAST — so regenerating
    // those doesn't invalidate the cached prompt prefix above.
    renderPromptFileBundle(sourceFiles),
    '',
    renderCommonPromptContext(session, db, sourceFiles),
    '',
    '## Current Player-Facing Scenario Info (what players can currently see)',
    '',
    renderJsonBlock(scenarioInfo),
    '',
    '## Current GM-Only Analysis',
    '',
    renderJsonBlock(gmAnalysis)
  ].join('\n');
}

function sanitiseChatMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : null);
    const content = String(m.content == null ? '' : m.content).trim();
    if (!role || !content) continue;
    cleaned.push({ role, content: content.slice(0, 8000) });
  }
  return cleaned.slice(-24);
}

// The big case-context system prompt is frozen for the life of a conversation
// so the prompt prefix stays byte-identical every turn. That lets Ollama reuse
// its KV cache (it only has to process the new message), so turns after the
// first are fast. A new conversation (first user turn) or the TTL rebuilds it,
// picking up any edited files / regenerated artifacts.
const gmChatPromptCache = new Map();
const GM_CHAT_PROMPT_TTL_MS = 2 * 60 * 60 * 1000;

// Streams a GM chat reply. opts.onToken receives text deltas; opts.signal cancels.
async function streamGmChat(sessionId, db, clientMessages, opts = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }
  const history = sanitiseChatMessages(clientMessages);
  if (!history.some((m) => m.role === 'user')) {
    const error = new Error('A user message is required');
    error.statusCode = 400;
    throw error;
  }

  const newConversation = history.filter((m) => m.role === 'user').length <= 1;
  const cached = gmChatPromptCache.get(session.id);
  const fresh = !cached || newConversation || (Date.now() - cached.builtAt) > GM_CHAT_PROMPT_TTL_MS;
  let systemPrompt;
  if (fresh) {
    systemPrompt = buildGmChatSystemPrompt(session, db);
    gmChatPromptCache.set(session.id, { prompt: systemPrompt, builtAt: Date.now() });
  } else {
    systemPrompt = cached.prompt;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];
  return callOllama(null, {
    messages,
    label: `gm-chat:${session.id}`,
    signal: opts.signal,
    onToken: opts.onToken
  });
}

// Streams a player-facing rules answer. The caller supplies the compact rules
// corpus and the current user's character JSON; this deliberately does not read
// scenario notes or any private rulebook source.
async function streamRulesChat(rulesMarkdown, characterContext, clientMessages, opts = {}) {
  const history = sanitiseChatMessages(clientMessages);
  if (!history.some((m) => m.role === 'user')) {
    const error = new Error('A user message is required');
    error.statusCode = 400;
    throw error;
  }

  const systemPrompt = [
    'You answer Rivers of London tabletop RPG rules questions for players.',
    'Use only the compact rules reference and the character JSON supplied below.',
    'Do not use, cite, or imply access to the original rulebook, private source files, scenario notes, GM-only material, or hidden app data.',
    'Respect each character ruleset. If a stat or derived value is absent from the character JSON, treat that absence as intentional and do not infer it from adjacent BRP-family games.',
    'If the compact rules reference does not contain the answer, say that the current compact rules set does not yet cover it.',
    'When the character JSON is relevant, apply the rule to that character concretely. If multiple characters are present and the question does not specify one, state which character data you used or ask the player to clarify.',
    '',
    '# Compact Rules Reference',
    String(rulesMarkdown || '').trim(),
    '',
    '# Character JSON',
    JSON.stringify(characterContext || { characters: [] }, null, 2)
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];
  return callOllama(null, {
    messages,
    label: 'rules-chat',
    signal: opts.signal,
    onToken: opts.onToken
  });
}

// ── NPC personas (chat-with-an-NPC) ─────────────────────────────────────────
// Personality data lives in Markdown, never in the character sheet. Canonical
// personas are bundled under globaldata/npcs/personas/ as a seed source; a case
// may override one with a "<Entity Name> - personality.md" handout (Edit Files),
// matched by the same filename-root association used for artifacts. The whole
// file is fed to the model (256k context — no truncation).
const NPC_PERSONA_ROOT = path.join(GLOBAL_ROOT, 'npcs', 'personas');

function parsePersonaFile(raw) {
  const meta = {};
  let body = String(raw || '');
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      let val = kv[2].trim();
      if (/^\[.*\]$/.test(val)) {
        val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      meta[kv[1]] = val;
    }
  }
  return { meta, body: body.trim() };
}

function asLoreList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return v ? [String(v).trim()].filter(Boolean) : [];
}

// Concatenate the shared world-reference docs a persona is tagged to know
// (frontmatter `lore: [the-folly, magic-overview, ...]`). Each tag is a stem of
// a Markdown file in globaldata/. This is the per-NPC "knowledge matrix": which
// setting docs get pulled into that character's chat, scoped to their remit.
// Resolve a lore stem to a Markdown file, checking globaldata/ first then the
// scenario corpus (rules/scenario/). Simple stem only — no path traversal.
function loreFilePath(stem) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(stem)) return null;
  for (const root of [GLOBAL_ROOT, SCENARIO_ROOT]) {
    const fp = path.join(root, `${stem}.md`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

function loadLoreFiles(loreList) {
  const out = [];
  for (const raw of asLoreList(loreList)) {
    const fp = loreFilePath(String(raw).toLowerCase().replace(/\.md$/, ''));
    if (!fp) continue;
    const text = fs.readFileSync(fp, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (text) out.push(text);
  }
  return out.join('\n\n---\n\n');
}

// Baseline in-world setting every NPC can draw on: the Folly + London gazetteer
// (Chapter 7). Player-safe canon — no GM-only spoilers — so it is appropriate as
// general knowledge for any character. Cached after first read.
let _settingGroundingCache = null;
function loadSettingGrounding() {
  if (_settingGroundingCache != null) return _settingGroundingCache;
  const fp = path.join(SCENARIO_ROOT, 'folly-and-london.md');
  let text = '';
  try {
    if (fs.existsSync(fp)) text = fs.readFileSync(fp, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  } catch { /* non-fatal: NPC chat still works without setting grounding */ }
  _settingGroundingCache = text;
  return text;
}

function listCanonicalPersonas() {
  if (!fs.existsSync(NPC_PERSONA_ROOT)) return [];
  return fs.readdirSync(NPC_PERSONA_ROOT)
    .filter((n) => /\.md$/i.test(n))
    .sort()
    .map((filename) => {
      const slug = filename.replace(/\.md$/i, '');
      const { meta, body } = parsePersonaFile(fs.readFileSync(path.join(NPC_PERSONA_ROOT, filename), 'utf8'));
      return { slug, name: meta.name || slug, body, lore: asLoreList(meta.lore) };
    });
}

function nameToSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Per-case personality handouts: "<Entity Name> - personality.md" anywhere in
// the session's files. Returns { name, body } for the best match, or null.
function findSessionPersonaByName(session, name) {
  if (!session) return null;
  try {
    const want = String(name || '').toLowerCase();
    for (const f of listSessionSourceFiles(session, { includePrivate: true })) {
      if (f.kind !== 'markdown') continue;
      const base = path.basename(f.path).replace(/\.md$/i, '');
      if (!/personality/i.test(base)) continue;
      const entity = base.replace(/\s*[-–—]\s*personality\s*$/i, '').trim();
      if (entity.toLowerCase() === want) {
        // Parse so a copied seed (which keeps its frontmatter) still feeds the
        // model a clean body, exactly like the canonical path.
        const parsed = parsePersonaFile(fs.readFileSync(path.join(REPO_ROOT, f.path), 'utf8'));
        return { name: entity, body: parsed.body, lore: asLoreList(parsed.meta.lore) };
      }
    }
  } catch { /* fall back to canonical */ }
  return null;
}

// On assigning an NPC to a case, copy its canonical personality file into the
// case's player area ("<Name> - personality.md") if no personality file for
// that NPC exists there yet. From then on the case copy is the editable canon
// and overrides the seed. Returns true if a file was written.
function seedNpcPersonaIntoCase(session, npcName) {
  const name = String(npcName || '').trim();
  if (!session || !name) return false;
  if (findSessionPersonaByName(session, name)) return false; // already present
  const persona = listCanonicalPersonas().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!persona) return false;
  const src = path.join(NPC_PERSONA_ROOT, `${persona.slug}.md`);
  if (!fs.existsSync(src)) return false;
  const paths = ensureSessionDataFolders(session);
  const safeName = name.replace(/[\/\\]/g, '-');
  const dest = path.join(paths.input, `${safeName} - personality.md`);
  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

// A character's personality handout ("<Name> - personality.md" in the player
// input area), keyed by character name. Backs the in-tab dictation editor and is
// the same file the talk-to-character AI reads. Works for player characters and
// GM-owned NPCs alike — the caller enforces who may write which character.
function characterPersonalityPath(session, charName) {
  const safe = String(charName || '').trim().replace(/[\/\\]/g, '-');
  if (!safe) return null;
  const paths = ensureSessionDataFolders(session);
  return path.join(paths.input, `${safe} - personality.md`);
}
function readCharacterPersonality(session, charName) {
  const dest = characterPersonalityPath(session, charName);
  if (dest && fs.existsSync(dest)) return fs.readFileSync(dest, 'utf8');
  const existing = findSessionPersonaByName(session, charName);
  return existing ? existing.body : '';
}
function writeCharacterPersonality(session, charName, content) {
  const dest = characterPersonalityPath(session, charName);
  if (!dest) { const e = new Error('Character has no name.'); e.statusCode = 400; throw e; }
  ensureParentDir(dest);
  fs.writeFileSync(dest, String(content == null ? '' : content), 'utf8');
  return repoRelative(dest);
}

// Terms from the case's glossary.md (the player-facing quick reference) for STT
// biasing. globaldata/glossary.md is copied per case and may diverge, so prefer
// the case copy; fall back to globaldata. Extracts the bolded table terms plus
// single-word spell/forma names enumerated parenthetically in definitions
// (e.g. "Basic spells (Aqua, Impello, etc.)").
function readCaseGlossaryTerms(session) {
  let text = '';
  try {
    const caseFile = path.join(ensureSessionDataFolders(session).root, 'glossary.md');
    const globalFile = path.join(GLOBAL_ROOT, 'glossary.md');
    const file = fs.existsSync(caseFile) ? caseFile : globalFile;
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  } catch { return []; }
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const cleaned = String(raw || '').replace(/\([^)]*\)/g, '').trim(); // drop "(of a spell)" etc.
    for (const part of cleaned.split('/')) {
      const w = part.trim();
      const k = w.toLowerCase();
      if (w && !seen.has(k)) { seen.add(k); out.push(w); }
    }
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/); // bolded term in first table column
    if (m) add(m[1]);
    for (const grp of (line.match(/\(([^)]*)\)/g) || [])) {
      for (const tok of grp.slice(1, -1).split(/[,;]/)) {
        const t = tok.trim();
        if (/^[A-Z][A-Za-z'’-]{2,}$/.test(t)) add(t); // single Capitalized word ⇒ spell/forma name
      }
    }
  }
  return out;
}

// Key NPC names from the case's key-npcs.md (each NPC is a "## <Name>" heading).
// Same case-copy-then-globaldata fallback as the glossary.
function readCaseKeyNpcs(session) {
  let text = '';
  try {
    const caseFile = path.join(ensureSessionDataFolders(session).root, 'key-npcs.md');
    const globalFile = path.join(GLOBAL_ROOT, 'key-npcs.md');
    const file = fs.existsSync(caseFile) ? caseFile : globalFile;
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/); // level-2 heading = an NPC name
    if (m) out.push(m[1].trim());
  }
  return out;
}

// Revert a globaldata-seeded case file to the globaldata version (overwrite).
// Only files that exist in globaldata at the same relative path may be reverted.
// Returns the repo-relative path written.
function revertSeededFile(session, relativePath) {
  const rel = normaliseSlash(String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!rel || rel.split('/').includes('..')) { const e = new Error('Bad path.'); e.statusCode = 400; throw e; }
  const paths = ensureSessionDataFolders(session);
  const manifest = readSeedManifest(paths);
  const m = manifest[rel];
  // Revert to wherever the file was seeded from (globaldata or the case's
  // canonical original), per the manifest; fall back to globaldata for any
  // legacy entry that predates provenance tracking.
  const seedRepoRel = (m && m.source) ? m.source : normaliseSlash(path.join('Rivers_of_London', 'globaldata', rel));
  const seedPath = path.join(REPO_ROOT, seedRepoRel);
  if (!fs.existsSync(seedPath) || !fs.statSync(seedPath).isFile()) {
    const e = new Error('That file has no seed source to revert to.'); e.statusCode = 404; throw e;
  }
  const dest = path.join(paths.root, rel);
  ensureParentDir(dest);
  fs.copyFileSync(seedPath, dest);
  recordSeedBaseline(manifest, rel, seedRepoRel, dest);
  writeSeedManifest(paths, manifest);
  return repoRelative(dest);
}

// ── Per-session voiceprint registry (Part B: session-audio diarization) ───────
// Canonical "voices" tracked across diarization chunks (and future sessions).
// Each speaker voiceprint from a chunk is matched to an existing canonical voice
// by cosine similarity or seeds a new one; the GM maps a voice → character once
// and it persists, so returning speakers auto-name. Voiceprints are biometric
// (GDPR Art.9) — kept only in the git-ignored case data folder, never surfaced
// or copied into handouts.
function voiceRegistryPath(session) {
  return path.join(ensureSessionDataFolders(session).root, 'voiceprints.json');
}
function loadVoiceRegistry(session) {
  try {
    const p = voiceRegistryPath(session);
    if (fs.existsSync(p)) {
      const r = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (r && Array.isArray(r.voices)) return r;
    }
  } catch { /* fall through to fresh */ }
  return { voices: [] };
}
function saveVoiceRegistry(session, reg) {
  const p = voiceRegistryPath(session);
  ensureParentDir(p);
  fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
}
function _cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
// Match an embedding to the registry, mutating it (updates the matched voice's
// running-mean centroid, or appends a new voice). Returns { voice, sim, isNew }.
function matchVoice(reg, embedding, threshold = 0.5) {
  const emb = Array.from(embedding, Number);
  let best = null, bestSim = -1;
  for (const v of reg.voices) {
    const s = _cosine(emb, v.centroid);
    if (s > bestSim) { bestSim = s; best = v; }
  }
  if (best && bestSim >= threshold) {
    for (let i = 0; i < emb.length; i++) {
      best.centroid[i] = (best.centroid[i] * best.count + emb[i]) / (best.count + 1);
    }
    best.count += 1;
    return { voice: best, sim: bestSim, isNew: false };
  }
  // Next id = max existing + 1 (not length+1, which would collide after pruning).
  const used = reg.voices.map((x) => parseInt(String(x.id).slice(1), 10) || 0);
  const nextId = (used.length ? Math.max(...used) : 0) + 1;
  const v = { id: 'v' + nextId, centroid: emb.slice(), count: 1, character: null, sample: '' };
  reg.voices.push(v);
  return { voice: v, sim: bestSim, isNew: true };
}
function setVoiceCharacter(session, voiceId, character) {
  const reg = loadVoiceRegistry(session);
  const v = reg.voices.find((x) => x.id === voiceId);
  if (!v) { const e = new Error('No such voice.'); e.statusCode = 404; throw e; }
  v.character = character ? String(character).trim() : null;
  saveVoiceRegistry(session, reg);
  return v;
}
// Merge a falsely-split voice into another: fold `fromId`'s voiceprint into `toId`
// (count-weighted so the centroid stays representative), inherit name/sample if the
// target lacks them, and drop `fromId`. Future audio for that speaker then matches
// the combined voice. Returns the updated voice list.
function mergeVoice(session, fromId, toId) {
  if (fromId === toId) { const e = new Error('Cannot merge a voice into itself.'); e.statusCode = 400; throw e; }
  const reg = loadVoiceRegistry(session);
  const from = reg.voices.find((x) => x.id === fromId);
  const to = reg.voices.find((x) => x.id === toId);
  if (!from || !to) { const e = new Error('No such voice.'); e.statusCode = 404; throw e; }
  const tc = to.count || 1, fc = from.count || 1;
  if (Array.isArray(to.centroid) && Array.isArray(from.centroid)) {
    for (let i = 0; i < to.centroid.length; i++) {
      to.centroid[i] = (to.centroid[i] * tc + (from.centroid[i] || 0) * fc) / (tc + fc);
    }
  }
  to.count = tc + fc;
  if (!to.character && from.character) to.character = from.character;
  if (!to.sample && from.sample) to.sample = from.sample;
  reg.voices = reg.voices.filter((x) => x.id !== fromId);
  saveVoiceRegistry(session, reg);
  return listVoices(session);
}
// Remove a voice outright (a genuinely spurious/noise cluster). Prefer mergeVoice
// when it's really the same person split in two — delete fragments identity.
function deleteVoice(session, voiceId) {
  const reg = loadVoiceRegistry(session);
  const before = reg.voices.length;
  reg.voices = reg.voices.filter((x) => x.id !== voiceId);
  if (reg.voices.length === before) { const e = new Error('No such voice.'); e.statusCode = 404; throw e; }
  saveVoiceRegistry(session, reg);
  return listVoices(session);
}
// Registry summary for the GM mapping UI (no raw centroids).
function listVoices(session) {
  return loadVoiceRegistry(session).voices
    .filter((v) => (v.sample && v.sample.trim()) || v.character)  // no words, no voice
    .map((v) => ({
      id: v.id, character: v.character || null, count: v.count, sample: v.sample || ''
    }));
}

// ── Live session-audio buffer (Part B: streaming capture) ─────────────────────
// The browser streams audio slice-by-slice as it is captured (rather than
// buffering big lumps before sending). Slices are appended here as raw 16-bit
// mono PCM and diarized in a sliding window. Same git-ignored case data folder
// as the voiceprints (biometric-adjacent; never surfaced or copied).
function liveBufferPaths(session) {
  const root = ensureSessionDataFolders(session).root;
  return { pcm: path.join(root, 'live-audio.pcm'), state: path.join(root, 'live-state.json') };
}
function liveBufferState(session) {
  try {
    const { state } = liveBufferPaths(session);
    if (fs.existsSync(state)) {
      const s = JSON.parse(fs.readFileSync(state, 'utf8'));
      if (s && typeof s.rate === 'number') return { rate: s.rate, total: s.total || 0, cursor: s.cursor || 0 };
    }
  } catch { /* fresh */ }
  return { rate: 16000, total: 0, cursor: 0 };
}
function _saveLiveState(session, s) {
  const { state } = liveBufferPaths(session);
  ensureParentDir(state);
  fs.writeFileSync(state, JSON.stringify(s), 'utf8');
}
function liveBufferReset(session, rate) {
  const { pcm } = liveBufferPaths(session);
  ensureParentDir(pcm);
  try { fs.writeFileSync(pcm, Buffer.alloc(0)); } catch { /* ignore */ }
  const s = { rate: Number(rate) || 16000, total: 0, cursor: 0 };
  _saveLiveState(session, s);
  return s;
}
function liveBufferAppend(session, int16Buffer) {
  const { pcm } = liveBufferPaths(session);
  ensureParentDir(pcm);
  fs.appendFileSync(pcm, int16Buffer);                 // synchronous → atomic per request
  const s = liveBufferState(session);
  s.total += Math.floor(int16Buffer.length / 2);       // 2 bytes per mono sample
  _saveLiveState(session, s);
  return s;
}
function liveBufferAdvanceCursor(session, cursor) {
  const s = liveBufferState(session);
  s.cursor = Math.max(s.cursor, Math.min(Math.floor(cursor), s.total));
  _saveLiveState(session, s);
  return s;
}
// Read [startSample, endSample) from the buffer and wrap it in a WAV header at
// the buffer's sample rate (mono, 16-bit) for the speech service.
function liveBufferWindowWav(session, startSample, endSample) {
  const { pcm } = liveBufferPaths(session);
  const s = liveBufferState(session);
  const a = Math.max(0, Math.floor(startSample)), b = Math.min(s.total, Math.floor(endSample));
  const n = Math.max(0, b - a);
  const data = Buffer.alloc(n * 2);
  if (n > 0 && fs.existsSync(pcm)) {
    const fd = fs.openSync(pcm, 'r');
    try { fs.readSync(fd, data, 0, n * 2, a * 2); } finally { fs.closeSync(fd); }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(s.rate, 24); h.writeUInt32LE(s.rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, data]);
}

// The NPCs offered in this session: every canonical persona, plus any custom
// "<Name> - personality.md" handouts present in the case.
function listNpcPersonas(session) {
  const out = [];
  const seen = new Set();
  for (const p of listCanonicalPersonas()) {
    out.push({ slug: p.slug, name: p.name });
    seen.add(p.name.toLowerCase());
  }
  if (session) {
    try {
      for (const f of listSessionSourceFiles(session, { includePrivate: true })) {
        if (f.kind !== 'markdown') continue;
        const base = path.basename(f.path).replace(/\.md$/i, '');
        if (!/personality/i.test(base)) continue;
        const name = base.replace(/\s*[-–—]\s*personality\s*$/i, '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          out.push({ slug: nameToSlug(name), name });
          seen.add(name.toLowerCase());
        }
      }
    } catch { /* canonical only */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// What this NPC knows about the current case, from the generated GM artifact
// (gm.npc_knowledge). Empty until that section has been generated for the case.
function getNpcCaseKnowledge(session, npcName) {
  if (!session || !npcName) return '';
  try {
    const paths = ensureSessionDataFolders(session);
    const gm = readExistingJsonForPrompt(paths.gmAnalysis) || {};
    const list = Array.isArray(gm.npc_knowledge) ? gm.npc_knowledge : [];
    const want = String(npcName).toLowerCase();
    const wantId = `npc-${scenarioSlug(npcName)}`;
    const entry = list.find((e) => e && String(e.name || '').toLowerCase() === want)
      || list.find((e) => e && String(e.id || '') === wantId);
    return entry && entry.content ? String(entry.content).trim() : '';
  } catch {
    return '';
  }
}

// Resolve a persona for chat: a case handout overrides the canonical seed. The
// NPC's generated case knowledge (if any) is attached separately.
function resolveNpcPersona(session, slug) {
  const canonical = listCanonicalPersonas();
  const entry = canonical.find((p) => p.slug === slug)
    || listNpcPersonas(session).find((p) => p.slug === slug);
  if (!entry) return null;
  const override = findSessionPersonaByName(session, entry.name);
  const body = override ? override.body : (entry.body || '');
  if (!body) return null;
  // Lore tags come from whichever persona file is in effect (case override wins,
  // else canonical); a session-only persona with no canonical entry has none.
  const loreList = (override && override.lore && override.lore.length) ? override.lore : (entry.lore || []);
  return {
    slug,
    name: entry.name,
    body,
    world: loadLoreFiles(loreList),
    setting: loadSettingGrounding(),
    knowledge: getNpcCaseKnowledge(session, entry.name),
    source: override ? 'case' : 'canonical'
  };
}

// Like sanitiseChatMessages, but preserves a per-turn `speaker` (the NPC name
// that produced an assistant turn) so a multi-NPC carry-over conversation can be
// re-attributed from the active NPC's point of view.
function sanitiseNpcChatMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : null);
    const content = String(m.content == null ? '' : m.content).trim();
    if (!role || !content) continue;
    const speaker = role === 'assistant' && m.speaker ? String(m.speaker).trim().slice(0, 120) : null;
    cleaned.push({ role, speaker, content: content.slice(0, 8000) });
  }
  return cleaned.slice(-24);
}

// Fold an attributed, multi-speaker history into clean alternating turns from the
// active NPC's point of view. The active NPC's own past turns (speaker === its
// name, or unattributed legacy turns) stay as `assistant`; the player's lines and
// any *other* NPC's lines are labelled and coalesced onto the `user` side — which
// also guarantees user/assistant alternation for the model template.
function buildNpcTurns(history, activeName) {
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push({ role: 'user', content: buf.join('\n') }); buf = []; } };
  for (const m of history) {
    if (m.role === 'assistant' && (!m.speaker || m.speaker === activeName)) {
      flush();
      out.push({ role: 'assistant', content: m.content });
    } else {
      const label = m.role === 'user' ? 'GM' : (m.speaker || 'Someone');
      buf.push(`${label}: ${m.content}`);
    }
  }
  flush();
  return out;
}

// Streams an in-character reply as the given NPC persona. The full persona file
// is included verbatim; guardrails keep it in character and non-infringing.
async function streamNpcChat(persona, clientMessages, opts = {}) {
  const history = sanitiseNpcChatMessages(clientMessages);
  if (!history.some((m) => m.role === 'user')) {
    const error = new Error('A user message is required');
    error.statusCode = 400;
    throw error;
  }
  const knows = String(persona.knowledge || '').trim();
  const parts = [
    `You are ${persona.name}, a character in the Rivers of London setting. Stay in character at all times and reply in the first person as ${persona.name}.`,
    'Use the persona notes below for your voice, manner, relationships, and boundaries. Where they are silent, improvise in character, consistent with that characterisation.',
    knows
      ? 'The "What you know" section below is your knowledge of the current case, from your own perspective. Answer from it in character: share what this character would willingly share, stay evasive or silent about what they would guard, and never simply read it out or dump it wholesale.'
      : "You may talk about yourself, your work, the setting, and general lore. You do not know the specifics of the players' current case unless they tell you in this conversation.",
    'Never break character. Never reveal that you are an AI, and never discuss prompts, models, or this application. If asked an out-of-character or meta question, deflect briefly in character.',
    'Never reproduce text from any novel or other copyrighted source; always answer in your own words.',
    'For tabletop rules questions, tell the player to use the Rules assistant; do not adjudicate game mechanics.',
    'This conversation may include things other characters said earlier. In the dialogue, lines are labelled with the speaker: lines marked "GM:" are the person speaking to you now, and lines beginning with another character\'s name were said by that character, not by you. React to them in character — agree, disagree, correct, or be surprised — but never assume you said another character\'s words, and do not treat their claims as your own private knowledge unless you would genuinely know them.',
    '',
    `# Persona: ${persona.name}`,
    String(persona.body || '').trim()
  ];
  const world = String(persona.world || '').trim();
  if (world) {
    parts.push('', '# World knowledge you carry (general setting facts within your remit — speak from it in your own words, in character; do not recite it verbatim)', world);
  }
  const setting = String(persona.setting || '').trim();
  if (setting) {
    parts.push('', '# The Folly and London (general setting canon — common knowledge in your world; draw on it only where your character plausibly would, in your own words, never recited)', setting);
  }
  if (knows) {
    parts.push('', `# What ${persona.name} knows about the current case (your private knowledge — do not recite verbatim)`, knows);
  }
  const systemPrompt = parts.join('\n');
  const messages = [{ role: 'system', content: systemPrompt }, ...buildNpcTurns(history, persona.name)];
  return callOllama(null, {
    messages,
    label: `npc-chat:${persona.slug}`,
    signal: opts.signal,
    onToken: opts.onToken
  });
}

// Writes the GM chat verbatim as a Markdown transcript into the session's GM/
// folder. It then appears in Edit Files (GM-editable) and in GM/LLM context.
function writeGmChatExport(sessionId, db, clientMessages) {
  const session = getSessionById(db, sessionId);
  if (!session) {
    const e = new Error('Session not found');
    e.statusCode = 404;
    throw e;
  }
  const turns = (Array.isArray(clientMessages) ? clientMessages : [])
    .map((m) => ({
      role: m && m.role === 'assistant' ? 'assistant' : (m && m.role === 'user' ? 'user' : null),
      content: String(m && m.content == null ? '' : m.content).trim()
    }))
    .filter((m) => m.role && m.content);
  if (!turns.length) {
    const e = new Error('Nothing to export — the chat is empty');
    e.statusCode = 400;
    throw e;
  }
  const paths = ensureSessionDataFolders(session);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const lines = [
    `# GM Chat — ${session.name}`,
    '',
    `_Exported ${now.toISOString()} from the GM brainstorming chat. GM-only; editable here in Edit Files._`,
    ''
  ];
  for (const t of turns) {
    lines.push(t.role === 'user' ? '## GM' : '## Assistant', '', t.content, '');
  }
  const file = `gm-chat-${stamp}.md`;
  const fullPath = path.join(paths.gmInput, file);
  fs.writeFileSync(fullPath, `${lines.join('\n').trim()}\n`, 'utf8');
  return { path: repoRelative(fullPath), file };
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

// Persist a GM-generated handout image into the session's GM-only gallery
// (GM/Gallery). Never visible to players until the GM moves it to the
// player gallery from Edit Files.
function saveSessionHandout(sessionId, db, { bytes, name, ext, prompt, replacePath, scene } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  if (!bytes || !bytes.length) { const e = new Error('No image data to save'); e.statusCode = 400; throw e; }
  const paths = ensureSessionDataFolders(session);
  // An editor-made diagram round-trips through a "<file>.excalidraw.json" scene
  // sidecar so it can be reopened and re-edited; null/empty means a flat image.
  const sceneJson = scene == null ? '' : String(scene).trim();
  const writeScene = (target) => {
    if (sceneJson) fs.writeFileSync(`${target}.excalidraw.json`, sceneJson, 'utf8');
    else if (fs.existsSync(`${target}.excalidraw.json`)) { try { fs.unlinkSync(`${target}.excalidraw.json`); } catch { /* non-fatal */ } }
  };
  // Regenerate-in-place: overwrite an existing in-scope graphic's bytes,
  // keeping its filename (so the index injector keeps matching it) and
  // visibility; refresh its prompt sidecar too.
  if (replacePath) {
    const cleaned = String(replacePath).replace(/^\/+/, '');
    const target = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
    if (!isInside(paths.root, target)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { const e = new Error('File to replace not found'); e.statusCode = 404; throw e; }
    if (!GRAPHIC_EXTENSIONS.has(path.extname(target).toLowerCase())) { const e = new Error('Target is not a graphic'); e.statusCode = 400; throw e; }
    fs.writeFileSync(target, bytes);
    const pTxt = String(prompt == null ? '' : prompt).trim();
    if (pTxt) fs.writeFileSync(`${target}.prompt.txt`, pTxt + '\n', 'utf8');
    writeScene(target);
    return { path: repoRelative(target), file: path.basename(target), replaced: true };
  }
  const dir = paths.gmGallery;
  fs.mkdirSync(dir, { recursive: true });
  const safeExt = GRAPHIC_EXTENSIONS.has(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : '.png';
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const file = `${slug ? slug + '-' : 'handout-'}${stamp}${safeExt}`;
  const fullPath = path.join(dir, file);
  fs.writeFileSync(fullPath, bytes);
  // Record the generating prompt next to the image so it can be tweaked and
  // re-used later. Sidecar keeps it out of the asset/source listings.
  const promptText = String(prompt == null ? '' : prompt).trim();
  if (promptText) {
    fs.writeFileSync(`${fullPath}.prompt.txt`, promptText + '\n', 'utf8');
  }
  writeScene(fullPath);
  return { path: repoRelative(fullPath), file };
}

// Read back the editable Excalidraw scene for a diagram graphic, resolving the
// path inside the case folder (GM-only — the editor is a GM tool). Returns the
// scene JSON string, or null if the graphic has no scene sidecar.
function readSessionDiagramScene(sessionId, db, requestPath) {
  const abs = resolveSessionAssetPath(sessionId, requestPath, db, true);
  if (!abs) return null;
  const sidecar = `${abs}.excalidraw.json`;
  if (!fs.existsSync(sidecar)) return null;
  try { return fs.readFileSync(sidecar, 'utf8'); } catch { return null; }
}

// Toggle a session asset between GM-only and player-visible by moving it
// Suffixes of the per-graphic sidecars kept alongside an image but out of the
// asset listings: the generating prompt and (for editor-made diagrams) the
// editable Excalidraw scene. They must travel with the image on every move.
const GRAPHIC_SIDECAR_SUFFIXES = ['.prompt.txt', '.excalidraw.json'];

// Carry a graphic's sidecars with the image whenever it moves (visibility
// toggle, rename). Without this the prompt/scene is stranded in the old folder
// and the editor shows a blank box. Best-effort.
function carryPromptSidecar(src, dest) {
  for (const suffix of GRAPHIC_SIDECAR_SUFFIXES) {
    try {
      const from = `${src}${suffix}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${dest}${suffix}`);
    } catch { /* non-fatal */ }
  }
}

// between the GM and player areas, which is what classifySessionFileVisibility
// keys off. Mapping (round-trips): GM/Gallery ⇄ Gallery (artifacts) and
// GM/<x> ⇄ input/<x> (markdown sources etc.). Returns new path + visibility.
function setSessionAssetVisibility(sessionId, db, requestPath, visibility) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const want = visibility === 'player' ? 'player' : 'gm';
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const src = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, src)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { const e = new Error('File not found'); e.statusCode = 404; throw e; }
  const ext = path.extname(src).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) { const e = new Error('Not a toggleable asset'); e.statusCode = 400; throw e; }
  const base = path.basename(src);
  if (isVisibilityFixed(src, paths)) {
    const e = new Error('This file’s visibility is fixed'); e.statusCode = 400; throw e;
  }
  const current = classifySessionFileVisibility(src, paths);
  if (current === want) return { path: repoRelative(src), visibility: current };

  const rootRel = normaliseSlash(path.relative(paths.root, src));
  let destRel;
  if (want === 'player') {
    if (rootRel.startsWith('GM/Gallery/')) destRel = 'Gallery/' + rootRel.slice('GM/Gallery/'.length);
    else if (rootRel.startsWith('GM/')) destRel = 'input/' + rootRel.slice(3);
    else destRel = base;
  } else {
    if (rootRel.startsWith('Gallery/')) destRel = 'GM/Gallery/' + rootRel.slice('Gallery/'.length);
    else if (rootRel.startsWith('input/')) destRel = 'GM/' + rootRel.slice(6);
    else destRel = 'GM/' + base;
  }
  const dest = path.join(paths.root, destRel);
  if (!isInside(paths.root, dest)) { const e = new Error('Resolved destination is invalid'); e.statusCode = 400; throw e; }
  if (fs.existsSync(dest)) { const e = new Error('A file with that name already exists in the target area'); e.statusCode = 409; throw e; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  carryPromptSidecar(src, dest);
  // Move the seed-manifest entry with the file so Revert still works at the new
  // location and the seeder won't see the old path as "missing". rename keeps the
  // mtime, so a pristine file stays pristine.
  try {
    const manifest = readSeedManifest(paths);
    if (manifest[rootRel]) {
      const old = manifest[rootRel];
      manifest[normaliseSlash(destRel)] = old.diverged
        ? { source: old.source, diverged: true }
        : { source: old.source, ...fileBaseline(dest) };
      delete manifest[rootRel];
      writeSeedManifest(paths, manifest);
    }
  } catch { /* non-fatal: visibility still toggled */ }
  return { path: repoRelative(dest), visibility: want };
}

function safeAssetName(name) {
  const base = path.basename(String(name || '').trim()).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '');
  if (!base) { const e = new Error('A file name is required'); e.statusCode = 400; throw e; }
  const ext = path.extname(base).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) {
    const e = new Error(`Unsupported file type "${ext || base}". Allowed: ${[...ASSET_EXTENSIONS].join(', ')}`);
    e.statusCode = 400; throw e;
  }
  return { base, ext };
}

// Create a brand-new file (Create / Upload). `area` 'player' lands it
// player-visible, 'gm' (default) GM-only. Images go to the Gallery folders,
// other assets to input/ or GM/. Refuses to clobber an existing file.
function createSessionFile(sessionId, db, { name, bytes, area } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  if (!bytes) { const e = new Error('No file content'); e.statusCode = 400; throw e; }
  const { base, ext } = safeAssetName(name);
  const paths = ensureSessionDataFolders(session);
  const player = area === 'player';
  const isImg = GRAPHIC_EXTENSIONS.has(ext);
  const dir = isImg
    ? (player ? paths.gallery : paths.gmGallery)
    : (player ? paths.input : paths.gmInput);
  const dest = path.join(dir, base);
  if (!isInside(paths.root, dest)) { const e = new Error('Resolved path is invalid'); e.statusCode = 400; throw e; }
  if (fs.existsSync(dest)) { const e = new Error(`"${base}" already exists — use Replace to overwrite it`); e.statusCode = 409; throw e; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, bytes);
  return { path: repoRelative(dest), file: base, visibility: classifySessionFileVisibility(dest, paths) };
}

// Overwrite an existing in-scope file's bytes, keeping its path/visibility
// (Replace — round-trip a file edited in a better external tool).
function replaceSessionFile(sessionId, db, { path: requestPath, bytes } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  if (!bytes) { const e = new Error('No file content'); e.statusCode = 400; throw e; }
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const dest = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, dest)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
  if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) { const e = new Error('File not found'); e.statusCode = 404; throw e; }
  const ext = path.extname(dest).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) { const e = new Error('Not a replaceable asset'); e.statusCode = 400; throw e; }
  const rootRel = normaliseSlash(path.relative(paths.root, dest));
  if (rootRel.startsWith('output_player/') || rootRel.startsWith('output_gm/') || GENERATED_FILENAMES.has(path.basename(dest))) {
    const e = new Error('This file is generated and cannot be replaced'); e.statusCode = 400; throw e;
  }
  fs.writeFileSync(dest, bytes);
  return { path: repoRelative(dest), visibility: classifySessionFileVisibility(dest, paths) };
}

// Rename an in-scope file in place (same folder → visibility unchanged). The
// new name keeps the original extension so a file can't change type.
function renameSessionFile(sessionId, db, { path: requestPath, name } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const src = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, src)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { const e = new Error('File not found'); e.statusCode = 404; throw e; }
  const srcExt = path.extname(src).toLowerCase();
  if (!ASSET_EXTENSIONS.has(srcExt)) { const e = new Error('Not a renameable asset'); e.statusCode = 400; throw e; }
  const base = path.basename(src);
  const rootRel = normaliseSlash(path.relative(paths.root, src));
  if (rootRel.startsWith('output_player/') || rootRel.startsWith('output_gm/')
      || GENERATED_FILENAMES.has(base) || base === 'player.md' || base === 'gm.md') {
    const e = new Error('This file is structural and cannot be renamed'); e.statusCode = 400; throw e;
  }
  // Take the requested name, drop any path and any extension the user typed,
  // then force the original extension so a file can't change type.
  let stem = path.basename(String(name || '').trim());
  stem = stem.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  stem = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80);
  if (!stem) { const e = new Error('A new name is required'); e.statusCode = 400; throw e; }
  const newBase = stem + srcExt;
  if (newBase === base) return { path: repoRelative(src), visibility: classifySessionFileVisibility(src, paths) };
  const dest = path.join(path.dirname(src), newBase);
  if (!isInside(paths.root, dest)) { const e = new Error('Resolved name is invalid'); e.statusCode = 400; throw e; }
  if (fs.existsSync(dest)) { const e = new Error(`"${newBase}" already exists in that folder`); e.statusCode = 409; throw e; }
  fs.renameSync(src, dest);
  carryPromptSidecar(src, dest);
  return { path: repoRelative(dest), file: newBase, visibility: classifySessionFileVisibility(dest, paths) };
}

// Delete an in-scope file (Edit Files). Same structural guards as Rename, so
// the canonical sources / generated artifacts can't be removed. A graphic's
// "<file>.prompt.txt" sidecar (kept out of the asset listings) is removed too.
function deleteSessionFile(sessionId, db, { path: requestPath } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const src = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, src)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { const e = new Error('File not found'); e.statusCode = 404; throw e; }
  const ext = path.extname(src).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) { const e = new Error('Not a deletable asset'); e.statusCode = 400; throw e; }
  const base = path.basename(src);
  const rootRel = normaliseSlash(path.relative(paths.root, src));
  if (rootRel.startsWith('output_player/') || rootRel.startsWith('output_gm/')
      || GENERATED_FILENAMES.has(base) || base === 'player.md' || base === 'gm.md') {
    const e = new Error('This file is structural and cannot be deleted'); e.statusCode = 400; throw e;
  }
  fs.unlinkSync(src);
  for (const suffix of GRAPHIC_SIDECAR_SUFFIXES) {
    const sidecar = `${src}${suffix}`;
    if (fs.existsSync(sidecar)) { try { fs.unlinkSync(sidecar); } catch { /* non-fatal */ } }
  }
  return { path: repoRelative(src), deleted: true };
}

// Write/replace the "<file>.prompt.txt" sidecar for an in-scope graphic so an
// edited prompt can be saved without regenerating the image.
function saveSessionFilePrompt(sessionId, db, { path: requestPath, text } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const paths = ensureSessionDataFolders(session);
  const cleaned = String(requestPath || '').replace(/^\/+/, '');
  const src = path.resolve(REPO_ROOT, cleaned.startsWith('data/') ? cleaned : path.join(repoRelative(paths.root), cleaned));
  if (!isInside(paths.root, src)) { const e = new Error('Path is outside the case folder'); e.statusCode = 400; throw e; }
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { const e = new Error('File not found'); e.statusCode = 404; throw e; }
  if (!GRAPHIC_EXTENSIONS.has(path.extname(src).toLowerCase())) { const e = new Error('Prompts attach to graphics only'); e.statusCode = 400; throw e; }
  const sidecar = `${src}.prompt.txt`;
  const body = String(text == null ? '' : text).trim();
  if (body) fs.writeFileSync(sidecar, body + '\n', 'utf8');
  else if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  return { path: repoRelative(src), prompt: body };
}

// One-shot LLM call: turn an index entity (event/place/NPC/thing) into a single
// text-to-image prompt. `style` is the resolved per-case art style (caller
// supplies it). Returns the cleaned prompt string.
async function generateEntityImagePrompt(sessionId, db, { name, kind, description, style } = {}, opts = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const subject = String(name || '').trim();
  if (!subject) { const e = new Error('An entity name is required'); e.statusCode = 400; throw e; }
  const styleText = String(style || '').trim();
  const ctx = String(description || '').trim().slice(0, 4000);
  const kindWord = ({ npc: 'character', npcs: 'character', location: 'place', locations: 'place',
    place: 'place', places: 'place', item: 'object', items: 'object', thing: 'object',
    event: 'scene', events: 'scene' }[String(kind || '').toLowerCase()]) || 'subject';
  const user = [
    `Write a single vivid text-to-image generation prompt for this ${kindWord} from a Rivers of London tabletop case.`,
    `Subject: ${subject}`,
    ctx ? `Reference notes (do not contradict these):\n${ctx}` : '',
    styleText ? `Render it in this art style: ${styleText}` : '',
    'Describe concrete visual detail (composition, setting, lighting, mood). One paragraph, no preamble, no markdown, no quotes, no headings — output ONLY the prompt text.'
  ].filter(Boolean).join('\n\n');
  const raw = await callOllama(user, {
    label: `image-prompt: ${subject}`,
    signal: opts.signal,
    messages: [
      { role: 'system', content: 'You are an art director writing concise, concrete prompts for an image generation model. You reply with prompt text only — no commentary, no markdown.' },
      { role: 'user', content: user }
    ]
  });
  const cleaned = String(raw || '')
    .replace(/^```[a-z]*\n?|\n?```$/gi, '')
    .replace(/^\s*(prompt|image prompt)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (!cleaned) { const e = new Error('The model returned an empty prompt'); e.statusCode = 502; throw e; }
  return { prompt: cleaned };
}

// One-shot LLM call: draft the BODY of an in-game letter from the GM's brief.
// This is a GM authoring aid (the letter is fiction the GM is writing), so it
// drafts freely from the intent rather than grounding to case canon. Returns
// just the body prose — the helper adds letterhead, sign-off and signature.
async function draftLetterBody(sessionId, db, { intent, sender, recipient, tone } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const brief = String(intent || '').trim();
  if (!brief) { const e = new Error('Describe what the letter should say'); e.statusCode = 400; throw e; }
  const lines = [
    'Write the BODY of a letter for a Rivers of London tabletop game handout.',
    sender ? `It is sent by: ${String(sender).trim()}` : '',
    recipient ? `It is addressed to: ${String(recipient).trim()}` : '',
    tone ? `Tone: ${String(tone).trim()}` : '',
    `What it needs to say: ${brief}`,
    'Write only the body paragraphs — no letterhead, no date, no "Dear ...", no "Yours sincerely", no signature, no markdown. Plain prose, a few short paragraphs at most.'
  ].filter(Boolean).join('\n\n');
  const raw = await callOllama(lines, {
    label: 'letter body draft',
    messages: [
      { role: 'system', content: 'You draft concise, period-plausible letter prose for a tabletop RPG. You reply with body text only — no letterhead, salutation, sign-off or commentary.' },
      { role: 'user', content: lines }
    ]
  });
  const body = String(raw || '')
    .replace(/^```[a-z]*\n?|\n?```$/gi, '')
    .replace(/^\s*(dear\b.*|to whom it may concern.*)$/gim, '')
    .replace(/^\s*(yours (sincerely|faithfully|truly)|kind regards|regards|sincerely)\b.*$/gim, '')
    .trim();
  if (!body) { const e = new Error('The model returned an empty draft'); e.statusCode = 502; throw e; }
  return { body };
}

// Invent a plausible in-world sender for the letter composer: an organisation
// name, a multi-line UK postal address, and a brief for an OLD-FASHIONED printed
// letterhead device (engraved crest / monogram, NOT a flat website logo).
// Grounded in this case's scenario info so it fits the game. Behind the AI gate.
async function draftCompanyDetails(sessionId, db, { hint } = {}) {
  const session = getSessionById(db, sessionId);
  if (!session) { const e = new Error('Session not found'); e.statusCode = 404; throw e; }
  const paths = ensureSessionDataFolders(session);
  const scenarioInfo = readExistingJsonForPrompt(paths.scenarioInfo) || {};
  const steer = String(hint || '').trim();

  const system = [
    'You invent letterhead details for the sender of a letter in a Rivers of London (present-day London, urban-fantasy police procedural) tabletop game.',
    'From the case context, make up ONE plausible organisation that could send a letter as a player handout.',
    'Return ONLY a JSON object — no prose, no commentary, no code fence — with exactly these keys:',
    '  "name": the organisation\'s name.',
    '  "address": its postal address as 2 to 4 lines separated by \\n (building/street, area, "London", postcode). Use real-sounding London geography.',
    '  "logo_prompt": a brief for an image generator to render this organisation\'s LETTERHEAD device. Describe an old-fashioned PRINTED emblem — an engraved or letterpress crest, monogram or wax-seal-style mark in a single ink colour on cream paper, the kind embossed at the head of formal headed notepaper. Explicitly NOT a modern flat vector website logo: no gradients, no app icon, no rounded-rectangle badge, no photography. Include the organisation name or its initials as engraved lettering. One or two sentences.',
    'Keep everything grounded in the case context and do not contradict it.'
  ].join('\n');

  const user = [
    steer
      ? `The GM wants the sender to be: ${steer}`
      : 'No specific steer — pick an organisation, agency, firm, estate or institution that already fits the case.',
    '',
    '## Case context',
    renderJsonBlock(scenarioInfo)
  ].join('\n');

  const raw = await callOllama(null, {
    label: 'company details draft',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  let parsed;
  try { parsed = JSON.parse(extractJsonCandidate(raw)); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('The model did not return usable company details'); e.statusCode = 502; throw e;
  }
  const name = String(parsed.name || '').trim();
  const address = String(parsed.address || '').replace(/\\n/g, '\n').trim();
  const logo_prompt = String(parsed.logo_prompt || '').trim();
  if (!name) { const e = new Error('The model returned no company name'); e.statusCode = 502; throw e; }
  return { name, address, logo_prompt };
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
  return [pick(sheet.common_skills), pick(sheet.expert_skills), pick(sheet.mandatory_skills), pick(sheet.combat_skills)]
    .filter(Boolean).join('; ');
}

// Writes data/sessions/<slug>/NPC.md summarising the central NPC sheets
// allocated to a case so the scenario LLM can see who is on the team.
// Regenerated whenever a case's NPC allocations change or an NPC sheet is edited.
function writeSessionNpcSummary(sessionId, db) {
  const session = getSessionById(db, sessionId);
  if (!session) return false;
  const paths = ensureSessionDataFolders(session);
  const allNpcs = db.prepare('SELECT id, data FROM character_sheets WHERE user_id IS NULL').all();
  const rows = allNpcs
    .map((r) => ({ id: r.id, sheet: parseSheetData(r.data) }))
    .filter((r) => sheetHasCase(r.sheet, session.name))
    .sort((a, b) => String(a.sheet.name || '').toLowerCase()
      .localeCompare(String(b.sheet.name || '').toLowerCase()));

  const lines = [
    `# NPCs — ${session.name}`,
    '',
    '_Auto-generated from the Admin NPC allocations whenever this case\'s NPCs change. Edits here are overwritten._',
    ''
  ];
  if (!rows.length) {
    lines.push('No NPCs are currently allocated to this case.');
  } else {
    for (const { sheet } of rows) {
      const name = String(sheet.name || '').trim();
      if (!name) continue;
      const occupation = sheet.occupation || sheet.role || '';
      lines.push(`## ${name}${occupation ? ` — ${occupation}` : ''}`, '');
      const blurb = sheet.reputation || sheet.backstory || sheet.summary || '';
      if (blurb) lines.push(blurb, '');
      const stats = npcStatLine(sheet);
      if (stats) lines.push(`**Stats:** ${stats}`, '');
      const traits = [sheet.advantages, sheet.disadvantages].filter(Boolean).join('; ');
      if (traits) lines.push(`**Advantages / Flaws:** ${traits}`, '');
      const skills = npcSkillLine(sheet);
      if (skills) lines.push(`**Skills:** ${skills}`, '');
      const spells = Array.isArray(sheet.magic_spells)
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
  // Diagnostic harness — let scripts render the exact prompt the LLM would
  // see for any section/item, without invoking the model. NOT for general
  // use; signatures may change with the prompt internals.
  SCENARIO_SECTIONS,
  LOOPED_SECTIONS,
  readScenarioSection,
  renderSectionPrompt,
  renderLoopedItemPrompt,
  DATA_ROOT,
  SESSIONS_ROOT,
  GLOBAL_ROOT,
  DOMESTIC_SYSTEM_DESCRIPTION,
  GM_NAME,
  slugifySessionName,
  findSessionCover,
  getSessionById,
  getFirstScenarioSession,
  findSessionByToken,
  ensureSessionDataFolders,
  seedGlobalSessionFiles,
  ensureSessionDataFolderById,
  renameSessionDataFolder,
  listSessionSourceFiles,
  listGlobalFiles,
  listRoster,
  loadSessionScenarioInfoForUser,
  readSessionSources,
  writeSessionSources,
  listScenarioSectionIds,
  refreshScenarioIndexes,
  regenerateScenarioSection,
  regenerateScenarioSections,
  revertScenarioSection,
  resolveSessionAssetPath,
  writeSessionNpcSummary,
  regenerateNpcSummaries,
  ollamaStatus,
  cancelOllama,
  streamGmChat,
  streamRulesChat,
  listNpcPersonas,
  caseNpcNameKeys,
  resolveNpcPersona,
  seedNpcPersonaIntoCase,
  streamNpcChat,
  writeGmChatExport,
  saveSessionHandout,
  readSessionDiagramScene,
  draftLetterBody,
  draftCompanyDetails,
  setSessionAssetVisibility,
  createSessionFile,
  replaceSessionFile,
  renameSessionFile,
  deleteSessionFile,
  saveSessionFilePrompt,
  generateEntityImagePrompt,
  effectiveOllamaModel,
  isCloudLlm,
  setOllamaModel,
  ollamaContextConfig,
  setOllamaNumCtx,
  listOllamaModels,
  listOllamaModelsDetailed,
  ollamaPs,
  freeOllama,
  effectiveOllamaUrl,
  effectiveComfyuiUrl,
  effectiveWhisperxUrl,
  readCharacterPersonality,
  writeCharacterPersonality,
  readCaseGlossaryTerms,
  readCaseKeyNpcs,
  revertSeededFile,
  readSeedManifest,
  writeSeedManifest,
  recordSeedBaseline,
  ensureSeedEntry,
  loadVoiceRegistry,
  saveVoiceRegistry,
  matchVoice,
  setVoiceCharacter,
  mergeVoice,
  deleteVoice,
  listVoices,
  liveBufferState,
  liveBufferReset,
  liveBufferAppend,
  liveBufferAdvanceCursor,
  liveBufferWindowWav,
  setServiceUrl,
  servicesConfig,
  effectiveBoostAlpha,
  setBoostAlpha,
  effectiveComfyuiImageModel,
  effectiveComfyuiEditModel,
  setComfyuiModel,
  comfyModelsConfig
};
