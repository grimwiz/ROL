#!/usr/bin/env node

// Restyle one source image through the same ComfyUI image-edit workflow used
// by the web app and write the result into a character sheet in the database.
// Player characters and allocated NPCs are resolved through one session-scoped
// "character" selector. NPC portraits are written to the central NPC sheet;
// session allocation only controls discoverability.
//
//   npm run portrait:restyle -- --session "The Bookshop" --character "Warwick Anderson" --image path/to/source.png
//   npm run portrait:restyle -- --session 0 --character "Molly" --image path/to/source.png
//   npm run portrait:restyle -- --sessions
//   npm run portrait:restyle -- --characters --session "The Bookshop"

const fs = require('fs');
const path = require('path');

const db = require('../src/db');
const sessionRolls = require('../src/sessionRolls');
const { regenerateNpcSummaries } = require('../src/scenarioInfo');
const {
  dataUrlToBuffer,
  imageFileToDataUrl,
  restylePortraitImage
} = require('../src/portraitPipeline');

function usage(exitCode = 0) {
  const out = exitCode ? process.stderr : process.stdout;
  out.write(`Usage:
  npm run portrait:restyle -- --session <0|Global|id|name|system-key> --character <name|user:id|npc:id> --image <path>
  npm run portrait:restyle -- --session <0|Global|id|name|system-key> --character <name|user:id|npc:id> --from-current
  npm run portrait:restyle -- --sessions
  npm run portrait:restyle -- --characters --session <0|Global|id|name|system-key>

Options:
  --sessions         List available sessions/cases and exit
  --characters      List player characters and allocated NPCs for --session and exit
  --session, -s      Case/session id, name, built-in system key, or 0/Global for central NPCs
  --character, -c    Character name in that case, or user:<id> / npc:<id>
  --image, -i        Source image file to restyle
  --from-current     Restyle the current sheet portrait instead of a file
  --strength <n>     Edit denoise strength, clamped 0.6..1.0 (default 1.0)
  --output <path>    Also write the generated image to a local file for review
  --dry-run          Run the transform and write --output if supplied, but do not update the DB
  --timeout-ms <n>   ComfyUI wait timeout (default 600000)
  --help, -h         Show this help
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--sessions') args.listSessions = true;
    else if (a === '--characters') args.listCharacters = true;
    else if (a === '--session' || a === '-s') args.session = take();
    else if (a === '--character' || a === '-c') args.character = take();
    else if (a === '--image' || a === '-i') args.image = take();
    else if (a === '--from-current') args.fromCurrent = true;
    else if (a === '--strength') args.strength = take();
    else if (a === '--output') args.output = take();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--timeout-ms') args.timeoutMs = parseInt(take(), 10);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (args.listSessions) return args;
  if (args.listCharacters) {
    if (!args.session) throw new Error('Missing --session for --characters');
    return args;
  }
  if (!args.session) throw new Error('Missing --session');
  if (!args.character) throw new Error('Missing --character');
  if (!args.image && !args.fromCurrent) throw new Error('Provide --image or --from-current');
  if (args.image && args.fromCurrent) throw new Error('Use either --image or --from-current, not both');
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 10000)) {
    throw new Error('--timeout-ms must be at least 10000');
  }
  return args;
}

function parseSheet(json, fallbackName) {
  try {
    const parsed = json ? JSON.parse(json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (!String(parsed.name || '').trim() && fallbackName) parsed.name = fallbackName;
      return parsed;
    }
  } catch {}
  return fallbackName ? { name: fallbackName } : {};
}

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveSession(selector) {
  const text = String(selector || '').trim();
  if (text === '0' || /^global$/i.test(text)) {
    return { id: 0, name: 'Global', system_key: 'global', global: true };
  }
  if (/^\d+$/.test(text)) {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(parseInt(text, 10));
    if (row) return row;
  }
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE name = ? COLLATE NOCASE OR system_key = ? COLLATE NOCASE
    ORDER BY id
  `).all(text, text);
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    throw new Error(`Session selector is ambiguous: ${rows.map((r) => `${r.id}:${r.name}`).join(', ')}`);
  }
  throw new Error(`Session not found: ${text}`);
}

function listSessions() {
  const global = db.prepare("SELECT COUNT(*) AS npc_count FROM npcs").get();
  const rows = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.system_key,
      COUNT(DISTINCT sp.user_id) AS player_count,
      COUNT(DISTINCT ns.npc_id) AS npc_count
    FROM sessions s
    LEFT JOIN session_players sp ON sp.session_id = s.id
    LEFT JOIN npc_sessions ns ON ns.session_id = s.id
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE, s.id
  `).all();
  return [
    { id: 0, name: 'Global', system_key: 'global', player_count: 0, npc_count: global ? global.npc_count : 0, global: true },
    ...rows
  ];
}

function characterAliases(entry) {
  const sheetName = String(entry.sheet && entry.sheet.name || '').trim();
  const aliases = [sheetName, entry.displayName, entry.recordName, `${entry.type}:${entry.id}`]
    .filter(Boolean)
    .map(norm);
  return [...new Set(aliases)];
}

function listCharacters(sessionId) {
  if (Number(sessionId) === 0) {
    return db.prepare(`
      SELECT id AS npc_id, name, sheet
      FROM npcs
      ORDER BY name COLLATE NOCASE
    `).all().map((row) => {
      const sheet = parseSheet(row.sheet, row.name);
      return {
        type: 'npc',
        id: row.npc_id,
        displayName: String(sheet.name || '').trim() || row.name,
        recordName: row.name,
        sheet,
        global: true
      };
    });
  }

  const players = db.prepare(`
    SELECT sp.user_id, u.username, cs.data
    FROM session_players sp
    JOIN users u ON u.id = sp.user_id
    LEFT JOIN character_sheets cs ON cs.session_id = sp.session_id AND cs.user_id = sp.user_id
    WHERE sp.session_id = ?
    ORDER BY u.username COLLATE NOCASE
  `).all(sessionId).map((row) => {
    const sheet = parseSheet(row.data, row.username);
    return {
      type: 'user',
      id: row.user_id,
      displayName: String(sheet.name || '').trim() || row.username,
      recordName: row.username,
      sheet
    };
  });

  const npcs = db.prepare(`
    SELECT n.id AS npc_id, n.name, n.sheet
    FROM npc_sessions ns
    JOIN npcs n ON n.id = ns.npc_id
    WHERE ns.session_id = ?
    ORDER BY n.name COLLATE NOCASE
  `).all(sessionId).map((row) => {
    const sheet = parseSheet(row.sheet, row.name);
    return {
      type: 'npc',
      id: row.npc_id,
      displayName: String(sheet.name || '').trim() || row.name,
      recordName: row.name,
      sheet
    };
  });

  return [...players, ...npcs];
}

function resolveCharacter(sessionId, selector) {
  const wanted = norm(selector);
  const matches = listCharacters(sessionId)
    .filter((entry) => characterAliases(entry).includes(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Character selector is ambiguous: ${matches.map((m) => `${m.type}:${m.id} ${m.displayName}`).join(', ')}`);
  }
  const known = listCharacters(sessionId).map((m) => `${m.type}:${m.id} ${m.displayName}`).join('\n  ');
  throw new Error(`Character not found in this session: ${selector}\nKnown characters:\n  ${known || '(none)'}`);
}

function printSessions() {
  const rows = listSessions();
  if (!rows.length) {
    console.log('No sessions found.');
    return;
  }
  for (const row of rows) {
    const tags = [];
    if (row.system_key) tags.push(`system:${row.system_key}`);
    if (row.global) tags.push('global');
    if (row.description === '__SYSTEM_DOMESTIC__') tags.push('domestic');
    console.log(`${row.id}\t${row.name}\tplayers:${row.player_count || 0}\tnpcs:${row.npc_count || 0}${tags.length ? `\t${tags.join(' ')}` : ''}`);
  }
}

function printCharacters(session) {
  const entries = listCharacters(session.id);
  console.log(`Session: ${session.id} ${session.name}`);
  if (!entries.length) {
    console.log('No player characters or allocated NPCs found.');
    return;
  }
  for (const entry of entries) {
    const sheet = entry.sheet || {};
    const aliases = characterAliases(entry)
      .filter((alias) => alias !== `${entry.type}:${entry.id}` && alias !== norm(entry.displayName))
      .join(', ');
    const bits = [
      `${entry.type}:${entry.id}`,
      entry.displayName,
      `portrait:${String(sheet.portrait || '').trim() ? 'yes' : 'no'}`
    ];
    if (entry.type === 'user') bits.push(`account:${entry.recordName}`);
    if (entry.global) bits.push('global');
    if (entry.type === 'npc' && entry.recordName !== entry.displayName) bits.push(`record:${entry.recordName}`);
    if (aliases) bits.push(`aliases:${aliases}`);
    console.log(bits.join('\t'));
  }
}

function saveCharacterSheet(sessionId, target, sheet) {
  const json = JSON.stringify(sheet);
  if (json.length > 200000) {
    console.warn(`warning: sheet JSON is ${(json.length / 1024).toFixed(0)} KB; the browser can view it, but a later web save may need the portrait compressed first.`);
  }
  if (target.type === 'npc') {
    const result = db.prepare("UPDATE npcs SET sheet = ?, updated_at = datetime('now') WHERE id = ?")
      .run(json, target.id);
    if (!result.changes) throw new Error(`NPC not found: ${target.id}`);
    const sessionIds = db.prepare('SELECT session_id FROM npc_sessions WHERE npc_id = ?')
      .all(target.id)
      .map((row) => row.session_id);
    regenerateNpcSummaries(db, sessionIds);
    return;
  }
  if (target.type === 'user') {
    if (Number(sessionId) === 0) throw new Error('Global portraits can only be written to NPC sheets');
    db.prepare(`
      INSERT INTO character_sheets (session_id, user_id, data, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(session_id, user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(sessionId, target.id, json);
    return;
  }
  throw new Error(`Unsupported character type: ${target.type}`);
}

function writeOutputImage(filePath, dataUrl) {
  if (!filePath) return;
  const full = path.resolve(filePath);
  const { buffer } = dataUrlToBuffer(dataUrl);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
}

function logEvent(event, detail) {
  const bits = Object.entries(detail || {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.log(bits ? `${event}: ${bits}` : event);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listSessions) {
    printSessions();
    return;
  }
  const session = resolveSession(args.session);
  if (args.listCharacters) {
    printCharacters(session);
    return;
  }
  const target = resolveCharacter(session.id, args.character);
  const sourceImage = args.fromCurrent
    ? String(target.sheet && target.sheet.portrait || '').trim()
    : imageFileToDataUrl(args.image);
  if (!sourceImage) throw new Error('The selected character has no current portrait to restyle');

  const settings = session.global ? { portrait_style: '' } : sessionRolls.getSettings(db, session.id);
  console.log(`Session: ${session.id} ${session.name}`);
  console.log(`Character: ${target.type}:${target.id} ${target.displayName}`);
  console.log(args.fromCurrent ? 'Source: current sheet portrait' : `Source: ${path.resolve(args.image)}`);
  console.log('Restyling portrait...');

  const result = await restylePortraitImage({
    image: sourceImage,
    style: settings.portrait_style || '',
    strength: args.strength,
    timeoutMs: args.timeoutMs || 600000,
    logger: logEvent
  });

  writeOutputImage(args.output, result.dataUrl);
  const nextSheet = { ...(target.sheet || {}), portrait: result.dataUrl };
  if (!args.dryRun) saveCharacterSheet(session.id, target, nextSheet);

  console.log(args.dryRun ? 'Dry run complete; database was not updated.' : 'Portrait written to the character sheet.');
  if (args.output) console.log(`Generated image also written to ${path.resolve(args.output)}`);
  console.log(`ComfyUI prompt_id: ${result.promptId}`);
}

main().catch((e) => {
  console.error(`error: ${e.message || e}`);
  process.exit(1);
});
