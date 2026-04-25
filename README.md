# The Folly – Investigator Case Files

Rivers of London RPG character sheet management web app. Multi-user, GM/Player roles, embedded rulebook + solo adventure, AI portrait generation, and one-click export to the printed character sheet PDF.

## Requirements

- Node.js 18+
- npm
- (Optional) A reachable [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server with the Qwen image model installed, if you want the "Generate portrait" button to work.

## Setup

```bash
# Install dependencies
npm install

# (Optional) Set environment variables — see below
export JWT_SECRET="a-long-random-secret-string"
export PORT=3000
export GM_INITIAL_PASSWORD="your-secure-gm-password"

# Start
npm start

# Validate The Domestic adventure parsing/reachability
npm run check:domestic
```

The app will be available on `http://localhost:3000` (or your configured port).

## First run

On first start, if no users exist, a default GM account is created:

- **Username:** `gm`
- **Password:** the value of `GM_INITIAL_PASSWORD` env var, or `changeme123` if not set

**Change this password immediately** via Accounts → Change password.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `JWT_SECRET` | *(insecure default)* | Secret for signing JWTs — **must be set in production** |
| `DB_PATH` | `./data/folly.db` | Path to the SQLite database file |
| `GM_INITIAL_PASSWORD` | `changeme123` | Password for auto-created GM account (first run only) |
| `NODE_ENV` | — | Set to `production` to enable secure cookies (requires HTTPS) |
| `TRUST_PROXY` | `1` | Express trust-proxy hops (set to your reverse-proxy depth) |
| `COMFYUI_URL` | LAN default | Base URL of a reachable ComfyUI server (portrait generation) |
| `COMFYUI_QWEN_DIFFUSION_MODEL` | `qwen_image_2512_fp8_e4m3fn.safetensors` | Diffusion model name in ComfyUI |
| `COMFYUI_QWEN_TEXT_ENCODER` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | Text encoder model name |
| `COMFYUI_QWEN_VAE` | `qwen_image_vae.safetensors` | VAE model name |

The ComfyUI vars only matter if the "Generate portrait" button is going to be used. Without ComfyUI reachable, every other feature still works; the button will just fail.

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

- **GM (admin-level access):** Can create, rename, and delete sessions, create/manage player accounts, assign players to sessions, and create/edit character sheets on behalf of assigned players in those sessions.
- **Player:** Can see their assigned sessions, create and edit their character sheet for each session.

Login is rate-limited (25 attempts per IP per 15 minutes; 8 per account) to slow down brute-force attempts.

## Character sheet coverage

The sheet is organised into seven numbered sections: **1 · Personal Info & Backstory**, **2 · Characteristics**, **3 · Edges & Flaws**, **4 · Skills & Specialties**, **5 · Magic**, **6 · Combat, Damage & Gear**, and **7 · Custom Fields**.

### 1 · Personal Info & Backstory

- Identity fields: name, pronouns, place of birth, residence, age, **social class**, **affluence**, and a free-text **occupation / role** (no longer locked to a preset list, so players can write bespoke roles like "Stage Magician / Physicist").
- Three narrative fields: the **"Glitch"** (the anomalous event that drew them into the strange), **backstory**, and a short **reputation** line.
- **Portrait** — upload (JPG/PNG/GIF/WebP), capture from webcam, or **generate** an AI portrait derived from the rest of the sheet (see below). Portraits are stored at 672 × 768 (7:8) to match the printed PDF box.

### 2 · Characteristics

- Six base stats: **STR, CON, DEX, INT, POW, SIZ**. Each is a dropdown from 10 to 90 in 5-point steps, with a running total shown underneath.
- Four **derived stats** auto-calculate from the base stats and are displayed in a dedicated sub-grid:
  - **HP** = round((CON + SIZ) / 10)
  - **SAN** = POW
  - **MP** = round(POW / 5)
  - **Build** is bucketed from STR + SIZ (≤64 → -2, ≤84 → -1, ≤124 → 0, ≤164 → +1, ≤204 → +2, else +3)
- Each derived stat has an **Auto / Manual toggle** — by default they follow the formulas and update live as base stats change, but a GM or player can flip a field to Manual to enter a custom value (e.g. temporary injury, narrative override) without losing the auto-calculation for the others.
- **Move** and **Luck** sit in the same derived grid; Move is free text (for pace descriptors or numeric values) and Luck is a 1–100 number.

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

Consolidated table showing every assigned player's character identity, all six base stats plus derived HP/SAN/MP/Build, Move/Luck, advantages, skills, and essential items — readable at a glance during play.

## Portrait generation (Qwen via ComfyUI)

The "Generate portrait" button on the sheet builds a prompt from the character's occupation, age, social class, reputation, advantages, top stats, top skills, weapons, and magic tradition, and dispatches it to the configured ComfyUI server using the Qwen image model. The browser polls a small set of authenticated proxy endpoints (`/api/portrait/random`, `/api/portrait/history/:id`, `/api/portrait/view`) so the LAN-only ComfyUI server never has to be exposed.

The original uploaded portrait (if any) is held in browser memory while a generation is in flight, so the player can revert if they don't like the result.

## PDF export

A **Print / Export PDF** button on every sheet sends the in-memory sheet data to `POST /api/sheet/render-pdf`, which overlays it onto the official Chaosium *Rivers of London* blank character sheet (`Rivers_of_London/RoL_Charsheet.pdf`) using `pdf-lib` and streams back a download. The same renderer is exposed as a CLI for batch exports — see *Utility scripts* below.

The browser and CLI go through the same `buildPdf()` function, so what you get from the CLI is exactly what the website hands you.

## Dice rolling

`POST /api/dice/rolls` accepts a small allowlist of formulas (`1d100`, `2d10+50`, `d20`, `d12`, `d10`, `d8`, `d6`, `d4`) and logs the result so a GM can audit rolls after the fact.

## Rules

- The **Rules** tab embeds the bundled HTML *Rivers of London* rulebook in-app; use browser find (Ctrl/Cmd + F) for text search.
- `GET /api/rules/search?q=…` does a server-side full-text search over the rulebook and returns up to 25 results with surrounding-context snippets.

## Front-end scripts

- `public/js/api.js`: Centralised browser API client used by UI actions (`auth`, `users`, `sessions`, sheets, portrait, dice, adventure, and rules endpoints).
- `public/js/app.js`: Main SPA logic (auth flow, session/account/rules tabs, session rename modal, player assignment, GM/player sheet interactions, GM session overview table, embedded HTML rulebook viewer, the Export-PDF button, and The Domestic top-nav solo adventure tab with URL step routing and local sheet persistence).
- `public/js/sheet.js`: Character sheet renderer/collector used by both player and GM editing views — includes backstory support, portrait upload/camera/generation behaviour, occupation free-text, characteristic dropdowns with stat-total messaging, the advantages textbox + collapsible preset picker with stat-prereq disabling, common-skill dropdowns with the Sense-Vestigia / Magic auto-adjustments described above, expert/additional skill controls, custom-field controls, and the magic-section visibility toggle.

## Utility scripts

- `npm run check:domestic` (`scripts/check-domestic-adventure.js`): Parses `Rivers_of_London/The Domestic.md`, verifies exactly 111 steps are present, and confirms all steps are reachable from the start via parsed links.
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

- Place the supplied rulebook files in `Rivers_of_London/` with matching base names:
  - `cha3200_-_rivers_of_london_1.4.md`
  - `cha3200_-_rivers_of_london_1.4.html`
  - `cha3200_-_rivers_of_london_1.4_artifacts/` (image references used by the HTML/Markdown)
  - `RoL_Charsheet.pdf` (blank Chaosium sheet, used as the PDF-export template)
- The server exposes the rulebook at `/rules-files/*`.
- Authenticated API endpoints:
  - `GET /api/rules` (returns direct HTML/Markdown file URLs)
  - `GET /api/rules/search?q=…` (server-side full-text search)
  - `GET /api/adventure/domestic` (returns parsed *The Domestic* steps with forward actions and traceback links)

## The Domestic solo adventure in-app

- Open **The Domestic** from the top navigation to use the step-by-step solo adventure inside The Folly app.
- The current step is written to `?adventureStep=<n>` in the URL so players can bookmark/share their progress point. Step progress is also persisted server-side per user.
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

SQLite database stored at `DB_PATH`. Back it up by copying the `.db` file. The schema covers users, sessions, the session ↔ player join table, character sheets (one JSON blob per (session, user) pair), and per-user *Domestic* progress.
