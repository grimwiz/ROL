#!/usr/bin/env bash
#
# One-command vulnerability check for every third-party component.
#
# Everything third-party in this repo is declared in package.json (server deps,
# markdown-it, pdf-lib, Excalidraw + its full transitive tree), so walking the
# npm dependency tree covers them all. This wraps `npm audit` (the same GitHub
# Advisory Database that Dependabot uses) as an on-demand / CI gate, and adds a
# registry-provenance check.
#
# Continuous watching is handled by GitHub Dependabot (enabled on the repo);
# run this locally before a release/deploy, or wire it into CI.
#
# Exit non-zero if anything at MODERATE or higher is found.
#
set -uo pipefail
cd "$(dirname "$0")/.."

status=0

echo "==> Dependency vulnerabilities (npm audit, fail at moderate+)"
# Audits the FULL tree incl. devDeps (the build-time Excalidraw chain), so a
# vuln is caught even though it ships only in the committed bundle.
if ! npm audit --audit-level=moderate; then
  status=1
fi

echo
echo "==> Registry provenance (npm audit signatures — informational)"
# Verifies installed packages match the registry's signed attestations where
# available. Not all packages are signed, so this never fails the run.
npm audit signatures || true

echo
echo "==> Tracked third-party artifacts (audited via the lockfile above)"
git ls-files 'public/js/vendor/*' 'public/vendor/excalidraw/host.js' 2>/dev/null | sed 's/^/    /'

echo
if [ "$status" -ne 0 ]; then
  cat <<'MSG'
RESULT: vulnerabilities found (moderate+).
Fix deliberately: bump or pin via package.json "overrides", run `npm install`,
re-run this script, then commit the new package-lock.json. If a *vendored* dep
changed (e.g. Excalidraw), also rebuild it: `npm run build:excalidraw`.
MSG
else
  echo "RESULT: no known vulnerabilities at moderate or higher."
fi
exit "$status"
