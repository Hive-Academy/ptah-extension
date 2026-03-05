# Development Tasks - TASK_2025_180

**Total Tasks**: 16 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- nginx/certbot services exist in docker-compose.prod.yml: Verified (lines 68-99)
- CI workflow only runs lint+build: Verified (line 38: `npx nx run-many -t lint  build`)
- PrismaModule is global: Verified (app.module.ts imports PrismaModule, PrismaService available everywhere)
- Dockerfile HEALTHCHECK uses `--spider http://localhost:3000/api`: Verified (lines 130-131)
- PRODUCTION_DEPLOYMENT.md references Neon: Verified (lines 19-21)
- GitHub repo owner: `Hive-Academy` (verified via git remote)
- nginx directory exists with 2 files: Verified (`nginx/nginx.conf`, `nginx/conf.d/api.conf`)

### Risks Identified

| Risk                                               | Severity | Mitigation                                                        |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| Caddy replacement changes SSL layer                | MED      | Test locally with docker-compose; Caddy auto-HTTPS is well-proven |
| GHCR image tag uses lowercase repo owner           | LOW      | GitHub lowercases automatically; use `${{ github.repository }}`   |
| Health endpoint must return 503 not 200 on failure | LOW      | Use `ServiceUnavailableException` in catch block                  |

### Edge Cases to Handle

- [ ] Health endpoint: DB connection timeout (handled by PrismaService error propagation) -> Task 3.1
- [ ] Deploy workflow: first-time deployment before GHCR image exists -> Task 2.3 keeps `build:` section
- [ ] Caddy volume deletion would lose certificates -> Document in Caddyfile comments

---

## Batch 1: Infrastructure - Caddy + Docker Compose Hardening

**Status**: IN PROGRESS
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create Caddyfile

**Status**: IMPLEMENTED
**File**: D:\projects\ptah-extension\caddy\Caddyfile
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Work Item 1, lines 68-84

**Quality Requirements**:

- Reverse proxy to `license-server:3000`
- Forward headers: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto
- Enable gzip encoding
- Log to stdout in console format
- Auto-HTTPS via Let's Encrypt (implicit with domain name)

**Implementation Details**:

- Domain: `api.ptah.live`
- `reverse_proxy license-server:3000` with `header_up` directives
- `encode gzip` block
- `log` block with `output stdout` and `format console`

---

### Task 1.2: Modify docker-compose.prod.yml - Replace nginx+certbot with Caddy

**Status**: IMPLEMENTED
**File**: D:\projects\ptah-extension\docker-compose.prod.yml
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 1, lines 95-133

**Quality Requirements**:

- Remove entire `nginx` service block (lines 68-86)
- Remove entire `certbot` service block (lines 88-99)
- Remove `certbot-etc` and `certbot-var` volumes (lines 107-110)
- Add `caddy` service with image `caddy:2-alpine`, container name `ptah_caddy`, memory limit 64M
- Add `caddy-data` and `caddy-config` volumes
- Update file header comment to reference Caddy instead of nginx+certbot
- Remove certbot initial setup instructions from header

**Implementation Details**:

- Caddy service: ports 80:80, 443:443
- Volumes: `./caddy/Caddyfile:/etc/caddy/Caddyfile:ro`, `caddy-data:/data`, `caddy-config:/config`
- depends_on: license-server
- Memory limit: 64M via deploy.resources.limits
- Network: ptah-network

---

### Task 1.3: Delete nginx directory and files

**Status**: IMPLEMENTED
**Files**:

- D:\projects\ptah-extension\nginx\nginx.conf (DELETE)
- D:\projects\ptah-extension\nginx\conf.d\api.conf (DELETE)
- D:\projects\ptah-extension\nginx\ directory (DELETE)
  **Action**: DELETE
  **Spec Reference**: implementation-plan.md: Work Item 1, lines 135-139

**Quality Requirements**:

- Both files removed
- Empty directory removed
- Git tracks the deletions

---

### Task 1.4: Add Docker log rotation to DIGITALOCEAN.md

**Status**: IMPLEMENTED
**File**: D:\projects\ptah-extension\docs\deployment\DIGITALOCEAN.md
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 6, lines 346-375

**Quality Requirements**:

- Add "Configure Docker Log Rotation" subsection to Step 2 (after Docker installation)
- Include daemon.json creation with max-size 10m, max-file 3
- Include systemctl restart docker command
- Add explanation: limits each container to 30MB of logs

---

**Batch 1 Verification**:

- caddy/Caddyfile exists with correct config
- docker-compose.prod.yml has caddy service, no nginx/certbot
- nginx/ directory deleted
- DIGITALOCEAN.md has log rotation section
- code-logic-reviewer approved
- Git commit created

---

## Batch 2: CI/CD Pipelines

**Status**: PENDING
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (docker-compose.prod.yml must have Caddy already)

### Task 2.1: Enhance CI workflow with test and typecheck

**Status**: PENDING
**File**: D:\projects\ptah-extension\.github\workflows\ci.yml
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 2, lines 143-164

**Quality Requirements**:

- Change line 38 from `npx nx run-many -t lint  build` to `npx nx run-many -t lint test typecheck build`
- Preserve all other workflow configuration

**Implementation Details**:

- Order: lint -> test -> typecheck -> build (fastest to slowest)

---

### Task 2.2: Create server deployment workflow

**Status**: PENDING
**File**: D:\projects\ptah-extension\.github\workflows\deploy-server.yml
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Work Item 3, lines 167-230

**Quality Requirements**:

- Trigger on push to `release/server` branch
- Permissions: contents read, packages write
- Job 1: build-and-push (checkout, login to GHCR, build+push Docker image)
- Job 2: deploy (SSH to droplet, git pull, docker compose pull, up -d, prune)
- Uses `appleboy/ssh-action@v1` for SSH
- Tags: `latest` and `${{ github.sha }}`

**Implementation Details**:

- Registry: ghcr.io
- Image name: `${{ github.repository }}/license-server`
- Secrets referenced: DROPLET_HOST, DROPLET_USER, DROPLET_SSH_KEY
- Deploy path: /opt/ptah-extension

---

### Task 2.3: Create extension publishing workflow

**Status**: PENDING
**File**: D:\projects\ptah-extension\.github\workflows\publish-extension.yml
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Work Item 4, lines 263-317

**Quality Requirements**:

- Trigger on push to `release/extension` AND workflow_dispatch with pre-release boolean input
- checkout with fetch-depth 0, setup-node 20, npm ci --legacy-peer-deps
- Build: `npx nx run ptah-extension-vscode:package`
- Publish from `dist/apps/ptah-extension-vscode` using `npx @vscode/vsce publish`
- Conditional `--pre-release` flag based on workflow_dispatch input
- Secret: VSCE_PAT

---

### Task 2.4: Add GHCR image tag to docker-compose.prod.yml

**Status**: PENDING
**File**: D:\projects\ptah-extension\docker-compose.prod.yml
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 3, lines 237-257

**Quality Requirements**:

- Add `image: ghcr.io/hive-academy/ptah-extension/license-server:latest` to license-server service
- Keep existing `build:` section (both image and build coexist)
- `docker compose pull` uses GHCR image; `docker compose up -d --build` uses local build

**Implementation Details**:

- Owner: hive-academy (lowercase of Hive-Academy)
- Image line goes before build section in the service definition

---

**Batch 2 Verification**:

- ci.yml has lint, test, typecheck, build targets
- deploy-server.yml exists with correct structure
- publish-extension.yml exists with correct structure
- docker-compose.prod.yml license-server has both image and build
- code-logic-reviewer approved
- Git commit created

---

## Batch 3: Health Check Endpoint

**Status**: PENDING
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None (independent of Batches 1-2)

### Task 3.1: Create health controller

**Status**: PENDING
**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\health\health.controller.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Work Item 11, lines 637-685

**Quality Requirements**:

- `@Controller('health')` decorator (route: GET /api/health)
- Constructor injection of PrismaService
- Logger instance
- `check()` method with `@Get()` decorator
- Try: `this.prisma.user.count()` -> return { status: 'ok', timestamp, database: 'connected' }
- Catch: throw `ServiceUnavailableException` (HTTP 503) - NOT return 200 with error body
- Explicit `public` accessor on method (workspace lint rule)

**Validation Notes**:

- MUST use ServiceUnavailableException for 503, not return 200 with error status
- Pattern: follow license.controller.ts for Logger and constructor injection style

---

### Task 3.2: Create health module

**Status**: PENDING
**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\health\health.module.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Work Item 11, lines 692-708

**Quality Requirements**:

- Standard NestJS module with `@Module({ controllers: [HealthController] })`
- No imports needed (PrismaModule is global)
- JSDoc comment explaining why PrismaModule import is not needed

---

### Task 3.3: Import HealthModule in AppModule

**Status**: PENDING
**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 11, lines 712-721

**Quality Requirements**:

- Add import statement: `import { HealthModule } from '../health/health.module';`
- Add `HealthModule` to imports array with comment
- Place after SessionModule in the feature modules section

---

### Task 3.4: Update Dockerfile HEALTHCHECK

**Status**: PENDING
**File**: D:\projects\ptah-extension\apps\ptah-license-server\Dockerfile
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 11, lines 724-738

**Quality Requirements**:

- Change `--spider http://localhost:3000/api` to `-O /dev/null http://localhost:3000/api/health`
- Keep all other HEALTHCHECK parameters (interval, timeout, start-period, retries)
- Reason: `--spider` only checks headers; `-O /dev/null` checks HTTP status code from JSON response

---

**Batch 3 Verification**:

- health.controller.ts exists with proper 503 error handling
- health.module.ts exists
- app.module.ts imports HealthModule
- Dockerfile HEALTHCHECK points to /api/health
- Build passes: `npx nx build ptah-license-server`
- code-logic-reviewer approved
- Git commit created

---

## Batch 4: Documentation Updates

**Status**: PENDING
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (DIGITALOCEAN.md log rotation already added)

### Task 4.1: Move swap setup to mandatory initial setup in DIGITALOCEAN.md

**Status**: PENDING
**File**: D:\projects\ptah-extension\docs\deployment\DIGITALOCEAN.md
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 7, lines 379-426

**Quality Requirements**:

- Add "Configure Swap Space (Required)" subsection to Step 2 (after firewall, before Step 3)
- Include fallocate, chmod, mkswap, swapon, fstab persistence, swappiness=10
- In troubleshooting "Memory Pressure" section, replace swap instructions with cross-reference to Step 2
- Emphasize swap is REQUIRED for 1GB droplet, not optional

---

### Task 4.2: Add SSH hardening to DIGITALOCEAN.md

**Status**: PENDING
**File**: D:\projects\ptah-extension\docs\deployment\DIGITALOCEAN.md
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 8, lines 430-493

**Quality Requirements**:

- Replace `ufw allow OpenSSH` with `ufw limit OpenSSH` (rate limiting)
- Add fail2ban installation section
- Add "Disable Password Authentication" section with sed commands
- Add "Secure .env.prod File Permissions" section (chmod 600)
- Prerequisite note about SSH key before disabling password auth

---

### Task 4.3: Reconcile Neon vs self-hosted PostgreSQL in PRODUCTION_DEPLOYMENT.md

**Status**: PENDING
**File**: D:\projects\ptah-extension\docs\deployment\PRODUCTION_DEPLOYMENT.md
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 9, lines 496-564

**Quality Requirements**:

- Change 1: Architecture diagram - replace Neon block with self-hosted PostgreSQL
- Change 2: Section 2.4 - replace Neon setup with self-hosted PostgreSQL table
- Change 3: Section 3 DATABASE_URL - replace Neon connection string with docker-compose note
- Change 4: Section 10 Cost Summary - replace Neon line with self-hosted $0

---

### Task 4.4: Add secret rotation strategy to PRODUCTION_DEPLOYMENT.md

**Status**: PENDING
**File**: D:\projects\ptah-extension\docs\deployment\PRODUCTION_DEPLOYMENT.md
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Work Item 10, lines 567-620

**Quality Requirements**:

- Add new Section 10 "Secret Rotation Strategy" before cost summary
- Renumber old Section 10 to Section 11
- Include rotation schedule table for all secrets
- Include rotation procedure with openssl, nano, docker compose restart
- Include PostgreSQL-specific password rotation procedure

---

**Batch 4 Verification**:

- DIGITALOCEAN.md has swap in Step 2, SSH hardening, log rotation
- PRODUCTION_DEPLOYMENT.md has no Neon references, has secret rotation section
- All markdown formatting correct
- code-logic-reviewer approved
- Git commit created

---
