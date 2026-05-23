# Advanced Rules Source

This folder holds extracted optional/advanced rule material that must not be
loaded as part of the app-facing base rules by a wildcard over
`Rivers_of_London/rules/`.

Use these files as audited source summaries when designing a later advanced
rules corpus. Some advanced rules modify earlier procedures, so they should not
be appended blindly to the base rule set.

The likely later shape is:

- `Rivers_of_London/rules/` remains the base rule corpus.
- `Rivers_of_London/rules-advanced-source/` keeps the extracted optional-rule
  source summaries.
- A reviewed `Rivers_of_London/rules-advanced/` corpus may be generated or
  maintained from the base rules plus explicit advanced-rule mutations.
