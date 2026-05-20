#!/usr/bin/env node
// Diagnostic harness: render the byte-identical Ollama prompt for any
// scenario section (or per-item, for looped sections) WITHOUT invoking the
// language model. Useful for inspecting why a regeneration produces what it
// does, for verifying prompt changes, and as a basis for future unit tests.
//
// Usage:
//   node scripts/dump-prompt.js --session <id> --section <sectionId> [--item <key>]
//
// Output is written to:
//   data/sessions/<slug>/debug-prompts/<sectionId>[.<itemKey>].prompt.md
//
// The in-process variant of the env-gated DEBUG_DUMP_PROMPTS=1 hook inside
// regenerateScenarioSection. That hook captures BOTH prompt and response in
// production; this script captures the prompt alone, deterministically, no
// LLM/GPU.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
process.chdir(REPO);

const db = require(path.join(REPO, 'src/db'));
const sm = require(path.join(REPO, 'src/scenarioInfo'));

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const help = args.includes('--help') || args.includes('-h');
const sectionId = getArg('section');
const sessionIdRaw = getArg('session');
const itemKey = getArg('item');

function usage(exitCode) {
  console.log('Usage: node scripts/dump-prompt.js --session <id> --section <sectionId> [--item <key>]');
  console.log('');
  console.log('Renders the byte-identical Ollama prompt for a section, without invoking the LLM.');
  console.log('Output: data/sessions/<slug>/debug-prompts/<sectionId>[.<itemKey>].prompt.md');
  console.log('');
  console.log('Available sections:');
  Object.keys(sm.SCENARIO_SECTIONS).forEach((id) => {
    const looped = sm.LOOPED_SECTIONS[id];
    console.log('  ' + id + (looped ? '   (looped — pass --item)' : ''));
  });
  process.exit(exitCode);
}

if (help || !sectionId || !sessionIdRaw) usage(help ? 0 : 1);
const sessionId = parseInt(sessionIdRaw, 10);
if (!Number.isFinite(sessionId)) usage(1);

const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
if (!sessionRow) {
  console.error(`Session ${sessionId} not found in DB.`);
  process.exit(1);
}

const section = sm.readScenarioSection(sessionRow, sectionId);
if (!section) {
  console.error(`Section "${sectionId}" not found. Run with --help to list sections.`);
  process.exit(1);
}
const { config, paths, artifact, value: currentValue } = section;
const sourceFiles = sm.listSessionSourceFiles(sessionRow, { includePrivate: config.artifact === 'gm' });

let prompt;
let outName;
const looped = sm.LOOPED_SECTIONS[sectionId];
if (looped) {
  const items = looped(sessionRow, db, paths, sourceFiles);
  if (!items.length) {
    console.error('No looped items available for this section.');
    process.exit(1);
  }
  if (!itemKey) {
    console.error('Looped section requires --item. Available item keys:');
    items.forEach((it) => console.error(`  ${it.key}`));
    process.exit(1);
  }
  const it = items.find((x) => x.key === itemKey);
  if (!it) {
    console.error(`Item "${itemKey}" not found. Available: ${items.map((x) => x.key).join(', ')}`);
    process.exit(1);
  }
  prompt = sm.renderLoopedItemPrompt(sessionRow, db, config, it, sourceFiles);
  outName = `${sectionId}.${itemKey}.prompt.md`;
} else {
  prompt = sm.renderSectionPrompt(sessionRow, db, config, artifact, currentValue, sourceFiles);
  outName = `${sectionId}.prompt.md`;
}

const outDir = path.join(paths.root, 'debug-prompts');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, outName);
fs.writeFileSync(outPath, prompt);
console.log(`Wrote ${path.relative(REPO, outPath)} (${prompt.length.toLocaleString()} chars)`);
