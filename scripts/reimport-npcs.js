#!/usr/bin/env node

// Re-import the archived NPC sheets into the database, OVERWRITING existing
// sheet data (matched by name) with the JSON archive copy. This is the inverse
// of `npcs:export` and the force-counterpart of `npcs:seed` (which only ADDS
// missing NPCs and never overwrites). Use it to push archive changes — e.g.
// regenerated portraits — onto a database whose NPCs already exist. Case
// allocations (scope) already in the DB are preserved (merged with the archive).
//
//   npm run npcs:reimport

const db = require('../src/db');
const { reimportGlobalNpcs } = require('../src/npcSeed');

const r = reimportGlobalNpcs(db);
console.log(`Re-imported NPC sheets: ${r.updated} overwritten, ${r.inserted} inserted.`);
