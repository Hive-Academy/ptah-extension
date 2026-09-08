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

- `package.json` — `@nestjs/config`, `@nestjs/jwt` and `@workos-inc/node` moved
  from `devDependencies` to `dependencies`. All three are runtime imports:
  `main.cjs` `require()`s each one. `generatePackageJson` emits root
  `dependencies` only, so the misclassification is the sole reason they were
  absent from the generated manifest. Correlation checked across 13 packages
  with no exceptions. Lockfile regenerated with `npm install
--package-lock-only`; all three now carry `dev: false`.
- `apps/ptah-license-server/Dockerfile` — the `deps` stage now runs
  `npm ci --omit=dev` against the Nx-generated `package.json` +
  `package-lock.json`, then adds only `prisma`. The hand-maintained version list
  drops from eight packages to one, and the other 29 are versioned by the build.
  Verified by rebuilding: the generated manifest grew from 26 to 29 dependencies
  and now covers every external `require()` in the bundle, and running
  `npm ci --omit=dev` plus `prisma@7.7.0` against the new manifests in a
  `node:24-alpine` container resolves all 23 spot-checked packages with the CLI
  matching `@prisma/client` at 7.7.0. `CMD` left fail-closed on
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

Three of these are now filed:

| Task          | What                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| TASK_2026_393 | A `validate-deps` guard for `ptah-license-server`, plus the duplicate `marked` declaration |
| TASK_2026_394 | The CLI's undeclared `@cursor/sdk` and `@sentry/node` imports                              |
| TASK_2026_395 | Migrations as a deploy step instead of the container start command                         |

- **`@hive-academy/ptah-cli` has the same class of gap, unfixed** (TASK_2026_394). Scanning
  `dist/apps/ptah-cli/{main,tui}.mjs` with the electron `collectExternalImports`
  helper finds 37 external imports against 37 declared in
  `apps/ptah-cli/package.json` — but they are not the same 37. Three are
  imported and undeclared:
  - `@cursor/sdk` — `getCursorSdk()` in `cursor-cli.adapter.ts:160` does a bare
    `await import('@cursor/sdk')` with **no catch**. In root `dependencies`, so
    it resolves in this workspace and in Electron (whose `package.json` declares
    it), and fails only for a user who installed the CLI from npm and selected
    the Cursor adapter. The adjacent comment claims esbuild bundles it; the
    scan shows it is an external import, so the comment is wrong.
  - `@sentry/node` — `require()`d in `sentry.service.ts`, reached whenever a DSN
    is configured. Same shape: declared at the root, not by the CLI package.
  - `keytar` — **not a defect.** `cli-master-key-provider.ts:159` guards it with
    `.catch(() => null)` and it is a documented optional capability. Correctly
    absent from every manifest.

  The CLI is a different release train (`publish-cli.yml`) and was deliberately
  left out of this task.

- **`ptah-license-server` has no dependency guard** (TASK_2026_393).
  `ptah-electron` runs `validate-deps`, which scans its built bundle for
  external imports and fails when one is not declared — that is precisely why
  this bug landed on the license server and not on Electron. An equivalent
  target here would stop the next misfiled dependency from reaching production.

- **`marked` is declared in both `dependencies` and `devDependencies`** in the
  root `package.json` (lines 170 and 262). Pre-existing and harmless today —
  npm takes the `dependencies` entry — but it is the same classification
  sloppiness that caused this outage. Folded into TASK_2026_393.

- **The container start command still couples migrations to boot**
  (TASK_2026_395). `prisma migrate deploy && node main.cjs` is why a CLI that
  could not parse its own command stopped the server from running at all. It is
  also the only reason the image still hand-pins a package: `prisma` is never
  imported by the bundle, so `generatePackageJson` can never emit it no matter
  how it is classified.
- No alert routing beyond a GitHub issue (no email, Slack or pager). The issue
  is the notification surface for now.
- Sentry's blind spot before app bootstrap is unaddressed and unaddressable
  from `instrument.ts`; container-level crash-loop detection would be the fix.
