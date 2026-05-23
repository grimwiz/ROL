# App Content Handoff

Last updated: 2026-05-23.

## Status: Parked For Review

This plan is deliberately parked until the remaining scenario/lore/Bookshop
extraction is finished. The app-facing basic rules corpus is complete, but the
content work still has non-rules extraction open. This file captures useful
implementation ideas, but several steps are too large or too
app-architecture-heavy for the current phase and should be reviewed before any
code work starts.

Do not begin the manifest, Admin toggle, canonical copy/reset, Bookshop
surfacing, or visibility implementation from this file until extraction is
complete and the design has been rechecked.

Current priority:

- Finish extracting and PDF-checking the remaining scenario/lore/Bookshop data.
- Keep source/provenance tracking current.
- Decide how base and advanced rules should be represented before changing the
  app rule-loading model.

This handoff captures the next app/data work after the rules transcription pass. It is written so another agent can continue in small steps, with the project remaining usable after each step.

## Current State

Recent uncommitted rules extraction work:

- `Rivers_of_London/rules/10-spells.md` created.
- `Rivers_of_London/rules/00` through `11` marked `reviewed-complete` for the
  app-facing basic rules corpus.
- `Rivers_of_London/rules/11-demi-monde.md` cleaned so optional lower-fae and
  Quiet Person player-investigator rules no longer load as basic rules.
- `Rivers_of_London/rules-advanced-source/12-advanced-options.md` created
  outside the app-facing rules folder and now holding those optional PC rules.
- Tracking files updated under `Rivers_of_London/rules/tracking/`.

Checks already run for those files:

- `git diff --check` passed.
- Trailing-whitespace scans passed.
- Non-ASCII in the new rules files is limited to the expected fifth-order demon-trap spell name with a macron.

Before starting app changes, run:

```bash
git status --short
git diff --check
```

Do not assume the new rule files are committed.

## Product Goal

The app needs three related content systems:

- Two rule bundles:
  - Core rules.
  - Extended rules.
- A built-in Bookshop case, surfaced alongside GM-created cases and The Domestic.
- Seeded lore/settings content copied from a safe canonical area into editable local case data, with default GM/player visibility that the GM can later change.

The same rule bundle must feed:

- The top-level Rules tab.
- AI Support -> Rules.

Extended rules must be controlled by an Admin toggle. The clean fit is per-case settings, because AI Support -> Rules is case-aware and already sends `sessionId`.

## Existing Architecture To Reuse

Important files:

- `src/routes.js`
  - `rulesRoot` points at `Rivers_of_London/rules`.
  - `listRuleDocuments()` currently loads every `NN-*.md` file.
  - `/api/rules`, `/api/rules/markdown`, `/api/rules/print`, `/api/rules/search`, `/api/rules/chat` all use the compact rules index.
  - The Domestic is handled as a special system session with description `__SYSTEM_DOMESTIC__`.
- `src/scenarioInfo.js`
  - Case data lives under `data/sessions/<case-slug>/`.
  - Player-visible files live in root/input/Gallery.
  - GM-only files live in `GM/`, `GM/Gallery`, and `output_gm`.
  - `seedGlobalSessionFiles()` copies from `Rivers_of_London/globaldata` into a case if missing or empty.
  - `classifySessionFileVisibility()` controls player vs GM visibility from folder layout.
- `src/sessionRolls.js`
  - Per-case settings are stored in `session_settings`.
  - Current settings: `advantage_mode`, `ruleset`, `portrait_style`.
- `public/js/app.js`
  - Rules tab rendering begins at `loadRulesTab()`.
  - AI Support has a GM/rules mode toggle around `renderSessionAiSupport()`.
  - Admin -> Case Settings is rendered by `renderAdminCases()`.
- `public/js/api.js`
  - Central browser API client.
- `Rivers_of_London/globaldata/`
  - Existing world reference seed files.
- `Rivers_of_London/globaldata/npcs/`
  - Safe canonical NPC sheets. These are seeded into SQLite and copied per case as working sheets.

## Key Design Decisions

These decisions are provisional and need review before implementation.

Use a manifest, not filename guessing, for rules.

Add:

```text
Rivers_of_London/rules/rules-manifest.json
```

Suggested shape:

```json
{
  "title": "Rivers of London Compact Rules Reference",
  "groups": [
    {
      "id": "core",
      "title": "Core Rules",
      "default_enabled": true,
      "files": [
        "00-system-overview.md",
        "01-character-model.md"
      ]
    },
    {
      "id": "extended",
      "title": "Extended Rules",
      "default_enabled": false,
      "files": []
    }
  ]
}
```

In the actual first implementation, include all existing core files in order. Do not directly include `Rivers_of_London/rules-advanced-source/12-advanced-options.md` in an app-facing manifest; it is an extracted source summary, not a resolved advanced rule corpus. Keep `10-spells.md` and `11-demi-monde.md` in core unless the GM explicitly wants spells/demi-monde hidden as advanced; they are needed for normal play once magic, demi-monde NPCs, or demi-monde case phenomena exist.

## Design Issue To Review: Advanced Rules May Mutate Core Rules

The earlier core/extended design assumes that advanced options can be appended
as an extra group. That may be the wrong model for rules analysis, especially
for AI Support. Several optional rules alter existing procedures rather than
adding isolated new topics. If the advanced material is just tagged onto the
end, retrieval can answer from the base section when the advanced procedure is
the intended campaign rule, or blend incompatible base and advanced procedures.

Examples of likely mutations:

- Advanced character creation changes the base creation procedure.
- Disadvantages alter character creation and advantage selection.
- Optional combat rules alter surprise, prone combat, held actions,
  interruption, automatic fire, and firearm handling.
- Alternative damage alters the base damage-resolution procedure.
- Detailed poison rules alter the base poison procedure.
- Higher-order/custom spells, enchantments, demon traps, and rose jars alter
  the magic/spell reference rather than living only as appendix notes.

Plausible architecture to review after extraction:

- Keep `Rivers_of_London/rules/` as the base/core extracted corpus.
- Keep `Rivers_of_London/rules-advanced-source/12-advanced-options.md` as the
  extracted source summary of optional rules, so the derivation can be repeated
  and audited.
- Generate or maintain a derived `Rivers_of_London/rules-advanced/` corpus
  where affected base files are copied and deliberately mutated by the optional
  rules.
- Track each mutation with:
  - source advanced section
  - affected base file/heading
  - replacement/addition behavior
  - whether the advanced rule supersedes, supplements, or adds an option beside
    the base rule
- Prefer a repeatable generation/review process if possible, so changes to the
  base extracted rules can be replayed into the advanced corpus.

This is only a design note for now. Do not implement it until the remaining
source extraction is complete.

Use a canonical seed area for bundled editable content.

Suggested layout:

```text
Rivers_of_London/canonical/
  cases/
    bookshop/
      manifest.json
      input/
      GM/
      Gallery/
      NPCs/
  lore/
    manifest.json
    player/
    GM/
```

Never seed from `private/`. The private rulebook extraction area is for development only.

## Incremental Plan

### Step 0 - Finish Current Extraction Checkpoint

Goal: leave the repo clean except intentional docs/rules changes.

Work:

- Review `10-spells.md`, `11-demi-monde.md`, and
  `../rules-advanced-source/12-advanced-options.md`.
- Run `git diff --check`.
- Commit or otherwise preserve the current transcription work before app changes.

Consistent project state:

- Existing app behavior unchanged.
- Rules tab still loads all numbered rule files.

### Step 1 - Add Rules Manifest With No Behavior Change

Goal: introduce manifest parsing while keeping the app output the same.

Work:

- Add `Rivers_of_London/rules/rules-manifest.json`.
- Refactor `src/routes.js:listRuleDocuments()` to read manifest order and group metadata.
- If manifest is missing or invalid, fall back to current `NN-*.md` behavior.
- Keep `/api/rules` returning all files for now.

Consistent project state:

- Top Rules tab shows the same content as before.
- Rules search and rules chat still see the same full compact rules.
- No Admin UI change yet.

Suggested checks:

```bash
npm test -- --runInBand
node -e "require('./src/routes')"
```

If there is no test suite, at minimum start the server and hit `/api/rules` while logged in.

### Step 2 - Add Extended-Rules Case Setting

Goal: store the toggle without changing visible behavior abruptly.

Work:

- Add `extended_rules_enabled INTEGER NOT NULL DEFAULT 1` to `session_settings`.
- Update `src/sessionRolls.js:getSettings()` and `setSettings()`.
- Update `/sessions/:id/settings` response.
- Add UI control in `public/js/app.js:renderAdminCases()`.
- Add API client support only if existing `setSessionSettings()` is insufficient.

Use default `1` for compatibility. Later, if desired, new cases can default to `0`, but this should be a deliberate product decision.

Consistent project state:

- Existing cases keep seeing extended rules until the GM turns them off.
- No rule content disappears silently.

Suggested checks:

- Admin -> Case Settings renders.
- Toggle persists after reload.
- Existing advantage/ruleset/portrait style settings still save.

### Step 3 - Filter Rules By Setting

Goal: make the toggle actually control extended rules in both rule surfaces.

Work:

- Let the rules index builder accept `{ includeExtended }`.
- `/api/rules` should accept optional `sessionId`.
- `/api/rules/search` should accept optional `sessionId`.
- `/api/rules/chat` already receives `sessionId`; use that session's setting.
- Top Rules tab should either:
  - use current case when one is active, or
  - show a Core/Extended segmented control independent of case.

Preferred pragmatic behavior:

- Top Rules tab shows Core and Extended sections, with Extended visibly labelled.
- AI Support -> Rules obeys the case setting because it is used during play.

Consistent project state:

- Core rules are always available.
- Extended rules are included only when expected.
- If no session is supplied, include extended rules to preserve general browsing/search usefulness.

Suggested checks:

- Ask rules chat about an advanced-rule topic with toggle on: answer should use the resolved advanced corpus, not the raw source summary.
- Turn toggle off and ask the same topic: answer should say compact rules for this case do not include it.
- `/api/rules/search?q=automatic&sessionId=<id>` changes with the toggle.

### Step 4 - Add Canonical Seed/Reset Plumbing

Goal: support built-in content that can be copied, edited, and reset.

Work:

- Add a small module, e.g. `src/canonicalContent.js`.
- Implement safe copy helpers:
  - Copy only from `Rivers_of_London/canonical`.
  - Copy only into `data/sessions/<case-slug>`.
  - Preserve GM/player visibility by writing into `GM/`, `input/`, `Gallery/`, `GM/Gallery`.
- Add reset endpoint for GM-only use, e.g.:
  - `POST /api/sessions/:id/reset-canonical`
- Add manifest support with fields:
  - `system_key`
  - `title`
  - `description`
  - default files/assets
  - default NPC allocations
  - reset policy

Consistent project state:

- No visible Bookshop yet.
- No existing cases are changed.
- Reset endpoint refuses non-canonical cases.

Suggested checks:

- Unit or script test copies a temporary canonical fixture into a temp case folder.
- Reset cannot write outside the session folder.

### Step 5 - Surface The Bookshop As A Built-In Case

Goal: show The Bookshop beside GM-created cases and The Domestic, but use the normal case UI.

Work:

- Add a `system_key` column to `sessions`, or use a separate safe marker if a schema migration is preferred.
- Keep The Domestic special; do not force it into normal case UI.
- Add `ensureBookshopSystemSession()`.
- Update `/sessions` so GMs see The Bookshop as a built-in case.
- Decide whether players see it only when assigned, or always like The Domestic. Safer default: assignable case.
- Seed its local files from canonical on first open or startup.
- Add Reset button for built-in canonical cases in GM UI.

Consistent project state:

- The Bookshop opens like any other case.
- GM edits affect only `data/sessions/bookshop`, not canonical source.
- Reset restores from canonical.

Suggested checks:

- The Bookshop card appears.
- It has normal case tabs.
- Edit Files shows GM/player files with correct visibility.
- Reset restores a deliberately edited file.

### Step 6 - Extract The Bookshop Into Canonical Case Data

Goal: make The Bookshop usable as a test case.

Work from source:

- `private/extracted-source/sections/...` and PDF pages for Chapter 8.
- Do not copy long adventure prose verbatim into player-visible files.

Canonical outputs:

```text
Rivers_of_London/canonical/cases/bookshop/input/player.md
Rivers_of_London/canonical/cases/bookshop/GM/gm.md
Rivers_of_London/canonical/cases/bookshop/GM/locations.md
Rivers_of_London/canonical/cases/bookshop/GM/clues.md
Rivers_of_London/canonical/cases/bookshop/Gallery/
Rivers_of_London/canonical/cases/bookshop/GM/Gallery/
Rivers_of_London/canonical/cases/bookshop/manifest.json
```

Minimum useful GM content:

- Case premise.
- Opening situation.
- Scene flow.
- Secrets/reveals.
- Clue list.
- NPC roles, motivations, and stat/sheet references.
- Locations.
- Handouts.
- Maps, with keyed versions GM-only.

Consistent project state:

- The Bookshop is a playable sandbox case.
- Players only see player-safe material.
- GM Chat and scenario regeneration can use GM-only material.

### Step 7 - Seed Settings And Lore With Default Visibility

Goal: replace implicit broad `globaldata` seeding with manifest-controlled lore seeding.

Work:

- Add `Rivers_of_London/canonical/lore/manifest.json`.
- Classify each lore file as default `player` or `gm`.
- Keep editable local copies in case folders.
- Use existing Edit Files visibility movement for GM promotion from GM to Player.

Suggested default classification:

- Player-visible by default:
  - basic setting premise
  - basic Folly/public-facing context known to investigators
  - compact glossary terms that are not spoilers
- GM-only by default:
  - hidden organisations
  - scenario hooks
  - NPC secrets
  - antagonist/context material
  - case seeds

Consistent project state:

- Existing cases still get useful world reference.
- GMs can edit local lore and expose it when appropriate.
- Canonical lore remains untouched.

### Step 8 - Documentation And Final Tests

Work:

- Update `README.md`:
  - rule bundles
  - extended-rules toggle
  - built-in Bookshop
  - canonical copy/reset model
  - lore visibility model
- Update `TODO.md` or this handoff as items move to Done.

Checks:

- `git diff --check`
- Any existing app tests.
- Manual smoke:
  - login as GM
  - Admin -> Case Settings toggle extended rules
  - Rules tab loads
  - AI Support -> Rules respects toggle
  - Bookshop opens
  - Bookshop reset works
  - player cannot see GM-only Bookshop/lore files

## Player-Safe Versus GM-Facing Content

Treat these as GM-facing by default:

- The Bookshop adventure content.
- Case-writing guidance.
- Case seeds.
- Rogues' Gallery secrets, stat blocks, and intended use.
- Hidden maps, keyed maps, clue solutions, antagonist plans.
- GM-only lore and hidden organisation details.

Treat these as player-safe by default:

- Core rules.
- Character creation options allowed in the current campaign.
- Player-facing handouts.
- Basic setting/lore that a starting investigator could know.

When uncertain, seed as GM-only. The GM can move it to player visibility later.

## Important Caution

Do not expose anything from `private/` through web routes. The server should continue to serve only safe public/canonical/live case data, never private source PDFs or extraction text.
