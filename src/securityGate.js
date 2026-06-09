// Startup vulnerability gate.
//
// On boot the service runs `npm audit` and REFUSES TO START if there is a
// CRITICAL finding — unless launched with `--cowboy-mode-on`. This makes a
// known-critical dependency a hard stop on a fresh deploy/restart, rather than
// something that quietly ships.
//
// Fail-open on tooling/availability problems: if npm is missing, offline, or
// the output can't be parsed, we log loudly and start anyway. The gate blocks
// on a *confirmed* critical finding, never on an inability to check (so a
// flaky network can't take the service down). Set the env var
// SECURITY_GATE=off to skip it entirely (e.g. in tests).

const path = require('path');
const { spawnSync } = require('child_process');

const COWBOY_FLAG = '--cowboy-mode-on';

// Run `npm audit --json` and return the vulnerability counts. npm exits
// non-zero when vulnerabilities exist, but still writes the JSON to stdout, so
// we read stdout regardless of exit code.
function runAudit(cwd = path.join(__dirname, '..')) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) return { ok: false, reason: res.error.message };
  let data;
  try { data = JSON.parse(res.stdout || '{}'); } catch (e) { return { ok: false, reason: `unparseable npm audit output (${e.message})` }; }
  if (data.error) return { ok: false, reason: data.error.summary || 'npm audit reported an error' };
  const v = (data.metadata && data.metadata.vulnerabilities) || {};
  return {
    ok: true,
    critical: v.critical || 0,
    high: v.high || 0,
    moderate: v.moderate || 0,
    low: v.low || 0,
  };
}

// Enforce the gate. Exits the process with code 1 on an un-overridden critical
// finding; otherwise returns. `argv` defaults to the real process arguments.
function enforceSecurityGate({ argv = process.argv, logger = console, exit = (c) => process.exit(c), audit = runAudit } = {}) {
  if (/^(off|0|false)$/i.test(process.env.SECURITY_GATE || '')) {
    logger.warn('[security] startup audit gate disabled via SECURITY_GATE=off.');
    return;
  }
  const cowboy = argv.includes(COWBOY_FLAG);
  const r = audit();

  if (!r.ok) {
    logger.warn(`[security] npm audit could not run (${r.reason}); starting without the vulnerability gate.`);
    return;
  }

  if (r.critical > 0) {
    if (cowboy) {
      logger.warn(`[security] ${r.critical} CRITICAL vulnerability(ies) present — starting anyway because ${COWBOY_FLAG} was given. Fix these.`);
      return;
    }
    logger.error(`[security] ${r.critical} CRITICAL vulnerability(ies) found (high: ${r.high}, moderate: ${r.moderate}). REFUSING TO START.`);
    logger.error('[security] Run `npm run audit:all` to see them and fix (overrides/bumps + commit a new lockfile).');
    logger.error(`[security] To start anyway despite the risk, relaunch with ${COWBOY_FLAG}.`);
    return exit(1);
  }

  logger.log(`[security] startup audit clean of critical findings (high: ${r.high}, moderate: ${r.moderate}, low: ${r.low}).`);
}

module.exports = { enforceSecurityGate, runAudit, COWBOY_FLAG };
