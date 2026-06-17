// Rivers of London — pack identity (manifest).
//
// Declares how this ruleset is presented in case Settings and which legacy
// columns each choice persists to. Two tiers (Basic / Advanced) become two
// selectable options: "Rivers of London (Basic)" and "(Advanced)". The sheet
// engine, Rules tab, and AI grounding all follow the case's stored ruleset +
// rules_tier. See docs/ruleset-modules.md.
(function (root) {
  'use strict';
  const Rulesets = root && root.Rulesets;
  if (!Rulesets) return; // registry.js must load first (see index.html)

  Rulesets.register('rivers-of-london', {
    meta: {
      label: 'Rivers of London',
      order: 10,
      ruleset: 'rol',          // legacy sessions.ruleset value
      defaultTier: 'basic',
      tiers: [
        { key: 'basic', label: 'Basic' },
        { key: 'advanced', label: 'Advanced' }
      ]
    }
  });
})(typeof window !== 'undefined' ? window : null);
