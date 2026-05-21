#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'private', 'rulebook-source', 'cha3200_-_rivers_of_london_1.4.md');
const OUT_DIR = path.join(ROOT, 'private', 'extracted-source');
const SECTIONS_DIR = path.join(OUT_DIR, 'sections');
const OUT_FILE = path.join(OUT_DIR, 'rulebook-relevant.md');
const MANIFEST_FILE = path.join(OUT_DIR, 'manifest.json');

const args = new Set(process.argv.slice(2));
const includeBookshop = args.has('--include-bookshop');
const keepImages = args.has('--keep-images');

const raw = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');

const sections = [
  {
    id: 'intro-core',
    title: 'Introduction, Dice, Setting Premise',
    destination: '00-system-overview.md and scenario/00-table-frame.md',
    start: '## Introduction',
    end: '## What Now?',
  },
  {
    id: 'intro-glossary',
    title: 'Glossary',
    destination: '00-system-overview.md and scenario/00-table-frame.md',
    start: '| Term                   | Definition',
    end: '## Start Here',
  },
  {
    id: 'character-creation',
    title: 'Chapter 1: Creating Characters',
    destination: '01-character-model.md and 03-character-creation.md',
    start: '## Creating   Characters',
    end: '## A Few Notes on Skills',
  },
  {
    id: 'skills',
    title: 'Chapter 2: Skills',
    destination: '04-skills.md',
    start: '## A Few Notes on Skills',
    end: '## The Basic Rules',
  },
  {
    id: 'core-rules',
    title: 'Chapter 3: Basic Rules, Combat, Damage, Chases',
    destination: '02-core-resolution.md, 05-advancement.md, 06-combat.md, 07-damage-and-healing.md, 08-chases.md',
    start: '## The Basic Rules',
    end: '## Vestigia',
  },
  {
    id: 'newtonian-magic',
    title: 'Chapter 4: Newtonian Magic',
    destination: '09-magic.md and 10-spells.md',
    start: '## Vestigia',
    end: '## WORKING TOGETHER FOR STRANGER LONDON',
  },
  {
    id: 'policing-and-gm-procedures',
    title: 'Chapter 5: Policing, Investigation, GM Procedures',
    destination: 'scenario/policing-and-investigations.md and scenario/gm-procedures.md',
    start: '## WORKING TOGETHER FOR STRANGER LONDON',
    end: "## A Rogues' Gallery",
  },
  {
    id: 'rogues-and-demi-monde',
    title: "Chapter 6: A Rogues' Gallery and Demi-Monde",
    destination: 'scenario/05-npcs-and-beings.md and 11-demi-monde.md',
    start: "## A Rogues' Gallery",
    end: '## Induction',
  },
  {
    id: 'folly-and-london',
    title: 'Chapter 7: Welcome to London',
    destination: 'scenario/folly-and-london.md, scenario/organisations.md, scenario/case-seeds.md',
    start: '## Induction',
    end: 'THIS INTRODUCTORY CASE',
  },
  {
    id: 'bookshop-optional',
    title: 'Chapter 8: The Bookshop',
    destination: 'scenario/bookshop-reference.md',
    start: 'THIS INTRODUCTORY CASE',
    end: '## Additional Rules',
    optional: true,
    include: includeBookshop,
  },
  {
    id: 'additional-rules',
    title: 'Chapter 9: Additional Rules',
    destination: '12-advanced-options.md and scenario/06-case-design.md',
    start: '## Additional Rules',
    end: '## Appendix A: Ready - to - Play Investigators',
  },
  {
    id: 'rules-summaries',
    title: 'Appendix B: Rules Summaries',
    destination: 'quick-reference.md',
    start: '## Appendix B: Rules Summaries',
    end: '## Appendix C: Bibliography',
  },
];

function indexOrThrow(marker, from = 0) {
  const index = raw.indexOf(marker, from);
  if (index === -1) {
    throw new Error(`Could not find marker: ${marker}`);
  }
  return index;
}

function lineNumberFor(index) {
  return raw.slice(0, index).split('\n').length;
}

function cleanSection(text) {
  let lines = text.split('\n');

  if (!keepImages) {
    lines = lines.filter((line) => !line.trim().startsWith('![Image]('));
  }

  lines = lines.filter((line) => {
    const trimmed = line.trim();
    if (/^\d{1,3}$/.test(trimmed)) return false;
    if (/^[A-Z]$/.test(trimmed)) return false;
    return true;
  });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSection(section) {
  const start = indexOrThrow(section.start);
  const end = indexOrThrow(section.end, start + section.start.length);
  const sourceText = raw.slice(start, end);
  return {
    id: section.id,
    title: section.title,
    destination: section.destination,
    optional: Boolean(section.optional),
    included: !section.optional || Boolean(section.include),
    startMarker: section.start,
    endMarker: section.end,
    startLine: lineNumberFor(start),
    endLine: lineNumberFor(end),
    text: cleanSection(sourceText),
  };
}

const extracted = sections.map(extractSection).filter((section) => section.included);

const generatedAt = new Date().toISOString();
const header = [
  '# Raw Relevant Rulebook Source',
  '',
  `Generated: ${generatedAt}`,
  '',
  'This file is an internal staging source for LLM-assisted distillation. It is not the final extracted rules corpus and is intentionally gitignored.',
  '',
  'The final corpus must be logically ordered, paraphrased, compact, and written into `Rivers_of_London/rules/` and `Rivers_of_London/rules/scenario/`.',
  '',
  includeBookshop
    ? 'Optional Chapter 8 scenario source is included because `--include-bookshop` was passed.'
    : 'Chapter 8 scenario source is excluded by default. Use `--include-bookshop` if a later pass needs it as scenario reference.',
  '',
].join('\n');

const body = extracted
  .map((section) => [
    `\n\n---\n\n# Source Section: ${section.title}`,
    '',
    `Source lines: ${section.startLine}-${section.endLine - 1}`,
    `Intended destination: ${section.destination}`,
    '',
    section.text,
  ].join('\n'))
  .join('\n');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SECTIONS_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${header}${body}\n`, 'utf8');

for (const section of extracted) {
  const sectionFile = path.join(SECTIONS_DIR, `${section.id}.md`);
  const sectionHeader = [
    `# Source Section: ${section.title}`,
    '',
    `Source lines: ${section.startLine}-${section.endLine - 1}`,
    `Intended destination: ${section.destination}`,
    '',
  ].join('\n');
  fs.writeFileSync(sectionFile, `${sectionHeader}${section.text}\n`, 'utf8');
}

const manifest = {
  generatedAt,
  source: path.relative(ROOT, SOURCE),
  output: path.relative(ROOT, OUT_FILE),
  includeBookshop,
  keepImages,
  sections: extracted.map(({ text, ...section }) => ({
    ...section,
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    file: path.relative(ROOT, path.join(SECTIONS_DIR, `${section.id}.md`)),
  })),
};

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
console.log(`Wrote ${path.relative(ROOT, MANIFEST_FILE)}`);
console.log(`Wrote ${extracted.length} section files to ${path.relative(ROOT, SECTIONS_DIR)}`);
