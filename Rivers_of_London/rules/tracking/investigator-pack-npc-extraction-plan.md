# Plan: Investigator Pack → unowned NPC characters

Status: **planned, not started.** Saved at the user's request. Task B (Bookshop
handouts) is being handled separately.

## Source

`private/rulebook-source/Rivers_of_London_RPG_-__Investigator_Pack.pdf` — 13 pages:
- p1: title + licence text. The licence grants an explicit exception for copying
  "character sheets, maps, handouts, and rules summaries **for in-game use**."
- **p2–13: twelve full-page 300-dpi JPEG images** — pre-generated investigator
  sheets. **No embedded text** (`pdftotext` returns 0 chars; `pdfimages -list`
  shows one 2475×3225 image per page).

Optional companion: `…NPC_Portrait_Pack.pdf` for matching portraits.

## Key constraint

The sheets are flattened images, so there is nothing to parse — extraction needs
**OCR or a local vision model**, not text extraction. Accuracy on a dense stat
block is the main risk.

## Target shape (already established in repo)

Canonical characters are `Rivers_of_London/globaldata/npcs/<slug>.json`, seeded
into the `character_sheets` table by `src/npcSeed.js` (`seedNpcArchives`) at
startup / `npm run npcs:seed`. Schema is exactly `abigail-kamara.json`:
`name`, `scope[]`, `role`, `status`, `location`, `summary`, `notes`,
`sheet{ pronouns, occupation, age, …, str/con/dex/int/pow/siz, advantages,
combat_skills[], common_skills[], mandatory_skills[], additional_skills[],
weapons[], magic_tradition, magic_notes, magic_spells[], derived{hp/san/mp/build/
move}, custom_fields[] }`.

- **Unowned NPC** = `user_id` null (owner NPC). To leave them unallocated for
  manual assignment to players, set **`scope: []`** (empty) — the seeder creates
  the sheet but allocates it to no case; assigning an owner later converts it to
  that player's character (unified model).

## Precedent found

`Rivers_of_London/canonical/cases/bookshop/npcs/pc-karnam-singh.json` is a
case-bundled pre-gen using the **same schema** with `scope: ["The Bookshop"]`.
That `npcs/` folder is seeded by `seedNpcArchives` (by scope), and is explicitly
**skipped** by the case file-copy. So:
- Investigator Pack pre-gens that should be **global/unowned** → `globaldata/npcs/`
  with empty scope.
- Any investigator meant as a *specific case's* pre-gen → that case's `npcs/`
  folder with a scope, like Karnam Singh.

## Approach

1. **Render** pages 2–13 to PNG (`pdftoppm`/`pdfimages`, 300 dpi) — one image per
   investigator.
2. **Lock the field map first:** transcribe ONE sheet to JSON and verify every
   sheet-region → schema-field mapping against `abigail-kamara.json` before bulk
   work. De-risks the run.
3. **Transcribe the rest** with the local vision model on the Ollama box, using the
   locked mapping; emit one `globaldata/npcs/<slug>.json` per investigator.
4. **`owner = NPC`, `scope = []`** (unallocated global roster).
5. **Provenance:** `notes`/`source` noting "Investigator Pack (in-game-use
   licence), p<N>".
6. **(Optional)** pull matching portraits from the NPC Portrait Pack into the
   existing portrait pipeline.
7. **Verify:** `npm run npcs:seed` against a scratch DB → confirm 12 sheets appear;
   spot-check 2–3 transcriptions against the source images.

## Open decisions (need user input before building)

1. **Transcription engine:** local vision model vs. OCR + manual cleanup. (Lock one
   sheet first either way.)
2. **Commit vs. gitignore:** `globaldata/` is git-tracked, so these stat blocks
   would be committed (matching the existing NPC JSONs). If the stat blocks should
   not enter git despite the in-game-use licence, seed them from a gitignored path
   instead.

## Tooling note

A small reusable `scripts/extract-pdf-assets.js` (render pages → OCR/vision →
emit JSON) would make this repeatable for other pre-gen packs and cases.
