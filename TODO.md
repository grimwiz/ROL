# TODO

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
