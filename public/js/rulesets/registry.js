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
  const ALIASES = { '': DEFAULT_KEY, rol: 'rivers-of-london', coc: 'call-of-cthulhu-2e' };

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

  // Resolve a named capability (e.g. 'character') for a pack, inheriting the
  // default pack's implementation when this pack hasn't provided its own. This
  // is what lets a partially-built pack (Call of Cthulhu today shares the RoL
  // sheet engine) work before it overrides anything.
  function capability(key, name) {
    const pack = get(key);
    if (pack && pack[name]) return pack[name];
    const def = PACKS[DEFAULT_KEY];
    return (def && def[name]) || null;
  }

  // The selectable rulesets for the case-settings dropdown, flattened from each
  // pack's identity metadata. A pack declares:
  //   meta: { label, order, ruleset, defaultTier, tiers: [{ key, label }] }
  // where `ruleset` / tier `key` are the legacy column values we still persist
  // (sessions.ruleset + sessions.rules_tier), so this needs no DB change. A pack
  // with no tiers yields a single option (e.g. Call of Cthulhu).
  function options() {
    const out = [];
    Object.values(PACKS)
      .filter((p) => p.meta && p.meta.label)
      .sort((a, b) => (a.meta.order || 0) - (b.meta.order || 0) || a.key.localeCompare(b.key))
      .forEach((p) => {
        const m = p.meta;
        const tiers = (m.tiers && m.tiers.length) ? m.tiers : [{ key: m.defaultTier || 'basic', label: '' }];
        tiers.forEach((t) => {
          out.push({
            value: t.label ? `${p.key}:${t.key}` : p.key,
            label: t.label ? `${m.label} (${t.label})` : m.label,
            key: p.key,
            ruleset: m.ruleset,   // legacy sessions.ruleset value ('rol'/'coc')
            rules_tier: t.key     // legacy sessions.rules_tier value
          });
        });
      });
    return out;
  }

  // Map a dropdown value back to the legacy columns for persistence.
  function resolveSelection(value) {
    const hit = options().find((o) => o.value === value);
    return hit ? { ruleset: hit.ruleset, rules_tier: hit.rules_tier } : null;
  }

  // Map stored legacy columns to the dropdown value, to preselect the control.
  function selectionValue(ruleset, rulesTier) {
    const r = String(ruleset || '').toLowerCase() === 'coc' ? 'coc' : 'rol';
    const t = String(rulesTier || '').toLowerCase() === 'advanced' ? 'advanced' : 'basic';
    const opts = options();
    const hit = opts.find((o) => o.ruleset === r && o.rules_tier === t)
      || opts.find((o) => o.ruleset === r);
    return hit ? hit.value : (opts[0] && opts[0].value) || '';
  }

  if (root) {
    root.Rulesets = {
      DEFAULT_KEY, normaliseKey, register, get, capability,
      options, resolveSelection, selectionValue, _packs: PACKS
    };
  }
})(typeof window !== 'undefined' ? window : null);
