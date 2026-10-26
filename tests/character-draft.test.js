const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CharacterDraft = require('../public/js/character-draft');

const draftText = 'Here is a proposed investigator.\n```character-sheet\n' + JSON.stringify({ name: 'New investigator', str: '60', common_skills: [{ name: 'Observation', value: '55' }], backstory: 'A London detective.' }) + '\n```';

test('draft extraction preserves sheet data and only accepts an explicit character-sheet block', () => {
  assert.equal(CharacterDraft.extract(draftText).common_skills[0].value, '55');
  assert.equal(CharacterDraft.extract('```json\n{"name":"ordinary example"}\n```'), null);
  assert.equal(CharacterDraft.extract('```character-sheet\n{"name":\n```'), null);
  assert.equal(CharacterDraft.extract('```character-sheet\n[]\n```'), null);
  assert.equal(CharacterDraft.extract(draftText + '\n```character-sheet\n{"name":"Revised investigator"}\n```').name, 'Revised investigator');
});

test('generated data cannot choose owners, scope, IDs, image URLs or prototype keys', () => {
  const input = JSON.parse('{"name":"Draft","scope":["wrong"],"owner":"gm","user_id":1,"id":2,"portrait":"https://example.com/image.svg","__proto__":{"polluted":true},"meta":{"constructor":{"prototype":{"polluted":true}}}}');
  const clean = CharacterDraft.normalise(input);
  for (const key of ['scope', 'owner', 'user_id', 'id', 'portrait', '__proto__']) assert.equal(Object.hasOwn(clean, key), false);
  assert.equal(Object.hasOwn(clean.meta, 'constructor'), false);
  assert.equal({}.polluted, undefined);
  assert.throws(() => CharacterDraft.normalise({ name: {} }), /name/);
  assert.throws(() => CharacterDraft.normalise({ name: 'Draft', notes: 'x'.repeat(100001) }), /large/);
});

test('the rules prompt requests the actual sheet shape and GM review without promising a save', () => {
  const instructions = CharacterDraft.instructions({ name: '', str: '', common_skills: [{ name: 'Observation', value: '30' }] });
  assert.match(instructions, /character-sheet/);
  assert.match(instructions, /common_skills/);
  assert.match(instructions, /creation budgets/);
  assert.match(instructions, /do not claim it has been saved or approved/);
  assert.equal(CharacterDraft.instructions(null), '');
});

test('blank RoL templates expose the real skill and spell fields without CoC derived stats', () => {
  const window = { Rulesets: { capability: () => ({ schema: { characteristics: () => ['str', 'con', 'dex', 'int', 'pow'] } }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/sheet.js'), 'utf8'), { window });
  const sheet = window.SheetForm.blank();
  assert.ok(sheet.common_skills.some((s) => s.name === 'Observation'));
  assert.equal(Object.hasOwn(sheet, 'siz'), false);
  assert.equal(Object.hasOwn(sheet.derived, 'hp'), false);
  assert.equal(sheet.magic_spells[0].order, '');
});

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
test('Rules streaming produces a reviewable draft only after a completed response', async () => {
  for (const complete of [true, false]) {
    const reply = { role: 'assistant', content: '' };
    const State = { currentSession: 5, user: { id: 7 }, rulesChat: { messages: [{ role: 'user', content: 'Generate an investigator' }, reply] } };
    let sent;
    const sandbox = {
      State, CharacterDraft, AbortController, TextDecoder,
      api: { getSheet: async () => ({ data: {}, ruleset: 'rol', rules_tier: 'advanced' }) },
      SheetForm: { setRuleset: () => {}, setRulesTier: () => {}, blank: () => ({ name: '', str: '' }) },
      setRulesChatStreaming: () => {}, renderRulesChatLog: () => {}, llmPendingBegin: () => {}, llmPendingEnd: () => {},
      fetch: async (_url, options) => {
        sent = JSON.parse(options.body);
        return new Response(JSON.stringify({ delta: draftText }) + '\n' + (complete ? '{"done":true}\n' : ''));
      }
    };
    const start = app.indexOf('async function runRulesStream('), end = app.indexOf('function stopRulesChat()', start);
    sandbox.reply = reply;
    await vm.runInNewContext(app.slice(start, end) + '\nrunRulesStream(reply)', sandbox);
    assert.equal(sent.sessionId, 5);
    assert.equal(sent.characterTemplate.str, '');
    assert.equal(reply.sessionId, 5);
    assert.equal(reply.draft && reply.draft.name, complete ? 'New investigator' : null);
  }
});

test('the chat offers review for this case and keeps the import JSON out of the rendered reply', () => {
  const message = { role: 'assistant', content: draftText, draft: CharacterDraft.extract(draftText), sessionId: 5 };
  const sandbox = { State: { currentSession: 5, rulesChat: { messages: [message] } }, esc: String, renderAiMarkdown: String };
  const start = app.indexOf('function rulesChatLogHtml()'), end = app.indexOf('function renderRulesChatLog()', start);
  const source = app.slice(start, end) + '\nrulesChatLogHtml()';
  const html = vm.runInNewContext(source, sandbox);
  assert.match(html, /Review character/);
  assert.doesNotMatch(html, /common_skills/);
  sandbox.State.currentSession = 6;
  assert.doesNotMatch(vm.runInNewContext(source, sandbox), /Review character/);
});

test('review fills the normal sheet and only saves the edited draft after an explicit click', async () => {
  const message = { draft: CharacterDraft.extract(draftText), sessionId: 5, sheetSettings: { ruleset: 'rol', rulesTier: 'advanced' } };
  const State = { currentSession: 5, user: { id: 7, username: 'Player', role: 'player' }, rulesChat: { messages: [message] } };
  let populated, saved, switched, removed = false;
  const save = { disabled: false }, cancel = {}, sheet = {};
  const modalRoot = { querySelector: (selector) => ({ '.modal': { style: {} }, '#character-draft-sheet': sheet, '#character-draft-player': { value: '7' }, '#character-draft-cancel': cancel, '#character-draft-save': save }[selector] || null), remove: () => { removed = true; } };
  const alerts = [];
  const sandbox = {
    State, CharacterDraft, window: {}, esc: String,
    api: { getSheet: async () => ({ data: {} }), createSheetDraft: async (...args) => { saved = args; } },
    SheetForm: { setRuleset: () => {}, setRulesTier: () => {}, setGmEditor: () => {}, setSessionId: () => {}, setPortraitAi: () => {}, render: (_host, data) => { populated = data; }, collect: () => ({ name: 'Edited investigator', str: '65' }) },
    modal: (_html, onMount) => onMount(modalRoot),
    renderRulesChatLog: () => {}, showAlert: (text) => alerts.push(text),
    switchSessionPanel: async (...args) => { switched = args; }
  };
  const start = app.indexOf('async function reviewRulesCharacter('), end = app.indexOf('function rulesChatLogHtml()', start);
  await vm.runInNewContext(app.slice(start, end) + '\nreviewRulesCharacter(0)', sandbox);
  assert.equal(populated.name, 'New investigator');
  assert.equal(saved, undefined);
  State.currentSession = 6;
  await save.onclick({ currentTarget: save });
  assert.equal(saved, undefined);
  assert.match(alerts[0], /original case/);
  State.currentSession = 5;
  await save.onclick({ currentTarget: save });
  assert.equal(saved[0], 5);
  assert.equal(saved[1], 7);
  assert.equal(saved[2].name, 'Edited investigator');
  assert.equal(saved[2].str, '65');
  assert.deepEqual(switched, [5, 'characters']);
  assert.equal(removed, true);
  assert.equal(message.draft, null);
});
