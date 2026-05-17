# TODO

- **Visibility-set artifacts (master folder + audience copies).** Replace the
  folder-based GM-only/Player-Handout toggle with a per-artifact visibility
  set. Layout:
  - `Gallery/_master/<file>` — canonical copy; never walked by the source/
    asset listers and never fed to the LLM.
  - `Gallery/all/`, `Gallery/gm/`, `Gallery/<userId>/` — a **copy** of the
    file in each audience that may see it (copies, not hard links — robust
    on every filesystem; files are tiny vs. the app).
  - The visibility set = which audience folders contain `<file>` (matched by
    filename). Empty set (master only) = **archived**. Grant = copy
    master→audience; revoke = delete that audience copy; delete = remove
    master + all copies.
  - **Replace** overwrites every audience copy that has the file; **Rename**
    renames master + all copies together (copies don't share an inode).
  - Asset route, listers, and the prose injector consult audience folders
    only; a player is served a file only if it is in `all/` or their own
    `<userId>/`. Per-character artifacts surface display-time in a
    "From the GM" section at the foot of that player's view — never via the
    shared-prose injector.
  - Keyed by user/account id, labelled by character in the UI. New handouts
    / extracted NPC portraits default to the `gm` audience.
  - Edit Files: the GM Only ⇄ Player Handout control becomes a multi-select
    of {GM, All, each character}; clearing all archives it; the list always
    shows every master file so archived artifacts stay reachable.

  This single feature replaces the folder toggle and subsumes per-character
  private clues AND archive/unarchive.

## Done

- **Link artifacts to entities.** Delivered: deterministic post-generation
  injector matches in-scope image filenames (separator-wildcarded prefix
  match) to entity names/headings; NPC sheet portraits auto-extracted from
  the DB to player-Gallery files and rendered per-card at 0.3LHS; filename
  layout tags (`<frac>LHS|RHS|FW`).
