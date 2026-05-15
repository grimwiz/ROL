#!/usr/bin/env node

// Parses the bundled Rivers of London rulebook Markdown and writes one NPC
// character-sheet JSON per named NPC into Rivers_of_London/globaldata/npcs/.
// The rulebook is the single source of truth; re-run this whenever it changes.
//
//   npm run npcs:extract
//
// The seeder (src/npcSeed.js) loads these JSON files into the DB if missing,
// mirroring how global Markdown is auto-seeded into sessions.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const RULEBOOK = path.join(REPO_ROOT, 'Rivers_of_London', 'cha3200_-_rivers_of_london_1.4.md');
const OUT_DIR = path.join(REPO_ROOT, 'Rivers_of_London', 'globaldata', 'npcs');

const COMMON_SKILL_NAMES = [
  'Athletics', 'Drive', 'Navigate', 'Observation', 'Read Person',
  'Research', 'Sense Vestigia', 'Social', 'Stealth'
];
const COMBAT_SKILL_NAMES = ['Fighting', 'Firearms'];
// `## ` headings that belong to a profile rather than ending it.
const SUBSECTIONS = ['skills', 'languages', 'spells', 'signare', 'powers', 'demi-monde affinity', 'vestigia'];

function slugify(value) {
  return String(value || 'npc').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'npc';
}

function isSubsection(headingText) {
  const h = headingText.toLowerCase().trim();
  return SUBSECTIONS.some((s) => h === s || h.startsWith(s));
}

function cleanLine(s) {
  return String(s).replace(/!\[Image\][^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

// Split the rulebook into heading-delimited segments.
function buildSegments(lines) {
  const segments = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.*?)\s*$/);
    if (m) {
      if (current) segments.push(current);
      current = { heading: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(lines[i]);
    }
  }
  if (current) segments.push(current);
  return segments;
}

// A profile = a non-subsection heading whose following subsection segments
// (until the next non-subsection heading) contain an STR stat.
// Headings that contain STR only because of rules text / combat examples.
const NOT_A_NAME = /turn:|^step\b|^assign|characteristic|^human limits|^highest skill|^weak$|^damage bonus$|^natural toughness$|wins$/i;

function collectProfiles(segments) {
  const profiles = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (isSubsection(seg.heading)) { i += 1; continue; }
    let heading = seg.heading;
    let main = seg.body.slice();
    let j = i + 1;
    // Headings split across two lines end with a comma ("The Spirit of …,").
    if (/,\s*$/.test(heading) && segments[j] && !isSubsection(segments[j].heading)) {
      heading = `${heading} ${segments[j].heading}`.replace(/,\s+/, ', ');
      main = main.concat(segments[j].body);
      j += 1;
    }
    const subs = {};
    while (j < segments.length && isSubsection(segments[j].heading)) {
      subs[segments[j].heading.toLowerCase().trim()] = segments[j].body;
      j += 1;
    }
    const consumedTo = j;
    const blob = `${main.join('\n')}\n${Object.values(subs).map((b) => b.join('\n')).join('\n')}`;
    const ok = /\bSTR\b\s*\n*\s*\d/.test(blob)        // has a stat line
      && subs.skills                                  // real profiles list skills
      && !/\bexample\b/i.test(heading)                // not a generic template
      && !NOT_A_NAME.test(heading.trim());            // not rules/example prose
    if (ok) profiles.push({ heading, main, subs });
    // Advance past everything this profile consumed so split headings/subsections
    // are not re-processed as their own profiles.
    i = consumedTo > i ? consumedTo : i + 1;
  }
  return profiles;
}

function statValue(words, key) {
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].replace(/:$/, '').toUpperCase() === key) {
      for (let k = i + 1; k <= i + 3 && k < words.length; k += 1) {
        const v = words[k].replace(/[^0-9-]/g, '');
        if (/^\d{1,3}$/.test(v)) return v;
        if (v === '-') return '';
      }
    }
  }
  return '';
}

function takeLabelled(mainLines, label) {
  for (let i = 0; i < mainLines.length; i += 1) {
    const line = cleanLine(mainLines[i]);
    const m = line.match(new RegExp(`^${label}s?:\\s*(.*)$`, 'i'));
    if (!m) continue;
    if (m[1].trim()) return m[1].trim().replace(/\.\s*$/, '');
    for (let k = i + 1; k < mainLines.length; k += 1) {
      const next = cleanLine(mainLines[k]);
      if (next) return next.replace(/\.\s*$/, '');
    }
  }
  return '';
}

// Subsection bodies often run on into narrative bullets, the Folly motto used
// as page chrome, or a trailing footnote digit. Keep only the real value.
function tidy(text) {
  let t = String(text || '');
  t = t.split(/(?:^|\s)-?\s*(?:Description|Allegiances|Traits|Roleplaying hooks):/i)[0];
  t = t.split(/SCIENTIA POTESTAS EST/i)[0];
  t = t.replace(/\s+\d{1,2}\s*$/, '');
  return t.replace(/\s+/g, ' ').trim().replace(/[.;,]\s*$/, '');
}

function parseSkillPairs(text) {
  const pairs = [];
  const re = /([A-Za-z][A-Za-z0-9 /()'’.\-]*?)\s+(\d{1,3})\s*%/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push({ name: m[1].replace(/\s+/g, ' ').trim(), value: m[2] });
  }
  return pairs;
}

function parseProfile(profile) {
  const { heading, main, subs } = profile;
  const commaIdx = heading.indexOf(',');
  const name = (commaIdx === -1 ? heading : heading.slice(0, commaIdx)).trim();
  let descriptor = commaIdx === -1 ? '' : heading.slice(commaIdx + 1).trim();

  let age = '';
  const ageM = descriptor.match(/age\s+(\d{1,3})/i);
  if (ageM) { age = ageM[1]; descriptor = descriptor.replace(/age\s+\d{1,3}\s*,?\s*/i, '').trim(); }

  const mainText = main.map(cleanLine).filter(Boolean).join(' ');
  const words = mainText.split(/\s+/);

  const str = statValue(words, 'STR');
  const con = statValue(words, 'CON');
  const dex = statValue(words, 'DEX');
  const int = statValue(words, 'INT');
  const pow = statValue(words, 'POW');
  const db = statValue(words, 'DB');
  const mov = statValue(words, 'MOV');
  const mp = statValue(words, 'MP');
  const luck = statValue(words, 'LUCK');

  const advantages = takeLabelled(main, 'Advantage');
  const disadvantages = takeLabelled(main, 'Disadvantage');

  const customFields = [];
  const addCustom = (key, value) => {
    const v = String(value || '').trim();
    if (v) customFields.push({ key, value: v });
  };
  if (db !== '') addCustom('Damage Bonus (DB)', db);

  // Inline equipment / power notes that live in the stat block.
  for (const ln of main.map(cleanLine).filter(Boolean)) {
    const eq = ln.match(/^((?:Wizard's )?(?:Staff|Sword)):\s*(.+)$/i);
    if (eq) addCustom(eq[1], eq[2]);
  }

  const common = [];
  const expert = [];
  const combat = [];
  for (const pair of parseSkillPairs((subs.skills || []).map(cleanLine).join(' '))) {
    if (COMMON_SKILL_NAMES.some((n) => n.toLowerCase() === pair.name.toLowerCase())) common.push(pair);
    else if (COMBAT_SKILL_NAMES.some((n) => n.toLowerCase() === pair.name.toLowerCase())) combat.push(pair);
    else expert.push(pair);
  }

  const languages = parseSkillPairs(tidy((subs.languages || []).map(cleanLine).join(' ')))
    .map((p) => ({ name: `Language: ${p.name}`, value: `${p.value}%` }));
  const langText = tidy((subs.languages || []).map(cleanLine).join(' '));
  if (langText && !languages.length) addCustom('Languages', langText);

  const magicSpells = [];
  const spellNotes = [];
  const spellText = tidy((subs.spells || []).map(cleanLine).join(' '));
  if (spellText) {
    const hasMarkers = /\([^)]*\)/.test(spellText);
    if (!hasMarkers && /\b(all|listed|chapter|up to|order)\b/i.test(spellText)) {
      spellNotes.push(spellText);                       // prose, not a spell list
    } else {
      for (let chunk of spellText.split(/[;,]/)) {
        chunk = chunk.trim();
        if (!chunk) continue;
        if (/^plus\b|^and\b|others?\s*pells|up to|listed|chapter/i.test(chunk)) { spellNotes.push(chunk); continue; }
        const sm = chunk.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (sm) magicSpells.push({ name: sm[1].trim(), order: sm[2].trim(), notes: '' });
        else magicSpells.push({ name: chunk.replace(/\.\s*$/, ''), order: '', notes: '' });
      }
    }
  }

  for (const key of ['signare', 'powers', 'demi-monde affinity', 'vestigia']) {
    const text = tidy((subs[key] || []).map(cleanLine).filter(Boolean).join(' '));
    if (text) addCustom(key.replace(/\b\w/g, (c) => c.toUpperCase()), text);
  }

  const backstoryBits = [];
  for (const ln of [...main, ...Object.values(subs).flat()].map(cleanLine)) {
    const b = ln.match(/^-?\s*(Description|Allegiances|Traits|Roleplaying hooks):\s*(.+)$/i);
    if (b) backstoryBits.push(`${b[1]}: ${b[2].replace(/\.\s*$/, '')}.`);
  }

  const isMagical = magicSpells.length > 0 || /magical/i.test(advantages)
    || expert.some((s) => /^magic$/i.test(s.name));

  const sheet = {
    name,
    pronouns: '',
    birthplace: '',
    residence: '',
    occupation: descriptor.replace(/\b\w/g, (c) => c.toUpperCase()),
    social_class: '',
    age,
    affluence: '',
    glitch: '',
    backstory: backstoryBits.join(' '),
    reputation: descriptor,
    portrait: '',
    str, con, dex, int, pow, siz: '',
    advantages,
    disadvantages,
    combat_skills: combat.length ? combat : [{ name: 'Fighting', value: '30' }, { name: 'Firearms', value: '30' }],
    common_skills: common,
    mandatory_skills: expert,
    additional_skills: languages,
    luck,
    damage: { hurt: false, bloodied: false, down: false, impaired: false },
    weapons: [],
    carry: '',
    magic_tradition: isMagical ? 'Newtonian' : '',
    magic_notes: spellNotes.join(' '),
    magic_spells: magicSpells,
    derived: { hp: '', san: pow || '', mp, build: '', move: mov },
    custom_fields: customFields
  };

  return {
    name,
    scope: 'global',
    role: descriptor,
    status: '',
    location: '',
    summary: `${name}${descriptor ? ` — ${descriptor}` : ''}.`,
    notes: 'Imported from the Rivers of London rulebook (Rogues’ Gallery / case Cast).',
    sheet
  };
}

function main() {
  if (!fs.existsSync(RULEBOOK)) {
    console.error(`Rulebook not found: ${RULEBOOK}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(RULEBOOK, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const segments = buildSegments(lines);
  const profiles = collectProfiles(segments);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seen = new Set();
  let written = 0;
  for (const profile of profiles) {
    const npc = parseProfile(profile);
    if (!npc.name || (!npc.sheet.str && !npc.sheet.pow)) continue;
    let slug = slugify(npc.name);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.json`), `${JSON.stringify(npc, null, 2)}\n`, 'utf8');
    written += 1;
    console.log(`  ${npc.name}  (STR ${npc.sheet.str || '-'}, ${npc.sheet.common_skills.length} common / ${npc.sheet.mandatory_skills.length} expert skills, ${npc.sheet.magic_spells.length} spells)`);
  }
  console.log(`\nWrote ${written} NPC sheet(s) to ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main();
