#!/usr/bin/env bash
# Build script for DigitalOcean App Platform and shared PtahCode live demo build/assertion sequence
set -euo pipefail

build_ptah_live_demo() {
  npx nx build ptah-extension-webview --configuration=production --output-hashing=all "$@"
  node scripts/landing/build-live-demo.mjs
}

assert_ptah_live_demo() {
  local root_dir="${1:-dist/ptah-landing-page/browser}"
  local demo_dist="$root_dir/demo"

  test -f "$demo_dist/index.html"
  test -f "$demo_dist/scenarios/index.json"
  grep -q '<base href="/demo/">' "$demo_dist/index.html"
  grep -qi 'http-equiv="Content-Security-Policy"' "$demo_dist/index.html"
  grep -Eq '<script src="replay-bridge\.[0-9a-f]{8}\.js" data-scenario-version="[0-9a-f]{8}"></script>' "$demo_dist/index.html"

  # Verify content-hashed replay-bridge.<hash8>.js, every id in scenarios/index.json -> scenarios/<id>.json,
  # and every font file referenced by demo CSS (resolved relative to each CSS file).
  node --input-type=module - "$root_dir" <<'EOF'
import { verifyDemoArtifacts } from './scripts/landing/live-demo-cli.mjs';
const info = await verifyDemoArtifacts(process.argv[2]);
console.log(
  `[do-build] Verified PtahCode live demo: bridge=${info.bridgeFileName}, scenarioVersion=${info.scenarioVersion}, scenarios=${info.scenarioIds.join(',')}, fonts=${info.verifiedFontCount}`,
);
EOF
}

if [[ "${1:-}" == "--demo-only" ]]; then
  shift
  build_ptah_live_demo "$@"
  assert_ptah_live_demo "dist/ptah-landing-page/browser"
  exit 0
fi

if [[ "${1:-}" == "--assert-demo-only" ]]; then
  assert_ptah_live_demo "${2:-dist/ptah-landing-page/browser}"
  exit 0
fi

# Skip Nx cache — DO creates a fresh build environment each deploy,
# so caching provides no benefit and causes EACCES permission errors.
export NX_SKIP_NX_CACHE=true

# NOTE: the heroku/nodejs buildpack already installs the full monorepo
# (including devDependencies, since NODE_ENV is unset) during its
# "Installing dependencies" phase, BEFORE this custom command runs. Do not
# reinstall here — a second full `npm ci` doubles network transfer and was a
# source of ECONNRESET build failures.

# Guarantee the Linux rollup native binary the SSG prerender needs. The
# CSR->SSG switch moved the build onto Vite/rollup (esbuild didn't need it),
# and npm/cli#4828 skips this optional dep from a Windows-generated lockfile.
# Without it prerender dies with "Cannot find module @rollup/rollup-linux-x64-gnu".
npm install @rollup/rollup-linux-x64-gnu --no-save --force

# Build landing page with production config
npx nx build ptah-landing-page --configuration=production --skip-nx-cache

# Build PtahCode live demo webview (production, --output-hashing=all), run copy step, and assert output
build_ptah_live_demo --skip-nx-cache
assert_ptah_live_demo "dist/ptah-landing-page/browser"
