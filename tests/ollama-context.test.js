const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createOllamaContext } = require('../src/ollamaContext');

function contextFixture({ saved = {}, max = 1048576, cloud = true, envDefault, metadataFails = false } = {}) {
  let config = { ...saved };
  let metadataCalls = 0;
  const context = createOllamaContext({
    readConfig: () => ({ ...config }),
    writeConfig: (next) => { config = { ...next }; },
    model: () => cloud ? 'test:cloud' : 'test:local',
    isCloud: () => cloud,
    modelMaxContext: async () => { metadataCalls++; if (metadataFails) throw new Error('offline'); return max; },
    envDefault
  });
  return { context, config: () => config, metadataCalls: () => metadataCalls };
}

test('cloud default omits num_ctx entirely, allowing the hosted full context', async () => {
  const { context } = contextFixture();
  const info = await context.ollamaContextConfig();
  assert.equal(info.current, null);
  assert.equal(info.effective, 1048576);
  const body = JSON.parse(JSON.stringify({ options: { ...await context.requestContextOptions(), temperature: 0.2 } }));
  assert.equal(Object.hasOwn(body.options, 'num_ctx'), false);
});

test('Use default persists across reloads and overrides an explicit environment default', async () => {
  const fixture = contextFixture({ saved: { ollama_num_ctx: 262144, unrelated: 'preserved' }, envDefault: '131072' });
  assert.equal(fixture.context.configuredOllamaNumCtx(), 262144);
  await fixture.context.setOllamaNumCtx(null);
  assert.deepEqual(fixture.config(), { ollama_num_ctx: null, unrelated: 'preserved' });
  const reloaded = contextFixture({ saved: fixture.config(), envDefault: '131072' });
  assert.equal(reloaded.context.configuredOllamaNumCtx(), null);
  assert.deepEqual(await reloaded.context.requestContextOptions(), {});
});

test('default works without metadata and never falls back to a 256K request', async () => {
  const fixture = contextFixture({ metadataFails: true });
  assert.deepEqual(await fixture.context.requestContextOptions(), {});
  assert.equal(fixture.metadataCalls(), 0);
  const info = await fixture.context.setOllamaNumCtx('default');
  assert.equal(info.current, null);
  assert.equal(info.effective, null);
  assert.equal(info.model_max, null);
});

test('explicit full sizes and non-preset model limits are accepted and sent', async () => {
  const { context } = contextFixture({ max: 2097152 });
  assert.ok((await context.ollamaContextConfig()).options.includes(2097152));
  for (const size of [131072, 262144, 524288, 1048576, 1500000, 2097152]) {
    const info = await context.setOllamaNumCtx(size);
    assert.equal(info.current, size);
    assert.equal(info.effective, size);
    assert.deepEqual(await context.requestContextOptions(), { num_ctx: size });
  }
});

test('existing explicit limits survive and clamp safely when switching to a smaller model', async () => {
  const { context } = contextFixture({ saved: { ollama_num_ctx: 262144 }, max: 131072 });
  const info = await context.ollamaContextConfig();
  assert.equal(info.current, 262144);
  assert.equal(info.effective, 131072);
  assert.equal(info.options.includes(262144), false);
  assert.deepEqual(await context.requestContextOptions(), { num_ctx: 131072 });
  await assert.rejects(context.setOllamaNumCtx(524288), (e) => e.statusCode === 400);
});

test('invalid context requests cannot overwrite the saved setting', async () => {
  const fixture = contextFixture({ saved: { ollama_num_ctx: 262144 } });
  for (const value of [undefined, '', 0, -1, 1.5, true, false, {}, [], Infinity, '1e6', '1048576junk']) {
    await assert.rejects(fixture.context.setOllamaNumCtx(value), (e) => e.statusCode === 400);
    assert.equal(fixture.config().ollama_num_ctx, 262144);
  }
});

test('local default delegates to Ollama without claiming its native maximum is allocated', async () => {
  const { context } = contextFixture({ cloud: false });
  const info = await context.ollamaContextConfig();
  assert.equal(info.model_max, 1048576);
  assert.equal(info.effective, null);
  assert.deepEqual(await context.requestContextOptions(), {});
  const explicitEnv = contextFixture({ cloud: false, envDefault: '524288' });
  assert.deepEqual(await explicitEnv.context.requestContextOptions(), { num_ctx: 524288 });
});

test('the real streamed chat request omits the default limit and sends an explicit full-size limit', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/scenarioInfo.js'), 'utf8');
  const start = source.indexOf('async function callOllama(');
  const end = source.indexOf('function imgMatchKey(', start);
  for (const setting of [null, 1048576]) {
    const { context } = contextFixture({ saved: { ollama_num_ctx: setting } });
    let sent;
    const activity = { active: 0, startedAt: null, lastSection: null };
    const sandbox = {
      AbortController, TextDecoder, setTimeout, clearTimeout,
      OLLAMA_TIMEOUT_MS: 0, OLLAMA_KEEP_ALIVE: '30m',
      ollamaControllers: new Set(), ollamaActivity: activity, ollamaDispatcher: null,
      requestContextOptions: context.requestContextOptions,
      effectiveOllamaModel: () => 'test:cloud',
      effectiveOllamaUrl: () => 'http://mock-ollama',
      console: { info: () => {} },
      fetch: async (_url, options) => {
        sent = JSON.parse(options.body);
        return new Response(JSON.stringify({ message: { content: 'Nightingale looks up.' }, model: 'test:cloud', done: true }) + '\n');
      }
    };
    assert.equal(await vm.runInNewContext(source.slice(start, end) + "\ncallOllama('Continue the scene')", sandbox), 'Nightingale looks up.');
    assert.equal(sent.stream, true);
    assert.equal(sent.options.temperature, 0.2);
    if (setting === null) assert.equal(Object.hasOwn(sent.options, 'num_ctx'), false);
    else assert.equal(sent.options.num_ctx, 1048576);
    assert.equal(activity.active, 0);
  }
});

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
async function renderContext(context) {
  const host = { innerHTML: '' };
  const start = app.indexOf('async function renderAdminLlm()');
  const end = app.indexOf('async function saveAdminComfyModels(', start);
  const sandbox = {
    el: () => host,
    esc: (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    api: {
      getLlmModels: async () => ({ models: [], current: 'test:cloud', default: 'test:cloud', context }),
      getLlmServices: async () => ({ ollama: {}, comfyui: {}, whisperx: {} }),
      getComfyModels: async () => ({ models: [], image: {}, edit: {} })
    }
  };
  await vm.runInNewContext(app.slice(start, end) + '\nrenderAdminLlm()', sandbox);
  return host.innerHTML;
}

test('admin renders Use default as selected and offers 512K and the full model maximum', async () => {
  const { context } = contextFixture({ max: 2097152 });
  const html = await renderContext(await context.ollamaContextConfig());
  assert.match(html, /btn-primary" onclick="saveAdminLlmContext\(this, null\)"/);
  assert.match(html, /saveAdminLlmContext\(this, 524288\)/);
  assert.match(html, /saveAdminLlmContext\(this, 2097152\)/);
  assert.match(html, />2M<\/button>/);
  assert.match(html, /Using Ollama default/);
});

test('admin keeps an explicit choice selected and disables unsupported larger choices', async () => {
  const { context } = contextFixture({ saved: { ollama_num_ctx: 131072 }, max: 131072 });
  const html = await renderContext(await context.ollamaContextConfig());
  assert.match(html, /btn-primary" onclick="saveAdminLlmContext\(this, 131072\)"/);
  assert.doesNotMatch(html, /btn-primary" onclick="saveAdminLlmContext\(this, null\)"/);
  assert.match(html, /saveAdminLlmContext\(this, 524288\)" disabled/);
});

test('Use default remains available when model metadata is unavailable', async () => {
  const html = await renderContext(await contextFixture({ metadataFails: true }).context.ollamaContextConfig());
  assert.match(html, /saveAdminLlmContext\(this, null\)" title=/);
  assert.match(html, /Model maximum: unknown/);
});
