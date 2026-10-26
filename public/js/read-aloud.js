(function (root) {
  'use strict';
  function chunks(text, limit = 180) {
    let rest = String(text || '').replace(/[ \t]+/g, ' ').trim();
    const out = [];
    while (rest.length > limit) {
      const prefix = rest.slice(0, limit + 1);
      let cut = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '), prefix.lastIndexOf('\n'));
      if (cut < limit / 3) cut = prefix.lastIndexOf(' ');
      if (cut < 1) cut = limit;
      else cut += 1;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function create(env) {
    const doc = env.document, synth = env.speechSynthesis;
    const supported = !!(synth && env.SpeechSynthesisUtterance);
    let generation = 0, queue = [], index = 0, utterance = null, active = false, paused = false, message = '';
    let activeBar = null, audio = null, audioUrl = null, controller = null, local = false;
    const mic = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
    const skip = 'button,input,textarea,select,script,style,nav,[hidden],[aria-hidden="true"],.scenario-reading-footer,.read-aloud-controls,.page-header,.sheet-tabs,.scenario-section-actions,.scenario-sources,.scenario-jump-all,.case-index,.scenario-viewer,.scenario-source-editor,.entity-image-manager,.eit-panel,.gmchat-caret';
    const block = /^(H[1-6]|P|DIV|SECTION|ARTICLE|LI|TR|BR|BLOCKQUOTE|FIGCAPTION)$/;
    function textFrom(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1 || node.matches(skip)) return '';
      const style = env.getComputedStyle ? env.getComputedStyle(node) : {};
      if (style.display === 'none' || style.visibility === 'hidden') return '';
      if (node.tagName === 'DETAILS' && !node.open) return '';
      const text = Array.from(node.childNodes).map(textFrom).join('');
      return block.test(node.tagName) ? '\n' + text + '\n' : text;
    }
    function controls() {
      return `<div class="read-aloud-controls" role="group" aria-label="Read this subsection aloud">
        <button type="button" class="btn btn-sm" data-read-toggle title="Read this subsection aloud" aria-label="Read this subsection aloud">${mic}</button>
        <button type="button" class="btn btn-sm" data-read-stop hidden>Stop</button>
        <span class="read-aloud-status" role="status"></span>
      </div>`;
    }
    function update() {
      if (!doc) return;
      doc.querySelectorAll('.read-aloud-controls').forEach((bar) => {
        const current = bar === activeBar;
        const toggle = bar.querySelector('[data-read-toggle]');
        toggle.innerHTML = current && active ? (paused ? '▶' : '⏸') : mic;
        const label = current && active ? (paused ? 'Resume reading' : 'Pause reading') : 'Read this subsection aloud';
        toggle.setAttribute('aria-label', label); toggle.title = label;
        bar.querySelector('[data-read-stop]').hidden = !(current && active);
        const status = bar.querySelector('.read-aloud-status');
        const value = !current ? '' : active ? (paused ? 'Paused. Press play to continue.' : local ? 'Reading with browser voice…' : message || 'Reading…') : message;
        if (status.textContent !== value) status.textContent = value;
      });
    }
    function stop(status = '') {
      generation += 1;
      active = false; paused = false; queue = []; utterance = null; message = status;
      if (controller) controller.abort(); controller = null;
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
      if (audioUrl) { env.URL.revokeObjectURL(audioUrl); audioUrl = null; }
      if (supported) synth.cancel();
      update();
    }
    function speakNext(token) {
      if (token !== generation || !active) return;
      if (index >= queue.length) { stop('Finished reading.'); return; }
      utterance = new env.SpeechSynthesisUtterance(queue[index++]);
      const lang = (doc && doc.documentElement.lang) || (env.navigator && env.navigator.language) || 'en-GB';
      utterance.lang = lang === 'en' ? 'en-GB' : lang;
      const voices = synth.getVoices();
      const voice = voices.find(v => v.lang === utterance.lang && v.localService)
        || voices.find(v => v.lang === utterance.lang)
        || voices.find(v => v.lang && v.lang.split('-')[0] === utterance.lang.split('-')[0]);
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakNext(token);
      utterance.onerror = (event) => {
        if (token !== generation) return;
        stop(event.error === 'not-allowed' ? 'Your browser blocked speech. Press Read to try again.' : 'Could not read this page. Check the speech voices available on your device.');
      };
      try { synth.speak(utterance); } catch { stop('Could not start reading. Check speech support on your device.'); }
    }
    function browserFallback(token) {
      if (token !== generation || !active) return;
      if (!supported) { stop('Speech is unavailable. Try again when TTS is reachable, or use a browser with speech support.'); return; }
      if (controller) controller.abort();
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); }
      if (audioUrl) { env.URL.revokeObjectURL(audioUrl); audioUrl = null; }
      queue = chunks(queue.slice(index).join('\n')); index = 0; local = true; message = '';
      synth.resume(); update(); speakNext(token);
      if (paused) synth.pause();
    }
    async function fetchChunk(position, signal) {
      const response = await env.fetch('/api/tts/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queue[position] }), signal });
      if (!response.ok) throw new Error('TTS unavailable');
      return response.blob();
    }
    async function playRemote(token, prepared) {
      if (token !== generation || !active) return;
      if (index >= queue.length) { stop('Finished reading.'); return; }
      try {
        message = 'Preparing speech…'; update();
        const result = prepared ? await prepared : { blob: await fetchChunk(index, controller.signal) };
        if (token !== generation || !active) return;
        if (result.error) throw result.error;
        if (audioUrl) env.URL.revokeObjectURL(audioUrl);
        audioUrl = env.URL.createObjectURL(result.blob); audio.src = audioUrl;
        const next = index + 1 < queue.length
          ? fetchChunk(index + 1, controller.signal).then(blob => ({ blob }), error => ({ error })) : null;
        audio.onended = () => { if (token !== generation) return; index += 1; playRemote(token, next); };
        audio.onerror = () => browserFallback(token);
        message = ''; update();
        if (!paused) {
          try { await audio.play(); } catch { if (token === generation) { paused = true; update(); } }
        }
      } catch { browserFallback(token); }
    }
    async function start(container, bar) {
      stop();
      activeBar = bar || null;
      queue = chunks(textFrom(container), 350);
      if (!queue.length) { message = 'No readable text on this page.'; update(); return; }
      active = true; index = 0; local = false;
      const token = generation;
      controller = new env.AbortController();
      if (supported) synth.resume();
      if (env.Audio) audio = new env.Audio();
      update();
      try {
        const response = await env.fetch('/api/tts/config', { signal: controller.signal });
        if (!response.ok) throw new Error('No TTS configuration');
        const config = await response.json();
        if (token !== generation) return;
        if (config.mode === 'browser' || !audio) browserFallback(token);
        else await playRemote(token);
      } catch { browserFallback(token); }
    }
    function toggle(container, bar) {
      if (!active || bar !== activeBar) { return start(container, bar); }
      if (local) { if (paused) synth.resume(); else synth.pause(); }
      else if (audio) { if (paused) audio.play().catch(() => { paused = true; update(); }); else audio.pause(); }
      paused = !paused;
      update();
    }
    if (doc) doc.addEventListener('click', (event) => {
      const button = event.target.closest && event.target.closest('[data-read-toggle],[data-read-stop]');
      if (!button) return;
      if (button.hasAttribute('data-read-stop')) stop();
      else {
        const bar = button.closest('.read-aloud-controls');
        const section = bar.closest('.scenario-entry-card,.scenario-summary-card,[data-read-section]');
        if (section) toggle(section, bar);
      }
    });
    if (env.addEventListener) env.addEventListener('pagehide', () => stop());
    return { controls, start, toggle, stop, textFrom };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { chunks, create };
  else root.ReadAloud = create(root);
})(typeof window === 'undefined' ? null : window);
