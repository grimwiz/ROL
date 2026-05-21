# Extracted Rivers of London Play Corpus

This folder is the working home for a compact, paraphrased rules and scenario reference derived from the Rivers of London RPG rulebook source files staged under `private/rulebook-source/`.

The goal is a player- and GM-usable corpus for experienced roleplayers: complete mechanical coverage, terse wording, and no conversational teaching style. It should preserve every rule nuance needed at the table while avoiding unnecessary flavour, examples, fiction, and copied prose.

## Layout

- `NN-*.md` - core and optional game mechanics needed to play. Files marked `extracted-draft` in their source comments have not yet had final completeness review.
- `scenario/` - setting, Folly process, policing, locations, organisations, NPC-useful background, and case-design material.
- `source/` - instructions for raw source staging in the gitignored repo-root `private/` folder.
- `prompts/` - prompt sequence for inventory, outline, drafting, and completeness review.
- `tracking/` - source coverage, subject routing, PDF gate status, parse concerns, and review history.

Expected rules coverage includes:

- System overview, character model, character creation, and advancement.
- Skills, core d100 procedures, Luck, opposed rolls, impairment, and development.
- Combat, damage, healing, chases, and vehicles.
- Newtonian magic, spellcasting, vestigia, signare, and spell lists.
- Demi-monde mechanics and optional rules.

## Ground Rules

- Do not extract the solo game material from *The Domestic* into the playable corpus.
- Keep `Rivers_of_London/globaldata/` unchanged unless a later task explicitly asks to wire extracted scenario material into the app.
- Treat `private/rulebook-source/cha3200_-_rivers_of_london_1.4.md` as the primary drafting source, but do not mark any section complete until the relevant printed pages have passed the PDF gate in `tracking/pdf-review.md`.
- Use the tracking files before and after each extraction pass so the work can proceed in small, auditable slices.
- Organise the final extracted files by conceptual dependency and table usefulness, not by the rulebook's teaching order.

## Workflow

1. Run `npm run extract:source` to build the gitignored raw seed in `private/extracted-source/`.
2. Use `tracking/source-inventory.md`, `tracking/logical-outline.md`, and the prompts in `prompts/` to establish the extraction order.
3. Draft one target file at a time with `prompts/02-rules-draft.md` or `prompts/03-scenario-draft.md`.
4. Review each draft with `prompts/04-completeness-review.md`, including direct PDF comparison for the source page range.
5. Update `tracking/pdf-review.md` with checked ranges, open gaps, reparse needs, and closed gaps.
6. Update `tracking/source-map.md`, `tracking/subjects.md`, `tracking/review-log.md`, and `tracking/parse-issues.md` as needed.
