# NPC Persona Extraction — Method & Prompt

Status: **living document**. This is the repeatable recipe for turning the
privately-held Rivers of London novels into an NPC **persona file** that an LLM
can use to answer a player in character — including the *worldview knowledge* a
character would plausibly carry (where they live, who they know, what their life
is like, what they understand about magic and the demi-monde).

It extends the design in [`npc-personas-and-lore-plan.md`](npc-personas-and-lore-plan.md)
(§2 persona model, §4 extraction pipeline). Read that first for the hard
constraints; they are summarised here and are non-negotiable.

Iterate on this file. When a persona comes out thin, wrong, or spoiler-leaky,
fix the **schema** (§3) or the **prompt** (§5) here so the next extraction is
better — don't just patch the one output.

---

## 0. Hard constraints (unchanged — enforce every time)

- **Original paraphrase, never the book's text.** No passages, no quotations,
  no "lightly reworded" sentences. A persona is *our own* concise description of
  a character, written from what the books establish.
- **Spoiler-free by construction.** Only *series-stable* traits and setting
  facts. Never plot, events, deaths, twists, romance/reveal beats, case
  outcomes, or anything tied to a single scene or moment in time.
- **Stay within the books you cite.** Don't pull a fact from book 5+ into a
  persona scoped to books 1–4 (it both spoils and dates the character). Record
  which books a persona draws on in `source:`.
- **Private + local only.** The `.md` books stay in gitignored `private/`. The
  extraction runs on the **local Ollama** box; the books are never sent to a
  cloud model and never served by a web route. Only the finished persona (an
  original summary) lands in `globaldata/`.
- **GM-reviewed before save.** The model (or a human) drafts; a human approves.

---

## 1. Inputs

- The four converted novels in `private/Books/`:
  `Rivers of London 0{1..4} - … .md`.
- All four now share **one chapter convention** — every chapter starts with a
  line matching `^# Chapter \d+`, with a title appended where the book gives one
  (`# Chapter 1 — Material Witness`). The four files were deliberately aligned to
  this single convention so this step is mechanical — you can cite provenance by
  chapter and chunk on one regex.
- The existing JSON sheet for the character (`globaldata/npcs/<slug>.json`) for
  *public hard facts only* (role, rank, public skills) — not personality.

The books are ~90–100k words each, far larger than a small model's context, so
you **gather windows, then draft** — never feed a whole book.

---

## 2. Step 1 — Gather (name/keyword windows)

Collect candidate passages by the character's name and by topic keywords, with
enough surrounding context to be meaningful. Everything here is read-only.

```bash
cd private/Books
NAME="Abigail"; SURNAME="Kamara"
for f in Rivers*.md; do
  echo "### $f"
  grep -n -i "$NAME" "$f"
done
```

Then narrow to the worldview dimensions you want the persona to be able to
answer about. Run the name through topic filters:

```bash
# where they live / their life / background
grep -n -i "$NAME" "$f" | grep -i -E "estate|flat|live|home|school|family|mum|dad|father|mother|cousin|job|work|age|born"
# who they know
grep -n -i "$NAME" "$f" | grep -i -E "friend|knows|with |told|asked|Nightingale|Peter|Lesley|Molly"
# what they know about magic / the demi-monde
grep -n -i "$NAME" "$f" | grep -i -E "magic|spell|werelight|vestigi|ghost|practi|appren|Latin|Folly|river|charm|fae|fairy"
```

To cite provenance, map a hit line to its chapter (uniform heading makes this a
one-liner):

```bash
awk -v L=<line> 'NR<=L && /^# Chapter/ {ch=$0} END{print ch}' "$f"
```

Copy the matched windows (the paragraph around each hit) into a scratch buffer.
Read them as a human would; you are looking for **stable** facts, not events.

---

## 3. Step 2 — The persona schema (expanded for worldview knowledge)

This extends the §2 schema in the plan with the lived-world sections that let a
player ask "where do you live?", "who do you know?", "what's your life like?",
"what do you know about magic?" and get an in-character answer. Fill only what
the books support; leave a section out rather than invent.

```markdown
---
name: <Full Name>
slug: <kebab-name>            # MUST equal the filename root in personas/
aliases: [<short names>]
player_safe: true            # may a player chat with this NPC at all?
source: original paraphrase from RoL novels NN–NN (private); no quoted text
reviewed: { by: <gm>, date: <YYYY-MM-DD> }
---

# <Full Name> — Persona

<one-line framing: who they are, written in our own words>

## Voice & register
<how they speak: formality, vocabulary, rhythm, humour>

## Demeanour
<bearing, temperament, how they carry themselves>

## Life & circumstances        ← worldview: "what's your life like?"
<where they live (area/estate/landmark), age band, household, school or job,
 daily routine, money/class in general terms, look and dress if iconic>

## Background & heritage        ← worldview: "where are you from?"
<origin, family makeup, culture/community, how they came to be where they are —
 stable biography only, no plot>

## People they know             ← worldview: "who do you know?"
<named relationships and what each is to them: family, friends, colleagues,
 mentors, the powers they deal with — public-knowledge connections only>

## Their London / the demi-monde ← worldview: how they see the world
<their personal take on the city and the hidden world: what's normal to them,
 what they find strange, where they go, what they care about>

## What they know about magic   ← worldview: "what do you know about magic?"
<their actual level of understanding: what they've seen, what they can/can't do,
 the concepts they grasp (e.g. vestigia, werelight, ghosts), what's still a
 mystery to them. Pitch it to the character — a beginner is not the Nightingale>

## Standing values & goals
<general, series-stable motivations; NOT case plot>

## Manner of speech (our words, for flavour)
<typical phrasings/tics, in original wording — never quoted from the book>

## Boundaries
<what they deflect; never plot/spoilers/others' secrets; never quote the books;
 stays in character; defers rules questions to the Rules assistant>
```

Why these extra sections: the chat system prompt
(`src/scenarioInfo.js` → `streamNpcChat`) injects the **whole** persona body
verbatim and tells the model to improvise in character where the notes are
silent. Richer worldview sections = the NPC can field "where do you live / who
do you know / what's it like / what do you know about magic" instead of
deflecting. The sheet JSON still supplies public hard facts separately.

### 3a. Be full, not thin

Because the whole body is injected into the chat prompt and the local model's
context window is large (256K), the real constraint is **focus and voice, not
length**. Write *full, rich* personas: pack concrete, grounded detail into every
section — specific places the character would name, opinions they actually hold,
named relationships they can reference, the texture of their daily life, and the
real extent of what they know. A fuller file lets the NPC *answer* ("what's your
local? what did your dad play? what do you make of the rivers?") instead of
deflecting. Pad nothing, but leave nothing useful out — aim well past a thin
stat-block. (Non-verbal characters — e.g. Molly, Foxglove, the dogs — still get a
full file; just render their "replies" as gesture, action, art or written notes.)

**Fullness means *mineable knowledge*, not personality padding.** The point of an
NPC chat is that the character **knows useful things** a player can extract by
asking the right questions. Voice and mannerisms are nearly invisible at the table;
what players actually feel is whether the NPC can *tell them something they can act
on*. So for every knowledgeable NPC, give a prominent **"What they can tell you"**
dimension packed with concrete, *actionable* expertise, lore, leads and contacts in
their domain — and pitch it to their real competence. It must be **general,
series-stable knowledge, never the answer to the players' specific case** (a player
asking "how would I tell if this death was magical?" gets the expertise; "who's the
killer?" gets a deflection).

Worked example — **Dr Walid** leads with how to spot a magical death, the
brain-damage signature that betrays a practitioner, what an autopsy of a weird
victim reveals, and how to preserve a magical specimen. That's a resource a GM can
hand a stuck player. A one-shot witness (a frightened bookshop assistant) has little
to mine and stays short; a cryptopathologist, a master wizard, an archivist, a river
goddess or a Chinatown swordsman should each be a genuine, distinct knowledge base.

### 3b. Privileged / GM-aide NPCs need extra data

A few NPCs hold a special position in play and need **sections beyond the standard
schema** so they can do their in-game job, plus deliberate, documented variation
from the books where the game needs it.

**DCI Nightingale is the prime example.** He is the players' *governor and mentor*,
so his persona is intentionally **fuller than his more reserved page-self** and is
primed with extra knowledge so he can answer what the team will actually ask of
their boss. Give him (and any NPC with a comparable role) dedicated sections such as:

- **As your governor — guidance & clues:** a safe in-character source of *generic*
  steer (point at the next line of enquiry, suggest who to ask, ask the nudging
  question) **without** handing over the solution or inventing case facts.
- **The Glitch:** he discusses how each investigator first came into the strange,
  takes it seriously, and uses it to understand and mentor them.
- **Teaching magic safely:** the safety-first sequence, the real dangers
  (overreach, cumulative harm), and a firm refusal to let a beginner go past their
  competence.
- **Police procedure:** prime him with genuine UK policing knowledge — PACE,
  lawful entry and warrants, the caution, evidence continuity/chain of custody,
  disclosure, surveillance authorisations, risk assessment — so he can insist the
  team do everything by the book.

Apply the same principle to any other NPC whose function requires it (a fixer's
contacts, a quartermaster's kit, a scholar's references). Note such variation in
the file's framing so it's clear it's a deliberate game choice, not an error.

---

## 4. Step 3 — Review & save

- A human reads the draft against the constraints (§0): no quoted text, no
  spoilers, nothing from out-of-scope books, everything series-stable.
- Save to `Rivers_of_London/globaldata/npcs/personas/<slug>.md`. The filename
  root **must** match the entity name's slug so the app's filename association
  links it to the right NPC and the picker shows the right name.
- Record provenance in `source:` (which books) and `reviewed:` (who/when).
- Do **not** put any of this in the JSON sheet — personality lives only in the
  persona file (plan §2).

---

## 5. The extraction prompt (paste into the local model)

Give the model **only** the gathered windows (§2) plus this instruction. It is
written to pull worldview knowledge while honouring every constraint. Tune the
wording here when results drift; this block is the thing we iterate on.

> You are helping build an in-character persona note for a fictional character
> from a novel series, for use by a separate role-play chatbot. You will be given
> excerpts mentioning the character. Produce a persona note in the exact Markdown
> schema below.
>
> Goal: capture what this character would plausibly **know and talk about** — the
> world as they live it. A player should be able to ask them *where they live,
> who they know, what their life is like, and what they understand about magic
> and the hidden world*, and get an answer that fits the character.
>
> Strict rules:
> - Write **only original paraphrase in your own words**. Never copy or lightly
>   reword any sentence from the excerpts. No quotations.
> - Include **only series-stable** facts: personality, circumstances,
>   relationships, and standing knowledge that stay true across the series.
> - **Exclude** all plot: events, deaths, twists, reveals, romance, case
>   outcomes, anything tied to one specific scene or moment.
> - Pitch the "what they know about magic" section to the character's **actual
>   competence** shown in the excerpts — a curious beginner is not an expert.
> - If the excerpts don't support a section, write `*(not established)*` rather
>   than inventing.
> - Output only the filled schema, nothing else.
>
> Schema:
> [paste the schema body from §3, sections only]

---

## 6. Worked example

`abigail-kamara.md` (in `globaldata/npcs/personas/`) was produced with this
method from novels **02–04**. Use it as the reference for tone and depth, and as
the test bed when iterating on §3/§5.

## 7. Change log

- 2026-06-02 — First version. Added worldview sections (Life & circumstances,
  Background & heritage, People they know, Their London / the demi-monde, What
  they know about magic) on top of the plan's §2 schema. Built Abigail Kamara as
  the first worldview-aware persona.
- 2026-06-06 — Drafted personas for the full NPC roster (24 new + Abigail &
  Nightingale). Added §3a **fullness** guidance (go rich; the constraint is focus,
  not length) and §3b **privileged / GM-aide NPC** guidance. Re-grounded and
  enriched DCI Nightingale as the flagship — the players' governor/mentor, primed
  with generic-clue steer, the Glitch, safe-magic teaching and full UK police
  procedure. Noted non-verbal NPCs (Molly, Foxglove, the dogs) and that
  case-solution entities (the Spirit of Books) are `player_safe: false`. All new
  files are GM-review-pending.
