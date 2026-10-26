const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
const cookieParser = require('cookie-parser');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'folly-security-'));
process.env.DB_PATH = path.join(temp, 'test.db');
process.env.JWT_SECRET = 'isolated-security-regression-test-secret';
const db = require('../src/db');
const { signToken } = require('../src/auth');

test('authentication and authorization regressions over HTTP', async (t) => {
  const hash = bcrypt.hashSync('test-password', 4);
  const insert = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  const gmId = Number(insert.run('security-gm', hash, 'gm').lastInsertRowid);
  const playerId = Number(insert.run('security-player', hash, 'player').lastInsertRowid);
  const gm = db.prepare('SELECT * FROM users WHERE id = ?').get(gmId);
  const player = db.prepare('SELECT * FROM users WHERE id = ?').get(playerId);
  const gmToken = signToken(gm);
  const playerToken = signToken(player);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', require('../src/routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (route, token, body, method) => fetch(base + route, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `folly_token=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    await t.test('login issues a usable HttpOnly session cookie', async () => {
      const res = await request('/auth/login', null, { username: gm.username, password: 'test-password' });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('set-cookie'), /HttpOnly/);
      const cookie = res.headers.get('set-cookie').match(/folly_token=([^;]+)/)[1];
      assert.equal((await request('/auth/me', cookie)).status, 200);
    });
    await t.test('anonymous, tampered and legacy tokens are rejected', async () => {
      assert.equal((await request('/users')).status, 401);
      assert.equal((await request('/users', gmToken + 'tampered')).status, 401);
      const legacy = jwt.sign({ id: gmId, role: 'gm' }, process.env.JWT_SECRET);
      assert.equal((await request('/users', legacy)).status, 401);
      assert.equal((await request('/users', playerToken)).status, 403);
    });
    await t.test('demotion applies to existing sessions immediately', async () => {
      db.prepare("UPDATE users SET role = 'player' WHERE id = ?").run(gmId);
      assert.equal((await request('/users', gmToken)).status, 403);
      assert.equal((await (await request('/auth/me', gmToken)).json()).role, 'player');
      db.prepare("UPDATE users SET role = 'gm' WHERE id = ?").run(gmId);
    });
    await t.test('players cannot allocate their own sheet to arbitrary cases', async () => {
      const id = Number(db.prepare('INSERT INTO character_sheets (user_id, data) VALUES (?, ?)')
        .run(playerId, JSON.stringify({ name: 'Player character', scope: [] })).lastInsertRowid);
      const res = await request('/character-sheets', playerToken,
        { id, data: { name: 'Player character', scope: ['Unassigned case'] } }, 'PUT');
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM character_sheets WHERE id = ?').get(id).data).scope, []);
    });
    await t.test('a player cannot overwrite a case NPC by using its name', async () => {
      const caseName = 'Isolated security case';
      const sessionId = Number(db.prepare('INSERT INTO sessions (name) VALUES (?)').run(caseName).lastInsertRowid);
      db.prepare('INSERT INTO session_players (session_id, user_id) VALUES (?, ?)').run(sessionId, playerId);
      const original = JSON.stringify({ name: 'Protected NPC', scope: [caseName], secret: 'unchanged' });
      const npcId = Number(db.prepare('INSERT INTO character_sheets (data) VALUES (?)').run(original).lastInsertRowid);
      const res = await request('/character-sheets', playerToken,
        { session_id: sessionId, user_id: playerId, data: { name: 'Protected NPC' } }, 'PUT');
      assert.equal(res.status, 403);
      assert.equal(db.prepare('SELECT data FROM character_sheets WHERE id = ?').get(npcId).data, original);
    });
    await t.test('renamed cases still return player sheets and NPCs to the character panel', async () => {
      const originalName = 'Character linkage regression';
      const caseId = Number(db.prepare('INSERT INTO sessions (name) VALUES (?)').run(originalName).lastInsertRowid);
      db.prepare('INSERT INTO session_players (session_id, user_id) VALUES (?, ?)').run(caseId, playerId);
      const insertSheet = db.prepare('INSERT INTO character_sheets (user_id, data) VALUES (?, ?)');
      insertSheet.run(playerId, JSON.stringify({ name: 'Linked investigator', scope: [originalName], hp: 12 }));
      insertSheet.run(null, JSON.stringify({ name: 'Linked NPC', scope: [originalName] }));
      require('../src/sessionIdentity').updateSessionIdentity(db, caseId, 'Renamed linked case', null);
      const panel = await request(`/character-sheets?case_id=${caseId}`, gmToken);
      assert.equal(panel.status, 200);
      assert.deepEqual((await panel.json()).map((c) => c.name).sort(), ['Linked NPC', 'Linked investigator']);
      const sheet = await request(`/sessions/${caseId}/sheets/${playerId}`, playerToken);
      assert.equal(sheet.status, 200);
      const saved = (await sheet.json()).data;
      assert.equal(saved.name, 'Linked investigator');
      assert.equal(saved.hp, 12);
      assert.deepEqual(saved.scope, ['Renamed linked case']);
    });
    await t.test('password reset and deletion invalidate existing sessions', async () => {
      assert.equal((await request(`/users/${playerId}/password`, gmToken, { password: 'replacement-password' }, 'PUT')).status, 200);
      assert.equal((await request('/auth/me', playerToken)).status, 401);
      db.prepare('DELETE FROM users WHERE id = ?').run(playerId);
      assert.equal((await request('/auth/me', playerToken)).status, 401);
    });
    await t.test('invalid credential types and oversized bcrypt inputs return 400', async () => {
      for (const body of [ {}, { username: {}, password: 'p' }, { username: gm.username, password: {} },
        { username: gm.username, password: 'x'.repeat(73) }, { username: gm.username, password: '£'.repeat(37) } ]) {
        assert.equal((await request('/auth/login', null, body)).status, 400);
      }
      assert.equal((await request('/users', gmToken, { username: 'bad-user', password: {}, role: 'player' })).status, 400);
      assert.equal((await request(`/users/${gmId}/password`, gmToken, { password: [] }, 'PUT')).status, 400);
      assert.equal((await request('/auth/me', gmToken)).status, 200);
    });
    await t.test('account login throttling still returns Retry-After', async () => {
      for (let i = 0; i < 8; i++) {
        assert.equal((await request('/auth/login', null, { username: 'nonexistent-user', password: 'bad' })).status, 401);
      }
      const blocked = await request('/auth/login', null, { username: 'nonexistent-user', password: 'bad' });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
