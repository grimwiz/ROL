const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTts } = require('../src/tts');

function fixture(fetchImpl) {
  let saved = {};
  return createTts({ readConfig: () => ({ ...saved }), writeConfig: (value) => { saved = value; }, fetchImpl });
}

test('TTS enumerates both voice formats with punctuation-free labels and preserves exact IDs', async () => {
  for (const payload of [{ voices: [{ id: 'bill_nighy', name: 'Bill_Nighy' }, { id: 'creech-ish', name: 'Creech-ish' }, { id: '../bad' }] }, ['bill_nighy', 'creech-ish']]) {
    const tts = fixture(async () => Response.json(payload));
    const voices = await tts.voices();
    assert.equal(voices.length, 2);
    assert.equal(voices[0].id, 'bill_nighy');
    assert.match(voices[0].name, /bill nighy/i);
    assert.match(voices[1].name, /creech ish/i);
    for (const voice of voices) assert.doesNotMatch(voice.name, /[^\p{L}\p{N}\s]/u);
  }
});

test('TTS validates saved endpoints and voice IDs without partial configuration changes', () => {
  const tts = fixture();
  tts.save({ url: 'http://tts37.dragon-net.local:8082/v1/', voice: 'bill_nighy', mode: 'auto' });
  assert.equal(tts.config().url, 'http://tts37.dragon-net.local:8082');
  assert.equal(tts.config().voice, 'bill_nighy');
  for (const patch of [{ voice: '../secrets' }, { url: 'file:///etc/passwd' }, { url: 'http://user:secret@example.org' }, { mode: 'unknown' }, { url: {} }]) {
    const before = tts.config();
    assert.throws(() => tts.save(patch), e => e.statusCode === 400);
    assert.deepEqual(tts.config(), before);
  }
});

test('TTS posts bounded plain text with the configured voice and accepts only audio', async () => {
  let requested;
  const tts = fixture(async (url, options) => {
    requested = { url, ...JSON.parse(options.body) };
    return new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  tts.save({ url: 'http://tts37:8082', voice: 'bill_nighy' });
  const result = await tts.speech('A case briefing.', 1);
  assert.equal(result.type, 'audio/mpeg');
  assert.equal(result.audio.toString(), 'ID3');
  assert.deepEqual(requested, { url: 'http://tts37:8082/v1/audio/speech', model: 'chatterbox', voice: 'bill_nighy', input: 'A case briefing.', response_format: 'mp3' });
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
