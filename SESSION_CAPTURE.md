# Session capture — voice → diarized transcript

Records a live game session from the GM's microphone and turns it into an editable
transcript of `## Speaker  HH:MM` blocks in the session's source file. Speech is
transcribed and attributed to speakers automatically; the GM labels each voice once
and the labels persist across sessions.

The speech itself runs on a separate, general-purpose STT box (Parakeet + pyannote —
see **`BUILD_PARAKEET.md`**). ROL only orchestrates and presents.

## How it works — two independent layers

The core rule learned the hard way: **diarization is metadata; it must never change or
re-order the words.** So transcription and speaker-labelling are decoupled.

1. **Live transcription (the words).** Browser VAD chops the mic into utterances; each
   is transcribed (with the case glossary) and printed **the instant you pause** — and
   **kept verbatim**. Those words *are* the transcript; nothing rewrites or removes them.
   Long unbroken speech is emitted every few seconds so subtitles keep flowing.
2. **Diarization (the speaker label).** Audio is streamed to a server-side buffer; a
   separate pass labels who-said-what and attaches the `## Speaker` heading to words
   layer 1 already wrote. Until a stretch is labelled it shows under `## …`.

Diarization runs **incrementally in bounded windows** — never the whole session in one
block (a session can be hours long):

- A window opens only after **≥30 s** of speech (`DIAR_MIN_SEC`) and is **cut on a real
  pause** (preferring a sentence end), so no speaker straddles the boundary — a mid-turn
  cut is what fragments one voice into several. Hard ceiling **90 s** per call
  (`DIAR_WINDOW_MAX_SEC`); the browser sends the preferred pause as the cut point.
- The client drains the backlog one bounded window at a time, and mid-session never
  diarizes a sub-30 s fragment (it leaves the tail for the next pass). Stop flushes the
  remaining tail.

## Speaker voices

Each distinct voice is folded into a per-case **voiceprint registry**
(`data/sessions/<case>/voiceprints.json`, git-ignored — biometric, GDPR Art. 9). The
registry keeps a speaker as one identity across windows and sessions.

- **No words, no voice.** A pyannote cluster with no actual speech is never registered,
  and existing empty ghosts are pruned — so phantom `v3`/`v4` voices don't accumulate.
- **Session voices panel** (under the capture button): name a voice (persists and
  relabels the transcript everywhere), **merge** a falsely-split voice into the real one
  (combines the voiceprints), **delete** a genuinely spurious voice, or **unidentify**
  (clear the name, keep the print).
- **Enrolment:** dictating into a character's personality file enrols that speaker's
  voiceprint under the character name, so future captures auto-label them. Only the label
  is kept, never the audio.

## Glossary boost

Recognition is biased toward the case's proper nouns (PCs, NPCs, locations, spells) at
**recognition time** (never an LLM rewrite). Strength is a ROL-side dial — **Admin →
Service endpoints → "Glossary boost strength"** (0–5, default 0.5; 0 disables). Too high
forces a glossary name onto a similar ordinary word; lower is safer.

## Controls / lifecycle

- **🎙 Capture session** button on the **Edit Files** tab starts/stops.
- The top **"Recording m:ss — click to stop"** pill is visible from every tab and is
  itself a stop control, so the mic is always stoppable.
- Capture **continues while you browse other tabs**; returning to the session's Edit
  Files reconnects (button shows **⏹ Stop**, transcript intact). If you stop from the
  pill while away, the transcript is restored next time you open that session.
- Mic needs a **secure context** (HTTPS or `localhost`); the button is disabled on plain
  HTTP.

## Known limitations / TODO

- **Returning to a recording session can trigger the editor's "discard changes" prompt**
  — the live transcript counts as unsaved edits. Clicking *Cancel* keeps the window.
  To be refined (the capture should be recognised as the source of those edits).
- **The trailing `## …` block isn't always resolved on stop** — a final utterance whose
  live text lands after the last diarization window can stay unlabelled. Stop should
  reconcile any leftover `## …` to a speaker (carry forward the last one if needed).
- Capture writes into the source editor; **switching to a different file mid-capture**
  isn't handled — the transcript targets whatever file is open.
- **Live-subtitle latency has a ~1 s floor** (batch per-utterance HTTP ASR; true
  word-streaming would need a different ASR mode the engine doesn't expose).
- Diarized speaker labels appear a little after the words (they settle as windows
  complete); the **words never move**, only the heading.
