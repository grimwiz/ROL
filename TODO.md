# TODO

> **Reconciled 2026-06-08 against the code.** An earlier agent session was
> cleared before it wrote its completed work back here, so this list had drifted
> out of date. Items that the code already implements have been moved to
> **## Done**; everything under **## Outstanding work** below has been verified as
> genuinely still pending and is framed as a proposal (Gap → Goal → Effort).
> Effort sizing: **S** ≈ ½–1 day, **M** ≈ 2–3 days, **L** ≈ ~1 week, plus any
> noted prerequisites.

## Outstanding work (proposal)

### 1. Session capture — optional cleanups (no longer a bug)
- **Gap.** The capture bug (502s / lost words) is **fixed**: the STT service was
  made concurrent (see `../scripts/stt`), and locally the capture path now
  serialises ingest (`ingestChain`), single-flights diarization (`diarBusy` +
  `runDiarFlush`), and retries `liveTranscribe` 3× before dropping words
  (`03d15cb`). What remains are the three efficiency follow-ups that assumed a
  diarize-only endpoint — they were never applied because concurrency was the
  real fix. Today `diarizeAudioBuffer` still calls `/v1/transcribe?diarize=true`
  (re-transcribes every diarized window), the "no-words-no-voice" phantom-speaker
  filter is still server-side (`src/routes.js` ~1121–1135), and the band-aids
  (retry loop, quiet final-flush from `0a02191`) are still in place.
- **Goal.** Switch `diarizeAudioBuffer` to the new **`/v1/diarize`** (turns +
  voiceprints, no re-transcription); move the phantom-speaker filter client-side
  (keep a pyannote speaker only if its turns overlap a live segment that has
  text); re-test end-to-end (no lost words / no 502s) and remove the band-aids
  that are then unneeded. Net effect: less GPU work per window and a cleaner
  capture path.
- **Effort.** **S–M**, *gated on* the `/v1/diarize` endpoint being validated on
  the GPU box. Lower priority now that capture works — do it when touching this
  area, not as an emergency.

### 3. Visibility-set artifacts (master folder + audience copies)
- **Gap.** Artifact visibility is still the coarse folder-based GM-only ⇄
  Player-Handout toggle. There is no per-artifact, per-audience visibility, no
  per-character private handouts, and no archive/unarchive — no `_master`/
  audience-folder code exists in the tree.
- **Goal.** Replace the folder toggle with a per-artifact **visibility set**:
  - `Gallery/_master/<file>` — canonical copy; never walked by the source/asset
    listers, never fed to the LLM.
  - `Gallery/all/`, `Gallery/gm/`, `Gallery/<userId>/` — a **copy** of the file
    in each audience that may see it (copies, not hard links — robust on every
    filesystem; files are tiny vs. the app).
  - Visibility set = which audience folders contain `<file>` (matched by
    filename). Empty set (master only) = **archived**. Grant = copy
    master→audience; revoke = delete that audience copy; delete = remove master +
    all copies. **Replace** overwrites every audience copy; **Rename** renames
    master + all copies together.
  - Asset route, listers, and the prose injector consult audience folders only; a
    player is served a file only if it is in `all/` or their own `<userId>/`.
    Per-character artifacts surface display-time in a "From the GM" section at the
    foot of that player's view — never via the shared-prose injector.
  - Keyed by user/account id, labelled by character in the UI. New handouts /
    extracted NPC portraits default to the `gm` audience. Edit Files: the GM Only
    ⇄ Player Handout control becomes a multi-select of {GM, All, each character};
    clearing all archives it; the list always shows every master file so archived
    artifacts stay reachable.
  This single feature subsumes per-character private clues **and**
  archive/unarchive.
- **Effort.** **L.** Largest of the open items: data-model + on-disk layout
  change, copy-on-grant semantics, asset route/lister/injector rewrites, a
  multi-select UI, and a migration off the existing folder toggle.

### 4. Letter / document handouts (.md → PDF via deterministic recipe parser)
- **Gap.** No in-world PDF handout pipeline exists. The dependencies are present
  (`markdown-it` is served to the client for rendering; `pdf-lib` is used by the
  character-sheet exporter) but there is no "Make PDF" action, recipe parser, or
  per-case recipe storage.
- **Goal.** A GM-only **"Make PDF"** action on a selected `.md` in Edit Files,
  rendered by a **deterministic recipe parser — NOT the LLM** (it can't emit PDF,
  is non-deterministic, and contends on the shared GPU). Reuse the `pdf-lib`
  toolkit from `scripts/export-character-sheet.js` (`wrap()` text-flow +
  `drawText` + `embedPng`). `.md` frontmatter carries structured fields
  (To/From/Ref/Date/recipe); body is prose. Per-case **recipes** = a declarative
  layout file (margins, fonts, header image, header/footer, body region) plus the
  recipe's letterhead/logo `.png`s in the case data folder; the recipe *places*
  the PNGs so logos stay consistent (generate/upload-once assets, never
  regenerated per handout). New hard part vs. the single-page sheet exporter:
  **multi-page flow** — a layout cursor, `addPage()` on overflow, header/footer
  repeated per page. Markdown parsing via the existing light `markdown-it`
  subset. Secondary/later: per-case recipe-management UI; an optional strictly
  upstream "LLM drafts the `.md`" action (separate from rendering).
- **Effort.** **M–L.** The recipe parser + multi-page flow is the bulk; UI action
  and per-case recipe storage are smaller. Fits the per-case-settings pattern and
  dovetails with the visibility-set work (item 3).

### 5. Case ownership and GM permissions
- **Gap.** Authority is role-only: every GM can manage every case. No
  `case_owner` / GM-case allocation exists. Acceptable for the Bookshop
  teaching/demo case, but it will not hold once multiple GMs each own different
  cases.
- **Goal.** Add case ownership (or GM-case allocation, reusing the same
  allocation model players already use) and gate case-management routes on it, so
  GMs can run independent campaigns without seeing or editing each other's cases.
- **Effort.** **M.** Schema (owner/allocation), an authorization check on the
  case-management routes, and a small allocation UI.

### 6. Rulebook scenario/lore extraction — finish the drafts (content)
- **Gap.** Less open than it looked: the mechanical rules (`00`–`11`) are
  `reviewed-complete` and wired into the app, and the scenario/lore **is already
  drafted into markdown** under `Rivers_of_London/rules/scenario/`
  (`policing-and-investigations.md`, `gm-procedures.md`, `npcs-and-beings.md`,
  `folly-and-london.md`, `case-seeds.md`, `case-design.md`). But per
  `rules/tracking/source-map.md` those files are at **`extracted-draft`** — they
  have not passed the PDF completion gate (`pdf-review.md`) to become
  `reviewed-complete`. The source PDF is available locally at
  `private/rulebook-source/cha3200_…1.4.pdf` (gitignored), so they *can* be
  verified. Two genuine gaps remain: `scenario/00-table-frame.md` is **not
  created** (intro scenario tone / table-setup / safety frame, p.10–16), and
  **Appendix A pregens** (p.343–349) are not extracted. The scenario/lore files
  are also **not yet surfaced anywhere in the app** (nothing in `src/` loads
  `rules/scenario/`) — a separate decision from extraction.
- **Goal.** Promote the scenario/lore drafts to `reviewed-complete` via a PDF
  pass against their printed page ranges (honouring the locked-table / paraphrase
  -prose rules), create `scenario/00-table-frame.md`, and decide whether Appendix
  A pregens are worth extracting. Surfacing this content in the app is a later,
  separate item.
- **Effort.** **M, content/verification work** — mostly review + reconciliation
  against the PDF rather than fresh extraction. Iterate per tracking target.

## Done

- **Per-session scenario generation** (replaced the single all-sessions
  `session_summaries` call). `session_summaries` is now a **looped section**:
  `LOOPED_SECTIONS` → `detectSessionItems` finds each `session-NN.md`
  (case-insensitive `/^session[-_ ]?0*(\d+)\.(?:md|markdown)$/i`), emits one item
  per file with a stable `session-N` id, and each item is generated on its own
  with an "OUTPUT OVERRIDE — one item only" prompt fed a curated minimal input
  (its transcript + the story-so-far). The array is assembled deterministically
  in code, so the model never manages/"preserves" an array and one bad session no
  longer nukes the whole section. (`src/scenarioInfo.js`.)

- **Handouts player view (GM-style, filtered, read-only).** Players see the
  handouts rendered the same way the GM does — shared file-list +
  `selectScenarioSource`, read-only, filtered to player-visible files
  (`0232a9d`, `4445161`). The remaining finer-grained visibility work is item 3
  above.

- **Character-sheet skills restructure + combat as a separate area.** Common +
  Expert skill classes with languages folded into Expert; Combat skills and
  Weapons as their own PDF-style areas (not merged into Common); occupation
  required-skills hint (`e1165b6`; `public/js/sheet.js`).

- **NPC chat scoped to the case.** "Chat with an NPC" offers only NPCs in the
  active case, not every canonical persona (`134314b`).

- **Nightingale / NPC knowledge — GM-as-NPC attribution.** The per-NPC knowledge
  analysis now infers each NPC's influence from the live-play transcript and
  attributes unattributed GM-delivered guidance to the NPC where they hold
  authority in the setting, so the AI-chat brief isn't thin (`134314b`;
  `itemFocusPrompt` in `src/scenarioInfo.js`).

- **Rules Core/Advanced corpora + per-case tier.** Both corpora built and wired:
  Rules tab Core | Advanced | What's New switcher (`/api/rules?variant=advanced`,
  `/api/rules/changes`); a per-case `rules_tier` (`session_settings`) drives
  AI-support chat (`rulesVariantForSession`) and character sheets (auto-derived
  Move, multi-select Flaws, experience-package picker, widened characteristic
  grids, GM full grid). Derivation ledger:
  `Rivers_of_London/rules-advanced/mutation-map.md`. Rules-tab *search* is handled
  by the browser's Ctrl-F over the rendered rules page (no server search-tier work
  needed), and the **AI Support rule chat already reflects the case's allocated
  rules version** — the client sends `sessionId` (`public/js/app.js`
  `runRulesStream`) and the server resolves the corpus via
  `rulesVariantForSession` → `loadRulesIndex(variant)` (`src/routes.js`).

- **NPC portrait extraction + restyle pass.** Completed via
  `scripts/restyle-character-portrait.js` (`npm run portrait:restyle`), which
  writes the generated local portrait back into the session character sheet
  (player or NPC; `--session Global`/`0` for unallocated central NPCs).
  Supporting scripts: `scripts/regenerate-npc-portraits.js`,
  `scripts/generate-from-scratch-portrait.js`.

- **Link artifacts to entities.** Deterministic post-generation injector matches
  in-scope image filenames (separator-wildcarded prefix match) to entity
  names/headings; NPC sheet portraits auto-extracted from the DB to
  player-Gallery files and rendered per-card at 0.3 LHS; filename layout tags
  (`<frac>LHS|RHS|FW`).

- **Session capture (core).** Live transcription + speaker diarization with a
  persistent voiceprint registry; STT service made concurrent and the local path
  hardened (serial ingest, single-flight diarization, transcribe retry). See
  item 1 for the optional diarize-only cleanup that remains.
