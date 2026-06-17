// Verification harness for the ruleset-pack migration (docs/ruleset-modules.md).
// As rules-specific functions move out of the sheet.js monolith into ruleset
// packs, each gets a parity check here. Loads the browser scripts in index.html
// order under minimal DOM stubs and asserts the registry wiring + behaviour.
//
//   Run: node scripts/test-ruleset-packs.js
//
// Covers: ageMovAdjustment (rivers-of-london/character); pack identity +
// selectable ruleset options (Rulesets.options/resolveSelection/selectionValue).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}`); failures++; }
}

// Minimal browser-global stubs so the IIFE scripts evaluate. The functions
// under test are pure; DOM members are only touched at call time, not load.
const fakeEl = () => ({ value: '', className: '', textContent: '', style: {},
  setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null,
  querySelectorAll: () => [], remove() {}, classList: { add() {}, remove() {}, toggle() {} } });
global.window = global;
global.document = { getElementById: () => null, querySelector: () => null,
  querySelectorAll: () => [], createElement: fakeEl, addEventListener() {}, body: fakeEl() };

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  (new Function(code)).call(global);
}

// index.html order (pack identity + character before sheet.js)
load('public/js/rulesets/registry.js');
load('public/js/rulesets/rivers-of-london/pack.js');
load('public/js/rulesets/rivers-of-london/character.js');
load('public/js/rulesets/call-of-cthulhu-2e/pack.js');

check('window.Rulesets exists', !!window.Rulesets);
const rolPack = window.Rulesets.get('rol');             // legacy key the sheet uses
const cocPack = window.Rulesets.get('coc');             // now resolves to the CoC pack
check("get('rol') resolves to rivers-of-london", rolPack && rolPack.key === 'rivers-of-london');
check("get('coc') resolves to call-of-cthulhu-2e", cocPack && cocPack.key === 'call-of-cthulhu-2e');
check('pack exposes character.ageMovAdjustment',
  rolPack && rolPack.character && typeof rolPack.character.ageMovAdjustment === 'function');

// capability() must inherit the default pack's character for the CoC pack,
// which has no character of its own yet (this is what sheet.js relies on, and
// guards the advanced-tier MOV calc from crashing on a CoC/NPC sheet).
check('coc pack has no own character', !cocPack.character);
const cocChar = window.Rulesets.capability('coc', 'character');
check('capability(coc, character) falls back to RoL',
  cocChar && typeof cocChar.ageMovAdjustment === 'function');
check('capability fallback computes age 60 -> -3', cocChar && cocChar.ageMovAdjustment(60) === -3);

// Sheet schema (pack-driven characteristics) — bite 1 of the sheet refactor.
const rolSchema = rolPack.character.schema;
check('pack exposes character.schema.characteristics', rolSchema && typeof rolSchema.characteristics === 'function');
check('RoL characteristics = 5 base stats (no SIZ)',
  JSON.stringify(rolSchema.characteristics({ ruleset: 'rol', tier: 'basic' })) === JSON.stringify(['str','con','dex','int','pow']));
check('CoC-style characteristics add SIZ',
  JSON.stringify(rolSchema.characteristics({ ruleset: 'coc', tier: 'basic' })) === JSON.stringify(['str','con','dex','int','pow','siz']));
// The CoC pack inherits this schema via capability() until it supplies its own.
check('capability(coc, character).schema present',
  cocChar.schema && typeof cocChar.schema.characteristics === 'function');
check('coc via capability still yields SIZ list',
  JSON.stringify(cocChar.schema.characteristics({ ruleset: 'coc' })) === JSON.stringify(['str','con','dex','int','pow','siz']));

const amj = rolPack.character.ageMovAdjustment;
// Boundary parity with the original p.309 table.
check('age 30 -> 0',  amj(30) === 0);
check('age 39 -> 0',  amj(39) === 0);
check('age 40 -> -1', amj(40) === -1);
check('age 49 -> -1', amj(49) === -1);
check('age 50 -> -2', amj(50) === -2);
check('age 60 -> -3', amj(60) === -3);
check('age 70 -> -4', amj(70) === -4);
check('age 80 -> -5', amj(80) === -5);
check('age 99 -> -5', amj(99) === -5);
check('non-numeric -> 0', amj('') === 0 && amj('abc') === 0);

// sheet.js must still load cleanly after the removal + repoint.
let sheetLoaded = true;
try { load('public/js/sheet.js'); } catch (e) { sheetLoaded = false; console.log('  load error:', e.message); }
check('sheet.js loads without error', sheetLoaded);
check('window.SheetForm defined', !!window.SheetForm);

// The function must be gone from the parent (removed, not duplicated).
const sheetSrc = fs.readFileSync(path.join(ROOT, 'public/js/sheet.js'), 'utf8');
check('ageMovAdjustment no longer defined in sheet.js', !/function ageMovAdjustment/.test(sheetSrc));
check('sheet.js calls packCharacter().ageMovAdjustment', /packCharacter\(\)\.ageMovAdjustment/.test(sheetSrc));

// ── Pack identity / selectable ruleset options ──────────────────────────────
const opts = window.Rulesets.options();
check('options() returns three rulesets', opts.length === 3);
const byValue = Object.fromEntries(opts.map((o) => [o.value, o]));

function checkOption(value, label, ruleset, tier) {
  const o = byValue[value];
  check(`option ${value} -> "${label}"`, o && o.label === label);
  check(`option ${value} maps to ruleset=${ruleset}, tier=${tier}`,
    o && o.ruleset === ruleset && o.rules_tier === tier);
}
checkOption('rivers-of-london:basic',    'Rivers of London (Basic)',    'rol', 'basic');
checkOption('rivers-of-london:advanced', 'Rivers of London (Advanced)', 'rol', 'advanced');
checkOption('call-of-cthulhu-2e',        'Call of Cthulhu',             'coc', 'basic');

// Ordering: RoL (order 10) before CoC (order 20).
check('options ordered RoL before CoC',
  opts[0].key === 'rivers-of-london' && opts[2].key === 'call-of-cthulhu-2e');

// resolveSelection: dropdown value -> legacy columns.
const r1 = window.Rulesets.resolveSelection('rivers-of-london:advanced');
check('resolveSelection(rol:advanced)', r1 && r1.ruleset === 'rol' && r1.rules_tier === 'advanced');
const r2 = window.Rulesets.resolveSelection('call-of-cthulhu-2e');
check('resolveSelection(coc)', r2 && r2.ruleset === 'coc' && r2.rules_tier === 'basic');
check('resolveSelection(unknown) -> null', window.Rulesets.resolveSelection('nope') === null);

// selectionValue: stored legacy columns -> dropdown value (preselect).
check('selectionValue(rol, basic)',    window.Rulesets.selectionValue('rol', 'basic') === 'rivers-of-london:basic');
check('selectionValue(rol, advanced)', window.Rulesets.selectionValue('rol', 'advanced') === 'rivers-of-london:advanced');
check('selectionValue(coc, anything)', window.Rulesets.selectionValue('coc', 'advanced') === 'call-of-cthulhu-2e');
check('selectionValue(empty) -> default rol basic', window.Rulesets.selectionValue('', '') === 'rivers-of-london:basic');

// ── Auto-discovered rule-set tree (server module: src/ruleSections.js) ───────
const sections = require('../src/ruleSections');
const tree = sections.games();
const byGame = Object.fromEntries(tree.map((g) => [g.key, g]));
function setLabels(gameKey) {
  return ((byGame[gameKey] || {}).ruleSets || []).map((s) => s.label);
}
check('tree discovers the game systems present',
  !!byGame['rivers-of-london'] && !!byGame['call-of-cthulhu-2e']);
check('every listed game has >=1 loaded rule set (empty ones excluded)',
  sections.games().every((g) => g.ruleSets.length > 0));
check('game labels prettified from kebab',
  (byGame['rivers-of-london'] || {}).label === 'Rivers of London'
  && (byGame['call-of-cthulhu-2e'] || {}).label === 'Call of Cthulhu 2e');
check('RoL rule sets = Core, Advanced, Advanced Source',
  JSON.stringify(setLabels('rivers-of-london')) === JSON.stringify(['Core', 'Advanced', 'Advanced Source']));
check('CoC rule sets = GM, Player',
  JSON.stringify(setLabels('call-of-cthulhu-2e')) === JSON.stringify(['GM', 'Player']));
check('rule-set keys are "<game>/<dir>"', sections.list().every((s) => s.key.includes('/')));
check('get(rivers-of-london/rules) -> Core',
  (sections.get('rivers-of-london/rules') || {}).label === 'Core');
check('get(call-of-cthulhu-2e/rules-gm) -> GM',
  (sections.get('call-of-cthulhu-2e/rules-gm') || {}).label === 'GM');
check('get(unknown) -> null', sections.get('nope/nope') === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
