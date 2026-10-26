const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { createPlayerChat } = require('../src/playerChat');

const source = fs.readFileSync(path.join(__dirname, '../src/scenarioInfo.js'), 'utf8');
function harness(paths, personality) {
  const context = {
    createPlayerChat, ensureSessionDataFolders: () => paths,
    findSessionPersonaByName: () => ({ body: personality }),
    getViewerSubjects: (user) => [user.character],
  };
  const helpers = source.slice(source.indexOf('function normaliseName('), source.indexOf('function readJsonFile('));
  const restricted = source.slice(source.indexOf('const RESTRICTED_KEYS ='), source.indexOf(']);', source.indexOf('const RESTRICTED_KEYS =')) + 3);
  const factory = source.slice(source.indexOf('const playerChat = createPlayerChat('), source.indexOf('function getNpcCaseKnowledge('));
  vm.runInNewContext(restricted + '\n' + helpers + '\n' + factory + '\nthis.chat=playerChat;', context);
  return context.chat;
}

test('case player characters use their saved Character Story and respect existing story visibility', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'folly-player-chat-'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER, username TEXT, role TEXT);
    CREATE TABLE character_sheets (id INTEGER, user_id INTEGER, data TEXT);
    CREATE TABLE session_players (session_id INTEGER, user_id INTEGER);
    INSERT INTO users VALUES (1,'alice','player'),(2,'bob','player'),(3,'outsider','player');
    INSERT INTO session_players VALUES (7,1),(7,2);`);
  const insert = db.prepare('INSERT INTO character_sheets VALUES (?,?,?)');
  insert.run(11, 1, JSON.stringify({ name: 'Alice Character', scope: ['Case A'], backstory: 'PRIVATE-BACKSTORY', portrait: 'data:image/png;base64,AA==' }));
  insert.run(12, 2, JSON.stringify({ name: 'Bob Character', scope: ['Case A'] }));
  insert.run(13, 1, JSON.stringify({ name: 'Other case character', scope: ['Case B'] }));
  insert.run(14, 3, JSON.stringify({ name: 'Unassigned character', scope: ['Case A'] }));
  const artifactPath = path.join(temp, 'scenario-info.json');
  const write = (content, access = ['Alice Character']) => fs.writeFileSync(artifactPath, JSON.stringify({
    entities: { characters: [{ id: 'char-alice-character', name: 'Alice Character', known_by: access, content },
      { name: 'Someone else', known_by: ['all'], content: 'UNRELATED-STORY' }] },
    gm_analysis: { content: 'GM-SECRET' }
  }));
  try {
    write('FULL-SESSION-STORY');
    const chat = harness({ scenarioInfo: artifactPath }, 'PRIVATE-PERSONALITY');
    const session = { id: 7, name: 'Case A' };
    const roster = chat.list(session, db);
    assert.deepEqual(roster.map(p => p.slug), ['pc:11', 'pc:12']);
    assert.equal(roster[0].kind, 'player');
    assert.equal(chat.resolve(session, 'pc:13', { role: 'gm' }, db), null);
    for (const user of [{ id: 99, role: 'gm' }, { id: 1, role: 'player', character: 'Alice Character' }]) {
      const persona = chat.resolve(session, 'pc:11', user, db);
      assert.equal(persona.knowledge, 'FULL-SESSION-STORY');
      assert.match(persona.body, /PRIVATE-PERSONALITY/);
      assert.match(persona.characterSheet, /PRIVATE-BACKSTORY/);
      assert.doesNotMatch(persona.characterSheet, /portrait|scope/);
      assert.doesNotMatch(persona.knowledge, /UNRELATED-STORY|GM-SECRET/);
    }
    const peer = { id: 2, role: 'player', character: 'Bob Character' };
    const privatePersona = chat.resolve(session, 'pc:11', peer, db);
    assert.equal(privatePersona.knowledge, '');
    assert.doesNotMatch(JSON.stringify(privatePersona), /PRIVATE-PERSONALITY|PRIVATE-BACKSTORY/);
    write('SHARED-STORY', ['all']);
    assert.equal(chat.resolve(session, 'pc:11', peer, db).knowledge, 'SHARED-STORY');
    write('UPDATED-SESSION-STORY');
    assert.equal(chat.resolve(session, 'pc:11', { id: 1, role: 'player' }, db).knowledge, 'UPDATED-SESSION-STORY');
    fs.unlinkSync(artifactPath);
    const empty = chat.resolve(session, 'pc:11', { id: 1, role: 'player' }, db);
    assert.equal(empty.knowledge, '');
    assert.match(empty.body, /Do not invent past events/);
  } finally { db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('player chat sends the complete story and sheet to the model and preserves speaker attribution', async () => {
  let request;
  const context = { callOllama: async (_prompt, options) => { request = options; } };
  const start = source.indexOf('function sanitiseNpcChatMessages(');
  const end = source.indexOf('// Writes the GM chat', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.run=streamNpcChat;', context);
  const knowledge = 'SESSION-STORY\n' + 'The character remembers the case.\n'.repeat(1500);
  await context.run({ name: 'Alice Character', slug: 'pc:11', body: 'PLAYER-PERSONALITY', characterSheet: '{"occupation":"Detective"}', knowledge }, [
    { role: 'user', content: 'What did we find?' },
    { role: 'assistant', speaker: 'Nightingale', content: 'OTHER-CHARACTER-LINE' },
    { role: 'user', content: 'What do you recall?' }
  ]);
  assert.ok(request.messages[0].content.includes(knowledge.trim()));
  assert.match(request.messages[0].content, /PLAYER-PERSONALITY|Detective/);
  assert.match(request.messages[1].content, /Nightingale: OTHER-CHARACTER-LINE/);
  assert.equal(request.messages.length, 2);
});

test('chat picker separates case player characters from NPCs', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const host = {};
  const context = { State: { user: { role: 'gm' }, npcPersonasCache: {}, npcChat: { sessionId: 7 } },
    el: () => host, chatMicBtnHtml: () => '', api: { getNpcPersonas: async () => ({ npcs: [
      { slug: 'nightingale', name: 'Nightingale', kind: 'npc', allocated: true },
      { slug: 'pc:11', name: 'Alice Character', kind: 'player', allocated: true }
    ] }) }, esc: String, aiSupportToggleHtml: () => '', aiConfigButtonsHtml: () => '',
    renderNpcChatLog: () => {}, setNpcChatStreaming: () => {}, wireChatMic: () => {}, warmAiResolve: () => {} };
  const start = app.indexOf('async function renderSessionNpcChat('), end = app.indexOf('function npcChatLogHtml()', start);
  await vm.runInNewContext(app.slice(start, end) + '\nrenderSessionNpcChat(7)', context);
  assert.match(host.innerHTML, /optgroup label="Player characters"/);
  assert.match(host.innerHTML, /value="pc:11"/);
  assert.match(host.innerHTML, /NPCs in this case/);
  assert.match(host.innerHTML, /AI portrayal/);
});
