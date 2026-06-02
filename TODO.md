# TODO

- **Base and advanced rule corpora are both built; app wiring is the next step.**
  The app-facing basic rules corpus (`Rivers_of_London/rules/00` through `11`)
  is extracted, PDF-checked, and marked `reviewed-complete`. The
  advanced/extended corpus is now built at `Rivers_of_London/rules-advanced/`
  (2026-06-02): the base rules with every optional rule from
  `Rivers_of_London/rules-advanced-source/12-advanced-options.md` applied in
  place, hand-authored and verified, so the site can surface a complete Core OR
  Advanced rule set without players cross-referencing. Derivation ledger:
  `Rivers_of_London/rules-advanced/mutation-map.md`. The earlier design question
  (append-as-section vs. mutated corpus) is resolved in favour of the mutated
  corpus.
  - **Done (2026-06-02): Rules tab now surfaces both corpora plus a changelog.**
    The Rules tab has a Core | Advanced | What's New switcher.
    `GET /api/rules?variant=advanced` serves the advanced corpus;
    `GET /api/rules/changes` builds a "What's New in Advanced" changelog from the
    `<!-- Advanced: <label> | add|supersede|supplement -->` provenance markers
    (badged New / Changed / Extended, grouped by chapter) so a player migrating
    from Core sees exactly what each advanced rule adds, replaces, or extends.
    `src/routes.js:loadRulesIndex(variant)` / `buildAdvancedChanges()`;
    `public/js/app.js:renderRulesTab()`. Verified end-to-end (all endpoints 200;
    advanced = 13 sections; 27 changelog entries).
  - **Done (2026-06-02): per-case Basic/Advanced rules setting drives AI Support.**
    Added a `rules_tier` (`basic`|`advanced`, default `basic`) column to
    `session_settings` (`src/db.js` CREATE + ALTER migration;
    `src/sessionRolls.js` get/setSettings). Admin -> Case Settings has a
    "Rules set" selector per case (`public/js/app.js:renderAdminCases`,
    `saveCaseRulesTier`). `/api/rules/chat` now resolves the corpus from the
    active case's `rules_tier` via `rulesVariantForSession()` in `src/routes.js`,
    so rules-grounded chat uses the advanced corpus when the case is set to
    Advanced (no case / global chat = basic). Verified: migration applies,
    settings round-trip, settings endpoint GET/PUT. NOTE: a running server must
    be restarted to apply the migration and code.
  - Rules-tab search (`/api/rules/search`) still uses Core only; wire it to the
    same per-case tier if search-during-play should follow the setting.
  - **Done (2026-06-02): character sheets branch on `rules_tier`.** Sheet
    endpoints return `rules_tier`; `public/js/sheet.js` gains `setRulesTier()` /
    `advancedEnabled()` and, when Advanced: Move is auto-derived (base 8,
    Speedy 9, Slow-Footed 5, age 40s−1…80s−5), the Flaws/Disadvantages field
    becomes a multi-select like Advantages (hidden under Basic, value preserved),
    an Experience-package picker appears, and characteristic dropdowns widen to
    20–90 (Basic stays 30–80 in 10s); saved out-of-range values are preserved.
    The characteristic range constrains players only — a GM editing any sheet
    (`SheetForm.setGmEditor`, role-based) gets the full unconstrained grid, so
    NPC and exceptional/demi-monde stats aren't clamped.
    Verified: MOV/stat-range math, endpoints carry rules_tier. Restart the
    server to load the routes change.
  - The Bookshop sandbox, broader lore/settings seeding, and visibility redesign
    remain parked in the same handoff file.

- **Remaining rulebook extraction targets.** Use the tracking files under
  `Rivers_of_London/rules/tracking/` as the source of truth. The basic rules
  prerequisite for advanced-rule mutation is complete. Known remaining areas
  include scenario/lore extraction from Chapters 6-7 and appendix material only
  where it is useful as source pointers or safe reusable data. Chapter 8 now has
  a paraphrased, resettable built-in case rather than a general rules reference.

- **NPC portrait extraction and restyle pass.** Manually audit rulebook source
  images against NPC/character names, then run
  `npm run portrait:restyle -- --session <case> --character <name> --image <path>`
  for each approved match. The script writes the generated local portrait back
  into the session character sheet, whether the target is a player character or
  an allocated NPC, so the browser becomes the review surface. Use
  `--session Global` or `--session 0` for central NPCs that are not allocated to
  a case. Keep original
  rulebook image paths as extraction notes/source mapping only; do not surface
  them through player-facing sheets.

- **Per-character/private handout visibility.** A basic read-only player
  **Handouts** tab now lists player-visible Markdown, graphics, and PDFs without
  edit/delete controls. The remaining gap is finer-grained artifact visibility:
  per-character handouts, archived artifacts, and a clearer GM workflow for
  granting/revoking access without moving files between folders.

- **Case ownership and GM permissions.** The app currently has role-only GM
  authority: every GM can manage every case. This is acceptable for the Bookshop
  teaching/demo case, but it will not hold once multiple GMs each own different
  cases. Add case ownership or GM-case allocation before supporting independent
  GM-run campaigns.

- **Visibility-set artifacts (master folder + audience copies).** Replace the
  folder-based GM-only/Player-Handout toggle with a per-artifact visibility
  set. Layout:
  - `Gallery/_master/<file>` — canonical copy; never walked by the source/
    asset listers and never fed to the LLM.
  - `Gallery/all/`, `Gallery/gm/`, `Gallery/<userId>/` — a **copy** of the
    file in each audience that may see it (copies, not hard links — robust
    on every filesystem; files are tiny vs. the app).
  - The visibility set = which audience folders contain `<file>` (matched by
    filename). Empty set (master only) = **archived**. Grant = copy
    master→audience; revoke = delete that audience copy; delete = remove
    master + all copies.
  - **Replace** overwrites every audience copy that has the file; **Rename**
    renames master + all copies together (copies don't share an inode).
  - Asset route, listers, and the prose injector consult audience folders
    only; a player is served a file only if it is in `all/` or their own
    `<userId>/`. Per-character artifacts surface display-time in a
    "From the GM" section at the foot of that player's view — never via the
    shared-prose injector.
  - Keyed by user/account id, labelled by character in the UI. New handouts
    / extracted NPC portraits default to the `gm` audience.
  - Edit Files: the GM Only ⇄ Player Handout control becomes a multi-select
    of {GM, All, each character}; clearing all archives it; the list always
    shows every master file so archived artifacts stay reachable.

  This single feature replaces the folder toggle and subsumes per-character
  private clues AND archive/unarchive.

- **Letter / document handouts (.md → PDF via deterministic recipe parser).**
  In-world PDF handouts (letter of introduction, departmental order, lab/
  forensics report) from a Markdown source.
  - **Priority: the deterministic `.md` → PDF export pipeline.** A "Make PDF"
    action on a selected `.md` in the Edit Files screen (GM-only) renders it
    with a **deterministic recipe parser** — NOT the LLM (it can't emit PDF,
    is non-deterministic, and contends on the shared GPU). Reuse the existing
    `pdf-lib` toolkit from `scripts/export-character-sheet.js` (`wrap()`
    text-flow + `drawText` + `embedPng`).
  - `.md` frontmatter carries structured fields (To/From/Ref/Date/recipe);
    body is the prose.
  - Per-case **recipes** = a declarative layout file (margins, fonts, header
    image, header/footer, body region) plus the recipe's letterhead/logo
    `.png`s, stored in the case data folder. The recipe *places* the PNGs
    (not inline markdown images) so logos stay consistent across handouts.
    Logos are generate/upload-once assets, never regenerated per handout.
    Fits the per-case-settings pattern and the visibility-set artifact work.
  - **New hard part vs. the char-sheet exporter** (single-page, fixed
    coords): handouts need **multi-page flow** — a layout cursor, `addPage()`
    on overflow, header/footer repeated per page.
  - Markdown parsing: a light dep (`marked`/`markdown-it`) or a hand-rolled
    minimal subset — both far lighter than a headless-browser renderer.
  - Secondary / later: per-case recipe management UI; an optional, strictly
    upstream "LLM drafts the `.md`" action (separate from rendering).

- **Per-session scenario generation (replace the single session-summaries
  call).** Today `player.summary.session_summaries` is one LLM call that must
  emit a JSON array covering *every* session from a prompt containing all case
  files (incl. the 56 KB `session-02.md`). A small/!128K model can't, returns
  non-conforming JSON, `regenerateScenarioSection` throws at
  `JSON.parse(extractJsonCandidate(...))` **before persisting**, so nothing is
  saved (this is why a freshly-added `Session-01.md` "never appears" — not a
  source-collection or casing bug; the file *is* fed). The `num_ctx` clamp
  (done) stops the 2× context over-request but a marginal combined prompt on a
  small model is still unreliable.
  - **"Story so far"** (`summary.what_has_happened`): one call over all case
    files (prose, forgiving) — keep as is.
  - **Session summaries**: stop asking for the whole array in one call.
    **Iterate per session as separate generation tasks**, each with a
    *curated* minimal input = the "story so far" + that one session's
    transcript. Assemble the array **deterministically in code** (one element
    per session file, stable `id` from the filename) — the model never
    manages/"preserves" an array.
  - Detect session files case-insensitively, e.g. `/^session[-_ ]?0*(\d+)\.md$/i`
    (so `Session-01.md` and `session-02.md` both map, → ids `session-1/2`).
    Curated list = that convention now; explicit per-case mapping later
    (dovetails with the per-case recipe/config direction).
  - Generate in session order; each gets the global "story so far". Naturally
    sequential ⇒ fits the AI-exclusivity gate with no extra work. Localised
    failure (one session) instead of nuking the whole section.
  - Later refinement: build "story so far" incrementally so it never needs the
    full combined prompt either.

## Done

- **Link artifacts to entities.** Delivered: deterministic post-generation
  injector matches in-scope image filenames (separator-wildcarded prefix
  match) to entity names/headings; NPC sheet portraits auto-extracted from
  the DB to player-Gallery files and rendered per-card at 0.3LHS; filename
  layout tags (`<frac>LHS|RHS|FW`).
