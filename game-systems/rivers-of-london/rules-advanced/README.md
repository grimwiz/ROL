# Rivers of London — Advanced (Integrated) Rules Corpus

This folder is the **advanced rules corpus**: the base rules from
`Rivers_of_London/rules/` with the optional/advanced rules from
`Rivers_of_London/rules-advanced-source/12-advanced-options.md` already applied
in place.

The goal is a single self-contained rule set an experienced group can read
straight through. A reader of this corpus never has to cross-reference a
separate "optional rules" appendix: where an advanced rule changes a base
procedure, the change has been made here; where an advanced rule adds an
option, it sits next to the base rule it extends, clearly labelled.

The app surfaces **either** the base corpus (`rules/`) **or** this advanced
corpus (`rules-advanced/`), depending on the per-case Extended Rules setting.
The two folders are parallel: same numbered files, same headings, so a switch
between them is seamless for the player.

## Relationship to the other rules folders

- `Rivers_of_London/rules/` — base/core corpus. Source of truth for any rule
  not touched by an advanced option. Files here are copied from there and then
  mutated.
- `Rivers_of_London/rules-advanced-source/12-advanced-options.md` — the audited
  extraction of the rulebook's optional rules (printed p.309–335). Source of
  truth for every advanced mutation. **Not** loaded by the app.
- `Rivers_of_London/rules-advanced/` — this corpus, derived from the two above.

## How mutations are marked

- **Visible label.** An advanced addition or replacement carries an
  `(Advanced option)` tag in its heading, or an `*Advanced option:*` lead-in
  for an inline rule, so a reader can still see which rules are optional and
  GM-gated.
- **Provenance comment.** Each mutation is preceded by an HTML comment
  `<!-- Advanced: <section> | add|supersede|supplement -->`. These comments are
  stripped from the public render (same as the base `<!-- Source: -->`
  comments) and exist only for audit.
- **supersede** = the advanced rule replaces a base procedure; the base text is
  edited in place so the corpus never contradicts itself.
- **supplement** = the advanced rule changes or extends a base procedure for
  specific cases; added as a labelled subsection beside the base rule.
- **add** = a wholly new advanced topic with no base equivalent (e.g. troupe
  play); added as a new labelled section or, where it has no base file at all,
  in `12-advanced-campaign.md`.

`mutation-map.md` is the full ledger: every advanced section, the file/heading
it lands in, and its classification.

## Maintenance

This corpus is hand-authored. If a base file in `rules/` changes, replay the
relevant mutations here using `mutation-map.md`. Locked content (numbers, table
values, defined terms, reproduced tables) must match the PDF exactly; only
editorial prose is paraphrased.
