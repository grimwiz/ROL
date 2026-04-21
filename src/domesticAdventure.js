const fs = require('fs');
const path = require('path');

const adventurePath = path.join(__dirname, '..', 'Rivers_of_London', 'The Domestic.md');

function normalizeActionLabel(label, target) {
  const cleaned = String(label || '')
    .replace(/^[\s.,;:\!?-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (\!cleaned || /^go to$/i.test(cleaned)) return `Go to ${target}`;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function parseActions(text) {
  const actions = [];
  const seen = new Set();
  const regex = /([^\n.\!?]*?)\bgo to\s+(\d+)\s*\./gi;
  let match;

  while ((match = regex.exec(text)) \!== null) {
    const target = parseInt(match[2], 10);
    if (\!Number.isInteger(target)) continue;
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
    if (\!isTracebackList(match[1])) continue;
    lastMatch = match;
  }
  if (\!lastMatch) return [];

  const values = lastMatch[1]
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((num) => Number.isInteger(num));

  return [...new Set(values)];
}

function parseDomesticAdventure(markdown) {
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
    const description = body
      .replace(/\n?##?\s*\(([^()]+)\)\s*$/m, '')
      .replace(/\n\s*\(([^()]+)\)\s*$/m, '')
      .trim();

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
  if (\!fs.existsSync(adventurePath)) return null;
  const markdown = fs.readFileSync(adventurePath, 'utf8');
  return parseDomesticAdventure(markdown);
}

module.exports = {
  adventurePath,
  parseDomesticAdventure,
  loadDomesticAdventure
};
