// Verification harness for the first ruleset-pack migration: ageMovAdjustment
// moved from sheet.js into the rivers-of-london pack. Loads the browser scripts
// in index.html order under minimal DOM stubs and asserts parity + wiring.
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

// index.html order: registry -> rivers-of-london/character -> sheet
load('public/js/rulesets/registry.js');
load('public/js/rulesets/rivers-of-london/character.js');

check('window.Rulesets exists', !!window.Rulesets);
const rolPack = window.Rulesets.get('rol');             // legacy key the sheet uses
const cocPack = window.Rulesets.get('coc');             // no coc pack yet -> default fallback
check("get('rol') resolves to rivers-of-london", rolPack && rolPack.key === 'rivers-of-london');
check("get('coc') falls back to rivers-of-london", cocPack && cocPack.key === 'rivers-of-london');
check('pack exposes character.ageMovAdjustment',
  rolPack && rolPack.character && typeof rolPack.character.ageMovAdjustment === 'function');

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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
