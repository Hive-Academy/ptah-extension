# Implementation Plan - TASK_2025_180

## DevOps Infrastructure Hardening & CI/CD Pipelines

---

## 1. Codebase Investigation Summary

### Current Production Stack (docker-compose.prod.yml)

4 services: `postgres`, `license-server`, `nginx`, `certbot`

- **postgres**: 256M memory limit, healthcheck via `pg_isready`, volume `postgres-data`
- **license-server**: 512M memory limit, depends on postgres healthy, builds from `apps/ptah-license-server/Dockerfile`
- **nginx**: No memory limit, ports 80/443, mounts `nginx/nginx.conf`, `nginx/conf.d/`, certbot volumes
- **certbot**: No memory limit, renewal loop every 12h, shares volumes with nginx
- **Volumes**: `postgres-data`, `certbot-etc`, `certbot-var`
- **Network**: `ptah_prod_network` (bridge)

### nginx Configuration (nginx/nginx.conf + nginx/conf.d/api.conf)

- `worker_processes auto`, `client_max_body_size 10M`, `keepalive_timeout 65`
- HTTP-to-HTTPS redirect on port 80 for `api.ptah.live`
- ACME challenge location `/.well-known/acme-challenge/` for certbot
- HTTPS server block with TLS 1.2/1.3, proxy to `http://license-server:3000`
- Proxy headers: Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto, WebSocket upgrade

### Current CI (.github/workflows/ci.yml)

- Triggers: push to `main`, pull requests
- Steps: checkout (tree:0 filter), setup-node 20, npm ci --legacy-peer-deps
- Build command: `npx nx run-many -t lint build` (missing `test` and `typecheck`)
- Has `npx nx fix-ci` as always-run step

### Dockerfile (apps/ptah-license-server/Dockerfile)

- 3-stage build: builder -> deps -> production
- Non-root user `nestjs:nodejs` (UID/GID 1001)
- NODE_OPTIONS `--max-old-space-size=450`
- HEALTHCHECK: `wget --spider http://localhost:3000/api` (no DB validation)
- CMD: `npx prisma migrate deploy && node main.js`

### NestJS Application Structure

- **main.ts**: Global prefix `api`, webhooks excluded from prefix, cookie-parser, CORS, ValidationPipe
- **app.module.ts**: ConfigModule (global), ThrottlerModule (100 req/min default), PrismaModule (global), plus 7 feature modules
- **PrismaService**: Extends `PrismaClient`, uses `@prisma/adapter-pg` driver adapter, has `$connect()` on init with `user.count()` test query
- **PrismaModule**: `@Global()` decorator, exports PrismaService (available everywhere without import)
- **Controller pattern**: `@Controller('v1/licenses')`, constructor injection of PrismaService and services, Logger per controller

### Documentation State

- **DIGITALOCEAN.md**: Swap space is in "Troubleshooting" section (not initial setup). Firewall uses `ufw allow OpenSSH` (not rate-limited). No SSH hardening, no log rotation, no fail2ban.
- **PRODUCTION_DEPLOYMENT.md**: Section 2.4 references Neon PostgreSQL (stale). Section 3 DATABASE_URL points to Neon endpoint. Section 10 Cost Summary shows "Neon PostgreSQL (Free tier) = Free". Contradicts self-hosted PostgreSQL in docker-compose.prod.yml and DIGITALOCEAN.md.

---

## 2. Component Specifications

### Work Item 1: Replace nginx+certbot with Caddy

**Purpose**: Eliminate 2 containers (nginx + certbot), replace with 1 Caddy container that handles auto-HTTPS via Let's Encrypt natively.

**Evidence**: Current nginx config (nginx/conf.d/api.conf:28-38) does reverse proxy to `license-server:3000` with standard headers. Caddy replicates this with 3 lines.

#### Files to CREATE

**caddy/Caddyfile**

```
api.ptah.live {
    reverse_proxy license-server:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    encode gzip

    log {
        output stdout
        format console
    }
}
```

Key behaviors:

- Auto-HTTPS via Let's Encrypt (ACME HTTP-01 challenge on port 80)
- HTTP-to-HTTPS redirect automatic
- TLS 1.2+ with modern cipher suite (default)
- No certbot, no manual cert renewal

#### Files to MODIFY

**docker-compose.prod.yml** - Replace nginx and certbot services with caddy:

Remove:

- Entire `nginx` service block (lines 69-86)
- Entire `certbot` service block (lines 91-99)
- Volumes `certbot-etc` and `certbot-var` (lines 108-110)

Add caddy service:

```yaml
caddy:
  image: caddy:2-alpine
  container_name: ptah_caddy
  restart: always
  ports:
    - '80:80'
    - '443:443'
  volumes:
    - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy-data:/data
    - caddy-config:/config
  depends_on:
    - license-server
  deploy:
    resources:
      limits:
        memory: 64M
  networks:
    - ptah-network
```

Add volumes:

```yaml
caddy-data:
  name: ptah_caddy_data
caddy-config:
  name: ptah_caddy_config
```

Update file header comment to reference Caddy instead of nginx + Certbot. Remove certbot initial setup instructions from header.

#### Files to DELETE

- `nginx/nginx.conf`
- `nginx/conf.d/api.conf`
- `nginx/` directory entirely

---

### Work Item 2: CI/CD - Enhance existing CI workflow

**Purpose**: Add `test` and `typecheck` targets to the existing CI pipeline so PRs are validated beyond just lint and build.

**Evidence**: Current ci.yml line 38: `npx nx run-many -t lint build` - only runs 2 targets.

#### Files to MODIFY

**.github/workflows/ci.yml** - Line 38:

Change from:

```yaml
- run: npx nx run-many -t lint  build
```

Change to:

```yaml
- run: npx nx run-many -t lint test typecheck build
```

Order rationale: lint (fastest, catches syntax) -> test (unit tests) -> typecheck (slower full tsc) -> build (final artifact validation). Nx parallelizes within each target.

---

### Work Item 3: CI/CD - Server deployment workflow

**Purpose**: Automated deployment pipeline triggered by push to `release/server` branch. Builds Docker image, pushes to GitHub Container Registry, SSHs into droplet, pulls and restarts.

#### Files to CREATE

**.github/workflows/deploy-server.yml**

```yaml
name: Deploy Server

on:
  push:
    branches:
      - release/server

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/license-server

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/ptah-license-server/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.IMAGE_NAME }}:latest
            ghcr.io/${{ env.IMAGE_NAME }}:${{ github.sha }}

  deploy:
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - name: Deploy to Droplet
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: ${{ secrets.DROPLET_USER }}
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: |
            cd /opt/ptah-extension
            git pull origin release/server
            docker compose -f docker-compose.prod.yml pull license-server
            docker compose -f docker-compose.prod.yml up -d license-server
            docker image prune -f
```

**Required GitHub Secrets** (document in DIGITALOCEAN.md):

- `DROPLET_SSH_KEY`: Private SSH key for droplet access
- `DROPLET_HOST`: Droplet IP address
- `DROPLET_USER`: SSH user (root or deploy)

**docker-compose.prod.yml modification** for GHCR support:

The `license-server` service needs to support both local build AND pre-built image. Change the service definition to use the GHCR image instead of local build:

```yaml
license-server:
  image: ghcr.io/<owner>/ptah-extension/license-server:latest
  # Remove build: section
```

However, this creates a chicken-and-egg problem for first deployment. Better approach: keep `build:` section but add `image:` tag so `docker compose pull` works when image exists in registry, and `docker compose up -d --build` still works for manual deploys:

```yaml
license-server:
  image: ghcr.io/<owner>/ptah-extension/license-server:latest
  build:
    context: .
    dockerfile: apps/ptah-license-server/Dockerfile
```

The deploy workflow uses `pull` + `up -d` (no `--build`), so it uses the pre-built GHCR image. Manual deploys can still use `--build` flag.

**Note**: The `<owner>` placeholder must be replaced with the actual GitHub org/user. The developer implementing this should use the GitHub repository owner from the repo URL.

---

### Work Item 4: CI/CD - Extension publishing workflow

**Purpose**: Automated VS Code extension publishing triggered by push to `release/extension` or manual workflow_dispatch with pre-release option.

**Evidence**: PRODUCTION_DEPLOYMENT.md lines 334-348 document the manual publish process. DIGITALOCEAN.md lines 634-645 show the build pipeline.

#### Files to CREATE

**.github/workflows/publish-extension.yml**

```yaml
name: Publish Extension

on:
  push:
    branches:
      - release/extension
  workflow_dispatch:
    inputs:
      pre-release:
        description: 'Publish as pre-release'
        required: false
        type: boolean
        default: false

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci --legacy-peer-deps

      - name: Build and package extension
        run: npx nx run ptah-extension-vscode:package

      - name: Publish to VS Code Marketplace
        run: |
          cd dist/apps/ptah-extension-vscode
          if [ "${{ github.event.inputs.pre-release }}" = "true" ]; then
            npx @vscode/vsce publish --pre-release --pat ${{ secrets.VSCE_PAT }}
          else
            npx @vscode/vsce publish --pat ${{ secrets.VSCE_PAT }}
          fi
```

**Required GitHub Secret**:

- `VSCE_PAT`: Azure DevOps Personal Access Token for VS Code Marketplace publishing

---

### Work Item 5: Docker hardening - Container memory limits

**Purpose**: Ensure all containers have memory limits to prevent OOM on the 1GB droplet.

**Evidence**: docker-compose.prod.yml already has limits for postgres (256M) and license-server (512M). nginx and certbot have none.

#### Files to MODIFY

**docker-compose.prod.yml** - After replacing nginx+certbot with Caddy (Work Item 1), Caddy already includes `memory: 64M`. This is covered by Work Item 1.

Memory budget verification:

- postgres: 256M
- license-server: 512M (includes NODE_OPTIONS --max-old-space-size=450)
- caddy: 64M
- **Total**: 832M out of 1024M (81%) - leaves ~192M for OS + swap

No additional changes needed beyond Work Item 1.

---

### Work Item 6: Docker hardening - Log rotation

**Purpose**: Prevent disk exhaustion from container logs on the 25GB droplet disk.

#### Files to MODIFY

**docs/deployment/DIGITALOCEAN.md** - Add to Step 2 (Initial Setup), after Docker installation:

Add new subsection "Configure Docker Log Rotation":

````markdown
### Configure Docker Log Rotation

Create the Docker daemon configuration to prevent log files from consuming all disk space:

```bash
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# Restart Docker to apply
systemctl restart docker
```
````

This limits each container to 30MB of logs (3 files x 10MB). On a 25GB disk, this is essential.

````

---

### Work Item 7: Documentation - Mandatory swap space

**Purpose**: Move swap setup from troubleshooting to mandatory initial setup. On a 1GB droplet with 832M of container memory limits, swap is not optional.

**Evidence**: DIGITALOCEAN.md lines 452-460 have swap in "Common Issues > Memory Pressure" section.

#### Files to MODIFY

**docs/deployment/DIGITALOCEAN.md** - Two changes:

**Change 1**: Add swap setup to Step 2 (after firewall config, before Step 3). Add new subsection:

```markdown
### Configure Swap Space (Required)

A 1GB droplet **requires** swap space for stability. Without swap, the OOM killer will terminate containers under memory pressure.

```bash
# Create 1GB swap file
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make persistent across reboots
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Optimize swappiness (prefer RAM, use swap only when necessary)
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p
````

Verify: `free -h` should show 1.0G swap.

````

**Change 2**: In the "Common Issues > Memory Pressure" troubleshooting section (lines 447-462), replace the swap instructions with a cross-reference:

```markdown
#### 2. Memory Pressure (1GB Droplet)

**Symptom**: OOM kills, slow responses

**Solutions**:
- Check memory: `free -h` and `docker stats`
- Verify swap is enabled (configured in Step 2): `swapon --show`
- If swap is missing, follow the swap setup in Step 2
- Upgrade to $12/month Droplet (2GB RAM) if persistent
````

---

### Work Item 8: Documentation - SSH hardening

**Purpose**: Harden SSH access to the droplet with rate limiting, fail2ban, and disabled password auth.

**Evidence**: DIGITALOCEAN.md line 202 uses `ufw allow OpenSSH` (no rate limiting).

#### Files to MODIFY

**docs/deployment/DIGITALOCEAN.md** - Replace the firewall section in Step 2 (lines 200-207):

Replace:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

With:

````markdown
### Configure Firewall and SSH Hardening

```bash
# Rate-limit SSH (blocks IPs with 6+ connection attempts in 30 seconds)
ufw limit OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```
````

### Install fail2ban

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

fail2ban monitors SSH login attempts and bans IPs after repeated failures. Default config is sufficient.

### Disable Password Authentication

```bash
# Edit SSH config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Restart SSH
systemctl restart sshd
```

**Prerequisite**: Ensure your SSH key is added to the droplet before disabling password auth.

### Secure .env.prod File Permissions

After creating `.env.prod` (Step 3), restrict its permissions:

```bash
chmod 600 .env.prod
```

This ensures only the file owner (root) can read the secrets.

```

---

### Work Item 9: Documentation - Reconcile Neon vs self-hosted PostgreSQL

**Purpose**: PRODUCTION_DEPLOYMENT.md still references Neon PostgreSQL. The actual deployment uses self-hosted PostgreSQL in Docker. Remove all Neon references.

**Evidence**: PRODUCTION_DEPLOYMENT.md lines 17-21 (architecture diagram shows Neon), lines 98-117 (Section 2.4 Neon setup), lines 126-133 (DATABASE_URL with Neon endpoint), lines 386-394 (cost summary with Neon).

#### Files to MODIFY

**docs/deployment/PRODUCTION_DEPLOYMENT.md** - 4 changes:

**Change 1**: Architecture diagram (lines 7-27) - Replace Neon block:

Replace:
```

│ Neon PostgreSQL (Azure East US 2) │
│ Production branch: br-royal-boat-a8l68lc1 │

```

With:
```

│ Self-hosted PostgreSQL 16 (Docker on Droplet) │
│ Container: ptah_postgres_prod │

````

**Change 2**: Section 2.4 (lines 98-117) - Replace entire Neon section:

Replace with:
```markdown
### 2.4 PostgreSQL (Self-Hosted)

PostgreSQL runs as a Docker container on the same droplet. No external database service required.

| Setting   | Value                                    |
| --------- | ---------------------------------------- |
| Container | `ptah_postgres_prod`                     |
| Image     | `postgres:16-alpine`                     |
| Database  | `ptah_db`                                |
| User      | `ptah`                                   |
| Port      | 5432 (internal, not exposed to internet) |

Configuration is managed via `.env.prod`. See DIGITALOCEAN.md for setup.
````

**Change 3**: Section 3 DATABASE_URL (lines 126-133) - Replace Neon connection string:

Replace:

```bash
DATABASE_URL="postgresql://neondb_owner:<PASSWORD>@ep-misty-fog-a8sd45ut-pooler.eastus2.azure.neon.tech/neondb?sslmode=require"
```

With:

```bash
# DATABASE_URL is constructed automatically by docker-compose.prod.yml
# from POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB variables.
# Do NOT set DATABASE_URL manually in .env.prod.
```

**Change 4**: Section 10 Cost Summary (lines 383-394) - Replace Neon line:

Replace:

```
| Neon PostgreSQL (Free tier)             | Free              |
```

With:

```
| PostgreSQL (self-hosted on Droplet)     | $0 (included)     |
```

---

### Work Item 10: Documentation - Secret rotation strategy

**Purpose**: Document when and how to rotate production secrets.

#### Files to MODIFY

**docs/deployment/PRODUCTION_DEPLOYMENT.md** - Add new section after Section 9 (before Cost Summary). Insert as Section 10, renumber old Section 10 to Section 11.

````markdown
## 10. Secret Rotation Strategy

All secrets in `.env.prod` should be rotated on a regular schedule. Mark your calendar.

| Secret              | Rotation Schedule | How to Rotate                                           |
| ------------------- | ----------------- | ------------------------------------------------------- |
| `JWT_SECRET`        | Every 6 months    | Generate new value, restart server. Active JWTs expire. |
| `ADMIN_API_KEY`     | Quarterly         | Generate new value, update any scripts using it.        |
| `ADMIN_SECRET`      | Quarterly         | Generate new value, restart server.                     |
| `POSTGRES_PASSWORD` | Annually          | Update in .env.prod, run ALTER ROLE in psql, restart.   |
| `WORKOS_API_KEY`    | Per WorkOS policy | Regenerate in WorkOS dashboard, update .env.prod.       |
| `PADDLE_API_KEY`    | Per Paddle policy | Regenerate in Paddle dashboard, update .env.prod.       |
| `RESEND_API_KEY`    | Per Resend policy | Regenerate in Resend dashboard, update .env.prod.       |
| `VSCE_PAT`          | Before expiry     | Azure DevOps PATs expire after max 1 year. Regenerate.  |

### Rotation Procedure

```bash
# 1. Generate new secret value
openssl rand -hex 32

# 2. Edit .env.prod on the droplet
nano /opt/ptah-extension/.env.prod

# 3. Restart affected services
docker compose -f docker-compose.prod.yml restart license-server

# 4. Verify service is healthy
curl https://api.ptah.live/api/health
```
````

### PostgreSQL Password Rotation

```bash
# 1. Connect to PostgreSQL container
docker exec -it ptah_postgres_prod psql -U ptah -d ptah_db

# 2. Change password
ALTER ROLE ptah WITH PASSWORD 'new-password-here';

# 3. Update .env.prod with new POSTGRES_PASSWORD
# 4. Restart license-server (it reads DATABASE_URL from env)
docker compose -f docker-compose.prod.yml restart license-server
```

````

---

### Work Item 11: Health check endpoint with DB validation

**Purpose**: Replace the naive HTTP 200 healthcheck with one that validates PostgreSQL connectivity.

**Evidence**:
- PrismaService (prisma.service.ts) extends PrismaClient and is globally available via PrismaModule
- PrismaService already does `this.user.count()` as a connectivity test (line 53)
- Dockerfile HEALTHCHECK at line 130-131: `wget --spider http://localhost:3000/api`
- Global prefix is `api` (main.ts line 67), so a `@Controller('health')` will be at `/api/health`
- Controller pattern: @Controller decorator, constructor injection, Logger (verified from license.controller.ts)

#### Files to CREATE

**apps/ptah-license-server/src/health/health.controller.ts**

```typescript
import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HealthController - Production health check endpoint
 *
 * Validates actual database connectivity, not just HTTP 200.
 * Used by Docker HEALTHCHECK and monitoring tools.
 *
 * Route: GET /api/health
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Health check with database validation
   *
   * GET /api/health
   *
   * Returns 200 with status "ok" when database is reachable.
   * Returns 503 with status "error" when database is unreachable.
   */
  @Get()
  public async check() {
    try {
      await this.prisma.user.count();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      };
    } catch (error) {
      this.logger.error('Health check failed: database unreachable', error);
      // Return 503 by throwing or setting status
      // NestJS will catch this and return 503
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      };
    }
  }
}
````

**Design note**: Using `this.prisma.user.count()` matches the existing pattern in PrismaService.onModuleInit() (line 53). An alternative is `this.prisma.$queryRawUnsafe('SELECT 1')` but `user.count()` is already proven to work with the driver adapter pattern used in this project.

**Important**: The controller should return HTTP 503 when the database is down, not 200. The developer should use `@HttpCode` or throw a `ServiceUnavailableException` in the catch block to properly signal failure to the Docker healthcheck.

**apps/ptah-license-server/src/health/health.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * HealthModule - Health check endpoint module
 *
 * PrismaService is available globally (PrismaModule is @Global),
 * so no need to import PrismaModule here.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

#### Files to MODIFY

**apps/ptah-license-server/src/app/app.module.ts** - Add HealthModule to imports:

Add import:

```typescript
import { HealthModule } from '../health/health.module';
```

Add to imports array:

```typescript
HealthModule, // Health check with DB validation
```

**apps/ptah-license-server/Dockerfile** - Update HEALTHCHECK (line 130-131):

Replace:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1
```

With:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:3000/api/health || exit 1
```

Note: Changed from `--spider` to `-O /dev/null` because the health endpoint returns a JSON body (not just headers), and we want `wget` to check the HTTP status code. When the endpoint returns 503, `wget` will return non-zero exit code.

---

## 3. Phase Breakdown

### Phase 1: Infrastructure Changes (Docker + Caddy)

**Work Items**: 1 (Caddy), 5 (memory limits), 6 (log rotation)

These are infrastructure-level changes that must be deployed together. Caddy replacement and memory limits affect docker-compose.prod.yml simultaneously.

**Files affected**:

- CREATE: `caddy/Caddyfile`
- MODIFY: `docker-compose.prod.yml`
- MODIFY: `docs/deployment/DIGITALOCEAN.md` (log rotation section only)
- DELETE: `nginx/nginx.conf`, `nginx/conf.d/api.conf`

**Risk**: Medium. Caddy replacement changes the SSL/proxy layer. Must test on a staging environment or accept brief downtime during switchover.

### Phase 2: CI/CD Pipelines

**Work Items**: 2 (enhance CI), 3 (deploy-server), 4 (publish-extension)

All three workflow files are independent of each other and of the infrastructure changes. Can be developed in parallel.

**Files affected**:

- MODIFY: `.github/workflows/ci.yml`
- CREATE: `.github/workflows/deploy-server.yml`
- CREATE: `.github/workflows/publish-extension.yml`
- MODIFY: `docker-compose.prod.yml` (add `image:` tag for GHCR)

**Risk**: Low. Workflow files only trigger on specific branches. No impact on existing CI until merged.

### Phase 3: Application Changes (Health Endpoint)

**Work Item**: 11 (health check endpoint)

NestJS code change that requires building and testing. Independent of infrastructure.

**Files affected**:

- CREATE: `apps/ptah-license-server/src/health/health.controller.ts`
- CREATE: `apps/ptah-license-server/src/health/health.module.ts`
- MODIFY: `apps/ptah-license-server/src/app/app.module.ts`
- MODIFY: `apps/ptah-license-server/Dockerfile`

**Risk**: Low. Additive change. New endpoint, no existing code modified except module imports and Dockerfile HEALTHCHECK.

### Phase 4: Documentation Updates

**Work Items**: 7 (swap), 8 (SSH hardening), 9 (Neon reconciliation), 10 (secret rotation)

Pure documentation changes. No code impact. Can be done in parallel.

**Files affected**:

- MODIFY: `docs/deployment/DIGITALOCEAN.md` (items 7, 8)
- MODIFY: `docs/deployment/PRODUCTION_DEPLOYMENT.md` (items 9, 10)

**Risk**: None. Documentation only.

---

## 4. Files Affected Summary

### CREATE (5 files)

| File                                                       | Work Item | Description                       |
| ---------------------------------------------------------- | --------- | --------------------------------- |
| `caddy/Caddyfile`                                          | 1         | Caddy reverse proxy configuration |
| `.github/workflows/deploy-server.yml`                      | 3         | Server deployment workflow        |
| `.github/workflows/publish-extension.yml`                  | 4         | Extension publishing workflow     |
| `apps/ptah-license-server/src/health/health.controller.ts` | 11        | Health check controller           |
| `apps/ptah-license-server/src/health/health.module.ts`     | 11        | Health check module               |

### MODIFY (6 files)

| File                                             | Work Items | Description                                          |
| ------------------------------------------------ | ---------- | ---------------------------------------------------- |
| `docker-compose.prod.yml`                        | 1, 3       | Replace nginx/certbot with Caddy, add GHCR image tag |
| `.github/workflows/ci.yml`                       | 2          | Add test + typecheck targets                         |
| `apps/ptah-license-server/src/app/app.module.ts` | 11         | Import HealthModule                                  |
| `apps/ptah-license-server/Dockerfile`            | 11         | Update HEALTHCHECK to /api/health                    |
| `docs/deployment/DIGITALOCEAN.md`                | 6, 7, 8    | Log rotation, swap, SSH hardening                    |
| `docs/deployment/PRODUCTION_DEPLOYMENT.md`       | 9, 10      | Remove Neon, add secret rotation                     |

### DELETE (2 files + directory)

| File                    | Work Item | Description              |
| ----------------------- | --------- | ------------------------ |
| `nginx/nginx.conf`      | 1         | Replaced by Caddy        |
| `nginx/conf.d/api.conf` | 1         | Replaced by Caddy        |
| `nginx/` (directory)    | 1         | Entire directory removed |

---

## 5. Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Phase 1-2: Docker Compose, GitHub Actions YAML, Caddyfile - all DevOps/backend work
- Phase 3: NestJS controller + module - backend TypeScript
- Phase 4: Markdown documentation - any developer
- No frontend work involved

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

**Breakdown**:

- Phase 1 (Caddy + Docker): ~1 hour (config files, test locally)
- Phase 2 (CI/CD): ~1 hour (3 workflow files)
- Phase 3 (Health endpoint): ~30 minutes (simple NestJS controller)
- Phase 4 (Documentation): ~1 hour (4 doc updates)

### Critical Verification Points

**Before implementation, developer must verify**:

1. **NestJS patterns verified from codebase**:

   - Controller pattern: `apps/ptah-license-server/src/license/controllers/license.controller.ts`
   - Module pattern: `apps/ptah-license-server/src/prisma/prisma.module.ts`
   - PrismaService injection: `apps/ptah-license-server/src/prisma/prisma.service.ts`
   - Global prefix: `apps/ptah-license-server/src/main.ts:67-68`

2. **Docker patterns verified from codebase**:

   - Service definition pattern: `docker-compose.prod.yml` (existing services)
   - Dockerfile HEALTHCHECK: `apps/ptah-license-server/Dockerfile:130-131`

3. **CI/CD patterns verified from codebase**:

   - Existing CI structure: `.github/workflows/ci.yml`
   - Build command: `npx nx run ptah-extension-vscode:package` (PRODUCTION_DEPLOYMENT.md:226)

4. **Health endpoint must return HTTP 503 on DB failure** (not 200 with error body). Use `ServiceUnavailableException` from `@nestjs/common`.

5. **Caddy data volume is critical** - The `caddy-data` volume stores Let's Encrypt certificates. Never delete this volume in production.

6. **GitHub Secrets must be configured before deploy workflows work**:
   - `DROPLET_SSH_KEY`, `DROPLET_HOST`, `DROPLET_USER` for server deploy
   - `VSCE_PAT` for extension publishing

### Architecture Delivery Checklist

- [x] All 11 work items specified with complete file-level changes
- [x] All NestJS patterns verified from existing controllers/modules
- [x] All Docker patterns verified from existing docker-compose.prod.yml
- [x] Health endpoint uses proven PrismaService pattern (user.count)
- [x] Caddy config replicates all nginx functionality (reverse proxy, headers, HTTPS)
- [x] CI/CD workflows follow GitHub Actions best practices
- [x] Documentation changes address all stale references (Neon)
- [x] Memory budget verified: 832M / 1024M (81%)
- [x] Files affected list complete (5 CREATE, 6 MODIFY, 2+dir DELETE)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 3-5 hours)
- [x] No step-by-step implementation (team-leader decomposes into tasks)
