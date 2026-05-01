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
npm install --no-save --no-audit --no-fund @rollup/rollup-linux-x64-gnu@4.60.0

# Build the docs site. Astro defaults to a production build; the ptah-docs
# project.json has no 'production' configuration, so no --configuration flag.
npx nx build ptah-docs --skip-nx-cache
