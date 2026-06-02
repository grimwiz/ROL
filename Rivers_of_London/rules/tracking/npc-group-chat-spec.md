# Spec: Multi-NPC carry-over chat ("group conversation")

Status: **implemented 2026-06-02** (this commit). Extends the NPC-chat feature in
[`npc-personas-and-lore-plan.md`](npc-personas-and-lore-plan.md) §3.

## Goal

In AI Support → NPCs, the conversation **persists when the user switches the
"Speaking with" dropdown**, so a player can interview one NPC, switch to another,
and the new NPC reacts to what was said. Each NPC understands that earlier turns
were spoken by *other characters*, not itself. The conversation resets when the
user leaves the tab.

## Lifecycle / reset

- **Persists across:** NPC dropdown switches.
- **Resets on:** leaving the NPC sub-tab (mode toggle to GM/Rules), switching
  session, the explicit **Clear** button.
- In-memory only, per session (`State.npcChat`); nothing persisted server-side.

## Frontend (`public/js/app.js`)

Speaker identity moved from the single active `st.name`/`st.portrait` onto each
message, so two NPCs can appear in one log.

- Message shape: NPC turns now carry `{ speakerSlug, speakerName, portrait }`.
- `setNpcChatTarget` — **no longer clears `st.messages`**; only changes who
  replies next.
- `sendNpcChat` — stamps the new assistant turn with the active NPC's identity.
- `runNpcStream` — payload sends `speaker` (the NPC name) per assistant turn.
- `npcChatLogHtml` — renders each turn with its **own** speaker name/portrait;
  adds an `.npc-handoff` divider when consecutive NPC turns change speaker.
- `setAiSupportMode` — calls `resetNpcChat()` when leaving `npc` mode.
- `resetNpcChat()` — aborts any stream and drops history; reused by Clear.

## Backend (`src/scenarioInfo.js`)

- `sanitiseNpcChatMessages` — like `sanitiseChatMessages`, but preserves the
  per-turn `speaker`.
- `buildNpcTurns(history, activeName)` — folds the attributed, multi-speaker
  history into clean **alternating** turns from the active NPC's point of view:
  - The active NPC's own past turns (`speaker === activeName`, or unattributed
    legacy turns) stay as `assistant`.
  - The player's lines (`GM:`) and any *other* NPC's lines (`<name>:`) are
    labelled and **coalesced onto the `user` side**. Coalescing is what
    guarantees user/assistant alternation for the model template.
- `streamNpcChat` — uses `buildNpcTurns`, and the frozen system prompt gains a
  transcript note: lines are labelled by speaker; `GM:` is the person talking to
  you now; other names were said by *that* character; react in character, never
  assume you said another character's words, don't adopt their claims as your own
  private knowledge unless you'd genuinely know them.
- `routes.js` `/sessions/:id/npc-chat` — unchanged; already forwards
  `req.body.messages`.

## Worked example

Interview Abigail, switch to Nightingale, "what do you think of that". Nightingale
receives:

```
system: You are DCI Thomas Nightingale … [persona] … [transcript note]
user:   GM: What do you know about DCI Nightingale?
        Abigail Kamara: He is dead powerful, proper old-school.
        GM: What do you think of that?
assistant: ⟵ Nightingale generates here, plainly seeing Abigail said the middle line
```

## Verification

`buildNpcTurns` unit-tested from source (2026-06-02):
- cross-NPC handoff folds to one labelled `user` turn — PASS
- legacy single-NPC alternates user/assistant — PASS
- active NPC's own past turn stays `assistant` — PASS

Not yet exercised against a live Ollama run; do that on `folly37` before relying
on it in a session.

## Decisions / edge cases

- **Player label** is `GM:`; swap for the actual player/character name later if
  wanted (pass it in the payload).
- **Privacy:** by design the active NPC now "hears" what a prior NPC said this
  session — intended group-chat behaviour, not a leak. Per-NPC anti-spoiler
  guardrails still bind each NPC's own output.
- **Context size:** 256k window, no truncation needed near-term
  (`sanitiseNpcChatMessages` still caps at the last 24 turns / 8k chars each).
