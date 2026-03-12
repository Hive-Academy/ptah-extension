#!/usr/bin/env bash
# Build script for DigitalOcean App Platform
# Handles Nx cache permission issues by using /tmp for cache
set -e

export NX_CACHE_DIRECTORY=/tmp/.nx-cache

# Install all dependencies (including devDependencies like Nx)
# NODE_ENV must NOT be production here or npm ci skips devDependencies
npm ci

# Now build with production config
npx nx build ptah-landing-page --configuration=production
