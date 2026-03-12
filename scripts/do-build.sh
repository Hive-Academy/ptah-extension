#!/usr/bin/env bash
# Build script for DigitalOcean App Platform
set -e

# Skip Nx cache — DO creates a fresh build environment each deploy,
# so caching provides no benefit and causes EACCES permission errors.
export NX_SKIP_NX_CACHE=true

# Install all dependencies (including devDependencies like Nx)
# NODE_ENV must NOT be production here or npm ci skips devDependencies
npm ci

# Now build with production config
npx nx build ptah-landing-page --configuration=production --skip-nx-cache
