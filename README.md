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

- Personal details include **glitch**, **backstory**, and **reputation** notes.
- Portrait upload is supported directly on the sheet (stored with sheet data and shown in the top-right area of the Personal Info section).
- Skills now include a fixed common-skills group (Athletics, Drive, Navigate, Observation, Read Person, Research, Sense Vestigia, Social, Stealth) with editable dropdown percentages (30/40/50/60), plus expert and additional groups (expert skills still support inline removal/addition).
- If a character has a Magical advantage, common skills automatically include Magic at 60% and enforce Sense Vestigia at 60%.
- Vitals include movement (speed), luck, and everyday carry/essential items.
- Advantages are displayed in a dedicated text box and edited in a collapsible picker list, improving visibility while preserving saved/custom entries.
- GM session view includes a consolidated table for all assigned players showing character identity, stats (STR/CON/DEX/INT/POW plus speed/luck), advantages, skills, and essential items.
- Rules tab directly embeds the bundled HTML Rivers of London rulebook in-app; use browser find (Ctrl/Cmd + F) for text search.

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

## Data

SQLite database stored at `DB_PATH`. Back it up by copying the `.db` file.
