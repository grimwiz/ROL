const express = require('express');

const DEFAULT_URL = process.env.TTS_URL || 'http://tts37.dragon-net.local:8082';
const voiceId = (value) => typeof value === 'string' && /^[\p{L}\p{N}]{1,100}$/u.test(value);
function error(message, statusCode = 502) { return Object.assign(new Error(message), { statusCode }); }

function createTts({ readConfig, writeConfig, fetchImpl = (...args) => fetch(...args) }) {
  const busy = new Set();
  let catalogue = { url: '', expires: 0, voices: [] };
  function config() {
    const saved = readConfig();
    return { url: saved.tts_url || DEFAULT_URL, default_url: DEFAULT_URL,
      voice: voiceId(saved.tts_voice) ? saved.tts_voice : 'default', mode: saved.tts_mode === 'browser' ? 'browser' : 'auto' };
  }
  function save(patch) {
    const saved = readConfig();
    if (patch.url !== undefined) {
      if (typeof patch.url !== 'string') throw error('TTS URL must be text.', 400);
      let value = patch.url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
      if (value) {
        let url;
        try { url = new URL(value); } catch { throw error('Enter a valid HTTP or HTTPS TTS URL.', 400); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw error('Enter an HTTP or HTTPS TTS URL without credentials, query or fragment.', 400);
        saved.tts_url = value;
      } else delete saved.tts_url;
    }
    if (patch.voice !== undefined) {
      if (!voiceId(patch.voice)) throw error('Choose a valid TTS voice.', 400);
      saved.tts_voice = patch.voice;
    }
    if (patch.mode !== undefined) {
      if (!['auto', 'browser'].includes(patch.mode)) throw error('Choose TTS with browser fallback or browser speech.', 400);
      saved.tts_mode = patch.mode;
    }
    writeConfig(saved);
    catalogue.expires = 0;
    return config();
  }
  function endpoint(base, suffix) { return base.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/audio/' + suffix; }
  async function voices() {
    const { url } = config();
    if (catalogue.url === url && catalogue.expires > Date.now()) return catalogue.voices;
    const response = await fetchImpl(endpoint(url, 'voices'), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw error('Could not list TTS voices.');
    const payload = await response.json();
    const raw = Array.isArray(payload) ? payload : payload.voices;
    const seen = new Set();
    const list = (Array.isArray(raw) ? raw : []).flatMap((item) => {
      const id = typeof item === 'string' ? item : item && item.id;
      const name = typeof item === 'string' ? item : item && (item.name || id);
      if (!voiceId(id) || !voiceId(name) || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name }];
    });
    catalogue = { url, expires: Date.now() + 60000, voices: list };
    return list;
  }
  async function speech(text, userId, signal) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw error('Text must contain between 1 and 1000 characters.', 400);
    const cfg = config();
    if (cfg.mode === 'browser') throw error('Browser speech is selected.', 503);
    if (!voiceId(cfg.voice)) throw error('The configured TTS voice is invalid.', 503);
    if (busy.has(userId)) throw error('Speech is already being prepared. Try again shortly.', 429);
    busy.add(userId);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
    const timer = setTimeout(abort, 45000);
    try {
      const response = await fetchImpl(endpoint(cfg.url, 'speech'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model: 'chatterbox', voice: cfg.voice, input: text.trim(), response_format: 'mp3' })
      });
      if (!response.ok) throw error('The TTS service could not prepare speech.');
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('audio/')) throw error('The TTS service did not return audio.');
      const reader = response.body.getReader(), parts = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10 * 1024 * 1024) { await reader.cancel(); throw error('TTS audio is too large.'); }
          parts.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      if (!size) throw error('The TTS service returned empty audio.');
      return { audio: Buffer.concat(parts), type };
    } finally {
      clearTimeout(timer); busy.delete(userId);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }
  function router({ requireAuth, requireGM }) {
    const routes = express.Router();
    routes.get('/config', requireAuth, (_req, res) => {
      const { mode, voice } = config(); res.json({ mode, voice });
    });
    routes.get('/settings', requireGM, async (_req, res) => {
      try { res.json({ ...config(), voices: await voices() }); }
      catch { res.json({ ...config(), voices: [], error: 'Could not list voices. Browser speech will be used if TTS is unavailable.' }); }
    });
    routes.put('/settings', requireGM, (req, res) => {
      try { res.json(save(req.body || {})); } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
    });
    routes.post('/speech', requireAuth, async (req, res) => {
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try {
        const result = await speech(req.body && req.body.text, req.user.id, controller.signal);
        res.set('Cache-Control', 'no-store').type(result.type).send(result.audio);
      } catch (e) { if (!res.destroyed) res.status(e.statusCode || 502).json({ error: e.statusCode ? e.message : 'The TTS service is unavailable. Use browser speech.' }); }
    });
    return routes;
  }
  return { config, save, voices, speech, router };
}

module.exports = { createTts };
