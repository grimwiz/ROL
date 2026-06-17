// Auto-discovered catalogue of rule sets, organised as a tree: game → rule sets.
//
//   game-systems/<game>/<rules*>/NN-*.md
//
// A "game" is any directory under game-systems/. A "rule set" is any subdirectory
// of a game whose name starts with "rules" and contains at least one numbered
// rules file (NN-*.md). The Rules tab (global) shows the whole tree; a case's AI
// Support is later primed with one rule set. Labels are derived from the folder
// names — no manifest. See docs/ruleset-modules.md.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SYSTEMS_ROOT = path.join(REPO_ROOT, 'game-systems');

// Small connecting words stay lowercase mid-label; a few tokens have fixed caps.
const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'to', 'for']);
const FIXED_CASE = { gm: 'GM', npc: 'NPC', pc: 'PC' };

function prettify(kebab) {
  const words = String(kebab).split('-').filter(Boolean);
  return words.map((w, i) => {
    if (FIXED_CASE[w]) return FIXED_CASE[w];
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// Rule-set label = the folder name with its leading "rules" stripped; a bare
// "rules" folder is the system's Core rules.
function ruleSetLabel(dirName) {
  const rest = dirName.replace(/^rules-?/i, '');
  return rest ? prettify(rest) : 'Core';
}

function hasRuleDocs(dir) {
  try {
    return fs.readdirSync(dir).some((f) => /^\d{2}-.*\.md$/i.test(f));
  } catch {
    return false;
  }
}

function listDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// The tree: [{ key, label, ruleSets: [{ key, label, game, gameLabel, dir }] }].
// Only games with at least one loaded rule set are returned. Each rule set key is
// "<game>/<dir>" — stable and unique across games.
function games() {
  const out = [];
  for (const game of listDirs(SYSTEMS_ROOT)) {
    const gameDir = path.join(SYSTEMS_ROOT, game);
    const gameLabel = prettify(game);
    const ruleSets = listDirs(gameDir)
      .filter((name) => /^rules/i.test(name))
      .map((name) => ({
        key: `${game}/${name}`,
        label: ruleSetLabel(name),
        game,
        gameLabel,
        dir: path.join(gameDir, name)
      }))
      .filter((rs) => hasRuleDocs(rs.dir));
    if (ruleSets.length) out.push({ key: game, label: gameLabel, ruleSets });
  }
  return out;
}

// Flat list of every rule set across all games.
function list() {
  return games().flatMap((g) => g.ruleSets);
}

// Resolve a rule set by its "<game>/<dir>" key.
function get(key) {
  return list().find((rs) => rs.key === key) || null;
}

module.exports = { games, list, get };
