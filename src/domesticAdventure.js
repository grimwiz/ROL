const fs = require('fs');
const path = require('path');

const rulesRoot = path.join(__dirname, '..', 'Rivers_of_London');
const adventurePath = path.join(rulesRoot, 'The Domestic.md');
const imageBlacklistPath = path.join(rulesRoot, 'image-blacklist.txt');

function normalizeActionLabel(label, target) {
  const cleaned = String(label || '')
    .replace(/^[\s.,;:!?-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^go to$/i.test(cleaned)) return `Go to ${target}`;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function parseActions(text) {
  const actions = [];
  const seen = new Set();
  const regex = /([^\n.!?]*?)\bgo to\s+(\d+)\s*\./gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const target = parseInt(match[2], 10);
    if (!Number.isInteger(target)) continue;
    const dedupeKey = `${match.index}:${target}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    actions.push({
      target,
      label: normalizeActionLabel(match[1], target)
    });
  }

  return actions;
}

function parseTracebacks(text) {
  const traceMatches = text.matchAll(/\(([^()]+)\)\s*$/gm);
  const isTracebackList = (s) => /^\s*\d+(\s*,\s*\d+)*\s*$/.test(s);
  let lastMatch;
  for (const match of traceMatches) {
    if (!isTracebackList(match[1])) continue;
    lastMatch = match;
  }
  if (!lastMatch) return [];

  const values = lastMatch[1]
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((num) => Number.isInteger(num));

  return [...new Set(values)];
}

// Load a newline-delimited list of image paths/filenames to exclude from the
// rendered adventure. Blank lines and # comments are ignored. Each non-empty
// entry matches an image if it equals the src as written in markdown, or the
// src's basename.
function loadImageBlacklist() {
  if (!fs.existsSync(imageBlacklistPath)) return new Set();
  const contents = fs.readFileSync(imageBlacklistPath, 'utf8');
  const entries = contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  return new Set(entries);
}

function stripBlacklistedImages(text, blacklist) {
  if (!blacklist || blacklist.size === 0) return text;
  const filtered = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, src) => {
    const trimmed = src.trim();
    const basename = trimmed.split('/').pop();
    if (blacklist.has(trimmed) || blacklist.has(basename)) return '';
    return match;
  });
  // Collapse any blank-line runs left behind by removed images.
  return filtered.replace(/\n{3,}/g, '\n\n').trim();
}

function parseDomesticAdventure(markdown, options = {}) {
  const blacklist = options.imageBlacklist || new Set();
  const lines = markdown.split(/\r?\n/);
  const headerRegex = /^(?:##\s*)?(\d+)\s*$/;
  const starts = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const match = trimmed.match(headerRegex);
    if (match) {
      starts.push({ step: parseInt(match[1], 10), line: i });
    }
  }

  const steps = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
    const body = lines.slice(start.line + 1, end).join('\n').trim();

    const tracebacks = parseTracebacks(body);
    const description = stripBlacklistedImages(
      body
        .replace(/\n?##?\s*\(([^()]+)\)\s*$/m, '')
        .replace(/\n\s*\(([^()]+)\)\s*$/m, '')
        .trim(),
      blacklist
    );

    steps.push({
      step: start.step,
      description,
      actions: parseActions(description),
      tracebacks
    });
  }

  const stepMap = {};
  for (const entry of steps) stepMap[entry.step] = entry;

  return {
    title: 'The Domestic',
    sourcePath: '/rules-files/The%20Domestic.md',
    totalSteps: steps.length,
    startStep: stepMap[1] ? 1 : (steps[0] ? steps[0].step : null),
    steps
  };
}

function loadDomesticAdventure() {
  if (!fs.existsSync(adventurePath)) return null;
  const markdown = fs.readFileSync(adventurePath, 'utf8');
  const imageBlacklist = loadImageBlacklist();
  return parseDomesticAdventure(markdown, { imageBlacklist });
}

module.exports = {
  adventurePath,
  imageBlacklistPath,
  parseDomesticAdventure,
  loadDomesticAdventure,
  loadImageBlacklist
};
