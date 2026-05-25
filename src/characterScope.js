// Case scope lives inside the character sheet JSON as data.scope, an array of
// case names. Membership comparison is case-insensitive and whitespace-tolerant
// so seeded sheets ("the bookshop") match user-renamed cases ("The Bookshop").

function scopeNameKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function sheetScope(sheet) {
  if (!sheet || typeof sheet !== 'object') return [];
  const raw = Array.isArray(sheet.scope)
    ? sheet.scope
    : typeof sheet.scope === 'string' ? sheet.scope.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const name = String(v == null ? '' : v).trim();
    if (!name) continue;
    const key = scopeNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function sheetHasCase(sheet, caseName) {
  const key = scopeNameKey(caseName);
  if (!key) return false;
  return sheetScope(sheet).some((n) => scopeNameKey(n) === key);
}

function addCaseToScope(sheet, caseName) {
  const name = String(caseName == null ? '' : caseName).trim();
  if (!name) return sheet || {};
  const base = sheet && typeof sheet === 'object' ? sheet : {};
  if (sheetHasCase(base, name)) return base;
  return { ...base, scope: [...sheetScope(base), name] };
}

function removeCaseFromScope(sheet, caseName) {
  const key = scopeNameKey(caseName);
  if (!key) return sheet || {};
  const base = sheet && typeof sheet === 'object' ? sheet : {};
  return { ...base, scope: sheetScope(base).filter((n) => scopeNameKey(n) !== key) };
}

module.exports = {
  scopeNameKey,
  sheetScope,
  sheetHasCase,
  addCaseToScope,
  removeCaseFromScope
};
