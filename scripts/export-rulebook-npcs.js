#!/usr/bin/env node

// Write the current NPC sheets from the database back out to their archive JSON
// files, including their case-relevance `scope` values. Use this after
// correcting an NPC sheet in the web app so the fixed version becomes the
// canonical seed copy.
//
//   npm run npcs:export

const db = require('../src/db');
const { exportGlobalNpcs, NPC_DIR } = require('../src/npcSeed');

const written = exportGlobalNpcs(db);
console.log(`Wrote ${written} NPC sheet(s) to ${NPC_DIR}`);
