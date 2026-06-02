# Advanced Rules Source

This folder holds extracted optional/advanced rule material that must not be
loaded as part of the app-facing base rules by a wildcard over
`Rivers_of_London/rules/`.

Use these files as audited source summaries when designing a later advanced
rules corpus. Some advanced rules modify earlier procedures, so they should not
be appended blindly to the base rule set.

This shape is now realised (2026-06-02):

- `Rivers_of_London/rules/` remains the base rule corpus.
- `Rivers_of_London/rules-advanced-source/` keeps the extracted optional-rule
  source summaries (this folder).
- `Rivers_of_London/rules-advanced/` is the reviewed advanced corpus,
  hand-authored from the base rules plus the explicit advanced-rule mutations
  in `12-advanced-options.md`. See `../rules-advanced/mutation-map.md` for the
  full derivation ledger and `../rules-advanced/README.md` for the marking
  convention.

When a base file in `Rivers_of_London/rules/` changes, replay the affected
mutations from this file into `Rivers_of_London/rules-advanced/` using that
mutation map.
