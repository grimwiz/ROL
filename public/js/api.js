const api = (() => {
  async function req(method, path, body, timeoutMs) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    // Optional timeout so a dead/restarting server fails fast instead of hanging
    // the caller (which otherwise wedges live capture and the browser tab).
    if (timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(timeoutMs);
    }
    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch (e) {
      throw new Error((e && e.name === 'TimeoutError') ? 'request timed out' : ((e && e.message) || 'network error'));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // Solo-adventure state is intentionally browser-only and not server-persisted
  // (one browser, one character; ephemeral by design). Single slot per browser,
  // no user-id keying.
  const DOMESTIC_SHEET_KEY = 'rol.domestic.sheet';
  const DOMESTIC_PROGRESS_KEY = 'rol.domestic.progress';

  function readLocalJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeLocalJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      throw new Error(`Browser storage unavailable: ${e.message || e}`);
    }
  }

  return {
    get: (path) => req('GET', path),
    post: (path, body) => req('POST', path, body),
    put: (path, body) => req('PUT', path, body),
    delete: (path) => req('DELETE', path),

    login: (username, password) => req('POST', '/auth/login', { username, password }),
    logout: () => req('POST', '/auth/logout'),
    me: () => req('GET', '/auth/me'),

    getUsers: () => req('GET', '/users'),
    createUser: (data) => req('POST', '/users', data),
    updatePassword: (id, password) => req('PUT', `/users/${id}/password`, { password }),
    deleteUser: (id) => req('DELETE', `/users/${id}`),
    setUserSessions: (id, sessionIds) => req('PUT', `/users/${id}/sessions`, { session_ids: sessionIds }),

    // Character sheets (player characters and NPCs share the same backing table).
    getCharacters: (filter) => {
      const params = [];
      if (filter && filter.owner) params.push(`owner=${encodeURIComponent(filter.owner)}`);
      if (filter && filter.caseName) params.push(`case=${encodeURIComponent(filter.caseName)}`);
      if (filter && filter.caseId != null) params.push(`case_id=${encodeURIComponent(filter.caseId)}`);
      const qs = params.length ? `?${params.join('&')}` : '';
      return req('GET', `/character-sheets${qs}`);
    },

    // NPCs are character_sheets rows owned by the NPC sentinel user.
    getNpcs: (sessionIdOrCaseName) => {
      if (sessionIdOrCaseName == null) return req('GET', '/character-sheets?owner=NPC');
      // Caller may pass a session id (number) or a case name (string).
      const q = typeof sessionIdOrCaseName === 'number' || /^\d+$/.test(String(sessionIdOrCaseName))
        ? `case_id=${encodeURIComponent(sessionIdOrCaseName)}`
        : `case=${encodeURIComponent(sessionIdOrCaseName)}`;
      return req('GET', `/character-sheets?owner=NPC&${q}`);
    },
    createNpc: (data) => req('POST', '/character-sheets', { ...data, owner: 'NPC' }),
    updateNpc: (id, data) => req('PUT', `/character-sheets/${id}`, data),
    deleteNpc: (id) => req('DELETE', `/character-sheets/${id}`),
    setNpcSessions: (id, sessionIds) => req('PUT', `/character-sheets/${id}/scope`, { session_ids: sessionIds }),
    setCharacterOwner: (id, userId) => req('PUT', `/character-sheets/${id}/owner`, { user_id: userId }),
    getAllocatableCases: () => req('GET', '/allocatable-cases'),

    getSessions: () => req('GET', '/sessions'),
    createSession: (data) => req('POST', '/sessions', data),
    updateSession: (id, data) => req('PUT', `/sessions/${id}`, data),
    deleteSession: (id) => req('DELETE', `/sessions/${id}`),
    resetCanonicalSession: (id) => req('POST', `/sessions/${id}/reset-canonical`, {}),
    getSessionPlayers: (id) => req('GET', `/sessions/${id}/players`),
    addPlayer: (sessionId, userId) => req('POST', `/sessions/${sessionId}/players`, { user_id: userId }),
    removePlayer: (sessionId, userId) => req('DELETE', `/sessions/${sessionId}/players/${userId}`),

    getSheets: (sessionId) => req('GET', `/sessions/${sessionId}/sheets`),
    getSheet: (sessionId, userId) => req('GET', `/sessions/${sessionId}/sheets/${userId}`),
    saveSheet: (sessionId, userId, data) => req('PUT', `/sessions/${sessionId}/sheets/${userId}`, { data }),
    getSessionScenarioInfo: (sessionId, asUser) => req('GET', asUser ? `/sessions/${sessionId}/scenario-info?as_user=${encodeURIComponent(asUser)}` : `/sessions/${sessionId}/scenario-info`),
    getCharacterPersonality: (sessionId, characterId) => req('GET', `/sessions/${sessionId}/characters/${characterId}/personality`),
    saveCharacterPersonality: (sessionId, characterId, content) => req('PUT', `/sessions/${sessionId}/characters/${characterId}/personality`, { content }),
    transcribeAudio: (sessionId, payload) => req('POST', `/sessions/${sessionId}/transcribe`, payload, 30000),
    diarizeChunk: (sessionId, audio_base64, mime) => req('POST', `/sessions/${sessionId}/diarize-chunk`, { audio_base64, mime }, 120000),
    liveStart: (sessionId, rate) => req('POST', `/sessions/${sessionId}/live/start`, { rate }, 15000),
    ingestAudio: (sessionId, pcm_base64) => req('POST', `/sessions/${sessionId}/ingest`, { pcm_base64 }, 15000),
    diarizeWindow: (sessionId, final, until) => req('POST', `/sessions/${sessionId}/diarize-window`, { final: !!final, until: until || 0 }, 120000),
    getVoices: (sessionId) => req('GET', `/sessions/${sessionId}/voices`),
    setVoiceCharacter: (sessionId, voiceId, character) => req('PUT', `/sessions/${sessionId}/voices/${voiceId}`, { character }),
    mergeVoice: (sessionId, voiceId, into) => req('POST', `/sessions/${sessionId}/voices/${voiceId}/merge`, { into }),
    deleteVoice: (sessionId, voiceId) => req('DELETE', `/sessions/${sessionId}/voices/${voiceId}`),
    getSessionScenarioSources: (sessionId) => req('GET', `/sessions/${sessionId}/scenario-sources`),
    saveSessionScenarioSources: (sessionId, data) => req('PUT', `/sessions/${sessionId}/scenario-sources`, data),
    regenerateScenarioSections: (sessionId, body) => req('POST', `/sessions/${sessionId}/scenario-info/regenerate`, body || {}),
    regenerateScenarioSection: (sessionId, sectionId) => req('POST', `/sessions/${sessionId}/scenario-info/sections/${encodeURIComponent(sectionId)}/regenerate`),
    refreshScenarioIndex: (sessionId, body) => req('POST', `/sessions/${sessionId}/scenario-info/refresh-index`, body || {}),
    revertScenarioSection: (sessionId, sectionId) => req('POST', `/sessions/${sessionId}/scenario-info/sections/${encodeURIComponent(sectionId)}/revert`),
    exportGmChat: (sessionId, messages) => req('POST', `/sessions/${sessionId}/chat/export`, { messages }),
    getSessionSettings: (sessionId) => req('GET', `/sessions/${sessionId}/settings`),
    setSessionSettings: (sessionId, patch) => req('PUT', `/sessions/${sessionId}/settings`, patch || {}),
    getSessionRolls: (sessionId) => req('GET', `/sessions/${sessionId}/rolls`),
    createSessionRoll: (sessionId, data) => req('POST', `/sessions/${sessionId}/rolls`, data),
    createSelfRoll: (sessionId, data) => req('POST', `/sessions/${sessionId}/rolls/self`, data),
    resolveSessionRoll: (sessionId, rollId) => req('POST', `/sessions/${sessionId}/rolls/${rollId}/resolve`),
    finalizeSessionRoll: (sessionId, rollId, luckSpent) => req('POST', `/sessions/${sessionId}/rolls/${rollId}/finalize`, { luck_spent: luckSpent }),
    restoreSessionRollLuck: (sessionId, rollId) => req('POST', `/sessions/${sessionId}/rolls/${rollId}/restore-luck`),
    setSessionWounds: (sessionId, userId, wounds) => req('PUT', `/sessions/${sessionId}/players/${userId}/wounds`, wounds),
    addSessionStatAdjustment: (sessionId, userId, stat, delta, note) => req('POST', `/sessions/${sessionId}/players/${userId}/stat-adjustment`, { stat, delta, note }),
    clearSessionStatAdjustment: (sessionId, adjId) => req('POST', `/sessions/${sessionId}/stat-adjustments/${adjId}/clear`),
    cancelSessionRoll: (sessionId, rollId) => req('POST', `/sessions/${sessionId}/rolls/${rollId}/cancel`),
    getRules: (variant) => req('GET', variant === 'advanced' ? '/rules?variant=advanced' : '/rules'),
    getRulesChanges: () => req('GET', '/rules/changes'),
    getRulesReference: () => req('GET', '/rules/reference'),
    getNpcPersonas: (sessionId) => req('GET', `/sessions/${sessionId}/npc-personas`),
    searchRules: (query) => req('GET', `/rules/search?q=${encodeURIComponent(query)}`),
    getDomesticAdventure: () => req('GET', '/adventure/domestic'),
    getDomesticProgress: async () => readLocalJson(DOMESTIC_PROGRESS_KEY) || { current_step: null },
    saveDomesticProgress: async (currentStep) => {
      writeLocalJson(DOMESTIC_PROGRESS_KEY, { current_step: currentStep, updated_at: new Date().toISOString() });
      return { ok: true, current_step: currentStep };
    },
    getDomesticSheet: async () => ({ data: readLocalJson(DOMESTIC_SHEET_KEY) || {} }),
    saveDomesticSheet: async (data) => {
      writeLocalJson(DOMESTIC_SHEET_KEY, data || {});
      return { ok: true };
    },
    deleteDomesticSheet: async () => {
      try { localStorage.removeItem(DOMESTIC_SHEET_KEY); } catch (e) { throw new Error(`Browser storage unavailable: ${e.message || e}`); }
      return { ok: true };
    },
    rollDice: (formula, preset) => req('POST', '/dice/rolls', { formula, preset }),
    getLlmStatus: () => req('GET', '/llm/status'),
    getLlmModels: () => req('GET', '/llm/models'),
    setLlmModel: (model) => req('PUT', '/llm/model', { model }),
    setLlmContext: (numCtx) => req('PUT', '/llm/context', { num_ctx: numCtx }),
    cancelLlm: () => req('POST', '/llm/cancel', {}),
    getLlmServices: () => req('GET', '/llm/services'),
    setLlmServices: (patch) => req('PUT', '/llm/services', patch || {}),
    getComfyModels: () => req('GET', '/comfy/models'),
    setComfyModels: (patch) => req('PUT', '/comfy/models', patch || {}),
    generateHandout: (sessionId, prompt, size) => req('POST', `/sessions/${sessionId}/handouts/generate`, { prompt, size }),
    editGraphic: (sessionId, data) => req('POST', `/sessions/${sessionId}/graphics/edit`, data),
    interruptComfy: (data) => req('POST', '/portrait/interrupt', data || {}),
    saveHandout: (sessionId, ref) => req('POST', `/sessions/${sessionId}/handouts/save`, ref),
    setAssetVisibility: (sessionId, path, visibility) => req('POST', `/sessions/${sessionId}/assets/visibility`, { path, visibility }),
    createSessionFile: (sessionId, data) => req('POST', `/sessions/${sessionId}/files`, data),
    replaceSessionFile: (sessionId, data) => req('POST', `/sessions/${sessionId}/files/replace`, data),
    renameSessionFile: (sessionId, data) => req('POST', `/sessions/${sessionId}/files/rename`, data),
    deleteSessionFile: (sessionId, path) => req('POST', `/sessions/${sessionId}/files/delete`, { path }),
    revertSessionFile: (sessionId, relativePath) => req('POST', `/sessions/${sessionId}/files/revert`, { relative_path: relativePath }),
    saveSessionFilePrompt: (sessionId, path, text) => req('POST', `/sessions/${sessionId}/files/prompt`, { path, text }),
    generateEntityGraphicPrompt: (sessionId, data) => req('POST', `/sessions/${sessionId}/entities/graphic-prompt`, data),
  };
})();
