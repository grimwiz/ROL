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
  };
})();
