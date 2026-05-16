#!/usr/bin/env node

// Manual entry point for the single scenario-information generation path.
// Codex/Claude is not available on the application server, so this script runs
// exactly the same Ollama-backed regeneration the web app triggers — there is
// no separate "write a prompt file" path any more.
//
// Usage:
//   npm run scenario:regenerate -- --scenario <id-or-name>
//   npm run scenario:regenerate -- --scenario 1 --artifact player
//   npm run scenario:regenerate -- --scenario 1 --sections player.entities.npcs,player.entities.items

const db = require('../src/db');
const {
  findSessionByToken,
  regenerateScenarioSections,
  ollamaStatus
} = require('../src/scenarioInfo');

function readFlag(argv, ...names) {
  for (const name of names) {
    const idx = argv.indexOf(name);
    if (idx !== -1) return argv[idx + 1];
  }
  return undefined;
}

const argv = process.argv.slice(2);
const sessionArg = readFlag(argv, '--scenario', '--session', '-s')
  || argv.find((arg) => !arg.startsWith('-'))
  || '';

if (!sessionArg) {
  console.error('Usage: npm run scenario:regenerate -- --scenario <id-or-name> [--artifact player|gm] [--sections id,id]');
  process.exit(1);
}

const session = findSessionByToken(db, sessionArg);
if (!session) {
  console.error(`No matching non-system session found for: ${sessionArg}`);
  process.exit(1);
}

const sectionsArg = readFlag(argv, '--sections', '--section');
const options = {
  artifact: readFlag(argv, '--artifact') || null,
  sections: sectionsArg ? sectionsArg.split(',').map((s) => s.trim()).filter(Boolean) : null
};

const isTTY = !!process.stdout.isTTY;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const line = (s) => `${s}`.padEnd(78).slice(0, 78);
const starts = new Map();

// Live per-section feedback. The Ollama call is streamed, so this heartbeat
// reflects real generation progress (elapsed + characters received so far),
// not just a spinner — the model work itself runs inside Ollama.
function onEvent(ev) {
  const tag = `[${ev.index}/${ev.total}] ${ev.id}`;
  if (ev.type === 'start') {
    starts.set(ev.id, Date.now());
    if (isTTY) process.stdout.write(`\r${line(`→ ${tag}  connecting…`)}`);
    else console.log(`→ ${tag}`);
  } else if (ev.type === 'progress') {
    if (!isTTY) return; // avoid flooding non-TTY logs; start/done lines suffice
    process.stdout.write(`\r${line(`→ ${tag}  ${secs(ev.elapsedMs)}  ${ev.chars.toLocaleString()} chars`)}`);
  } else if (ev.type === 'done') {
    const took = secs(Date.now() - (starts.get(ev.id) || Date.now()));
    const msg = `✓ ${tag}  (${took})  → ${ev.output_path}`;
    if (isTTY) process.stdout.write(`\r${line(msg)}\n`);
    else console.log(msg);
  } else if (ev.type === 'error') {
    const took = secs(Date.now() - (starts.get(ev.id) || Date.now()));
    const msg = `✗ ${tag}  (${took})  ${ev.error}`;
    if (isTTY) process.stderr.write(`\r${line(msg)}\n`);
    else console.error(msg);
  }
}

(async () => {
  const ol = ollamaStatus();
  console.log(`Session: ${session.name} (${session.id})`);
  console.log(`Ollama:  ${ol.model} @ ${ol.url}`);
  console.log(options.sections ? `Sections: ${options.sections.join(', ')}`
    : options.artifact ? `Artifact: ${options.artifact} (all sections)`
    : 'Regenerating all sections');
  console.log('');

  const startedAll = Date.now();
  const result = await regenerateScenarioSections(session.id, db, { ...options, onEvent });
  console.log('');
  console.log(`Done in ${secs(Date.now() - startedAll)}: ${result.regenerated.length} regenerated, ${result.errors.length} failed.`);
  process.exit(result.errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
