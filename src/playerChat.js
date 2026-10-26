const fs = require('fs');
const { sheetHasCase } = require('./characterScope');

// Player-character chat uses the same saved story as Character Stories. The
// caller supplies the existing case-path and story-visibility helpers.
function createPlayerChat({ pathsForSession, personalityForName, filterStory }) {
  function list(session, db) {
    if (!session) return [];
    const rows = db.prepare(`
      SELECT cs.id, cs.user_id, cs.data, u.username
      FROM character_sheets cs
      JOIN users u ON u.id = cs.user_id
      JOIN session_players sp ON sp.user_id = u.id AND sp.session_id = ?
      WHERE u.role = 'player'
      ORDER BY cs.id
    `).all(session.id);
    return rows.flatMap((row) => {
      let data;
      try { data = JSON.parse(row.data); } catch { return []; }
      if (!data || !sheetHasCase(data, session.name) || !String(data.name || '').trim()) return [];
      return [{ slug: `pc:${row.id}`, name: String(data.name).trim(), kind: 'player',
        character_id: row.id, user_id: row.user_id, username: row.username,
        allocated: true, portrait: typeof data.portrait === 'string' ? data.portrait : '' }];
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function story(session, character, user, db) {
    let entries;
    try {
      const artifact = JSON.parse(fs.readFileSync(pathsForSession(session).scenarioInfo, 'utf8'));
      entries = artifact.entities && artifact.entities.characters;
    } catch { return ''; }
    if (!Array.isArray(entries)) return '';
    const key = character.name.toLowerCase();
    const id = `char-${key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`;
    const entry = entries.find((e) => e && String(e.name || '').trim().toLowerCase() === key)
      || entries.find((e) => e && e.id === id);
    const visible = entry && filterStory(entry, character, user, session, db);
    return visible && typeof visible.content === 'string' ? visible.content.trim() : '';
  }

  function resolve(session, slug, user, db) {
    const character = list(session, db).find((p) => p.slug === slug);
    if (!character) return null;
    const row = db.prepare('SELECT data FROM character_sheets WHERE id = ?').get(character.character_id);
    const data = JSON.parse(row.data);
    const full = user && (user.role === 'gm' || user.id === character.user_id);
    const sheet = full ? { ...data } : { name: character.name, occupation: data.occupation || '' };
    for (const key of ['portrait', 'scope', 'user_id', 'session_ids']) delete sheet[key];
    const personality = full ? personalityForName(session, character.name) : null;
    const notes = personality && personality.body ? personality.body : '';
    return {
      ...character,
      body: `You are the player character ${character.name}, not the real person who plays them. `
        + 'Use your own Character Story as your memory of this case. Do not invent past events or make binding decisions for the human player. '
        + 'If your available story does not establish something, say you do not know or ask the speaker.\n\n' + notes,
      knowledge: story(session, character, user, db),
      characterSheet: JSON.stringify(sheet, null, 2),
      world: '', setting: '', source: 'player-story'
    };
  }

  return { list, story, resolve };
}

module.exports = { createPlayerChat };
