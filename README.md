# The Folly – Investigator Case Files

Rivers of London RPG character sheet management web app.

## Requirements

- Node.js 18+
- npm

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

- **GM (admin-level access)**: Can create, rename, and delete sessions, create/manage player accounts, assign players to sessions, and create/edit character sheets on behalf of assigned players in those sessions.
- **Player**: Can see their assigned sessions, create and edit their character sheet for each session.

## Character sheet coverage

The sheet is organised into seven numbered sections: **1 · Personal Info & Backstory**, **2 · Characteristics**, **3 · Edges & Flaws**, **4 · Skills & Specialties**, **5 · Magic**, **6 · The Vitals**, and **7 · Custom Fields**.

### Personal info & backstory

- Identity fields: name, pronouns, place of birth, residence, age, **social class**, and a free-text **occupation / role** (no longer locked to a preset list, so players can write bespoke roles like "Stage Magician / Physicist").
- Three narrative fields follow: the **"Glitch"** (the anomalous event that drew them into the strange), **backstory**, and a short **reputation** line.
- **Portrait upload** (JPG/PNG/GIF/WebP) is shown alongside the personal info and stored with the sheet data.

### Characteristics

- Six base stats: **STR, CON, DEX, INT, POW, SIZ**. Each is a dropdown from 10 to 90 in 5-point steps, with a running total shown underneath.
- Four **derived stats** auto-calculate from the base stats and are displayed in a dedicated sub-grid:
  - **HP** = round((CON + SIZ) / 10)
  - **SAN** = POW
  - **MP** = round(POW / 5)
  - **Build** is bucketed from STR + SIZ (≤64 → -2, ≤84 → -1, ≤124 → 0, ≤164 → +1, ≤204 → +2, else +3)
- Each derived stat has an **Auto / Manual toggle** — by default they follow the formulas and update live as base stats change, but a GM or player can flip a field to Manual to enter a custom value (e.g. temporary injury, narrative override) without losing the auto-calculation for the others.
- **Move** and **Luck** sit in the same grid as the derived stats; Move is free text (for pace descriptors or numeric values) and Luck is a 1–100 number.

### Edges & flaws

- **Advantages** are shown in a text line with a collapsible picker underneath. Advantages with stat prerequisites (e.g. *Magical* requires INT 60 & POW 60) are disabled and struck through in the picker until the base stats qualify. Custom entries typed into the text box are preserved.
- **Flaws** (previously "Disadvantages") is a single free-text line for short flaw descriptors.

### Skills & specialties

- **Common skills** is a fixed set of nine: Athletics, Drive, Navigate, Observation, Read Person, Research, Sense Vestigia, Social, Stealth. Each value is a dropdown from 20% to 80% in 5-point steps, defaulting to 30%.
- **Expert skills** and **additional skills** are player-defined rows with inline remove (✕) buttons and free-text percent values.
- Choosing the **Magical** advantage automatically adds *Magic* at 60% to the common-skills set and pins *Sense Vestigia* at 60%; clearing Magical removes the *Magic* row.

### Magic

A dedicated section capturing:

- **Tradition / practice** — free text (e.g. "Newtonian Practitioner").
- **Spells & techniques** — a list where each row has a name, an "order & mastery" field, and a notes field, with add/remove controls.
- **Magic notes** — longer-form textarea for practice-wide notes.

### The vitals & custom fields

- **The Vitals** now holds just the **Everyday Carry** textarea (movement and luck have moved up into the Characteristics derived grid).
- **Custom fields** lets players add arbitrary key/value pairs that don't fit the canonical sheet.

### GM session view

- Consolidated table showing every assigned player's character identity, all six base stats plus derived HP/SAN/MP/Build, Move/Luck, advantages, skills, and essential items — readable at a glance during play.

### Rules

- The **Rules** tab embeds the bundled HTML Rivers of London rulebook in-app; use browser find (Ctrl/Cmd + F) for text search.

## Front-end scripts

- `public/js/api.js`: Centralized browser API client used by UI actions (`auth`, `users`, `sessions`, and character sheet endpoints).
- `public/js/app.js`: Main SPA logic (auth flow, session/account/rules tabs, session rename modal, player assignment, GM/player sheet interactions, GM session overview table, embedded HTML rulebook viewer, and The Domestic top-nav solo adventure tab with URL step routing and local sheet persistence).
- `public/js/sheet.js`: Character sheet renderer/collector used by both player and GM editing views, including backstory support, portrait upload/clear behavior, profession dropdown options, characteristic allocation dropdowns (30–80) with 280-point validation messaging, a dedicated advantages textbox + collapsible preset picker with stat-based prerequisite disabling/strikethrough, common skills with 30–60 dropdown defaults and Magical auto-adjustments, expert skill editing controls, and add controls for additional skills/custom fields.

## Utility scripts

- `scripts/check-domestic-adventure.js`: Parses `Rivers_of_London/The Domestic.md`, verifies exactly 111 steps are present, and confirms all steps are reachable from the start via parsed links.

## Rulebook files

- Place the supplied rulebook files in `Rivers_of_London/` with matching base names:
  - `cha3200_-_rivers_of_london_1.4.md`
  - `cha3200_-_rivers_of_london_1.4.html`
  - `cha3200_-_rivers_of_london_1.4_artifacts/` (image references used by the HTML/Markdown)
- The server exposes these files at `/rules-files/*`.
- API endpoints for authenticated users:
  - `GET /api/rules` (returns direct HTML/Markdown file URLs)
  - `GET /api/adventure/domestic` (returns parsed The Domestic steps with forward actions and traceback links)

## The Domestic solo adventure in-app

- Open **The Domestic** from the top navigation to use the step-by-step solo adventure inside The Folly app.
- The current step is written to `?adventureStep=<n>` in the URL so players can bookmark/share their progress point.
- Forward links are rendered as primary action buttons from the step text's `go to` instructions.
- Traceback links are rendered as subtle back buttons from the step's parenthesized trace references.
- A local character sheet is embedded under each step and autosaved per logged-in user in browser storage.

## Hiding print-only decorations (image blacklist)

The Domestic adventure text was extracted from the original printed rulebook PDF. That process produced a markdown file plus a folder of nearly a thousand loose images — every illustration, character portrait, and piece of page chrome the PDF contained, dumped as separate PNGs. On paper, the "page chrome" is useful: each step of the adventure is decorated with a little numbered police-badge graphic, and some pages have decorative scroll-work flourishes in the margins. On the web those decorations add nothing — the step number is already the heading, and the flourishes are just paper-era ornaments — so they need to be hidden without disturbing the real illustrations we want to keep.

To do this we keep a plain-text list of filenames to ignore at `Rivers_of_London/image-blacklist.txt`. The adventure parser (`src/domesticAdventure.js`) reads that list and strips any matching image references before sending the step text to the browser. Any image not on the list is rendered inline as a normal `<img>` in the step.

The tricky part was deciding *which* of the ~973 extracted images belonged on the list without looking at every single one by hand. We solved it with a technique called **perceptual hashing**. Here's the idea in plain terms: a regular file hash (like MD5) changes completely if a single pixel is different, which makes it useless for "find me things that look the same." A perceptual hash instead produces a short fingerprint that is derived from the broad visual shape of the picture — dark and light regions, rough contours — so two pictures that look alike to a human get fingerprints that are nearly identical, even if their pixel data differs slightly. We can then measure how different two pictures are by counting how many bits of their fingerprints disagree; small numbers mean "visually very similar," large numbers mean "completely different pictures."

We picked one confirmed badge graphic and one confirmed flourish as reference examples, fingerprinted all 973 extracted images, and kept the ones whose fingerprints were close enough to either reference. To avoid a false positive where a real illustration happens to share a fingerprint (unlikely but not impossible), we also required the candidate to match the reference in rough pixel dimensions and file size — a character portrait is nowhere near the size or shape of a 94×106-pixel badge, so the guard rules it out even if the fingerprint is a near match. That combined check surfaced 212 badge graphics and 64 flourishes, which were appended to the blacklist under commented section headers. Once the server restarts, the adventure renders clean: 111 steps, genuine illustrations still inline, page-chrome gone.

If more decorations turn up later, adding them is manual — just drop the filename (or the full relative path) on a new line in `image-blacklist.txt`.

## Data

SQLite database stored at `DB_PATH`. Back it up by copying the `.db` file.
