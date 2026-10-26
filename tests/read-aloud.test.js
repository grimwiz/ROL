const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, chunks } = require('../public/js/read-aloud');

const text = value => ({ nodeType: 3, nodeValue: value });
function node(tag, children, skip = false) {
  return { nodeType: 1, tagName: tag, childNodes: children, matches: () => skip };
}
function fixture({ mode = 'browser', failTts = false, blockedAudio = false } = {}) {
  const spoken = [], audio = [], requested = [], revoked = [], actions = [];
  let click;
  const bar = { toggle: { setAttribute: () => {} }, stop: {}, status: {}, querySelector(selector) {
    return selector === '[data-read-toggle]' ? this.toggle : selector === '[data-read-stop]' ? this.stop : this.status;
  } };
  const otherBar = { ...bar, toggle: { setAttribute: () => {} }, stop: {}, status: {} };
  const section = node('DIV', [node('H3', [text('Session 1')]), node('P', [text('Only this selected subsection.')]),
    node('DIV', [text('private hidden content')], true), node('DIV', [text('source-file.md Read Stop')], true)]);
  const doc = { documentElement: { lang: 'en' }, querySelectorAll: () => [bar, otherBar], addEventListener: (_event, fn) => { click = fn; } };
  const env = { document: doc, AbortController, SpeechSynthesisUtterance: class { constructor(value) { this.text = value; } },
    speechSynthesis: { getVoices: () => [], cancel: () => actions.push('cancel'), pause: () => actions.push('pause'), resume: () => actions.push('resume'), speak: utterance => spoken.push(utterance) },
    Audio: class { constructor() { audio.push(this); } async play() { actions.push('play'); if (blockedAudio) { blockedAudio = false; throw new Error('not allowed'); } } pause() { actions.push('audio pause'); } removeAttribute() {} load() {} },
    URL: { createObjectURL: () => 'blob:audio-' + requested.length, revokeObjectURL: value => revoked.push(value) },
    fetch: async (url, options) => { requested.push({ url, options }); return url.endsWith('/config') ? Response.json({ mode }) : failTts ? new Response('', { status: 502 }) : new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }); }
  };
  bar.closest = () => section;
  const button = { hasAttribute: () => false, closest: selector => selector === '.read-aloud-controls' ? bar : button };
  return { reader: create(env), bar, otherBar, section, spoken, audio, requested, revoked, actions, click: () => click({ target: button }) };
}

test('reader uses only the selected subsection, excluding controls, citations and hidden text', async () => {
  const f = fixture();
  f.click();
  await new Promise(setImmediate);
  assert.match(f.spoken[0].text, /Session 1/);
  assert.match(f.spoken[0].text, /Only this selected subsection/);
  assert.doesNotMatch(f.spoken[0].text, /hidden|source-file|Stop/);
  assert.equal(f.otherBar.status.textContent, '');
  f.reader.toggle(f.section, f.bar);
  assert.equal(f.actions.at(-1), 'pause');
  f.reader.toggle(f.section, f.bar);
  assert.equal(f.actions.at(-1), 'resume');
  const lateEnd = f.spoken[0].onend;
  f.reader.stop(); lateEnd();
  assert.equal(f.spoken.length, 1);
});

test('unavailable TTS falls back to browser speech for the same subsection', async () => {
  const f = fixture({ mode: 'auto', failTts: true });
  await f.reader.start(f.section, f.bar);
  assert.equal(f.requested[1].url, '/api/tts/speech');
  assert.match(f.spoken[0].text, /Only this selected subsection/);
  assert.equal(f.requested[1].options.signal.aborted, true);
});

test('server audio can pause and resume, handles autoplay blocking, and is released on stop', async () => {
  const f = fixture({ mode: 'auto', blockedAudio: true });
  await f.reader.start(f.section, f.bar);
  assert.match(f.bar.status.textContent, /Press play/);
  f.reader.toggle(f.section, f.bar);
  await Promise.resolve();
  assert.equal(f.spoken.length, 0);
  assert.equal(f.audio[0].src.startsWith('blob:'), true);
  f.reader.stop();
  assert.equal(f.revoked.length, 1);
  assert.equal(f.bar.stop.hidden, true);
});

test('long subsections are chunked without dropping words and cancelled speech cannot resume', async () => {
  const input = 'A complete sentence about the case. '.repeat(150);
  assert.equal(chunks(input).join(' ').replace(/\s+/g, ' ').trim(), input.trim());
  assert.ok(chunks(input).every(chunk => chunk.length <= 180));
  const f = fixture();
  f.section.childNodes = [text(input)];
  await f.reader.start(f.section, f.bar);
  f.spoken[0].onend();
  assert.equal(f.spoken.length, 2);
  const lateEnd = f.spoken[1].onend;
  f.reader.stop(); lateEnd();
  assert.equal(f.spoken.length, 2);
});

test('source footers offer subsection speech even when there are no citations', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const start = app.indexOf('function renderScenarioSources('), end = app.indexOf('function renderScenarioSectionActions(', start);
  const sandbox = { scenarioArray: x => x || [], esc: String, window: { ReadAloud: { controls: () => '<button data-read-toggle>Read</button>' } } };
  const html = vm.runInNewContext(app.slice(start, end) + '\nrenderScenarioSources([])', sandbox);
  assert.match(html, /scenario-reading-footer/);
  assert.match(html, /data-read-toggle/);
});
