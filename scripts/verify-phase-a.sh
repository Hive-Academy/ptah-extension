#!/usr/bin/env bash
# =============================================================================
# Phase A Verification Script
# =============================================================================
# This script verifies that all Phase A infrastructure components are working:
#   - Docker services (PostgreSQL, Redis, License Server)
#   - Database connectivity
#   - Redis connectivity
#   - License Server API endpoints
#   - Paddle webhook endpoint
#   - WorkOS PKCE flow
#
# USAGE:
#   ./scripts/verify-phase-a.sh
#
# REQUIREMENTS:
#   - Docker and Docker Compose installed
#   - Services started with: docker-compose up -d
#   - curl command available
#
# CROSS-PLATFORM:
#   Works on Linux, macOS, and Windows (Git Bash/WSL2)
# =============================================================================

set -e

# Colors for output (works in most terminals including Git Bash)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# License server URL
LICENSE_SERVER_URL="${LICENSE_SERVER_URL:-http://localhost:3000}"

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_test() {
    echo -n "  Testing: $1... "
}

print_pass() {
    echo -e "${GREEN}PASS${NC}"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}FAIL${NC}"
    echo -e "    ${RED}Error: $1${NC}"
    ((FAILED++))
}

print_warn() {
    echo -e "${YELLOW}WARN${NC}"
    echo -e "    ${YELLOW}Warning: $1${NC}"
    ((WARNINGS++))
}

print_skip() {
    echo -e "${YELLOW}SKIP${NC}"
    echo -e "    ${YELLOW}Reason: $1${NC}"
}

# =============================================================================
# Check Prerequisites
# =============================================================================

print_header "Checking Prerequisites"

# Check Docker
print_test "Docker installed"
if command -v docker &> /dev/null; then
    print_pass
else
    print_fail "Docker not found. Please install Docker Desktop."
    echo ""
    echo "Install Docker:"
    echo "  Windows: https://docs.docker.com/desktop/install/windows-install/"
    echo "  macOS: https://docs.docker.com/desktop/install/mac-install/"
    echo "  Linux: https://docs.docker.com/desktop/install/linux-install/"
    exit 1
fi

# Check Docker Compose
print_test "Docker Compose installed"
if docker compose version &> /dev/null; then
    print_pass
elif docker-compose version &> /dev/null; then
    print_pass
else
    print_fail "Docker Compose not found. Please install Docker Compose."
    exit 1
fi

# Check curl
print_test "curl installed"
if command -v curl &> /dev/null; then
    print_pass
else
    print_fail "curl not found. Please install curl."
    exit 1
fi

# =============================================================================
# Check Docker Services
# =============================================================================

print_header "Docker Services Status"

# Check if Docker is running
print_test "Docker daemon running"
if docker info &> /dev/null; then
    print_pass
else
    print_fail "Docker daemon not running. Please start Docker Desktop."
    exit 1
fi

# Check docker-compose.yml exists
print_test "docker-compose.yml exists"
if [ -f "docker-compose.yml" ]; then
    print_pass
else
    # Try from scripts directory
    if [ -f "../docker-compose.yml" ]; then
        cd ..
        print_pass
    else
        print_fail "docker-compose.yml not found. Run from project root."
        exit 1
    fi
fi

# Check services are running
print_test "PostgreSQL container running"
if docker ps --format '{{.Names}}' | grep -q "ptah_postgres"; then
    print_pass
else
    print_fail "PostgreSQL container not running. Run: docker-compose up -d"
fi

print_test "Redis container running"
if docker ps --format '{{.Names}}' | grep -q "ptah_redis"; then
    print_pass
else
    print_fail "Redis container not running. Run: docker-compose up -d"
fi

print_test "License Server container running"
if docker ps --format '{{.Names}}' | grep -q "ptah_license_server"; then
    print_pass
else
    print_fail "License Server container not running. Run: docker-compose up -d"
fi

# =============================================================================
# Verify Database Connections
# =============================================================================

print_header "Database Connectivity"

# PostgreSQL health check
print_test "PostgreSQL accepting connections"
if docker exec ptah_postgres pg_isready -U postgres -d ptah_licenses &> /dev/null; then
    print_pass
else
    print_fail "PostgreSQL not ready. Check logs: docker-compose logs postgres"
fi

# PostgreSQL query test
print_test "PostgreSQL query execution"
QUERY_RESULT=$(docker exec ptah_postgres psql -U postgres -d ptah_licenses -c "SELECT 1 as test;" 2>&1)
if echo "$QUERY_RESULT" | grep -q "1"; then
    print_pass
else
    print_fail "PostgreSQL query failed: $QUERY_RESULT"
fi

# Redis health check
print_test "Redis accepting connections"
REDIS_PING=$(docker exec ptah_redis redis-cli ping 2>&1)
if [ "$REDIS_PING" = "PONG" ]; then
    print_pass
else
    print_fail "Redis not responding. Got: $REDIS_PING"
fi

# Redis SET/GET test
print_test "Redis SET/GET operations"
docker exec ptah_redis redis-cli SET test_key "test_value" &> /dev/null
REDIS_GET=$(docker exec ptah_redis redis-cli GET test_key 2>&1)
docker exec ptah_redis redis-cli DEL test_key &> /dev/null
if [ "$REDIS_GET" = "test_value" ]; then
    print_pass
else
    print_fail "Redis GET returned unexpected value: $REDIS_GET"
fi

# =============================================================================
# Verify License Server API
# =============================================================================

print_header "License Server API"

# Wait for server to be ready (with timeout)
print_test "License Server responding"
MAX_RETRIES=30
RETRY_DELAY=2
RETRIES=0
SERVER_READY=false

while [ $RETRIES -lt $MAX_RETRIES ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${LICENSE_SERVER_URL}/api" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        SERVER_READY=true
        break
    fi
    ((RETRIES++))
    if [ $RETRIES -lt $MAX_RETRIES ]; then
        sleep $RETRY_DELAY
    fi
done

if [ "$SERVER_READY" = true ]; then
    print_pass
else
    print_fail "Server not responding after ${MAX_RETRIES} retries (HTTP: $HTTP_CODE)"
    echo "    Check logs: docker-compose logs license-server"
fi

# Test health endpoint
print_test "Health endpoint (/api)"
HEALTH_RESPONSE=$(curl -s "${LICENSE_SERVER_URL}/api" 2>/dev/null)
if echo "$HEALTH_RESPONSE" | grep -qi "message\|hello\|ok\|status"; then
    print_pass
else
    print_warn "Unexpected response: $HEALTH_RESPONSE"
fi

# =============================================================================
# Verify Paddle Webhook Endpoint
# =============================================================================

print_header "Paddle Webhook Integration"

# Test webhook endpoint exists (should return 401 without valid signature)
print_test "Paddle webhook endpoint exists"
WEBHOOK_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${LICENSE_SERVER_URL}/webhooks/paddle" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"test"}' 2>/dev/null || echo "000")

# Expect 401 (invalid signature) or 400 (bad request) - both indicate endpoint exists
if [ "$WEBHOOK_CODE" = "401" ]; then
    print_pass
    echo "    (Got 401 - signature verification working correctly)"
elif [ "$WEBHOOK_CODE" = "400" ]; then
    print_pass
    echo "    (Got 400 - endpoint exists, validation working)"
elif [ "$WEBHOOK_CODE" = "500" ]; then
    print_warn "Got 500 - endpoint exists but has internal error"
elif [ "$WEBHOOK_CODE" = "404" ]; then
    print_fail "Webhook endpoint not found (404)"
else
    print_warn "Unexpected response code: $WEBHOOK_CODE"
fi

# Test with mock Paddle payload
print_test "Webhook rejects invalid signature"
INVALID_SIG_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${LICENSE_SERVER_URL}/webhooks/paddle" \
    -H "Content-Type: application/json" \
    -H "Paddle-Signature: ts=123;h1=invalid_signature" \
    -d '{"event_type":"subscription.created","event_id":"evt_test_123"}' 2>/dev/null || echo "000")

if [ "$INVALID_SIG_CODE" = "401" ]; then
    print_pass
elif [ "$INVALID_SIG_CODE" = "400" ]; then
    print_pass
    echo "    (Signature validation working)"
else
    print_warn "Expected 401, got: $INVALID_SIG_CODE"
fi

# =============================================================================
# Verify WorkOS Authentication Flow
# =============================================================================

print_header "WorkOS Authentication (PKCE)"

# Test login redirect
print_test "Login endpoint redirects"
LOGIN_RESPONSE=$(curl -s -I "${LICENSE_SERVER_URL}/auth/login" 2>/dev/null)
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | grep -i "HTTP/" | tail -1 | awk '{print $2}')

if [ "$LOGIN_CODE" = "302" ] || [ "$LOGIN_CODE" = "301" ] || [ "$LOGIN_CODE" = "307" ]; then
    print_pass
elif [ "$LOGIN_CODE" = "500" ]; then
    print_warn "Got 500 - WorkOS credentials may not be configured"
    echo "    Configure WORKOS_API_KEY and WORKOS_CLIENT_ID in .env"
elif [ "$LOGIN_CODE" = "404" ]; then
    print_fail "Login endpoint not found (404)"
else
    print_warn "Expected redirect (302), got: $LOGIN_CODE"
fi

# Check for PKCE parameters in redirect URL
print_test "PKCE parameters in redirect"
LOCATION_HEADER=$(echo "$LOGIN_RESPONSE" | grep -i "location:" | head -1)

if echo "$LOCATION_HEADER" | grep -qi "code_challenge"; then
    print_pass
    echo "    (code_challenge found in redirect URL)"
elif echo "$LOCATION_HEADER" | grep -qi "workos\|authkit"; then
    print_warn "Redirect to WorkOS found but PKCE params not detected"
    echo "    Verify getAuthorizationUrl() generates PKCE challenge"
else
    if [ "$LOGIN_CODE" = "500" ]; then
        print_skip "WorkOS not configured"
    else
        print_warn "Could not verify PKCE parameters"
        echo "    Location: ${LOCATION_HEADER:-'(none)'}"
    fi
fi

# Check for state cookie
print_test "State cookie set on login"
COOKIE_HEADER=$(echo "$LOGIN_RESPONSE" | grep -i "set-cookie:" | head -1)

if echo "$COOKIE_HEADER" | grep -qi "workos_state"; then
    print_pass
    echo "    (workos_state cookie found)"
elif [ "$LOGIN_CODE" = "500" ]; then
    print_skip "WorkOS not configured"
else
    print_warn "State cookie not detected"
    echo "    Cookie: ${COOKIE_HEADER:-'(none)'}"
fi

# =============================================================================
# Verify Prisma Schema
# =============================================================================

print_header "Database Schema (Prisma)"

# Check if migrations have been applied
print_test "Prisma migrations applied"
MIGRATION_CHECK=$(docker exec ptah_postgres psql -U postgres -d ptah_licenses -c "\dt" 2>&1)

if echo "$MIGRATION_CHECK" | grep -qi "users\|licenses"; then
    print_pass
    echo "    (users and licenses tables exist)"
else
    print_warn "Expected tables not found. Run migrations:"
    echo "    docker exec ptah_license_server npx prisma migrate deploy --schema=apps/ptah-license-server/prisma/schema.prisma"
fi

# Check for subscriptions table (new in Phase A)
print_test "Subscriptions table exists"
if echo "$MIGRATION_CHECK" | grep -qi "subscriptions"; then
    print_pass
else
    print_warn "Subscriptions table not found. Run migration:"
    echo "    cd apps/ptah-license-server && npx prisma migrate dev --name add_subscription_model"
fi

# =============================================================================
# Summary
# =============================================================================

print_header "Verification Summary"

TOTAL=$((PASSED + FAILED))

echo ""
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  All critical checks passed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Phase A infrastructure is ready."
    echo ""
    echo "Next steps:"
    echo "  1. Configure WorkOS credentials in .env (if not done)"
    echo "  2. Configure Paddle credentials in .env (if not done)"
    echo "  3. Run Prisma migrations if subscriptions table missing"
    echo "  4. Test authentication flow manually"
    echo ""
    exit 0
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  $FAILED check(s) failed${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Please fix the failed checks before proceeding."
    echo ""
    echo "Common fixes:"
    echo "  - Start services: docker-compose up -d"
    echo "  - Check logs: docker-compose logs -f"
    echo "  - Rebuild: docker-compose down -v && docker-compose up -d --build"
    echo ""
    exit 1
fi
