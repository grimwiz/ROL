const api = (() => {
  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
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

    getNpcs: (sessionId) => req('GET', sessionId ? `/npcs?session_id=${encodeURIComponent(sessionId)}` : '/npcs'),
    createNpc: (data) => req('POST', '/npcs', data),
    updateNpc: (id, data) => req('PUT', `/npcs/${id}`, data),
    deleteNpc: (id) => req('DELETE', `/npcs/${id}`),
    setNpcSessions: (id, sessionIds) => req('PUT', `/npcs/${id}/sessions`, { session_ids: sessionIds }),
    getAllocatableCases: () => req('GET', '/allocatable-cases'),
    setSessionNpcs: (sessionId, npcIds) => req('PUT', `/sessions/${sessionId}/npcs`, { npc_ids: npcIds }),

    getSessions: () => req('GET', '/sessions'),
    createSession: (data) => req('POST', '/sessions', data),
    updateSession: (id, data) => req('PUT', `/sessions/${id}`, data),
    deleteSession: (id) => req('DELETE', `/sessions/${id}`),
    getSessionPlayers: (id) => req('GET', `/sessions/${id}/players`),
    addPlayer: (sessionId, userId) => req('POST', `/sessions/${sessionId}/players`, { user_id: userId }),
    removePlayer: (sessionId, userId) => req('DELETE', `/sessions/${sessionId}/players/${userId}`),

    getSheets: (sessionId) => req('GET', `/sessions/${sessionId}/sheets`),
    getSheet: (sessionId, userId) => req('GET', `/sessions/${sessionId}/sheets/${userId}`),
    saveSheet: (sessionId, userId, data) => req('PUT', `/sessions/${sessionId}/sheets/${userId}`, { data }),
    getSessionScenarioInfo: (sessionId, asUser) => req('GET', asUser ? `/sessions/${sessionId}/scenario-info?as_user=${encodeURIComponent(asUser)}` : `/sessions/${sessionId}/scenario-info`),
    getSessionScenarioSources: (sessionId) => req('GET', `/sessions/${sessionId}/scenario-sources`),
    saveSessionScenarioSources: (sessionId, data) => req('PUT', `/sessions/${sessionId}/scenario-sources`, data),
    regenerateScenarioSections: (sessionId, body) => req('POST', `/sessions/${sessionId}/scenario-info/regenerate`, body || {}),
    regenerateScenarioSection: (sessionId, sectionId) => req('POST', `/sessions/${sessionId}/scenario-info/sections/${encodeURIComponent(sectionId)}/regenerate`),
    revertScenarioSection: (sessionId, sectionId) => req('POST', `/sessions/${sessionId}/scenario-info/sections/${encodeURIComponent(sectionId)}/revert`),
    getRules: () => req('GET', '/rules'),
    searchRules: (query) => req('GET', `/rules/search?q=${encodeURIComponent(query)}`),
    getDomesticAdventure: () => req('GET', '/adventure/domestic'),
    getDomesticProgress: () => req('GET', '/adventure/domestic/progress'),
    saveDomesticProgress: (currentStep) => req('PUT', '/adventure/domestic/progress', { current_step: currentStep }),
    getDomesticSheet: () => req('GET', '/adventure/domestic/sheet'),
    saveDomesticSheet: (data) => req('PUT', '/adventure/domestic/sheet', { data }),
    deleteDomesticSheet: () => req('DELETE', '/adventure/domestic/sheet'),
    rollDice: (formula, preset) => req('POST', '/dice/rolls', { formula, preset }),
  };
})();
