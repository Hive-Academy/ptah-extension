#!/usr/bin/env bash
# Build script for DigitalOcean App Platform — Ptah Docs (Astro Starlight)
set -e

# Skip Nx cache — DO creates a fresh build environment each deploy,
# so caching provides no benefit and causes EACCES permission errors.
export NX_SKIP_NX_CACHE=true

# Install all dependencies (including devDependencies like Nx, Astro).
# NODE_ENV must NOT be production here or npm ci skips devDependencies.
npm ci

# Build the docs site. Astro defaults to a production build; the ptah-docs
# project.json has no 'production' configuration, so no --configuration flag.
npx nx build ptah-docs --skip-nx-cache
