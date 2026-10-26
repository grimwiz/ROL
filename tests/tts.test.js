const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTts } = require('../src/tts');

function fixture(fetchImpl, initial = {}) {
  let saved = initial;
  return createTts({ readConfig: () => ({ ...saved }), writeConfig: (value) => { saved = value; }, fetchImpl });
}

test('TTS filters both catalogue formats using original IDs and names, without relabelling', async () => {
  for (const payload of [{ voices: [
    { id: 'storyteller', name: 'Storyteller' }, { id: 'cat', name: 'cat' },
    { id: 'gary_oldman', name: 'gary_oldman' }, { id: 'garyoldman', name: 'Gary Oldman' },
    { id: 'creech-ish', name: 'Creechish' }, { id: 'voice.with.dots' }, { id: '../bad' }
  ] }, ['storyteller', 'cat', 'gary_oldman', 'gary oldman', 'creech-ish', 'voice.with.dots']]) {
    const tts = fixture(async () => Response.json(payload));
    const voices = await tts.voices();
    assert.deepEqual(voices.map(v => v.id), ['storyteller', 'cat']);
    for (const voice of voices) {
      assert.match(voice.id, /^[\p{L}\p{N}]+$/u);
      assert.match(voice.name, /^[\p{L}\p{N}]+$/u);
    }
  }
});

test('TTS validates saved endpoints and voice IDs without partial configuration changes', () => {
  assert.equal(fixture(undefined, { tts_voice: 'gary_oldman' }).config().voice, 'default');
  const tts = fixture();
  tts.save({ url: 'http://tts37.dragon-net.local:8082/v1/', voice: 'storyteller', mode: 'auto' });
  assert.equal(tts.config().url, 'http://tts37.dragon-net.local:8082');
  assert.equal(tts.config().voice, 'storyteller');
  for (const patch of [{ voice: '../secrets' }, { voice: 'gary_oldman' }, { voice: 'gary oldman' }, { voice: 'creech-ish' }, { url: 'file:///etc/passwd' }, { url: 'http://user:secret@example.org' }, { mode: 'unknown' }, { url: {} }]) {
    const before = tts.config();
    assert.throws(() => tts.save(patch), e => e.statusCode === 400);
    assert.deepEqual(tts.config(), before);
  }
});

test('the Admin picker does not reinsert an excluded saved voice or relabel excluded catalogue entries', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const start = source.indexOf('async function renderAdminLlm()'), end = source.indexOf('async function saveAdminComfyModels(', start);
  const host = {};
  const sandbox = { el: () => host, esc: String, api: {
    getLlmModels: async () => ({ models: [], context: {} }),
    getLlmServices: async () => ({ ollama: {}, comfyui: {}, whisperx: {} }),
    getComfyModels: async () => ({ models: [], image: {}, edit: {} }),
    getTtsSettings: async () => ({ voice: 'gary_oldman', voices: [
      { id: 'default', name: 'default' }, { id: 'storyteller', name: 'storyteller' },
      { id: 'gary_oldman', name: 'gary oldman' }, { id: 'garyoldman', name: 'Gary Oldman' }
    ] })
  } };
  await vm.runInNewContext(source.slice(start, end) + '\nrenderAdminLlm()', sandbox);
  const options = host.innerHTML.match(/<select id="tts-voice">([\s\S]*?)<\/select>/)[1];
  assert.match(options, /value="storyteller"/);
  assert.match(options, /value="default" selected/);
  assert.doesNotMatch(options, /gary|oldman/i);
});

test('TTS posts bounded plain text with the configured voice and accepts only audio', async () => {
  let requested;
  const tts = fixture(async (url, options) => {
    requested = { url, ...JSON.parse(options.body) };
    return new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  tts.save({ url: 'http://tts37:8082', voice: 'storyteller' });
  const result = await tts.speech('A case briefing.', 1);
  assert.equal(result.type, 'audio/mpeg');
  assert.equal(result.audio.toString(), 'ID3');
  assert.deepEqual(requested, { url: 'http://tts37:8082/v1/audio/speech', model: 'chatterbox', voice: 'storyteller', input: 'A case briefing.', response_format: 'mp3' });
  for (const text of ['', {}, 'x'.repeat(1001)]) await assert.rejects(tts.speech(text, 1), e => e.statusCode === 400);
  tts.save({ mode: 'browser' });
  await assert.rejects(tts.speech('Hello', 1), e => e.statusCode === 503);
  const invalidAudio = fixture(async () => Response.json({ error: 'not audio' }));
  await assert.rejects(invalidAudio.speech('Hello', 1), /did not return audio/);
});

test('TTS allows only one generation per user and releases the slot after failure', async () => {
  let finish;
  const tts = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = tts.speech('Hello', 1);
  await assert.rejects(tts.speech('Another', 1), e => e.statusCode === 429);
  finish(new Response('error', { status: 500 }));
  await assert.rejects(pending, /could not prepare/);
  const next = tts.speech('Try again', 1);
  finish(new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }));
  await next;
});
