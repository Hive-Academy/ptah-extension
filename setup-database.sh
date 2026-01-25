#!/bin/bash

# =============================================================================
# Database Setup Script
# =============================================================================
# This script sets up the development database and creates initial migrations
# =============================================================================

set -e  # Exit on error

echo "========================================"
echo "Ptah License Server - Database Setup"
echo "========================================"
echo ""

# Step 1: Start database containers
echo "Step 1: Starting PostgreSQL and Redis..."
docker-compose -f docker-compose.db.yml up -d

# Step 2: Wait for database to be healthy
echo "Step 2: Waiting for database to be ready..."
sleep 10

# Check database health
echo "Checking database status..."
docker-compose -f docker-compose.db.yml ps

# Step 3: Create initial migration
echo ""
echo "Step 3: Creating initial Prisma migration..."
cd apps/ptah-license-server

# Verify DATABASE_URL is set
if grep -q '^DATABASE_URL=' .env; then
    echo "✓ DATABASE_URL is configured in .env"
else
    echo "✗ ERROR: DATABASE_URL not found in .env"
    echo "Please uncomment DATABASE_URL in apps/ptah-license-server/.env"
    exit 1
fi

# Create migration
echo "Running: npx prisma migrate dev --name init"
npx prisma migrate dev --name init

echo ""
echo "========================================"
echo "✓ Database setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Check prisma/migrations/ directory for the generated migration"
echo "2. Commit the migration files to git"
echo "3. Start the application: npx nx serve ptah-license-server"
echo ""
echo "To stop databases:"
echo "  docker-compose -f docker-compose.db.yml down"
echo ""
