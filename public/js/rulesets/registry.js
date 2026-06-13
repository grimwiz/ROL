// Ruleset pack registry.
//
// ROL is a no-build vanilla app, so packs self-register onto window.Rulesets
// from their own <script> files, assembled in load order (see index.html).
// A case selects a pack by key (sessions.ruleset); the host asks
// Rulesets.get(key) for the active pack and drives the rules-specific bits
// (character generation, and in time the Rules tab / corpus / branding) from it.
//
// Functions are migrated out of the monolith one at a time: create the pack
// member here, delete it from the parent file, repoint the caller. See
// docs/ruleset-modules.md.
(function (root) {
  'use strict';

  const PACKS = {};
  const DEFAULT_KEY = 'rivers-of-london';
  // Legacy short keys persisted on cases/sheets map to full pack keys. An
  // unknown key falls through to DEFAULT_KEY so nothing renders blank.
  const ALIASES = { '': DEFAULT_KEY, rol: 'rivers-of-london', coc: 'call-of-cthulhu' };

  function normaliseKey(key) {
    const k = String(key || '').trim().toLowerCase();
    return ALIASES[k] || k || DEFAULT_KEY;
  }

  // Merge a partial onto a pack record. Capability sub-objects (e.g. `character`)
  // are merged one level deep so sibling pack files can each contribute a few
  // functions to the same capability without clobbering one another.
  function register(key, partial) {
    const k = normaliseKey(key);
    const pack = PACKS[k] || (PACKS[k] = { key: k });
    for (const [name, value] of Object.entries(partial || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)
          && pack[name] && typeof pack[name] === 'object') {
        Object.assign(pack[name], value);
      } else {
        pack[name] = value;
      }
    }
    return pack;
  }

  // Resolve a pack by (possibly legacy) key, falling back to the default pack.
  function get(key) {
    const k = normaliseKey(key);
    return PACKS[k] || PACKS[DEFAULT_KEY] || null;
  }

  if (root) root.Rulesets = { DEFAULT_KEY, normaliseKey, register, get, _packs: PACKS };
})(typeof window !== 'undefined' ? window : null);
