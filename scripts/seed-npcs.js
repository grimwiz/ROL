#!/usr/bin/env node

// Manually seed archived NPC sheets into the database and surface them in any
// cases named by their JSON `scope` values. The server also runs this
// automatically at startup; this script is for seeding without a restart.
//
//   npm run npcs:seed

const db = require('../src/db');
const { seedNpcArchives } = require('../src/npcSeed');

const result = seedNpcArchives(db);
console.log(`Done: ${result.seeded} NPC(s) added, ${result.allocated} case allocation(s) added, ${result.unresolved} unresolved scope value(s).`);
