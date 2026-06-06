# BUILD_PARAKEET.md — Parakeet speech-to-text service

The **current** STT service for ROL. Replaces the Whisper/CTranslate2 stack
documented in **`BUILD_WHISPER.md`** (kept for historical reference). Same job —
transcribe audio, optionally diarise it, produce speaker voiceprints, expose a
Home-Assistant (Wyoming) endpoint — but with a better recogniser and a single,
clean GPU stack.

> **Source of truth is the install script, not this file.** The whole service
> (app + systemd unit + deps) is produced by **`../scripts/proxmox/install_parakeet.sh`**,
> which **embeds `app.py` verbatim**. This document *describes* the design and the
> validated results; it deliberately does **not** duplicate the application code, so
> it can't drift out of sync the way `BUILD_WHISPER.md`'s app.py did. To read the
> exact app, read the script.

> **Status: validated on real hardware (2026-06-05).**
> - **stt201** (RTX 2000E Ada, 16 GB) — GPU tier. Both ASR and diarization on the GPU,
>   ~4.4 GB VRAM, full 53-min episode in ~3 min (ASR RTF 0.008, diarize RTF 0.05).
> - **stt37** (Quadro P1000) — CPU tier (Pascal is below the CUDA-torch threshold), so
>   it runs Parakeet **on CPU** — acceptable for offline use as long as it beats 1× real-time.

---

## 1. Why Parakeet (vs Whisper)

On clean single-speaker audio, `distil-large-v3` still mangled recurring **proper
nouns** — and the post-edit pain for a fantasy/RoL setting is overwhelmingly proper
nouns. Measured against OCR'd DVD subtitles on a real episode:

- **NVIDIA Parakeet-TDT-0.6b-v2** (NeMo) — ~6 % WER on the Open ASR Leaderboard vs
  Whisper's ~7.5 %, English-specialised, and crucially it supports **recognition-time
  word-boosting** for a known vocabulary (the TDT greedy decoder's GPU boosting tree).
- **Canary-Qwen** scores higher still but is an LLM-decoder (SALM) — it would normalise
  invented RoL vocab toward plausible-real words, can't take word-boosting, and timestamp
  support is uncertain. **Rejected** for the same reason an LLM cleanup pass was rejected.
- No LLM rewriter anywhere in the pipeline — biasing happens at recognition, not after.

**The decisive evidence (glossary boosting works):** on the Raffles episode, baseline
Parakeet mangled `Bunny` ~1/3 of the time (6 spellings), `Crawshay` ~half (6 spellings),
and `Clephane` **0/12 correct**. Feeding those names as a boost list collapsed **all**
the mangled variants to zero and recovered Clephane (0 → 10), with no regression on
already-correct names. That is exactly the ROL case: the case file already knows its
characters/places/spells.

## 2. Architecture

```
ROL (folly box)                         Parakeet box (Proxmox LXC, GPU or CPU)
───────────────                         ───────────────────────────────────────
 dictation / session audio  ──HTTP──▶   POST /v1/transcribe  → { text, segments, speakers? }
 voiceprint enrolment WAV    ──HTTP──▶   POST /v1/embed       → { embedding, dim }
                                         GET  /health         → { ok, engine, device, gpu, ... }
 Home Assistant (Assist)    ──Wyoming▶   Wyoming STT listener (:10300), Parakeet, no diarization
```

- **ASR:** NeMo **Parakeet-TDT-0.6b-v2**, word-level timestamps, chunked at
  `PARAKEET_CHUNK_SEC` (120 s) to bound activation memory on long audio.
- **Diarization + voiceprints:** **pyannote** `speaker-diarization-3.1` + `embedding`,
  **same PyTorch/CUDA stack as Parakeet** — so both run on the GPU with no CUDA-version
  conflict (the thing that made Whisper-CTranslate2 + pyannote-on-GPU impossible to share
  in one venv). Word→speaker alignment is the same max-overlap logic as the WhisperX box.
- **Glossary boosting:** the request's `hotwords` (newline/comma-delimited phrases) are
  applied as the decoder's `boosting_tree.key_phrases_list` with weight `BOOST_ALPHA`
  (re-applied only when the phrase set changes, so per-case glossaries are cheap).

## 3. API contract

**Identical to the WhisperX service** (`BUILD_WHISPER.md` §2) so ROL needs no contract
change — only the URL. `POST /v1/transcribe` (multipart: `file`, `language`, `hotwords`,
`diarize`) returns `{ text, language, duration, segments[, speakers] }`; with
`diarize=true` + `HF_TOKEN`, `segments` carry `speaker` and `speakers` maps each
`SPEAKER_xx` to a voiceprint. `POST /v1/embed` returns an enrolment embedding.
`GET /health` reports `engine`, `device`, `gpu`, `boost_alpha`.

> **Known quirk (inherited):** `/v1/embed` returns the pyannote *embedding* model's
> **512-d** vector, while diarization `speakers` voiceprints are **256-d**. Same as the
> old WhisperX box — worth reconciling for the per-player enrolment feature.

## 4. Install

```bash
# inside a Debian 13 LXC, as root (GPU driver/passthrough handled separately by
# pve-nvidia-install.sh on the host; the script is app-layer only and touches no networking)
HF_TOKEN=hf_xxx ./install_parakeet.sh
```

The script is **idempotent and tier-aware**:
- **cuda tier** — modern GPU (`compute_cap ≥ MIN_CAP=7.0`) with `≥ MIN_VRAM_MB=8000`:
  installs **CUDA torch**; Parakeet + pyannote both on the GPU.
- **cpu tier** — no GPU, or an old/low one (e.g. Pascal P1000): installs **CPU torch**;
  everything on CPU.
It reconciles the torch build on re-run (removes the wrong CPU/CUDA build first — pip's
"already satisfied" otherwise silently skips the swap), pre-fetches the model, writes the
`parakeet.service` unit (`Restart=always`), and **self-validates via `/health`**.

Knobs (env): `PARAKEET_MODEL`, `APP_DIR` (/opt/parakeet), `PORT` (9000),
`BOOST_ALPHA` (2.0), `MIN_CAP`, `MIN_VRAM_MB`, `HF_TOKEN`.

## 5. Tuning `BOOST_ALPHA`

Boost weight for the glossary. `0` disables it. `~2.0` is the sweet spot found on real
audio: `3.0` fixed everything but slightly over-inserted a couple of names; `2.0` keeps
the correction while trimming false positives. Tune per corpus if needed.

## 6. ROL wiring

ROL points `WHISPERX_URL` (Admin page or env) at the Parakeet box and sends the case
glossary as `hotwords` — `buildCaseBias()` emits the case's PC names, key NPCs, glossary
terms and personas as **newline-delimited phrases**, which the service boosts directly.
No ROL code beyond the URL + delimiter is required; the `/v1` contract is unchanged.

> stt201 has no DNS and a volatile IP — give it a DHCP reservation / hostname and point
> `WHISPERX_URL` at that, rather than chasing the address.

## 7. Home Assistant

The service runs a Wyoming STT listener (`WYOMING_PORT`, default 10300) in a daemon
thread (best-effort; never blocks the API). Add it as a Wyoming integration in HA for
Assist. Single-speaker, no diarization on that path.
