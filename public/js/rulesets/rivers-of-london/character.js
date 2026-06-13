// Rivers of London — character subsystem (pack-owned).
//
// Rules-specific character functions migrated out of public/js/sheet.js one at
// a time. The sheet engine reaches these via Rulesets.get(key).character.*.
// As more functions land here this becomes the RoL pack's full chargen module
// (the generic, ruleset-agnostic helpers stay in sheet.js). See
// docs/ruleset-modules.md.
(function (root) {
  'use strict';

  const Rulesets = root && root.Rulesets;
  if (!Rulesets) return; // registry.js must load first (see index.html)

  // Advanced rules: MOV drops by decade from the 40s (printed p.309).
  function ageMovAdjustment(age) {
    const a = parseInt(age, 10);
    if (!Number.isFinite(a) || a < 40) return 0;
    if (a >= 80) return -5;
    if (a >= 70) return -4;
    if (a >= 60) return -3;
    if (a >= 50) return -2;
    return -1; // 40s
  }

  Rulesets.register('rivers-of-london', { character: { ageMovAdjustment } });
})(typeof window !== 'undefined' ? window : null);
