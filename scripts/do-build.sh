#!/usr/bin/env bash
# Build script for DigitalOcean App Platform
set -e

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

# Build with production config
npx nx build ptah-landing-page --configuration=production --skip-nx-cache
