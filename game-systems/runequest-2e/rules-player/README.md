# RuneQuest (2nd Edition) — Extracted Play Corpus

A compact, paraphrased rules reference distilled from the *RuneQuest* 2nd edition rulebook
(Chaosium, 1978–80, by Steve Perrin & Ray Turney), staged privately as a scanned PDF under
`private/runequest-2e/CH4001 - Runequest - Rules 2nd edition.pdf`. It mirrors the treatment of
`game-systems/call-of-cthulhu-2e/` and `game-systems/rivers-of-london/rules/` — all three are
Basic Role-Playing (BRP) relatives.

## One book

Unlike Call of Cthulhu (whose Mythos bestiary is a Keeper secret, hence its `rules-player`/`rules-gm`
split), RuneQuest has little true spoiler divide — cults and rune magic are player-facing character
options. So the corpus is a **single book** in `rules-player/`, served to everyone. Every file uses
the `NN-*.md` convention so the app loads them all.

The goal is a functional ruleset for experienced roleplayers: complete mechanical coverage, terse
wording, no conversational teaching style — every rule nuance needed at the table, without flavour,
worked examples, fiction, or copied prose.

## Files (ordered by conceptual dependency, not the book's teaching order)

- `00-system-overview.md` — what RuneQuest is, dice, core concepts, the melee round at a glance.
- `01-characteristics.md` — STR/CON/SIZ/INT/POW/DEX/CHA; how rolled; derived attributes & their tables.
- `02-core-resolution.md` — percentile rolls, success/critical/fumble, resistance, opposed actions.
- `03-character-creation.md` — rolling characteristics, prior experience, starting money & equipment.
- `04-skills.md` — non-combat skills and base chances.
- `05-advancement.md` — experience checks, training, guilds & brotherhoods.
- `06-combat.md` — time, movement, encumbrance, the melee round, strike rank, hit location,
  attack/parry/dodge, special damage, weapons/shields/armour/helmets, missiles.
- `07-damage-and-healing.md` — hit points, hit-location damage, healing, death.
- `08-magic.md` — magic points, battle magic, casting, spirit combat, shamans.
- `09-battle-magic-spells.md` — the battle-magic spell descriptions.
- `10-rune-magic-and-cults.md` — runes, cults, rune lords/priests, rune spells, elementals.
- `11-monsters.md` — creatures and non-human races, with non-humanoid hit locations.
- `12-treasure.md` — treasure hoards and special items.
- `13-quick-reference.md` — at-the-table tables (strike ranks, hit locations, resistance).

## Ground rules

- **Reproduce mechanical tables verbatim** (characteristic effects, strike ranks, hit locations,
  weapon/armour stats, spell costs, base chances). Paraphrase only prose.
- Restate rules in original, compact wording; do not copy descriptive/flavour prose.
- Keep the source **private** (the rulebook is copyrighted), as with the RoL and CoC corpora.
- A file is `extracted-draft` until its source pages pass the PDF gate, then `reviewed-complete`.

## Source & tracking

The PDF is a 130-page scan with **no text layer**. An OCR scaffold (Tesseract over high-DPI page
renders) is built by `npm run extract:rq` → `private/runequest-2e/extracted-source/` (`pdf-text/`
per-page OCR + `pages/` 200-DPI images for the gate). The OCR is a draft; tables/stat-blocks/columns
are corrected against the page images during distillation. QA bookkeeping (chapter map, page
calibration, gate status) lives privately in `private/runequest-2e/tracking/`.
