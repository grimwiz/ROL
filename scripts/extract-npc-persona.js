#!/usr/bin/env node

// NPC persona extraction — implements game-systems/rivers-of-london/rules/tracking/
// npc-persona-extraction-method.md. Gathers name/keyword windows from the
// PRIVATE novels in private/Books/, sends ONLY those windows to the LOCAL Ollama
// (never a cloud model, never a web route), and writes an original-paraphrase
// persona draft to globaldata/npcs/personas/<slug>.md for GM review.
//
// The raw book windows are never printed to stdout — only status + the (safe,
// paraphrased) persona length. Drafts are marked `reviewed: { by: pending }`.
//
//   node scripts/extract-npc-persona.js --slug molly --name "Molly" --aliases "Molly"
//   node scripts/extract-npc-persona.js --batch                 # all NPCs missing a persona

const fs = require('fs');
const path = require('path');
const { effectiveOllamaUrl, effectiveOllamaModel } = require('../src/scenarioInfo');

const REPO = path.join(__dirname, '..');
const BOOKS_DIR = path.join(REPO, 'private', 'Books');
const PERSONA_DIR = path.join(REPO, 'game-systems', 'rivers-of-london', 'globaldata', 'npcs', 'personas');
const NPC_DIR = path.join(REPO, 'game-systems', 'rivers-of-london', 'globaldata', 'npcs');

const CONTEXT_BEFORE = 2, CONTEXT_AFTER = 6;   // lines of surround per hit
const MAX_WINDOW_CHARS = 36000;                 // cap gathered text so it stays focused + in-context

const SCHEMA = `---
name: <Full Name>
slug: <kebab-name>
aliases: [<short names>]
player_safe: true
source: original paraphrase from RoL novels (private); no quoted text
reviewed: { by: pending, date: <YYYY-MM-DD> }
---

# <Full Name> — Persona

<one-line framing in our own words>

## Voice & register
## Demeanour
## Life & circumstances
## Background & heritage
## People they know
## Their London / the demi-monde
## What they know about magic
## Standing values & goals
## Manner of speech (our words, for flavour)
## Boundaries`;

const INSTRUCTION = `You are helping build an in-character persona note for a fictional character from a novel series, for use by a separate role-play chatbot. You will be given excerpts mentioning the character. Produce a persona note in the exact Markdown schema below.

Goal: capture what this character would plausibly KNOW and TALK ABOUT — the world as they live it. A player should be able to ask them where they live, who they know, what their life is like, and what they understand about magic and the hidden world, and get an answer that fits the character.

Strict rules:
- Write ONLY original paraphrase in your own words. Never copy or lightly reword any sentence from the excerpts. No quotations.
- Include ONLY series-stable facts: personality, circumstances, relationships, standing knowledge true across the series.
- EXCLUDE all plot: events, deaths, twists, reveals, romance, case outcomes, anything tied to one specific scene.
- Pitch "What they know about magic" to the character's actual competence shown in the excerpts — a beginner is not an expert.
- If the excerpts don't support a section, write *(not established)* rather than inventing.
- Output ONLY the filled schema, nothing else.`;

function args() {
  const a = process.argv.slice(2); const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--batch') o.batch = true;
    else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i];
  }
  return o;
}

// Gather surrounding windows for the name/aliases across every book. Returns the
// text + which books matched. Never logged.
function gather(aliases) {
  const out = []; const books = [];
  const rx = new RegExp('\\b(' + aliases.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
  for (const file of fs.readdirSync(BOOKS_DIR).filter((f) => f.toLowerCase().endsWith('.md')).sort()) {
    const lines = fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8').split(/\r?\n/);
    let hit = false; let lastEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      hit = true;
      const a = Math.max(lastEnd + 1, i - CONTEXT_BEFORE), b = Math.min(lines.length - 1, i + CONTEXT_AFTER);
      if (a > lastEnd) { out.push(lines.slice(a, b + 1).join('\n')); lastEnd = b; }
    }
    if (hit) books.push(file.replace(/^Rivers of London (\d+).*/, '$1'));
  }
  let text = out.join('\n…\n');
  if (text.length > MAX_WINDOW_CHARS) text = text.slice(0, MAX_WINDOW_CHARS);
  return { text, books: [...new Set(books)] };
}

async function draft(name, slug, aliases, playerSafe) {
  const { text, books } = gather(aliases);
  if (!text.trim()) { console.log(`  ${slug}: NO windows found — skipped`); return false; }
  const prompt = `${INSTRUCTION}\n\nSchema:\n${SCHEMA}\n\nCharacter: ${name}\n\nExcerpts (paraphrase only, never quote):\n${text}`;
  let res;
  try {
    res = await fetch(`${effectiveOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: effectiveOllamaModel(), prompt, stream: false, options: { num_ctx: 32768, temperature: 0.4 } }),
      signal: AbortSignal.timeout(900000)
    });
  } catch (e) { console.log(`  ${slug}: Ollama unreachable — ${e.message}`); return false; }
  if (!res.ok) { console.log(`  ${slug}: Ollama HTTP ${res.status}`); return false; }
  const j = await res.json();
  let body = String(j.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!body) { console.log(`  ${slug}: empty draft`); return false; }
  // Normalise the frontmatter to our provenance + pending review (the model fills the body).
  const date = new Date().toISOString().slice(0, 10);
  const fm = `---\nname: ${name}\nslug: ${slug}\naliases: [${aliases.join(', ')}]\nplayer_safe: ${playerSafe}\nsource: original paraphrase from RoL novels ${books.join('–') || '01–05'} (private); no quoted text\nreviewed: { by: pending, date: ${date} }\n---\n`;
  body = body.replace(/^---[\s\S]*?---\s*/, '');   // drop any frontmatter the model emitted
  fs.mkdirSync(PERSONA_DIR, { recursive: true });
  fs.writeFileSync(path.join(PERSONA_DIR, `${slug}.md`), fm + '\n' + body + '\n', 'utf8');
  console.log(`  ${slug}: drafted from books ${books.join(',') || '?'} (${body.length} chars) — REVIEW REQUIRED`);
  return true;
}

// NPCs missing a persona, with the aliases to gather on. Edit as needed.
const NPCS = [
  ['dc-peter-grant', 'DC Peter Grant', ['Peter Grant', 'Peter', 'Grant'], true],
  ['molly', 'Molly', ['Molly'], true],
  ['ds-sahra-guleed', 'DS Sahra Guleed', ['Sahra Guleed', 'Guleed', 'Sahra'], true],
  ['harold-postmartin', 'Harold Postmartin', ['Postmartin'], true],
  ['dr-abdul-haqq-walid', 'Dr Abdul Haqq Walid', ['Abdul Haqq Walid', 'Walid', 'Abdul'], true],
  ['dr-jennifer-vaughan', 'Dr Jennifer Vaughan', ['Jennifer Vaughan', 'Dr Vaughan', 'Vaughan'], true],
  ['special-agent-kimberley-reynolds', 'Special Agent Kimberley Reynolds', ['Kimberley Reynolds', 'Reynolds', 'Kimberley'], true],
  ['di-miriam-stephanopoulos', 'DI Miriam Stephanopoulos', ['Stephanopoulos', 'Miriam'], true],
  ['frank-caffrey', 'Frank Caffrey', ['Frank Caffrey', 'Caffrey'], true],
  ['toby', 'Toby', ['Toby'], true],
  ['varvara-sidorovna-tamonina', 'Varvara Sidorovna Tamonina', ['Varvara', 'Tamonina'], true],
  ['beverley-brook', 'Beverley Brook', ['Beverley Brook', 'Beverley', 'Bev'], true],
  ['mama-thames', 'Mama Thames', ['Mama Thames'], true],
  ['father-thames', 'Father Thames', ['Father Thames', 'Old Man of the River'], true],
  ['lady-cecelia-tyburn-thames', 'Lady Cecelia Tyburn Thames', ['Tyburn', 'Lady Ty', 'Cecelia'], true],
  ['foxglove', 'Foxglove', ['Foxglove'], true],
];

(async () => {
  const o = args();
  if (o.batch) {
    let n = 0;
    for (const [slug, name, aliases, ps] of NPCS) {
      if (fs.existsSync(path.join(PERSONA_DIR, `${slug}.md`)) && !o.force) { console.log(`  ${slug}: exists — skip`); continue; }
      if (await draft(name, slug, aliases, ps)) n++;
    }
    console.log(`Drafted ${n} persona(s). All need GM review before reviewed: is set.`);
  } else if (o.slug && o.name) {
    await draft(o.name, o.slug, (o.aliases || o.name).split(',').map((s) => s.trim()), o['player-safe'] !== 'false');
  } else {
    console.log('usage: --batch  |  --slug <s> --name <n> [--aliases a,b] [--player-safe false] [--force]');
  }
})();
