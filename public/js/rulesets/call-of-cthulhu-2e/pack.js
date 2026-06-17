// Call of Cthulhu — pack identity (manifest), stub.
//
// Identity only for now: it makes "Call of Cthulhu" a first-class option in case
// Settings and persists as the legacy CoC-style ruleset (SIZ + SIZ-derived
// HP/Build, handled today inside sheet.js). No tier split — one option. Its own
// chargen/corpus will be filled in later (the rules text is copyright, same
// constraint as the bundled RoL content, so the corpus must be supplied
// privately). See docs/ruleset-modules.md.
(function (root) {
  'use strict';
  const Rulesets = root && root.Rulesets;
  if (!Rulesets) return; // registry.js must load first (see index.html)

  Rulesets.register('call-of-cthulhu-2e', {
    meta: {
      label: 'Call of Cthulhu',
      edition: '2nd ed',       // edition lives in the key (call-of-cthulhu-2e) + here
      order: 20,
      ruleset: 'coc',          // legacy sessions.ruleset value
      defaultTier: 'basic'     // no tier split -> single option
    }
  });
})(typeof window !== 'undefined' ? window : null);
