#!/usr/bin/env bash
# Build script for DigitalOcean App Platform — Ptah Docs (Astro Starlight)
set -e

# Skip Nx cache — DO creates a fresh build environment each deploy,
# so caching provides no benefit and causes EACCES permission errors.
export NX_SKIP_NX_CACHE=true

# Install all dependencies (including devDependencies like Nx, Astro).
# NODE_ENV must NOT be production here or npm ci skips devDependencies.
# Workaround for npm optional-deps bug (https://github.com/npm/cli/issues/4828):
# rollup's platform-specific binaries (@rollup/rollup-linux-x64-gnu) are
# declared as optionalDependencies. On npm 10.x even a fresh install from a
# lockfile generated on a non-Linux host may skip the Linux binary. We remove
# the lockfile so npm resolves platform-correct optionals, then force-install
# the Linux binary explicitly as a belt-and-braces guarantee.
rm -f package-lock.json
npm install --no-audit --no-fund

# The native binary version must match the installed rollup EXACTLY, so derive
# it rather than pinning a literal. This line used to read
# `@rollup/rollup-linux-x64-gnu@4.60.0`, which was already a patch behind the
# 4.60.4 rollup on main and became a MINOR mismatch when the dependency
# migration moved rollup to 4.63.4 — a deploy-only failure, invisible to every
# local build and every CI job, because this script runs on DigitalOcean.
# Deriving it also beats installing `latest` (what scripts/do-build.sh does),
# which is only correct while rollup happens to be current.
ROLLUP_VERSION="$(node -p "require('rollup/package.json').version")"
echo "[do-docs-build] rollup ${ROLLUP_VERSION} -> matching linux-x64-gnu binary"
npm install --no-save --no-audit --no-fund "@rollup/rollup-linux-x64-gnu@${ROLLUP_VERSION}"

# Build the docs site. Astro defaults to a production build; the ptah-docs
# project.json has no 'production' configuration, so no --configuration flag.
npx nx build ptah-docs --skip-nx-cache
