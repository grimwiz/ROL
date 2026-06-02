# NPC Personas & Lore Enrichment — Design Spec

Status: **draft for review**. No code or data written yet. This spec covers two
related features that both draw on the privately-held Rivers of London novels
(converted to Markdown under `private/Books/`):

1. **Chat-with-an-NPC** — players converse with an in-character NPC, backed by a
   Markdown persona model.
2. **Lore enrichment** — improve the existing Folly / London / NPC / setting
   documentation using the books as a reference.

## 0. Hard constraints (read first)

The novels are **copyright Ben Aaronovitch**. Everything produced here must be:

- **Original paraphrase, never the book's text.** No passages, no quotations,
  no "lightly reworded" copying. Persona and lore files are our own concise
  descriptions of characterisation and setting facts.
- **Spoiler-free by construction.** Extract only *stable* traits and setting
  facts — never plot, events, deaths, twists, romance/reveal beats, or case
  outcomes. (This is also the user's explicit requirement.)
- **Private.** The `.md` books stay in gitignored `private/`. They are never
  served by a web route and never shipped to a cloud model — extraction and chat
  run on the **local Ollama** box only. Outputs live in `globaldata/` as
  original summaries.
- **GM-reviewed before save.** The model drafts; a human approves. Same
  human-in-the-loop the app already uses for AI scenario output.

These constraints are enforced in the extraction prompt (§4) and the chat
system prompt (§3.3), not just by convention.

## 1. What "intent" means here

Two different things, only one of which comes from the books:

- **Standing intent** — a character's personality, values, motivations, manner,
  and how they'd plausibly react. Stable across the series. *This* is what the
  books inform, and what makes a believable persona.
- **Scene intent** — what an NPC wants in the current live case. This comes from
  the GM and the case files, **not** the novels. The persona supplies the voice;
  the case supplies the agenda.

A persona therefore models standing intent only. Scene intent is injected at
chat time from player-facing case context (§3.2).

## 2. Persona model (Markdown)

**Principle (decided 2026-06-02): personality lives in standalone Markdown
files, never in the character sheet.** A persona may run to thousands of lines;
putting it in the sheet JSON would bloat every save and dump into the printed
"notes". The sheet holds *none* of it — an entity is linked to its personality
file **by name/slug** (consistent with the project's existing filename-based
artifact↔entity association).

**Reuse the handout strategy (decided 2026-06-02).** A personality file is just a
session handout whose **filename root is the character's name**, so it rides on
infrastructure that already exists — the per-case file store, the Edit Files
tab (GM), the player Handouts list, visibility folders, and the filename-root
entity↔artifact association. Almost no new plumbing.

- **Naming convention:** `<Entity Name> - personality.md` (e.g.
  `DCI Thomas Nightingale - personality.md`). The *root* is the entity name, so
  the existing prefix-match association links it to the right NPC/PC; the
  `- personality` suffix marks its purpose so chat can find it and so it's
  distinct from other handouts about that character (a letter, a photo, …).
- **Live, editable copies** live in the case's normal file area and appear in
  Edit Files. **Canonical book-NPC personas** are bundled under
  `Rivers_of_London/globaldata/npcs/personas/<slug>.md` purely as a *seed
  source*.
- **Seed-on-assignment (decided/implemented 2026-06-02):** when an NPC is
  assigned to a case (its scope gains the case), its canonical personality file
  is copied into the case's **player area** as `<Name> - personality.md` if no
  personality file for that NPC exists there yet. From then on the case copy is
  the editable canon and overrides the seed; re-assignment never overwrites it.
  This replaces the earlier "virtual seed entry + copy-on-write" idea — simpler,
  and reuses the existing globaldata→case seeding pattern. Hook:
  `PUT /character-sheets/:id/scope` → `seedNpcPersonaIntoCase` (newly-added
  cases only). The chat reads the case copy (frontmatter stripped) when present.
- **Visibility:** uses the existing player/GM folder classification. An NPC the
  players may chat with is a player-visible handout; a player-character's own
  personality file is visible to (and, see §2.1, editable by) that player.

`<slug>`/filename root matches the entity name. Optional lightweight shape: a
frontmatter header plus prose. (`name`/`slug`/voice metadata is optional now.)

```markdown
---
name: DCI Thomas Nightingale
slug: dci-thomas-nightingale
aliases: [Nightingale]
player_safe: true          # may a player chat with this NPC at all?
source: original paraphrase from RoL novels 01–02 (private); no quoted text
reviewed: { by: tim, date: 2026-06-02 }
---

## Voice & register
<how they speak: formality, vocabulary, rhythm — in our own words>

## Demeanour
<bearing, temperament, humour>

## Standing values & goals
<general, series-stable; NOT case plot>

## Public relationships
<who they're publicly known to work with / answer to>

## Knowledge scope
<what this character could plausibly know and discuss>

## Boundaries
<topics they deflect; never reveal GM-only/plot; never quote the books>
```

Example (original, spoiler-free characterisation — illustrative only):

> **Voice & register:** measured, formal, a shade old-fashioned; precise word
> choice; dry understatement rather than jokes.
> **Demeanour:** calm and courteous, with steel underneath when pressed.
> **Standing values:** duty, restraint, protecting the public from magical harm;
> teaching by example.
> **Boundaries:** discusses the craft and the job in general terms; will not
> disclose operational secrets, ongoing investigations, or anyone's confidences;
> stays in character and never recites text from any book.

The persona file is the single source of truth for the chat. The existing JSON
sheet supplies *public* hard facts (role, rank, general skills) if useful.

### 2.0 Two layers: voice vs substance

A persona has a **voice** layer (the `- personality.md` file, §2 above) and a
**substance** layer — *what this NPC actually knows about the live case*. The
voice file alone "sounds like them but knows nothing"; the substance is what
makes the chat useful.

**Substance = a generated scenario section (decided/implemented 2026-06-02).**
Rather than a bespoke file, NPC case-knowledge is a first-class looped section in
the scenario-generation framework: `gm.npc_knowledge` (GM artifact, array),
looped per NPC allocated to the case. It therefore inherits the standard
per-section **Regenerate** button and is rebuilt by **Bulk Regenerate** ("rebuild
through the regenerate-all list") with no parallel machinery. Per NPC it
documents, from that character's own optic and grounded in **all** case files
(player + GM + scenario analysis): who they are in the case, what they've
witnessed/believe, relationships & loyalties, what they want, and what they're
hiding — only what they could plausibly know, never omniscient, never invented.

- **Storage:** the GM analysis JSON (`gm.npc_knowledge[]`), like every other
  section — not a separate file. **GM-only**: the GM sees/regenerates it; players
  never read it directly, they extract it *through the in-character chat*.
- **Chat:** `streamNpcChat` concatenates persona voice (`- personality.md`) +
  the NPC's `gm.npc_knowledge` entry; boundaries still stop a wholesale dump.
- **Surfacing (UI, done 2026-06-02):** "Player Stories" is now **"Character
  Stories"**, covering player characters *and* NPCs; the per-NPC knowledge renders
  there (GM view) as an "NPC Knowledge" section with its own Regenerate and a
  page-level "Regenerate Page" that rebuilds both PC stories and NPC knowledge.
  Character-specific files (e.g. the persona) are listed at the foot of the
  character sheet, matched by filename root = character name.

### 2.1 Who edits what

- **GM:** edits any personality handout via the existing Edit Files tab — no new
  editor needed.
- **Players:** may create/edit the personality file for **their own** character
  (the handout whose name root matches their character), "for fun". This is the
  one genuinely new capability: today players have a read-only Handouts list, so
  Phase 3 adds a scoped editor that writes only to the player's own
  `<their character> - personality.md`. Until then, players can supply text and
  the GM saves it.

### 2.2 Chat resolution & the context-size reality

- **Resolution:** to chat as an entity, find the handout named
  `<entity> - personality.md` via the same prefix-match used for artifact
  association; load it as the persona body.
- **Context size (decided 2026-06-02): ingest the whole file.** The local models
  run a 256k context window, so the chat loads the complete personality file
  verbatim — no digest, no truncation, no summary step. The data is meant to be
  rich and unconstrained; richer files simply make a better persona. (Only an
  extreme file approaching the 256k window would ever need attention; not a POC
  concern.)

## 3. `streamNpcChat` — architecture

Mirror the existing `streamRulesChat` / `streamGmChat` in `src/scenarioInfo.js`.

### 3.1 Function
`streamNpcChat(persona, npcPublicFacts, caseContext, clientMessages, opts)`:
build a frozen system prompt, prepend to `sanitiseChatMessages(history)`, stream
via `callOllama`. Reuse the NDJSON streaming, `rejectIfAiBusy`, and
`prepareGpuForLlm` already wrapping the chat routes in `routes.js`. Cache the
frozen system prompt per `(slug, sessionId)` with a TTL, like `gmChatPromptCache`,
so KV-cache stays warm across turns.

### 3.2 Context assembly
- **Persona** file body (§2).
- **NPC public facts** from the JSON sheet (role/rank/public skills only).
- **POC decision (2026-06-02):** no live-case context and no visibility gating.
  The books carry no case-privileged knowledge and it's reasonable for players to
  have read them, so we do not hide setting/lore. Players may chat with **any**
  NPC. Per-case "scene intent" / state injection is explicitly deferred (§1) as
  out of scope for the proof of concept; it can be layered in later by adding
  player-facing case context to the prompt.

### 3.3 System prompt guardrails (verbatim intent)
- You are <name>. Reply in first person, in character.
- You only know what this character could plausibly know (knowledge scope; in a
  live case, only the player-facing facts provided).
- Never reveal GM-only information, plot, future events, twists, or others'
  secrets. If you don't know, say so in character.
- Never reproduce text from any novel; always speak in your own words.
- Out-of-character / system / meta questions: deflect briefly in character.
- Rules questions: redirect to the Rules assistant; do not adjudicate mechanics.

### 3.4 Route & UI
- Route: `POST /api/sessions/:id/npc/:slug/chat` (and a no-session variant for
  central NPCs). `requireAuth`; player-accessible. Player-facing chats force the
  player visibility view regardless of caller role.
- UI: the existing AI Support tab gains a mode/segmented control — Rules · NPC —
  with an NPC picker populated from `player_safe` personas in scope. Reuse the
  rules-chat log/stream UI wholesale.

## 4. Extraction pipeline (books → persona / lore drafts)

Local-model assisted, GM-reviewed. Never auto-saves.

1. **Gather** — for a target character/topic, collect candidate passages from
   `private/Books/*.md` by name/keyword windows (the books are ~600 KB each, too
   large for a small model's context, so chunk and pass only relevant windows).
2. **Draft** — local model converts those windows into the §2 schema (or a lore
   section), under a strict prompt:
   - Output **only** the schema fields, in original wording.
   - **Forbidden:** verbatim or near-verbatim text, quotations, plot events,
     deaths, twists, romance/reveal beats, case outcomes, anything tied to a
     specific scene or time.
   - Emit only **series-stable** traits / setting facts.
3. **Review** — GM sees the draft (and, where relevant, a diff against the
   existing doc), edits, and approves. Reuse the Edit Files surface.
4. **Save** — approved text lands in `globaldata/...`; provenance recorded
   (`source:` frontmatter + a note in this tracking file's log).

Manual authoring is always allowed as the safe fallback; the pipeline is an
accelerator, not the gate.

## 5. Lore enrichment plan

Enrich the thin existing docs and draft the missing ones, using §4 with the same
guardrails. Targets and default visibility:

| Doc | Action | Default visibility |
|---|---|---|
| `globaldata/the-folly.md` | enrich (rooms, routines, Molly, coach house, Folly↔Met) | player-safe basics; GM-only for anything sensitive |
| `globaldata/london.md` | enrich (rivers, markets, atmosphere, geography) | player-safe |
| `globaldata/key-npcs.md` | enrich voice/relationships (paraphrased) | player-safe |
| `globaldata/glossary.md` | add demi-monde/setting terms | player-safe |
| `rules/scenario/folly-and-london.md` | draft (currently missing) | mixed; mark per section |
| `rules/scenario/npcs-and-beings.md` | draft (currently missing) | GM-leaning |

Sourcing rules: prefer setting facts over plot; paraphrase, never quote; classify
player-safe vs GM-only per the existing visibility model; record provenance.

## 6. Phasing

- **Phase 1 — this spec.** Review & approve.
- **Phase 2 — persona-chat MVP.** Personality stored as a handout
  (`<Entity> - personality.md`), one hand-authored persona (e.g. Nightingale);
  `streamNpcChat` + route + an "NPCs" mode + picker in AI Support; guardrails
  and full-file persona ingestion verified.
- **Phase 3 — player edits own personality file.** Scoped editor writing only
  the player's own `<their character> - personality.md`.
- **Phase 4 — extraction pipeline.** Local-model draft→review→save; scale
  personas across the `globaldata/npcs` set.
- **Phase 5 — lore enrichment pass.** Work the §5 table through the pipeline.
- **Later — multi-entity conversations** (entities talking to each other).

## 7. Decisions (resolved 2026-06-02)

- Persona files as separate Markdown (not a JSON block) — editability + clean
  LLM context.
- **Access: any NPC.** No "met them yet" gating; no per-case visibility gating.
- **No GM/player split for the POC** — there's nothing to hide, so one shared
  player-safe surface. (A GM-context variant can come later if wanted.)
- **State / scene intent deferred** — too much work for a POC; layer in later.
- Keep a small "in character — not rules advice" banner on the NPC chat.

## Log

- 2026-06-02 — Spec drafted from a survey of `streamRulesChat`/`streamGmChat`
  (`src/scenarioInfo.js`), the `globaldata/npcs` JSON model, and the existing
  `globaldata` lore docs.
- 2026-06-02 — Decisions folded in: chat any NPC, no state/visibility gating for
  the POC; **personality is not stored in the character sheet**; it lives in
  Markdown handouts named `<Entity> - personality.md`, reusing the existing
  handout store / Edit Files / visibility / filename-association plumbing; GM
  edits via Edit Files, players (Phase 3) edit their own; chat reads a bounded
  persona digest to fit the local model context. Awaiting go-ahead for Phase 2.
- 2026-06-02 — Full-file ingestion (256k context); persona seed-on-assignment
  into the case player area; "+ Add existing NPC" on Characters; NPC chat MVP
  (persona voice).
- 2026-06-02 — NPC case-knowledge ("substance") implemented as a looped scenario
  section `gm.npc_knowledge` (GM artifact): per-NPC, grounded in all case files,
  GM-only, swept up by Bulk Regenerate. `streamNpcChat` now concatenates the
  persona voice + the NPC's knowledge entry. Verified: section registered + in
  regenerate-all, NPC enumeration, per-NPC prompt render, chat concat. Pending
  UI: rename "Player Stories" -> "Character Stories" (PCs + NPCs); render NPC
  knowledge there + at the foot of the character sheet.
