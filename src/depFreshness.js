// Startup dependency-freshness check.
//
// The server is deployed by pulling from GitHub and running `node src/server.js`;
// node_modules is gitignored, so a pull can advance package-lock.json without the
// box reinstalling. When that happens the running modules are stale (e.g. a
// security bump in the lockfile hasn't actually landed). This check compares the
// lockfile's mtime against npm's install marker and, if the lockfile is newer,
// prints the exact command needed to update the packages.
//
// Advisory only — it never blocks boot. Fail-open on anything unreadable.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// npm writes node_modules/.package-lock.json on every install, so its mtime is
// the most reliable "last installed" stamp. Fall back to the node_modules dir.
function lastInstallMtime() {
  const marker = path.join(REPO_ROOT, 'node_modules', '.package-lock.json');
  try { if (fs.existsSync(marker)) return fs.statSync(marker).mtimeMs; } catch { /* fall through */ }
  try {
    const dir = path.join(REPO_ROOT, 'node_modules');
    if (fs.existsSync(dir)) return fs.statSync(dir).mtimeMs;
  } catch { /* fall through */ }
  return null; // node_modules absent → never installed here
}

// Returns the recommended command, or '' if dependencies look up to date.
function staleInstallCommand() {
  const lock = path.join(REPO_ROOT, 'package-lock.json');
  let lockMtime;
  try { lockMtime = fs.statSync(lock).mtimeMs; } catch { return ''; } // no lockfile → nothing to compare
  const installed = lastInstallMtime();
  if (installed == null) return 'npm ci';            // dependencies not installed at all
  return lockMtime > installed ? 'npm ci' : '';      // lockfile changed since last install
}

// Log a one-line nudge with the command to run if the lockfile is newer than the
// installed modules. Returns the command it printed (or '' if nothing to do).
function checkDependencyFreshness({ logger = console } = {}) {
  let cmd;
  try { cmd = staleInstallCommand(); } catch { return ''; } // never let this break boot
  if (cmd) {
    logger.warn(`[deps] package-lock.json is newer than the installed modules — dependencies are out of date. Run: ${cmd}`);
  }
  return cmd;
}

module.exports = { checkDependencyFreshness, staleInstallCommand };
