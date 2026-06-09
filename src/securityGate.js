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
  // Build a per-package list of moderate-or-higher findings for reporting. The
  // `via` array holds either parent package names (strings) or advisory objects
  // ({ title, url, severity }); we surface the advisories where present.
  const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  const findings = [];
  for (const [name, info] of Object.entries(data.vulnerabilities || {})) {
    if ((RANK[info && info.severity] || 0) < RANK.moderate) continue;
    const advisories = [];
    for (const via of (info.via || [])) {
      if (via && typeof via === 'object' && via.title) advisories.push({ title: via.title, url: via.url || '' });
    }
    findings.push({ name, severity: info.severity, advisories });
  }
  // Most severe first, then by name.
  findings.sort((a, b) => (RANK[b.severity] - RANK[a.severity]) || a.name.localeCompare(b.name));
  return {
    ok: true,
    critical: v.critical || 0,
    high: v.high || 0,
    moderate: v.moderate || 0,
    low: v.low || 0,
    findings,
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

  // Always REPORT every moderate-or-higher finding (visible each startup),
  // independent of the halt decision below.
  if (r.findings.length) {
    logger.warn(`[security] ${r.findings.length} package(s) with moderate+ advisories — critical: ${r.critical}, high: ${r.high}, moderate: ${r.moderate}:`);
    for (const f of r.findings) {
      const tag = String(f.severity).toUpperCase().padEnd(8);
      if (f.advisories.length) {
        for (const a of f.advisories) logger.warn(`[security]   ${tag} ${f.name} — ${a.title}${a.url ? ` (${a.url})` : ''}`);
      } else {
        logger.warn(`[security]   ${tag} ${f.name} (via a vulnerable dependency)`);
      }
    }
  } else {
    logger.log('[security] startup audit: no moderate-or-higher findings.');
  }

  // HALT only on critical.
  if (r.critical > 0) {
    if (cowboy) {
      logger.warn(`[security] ${r.critical} CRITICAL present — starting anyway because ${COWBOY_FLAG} was given. Fix these.`);
      return;
    }
    logger.error(`[security] ${r.critical} CRITICAL finding(s). REFUSING TO START.`);
    logger.error('[security] Run `npm run audit:all` to see them and fix (overrides/bumps + commit a new lockfile).');
    logger.error(`[security] To start anyway despite the risk, relaunch with ${COWBOY_FLAG}.`);
    return exit(1);
  }
}

module.exports = { enforceSecurityGate, runAudit, COWBOY_FLAG };
