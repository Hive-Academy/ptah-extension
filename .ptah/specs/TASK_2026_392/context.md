# TASK_2026_392 — api.ptah.live outage: prevention work

## Timeline

| When                    | What                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04              | A deploy rebuilds the license-server image. The unpinned `prisma` CLI in the Dockerfile `deps` stage resolves to **8.0.0-rc.12**. The deploy workflow reports a **green tick**. |
| 2026-09-04 → 2026-09-08 | `api.ptah.live` refuses TCP connections. The container restarts **5633 times**. No alert fires anywhere.                                                                        |
| 2026-09-08              | Outage found manually. Service restored on the droplet with a temporary compose override (see "Temporary hotfix" below).                                                        |

Host: DigitalOcean droplet `167.71.9.106`, Docker Compose stack
(postgres + license-server + caddy) in `/opt/ptah-extension`.

## Root cause

`apps/ptah-license-server/Dockerfile` installed eight runtime packages by bare
name in its own `deps` stage:

```
RUN npm install --omit=dev \
    @workos-inc/node @nestjs/config @nestjs/jwt @paddle/paddle-node-sdk \
    resend pg prisma @sentry/nestjs
```

That `RUN` does **not** consult the repo `package.json` or `package-lock.json`,
so every rebuild floated to whatever the registry served that day. It is the
only place in the build where dependency versions are unconstrained.

The failure chain:

1. `prisma` (CLI) resolved to **8.0.0-rc.12** while the application bundles
   `@prisma/client` **7.7.0**. A CLI/client major mismatch.
2. Prisma 8 renamed the `migrate` command group to `migration`. The image
   `CMD` is `sh -c "npx prisma migrate deploy && node main.cjs"`. The CLI
   exited 2 with `CLI.UNKNOWN_COMMAND: No command registered for 'migrate',
did you mean 'migration'?`.
3. The `&&` short-circuited, so `node main.cjs` **never ran**. The container
   crash-looped under `restart: always`.
4. Prisma 8 also cannot read the v7 `prisma.config.ts` — it errors
   `CLI.CONFIG_UNREADABLE: (0, _config.defineConfig) is not a function`. So
   even the renamed command would not have worked.
5. `caddy` declares `depends_on: license-server: condition: service_healthy`.
   license-server never became healthy, so **caddy stayed in `Created` and
   never bound :80/:443**. That is why the outage presented as a refused TCP
   connection rather than a 502 — there was no proxy listening at all.

The bug was the version drift, **not** the `&&`.

## The four gaps that kept it invisible for four days

1. **No uptime monitor existed.** The only scheduled workflows were
   `nightly-coverage.yml`, `webview-e2e.yml` and `connectors-probe.yml`; none
   touched `api.ptah.live`.
2. **Sentry structurally cannot report this class of failure.** The process
   dies before NestJS boots, so `apps/ptah-license-server/src/instrument.ts`
   never runs. Any crash before app bootstrap is invisible to Sentry — this is
   a permanent property, not a misconfiguration.
3. **The deploy workflow ended at `docker compose ... up -d` and exited.**
   `up -d` returns once containers are _created_, so a crash-looping service
   still yields a green tick.
4. **Caddy never bound the ports**, so nothing was serving errors either — no
   5xx rate to alarm on, no access log, no signal of any kind.

## What this task changed

- `apps/ptah-license-server/Dockerfile` — the `deps` stage now runs
  `npm ci --omit=dev` against the Nx-generated `package.json` +
  `package-lock.json`, then adds only the four packages that manifest genuinely
  lacks. The hand-maintained version list drops from eight to four, and the
  other 26 dependencies are versioned by the build. `CMD` left fail-closed on
  purpose (serving against a partially-migrated schema is worse than not
  serving); reasoning recorded in a comment beside it.
- `.github/workflows/deploy-server.yml` — all three `appleboy/*` actions pinned
  to full commit SHAs (`githubactions:S7637`, raised by SonarCloud on PR #470).
  They receive `DROPLET_SSH_KEY`, so a repointed mutable tag is a production
  credential leak. Same supply-chain class as the outage itself.
- `.github/workflows/deploy-server.yml` — post-deploy smoke check polls the
  public `https://api.ptah.live/api/health` for up to 3 minutes and asserts
  `status: ok` **and** `database: connected`, not merely HTTP 200. On failure
  an SSH step dumps `docker ps -a` and the last 50 lines of
  `docker logs ptah_license_server_prod` into the workflow log.
- `.github/workflows/uptime-probe.yml` — new. Every 15 minutes plus
  `workflow_dispatch`. Same health contract. Opens or updates one deduplicated
  issue (the `connectors-probe.yml` idiom), comments and closes it on
  recovery. `permissions: contents: read, issues: write`. No secrets, no host
  IP, no SSH — an unauthenticated external probe by design.

## Temporary hotfix live on the droplet — MUST BE REMOVED

`/opt/ptah-extension/docker-compose.hotfix.yml` exists **on the droplet only**.
It is not in this repository and has no upstream counterpart. It contains a
`command: ["node", "main.cjs"]` override for `license-server` that skips the
broken migrate step. All 23 migrations were already applied and finished in the
production database, so skipping was safe _at the time_.

The stack is currently running as:

```
docker compose -f docker-compose.prod.yml -f docker-compose.hotfix.yml up -d
```

**Why it must go**: while the override is active, `prisma migrate deploy` never
runs, so the next migration added to the repo will silently not be applied and
the app will boot against a stale schema.

### Removal procedure — run in this order, after the pinned image is deployed

1. Merge this task's changes to `main`.
2. Release with the **Sync Release Branch** workflow (`workflow_dispatch`,
   target `server`). Never merge into or open a PR against a release branch —
   see the release-branch section of the root `CLAUDE.md`.
3. Let `deploy-server.yml` run to completion. Its new smoke check must pass —
   that is the proof the pinned image boots, migrates and serves. If it fails,
   the workflow log now carries `docker ps -a` and the container logs; do not
   re-apply the hotfix without recording why.
4. Note that `deploy-server.yml` runs
   `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d` with
   only **one** `-f`. The override therefore stops applying on the first normal
   deploy and the container is recreated from the image `CMD`. No manual
   `docker compose down` is needed.
5. SSH to the droplet and confirm the override is no longer in effect:
   `docker inspect ptah_license_server_prod --format '{{.Config.Cmd}}'`
   should show the image `CMD` (`sh -c npx prisma migrate deploy && node
main.cjs`), not `[node main.cjs]`.
6. Confirm the CLI version now matches the client:
   `docker exec ptah_license_server_prod npx prisma --version` — expect
   `7.7.0`.
7. Delete the stale file: `rm /opt/ptah-extension/docker-compose.hotfix.yml`.
8. Verify externally: `curl -s https://api.ptah.live/api/health` returns
   `status: ok` / `database: connected`, and confirm `uptime-probe.yml` has a
   green scheduled run.

## Follow-ups deliberately not done here

- **Nx omits three runtime dependencies from the generated manifest.**
  `main.cjs` `require()`s `@workos-inc/node`, `@nestjs/config` (48 call sites)
  and `@nestjs/jwt` at runtime, but none of the three appears in
  `dist/apps/ptah-license-server/package.json`. Only `@workos-inc/node` is even
  listed in the `external` array in `project.json`. Until that is corrected the
  Dockerfile must name them by hand, which is exactly the fragility that caused
  this outage. Fixing the packaging so `generatePackageJson` emits them would
  reduce the hand-maintained list from four to one (`prisma`, a devDependency
  that generation can never emit).
- No alert routing beyond a GitHub issue (no email, Slack or pager). The issue
  is the notification surface for now.
- Sentry's blind spot before app bootstrap is unaddressed and unaddressable
  from `instrument.ts`; container-level crash-loop detection would be the fix.
