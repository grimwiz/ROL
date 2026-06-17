# Call of Cthulhu (2nd Edition) — Extracted Play Corpus

A compact, paraphrased rules reference for *Call of Cthulhu* 2nd Edition (Chaosium), distilled from the box set staged privately under `private/call-of-cthulhu-2e/`. It mirrors the structure and presentation of `game-systems/rivers-of-london/rules/` (both are Basic Role-Playing cousins).

## Two rulebooks

The corpus ships as **two complete, self-contained books** rather than one file set that hides or reveals content by reader:

- **`rules-player/`** — the player rulebook. Everything an investigator needs to play and stay compatible at the table, with **no Mythos spoilers**: characteristics, resolution, character creation, skills, combat, damage, the Sanity system, the player-facing magic mechanics, generic (non-Mythos) creatures, equipment, and 1920s reference.
- **`rules-gm/`** — the Keeper rulebook. The complete reference: the same files **plus** the full magic/spell catalog, the Mythos bestiary, Mythos lore and tomes, and Keeper procedures.

The folder names use the `rules-<audience>` convention so the app can identify each book programmatically.

The two books share the spoiler-free files verbatim (`00`-`07`, `09`, `10`, `11`); only the magic file (`08`) differs (player = mechanics only; GM = full catalog), and the GM book carries the additional Mythos files (`bestiary`, `keeper-procedures`, `mythos-lore-and-tomes`). A fix to a shared file must be applied to both copies. Non-Mythos creatures (`09`) and the historical 1920s reference (`11`) are not spoilers, so they live in both books.

## Conventions

- Mechanical tables are reproduced verbatim; all prose is rewritten (copyright posture).
- The bundled ready-to-play scenarios (*The Haunted House*, *The Madman*) are excluded; if shareable they become "cases".
- Every file has passed the PDF gate (`reviewed-complete`). QA bookkeeping lives privately in `private/call-of-cthulhu-2e/tracking/` (`pdf-review.md`, `source-map.md`, `parse-issues.md`) — out of the served game-data area.

## Source

Verbatim OCR-corrected seed: `private/call-of-cthulhu-2e/extracted-source/rulebook-relevant.md` (built by `npm run extract:coc` + `npm run clean:coc`; mechanical tables hand-verified against the page images). Source is copyrighted and stays gitignored; only this distilled corpus is tracked.

## Layout

```
game-systems/call-of-cthulhu-2e/
  rules-player/   00–07, 08-magic (player), 09-beasts-and-creatures, 10-equipment, 11-the-1920s-reference
  rules-gm/       00–11 (full 08) + bestiary, keeper-procedures, mythos-lore-and-tomes
private/call-of-cthulhu-2e/
  tracking/       pdf-review, source-map, parse-issues   (QA records, gitignored)
```
