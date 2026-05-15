#!/usr/bin/env node

// Write the current global NPC sheets from the database back out to
// Rivers_of_London/globaldata/npcs/*.json. Use this after correcting an NPC
// sheet in the web app so the fixed version becomes the canonical seed copy.
//
//   npm run npcs:export

const db = require('../src/db');
const { exportGlobalNpcs, NPC_DIR } = require('../src/npcSeed');

const written = exportGlobalNpcs(db);
console.log(`Wrote ${written} global NPC sheet(s) to ${NPC_DIR}`);
