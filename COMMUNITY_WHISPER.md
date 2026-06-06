# COMMUNITY_WHISPER.md — notes for a WhisperX community-scripts submission

**Parked.** This is the plan + research for submitting a self-contained WhisperX
helper script to community-scripts.org. It is **separate** from `BUILD_WHISPER.md`
(which is our internal/GPU runbook that relies on the private
`pve-nvidia-install.sh`). The public script must **not** depend on any private
tooling. Resume here when ready — nothing here is built yet.

## Prior-art check (done — field is open)
- **No** whisper/STT/speech/wyoming script exists in either repo (swept full `ct/`
  + `install/`: 524 scripts in ProxmoxVE, 88 in ProxmoxVED).
- Only prior attempt: **PR #11223 "Add wyoming-faster-whisper"** — closed **purely
  for wrong-repo routing** (maintainer MickLesk: *"New Scripts only ProxmoxVED"*),
  **never resubmitted**. It was also a narrower thing: the off-the-shelf
  `wyoming-faster-whisper` package (CPU, Home-Assistant-only, no REST API, no
  diarization, no embeddings).
- Our scope is broader/distinct: REST `/v1/transcribe` + `/v1/embed` + diarization,
  CPU + optional GPU, Wyoming as a *secondary* in-process consumer.
- The **`whisperx`** slug is free.

## Where it goes (confirmed twice)
- **Submit to ProxmoxVED** (the testing repo), NEVER ProxmoxVE. New-script PRs to
  ProxmoxVE are auto-rejected.
- A submission is just **two files**: `ct/whisperx.sh` + `install/whisperx-install.sh`
  (plus an optional `ct/headers/whisperx` ASCII banner). **JSON metadata is NOT in
  the PR** — Ollama has no json file in the repo; website metadata is managed
  separately through the project's website interface (per CONTRIBUTING).

## Framework conventions (mirror `ct/ollama.sh` + `install/ollama-install.sh`)
- `ct/whisperx.sh`: `#!/usr/bin/env bash`; `source <(curl … misc/build.func)`;
  set `APP`, `var_tags`, `var_cpu`, `var_ram`, `var_disk`, `var_os`, `var_version`,
  `var_unprivileged`; then `header_info; variables; color; catch_errors`; an
  `update_script()` (pip upgrade + `systemctl restart whisperx`); `start;
  build_container; description`; final access URL echo.
- `install/whisperx-install.sh`: `source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"`;
  `color; verb_ip6; catch_errors; setting_up_container; network_check; update_os`;
  phases wrapped in `msg_info`/`$STD …`/`msg_ok`; finish with `motd_ssh; customize;
  cleanup_lxc`. **No Intel/oneAPI cruft** (that was Ollama-specific).
- Lowercase-hyphen names, quoted vars, no embedded credentials. `dev_mode`
  (trace/keep/pause/dryrun) for testing before PR.

## GPU is the hard part — design decision: CPU-first, GPU auto-detect
- `build.func` `var_gpu=yes` binds `/dev/nvidia*` **only if the host already has
  drivers loaded**, and it does **NOT** install the in-container CUDA userspace
  (`libcuda`). Our private `pve-nvidia-install.sh` did that pinning; the public
  script can't.
- So: default **`var_gpu=no`, CPU-only and fully functional** (this is the path
  validated on stt201). In the install script, **probe** whether CUDA actually
  works and only then use it:
  ```bash
  GPU=cpu
  if [[ -e /dev/nvidia0 ]]; then
    "$VPIP" install nvidia-cublas-cu12 nvidia-cudnn-cu12
    NV=$(/opt/whisperx/venv/bin/python -c 'import sysconfig,os;print(os.path.join(sysconfig.get_paths()["purelib"],"nvidia"))')
    if LD_LIBRARY_PATH="$NV/cublas/lib:$NV/cudnn/lib" /opt/whisperx/venv/bin/python \
        -c 'import ctranslate2,sys; sys.exit(0 if ctranslate2.get_cuda_device_count()>0 else 1)'; then
      GPU=cuda   # add LD_LIBRARY_PATH in the unit (WHISPER_DEVICE stays "auto":
                 # app.py self-detects the GPU at load and falls back to CPU if it can't init)
    fi
  fi
  ```
  Everyone gets working CPU; anyone who has set up host+container NVIDIA drivers
  separately gets GPU automatically. Honest and self-contained.

## The stack to install (validated — full detail in BUILD_WHISPER.md §5/§6)
In a venv at `/opt/whisperx/venv`:
- `faster-whisper fastapi "uvicorn[standard]" python-multipart wyoming`
- `torch torchaudio --index-url https://download.pytorch.org/whl/cpu`
- `pyannote.audio omegaconf`
- **`--force-reinstall torchcodec --index-url …/cpu`** (the `+cpu` build — PyPI
  default needs `libnvrtc.so.13` → `NameError: AudioDecoder`)
- GPU only: `nvidia-cublas-cu12 nvidia-cudnn-cu12` + `LD_LIBRARY_PATH` in the unit
- **Reuse the validated `app.py` verbatim from BUILD_WHISPER.md §6** (ffmpeg-decode
  waveforms, pyannote `token=`, `DiarizeOutput.speaker_diarization`, shared lock,
  `int8` default, `WHISPER_DEVICE`/`DIARIZE_DEVICE` env).
- systemd unit on `:9000`, `EnvironmentFile=-/opt/whisperx/whisperx.env` for HF_TOKEN.

## Suggested CT defaults
`APP="WhisperX"`, `var_tags="ai;stt"`, `var_cpu=4`, `var_ram=8192`, `var_disk=20`,
`var_os="debian"`, `var_version="13"`, `var_unprivileged=1`, `var_gpu=no`, port 9000.
Notes for the website metadata: transcription works out of the box; **diarization +
embeddings are opt-in post-install** — set `HF_TOKEN` in `/opt/whisperx/whisperx.env`
and accept the four gated pyannote models (segmentation-3.0, embedding,
speaker-diarization-3.1, speaker-diarization-community-1), then restart. More
vCPU = faster CPU transcription.

## Submission steps (when resuming)
1. Fork **community-scripts/ProxmoxVED**, clone.
2. Add `ct/whisperx.sh` + `install/whisperx-install.sh` (optional headers banner).
3. Test with `dev_mode` dryrun, then a real CT build on a Proxmox host.
4. Open a PR to **ProxmoxVED** (not ProxmoxVE). Website JSON metadata is handled
   separately by the project.
