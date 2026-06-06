# BUILD_WHISPER.md — WhisperX speech-to-text service

A runbook for a **stateless** WhisperX inference server in a Proxmox LXC. The
audio counterpart to the existing Ollama (text) and ComfyUI (graphics) services:
ROL calls it over HTTP on the LAN; it transcribes audio, optionally diarises it,
and produces speaker embeddings, then forgets everything.

> **Status: validated on real hardware.** Two reference instances are running this
> exact recipe (Debian 13 / Python 3.13 LXCs):
> - **stt37** — GPU, Quadro P1000 4 GB (Pascal) on host *cirithungol37*.
>   `large-v3` int8 on CUDA, **1.9 GB VRAM**, ~3.5 s for an 11 s clip.
> - **stt201** — CPU-only, 16 cores on host *shelob*. `large-v3` int8 on CPU,
>   ~8.8 s for an 11 s clip (RTF ~0.8).
>
> Both serve transcribe + diarize + embed. The one section ROL depends on is the
> **§2 API contract** — keep it stable.

---

## 1. Architecture & principles

```
ROL app (folly box, Node)                WhisperX box (Proxmox LXC, GPU or CPU)
─────────────────────────                ───────────────────────────────────────
  dictation / session audio  ──HTTP──▶   POST /v1/transcribe   → { text, segments? }
  voiceprint enrollment WAV  ──HTTP──▶   POST /v1/embed        → { embedding: float[] }
                                         GET  /health          → { ok, device, gpu, ... }
  Home Assistant (Assist)    ──Wyoming▶  in-process Wyoming listener, same model (§11)
```

**Stateless compute — a hard requirement.** The server **must not persist** any
audio, transcript, or embedding beyond the request (tmp file, deleted in a
`finally`). All persistence, consent state, and biometric storage live in ROL
(SQLite + `private/`). Consequences:

- The box **processes** personal/biometric data in transit, so it is part of the
  processing chain and **within** GDPR scope — processing ≠ storage. Statelessness
  buys *risk reduction, not exemption*: no data at rest means storage-limitation is
  satisfied and there is nothing to erase. Article 32 (security of processing) still
  applies — handled by network segmentation/firewalling (your call, out of scope)
  and no content logging.
- The server never decides *who* a voice belongs to. It returns a raw embedding;
  ROL compares it against enrolled vectors and owns the Article 9 data.
- No request logging of audio content or transcripts.

**Domain biasing** for Rivers-of-London vocabulary (vestigia, Nightingale, the
Folly, Falcon, SAU, Beverley Brook…) is passed *per request* by ROL via the
`hotwords` / `initial_prompt` fields — the server holds no glossary.

**4 GB-GPU reality (Pascal):** `large-v3` at **`int8`** uses ~1.9 GB and is
*faster* than fp16 on Pascal (which has poor fp16 throughput), so int8 is the
default. Whisper runs on the GPU; pyannote (diarization/embeddings) runs on **CPU**
so it never competes for the 4 GB. On a CPU-only box everything runs on CPU.

---

## 2. API contract (STABLE — implement exactly)

**No application-level auth.** Access is governed entirely by network segmentation
/ firewalling (deliberately — Home Assistant's Wyoming integration sends no bearer
token). Bind to the trusted segment only, same posture as Ollama.

### `GET /health`
```json
{ "ok": true, "model": "large-v3", "compute": "int8", "device": "cuda",
  "gpu": "Quadro P1000, 1879 MiB, 4096 MiB", "diarization": true }
```
`device` is `cuda` or `cpu`; `gpu` is empty on a CPU box; `diarization` reflects
whether `HF_TOKEN` is set.

### `POST /v1/transcribe`  (multipart/form-data)

| field            | type    | default | notes                                              |
|------------------|---------|---------|----------------------------------------------------|
| `file`           | file    | —       | audio (webm/opus, wav, m4a, mp3 — decoded via ffmpeg) |
| `language`       | string  | `en`    | ISO code                                           |
| `initial_prompt` | string  | `""`    | biasing/style prompt (~224-token budget)           |
| `hotwords`       | string  | `""`    | space/comma-separated boosted terms (RoL proper nouns) |
| `diarize`        | bool    | `false` | attribute segments to speakers (needs `HF_TOKEN`)  |

Response:
```json
{
  "text": "full transcript ...",
  "language": "en",
  "duration": 73.4,
  "segments": [ { "start": 0.0, "end": 4.2, "text": "...", "speaker": "SPEAKER_00" } ]
}
```
- `speaker` is present only when `diarize=true` **and** `HF_TOKEN` is configured.
  Labels are session-local (`SPEAKER_00`…); the server does **not** map them to
  identities — ROL does.
- VAD filtering is always on (suppresses Whisper's silence/crosstalk hallucinations).

### `POST /v1/embed`  (multipart/form-data)
| field  | type | notes                                  |
|--------|------|----------------------------------------|
| `file` | file | a clean voice sample (the enrollment clip) |

Response: `{ "embedding": [ … ], "dim": 512 }` — an L2-normalised speaker
embedding. ROL stores it and does cosine matching itself. Returns
`{ "error": "HF_TOKEN not configured" }` if no token. **No audio retained.**

---

## 3. Proxmox host + LXC — GPU passthrough (GPU boxes only)

Use the existing helper **`pve-nvidia-install.sh`** on the **Proxmox host** (not
inside the LXC). It installs the host kernel driver and, for a target container,
writes the device-passthrough config *and* installs the in-container CUDA client
libraries pinned to the host driver version.

```bash
./pve-nvidia-install.sh --install                 # host kernel driver (once)
./pve-nvidia-install.sh --lxc <CTID> --install    # passthrough + in-container CUDA libs
./pve-nvidia-install.sh --lxc <CTID> --query      # verify
```
Then restart the container (passthrough device mounts take effect at start) and
confirm inside it:
```bash
nvidia-smi          # must list the GPU
```

> **Known wart:** the in-container NVIDIA CUDA apt repo this adds (debian12) ships
> with a missing GPG key (`A4B469963BF863CC`), so `apt update` warns on that repo.
> Harmless to the pip-based stack below, but worth fixing the key import.

**CPU-only box:** skip §3 entirely. No device setting needed — `WHISPER_DEVICE=auto`
detects the absence of a GPU and runs on CPU (set `WHISPER_DEVICE=cpu` only if you want
to force it).

---

## 4. Inside the container — base packages

```bash
apt update && apt install -y ffmpeg python3 python3-venv python3-pip python3-dev build-essential curl
```

---

## 5. Install the stack (validated recipe)

`ffmpeg` does all audio decoding; **torch is CPU-only in both GPU and CPU
deployments** (pyannote runs on CPU). On a GPU box, Whisper reaches the GPU through
`faster-whisper`/CTranslate2 using the pip CUDA libs below — *not* through torch.

```bash
python3 -m venv /opt/whisperx/venv
. /opt/whisperx/venv/bin/activate
pip install --upgrade pip wheel

# ASR + server (all boxes)
pip install faster-whisper fastapi "uvicorn[standard]" python-multipart wyoming

# GPU boxes only: CUDA libs CTranslate2 needs (skip on CPU-only)
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

# pyannote on CPU torch (all boxes) + omegaconf (NOT auto-pulled; checkpoints need it)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install pyannote.audio omegaconf

# CRITICAL: the +cpu torchcodec. PyPI's default is a CUDA build that fails with
# `libnvrtc.so.13 not found` → `NameError: AudioDecoder` at diarize time.
pip install --force-reinstall torchcodec --index-url https://download.pytorch.org/whl/cpu
```

### CUDA lib path (GPU boxes)
CTranslate2 loads cuBLAS/cuDNN from the pip packages; it won't find them unless
their dirs are on `LD_LIBRARY_PATH` *before the process starts* (set in the unit, §7):
```
/opt/whisperx/venv/lib/python3.13/site-packages/nvidia/cublas/lib
/opt/whisperx/venv/lib/python3.13/site-packages/nvidia/cudnn/lib
```

### HuggingFace token — required for diarization & embeddings
pyannote models are **gated**. With the HF account, accept the conditions for
**all four** (the 3.1 pipeline pulls a community-1 artifact):
- `pyannote/segmentation-3.0`
- `pyannote/embedding`
- `pyannote/speaker-diarization-3.1`
- `pyannote/speaker-diarization-community-1`

Then put a read token in `/opt/whisperx/whisperx.env` (§7). Transcription works
without it; only diarize/embed need it.

---

## 6. The server (`/opt/whisperx/app.py`)

This is the deployed, validated server. Whisper runs on `WHISPER_DEVICE`
(cuda/cpu); pyannote runs on `DIARIZE_DEVICE` (cpu). The shared model is serialised
with a lock (faster-whisper is not concurrency-safe). pyannote is fed an
ffmpeg-decoded in-memory waveform, sidestepping the torchaudio/torchcodec I/O path.

```python
import os
import tempfile
import threading
import subprocess

from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
COMPUTE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")   # auto | cuda | cpu
DIARIZE_DEVICE = os.environ.get("DIARIZE_DEVICE", "cpu")
HF_TOKEN = os.environ.get("HF_TOKEN") or None

app = FastAPI(title="WhisperX STT")

def _gpu_present():
    # Cheap, reliable check that a GPU is actually passed through to this host —
    # guards against the container being migrated onto a GPU-less cluster node
    # (no /dev/nvidia* -> no CUDA), and against a CUDA runtime that won't init.
    import glob
    if not glob.glob("/dev/nvidia[0-9]*"):
        return False
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False

def _load_asr():
    # Resilient device selection. WHISPER_DEVICE=auto (default) uses CUDA only when
    # a GPU is really present; and ANY GPU load failure falls back to CPU instead of
    # crash-looping. Same image runs unchanged on GPU and CPU nodes.
    want = DEVICE.lower()
    if want == "cuda" or (want == "auto" and _gpu_present()):
        try:
            return WhisperModel(MODEL, device="cuda", compute_type=COMPUTE), "cuda", COMPUTE
        except Exception as e:
            print(f"[whisperx] CUDA load failed ({e!r}); falling back to CPU", flush=True)
    compute = COMPUTE if COMPUTE in ("int8", "int8_float32", "float32") else "int8"
    return WhisperModel(MODEL, device="cpu", compute_type=compute), "cpu", compute

asr, ASR_DEVICE, ASR_COMPUTE = _load_asr()
print(f"[whisperx] model={MODEL} device={ASR_DEVICE} compute={ASR_COMPUTE}", flush=True)
_lock = threading.Lock()   # faster-whisper is not concurrency-safe (GPU phase only)
_diar = None   # lazy pyannote diarization pipeline (CPU)
_embed = None  # lazy pyannote embedding inference (CPU)


def _save(upload):
    fd, path = tempfile.mkstemp(suffix=".bin")
    with os.fdopen(fd, "wb") as f:
        f.write(upload.file.read())
    return path


@app.get("/health")
def health():
    gpu = ""
    try:
        gpu = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        pass
    return {"ok": True, "model": MODEL, "compute": ASR_COMPUTE, "device": ASR_DEVICE,
            "device_requested": DEVICE, "gpu": gpu, "diarization": bool(HF_TOKEN)}


@app.post("/v1/transcribe")
def transcribe(file: UploadFile = File(...),
               language: str = Form("en"),
               initial_prompt: str = Form(""),
               hotwords: str = Form(""),
               diarize: bool = Form(False)):
    path = _save(file)
    try:
        with _lock:  # GPU phase only — released before the long pyannote phase
            segments, info = asr.transcribe(
                path, language=language or None,
                initial_prompt=initial_prompt or None,
                hotwords=hotwords or None,
                vad_filter=True, word_timestamps=True)
            seg_list = []
            for s in segments:
                words = [{"start": w.start, "end": w.end, "word": w.word}
                         for w in (s.words or [])]
                seg_list.append({"start": s.start, "end": s.end,
                                 "text": s.text, "words": words})

        resp = {"text": "".join(s["text"] for s in seg_list).strip(),
                "language": info.language, "duration": info.duration}
        if diarize and HF_TOKEN:
            segs, speakers = _diarize_align(path, seg_list)
            resp["segments"] = segs
            resp["speakers"] = speakers   # { SPEAKER_xx: [256-d voiceprint] }
        else:
            resp["segments"] = [{"start": s["start"], "end": s["end"], "text": s["text"]}
                                for s in seg_list]
        return resp
    finally:
        os.remove(path)


def _load_audio(path):
    import numpy as np
    import torch
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-threads", "1", "-i", path,
         "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True)
    audio = np.frombuffer(out.stdout, dtype=np.float32).copy()
    return {"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": 16000}


def _diar_device():
    # pyannote runs on torch. Resolve DIARIZE_DEVICE=auto|cuda to "cuda" only when a
    # CUDA torch build actually sees a GPU; otherwise "cpu" — so a CPU-torch box, or a
    # GPU box migrated onto GPU-less hardware, degrades instead of crashing.
    want = DIARIZE_DEVICE.lower()
    if want == "cpu":
        return "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _get_diar():
    global _diar
    if _diar is None:
        import torch
        from pyannote.audio import Pipeline
        _diar = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", token=HF_TOKEN)
        _diar.to(torch.device(_diar_device()))
    return _diar


# Word-level speaker alignment: assign each transcribed word the speaker whose
# pyannote turn it overlaps most, then regroup consecutive same-speaker words into
# speaker-coherent segments (splits a Whisper segment when the speaker changes
# mid-segment). Also returns each speaker's L2-normalised voiceprint so callers
# can link SPEAKER_xx consistently across windows/sessions.
def _diarize_align(path, seg_list):
    import numpy as np
    out = _get_diar()(_load_audio(path))
    ann = getattr(out, "speaker_diarization", out)
    labels = list(ann.labels())
    timeline = [(seg.start, seg.end, spk) for seg, _, spk in ann.itertracks(yield_label=True)]

    def spk_for(t0, t1):
        best, best_ov = None, 0.0
        for (s, e, spk) in timeline:
            ov = min(t1, e) - max(t0, s)
            if ov > best_ov:
                best_ov, best = ov, spk
        if best is not None:
            return best
        mid = (t0 + t1) / 2.0          # no overlap → nearest turn
        bn, bg = None, 1e9
        for (s, e, spk) in timeline:
            g = min(abs(s - mid), abs(e - mid))
            if g < bg:
                bg, bn = g, spk
        return bn

    out_segs, cur = [], None
    for seg in seg_list:
        words = seg.get("words") or [{"start": seg["start"], "end": seg["end"], "word": seg["text"]}]
        for w in words:
            sp = spk_for(w["start"], w["end"])
            if cur and cur["speaker"] == sp:
                cur["end"] = w["end"]
                cur["text"] += w["word"]
            else:
                if cur:
                    out_segs.append(cur)
                cur = {"start": w["start"], "end": w["end"], "text": w["word"], "speaker": sp}
    if cur:
        out_segs.append(cur)
    for s in out_segs:
        s["text"] = s["text"].strip()

    speakers = {}
    se = getattr(out, "speaker_embeddings", None)
    if se is not None:
        arr = np.asarray(se, dtype=float)
        for i, lab in enumerate(labels):
            if i < len(arr):
                v = arr[i]
                speakers[lab] = (v / (np.linalg.norm(v) + 1e-9)).tolist()
    return out_segs, speakers


@app.post("/v1/embed")
def embed(file: UploadFile = File(...)):
    if not HF_TOKEN:
        return {"error": "HF_TOKEN not configured"}
    path = _save(file)
    try:
        import numpy as np
        global _embed
        if _embed is None:
            from pyannote.audio import Model, Inference
            m = Model.from_pretrained("pyannote/embedding", token=HF_TOKEN)
            import torch
            _embed = Inference(m, window="whole", device=torch.device(_diar_device()))
        v = np.asarray(_embed(path)).reshape(-1)
        v = v / (np.linalg.norm(v) + 1e-9)
        return {"embedding": v.tolist(), "dim": int(v.shape[0])}
    finally:
        os.remove(path)
```

---

## 7. systemd unit (`/etc/systemd/system/whisperx.service`)

The token lives in a separate `chmod 600` env file (`EnvironmentFile`), never in
the unit. **GPU box** — keep the `LD_LIBRARY_PATH`; `WHISPER_DEVICE=auto` uses the
GPU when present and falls back to CPU if passthrough breaks (so it never crash-loops):

```ini
[Unit]
Description=WhisperX speech-to-text service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/whisperx
Environment=WHISPER_MODEL=large-v3
Environment=WHISPER_COMPUTE_TYPE=int8
Environment=WHISPER_DEVICE=auto
Environment=DIARIZE_DEVICE=cpu
Environment=LD_LIBRARY_PATH=/opt/whisperx/venv/lib/python3.13/site-packages/nvidia/cublas/lib:/opt/whisperx/venv/lib/python3.13/site-packages/nvidia/cudnn/lib
# Optional secrets/overrides (HF_TOKEN). Leading '-' makes it optional.
EnvironmentFile=-/opt/whisperx/whisperx.env
ExecStart=/opt/whisperx/venv/bin/uvicorn app:app --host 0.0.0.0 --port 9000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**CPU-only box:** identical unit — `WHISPER_DEVICE=auto` resolves to CPU when no GPU
is present — just **drop the `LD_LIBRARY_PATH` line** (no CUDA libs installed). Create
the token file and start:
```bash
umask 077; printf 'HF_TOKEN=%s\n' 'hf_...' > /opt/whisperx/whisperx.env
systemctl daemon-reload && systemctl enable --now whisperx
```

> First start downloads `large-v3` (~3 GB) before the port opens — `/health` won't
> answer until that finishes (poll it).

---

## 8. Verification

```bash
curl -s http://localhost:9000/health

# transcription with RoL biasing (jfk.wav is a handy public-domain smoke clip)
curl -s http://localhost:9000/v1/transcribe \
  -F file=@sample.wav \
  -F 'hotwords=Nightingale vestigia Folly Falcon Beverley Brook SAU' \
  -F 'initial_prompt=A Rivers of London tabletop session.'

# diarised (needs HF_TOKEN + all four gated models accepted)
curl -s http://localhost:9000/v1/transcribe -F file=@table.wav -F diarize=true

# embedding
curl -s http://localhost:9000/v1/embed -F file=@voice.wav
```

**Real validation gate:** run transcription on a *real* table recording with RoL
vocabulary — the proper nouns must come back spelled correctly. (jfk.wav has no
domain terms, so it can't prove the biasing.)

---

## 9. Config reference

| env var                | purpose                                   | default          |
|------------------------|-------------------------------------------|------------------|
| `WHISPER_MODEL`        | ASR model                                 | `large-v3`       |
| `WHISPER_COMPUTE_TYPE` | precision (`int8` for 4 GB / Pascal)      | `int8`           |
| `WHISPER_DEVICE`       | `auto` (GPU if present, else CPU), `cuda`, `cpu` | `auto`     |
| `DIARIZE_DEVICE`       | pyannote device (keep `cpu` on 4 GB GPUs) | `cpu`            |
| `HF_TOKEN`             | gated pyannote models (via EnvironmentFile)| —               |

**Network:** no application-level auth — access governed entirely by network
segmentation / firewalling (out of scope). Expose only on the trusted segment.

---

## 10. Troubleshooting (all hit during the real build)

| symptom | cause / fix |
|---------|-------------|
| `nvidia-smi` fails in container | passthrough — re-run `pve-nvidia-install.sh --lxc <id> --query` (§3); restart CT |
| `Library libcublas.so.12 not found` | `LD_LIBRARY_PATH` not set in the unit (§7) — point it at the pip `nvidia/{cublas,cudnn}/lib` |
| `NameError: name 'AudioDecoder' is not defined` | wrong torchcodec — install the **`+cpu`** build from the pytorch cpu index (§5) |
| `ModuleNotFoundError: omegaconf` | `pip install omegaconf` (§5) |
| `Pipeline.from_pretrained() got an unexpected keyword 'use_auth_token'` | pyannote 4.x renamed it — use `token=` |
| `'DiarizeOutput' object has no attribute 'itertracks'` | pyannote 4.x — use `.speaker_diarization` (handled in §6) |
| `403 GatedRepoError … community-1` | accept `pyannote/speaker-diarization-community-1` too (§5) |
| transcription invents text in silence | `vad_filter=True` (already on) |
| OOM on a 4 GB GPU | keep `WHISPER_COMPUTE_TYPE=int8` and `DIARIZE_DEVICE=cpu` |

---

## 11. Home Assistant (Wyoming) — optional second consumer

The same box can drive Home Assistant's voice (Assist) pipeline — but **HA does
not speak the §2 REST contract.** HA's voice stack uses the **Wyoming protocol**
(a small TCP protocol), so you add a *second* front-end on the box:

- **Do _not_ run a separate `wyoming-faster-whisper` process** — it loads a second
  copy of the model. Share one model in memory: add a Wyoming front-end *inside this
  same process* so both protocols call the one loaded `asr` instance. Use the
  `wyoming` lib's `AsyncServer` + an ASR event handler (buffer `AudioChunk`s → run
  `asr.transcribe` under the same lock → emit `Transcript`), launched as an asyncio
  task from the FastAPI lifespan; it listens on its own TCP port. In HA: Settings →
  Devices & Services → **Add Wyoming** → `host:port`.
- ROL hits the REST endpoints (§2), HA hits the Wyoming port — **one process, one
  model.** Serialise on the existing mutex.

**Entity-name biasing.** Feed HA's **exposed-entity** names (lights, areas, scenes —
"the snug lamp", "Beverley's room") into the STT bias so commands transcribe
correctly:

- Pull the exposed set from HA's API (the entities exposed to Assist) and build a
  `hotwords` / `initial_prompt` string from their friendly names.
- **Apply it as a standing default, not per-utterance.** The home's entity set is
  stable, so set it once and refresh on a schedule — per-utterance hotword injection
  isn't reliably exposed through Wyoming across versions.
- STT is one stage of HA's pipeline; wake word (openWakeWord) and TTS (Piper) are
  separate Wyoming services HA already supports.
```
