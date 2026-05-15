#!/usr/bin/env node

// Manually seed global NPC sheets from Rivers_of_London/globaldata/npcs/ into
// the database. The server also runs this automatically at startup; this script
// is for seeding without a restart.
//
//   npm run npcs:seed

const db = require('../src/db');
const { seedGlobalNpcs } = require('../src/npcSeed');

const added = seedGlobalNpcs(db);
console.log(added ? `Done: ${added} NPC(s) added.` : 'Nothing to seed — all global NPCs already present.');
