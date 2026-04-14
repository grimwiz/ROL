#!/usr/bin/env node
const fs = require('fs');
const { adventurePath, parseDomesticAdventure } = require('../src/domesticAdventure');

if (!fs.existsSync(adventurePath)) {
  console.error('Adventure file not found:', adventurePath);
  process.exit(1);
}

const markdown = fs.readFileSync(adventurePath, 'utf8');
const adventure = parseDomesticAdventure(markdown);

if (!adventure.startStep) {
  console.error('No start step could be identified.');
  process.exit(1);
}

const stepSet = new Set(adventure.steps.map((s) => s.step));
const visited = new Set();
const queue = [adventure.startStep];

while (queue.length > 0) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);
  const node = adventure.steps.find((s) => s.step === current);
  if (!node) continue;
  const next = [...node.actions.map((a) => a.target), ...node.tracebacks];
  for (const target of next) {
    if (stepSet.has(target) && !visited.has(target)) queue.push(target);
  }
}

const unreachable = adventure.steps
  .map((s) => s.step)
  .filter((step) => !visited.has(step))
  .sort((a, b) => a - b);

console.log(`Total parsed steps: ${adventure.totalSteps}`);
console.log(`Reachable from step ${adventure.startStep}: ${visited.size}`);
if (unreachable.length) {
  console.error(`Unreachable steps (${unreachable.length}): ${unreachable.join(', ')}`);
  process.exit(2);
}

if (adventure.totalSteps !== 111) {
  console.error(`Expected 111 steps, got ${adventure.totalSteps}`);
  process.exit(3);
}

console.log('All 111 adventure steps are reachable.');
