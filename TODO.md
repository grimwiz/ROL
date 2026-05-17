# TODO

- **Player-private artifacts.** Let the GM attach a private file/picture to a
  specific player, shown at the bottom of that player's Characters tab and
  visible only to them (and the GM) — for private clues to roleplay with.
  Notes: unlike LLM entities, players are real accounts with stable IDs, so
  key the scope off the user/account id (not character name). Likely a
  per-player private area (e.g. `Gallery/private/<userId>/`); the asset route
  must let a player fetch only their own private files (GM sees all), and
  these must never feed the source walks / LLM context. Surfacing: a
  "From the GM" section at the foot of the player session view; GM manages
  assignment via Edit Files (a new visibility target alongside GM Only /
  Player Handout).

- **Archive / Unarchive files.** A pair of actions for files that should be
  kept but must not appear in, or feed into, any description or analysis
  (i.e. excluded from the GM/player source walks and the LLM context).
  Likely an `archive/` subfolder that the source/asset listers skip.

## Done

- **Link artifacts to entities.** Delivered: deterministic post-generation
  injector matches in-scope image filenames (separator-wildcarded prefix
  match) to entity names/headings; NPC sheet portraits auto-extracted from
  the DB to player-Gallery files and rendered per-card at 0.3LHS; filename
  layout tags (`<frac>LHS|RHS|FW`).
