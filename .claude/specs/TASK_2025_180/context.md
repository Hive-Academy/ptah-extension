# TASK_2025_180: DevOps Infrastructure Hardening & CI/CD Pipelines

## Task Type: DEVOPS

## Complexity: Complex

## Workflow: Partial (Architect -> Team-Leader -> DevOps Engineers)

## User Request

Implement all DevOps recommendations from the deployment infrastructure assessment:

1. **Replace nginx+certbot with Caddy** - Saves 1 container, simplifies SSL with auto-HTTPS
2. **CI/CD Pipelines with release branches**:
   - `release/server` branch triggers license server deployment (GHCR-based)
   - `release/extension` branch triggers VS Code extension publishing
   - Add tests + typecheck to existing CI
3. **Docker hardening** - Log rotation config, container memory limits for all services
4. **Documentation updates**:
   - SSH hardening guide
   - Swap space as mandatory setup step
   - Reconcile Neon vs self-hosted PostgreSQL in PRODUCTION_DEPLOYMENT.md
   - `.env.prod` file permissions
   - Secret rotation strategy
5. **Health check endpoint** - Validates DB connectivity (not just HTTP 200)

## Key Constraints

- $6/month droplet (1GB RAM) - every MB counts
- Self-hosted PostgreSQL on same droplet
- Must not break existing docker-compose.prod.yml contract
- Release branches: release/server, release/extension
- GHCR for Docker images (free, native GitHub integration)

## Affected Files (Estimated)

- `.github/workflows/ci.yml` - Add tests + typecheck
- `.github/workflows/deploy-server.yml` - NEW: GHCR + droplet deploy
- `.github/workflows/publish-extension.yml` - NEW: vsce publishing
- `docker-compose.prod.yml` - Replace nginx+certbot with Caddy, add memory limits
- `caddy/Caddyfile` - NEW: Caddy reverse proxy config
- `apps/ptah-license-server/src/` - Health check endpoint with DB validation
- `docs/deployment/DIGITALOCEAN.md` - SSH hardening, swap, .env permissions, log rotation
- `docs/deployment/PRODUCTION_DEPLOYMENT.md` - Remove Neon references, add secret rotation
- `nginx/` - DELETE (replaced by Caddy)

## Strategy

Skip PM (requirements clear from assessment). Architect -> Team-Leader -> DevOps Engineer batches.
