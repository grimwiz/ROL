# The Folly - Investigator Case Files

Rivers of London RPG campaign-support web app. It combines multi-user GM/player access, per-case character sheets, global and per-case NPC sheets, session summaries and entity briefs generated from source Markdown, GM-only brainstorming and handout generation, in-app rolls with Luck handling, embedded rulebook search, *The Domestic* solo adventure, AI portrait tools, and one-click export to the printed character sheet PDF.

## Requirements

- Node.js 18+
- npm
- (Optional) A reachable Ollama server if you want AI scenario regeneration and GM Chat.
- (Optional) A reachable [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server with Qwen image/image-edit models installed, if you want portrait generation/restyling or GM handout generation.

## Setup

```bash
# Install/update dependencies from package-lock.json
npm install

# (Optional) Set environment variables — see below
export JWT_SECRET="a-long-random-secret-string"
export PORT=3000
export GM_INITIAL_PASSWORD="your-secure-gm-password"

# Start
npm start

# Validate The Domestic adventure parsing/reachability
npm run check:domestic

# Optional after dependency changes
npm audit

# Regenerate a session's scenario information (same Ollama path as the web app)
npm run scenario:regenerate -- --scenario 1
```

The app will be available on `http://localhost:3000` (or your configured port).

Node does not auto-install missing packages on server start. Re-run `npm install` after pulling changes that update `package.json` or `package-lock.json`.

## First run

On first start, if no users exist, a default GM account is created:

- **Username:** `gm`
- **Password:** the value of `GM_INITIAL_PASSWORD` env var, or a generated password printed to the server log if not set

**Change this password immediately** via Admin → Accounts → Change password.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind the HTTP server to |
| `OLLAMA_URL` | LAN default | Base URL of the Ollama server used to (re)generate scenario information |
| `OLLAMA_MODEL` | `qwen3.6_36b:codex` | Ollama model used for scenario regeneration |
| `OLLAMA_NUM_CTX` | `262144` | Default context window passed to Ollama. The Admin UI can persistently choose 128K or 256K, clamped to the selected model's max context |
| `OLLAMA_TIMEOUT_MS` | `1800000` | Hard timeout for one streamed Ollama call |
| `OLLAMA_KEEP_ALIVE` | `30m` | Ollama model keep-alive sent with chat/generation calls |
| `JWT_SECRET` | *(insecure default)* | Secret for signing JWTs — **must be set in production** |
| `DB_PATH` | `./data/folly.db` | Path to the SQLite database file |
| `GM_INITIAL_PASSWORD` | *(generated)* | Password for auto-created GM account (first run only) |
| `NODE_ENV` | — | Set to `production` to enable secure cookies (requires HTTPS) |
| `TRUST_PROXY` | `1` | Express trust-proxy hops (set to your reverse-proxy depth) |
| `COMFYUI_URL` | LAN default | Base URL of a reachable ComfyUI server (portraits and GM handouts) |
| `COMFYUI_QWEN_DIFFUSION_MODEL` | `qwen_image_2512_fp8_e4m3fn.safetensors` | Text-to-image model name in ComfyUI |
| `COMFYUI_QWEN_EDIT_MODEL` | `qwen_image_edit_2511_fp8mixed.safetensors` | Image-edit/restyle model name in ComfyUI |
| `COMFYUI_QWEN_TEXT_ENCODER` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | Text encoder model name |
| `COMFYUI_QWEN_VAE` | `qwen_image_vae.safetensors` | VAE model name |
| `COMFYUI_IDLE_UNLOAD_MS` | `300000` | Idle delay before asking ComfyUI to unload models; set `0` to disable |

Ollama and ComfyUI service URLs, active Ollama model, Ollama context, and ComfyUI image/edit model choices can also be changed from **Admin → LLM**. Those overrides persist in `data/app-config.json` and take effect immediately. Without ComfyUI reachable, every non-image feature still works; image buttons will fail cleanly.

## Nginx proxy config (behind HTTPS)

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Set `NODE_ENV=production` so the session cookie gets the `Secure` flag.

## Running as a systemd service

```ini
# /etc/systemd/system/folly.service
[Unit]
Description=The Folly Case Files
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/folly-app
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=JWT_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
Environment=DB_PATH=/var/lib/folly/folly.db

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now folly
```

## Roles

- **GM (admin-level access):** Can create, rename, and delete case files, create/manage player accounts, assign players to case files, and create/edit character sheets on behalf of assigned players in those case files.
- **Player:** Can see their assigned case files, create and edit their character sheet for each case file.

Login is rate-limited (25 attempts per IP per 15 minutes; 8 per account) to slow down brute-force attempts.

## Admin (GM only)

GM-only management lives under the top-level **Admin** tab, with four sections:

- **Accounts** — create accounts, change passwords, delete accounts, and **allocate each account to any number of cases** (or none). Player↔case assignment can also still be done in-case via a case file's **+ Assign player** button; both write the same data.
- **NPCs** — create/edit/print NPC character sheets and **allocate each NPC to any number of cases** (or none), exactly the way accounts are allocated. The allocation list includes the built-in **The Domestic** as a case.
- **Case Settings** — per-case roll mode (*RoL bonus/penalty die* or *Simple* advantage/disadvantage), ruleset mode (*Rivers of London* or CoC-style SIZ/HP/Build), and portrait style instructions used by that case's character/NPC portrait tools.
- **LLM** — active Ollama model, Ollama context (128K/256K when supported by the model), Ollama/ComfyUI base URLs, and ComfyUI image/edit model selection.

NPCs and accounts are both first-class, case-independent records: an NPC or account exists on its own and is *allocated* to arbitrary cases.

## NPCs

NPCs are full character sheets stored in SQLite. They are created, edited and printed from **Admin → NPCs** (the sheet's own Name field is authoritative). Allocation to cases works both ways: per-NPC via Admin → NPCs → **Cases…** (this list includes **The Domestic**), or per-case from a case file's **NPCs** subtab via **Assign NPCs…** (tick which NPCs are in this case). Allocating an NPC creates a per-case working copy of that NPC's sheet; the case detail view lets the GM edit that case copy, save it locally, and optionally **Write back to central NPC** when the per-case version should become the global sheet. Whenever a case's NPC set changes, its `NPC.md` is regenerated for GM/LLM context.

### NPC character sheets (from the rulebook)

Named NPCs from the *Rivers of London* rulebook (the Rogues' Gallery and bundled case Cast — Nightingale, Peter Grant, Beverley Brook, Molly, the Domestic cast, etc.) ship as full character sheets. In **Admin → NPCs**, **Edit** opens the **same** character-sheet editor and **Export PDF** mechanism players use, so a GM can read, tweak, and print an NPC sheet exactly like a player one. RoL fields with no native box (Damage Bonus, Languages, Powers/Signare/Demi-monde affinity/Vestigia, Wizard's Staff) are preserved in the sheet's Custom Fields, so the import is lossless.

The data lives as one JSON file per NPC in `Rivers_of_London/globaldata/npcs/`, and is **auto-seeded into the database on server start if missing** — the same gap-filling strategy used for the global Markdown files (it never overwrites a GM's in-app edits). The round-trip is:

```bash
npm run npcs:extract   # parse the rulebook → Rivers_of_London/globaldata/npcs/*.json (best effort)
npm run npcs:seed      # seed any missing NPCs into the DB without a restart (also runs at startup)
npm run npcs:export    # write the DB's NPC sheets back to globaldata/npcs/*.json
```

So if a parsed sheet has an error, fix it in the web app, run `npm run npcs:export`, and the corrected JSON becomes the canonical seed copy.

## Session scenario information

Each case file detail view splits scenario knowledge into **Overview**, **Characters**, **Case Info**, **Player Info**, **NPC/Places/Things**, **NPCs**, **Rolls**, and GM-only **GM Info**, **Edit Files**, **Raw Data**, and **GM Chat** subtabs:

- **Overview** — GM-only at-a-glance session board for player characters and allocated NPCs: conditions, resources, notable skills, weapons, and play notes.
- **Characters** — per-player editable character sheets. Players only see their own sheet; the GM can edit all assigned player sheets.
- **Case Info** — the "what has happened so far" analysis and per-session analysis. The model returns structured Markdown (headings, bold, bulleted beats) rendered with a clickable index. Session summaries can choose the most useful `presentation`: *scene* for chronological shared-table play, *player* for fragmented character-specific/WhatsApp threads, or *location* for place-by-place recall. Outstanding leads, in-flight actions, and open questions are woven into the prose rather than listed separately, because an explicit to-investigate checklist is itself a spoiler.
- **Handouts** — player-only read view of player-visible source Markdown, graphics, and PDFs from the case files. It uses the same visibility filtering as scenario generation and has no edit/delete controls.
- **Player Info** — per-character story. A player sees only their own character's story. A GM gets a player selector mirroring the Characters tab and can preview exactly what each player sees (filtered server-side via `?as_user=`).
- **NPC/Places/Things** — player-visible Places, NPCs, and notable Things (objects/artefacts/evidence). These entries are entity-centric: each NPC/place/item is written from the point of view of that subject, not as another per-player report.
- **NPCs** — allocated NPC sheets for this case, using per-case working copies as described above.
- **GM Info** — GM-only `gm-analysis.json` categories.
- **Edit Files** — GM editing of the session source markdown and asset visibility. Files created/uploaded here land GM-only by default; image/PDF assets can be toggled between GM-only and player-visible handouts.
- **Raw Data** — GM-only inspection of the generated scenario JSON.
- **Rolls** — the GM assigns a roll to a player (skill/label, optional target %, difficulty Regular/Hard/Extreme, modifier none/advantage/disadvantage, optional comment). The player resolves it in-app: the server rolls, applies the per-case advantage handling, and reports the success level and whether it meets the assigned difficulty. Target % auto-fills from the player's sheet when the label matches a skill/characteristic. Resolution is two-step: **Roll** previews the dice, then the player optionally **spends Luck** before **Confirm**. Luck is a session-scoped ledger — the sheet's base Luck is never mutated; effective Luck = base − unrestored Luck spent this session. RoL caps apply (can't spend out of a fumble, can't reach a Critical, capped at effective Luck). The GM sees a per-character Luck table (base / spent / effective) and **Restore Luck** clears a loss (e.g. between sessions). "Luck (eff)" also shows in the Session Overview. The GM panel also tracks per-session **wounds** (the four RoL conditions — Hurt/Bloodied/Down/Impaired — as toggles) and **manual temporary Luck adjustments** (a ± with a note, clearable), neither of which mutates the permanent sheet; active wounds show in the Session Overview "Condition" column. Rolls are mirrored to a GM-only `GM/rolls.md` ledger (incl. comments, Luck and a Conditions/Luck block) and resolved outcomes + current conditions to a shared `rolls.md` (player + LLM visible).
- **GM Chat** — GM-only streaming brainstorming chat grounded in this case's full GM material (sources + current player/GM artifacts). Never shown to players; conversation is ephemeral (in-memory, cleared on reload). It supports text brainstorming and ComfyUI image handouts; generated images can be saved into the case's GM-only gallery and then shared via Edit Files. Reuses the streamed Ollama path with a server-side Stop button; the active Ollama call is cancelable from `/api/llm/cancel` even if the browser tab has been refreshed. `Ctrl/Cmd+Enter` sends. The large case-context system prompt is frozen for the life of a conversation so the prompt prefix is byte-stable — Ollama reuses its KV cache and only the first turn pays the full context cost; later turns are fast. **Clear** starts a new conversation and rebuilds the context (picking up edited files / regenerated artifacts). Note: a section regeneration or other large model call between turns can evict Ollama's cache, making the next chat turn slow once while it reprocesses the context.

Advantage/disadvantage handling is a per-case setting under **Admin → Case Settings**: *RoL bonus/penalty die* (roll the tens die twice, keep the better/worse tens) or *Simple* (roll two d100s, take best/worst).

It reads static generated artifacts from that session's folder:

```text
data/sessions/<session-name-slug>/output_player/scenario-info.json
data/sessions/<session-name-slug>/output_gm/gm-analysis.json
```

The GM can edit all session markdown files in the session UI. The source layout is:

```text
data/sessions/<session-name-slug>/*.md          # session-local copies seeded from Rivers_of_London/globaldata
data/sessions/<session-name-slug>/input/*.md    # player-visible scenario material
data/sessions/<session-name-slug>/GM/*.md       # GM-only private material
data/sessions/<session-name-slug>/player_sections.json
data/sessions/<session-name-slug>/gm_sections.json
```

Root markdown and `input/` files support player-facing analysis. `GM/` files support private planning, pacing, per-player deliverables, fairness/engagement tracking, and quiet-player prompts. The global seed files are copied into the session folder when missing or empty, so a GM can empty a local seeded file to restore it from `Rivers_of_London/globaldata`. Players can read the rulebook directly in-app, so no game-overview file is seeded into sessions or fed to the model.

### Built-in Bookshop case

**The Bookshop** is a built-in sandbox case that appears beside GM-created cases and opens in the normal case UI. Its canonical source lives under `Rivers_of_London/canonical/cases/bookshop/`; on server start the app creates or refreshes the normal session row marked with `system_key = bookshop`, copies any missing seeded files into `data/sessions/the-bookshop/`, and allocates the case cast from JSON NPC sheets.

GMs can edit the live copy, move assets between GM/player visibility, regenerate scenario information, and use GM Chat against the case. The case card exposes **Reset**, which restores the seeded files and canonical per-case NPC sheets from the archive without changing the canonical source. Built-in cases cannot be renamed or deleted from the case list.

### One generation path

There is exactly one way scenario information is produced: the server sends each section's prompt to an Ollama model (`OLLAMA_URL` / `OLLAMA_MODEL`, or the Admin overrides) and writes the returned JSON back to `scenario-info.json` / `gm-analysis.json`. Prompts embed the allowed Markdown source contents, use the live database roster to map players to character names, treat **Stu Bentley** as the GM, and separate player-visible material from GM-only material. Player access is filtered by `known_by` character names; GM-only analysis is only returned to GM users.

Most sections include the current generated artifact so the model can reconcile rather than churn stable content. The looped sections that must not eat their own tail — per-session summaries and per-player character reports — are generated one item at a time from the root/source `.md` files instead of from previous summaries. Session summaries are assembled by transcript file (`input/session-01.md`, `input/session-02.md`, etc.); player character reports are assembled from assigned players' real sheet names and fail before calling Ollama if those prerequisite names are missing. The previous "write a Claude/Codex prompt file to run by hand" path has been removed.

A GM triggers regeneration from the web app:

- **Regenerate** / **Revert** on any individual section card.
- **Regenerate Page** in a subtab header — regenerates just the sections that page shows.
- **Bulk Regenerate** on the **Edit Files** page — regenerates every section.

Generation streams progress to the browser, including per-step timing/metrics and the requested context size. The global AI notification reports current work and exposes Ollama model/GPU/VRAM details on hover when `ollama ps` has data. The Stop button calls a server-side cancel endpoint, so an active Ollama request can still be stopped after switching tabs or refreshing the page.

Generated Markdown also gets a deterministic non-LLM post-pass. It refreshes the stored source-file inventory, rebuilds browser page indexes on reload, and inserts matching scenario images into Markdown. Auto-inserted images are rebuilt at only the first matching title in a content block; that first title may receive multiple images, but later headings are left alone. GM pages expose **Regenerate Index** beside the AI regenerate controls to rerun this post-pass without calling Ollama.

Codex/Claude is not available on the application server, so the equivalent manual run is a script that triggers the **same** server actions (no separate code path):

```bash
npm run scenario:regenerate -- --scenario 1                                  # all sections
npm run scenario:regenerate -- --scenario 1 --artifact player                # only player sections
npm run scenario:regenerate -- --scenario 1 --sections player.entities.npcs  # named sections
```

Session data folders are named from the current session name. When a GM renames a session, the folder is renamed to match.

## Character sheet coverage

The sheet is organised into seven numbered sections: **1 · Personal Info & Backstory**, **2 · Characteristics**, **3 · Edges & Flaws**, **4 · Skills & Specialties**, **5 · Magic**, **6 · Combat, Damage & Gear**, and **7 · Custom Fields**.

### 1 · Personal Info & Backstory

- Identity fields: name, pronouns, place of birth, residence, age, **social class**, **affluence**, and a free-text **occupation / role** (no longer locked to a preset list, so players can write bespoke roles like "Stage Magician / Physicist").
- Three narrative fields: the **"Glitch"** (the anomalous event that drew them into the strange), **backstory**, and a short **reputation** line.
- **Portrait** — upload (JPG/PNG/GIF/WebP), capture from webcam, or **generate** an AI portrait derived from the rest of the sheet (see below). Portraits are stored at 672 × 768 (7:8) to match the printed PDF box.

### 2 · Characteristics

- In the default **Rivers of London** ruleset, base stats are **STR, CON, DEX, INT, POW**. The optional **CoC-style** ruleset (per case, under Admin → Case Settings) also shows **SIZ**.
- Each visible stat is a dropdown from 10 to 90 in 5-point steps, with a running total shown underneath.
- Derived stats display in a dedicated sub-grid:
  - **SAN** = POW
  - **MP** = round(POW / 5)
  - **HP** and **Build** only appear in CoC-style mode; HP = round((CON + SIZ) / 10), and Build is bucketed from STR + SIZ (≤64 → -2, ≤84 → -1, ≤124 → 0, ≤164 → +1, ≤204 → +2, else +3)
- Each derived stat has an **Auto / Manual toggle** — by default they follow the formulas and update live as base stats change, but a GM or player can flip a field to Manual to enter a custom value without losing the auto-calculation for the others.
- **Move** and **Luck** sit in the same derived grid; Move is free text (for pace descriptors or numeric values) and Luck can be entered manually or auto-rolled as RoL starting Luck (`2D10+50`).

### 3 · Edges & Flaws

- **Advantages** are shown in a text line with a collapsible picker underneath. Advantages with stat prerequisites (e.g. *Magical* requires INT 60 & POW 60) are disabled and struck through in the picker until the base stats qualify. Custom entries typed into the text box are preserved.
- **Flaws** (stored as `disadvantages` in JSON for legacy reasons) is a single free-text line for short flaw descriptors.
- Affluence (in section 1) is auto-derived from this section when not set explicitly: presence of *Rich*, *Wealthy*, or *Poor* in advantages/disadvantages surfaces that label, otherwise it defaults to *Average*.

### 4 · Skills & Specialties

- **Common skills** is a fixed set of nine: Athletics, Drive, Navigate, Observation, Read Person, Research, Sense Vestigia, Social, Stealth. Each value is a dropdown from 20% to 80% in 5-point steps, defaulting to 30%.
- **Expert skills** and **additional skills** are player-defined rows with inline remove (✕) buttons and free-text percent values.
- Choosing the **Magical** advantage automatically adds *Magic* at 60% to the common-skills set. It also bumps *Sense Vestigia* from its base 30 → 60 — but only when the value is still at 30, so any manual override the player has set is preserved. Clearing Magical removes the *Magic* row.

### 5 · Magic

Visible only when the player has the *Magical* advantage, the *Magic* skill, or any data already entered. Captures:

- **Tradition / practice** — free text (e.g. "Newtonian Practitioner").
- **Spells & techniques** — a list where each row has a name, an "order & mastery" field, and a notes field, with add/remove controls.
- **Magic notes** — longer-form textarea for practice-wide notes.

### 6 · Combat, Damage & Gear

- **Combat skills** — Fighting and Firearms, with full/half columns (half auto-calculates from full).
- **Damage status** — four toggleable boxes: Hurt, Bloodied, Down, Impaired.
- **Weapons** — table of name, full, half, damage, range; rows can be added.
- **Everyday Carry** — textarea for the rest of what the character routinely has on them.

### 7 · Custom Fields

Player-defined key/value pairs that don't fit the canonical sheet — handy for one-off campaign-specific notes.

### GM session view

A case file's first subtab (GM only), **Overview**, is the at-a-glance session board: one card for **Player Characters** and a second, identically-formatted card for the **NPCs** allocated to this case (condition, resources, notable skills, weapons, play notes per row). The **Characters** subtab (now to the right of Overview) holds the per-player sheet tabs and the full editable sheet.

## Portrait generation and restyling (Qwen via ComfyUI)

The sheet portrait controls can upload, capture from webcam, generate a new random portrait, or restyle the current image with **Style this picture**. Random portraits build a prompt from the character's occupation, age, social class, reputation, advantages, top stats, top skills, weapons, and magic tradition, then dispatch it to the configured ComfyUI server using the selected Qwen image model. Restyling uses the selected Qwen image-edit model and the case's portrait-style instructions, preserving identity while changing the art treatment. The browser polls a small set of authenticated proxy endpoints (`/api/portrait/random`, `/api/portrait/restyle`, `/api/portrait/history/:id`, `/api/portrait/view`) so the LAN-only ComfyUI server never has to be exposed.

The original uploaded portrait (if any) is held in browser memory while a generation is in flight, so the player can revert if they don't like the result.

For extraction/admin work, the same image-edit workflow can be run from the command line and written straight back to the app's sheet data:

```bash
npm run portrait:restyle -- --sessions
npm run portrait:restyle -- --characters --session Global
npm run portrait:restyle -- --characters --session "The Bookshop"
npm run portrait:restyle -- --session Global --character "Molly" --image path/to/source.png
npm run portrait:restyle -- --session "The Bookshop" --character "Warwick Anderson" --image path/to/source.png
```

The list commands print the available cases and the character selectors inside a case. `--session Global` (or `--session 0`) targets the central NPC pool instead of a case allocation. The restyle command resolves the named character, restyles the supplied image with the relevant portrait style, and writes the generated portrait into the sheet so it is immediately visible in the web app for review. Use `--output path/to/generated.png` if you also want a loose file copy of the generated image.

## PDF export

A **Print / Export PDF** button on every sheet sends the in-memory sheet data to `POST /api/sheet/render-pdf`, which overlays it onto the official Chaosium *Rivers of London* blank character sheet (`Rivers_of_London/RoL_Charsheet.pdf`) using `pdf-lib` and streams back a download. The same renderer is exposed as a CLI for batch exports — see *Utility scripts* below.

The browser and CLI go through the same `buildPdf()` function, so what you get from the CLI is exactly what the website hands you.

## Dice rolling

`POST /api/dice/rolls` accepts a small allowlist of formulas (`1d100`, `2d10+50`, `1d20`, `1d12`, `1d10`, `1d8`, `1d6`, `1d4`) and logs the result so a GM can audit rolls after the fact.

## Rules

- The **Rules** tab embeds the bundled HTML *Rivers of London* rulebook in-app; use browser find (Ctrl/Cmd + F) for text search.
- `GET /api/rules/search?q=…` does a server-side full-text search over the rulebook and returns up to 25 results with surrounding-context snippets.

## Front-end scripts

- `public/js/api.js`: Centralised browser API client used by UI actions (`auth`, users, sessions, sheets, scenario info/sources, rolls, NPCs, LLM/service settings, ComfyUI settings, handouts, portrait, dice, adventure, and rules endpoints).
- `public/js/app.js`: Main SPA logic (auth flow, case file/account/rules/admin tabs, case file rename modal, player and NPC allocation, GM/player sheet interactions, GM session overview table, session-scoped scenario info, safe Markdown rendering via `markdown-it`, server-side AI start/stop status, GM Chat and handouts, Edit Files asset handling, embedded HTML rulebook viewer, the Export-PDF button, and The Domestic solo adventure presented as a built-in case file with URL step routing and local sheet persistence).
- `public/js/sheet.js`: Character sheet renderer/collector used by both player and GM editing views — includes backstory support, portrait upload/camera/generation/restyling behaviour, per-case portrait AI enablement, occupation free-text, RoL vs CoC-style ruleset display, characteristic dropdowns with stat-total messaging, the advantages textbox + collapsible preset picker with stat-prereq disabling, common-skill dropdowns with the Sense-Vestigia / Magic auto-adjustments described above, expert/additional skill controls, custom-field controls, and the magic-section visibility toggle.

## Utility scripts

- `npm run check:domestic` (`scripts/check-domestic-adventure.js`): Parses `Rivers_of_London/The Domestic.md`, verifies exactly 111 steps are present, and confirms all steps are reachable from the start via parsed links.
- `npm run scenario:regenerate -- --scenario <id-or-name> [--artifact player|gm] [--sections id,id]` (`scripts/regenerate-scenario-info.js`): Runs the single Ollama-backed regeneration path — the same server action the web app's Regenerate / Regenerate Page / Bulk Regenerate buttons trigger — and writes `scenario-info.json` / `gm-analysis.json` in place, rewriting only sections with material changes.
- `npm run npcs:extract` (`scripts/extract-rulebook-npcs.js`): Parses the bundled rulebook Markdown and writes one NPC character-sheet JSON per named NPC to `Rivers_of_London/globaldata/npcs/`.
- `npm run npcs:seed` (`scripts/seed-npcs.js`): Inserts any missing global NPC sheets from `globaldata/npcs/` into the DB. The server also does this automatically at startup.
- `npm run npcs:export` (`scripts/export-rulebook-npcs.js`): Writes the DB's current global NPC sheets back to `globaldata/npcs/*.json` so in-app corrections become the canonical seed copy.
- `node scripts/export-character-sheet.js …`: Render a character sheet to PDF from the CLI by overlaying it on `Rivers_of_London/RoL_Charsheet.pdf`. Usage:

  ```bash
  # List sessions / sheets in the DB
  node scripts/export-character-sheet.js --list

  # Render one sheet from the DB
  node scripts/export-character-sheet.js --session 1 --user andrew -o andrew.pdf

  # Render straight from a JSON file (skip the DB)
  node scripts/export-character-sheet.js --from-json fixture.json -o out.pdf

  # Dump the raw sheet JSON instead of rendering
  node scripts/export-character-sheet.js --session 1 --user andrew --json --pretty
  ```

  This is the same renderer the web `Export PDF` button uses.

- `npm run compare:sheets` (`scripts/compare-character-sheet-dbs.py`): Read-only Python utility that diffs two `folly.db` files field-by-field, useful for spotting what changed between a backup and the live DB.

## Rulebook files

- Keep the full supplied rulebook files in the gitignored `private/rulebook-source/` folder with matching base names. That folder is never served by the web app:
  - `cha3200_-_rivers_of_london_1.4.md`
  - `cha3200_-_rivers_of_london_1.4.html`
  - `cha3200_-_rivers_of_london_1.4_artifacts/` (image references used by the HTML/Markdown)
- The free *The Domestic* files live in `Rivers_of_London/`:
  - `The Domestic.md`
  - `CHA3201 - The Domestic.pdf`
  - `image-blacklist.txt`
- The blank character sheet used for PDF export lives in `Rivers_of_London/RoL_Charsheet.pdf`.
- The compact paraphrased rules corpus lives in `Rivers_of_London/rules/`.
- The server exposes only `Rivers_of_London/` at `/rules-files/*`; it must never serve `private/`.
- Authenticated API endpoints:
  - `GET /api/rules` (returns direct HTML/Markdown file URLs)
  - `GET /api/rules/search?q=…` (server-side full-text search)
  - `GET /api/adventure/domestic` (returns parsed *The Domestic* steps with forward actions and traceback links)

## The Domestic solo adventure in-app

- **The Domestic** is a built-in solo case file: open it from its card on the **Case File** page (it always appears first, even with no GM-created cases). It is a special case file — instead of the GM/player scenario subtabs it shows the step-by-step solo adventure.
- The canonical URL is `?session=domestic` (the legacy `?tab=domestic` still works); the current step is written to `?adventureStep=<n>` so players can bookmark/share their progress point. Step progress is also persisted server-side per user.
- Forward links are rendered as primary action buttons from the step text's `go to` instructions.
- Traceback links are rendered as subtle back buttons from the step's parenthesised trace references.
- A local character sheet is embedded under each step and autosaved per logged-in user.

## Hiding print-only decorations (image blacklist)

The Domestic adventure text was extracted from the original printed rulebook PDF. That process produced a markdown file plus a folder of nearly a thousand loose images — every illustration, character portrait, and piece of page chrome the PDF contained, dumped as separate PNGs. On paper, the "page chrome" is useful: each step of the adventure is decorated with a little numbered police-badge graphic, and some pages have decorative scroll-work flourishes in the margins. On the web those decorations add nothing — the step number is already the heading, and the flourishes are just paper-era ornaments — so they need to be hidden without disturbing the real illustrations we want to keep.

To do this we keep a plain-text list of filenames to ignore at `Rivers_of_London/image-blacklist.txt`. The adventure parser (`src/domesticAdventure.js`) reads that list and strips any matching image references before sending the step text to the browser. Any image not on the list is rendered inline as a normal `<img>` in the step.

The tricky part was deciding *which* of the ~973 extracted images belonged on the list without looking at every single one by hand. We solved it with a technique called **perceptual hashing**. Here's the idea in plain terms: a regular file hash (like MD5) changes completely if a single pixel is different, which makes it useless for "find me things that look the same." A perceptual hash instead produces a short fingerprint that is derived from the broad visual shape of the picture — dark and light regions, rough contours — so two pictures that look alike to a human get fingerprints that are nearly identical, even if their pixel data differs slightly. We can then measure how different two pictures are by counting how many bits of their fingerprints disagree; small numbers mean "visually very similar," large numbers mean "completely different pictures."

We picked one confirmed badge graphic and one confirmed flourish as reference examples, fingerprinted all 973 extracted images, and kept the ones whose fingerprints were close enough to either reference. To avoid a false positive where a real illustration happens to share a fingerprint (unlikely but not impossible), we also required the candidate to match the reference in rough pixel dimensions and file size — a character portrait is nowhere near the size or shape of a 94×106-pixel badge, so the guard rules it out even if the fingerprint is a near match. That combined check surfaced 212 badge graphics and 64 flourishes, which were appended to the blacklist under commented section headers. Once the server restarts, the adventure renders clean: 111 steps, genuine illustrations still inline, page-chrome gone.

If more decorations turn up later, adding them is manual — just drop the filename (or the full relative path) on a new line in `image-blacklist.txt`.

## Data

SQLite database stored at `DB_PATH`. Back it up by copying the `.db` file. The schema covers users, sessions, the session ↔ player join table, character sheets (one JSON blob per (session, user) pair), NPCs (including an optional full character-sheet JSON in the central `npcs.sheet` column), NPC↔case allocation and per-case NPC working sheets (`npc_sessions`), per-case settings (`session_settings`), GM-assigned/self-service rolls (`session_rolls`), per-session wound state and temporary stat adjustments, and per-user *Domestic* progress.

Global app-level AI/service overrides live outside SQLite in `data/app-config.json` (Ollama model/context/base URL, ComfyUI URL, and ComfyUI image/edit model choices). Case source files and generated artifacts live under `data/sessions/<session-name-slug>/`.
