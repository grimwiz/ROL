#!/usr/bin/env node
// scripts/export-character-sheet.js
//
// Reads a character sheet from data/folly.db and renders it as a PDF by
// overlaying the saved data onto the blank Rivers_of_London/RoL_Charsheet.pdf.
//
// Usage:
//   node scripts/export-character-sheet.js --list
//   node scripts/export-character-sheet.js --session <id|name> --user <id|username> [-o out.pdf]
//   node scripts/export-character-sheet.js --session 1 --user andrew -o andrew.pdf
//   node scripts/export-character-sheet.js --session 1 --user andrew --json   # dump sheet JSON only
//
// Options:
//   --list                 Show available sessions and the sheets within each
//   --session <id|name>    Numeric id, or case-insensitive substring of session name
//   --user <id|username>   Numeric id, or case-insensitive username
//   -o, --output <path>    Output PDF (default: <slug-of-name>.pdf in cwd)
//   --json                 Print the raw sheet JSON to stdout and exit (no PDF)
//   --pretty               When --json is set, pretty-print the JSON
//   --db <path>            Override DB path (default: data/folly.db)
//   --blank <path>         Override blank PDF path (default: Rivers_of_London/RoL_Charsheet.pdf)
//   --from-json <path>     Render straight from a sheet JSON file (skip the DB entirely)
//   -h, --help             Show usage

'use strict';

const fs = require('fs');
const path = require('path');
const {
  PDFDocument, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
} = require('pdf-lib');
// better-sqlite3 is loaded lazily so --from-json works without a usable native build.
let Database = null;
function loadDb() { if (!Database) Database = require('better-sqlite3'); return Database; }

// ─── arg parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help':    out.help = true; break;
      case '--list':                out.list = true; break;
      case '--session':             out.session = next(); break;
      case '--user':                out.user = next(); break;
      case '-o': case '--output':   out.output = next(); break;
      case '--json':                out.json = true; break;
      case '--pretty':              out.pretty = true; break;
      case '--db':                  out.db = next(); break;
      case '--blank':               out.blank = next(); break;
      case '--from-json':           out.fromJson = next(); break;
      default:
        if (a.startsWith('-')) die(`Unknown option: ${a}`);
        out._.push(a);
    }
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function usage() {
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n')
    .slice(1, 25).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
}

// ─── DB lookups ─────────────────────────────────────────────────────────────
function openDb(dbPath) {
  if (!fs.existsSync(dbPath)) die(`DB not found at ${dbPath}`);
  const Db = loadDb();
  return new Db(dbPath, { readonly: true, fileMustExist: true });
}

function listAll(db) {
  const sessions = db.prepare('SELECT id, name FROM sessions ORDER BY id').all();
  if (sessions.length === 0) {
    process.stdout.write('(no sessions)\n');
    return;
  }
  for (const s of sessions) {
    process.stdout.write(`session ${s.id}: ${s.name}\n`);
    const sheets = db.prepare(`
      SELECT cs.user_id, u.username
      FROM character_sheets cs
      JOIN users u ON u.id = cs.user_id
      WHERE cs.session_id = ?
      ORDER BY u.username
    `).all(s.id);
    if (sheets.length === 0) {
      process.stdout.write('  (no sheets)\n');
    } else {
      for (const sh of sheets) {
        process.stdout.write(`  user ${sh.user_id}: ${sh.username}\n`);
      }
    }
  }
}

function resolveSession(db, key) {
  if (/^\d+$/.test(key)) {
    const row = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(Number(key));
    if (!row) die(`No session with id ${key}`);
    return row;
  }
  const rows = db.prepare(
    "SELECT id, name FROM sessions WHERE name LIKE ? COLLATE NOCASE"
  ).all(`%${key}%`);
  if (rows.length === 0) die(`No session matching '${key}'`);
  if (rows.length > 1) {
    const opts = rows.map(r => `  ${r.id}: ${r.name}`).join('\n');
    die(`Ambiguous session '${key}', matches:\n${opts}`);
  }
  return rows[0];
}

function resolveUser(db, key) {
  if (/^\d+$/.test(key)) {
    const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(key));
    if (!row) die(`No user with id ${key}`);
    return row;
  }
  const row = db.prepare(
    'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
  ).get(key);
  if (!row) die(`No user '${key}'`);
  return row;
}

function fetchSheet(db, sessionId, userId) {
  const row = db.prepare(
    'SELECT data FROM character_sheets WHERE session_id = ? AND user_id = ?'
  ).get(sessionId, userId);
  if (!row) die(`No sheet found for session ${sessionId}, user ${userId}`);
  let data;
  try { data = JSON.parse(row.data); }
  catch (e) { die(`Sheet data is not valid JSON: ${e.message}`); }
  return data;
}

// ─── PDF overlay ────────────────────────────────────────────────────────────
//
// Coordinates use the source PDF's natural orientation (top-down). The flip()
// helper converts to pdf-lib's bottom-left origin. Tweak any single field by
// changing one number in COORDS — nothing else cascades.
//
// Page 1 of RoL Charsheet.pdf is A4 = 595.32 × 841.92 pt.
const PAGE_W = 595.32;
const PAGE_H = 841.92;

const COORDS = {
  // Investigator Info — LEFT column.
  // Each row has a label like "Name" then an underline running to ~x=380.
  nameL1:       { x: 240, y: 88,    maxW: 140 },
  nameL2:       { x: 210, y: 108.5, maxW: 170 },
  occupation:   { x: 265, y: 129,   maxW: 115 },
  birthplace:   { x: 273, y: 149.5, maxW: 108 },
  residence:    { x: 258, y: 170,   maxW: 122 },

  // Pronoun___ Age___ share row y=190.5.
  // Measured: Pronoun underline x=247.7-305.8 (w=58), Age underline x=327.8-381.6 (w=54).
  pronouns:     { x: 250, y: 190.5, maxW:  55 },
  age:          { x: 330, y: 190.5, maxW:  50 },

  // Affluence row — measured underline x=254.4-381.6 (w=127).
  affluence:    { x: 257, y: 211,   maxW: 122 },

  // Notes rows — underlines measured at y=231.4/252.0/272.6.
  // Row 1 underline x=236.6-381.6 (w=145), rows 2-3 x=207.8-381.6 (w=174).
  // We funnel Glitch + Class + Backstory into these three lines.
  notes:        [
    { x: 240, y: 231.5, maxW: 140 },
    { x: 210, y: 252,   maxW: 170 },
    { x: 210, y: 272.5, maxW: 170 },
  ],

  // Characteristics — RIGHT column. Five rows; full underline x=458-539,
  // half underline x=542-567. Place text inset from underline edges.
  charFullX: 485,   // left-shifted vs midpoint to avoid the "FULL" subscript
  charHalfX: 553,
  charY: { str: 88, con: 108.5, dex: 129, int: 149.5, pow: 170 },

  // Supplemental — RIGHT column lower.
  // We only fill the STARTING value (not the CURRENT value).
  movX: 503, movY: 231.5,
  luckStartX: 478,    luckStartY: 252,
  mpStartX:   492,    mpStartY:   272.5,

  // Advantages / Disadvantages — 3 rows each side.
  advX: 30,  advMaxW: 257,
  disX: 310, disMaxW: 256,
  advDisY: [336, 356.5, 377],

  // Common skills — LEFT column, 9 rows at 20.6pt pitch starting y=423.8.
  // Measured row 1: FULL x=128.2-152.2 (mid 140), HALF x=156-180 (mid 168).
  // There's no "Fifth" column — RoL uses FULL + HALF only.
  skillFullX:  140,
  skillHalfX:  168,
  skillY0:     424,
  skillPitch:  20.6,

  // Expert skills (additional_skills) — MIDDLE column. Same y grid.
  // Measured: NAME x=213.1-312.0 (w=99), FULL x=325.9-350.4 (mid 338),
  // HALF x=353.8-377.8 (mid 366).
  expertNameX: 215, expertNameMaxW: 95,
  expertFullX: 338,
  expertHalfX: 366,

  // Combat skills — RIGHT column, same 9-row grid sharing skillY0+pitch.
  // FULL x=515-540 (mid 527), HALF x=542-567 (mid 555). Skill names (Fighting,
  // Firearms, etc.) are preprinted on the first 2 rows only.
  combatFullX: 527,
  combatHalfX: 555,

  // Damage track — checkboxes on right side.
  // Approximate: Hurt/Bloodied at y≈480, Down/Impaired at y≈497.
  damageBoxes: [
    { key: 'hurt',     x: 478, y: 480 },
    { key: 'bloodied', x: 478, y: 497 },
    { key: 'down',     x: 478, y: 514 },
    { key: 'impaired', x: 478, y: 531 },
  ],

  // Weapons — 3 rows, 2 weapons per row (only col 1 rendered for now).
  // Measured row 1: NAME x=28.3-133.4 (w=105), FULL x=137.8-162.7 (mid 150),
  // HALF x=167.5-192.5 (mid 180), DAMAGE x=199.7-245.8 (w=46),
  // RANGE x=252.0-288.5 (w=37).
  weaponY:       [642.9, 663.5, 683.5],
  weaponNameX:   30,    weaponNameMaxW: 100,
  weaponFullX:   150,
  weaponHalfX:   180,
  weaponDmgX:    202,   weaponDmgMaxW:   42,
  weaponRangeX:  254,   weaponRangeMaxW: 34,

  // Magic spells — page 1, 2 columns × 3 rows = 6 slots.
  // Each slot has [□] ORDER / NAME (small underline + long underline).
  // Measured row 1: col1 ORDER x=35.0-56.9 (mid 46), NAME x=60.2-279.4 (w=219).
  //                 col2 ORDER x=313.7-335.5 (mid 325), NAME x=338.6-567.1 (w=228).
  // Row pitch ≈ 20.4pt.
  spellY:        [738.7, 759.1, 779.5],
  spellCol1OrderX: 46,
  spellCol1NameX:  62,   spellCol1NameMaxW: 215,
  spellCol2OrderX: 325,
  spellCol2NameX:  340,  spellCol2NameMaxW: 225,
  spellOrderMaxW:  20,

  // ─── Page 2 ──────────────────────────────────────────────────────────────
  // NAME white entry rectangle (top-left): pt x=104.6..291.6, y=52..67.
  // OCCUPATION white entry rectangle (top-right): pt x=444.7..575.3, same y.
  // Text is BLACK on WHITE — baseline just above the bottom border (y≈65).
  p2NameX:        110, p2NameY:       65, p2NameMaxW:       180,
  p2OccupationX:  450, p2OccupationY: 65, p2OccupationMaxW: 125,

  // BACKSTORY section (page 2): 11 two-column rows.
  // Left col underline x=28.3-288.5 (w=260), right col x=310.3-567.1 (w=257).
  // First row y=333.6, pitch ≈20.4pt.
  p2BackstoryY0:    333.6,
  p2BackstoryPitch: 20.4,
  p2BackstoryRows:  11,
  p2BackstoryLeftX: 30,  p2BackstoryLeftMaxW:  256,
  p2BackstoryRightX:312, p2BackstoryRightMaxW: 254,

  // EQUIPMENT section (page 2): 10 single-column rows (left side).
  // Underline x=28.3-288.5, first row y=586.1, pitch ≈20.4pt.
  p2EquipmentY0:    586.1,
  p2EquipmentPitch: 20.4,
  p2EquipmentRows:  10,
  p2EquipmentX:     30,  p2EquipmentMaxW: 256,

  // Portrait box — page 1, between the "Rivers of London" logo and the
  // ADVANTAGES bar, to the right of the vertical PORTRAIT sidebar.
  // Measured interior: x 38.4-202.3 pt (w=163.9), y 114-301.4 pt (h=187.4).
  // Aspect ratio is ~0.875 (close to 7:8). A source image of 656×750 px
  // (or any 7:8) renders crisply at 4× — at 800×914 it's print quality.
  // Non-matching aspect ratios are letterboxed (centred in the box) by
  // drawPortrait() below, so they never spill outside.
  portrait: { x: 38, yTop: 114, w: 164, h: 187 },
};

const flip = yTop => PAGE_H - yTop + 1.5;

function ellipsize(font, text, size, maxW) {
  if (!text) return '';
  let s = String(text);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
  return s + '…';
}

function dtext(page, font, text, x, yTop, size, maxW) {
  if (text == null || text === '') return;
  const s = maxW ? ellipsize(font, String(text), size, maxW) : String(text);
  page.drawText(s, { x, y: flip(yTop), size, font });
}

function dcenter(page, font, text, xCenter, yTop, size) {
  if (text == null || text === '') return;
  const s = String(text);
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: xCenter - w / 2, y: flip(yTop), size, font });
}

function wrap(font, text, size, maxW, lines) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const out = []; let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
    else {
      if (cur) out.push(cur);
      cur = w;
      if (out.length === lines - 1) break;
    }
  }
  if (cur && out.length < lines) out.push(cur);
  return out;
}

async function buildPdf(sheet, blankPath) {
  if (!fs.existsSync(blankPath)) die(`Blank PDF not found at ${blankPath}`);
  const blankBytes = fs.readFileSync(blankPath);
  const pdf = await PDFDocument.load(blankBytes);

  const font  = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p1 = pdf.getPages()[0];

  const FS = 10, FSS = 9, FSN = 11;

  // Investigator info
  const nameLines = wrap(font, sheet.name, FS, COORDS.nameL1.maxW, 2);
  if (nameLines[0]) dtext(p1, font, nameLines[0], COORDS.nameL1.x, COORDS.nameL1.y, FS);
  if (nameLines[1]) dtext(p1, font, nameLines[1], COORDS.nameL2.x, COORDS.nameL2.y, FS, COORDS.nameL2.maxW);

  dtext(p1, font, sheet.occupation,  COORDS.occupation.x,  COORDS.occupation.y,  FS, COORDS.occupation.maxW);
  dtext(p1, font, sheet.birthplace,  COORDS.birthplace.x,  COORDS.birthplace.y,  FS, COORDS.birthplace.maxW);
  dtext(p1, font, sheet.residence,   COORDS.residence.x,   COORDS.residence.y,   FS, COORDS.residence.maxW);
  dtext(p1, font, sheet.pronouns,    COORDS.pronouns.x,    COORDS.pronouns.y,    FS, COORDS.pronouns.maxW);
  dtext(p1, font, sheet.age,         COORDS.age.x,         COORDS.age.y,         FS, COORDS.age.maxW);
  // Affluence row absorbs Social Class so they share one line.
  const affluenceText = [sheet.affluence, sheet.social_class].filter(Boolean).join(' / ');
  dtext(p1, font, affluenceText,     COORDS.affluence.x,   COORDS.affluence.y,   FS, COORDS.affluence.maxW);

  // Notes rows hold backstory (glitch lives on page 2 in BACKSTORY area;
  // social class now lives in the Affluence field above).
  const noteLines = [];
  if (sheet.backstory)    noteLines.push(sheet.backstory);
  // Wrap to fit on the available 3 note lines.
  const noteW = COORDS.notes[0].maxW;
  const flat = noteLines.join(' / ');
  const wrapped = wrap(font, flat, FS, noteW, COORDS.notes.length);
  for (let i = 0; i < wrapped.length; i += 1) {
    dtext(p1, font, wrapped[i], COORDS.notes[i].x, COORDS.notes[i].y, FS, noteW);
  }

  // Characteristics — full + derived half.
  for (const [k, y] of Object.entries(COORDS.charY)) {
    const v = sheet[k];
    if (v === undefined || v === '' || v === null) continue;
    dcenter(p1, fontB, String(v), COORDS.charFullX, y, FSN);
    const n = Number(v);
    if (Number.isFinite(n)) dcenter(p1, font, String(Math.floor(n / 2)), COORDS.charHalfX, y, FSN);
  }

  // Supplemental stats — STARTING values only (skip CURRENT per user request).
  // Real form stores MOV and MP in sheet.derived; legacy fixture uses sheet.mov /
  // sheet.magic_points directly — support both.
  const derived = sheet.derived || {};
  const movVal = (derived.move !== undefined && derived.move !== '') ? derived.move
    : (sheet.mov !== undefined && sheet.mov !== '' ? sheet.mov : '');
  if (movVal !== '') {
    dcenter(p1, fontB, String(movVal), COORDS.movX, COORDS.movY, FSN);
  }
  if (sheet.luck !== undefined && sheet.luck !== '') {
    dcenter(p1, fontB, String(sheet.luck), COORDS.luckStartX, COORDS.luckStartY, FSN);
  }
  const mpFromDerived = (derived.mp !== undefined && derived.mp !== '') ? derived.mp : '';
  const mpLegacy = (sheet.magic_points !== undefined && sheet.magic_points !== '') ? sheet.magic_points : '';
  const mp = mpFromDerived !== '' ? mpFromDerived
    : mpLegacy !== '' ? mpLegacy
    : (Number.isFinite(Number(sheet.pow)) ? Math.floor(Number(sheet.pow) / 5) : '');
  if (mp !== '') {
    dcenter(p1, fontB, String(mp), COORDS.mpStartX, COORDS.mpStartY, FSN);
  }

  // Damage track
  const dmg = sheet.damage || {};
  for (const box of COORDS.damageBoxes) {
    if (dmg[box.key]) p1.drawText('X', { x: box.x, y: flip(box.y), size: 12, font: fontB });
  }

  // Advantages / Disadvantages
  const splitLines = s => (s ? String(s).split(/\r?\n|,\s*/).map(x => x.trim()).filter(Boolean) : []);
  const advList = splitLines(sheet.advantages);
  const disList = splitLines(sheet.disadvantages);
  for (let i = 0; i < 3; i += 1) {
    const y = COORDS.advDisY[i];
    if (advList[i]) dtext(p1, font, advList[i], COORDS.advX, y, FS, COORDS.advMaxW);
    if (disList[i]) dtext(p1, font, disList[i], COORDS.disX, y, FS, COORDS.disMaxW);
  }

  // Common skills (LEFT column). Names + Base are preprinted; only fill FULL + HALF.
  // Real form stores the 9 preprinted skills in sheet.common_skills; legacy
  // fixture uses sheet.mandatory_skills. Fall back to the latter for compat.
  const COMMON_SKILL_ORDER = ['Athletics','Drive','Navigate','Observation','Read Person','Research','Sense Vestigia','Social','Stealth'];
  let commons;
  if (Array.isArray(sheet.common_skills) && sheet.common_skills.length) {
    // Reorder so each slot matches its preprinted label.
    const byName = new Map(sheet.common_skills.map(s => [String(s.name || '').toLowerCase(), s]));
    commons = COMMON_SKILL_ORDER.map(n => byName.get(n.toLowerCase()) || {});
  } else {
    commons = Array.isArray(sheet.mandatory_skills) ? sheet.mandatory_skills : [];
  }
  for (let i = 0; i < Math.min(commons.length, 9); i += 1) {
    const y = COORDS.skillY0 + i * COORDS.skillPitch;
    const s = commons[i] || {};
    if (s.value === undefined || s.value === '' || s.value === null) continue;
    dcenter(p1, fontB, String(s.value), COORDS.skillFullX, y, FSS);
    const n = Number(s.value);
    if (Number.isFinite(n)) dcenter(p1, font, String(Math.floor(n / 2)), COORDS.skillHalfX, y, FSS);
  }

  // Expert skills (MIDDLE column). Real form splits user-typed skills across
  // mandatory_skills + additional_skills; legacy fixture puts them all in
  // additional_skills. Combine both when common_skills is populated.
  const hasCommon = Array.isArray(sheet.common_skills) && sheet.common_skills.length > 0;
  const experts = hasCommon
    ? [].concat(
        Array.isArray(sheet.mandatory_skills) ? sheet.mandatory_skills : [],
        Array.isArray(sheet.additional_skills) ? sheet.additional_skills : []
      )
    : (Array.isArray(sheet.additional_skills) ? sheet.additional_skills : []);
  for (let i = 0; i < Math.min(experts.length, 9); i += 1) {
    const y = COORDS.skillY0 + i * COORDS.skillPitch;
    const s = experts[i] || {};
    if (s.name) dtext(p1, font, s.name, COORDS.expertNameX, y, FSS, COORDS.expertNameMaxW);
    if (s.value === undefined || s.value === '' || s.value === null) continue;
    dcenter(p1, fontB, String(s.value), COORDS.expertFullX, y, FSS);
    const n = Number(s.value);
    if (Number.isFinite(n)) dcenter(p1, font, String(Math.floor(n / 2)), COORDS.expertHalfX, y, FSS);
  }

  // Combat skills (RIGHT column). Only fill values; blank only has 2 preprinted
  // labels (Fighting, Firearms) so we limit to first 2.
  const combats = Array.isArray(sheet.combat_skills) ? sheet.combat_skills : [];
  for (let i = 0; i < Math.min(combats.length, 2); i += 1) {
    const y = COORDS.skillY0 + i * COORDS.skillPitch;
    const s = combats[i] || {};
    if (s.value === undefined || s.value === '' || s.value === null) continue;
    dcenter(p1, fontB, String(s.value), COORDS.combatFullX, y, FSS);
    const n = Number(s.value);
    if (Number.isFinite(n)) dcenter(p1, font, String(Math.floor(n / 2)), COORDS.combatHalfX, y, FSS);
  }

  // Weapons
  const weapons = Array.isArray(sheet.weapons) ? sheet.weapons : [];
  for (let i = 0; i < Math.min(weapons.length, 3); i += 1) {
    const w = weapons[i] || {};
    const y = COORDS.weaponY[i];
    dtext(p1, font, w.name || '', COORDS.weaponNameX,  y, FSS, COORDS.weaponNameMaxW);
    if (w.full !== undefined && w.full !== '') dcenter(p1, font, String(w.full), COORDS.weaponFullX, y, FSS);
    if (w.half !== undefined && w.half !== '') dcenter(p1, font, String(w.half), COORDS.weaponHalfX, y, FSS);
    dtext(p1, font, w.damage || '', COORDS.weaponDmgX,   y, FSS, COORDS.weaponDmgMaxW);
    dtext(p1, font, w.range  || '', COORDS.weaponRangeX, y, FSS, COORDS.weaponRangeMaxW);
  }

  // Magic spells — 6 slots arranged 2 columns × 3 rows. Fill column-major:
  // slot 0 = row 1 col 1, slot 1 = row 2 col 1, slot 2 = row 3 col 1, then col 2.
  const spells = Array.isArray(sheet.magic_spells) ? sheet.magic_spells : [];
  for (let i = 0; i < Math.min(spells.length, 6); i += 1) {
    const s = spells[i] || {};
    const row = i % 3;
    const col = Math.floor(i / 3);
    const y = COORDS.spellY[row];
    const orderX = col === 0 ? COORDS.spellCol1OrderX : COORDS.spellCol2OrderX;
    const nameX  = col === 0 ? COORDS.spellCol1NameX  : COORDS.spellCol2NameX;
    const nameW  = col === 0 ? COORDS.spellCol1NameMaxW : COORDS.spellCol2NameMaxW;
    if (s.order !== undefined && s.order !== '') {
      dcenter(p1, font, String(s.order), orderX, y, FSS);
    }
    dtext(p1, font, s.name || '', nameX, y, FSS, nameW);
  }

  // Portrait
  await drawPortrait(pdf, p1, sheet.portrait);

  // ─── Page 2 ──────────────────────────────────────────────────────────────
  const p2 = pdf.getPages()[1];
  if (p2) {
    // NAME / OCCUPATION sit in WHITE entry rectangles above the dark bar —
    // render in black. Measured rects: NAME pt x=104.6..291.6, OCC pt x=444.7..575.3.
    const nameLine = (nameLines[0] || '') + (nameLines[1] ? ' ' + nameLines[1] : '');
    if (nameLine.trim()) {
      dtext(p2, font, nameLine.trim(), COORDS.p2NameX, COORDS.p2NameY, FS, COORDS.p2NameMaxW);
    }
    if (sheet.occupation) {
      dtext(p2, font, String(sheet.occupation), COORDS.p2OccupationX, COORDS.p2OccupationY, FS, COORDS.p2OccupationMaxW);
    }

    // BACKSTORY: 11 rows × 2 columns. Fill column 1 top-to-bottom, then
    // column 2 top-to-bottom. Glitch sentence goes first, then backstory prose.
    const backstoryParts = [];
    if (sheet.glitch) backstoryParts.push(`Glitch: ${sheet.glitch}`);
    if (sheet.backstory) backstoryParts.push(String(sheet.backstory));
    const backstoryText = backstoryParts.join(' ');
    if (backstoryText.trim()) {
      const slots = [];
      // Column 1 (left) top-to-bottom, then column 2 (right) top-to-bottom.
      for (let c = 0; c < 2; c += 1) {
        for (let r = 0; r < COORDS.p2BackstoryRows; r += 1) {
          const y = COORDS.p2BackstoryY0 + r * COORDS.p2BackstoryPitch;
          slots.push({
            x: c === 0 ? COORDS.p2BackstoryLeftX  : COORDS.p2BackstoryRightX,
            y,
            w: c === 0 ? COORDS.p2BackstoryLeftMaxW : COORDS.p2BackstoryRightMaxW,
          });
        }
      }
      let remaining = backstoryText;
      for (const slot of slots) {
        if (!remaining) break;
        const line = wrap(font, remaining, FS, slot.w, 1)[0] || '';
        if (!line) break;
        dtext(p2, font, line, slot.x, slot.y, FS);
        remaining = remaining.slice(line.length).replace(/^\s+/, '');
      }
    }

    // EQUIPMENT: render sheet.carry (one item per row; newline-separated input).
    if (sheet.carry) {
      const items = String(sheet.carry).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < Math.min(items.length, COORDS.p2EquipmentRows); i += 1) {
        const y = COORDS.p2EquipmentY0 + i * COORDS.p2EquipmentPitch;
        dtext(p2, font, items[i], COORDS.p2EquipmentX, y, FS, COORDS.p2EquipmentMaxW);
      }
    }
  }

  return pdf.save();
}

async function drawPortrait(pdf, page, portrait) {
  if (!portrait || typeof portrait !== 'string') return;
  let bytes = null, kind = null;
  // data URL
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(portrait);
  if (m) {
    kind = m[1].toLowerCase().startsWith('jp') ? 'jpg' : 'png';
    bytes = Buffer.from(m[2], 'base64');
  } else if (/^https?:/i.test(portrait)) {
    process.stderr.write('warning: remote portrait URLs not supported in CLI\n');
    return;
  } else if (fs.existsSync(portrait)) {
    bytes = fs.readFileSync(portrait);
    kind = portrait.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  }
  if (!bytes) {
    process.stderr.write('warning: portrait could not be decoded\n');
    return;
  }
  let img;
  try {
    img = kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch (e) {
    process.stderr.write(`warning: portrait embed failed: ${e.message}\n`);
    return;
  }
  const box = COORDS.portrait;
  const iw = img.width, ih = img.height;
  // Cover-scale: use Math.max so the longest side fills the box, cropping overflow.
  const scale = Math.max(box.w / iw, box.h / ih);
  const dw = iw * scale, dh = ih * scale;
  const dx = box.x + (box.w - dw) / 2;         // may be negative (crop)
  const dyTop = box.yTop + (box.h - dh) / 2;   // may be negative (crop)
  // Clip to the portrait box so overflow doesn't spill onto the page.
  const clipY = PAGE_H - box.yTop - box.h;
  page.pushOperators(
    pushGraphicsState(),
    rectangle(box.x, clipY, box.w, box.h),
    clip(),
    endPath(),
  );
  page.drawImage(img, { x: dx, y: PAGE_H - dyTop - dh, width: dw, height: dh });
  page.pushOperators(popGraphicsState());
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  const repoRoot = path.resolve(__dirname, '..');
  const dbPath    = args.db    || path.join(repoRoot, 'data', 'folly.db');
  const blankPath = args.blank || path.join(repoRoot, 'Rivers_of_London', 'RoL_Charsheet.pdf');

  // --from-json: skip the DB entirely and render straight from a JSON file.
  if (args.fromJson) {
    if (!fs.existsSync(args.fromJson)) die(`JSON not found at ${args.fromJson}`);
    const sheet = JSON.parse(fs.readFileSync(args.fromJson, 'utf8'));
    const pdfBytes = await buildPdf(sheet, blankPath);
    const slug = (sheet.name || 'character').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'character';
    const outPath = args.output || `${slug}.pdf`;
    fs.writeFileSync(outPath, pdfBytes);
    process.stderr.write(`wrote ${outPath} (${pdfBytes.length} bytes) from ${args.fromJson}\n`);
    return;
  }

  const db = openDb(dbPath);
  try {
    if (args.list) { listAll(db); return; }
    if (!args.session || !args.user) {
      usage();
      die('--session and --user are required (or pass --list or --from-json)');
    }
    const session = resolveSession(db, args.session);
    const user    = resolveUser(db, args.user);
    const sheet   = fetchSheet(db, session.id, user.id);

    if (args.json) {
      process.stdout.write(JSON.stringify(sheet, null, args.pretty ? 2 : 0) + '\n');
      return;
    }

    const pdfBytes = await buildPdf(sheet, blankPath);
    const slug = (sheet.name || user.username).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'character';
    const outPath = args.output || `${slug}.pdf`;
    fs.writeFileSync(outPath, pdfBytes);
    process.stderr.write(`wrote ${outPath} (${pdfBytes.length} bytes) — session ${session.id} "${session.name}", user ${user.username}\n`);
  } finally {
    db.close();
  }
}

main().catch(e => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(1); });
