# Ptah Deployment — Remaining Issues & Validation Task

> Created: 2026-03-12
> Context: Continuing from infrastructure deployment session
> Branch: `feature/sdk-only-migration`

---

## Current State (What's Working)

| Component                          | Status     | URL/Details                                                                            |
| ---------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Droplet (ptah-api-prod)            | RUNNING    | 167.71.9.106, Ubuntu 24.04, Docker, UFW, fail2ban                                      |
| PostgreSQL 16                      | HEALTHY    | Container `ptah_postgres_prod`, data persisted in volume                               |
| NestJS License Server              | HEALTHY    | Container `ptah_license_server_prod`, port 3000                                        |
| Caddy Reverse Proxy                | RUNNING    | Container `ptah_caddy`, auto-HTTPS via Let's Encrypt                                   |
| `https://api.ptah.live/api/health` | LIVE 200   | `{"status":"ok","database":"connected"}`                                               |
| DNS (api.ptah.live)                | WORKING    | A record → 167.71.9.106 via DigitalOcean DNS                                           |
| DNS (ptah.live)                    | WORKING    | A record → 167.71.9.106 (temporary, will switch to App Platform)                       |
| Deploy Server CI/CD                | PASSING    | `.github/workflows/deploy-server.yml` — push to `release/server` triggers build+deploy |
| GitHub Secrets                     | CONFIGURED | All 6 secrets in place                                                                 |
| SSH Access                         | WORKING    | `ssh ptah-api` (key: `~/.ssh/id_ed25519_ptah`)                                         |

## Issues to Fix

### ISSUE 1: DO App Platform Build Config (Landing Page) — CRITICAL

**Problem**: The `starfish-app` on DO App Platform doesn't have correct build settings. The `deploy-landing.yml` workflow triggers `doctl apps create-deployment` which kicks off a build on App Platform, but the App Platform build fails with `BuildJobExitNonZero`.

**Root Cause**: App Platform's `landing` component was never configured with the correct Nx monorepo build settings.

**Fix Required** (via DO Dashboard or `doctl`):

1. Go to: https://cloud.digitalocean.com/apps/7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3/settings
2. Update the `landing` component settings:
   - **Source Directory**: `/` (root — Nx needs full repo)
   - **Build Command**: `npm ci --legacy-peer-deps && npx nx build ptah-landing-page --configuration=production`
   - **Output Directory**: `dist/ptah-landing-page/browser`
   - **Environment Variables**: `NODE_ENV=production`
3. Re-trigger deployment: push to `release/landing` or use `doctl apps create-deployment`

**Verification**: `https://ptah.live` loads the Angular landing page

### ISSUE 2: Garbled Config Files on Droplet — FIXED (verify)

**Problem**: During initial setup, the Caddyfile and docker-compose.prod.yml were entered via DO web console which garbled multi-line text. Files were re-sent via SCP.

**Status**: Fixed in this session. Caddy restarted successfully with correct config. Verify with:

```bash
ssh ptah-api "cat /opt/ptah-extension/caddy/Caddyfile"
ssh ptah-api "cat /opt/ptah-extension/docker-compose.prod.yml | head -20"
```

### ISSUE 3: CI Workflow Timeout on Main — LOW PRIORITY

**Problem**: `CI #71` on `main` failed with exit code 130 (SIGINT/timeout). This is a recurring issue — many prior CI runs also hit 6+ hour timeouts.

**Root Cause**: The `nx run-many -t lint test typecheck build` in `ci.yml` builds ALL projects. On GitHub's free tier runners, this can exceed the 6-hour limit.

**Possible Fixes**:

- Add `timeout-minutes: 30` to the CI job
- Use `nx affected` instead of `nx run-many` (only build changed projects)
- Enable Nx Cloud remote caching for CI
- Upgrade GitHub Actions runner (paid tier)

### ISSUE 4: Deploy Workflow Doesn't Start Caddy — MEDIUM

**Problem**: The `deploy-server.yml` workflow only pulls and starts `license-server`, not `caddy`. After a fresh deploy or if Caddy crashes, the API won't be publicly accessible.

**Fix**: Update the deploy step in `.github/workflows/deploy-server.yml`:

```yaml
script: |
  echo "${{ secrets.GHCR_PAT }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
  cd /opt/ptah-extension
  docker compose -f docker-compose.prod.yml pull license-server
  docker compose -f docker-compose.prod.yml up -d
  docker image prune -f
```

Change `up -d license-server` → `up -d` (starts all services including Caddy).

### ISSUE 5: ptah.live DNS Pointing to Droplet Instead of App Platform — DEFERRED

**Problem**: `ptah.live` A record points to the Droplet (167.71.9.106). Once App Platform is working, it should be a CNAME pointing to the App Platform URL.

**Fix** (after Issue 1 is resolved):

1. Get App Platform URL from DO dashboard
2. Update DO DNS: change `ptah.live` from A record to CNAME → App Platform URL
3. App Platform handles SSL automatically

---

## Security Validation Checklist

### Server Security

- [ ] Verify UFW rules: only ports 22, 80, 443 open (`ssh ptah-api "ufw status"`)
- [ ] Verify fail2ban is running (`ssh ptah-api "systemctl status fail2ban"`)
- [ ] Verify SSH root password auth is disabled (`ssh ptah-api "grep PasswordAuthentication /etc/ssh/sshd_config"`)
- [ ] Verify `.env.prod` permissions are 600 (`ssh ptah-api "ls -la /opt/ptah-extension/.env.prod"`)
- [ ] Verify no secrets in git history (`git log --all --diff-filter=A -- '*.env*' '.env*'`)
- [ ] Verify `.env.prod` is in `.gitignore`

### API Security

- [ ] Test CORS headers — only `https://ptah.live` should be allowed
- [ ] Test rate limiting on auth endpoints (`/api/auth/*`)
- [ ] Verify JWT secret is strong (64+ hex chars)
- [ ] Verify admin API key is not exposed in any public endpoint
- [ ] Test that Paddle webhook endpoint validates signatures
- [ ] Verify WorkOS redirect URI matches `https://api.ptah.live/api/auth/callback`
- [ ] Test HTTPS-only (HTTP should redirect to HTTPS via Caddy)
- [ ] Verify no sensitive headers are leaked (Server, X-Powered-By)

### Docker Security

- [ ] Verify license-server runs as non-root user (`docker exec ptah_license_server_prod whoami`)
- [ ] Verify PostgreSQL data is encrypted at rest (volume encryption)
- [ ] Verify Docker socket is not exposed
- [ ] Check for known CVEs in base images (`docker scout cves` or similar)
- [ ] Verify memory limits are set (256M postgres, 512M server, 64M caddy)

### SSL/TLS Security

- [ ] Verify TLS 1.2+ only (no TLS 1.0/1.1)
- [ ] Run SSL Labs test: https://www.ssllabs.com/ssltest/analyze.html?d=api.ptah.live
- [ ] Verify HSTS headers are present
- [ ] Verify certificate auto-renewal is working (Caddy handles this)

### Database Security

- [ ] Verify PostgreSQL is not exposed to public network (only Docker internal)
- [ ] Verify strong password (64+ hex chars)
- [ ] Verify connection via Unix socket or Docker network only
- [ ] Test that database backups are configured (or plan them)

---

## Performance Validation Checklist

### API Performance

- [ ] Test `/api/health` response time (should be <100ms)
- [ ] Test `/api/auth/login/email` response time under load
- [ ] Verify Caddy gzip compression is working (`curl -H "Accept-Encoding: gzip" -I https://api.ptah.live/api/health`)
- [ ] Check memory usage on Droplet (1GB RAM, should have headroom with swap)
- [ ] Verify swap is configured and active (`ssh ptah-api "free -h"`)

### Docker Performance

- [ ] Check container resource usage (`ssh ptah-api "docker stats --no-stream"`)
- [ ] Verify PostgreSQL connection pooling
- [ ] Check disk usage (`ssh ptah-api "df -h"`)
- [ ] Verify log rotation is configured (json-file driver with max-size)

### Landing Page Performance (after Issue 1 is fixed)

- [ ] Run Lighthouse audit on `https://ptah.live`
- [ ] Verify bundle size (currently 1.29MB, budget 1MB — over budget)
- [ ] Check CDN/caching headers from App Platform
- [ ] Test page load time from multiple regions

### CI/CD Performance

- [ ] Add `timeout-minutes` to all workflow jobs
- [ ] Consider `nx affected` instead of `nx run-many` for CI
- [ ] Enable Nx remote caching in CI

---

## Token/Key Expiration Tracking

| Token              | Expires                  | Action                                                          |
| ------------------ | ------------------------ | --------------------------------------------------------------- |
| DO API Token       | Custom (check dashboard) | Rotate before expiry, update `DIGITALOCEAN_ACCESS_TOKEN` secret |
| GHCR PAT           | ~Jun 10, 2026            | Regenerate, update `GHCR_PAT` secret                            |
| Paddle keys        | No expiry                | N/A                                                             |
| WorkOS keys        | No expiry                | N/A                                                             |
| Let's Encrypt cert | Auto-renewed by Caddy    | Monitor Caddy logs                                              |

---

## Quick Reference

```bash
# SSH into Droplet
ssh ptah-api

# Check all containers
ssh ptah-api "docker ps -a"

# View logs
ssh ptah-api "docker logs ptah_license_server_prod --tail=50"
ssh ptah-api "docker logs ptah_caddy --tail=50"
ssh ptah-api "docker logs ptah_postgres_prod --tail=50"

# Restart services
ssh ptah-api "cd /opt/ptah-extension && docker compose -f docker-compose.prod.yml restart"

# Check health
curl https://api.ptah.live/api/health

# Deploy server (push to release/server triggers CI/CD)
git checkout release/server && git merge main --no-edit && git push origin release/server

# Deploy landing (push to release/landing triggers CI/CD)
git checkout release/landing && git merge main --no-edit && git push origin release/landing
```

---

## DO App Platform Dashboard

- **App ID**: `7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3`
- **URL**: https://cloud.digitalocean.com/apps/7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3
- **Settings**: https://cloud.digitalocean.com/apps/7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3/settings
