#!/bin/bash

# =============================================================================
# Database Setup Script
# =============================================================================
# This script sets up the development database for the Ptah License Server.
#
# USAGE:
#   ./setup-database.sh          # Use local Docker PostgreSQL
#   ./setup-database.sh --neon   # Use Neon cloud database
#
# PREREQUISITES:
#   - Docker installed (for local mode)
#   - Neon account and project created (for --neon mode)
# =============================================================================

set -e  # Exit on error

# Parse arguments
USE_NEON=false
if [ "$1" == "--neon" ]; then
    USE_NEON=true
fi

echo "========================================"
echo "Ptah License Server - Database Setup"
echo "========================================"
echo ""

if [ "$USE_NEON" = true ]; then
    # ==========================================================================
    # Neon Cloud Database Setup
    # ==========================================================================
    echo "Mode: Neon Cloud Database"
    echo ""

    # Check if DATABASE_URL is set in .env
    cd apps/ptah-license-server

    if grep -q '^DATABASE_URL=.*neon' .env 2>/dev/null; then
        echo "✓ Neon DATABASE_URL found in .env"
    else
        echo "✗ Neon DATABASE_URL not found in .env"
        echo ""
        echo "Please add your Neon connection string to apps/ptah-license-server/.env:"
        echo ""
        echo '  DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"'
        echo ""
        echo "Get your connection string from: https://console.neon.tech"
        exit 1
    fi

    echo ""
    echo "Running Prisma migrations against Neon..."
    npx prisma migrate dev --name init

else
    # ==========================================================================
    # Local Docker PostgreSQL Setup
    # ==========================================================================
    echo "Mode: Local Docker PostgreSQL"
    echo ""

    # Step 1: Start database container
    echo "Step 1: Starting PostgreSQL..."
    docker-compose -f docker-compose.db.yml up -d

    # Step 2: Wait for database to be healthy
    echo "Step 2: Waiting for database to be ready..."
    echo "  (This may take up to 30 seconds...)"

    MAX_RETRIES=30
    RETRIES=0
    while [ $RETRIES -lt $MAX_RETRIES ]; do
        if docker exec ptah_postgres_dev pg_isready -U postgres -d ptah_licenses &> /dev/null; then
            echo "  ✓ Database is ready!"
            break
        fi
        RETRIES=$((RETRIES + 1))
        sleep 1
    done

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        echo "  ✗ Database failed to start. Check: docker-compose -f docker-compose.db.yml logs"
        exit 1
    fi

    # Check database status
    echo ""
    echo "Database container status:"
    docker-compose -f docker-compose.db.yml ps

    # Step 3: Create initial migration
    echo ""
    echo "Step 3: Running Prisma migrations..."
    cd apps/ptah-license-server

    # Verify DATABASE_URL is set for local
    if grep -q '^DATABASE_URL=.*localhost' .env 2>/dev/null; then
        echo "  ✓ Local DATABASE_URL found in .env"
    else
        echo "  ✗ Local DATABASE_URL not found in .env"
        echo ""
        echo "Please ensure apps/ptah-license-server/.env has:"
        echo ""
        echo '  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"'
        exit 1
    fi

    npx prisma migrate dev --name init
fi

echo ""
echo "========================================"
echo "✓ Database setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Start the application: npx nx serve ptah-license-server"
echo "  2. Access the API at: http://localhost:3000/api"
echo ""

if [ "$USE_NEON" = false ]; then
    echo "To stop the local database:"
    echo "  docker-compose -f docker-compose.db.yml down"
    echo ""
fi
