#!/usr/bin/env bash
# Build script for DigitalOcean App Platform
# Handles Nx cache permission issues by using /tmp for cache
set -e

export NX_CACHE_DIRECTORY=/tmp/.nx-cache
export NODE_ENV=production

npm ci
npx nx build ptah-landing-page --configuration=production
