# Ruleset Modules — segregating the rules layer into swappable packs

**Status:** Design / not yet implemented.
**Baseline:** `ROLv1.0` (git tag, commit `03b1277`) is the safe extraction point — the
last single-ruleset release before this refactor begins.
**Goal:** Turn the rules-specific parts of ROL (character generation, the Rules tab,
the rules corpus, and the skin/branding) into a **replaceable pack** so the same site can
serve, e.g., Rivers of London, Call of Cthulhu, Bushido, or AD&D — with each *case*
declaring which ruleset it uses, and the login/branding picking up the active pack's skin.

This document is both an **audit** of the current rules-coupled surface and a **recipe**
for what a new pack must contain — from a files perspective and an API/function-call
perspective.

---

## 1. The decisive architectural facts

Three facts make this feasible without a data migration:

1. **Character storage is already schema-free.** `character_sheets.data` is an opaque JSON
   blob (`src/db.js:25–58`); case membership is `data.scope = [case_name, …]` inside that
   blob. The database has no concept of "skill", "characteristic", or "class". An AD&D sheet
   and a RoL sheet are both just JSON in the same table. **No storage change is needed to host
   multiple rulesets.**

2. **A binary ruleset seam already exists** — it just isn't a pack system. The app already
   threads a `ruleset` (`'rol'` | `'coc'`) and a `rules_tier` (`'basic'` | `'advanced'`)
   from per-case settings → sheet engine → rules corpus → rules AI. Today this is implemented
   as scattered `if (_ruleset === 'coc')` branches inside one shared codebase. The refactor is
   to **promote those branches into a registry of packs**, not to invent the concept from zero.

3. **The rules corpus is already filesystem markdown**, loaded by variant
   (`loadRulesIndex(variant)`), so swapping corpora is a path change, not a logic change.

Everything else — auth, sessions/cases CRUD, letterhead, portraits, Excalidraw, handouts,
session capture/STT, AI service wiring — is already ruleset-agnostic and out of scope.

---

## 2. Naming-collision warning (read before coding)

`sessions.system_key` (`src/db.js:177`) **does not mean "ruleset."** It marks a *built-in
canonical case* (e.g. `bookshop`) and gates "built-in cases can't be renamed/deleted"
(`src/routes.js:747`, `:759`) in `src/canonicalContent.js`. **Do not overload it.** The
ruleset selector introduced here is a **separate** concept. Use the name already in use at the
settings/sheet layer — `ruleset` — and persist it per case as today (`rules_tier` alongside).
Avoid the words "system"/`system_key` for the ruleset axis entirely.

---

## 3. Audit — the rules-coupled interface (as of ROLv1.0)

Each row is a seam that a pack must own or that must be parameterised by the active pack.
Coupling = how hard it is to make ruleset-agnostic.

### 3.1 Character sheet engine — `public/js/sheet.js` (~84 KB) — **HARD**

The `SheetForm` IIFE (`window.SheetForm`) is the whole chargen + sheet UI. It already has the
seam hooks but the *content* is BRP/RoL-shaped (characteristics + common/combat/expert
percentile skills, SAN/MP/Luck/Move derivations, magic section).

Public surface (`sheet.js:1733`):

```
window.SheetForm = {
  render(host, data, opts),   // build the sheet/chargen DOM
  collect(),                  // read DOM back into a sheet-data object
  setRuleset(r),              // 'rol' | 'coc'         -> sheet.js:39
  setRulesTier(t),            // 'basic' | 'advanced'  -> sheet.js:56
  setGmEditor(bool),
  setSessionId(id),
  setPortraitAi(...),
}
```

Existing ruleset conditionals to extract (these become pack behaviour, not branches):

| Line | Branch | What it controls |
|---|---|---|
| `sheet.js:39` | `setRuleset` | binary rol/coc only |
| `sheet.js:49` | `sizEnabled()` | CoC has SIZ; RoL doesn't |
| `sheet.js:57` | `advancedEnabled()` | tier: Age→MOV, selectable advances |
| `sheet.js:206–216` | MOV / Slow-Footed / age adjustment | derived-stat formulas |
| `sheet.js:463–470, 546, 569` | stat grid ranges, advanced fields | chargen point ranges |
| `sheet.js:738–756` | characteristic list + derived display | **the sheet's actual field set** (`str/con/dex/int/pow[/siz]`, HP/Build/SAN/MP) |
| `sheet.js:887` | collect path | reading rol vs coc fields |

> The `738–756` block is the crux: it hard-codes the *characteristic set*. A BRP cousin (CoC)
> only toggles SIZ/HP/Build. A non-BRP system (AD&D) needs a **different field set entirely** —
> i.e. a different renderer, not a flag. That boundary is the whole reason this must become a
> pack interface rather than more `if`s.

### 3.2 Occupation / chargen tables — `public/js/occupation-skills.js` — **HARD**

`window.OccupationSkills` (`occupation-skills.js:94`):

```
OccupationSkills = {
  resolveOccupation(name) -> entry | null,
  requiredHint(occupation, presentSkillNames) -> { text, complex, missing } | null,
}
```

Content is the RoL Occupation Table transcribed verbatim. Pure data + two pure functions →
clean candidate to move wholesale into a pack.

### 3.3 Sheet PDF — `public/js/sheet-pdf.js` — **HARD**

`window.SheetPDF` (`sheet-pdf.js:430`) lays out the RoL character sheet PDF. Layout is
schema-shaped; a different sheet shape needs a different layout. Pack-owned.

### 3.4 Sheet-data helpers in `public/js/app.js` — **MEDIUM**

- `DEFAULT_GM_SKILL_VALUES` (`app.js:56`), `getSheetSkills(d)` (`app.js:67`),
  `summarizeNotableSkills(d, limit)` (`app.js:100`) — all assume the
  `combat/common/expert/mandatory/additional_skills` shape.
- `CharacterPanel` context carries `{ ruleset, rulesTier }` and calls
  `SheetForm.setRuleset/​setRulesTier` (`app.js:2153, 2366, 2403, 2533, 6283, 7420`).
- Print/export composes sheets with `ruleset` per character (`app.js:2066–2153`).

### 3.5 Server: per-case settings + sheet endpoints — `src/routes.js` — **MEDIUM**

- `GET/POST` session settings expose/persist `ruleset` + `rules_tier`
  (`routes.js:828–854`); `sessionRolls.getSettings(db, sessionId)` is the source of truth.
- `stripSheetValuesForRulesAi(value, ruleset)` / `sheetForRulesAi(value, ruleset)` /
  `normaliseSheetRuleset` (`routes.js:2146–2167`) strip CoC-only fields for the player-facing
  rules AI — schema-aware logic that must move behind the pack.
- `rulesVariantFromReq(req)` (`routes.js:2250`) maps case `rules_tier` → corpus variant.

### 3.6 Rules corpus + Rules tab — filesystem + `src/routes.js` / `app.js` — **MEDIUM**

- Corpus dirs: `rules/`, `rules-advanced/`, `rules-advanced-source/`, and the scenario
  reference corpus under `Rivers_of_London/`.
- Routes `GET /rules`, `/rules/reference`, `/rules/changes`, `/rules/markdown`,
  `/rules/print`, `/rules/search`, `POST /rules/chat` (`routes.js:2265–2368`) all read those
  dirs via `loadRulesIndex(variant)` / `loadReferenceIndex(includeGm)`.
- Front end: `State.rulesChat` + the Rules tab UI (`app.js`). Logic is corpus-agnostic; only
  the **paths** and the **AI flavour prompt** are RoL-specific.

### 3.7 AI prompt flavour — `src/scenarioInfo.js` (~187 KB) — **MEDIUM**

Mostly system-agnostic AI orchestration (Ollama/ComfyUI wiring, scenario generation), but with
RoL setting language baked into prompt strings (Peelian framing, the Folly, vestigia, NPC-index
conventions) and the player-facing rules-answer guardrails (`scenarioInfo.js:2727+`). These are
string-level, pack-supplied, not structural.

### 3.8 Built-in cases + NPC seed — `canonicalContent.js`, `npcSeed.js` — **MEDIUM**

`BUILT_IN_CASES` (`canonicalContent.js:18`) and rulebook NPC seeding are RoL content. A pack may
ship its own canonical starter case(s) + NPC archive, or ship none.

### 3.9 Branding / skin — `public/js/app.js`, CSS, session covers — **LOW**

- Login splash + nav brand are inline SVG (`app.js:385, 457`).
- Per-case cover images already exist (`findSessionCover`, `scenarioInfo.js:414`) and survive
  rename (`syncSessionCoverOnRename`).
- "Login page picks up its picture from the website" → drive the login splash from the active
  (or default) pack's `manifest.branding.loginImage`; per-case skinning largely falls out of
  per-case `ruleset` + existing covers.

---

## 4. The pack contract — the "recipe"

A ruleset pack is a self-contained bundle implementing one interface. Two halves: a **file
layout** (what ships) and an **API/function-call surface** (what code must export).

### 4.1 File layout (what a pack contains)

```
rulesets/
  <ruleset-key>/                 # e.g. rivers-of-london, call-of-cthulhu, add
    manifest.json                # identity, branding, capabilities, corpus paths
    schema.js                    # character data shape + defaults + migrate()
    sheet-view.js                # render() + collect() for chargen/sheet UI  (front end)
    chargen.js                   # occupation/skill tables, required-skill hints (front end)
    pdf.js                       # sheet PDF layout                            (front end)
    rules-ai.js                  # strip/shape sheet for player rules AI       (server)
    prompts.js                   # setting-flavour strings for scenarioInfo    (server)
    corpus/
      core/                      # markdown for the Rules tab (basic tier)
      advanced/                  # optional: advanced-tier markdown
      reference/                 # optional: GM/setting reference, role-tagged
    branding/
      login.<png|svg>            # login splash
      nav-mark.svg               # optional nav brand
    cases/                       # optional: built-in starter case(s) + manifests
    npcs/                        # optional: seed NPC archive
```

`manifest.json` (the only required file besides `schema.js`/`sheet-view.js`):

```jsonc
{
  "key": "call-of-cthulhu",            // matches sessions.ruleset; stable, kebab-case
  "name": "Call of Cthulhu (7e-style)",
  "family": "brp",                      // hint: 'brp' cousins reuse the BRP sheet engine
  "tiers": ["basic", "advanced"],       // maps to rules_tier; ["basic"] if no advanced split
  "branding": { "loginImage": "branding/login.png", "navMark": "branding/nav-mark.svg" },
  "corpus": { "core": "corpus/core", "advanced": "corpus/advanced", "reference": "corpus/reference" },
  "capabilities": { "magic": true, "siz": true, "occupations": true, "pdf": true },
  "builtInCases": ["cases/the-haunting"], // optional
  "seedNpcs": "npcs"                       // optional
}
```

### 4.2 API / function-call surface (what a pack exports)

The host owns a **registry**; each pack registers under its `key`. Two registries because the
code splits front end / server.

**Front-end pack module** (loaded by `key`; replaces the hard-coded `SheetForm` internals):

```js
// rulesets/<key>/sheet-view.js  (+ schema.js, chargen.js, pdf.js)
export default {
  key,                                  // 'call-of-cthulhu'
  schema: {
    defaults(),                         // -> blank sheet-data object for this ruleset
    fields(tier),                       // -> declarative field set the renderer walks
    migrate(data),                      // -> upgrade an older sheet blob in place
  },
  sheet: {
    render(host, data, { tier, readonly, gmEditor }),   // build DOM
    collect(),                                            // DOM -> sheet-data
    derive(data, { tier }),                               // computed stats (HP/SAN/MOV/…)
  },
  chargen: {
    resolveRole(name),                  // occupation/class lookup (nullable)
    requiredHint(role, presentNames),   // { text, complex, missing } | null
    validate(data, { tier }),           // -> [{ field, message }]
  },
  pdf: { build(doc, data) },            // optional; gated by capabilities.pdf
};
```

**Server-side pack module** (loaded by `key`):

```js
// rulesets/<key>/index.js  (manifest + prompts.js + rules-ai.js)
module.exports = {
  key,
  manifest,                             // parsed manifest.json
  corpusDir(variant),                   // 'core'|'advanced'|'reference' -> abs path
  rulesAi: {
    stripForPlayer(data),              // remove GM/other-ruleset fields  (was stripSheetValuesForRulesAi)
    shape(data),                       // compact sheet for the AI prompt (was sheetForRulesAi)
  },
  prompts: {
    settingFlavour(),                  // strings injected into scenarioInfo prompts
    rulesAnswerGuardrails(),           // player-facing rules-AI guardrails
  },
  builtInCases(),                       // [] or canonical case configs
  seedNpcs(),                           // [] or NPC archive
};
```

**Host registry (new, small):**

```js
// public/js/rulesets/registry.js   — Ruleset.get(key) -> front-end pack (default 'rivers-of-london')
// src/rulesets/registry.js          — rulesets.get(key) -> server pack
```

Every call site in §3 that today branches on `_ruleset === 'coc'` instead becomes
`Ruleset.get(activeKey).<thing>()`. Unknown/legacy keys fall back to `rivers-of-london`.

### 4.3 Minimum viable pack

A pack can be tiny. The **required** members are: `manifest.json` (`key`, `name`),
`schema.defaults/fields`, and `sheet.render/collect`. Everything else
(`pdf`, `chargen`, `advanced` tier, `builtInCases`, `seedNpcs`, custom branding) is optional and
degrades gracefully via `capabilities`. A pack that omits `pdf` simply disables the
"export sheet PDF" button for its cases.

---

## 5. Binding model — how a case selects a ruleset

- A **case** already persists `ruleset` + `rules_tier` (per-case settings; UI dropdown at
  `app.js:6482`). Keep that as the binding point — generalise the dropdown from a fixed
  rol/coc `<select>` to "list of registered packs."
- On opening a case, the host loads `Ruleset.get(case.ruleset)` (front end) and
  `rulesets.get(case.ruleset)` (server) and drives sheet, corpus, rules AI, and branding from it.
- **Default everything to `rivers-of-london`** in the settings read path and in any migration,
  so existing cases and sheets are untouched. Treat legacy `'rol'` as an alias of
  `rivers-of-london` and `'coc'` as `call-of-cthulhu`.
- Sheets self-describe via `data.ruleset` (already written, `app.js:2178`), so a sheet keeps
  rendering correctly even if a case's binding later changes.

---

## 6. Effort gradient (set expectations)

Difficulty is **entirely** a function of how far the target schema is from BRP:

| Target | Effort | Why |
|---|---|---|
| **Call of Cthulhu** | Low | RoL's RPG *is* BRP-family; CoC 7e is the same engine. Sheet is ~90% reused; mostly chargen tables + corpus + branding differ. This is the natural first pack — it's already half-wired (`'coc'`). |
| **Bushido** | Moderate | Stat+skill paradigm but different stats/derived values. |
| **AD&D** | High | d20 + classes/levels/HP/AC/THAC0/spell slots/saves — a *different sheet shape*. Forces a genuinely distinct `schema`/`sheet-view`; proves whether the contract holds for non-BRP families. |

Config alone gets you BRP cousins. New families need a new renderer registered under the same
contract — which is exactly what §4.2 is designed to allow.

---

## 7. Phased migration plan

Each phase is independently shippable and starts from `ROLv1.0`.

1. **Carve the seam, zero behaviour change.** Introduce the front-end + server registries with a
   single pack, `rivers-of-london`, that wraps today's code (the existing `coc` branches become
   the RoL pack's internal config). Replace `if (_ruleset === …)` call sites with
   `Ruleset.get(key)`. Default all reads to `rivers-of-london`; alias legacy `rol`/`coc`. Ship —
   everything still works identically. **This is where the real risk lives (`sheet.js`/`app.js`
   extraction); do it first and prove parity against `ROLv1.0`.**
2. **Externalise corpus + branding** into the pack: move `rules/` / `rules-advanced/` /
   reference markdown, the login image, and the `scenarioInfo` flavour strings behind the pack
   interface. Still one ruleset.
3. **Prove it with a BRP cousin — Call of Cthulhu.** Promote the existing `coc` toggle into a
   first-class second pack: own chargen tables, corpus, branding; same sheet engine. Cheap
   because the schema matches. **Reassess here:** if CoC drops in cleanly, the abstraction is
   sound.
4. **(Optional) Prove the hard case — AD&D.** Forces `schema`/`sheet-view` to genuinely diverge;
   confirms the contract survives a non-BRP family.

Recommended stop-and-review gate: **after phase 3.**

---

## 8. Open questions (maintainer decisions)

- **Licensing:** ROL bundles RoL rules content (kept private for that reason). Each new pack's
  corpus carries the same constraint — packs must be added privately, not published. Pack format
  should make it easy to *omit* a corpus (ship structure, not text) for any pack that can't be
  distributed.
- **Pack discovery:** filesystem convention (`rulesets/*/manifest.json` auto-registered) vs an
  explicit allow-list in config. Lean filesystem-convention for dev, allow-list for what a given
  deployment exposes.
- **Per-case vs per-site default ruleset** for the *login* splash when no case is open (a site
  may want one house skin). Suggest: a configurable site-default pack; cases override per case.
- **Cross-ruleset NPC archives:** are global letterhead/NPC catalogues shared across rulesets or
  partitioned by pack? (Letterhead is genuinely system-agnostic; NPC stat blocks are not.)
