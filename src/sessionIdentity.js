const { scopeNameKey, sheetScope, sheetHasCase } = require('./characterScope');

// Character membership is stored by case name. Keep those references and the
// session row in one transaction whenever the display name changes.
function updateSessionIdentity(db, sessionId, name, description) {
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!previous) return null;
    const conflict = db.prepare('SELECT id, name FROM sessions WHERE id != ?').all(previous.id)
      .some((s) => scopeNameKey(s.name) === scopeNameKey(name));
    if (conflict) {
      const error = new Error('A case with that name already exists');
      error.statusCode = 409;
      throw error;
    }
    db.prepare('UPDATE sessions SET name = ?, description = ? WHERE id = ?')
      .run(name, description || null, previous.id);
    let relinked = 0;
    if (previous.name !== name) {
      const update = db.prepare('UPDATE character_sheets SET data = ? WHERE id = ?');
      for (const row of db.prepare('SELECT id, data FROM character_sheets').all()) {
        let data;
        try { data = JSON.parse(row.data); } catch { continue; }
        if (!sheetHasCase(data, previous.name)) continue;
        const scope = sheetScope(data).map((s) => scopeNameKey(s) === scopeNameKey(previous.name) ? name : s);
        data.scope = sheetScope({ scope });
        update.run(JSON.stringify(data), row.id);
        relinked++;
      }
    }
    return { previous, relinked };
  })();
}

module.exports = { updateSessionIdentity };
