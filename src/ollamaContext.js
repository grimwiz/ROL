const CONTEXT_PRESETS = [131072, 262144, 524288, 1048576];

function parseContext(value) {
  if (value === null || value === 'default') return null;
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new Error('Choose Use default or a positive whole number of context tokens');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('Context must be a positive whole number of tokens');
  }
  return n;
}

function createOllamaContext({ readConfig, writeConfig, model, modelMaxContext, isCloud, envDefault }) {
  let defaultContext = null;
  try { defaultContext = parseContext(envDefault ?? 'default'); } catch { /* use Ollama's default */ }

  function configuredOllamaNumCtx() {
    const cfg = readConfig();
    if (!Object.prototype.hasOwnProperty.call(cfg, 'ollama_num_ctx')) return defaultContext;
    try { return parseContext(cfg.ollama_num_ctx); } catch { return defaultContext; }
  }

  async function maximum() {
    try {
      const max = await modelMaxContext(model());
      return Number.isSafeInteger(max) && max > 0 ? max : null;
    } catch { return null; }
  }

  async function ollamaContextConfig() {
    const max = await maximum();
    const current = configuredOllamaNumCtx();
    const cloud = isCloud();
    const all = [...new Set([...CONTEXT_PRESETS, max, current].filter((n) => n !== null))].sort((a, b) => a - b);
    return {
      current,
      effective: current === null ? (cloud ? max : null) : (max ? Math.min(current, max) : current),
      default: defaultContext,
      cloud,
      model_max: max,
      options: all.filter((n) => max === null || n <= max),
      all_options: all
    };
  }

  async function setOllamaNumCtx(value) {
    let n;
    try { n = parseContext(value); } catch (error) { error.statusCode = 400; throw error; }
    if (n !== null) {
      const max = await maximum();
      if (max !== null && n > max) {
        const error = new Error(`The active model only supports ${max.toLocaleString('en-GB')} context tokens`);
        error.statusCode = 400;
        throw error;
      }
    }
    const cfg = readConfig();
    // Persist null explicitly so Use default also overrides OLLAMA_NUM_CTX.
    cfg.ollama_num_ctx = n;
    writeConfig(cfg);
    return ollamaContextConfig();
  }

  async function requestContextOptions() {
    const configured = configuredOllamaNumCtx();
    // Omit num_ctx completely: cloud models use their maximum by default.
    // This also works when a cloud proxy cannot supply /api/show metadata.
    if (configured === null) return {};
    const max = await maximum();
    return { num_ctx: max === null ? configured : Math.min(configured, max) };
  }

  return { configuredOllamaNumCtx, ollamaContextConfig, setOllamaNumCtx, requestContextOptions };
}

module.exports = { createOllamaContext };
