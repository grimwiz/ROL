const assert = require('node:assert/strict');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { updateSessionIdentity } = require('../src/sessionIdentity');

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE sessions (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
    CREATE TABLE character_sheets (id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT, updated_at TEXT);
    INSERT INTO sessions VALUES (1, 'The Lads, 25 April 2026', 'Existing case'), (2, 'The Bookshop', NULL);
  `);
  const insert = db.prepare("INSERT INTO character_sheets VALUES (?, ?, ?, '2026-04-25 15:44:31')");
  insert.run(1, 2, JSON.stringify({ name: 'Andrew Blackwood', hp: 12, scope: ['The Lads, 25 April 2026'] }));
  insert.run(2, null, JSON.stringify({ name: 'Nightingale', notes: 'GM notes', scope: ['The Bookshop', ' the lads, 25 April 2026 ', 'Babel Deferral'] }));
  insert.run(3, 5, JSON.stringify({ name: 'Unrelated investigator', scope: ['Other case'] }));
  insert.run(4, null, '{malformed legacy JSON');
  return db;
}

test('renaming a case preserves player and NPC links, other scopes and all sheet fields', (t) => {
  const db = fixture(t);
  const before = db.prepare('SELECT * FROM character_sheets').all();
  const result = updateSessionIdentity(db, 1, 'Babel Deferral', 'Renamed case');
  assert.equal(result.relinked, 2);
  assert.deepEqual(db.prepare('SELECT * FROM sessions WHERE id = 1').get(), { id: 1, name: 'Babel Deferral', description: 'Renamed case' });
  const after = db.prepare('SELECT * FROM character_sheets').all();
  assert.deepEqual(JSON.parse(after[0].data).scope, ['Babel Deferral']);
  assert.deepEqual(JSON.parse(after[1].data).scope, ['The Bookshop', 'Babel Deferral']);
  for (let i = 0; i < 2; i++) {
    const oldSheet = JSON.parse(before[i].data), newSheet = JSON.parse(after[i].data);
    delete oldSheet.scope; delete newSheet.scope;
    assert.deepEqual(newSheet, oldSheet);
    assert.equal(after[i].user_id, before[i].user_id);
    assert.equal(after[i].updated_at, before[i].updated_at);
  }
  assert.deepEqual(after.slice(2), before.slice(2));
});

test('description edits leave sheet data byte-for-byte unchanged', (t) => {
  const db = fixture(t);
  const before = db.prepare('SELECT * FROM character_sheets').all();
  assert.equal(updateSessionIdentity(db, 1, 'The Lads, 25 April 2026', 'Updated notes').relinked, 0);
  assert.deepEqual(db.prepare('SELECT * FROM character_sheets').all(), before);
});

test('a failed sheet update rolls back the case name and every changed sheet', (t) => {
  const db = fixture(t);
  const sessions = db.prepare('SELECT * FROM sessions').all();
  const sheets = db.prepare('SELECT * FROM character_sheets').all();
  db.exec("CREATE TRIGGER fail_relink BEFORE UPDATE ON character_sheets WHEN OLD.id = 2 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
  assert.throws(() => updateSessionIdentity(db, 1, 'Babel Deferral', 'Changed'), /simulated write failure/);
  assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), sessions);
  assert.deepEqual(db.prepare('SELECT * FROM character_sheets').all(), sheets);
});

test('renaming onto an existing case is rejected without merging characters', (t) => {
  const db = fixture(t);
  const before = db.prepare('SELECT * FROM character_sheets').all();
  assert.throws(() => updateSessionIdentity(db, 1, ' the   BOOKSHOP ', null), (e) => e.statusCode === 409);
  assert.equal(db.prepare('SELECT name FROM sessions WHERE id = 1').get().name, 'The Lads, 25 April 2026');
  assert.deepEqual(db.prepare('SELECT * FROM character_sheets').all(), before);
});

test('a missing case makes no changes', (t) => {
  const db = fixture(t);
  const before = db.prepare('SELECT * FROM character_sheets').all();
  assert.equal(updateSessionIdentity(db, 999, 'New case', null), null);
  assert.deepEqual(db.prepare('SELECT * FROM character_sheets').all(), before);
});
