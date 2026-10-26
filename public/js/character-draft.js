(function (root) {
  'use strict';
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const control = ['id', 'user_id', 'owner', 'scope', 'session_id', 'session_ids', 'system', 'ruleset', 'portrait'];
  function clean(value, depth = 0) {
    if (depth > 20) throw new Error('Character draft is too deeply nested');
    if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) if (!forbidden.has(key)) out[key] = clean(child, depth + 1);
      return out;
    }
    return value;
  }
  function normalise(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Character draft must be a sheet object');
    if (JSON.stringify(value).length > 100000) throw new Error('Character draft is too large');
    const data = clean(value);
    if (typeof data.name !== 'string' || !data.name.trim()) throw new Error('A character name is required');
    data.name = data.name.trim().slice(0, 200);
    for (const key of control) delete data[key];
    return data;
  }
  function extract(text) {
    let draft = null;
    const blocks = String(text || '').matchAll(/```character-sheet\s*\n([\s\S]*?)```/g);
    for (const block of blocks) {
      try { draft = normalise(JSON.parse(block[1])); } catch { /* leave invalid drafts as chat text */ }
    }
    return draft;
  }
  function instructions(template) {
    if (!template || typeof template !== 'object' || Array.isArray(template)) return '';
    const json = JSON.stringify(clean(template));
    if (json.length > 30000) return '';
    return [
      '# Creating an importable character',
      'When the user asks to generate or revise a complete character from a synopsis, produce a proposed sheet using the exact field names and nested shapes in the blank sheet below.',
      'Follow the supplied game rules, characteristic ranges, creation budgets, skills and prerequisites. Do not mix in mechanics from another game. Ask for clarification if essential choices are missing.',
      'Explain assumptions and choices that need GM review in normal prose. The sheet is a draft; do not claim it has been saved or approved.',
      'After the explanation include exactly one fenced code block labelled character-sheet containing only the complete sheet as valid JSON. Do not put ownership, IDs, case scope, or image data in it.',
      'Only include this block for a complete character draft, never for an ordinary rules answer or a stat adjustment to an existing character.',
      'Blank sheet (shape only; fill the values to match the synopsis and rules):', json
    ].join('\n');
  }
  const api = { normalise, extract, instructions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterDraft = api;
})(typeof window === 'undefined' ? null : window);
