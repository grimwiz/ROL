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
- Portrait upload is supported directly on the sheet (stored with sheet data and shown in the top-right of the sheet view).
- Skills include mandatory and additional groups, with inline removal for mandatory entries.
- Vitals include movement (speed), luck, and everyday carry/essential items.
- GM session view includes a consolidated table for all assigned players showing character identity, stats (STR/CON/DEX/INT/POW plus speed/luck), skills, and essential items.
- Rules Library tab lets authenticated users open the bundled Rivers of London rulebook in HTML or Markdown, and run full-text search against the Markdown file.

## Front-end scripts

- `public/js/api.js`: Centralized browser API client used by UI actions (`auth`, `users`, `sessions`, and character sheet endpoints).
- `public/js/app.js`: Main SPA logic (auth flow, session/account/rules tabs, session rename modal, player assignment, GM/player sheet interactions, GM session overview table, and rulebook search UI).
- `public/js/sheet.js`: Character sheet renderer/collector used by both player and GM editing views, including backstory support, portrait upload/clear behavior, add/remove controls for mandatory skills, and add controls for additional skills/custom fields.

## Rulebook files

- Place the supplied rulebook files in `Rivers_of_London/` with matching base names:
  - `cha3200_-_rivers_of_london_1.4.md`
  - `cha3200_-_rivers_of_london_1.4.html`
  - `cha3200_-_rivers_of_london_1.4_artifacts/` (image references used by the HTML/Markdown)
- The server exposes these files at `/rules-files/*`.
- API endpoints for authenticated users:
  - `GET /api/rules` (returns direct HTML/Markdown file URLs)
  - `GET /api/rules/search?q=<term>` (searches Markdown lines and returns snippets)

## Data

SQLite database stored at `DB_PATH`. Back it up by copying the `.db` file.
