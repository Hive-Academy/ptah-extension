# License Server Docker lane — TASK_2026_499

Branch: `chore/task-498-dependency-migration`
Files changed: `apps/ptah-license-server/Dockerfile` (3 fixes),
`docker-compose.yml` (comment), root `package.json` (script `docker:up` only).
Date of verification: 2026-09-21.

Summary of findings:

- Dev container: stale image reused by `docker compose up -d` — the user's
  hypothesis, confirmed. Fixed by rebuilding + `--build` in `docker:up`.
- Production path: three defects found by actually building and booting the
  image — stale `prisma@7.7.0` pin, a dropped `@sentry/nestjs` override that
  broke stage-2 `npm ci`, and a missing `@nestjs/platform-express` that made
  the image unable to serve. All three fixed in the Dockerfile; the image now
  builds, boots, and answers `/api/health`.
- `prune` targets: fail for a pre-existing reason (missing project
  `package.json`), unrelated to the migration; fix described, out of scope.

## Root cause

**The user's hypothesis was right.** The container's `node_modules` held the
pre-migration dependency tree: TypeScript **5.9.3** and Prisma **7.7.0**, while
the host has TypeScript 6.0.3 and Prisma 7.10.0 (root lockfile pins).
`"ignoreDeprecations": "6.0"` is legal only for TypeScript 6, so the container's
TS 5.9.3 build died with `error TS5103` on `@ptah-extension/shared:build`.

Evidence that decides the mechanism (of the three candidates — cached `npm ci`
layer, named volume, bind mount shadowing — it is the first one's coarse
parent: **a stale image that `docker compose up -d` reused without rebuilding**):

1. `docker inspect ptah_license_server --format '{{json .Mounts}}'` — the mount
   list contains only source/config bind mounts (`src`, `libs`, `prisma`,
   `tsconfig*.json`, `project.json`, `tsconfig.base.json`). **No** named volume
   and **no** bind mount touches `/app/node_modules`. So the container's
   modules come from image layers, full stop.
2. The running container's image is `ptah-extension-license-server:latest`
   (id `9c9d6e3d8da7`), built **2026-08-02** — seven weeks before the branch's
   migration commits. `package-lock.json` was last changed on the branch on
   2026-09-21 (`d85b96be2`). The image predates every migration change.
3. `docker compose up -d` builds only when the image is absent. The image was
   present, so compose silently reused it. The container was created today
   (`Created: 2026-09-21T10:23:43Z`) **from the August image** — a fresh
   container with a stale filesystem.

Direct version read from inside the running (broken) container:

```
$ docker exec ptah_license_server sh -c "node -p \
    \"require('/app/node_modules/typescript/package.json').version + ' / prisma ' + \
    require('/app/node_modules/prisma/package.json').version\""
5.9.3 / prisma 7.7.0          # container, before fix
```

```
$ node -p "require('./node_modules/typescript/package.json').version"
6.0.3                         # host, from the same repo and lockfile
```

The "Generated Prisma Client (7.7.0)" line in the container logs is the same
fact from a second angle: the image's `prisma` CLI was 7.7.0, so it emitted a
7.7.0 client. It is not a schema or config problem — the schema's
`moduleFormat = "cjs"` pin is honored by 7.10.0 as well (verified below).

## Fix

The dev-container fix, at the right layer, plus hardening; the three separate
production-image fixes live in the `docker production` section below:

1. **Rebuilt the dev image** — `docker compose build license-server`. The
   `COPY package.json package-lock.json ./` layer content changed with the
   migrated lockfile, so BuildKit correctly invalidated the cached `npm ci`
   layer and installed the migrated tree (TS 6.0.3 / Prisma 7.10.0). The
   image's own build log then shows
   `✔ Generated Prisma Client (7.10.0) to ./../../libs/api/core/src/lib/generated-prisma-client`.
2. **Made the failure mode impossible via the repo's entry script** — root
   `package.json` `docker:up` is now
   `docker compose --profile webhook-testing up -d --build`. Without `--build`,
   `docker compose up -d` never rebuilds an existing image, and this exact
   stale-image failure recurs after every dependency migration. With BuildKit
   layer caching the rebuild is incremental: unchanged layers are cache hits.
3. Updated the QUICK START comment in `docker-compose.yml` to match
   (`docker compose up -d --build`).

Not changed, deliberately: `Dockerfile.dev` is correct as written — it copies
the lockfile, runs `npm ci`, installs the Linux esbuild binary at the version
the lockfile resolves, and generates the client with the CLI the lockfile pins.
Its only problem was that nobody had rebuilt it since 2026-08-02.

## serve

**Verdict: correct.** Two independent proofs.

Container proof — the dev compose service literally runs
`npx nx serve ptah-license-server` as its command. After the image rebuild:

```
$ docker ps --filter name=ptah_license_server --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
NAMES                 STATUS                   PORTS
ptah_license_server   Up 2 minutes (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
```

```
$ docker logs ptah_license_server | tail
[PrismaService]  Prisma $connect() successful
[PrismaService]  Testing Prisma model query (user.count)...
[PrismaService]  Database connection verified. User count: 2
[NestApplication]  Nest application successfully started
[Webhook]  Application is running on: http://localhost:3000/api
```

Host proof — served on the host itself against the same postgres, port 3100:

```
$ PORT=3100 npx nx serve ptah-license-server
$ curl http://localhost:3100/api/health
{"status":"ok","timestamp":"2026-09-21T10:38:20.600Z","database":"connected"}
```

(HTTP 200 after ~20 s; process stopped after the probe.)

## build

**Verdict: correct.**

```
$ npx nx build ptah-license-server --configuration=production
NX   Successfully ran target build for project ptah-license-server and 1 task it depends on
Run duration: 13.3s   [exited with code 0]
```

Output artifacts in `dist/apps/ptah-license-server/`: `main.js` (1.14 MB, ESM —
the banner leads with `import { createRequire } from 'node:module'` per
`project.json` `esbuildOptions.banner`), plus the generated deploy pair.
No `main.cjs` is produced, and nothing in the packaging surfaces still assumes
one: a sweep of `Dockerfile`, `Dockerfile.dev`, both compose files, root
`package.json` scripts, `apps/ptah-license-server/project.json` and
`.github/workflows/deploy-server.yml` finds `main.cjs` only inside three
historical comments in the production Dockerfile; the only executable
reference is the CMD's `node main.js`. The generated manifest is consistent
with that:

```
$ node -e "const p=require('./dist/apps/ptah-license-server/package.json'); console.log(p.type, p.main, p.dependencies['@prisma/client'])"
module ./main.js 7.10.0
```

## docker production

**Verdict: correct after three fixes in the Dockerfile. Before them, the
production image could not even boot its app.**

The full image was built (`docker build -f apps/ptah-license-server/Dockerfile
-t ptah-license-server:branch-verify .`) and then run as a real container
against the dev postgres — every fix below is backed by a measured before/after
from that container, not by inspection alone.

Audit trail of what the production path consumes, item by item:

- **Artifact**: `Dockerfile` stage 3 copies `dist/apps/ptah-license-server`
  and runs `node main.js`; manifest ships `"type": "module"`,
  `"main": "./main.js"`. Consistent with the ESM bundle, and the ESM bundle
  boots under Node (the run below started NestJS from `main.js` without an
  ESM/CJS error). **Correct.**
- **Prisma client format in the image**: the builder runs
  `npx prisma generate` with the CLI the migrated lockfile installs (7.10.0),
  against `prisma/schema.prisma`, which pins `moduleFormat = "cjs"`. Verified
  empirically twice: (a) the image build log printed
  `Generated Prisma Client (7.10.0)`; (b) after the dev container's own
  `npx prisma generate` (which writes into the bind-mounted host
  `libs/api/core/src/lib/generated-prisma-client/`), the emitted files contain
  no `import.meta` ESM preamble — the 7.10 behavior the pin exists to prevent.
  The esbuild bundle then inlines that client (the app imports it via relative
  path `../generated-prisma-client/client`, not as an external), and the ESM
  banner supplies `__dirname` for it. **Correct.**
- **Fix 1 — Prisma CLI pin**: the Dockerfile installed `prisma@7.7.0` alongside
  a generated manifest whose `@prisma/client` is now **7.10.0**, violating its
  own "CLI must stay equal to the client" rule (that exact split caused the
  2026-09-04 outage). Updated the pin to `prisma@7.10.0` to match the generated
  manifest on this branch.
- **Fix 2 — `npm ci` in stage 2 was broken on this branch.** Root
  `package.json` carries
  `"overrides": { "@sentry/nestjs": { "@nestjs/common": "$@nestjs/common", "@nestjs/core": "$@nestjs/core" } }`
  because `@sentry/nestjs@10.75.0` declares peers
  `@nestjs/common@^8 || ^9 || ^10 || ^11` (measured from the lockfile) while
  the server runs NestJS 12. Nx's `createPackageJson` drops any root override
  whose key is also a direct dependency of the generated manifest (npm
  EOVERRIDE caution; `node_modules/nx/dist/src/plugins/js/package-json/create-package-json.js`,
  the `skipOverrides` region), and `@sentry/nestjs` is a direct dependency
  because `project.json` keeps it external. The emitted manifest therefore
  ships without the override, and stage 2's `npm ci` fails:

```
$ cd <temp> && cp dist/apps/ptah-license-server/package.{json,-lock.json} . && npm ci --omit=dev --ignore-scripts
npm error ERESOLVE: While resolving: @sentry/nestjs@10.75.0
npm error Found: @nestjs/common@12.0.3
npm error @sentry/nestjs@10.75.0 from the root project
```

**Fix applied**: stage 2 re-injects the exact root override into the copied
manifest with a one-line `node -e` before `npm ci`. Verified end-to-end in a
clean folder with the emitted pair — `npm ci --omit=dev --ignore-scripts`
then exits 0 (`found 0 vulnerabilities`), and the installed tree carries
`@sentry/nestjs 10.75.0`, `@nestjs/common 12.0.3`, `@prisma/client 7.10.0`.
The `node -e` quoting was also proven verbatim inside `node:24-alpine`
(`sh -c`), since the RUN runs under Alpine ash.

- **Fix 3 — `@nestjs/platform-express` missing from the image.** Found by
  running the built image: the app completed its startup path and then died
  with `No driver (HTTP) has been selected. In order to use the default
driver, please, install the "@nestjs/platform-express" package`.
  `NestFactory.create` selects the HTTP driver by dynamic peer resolution, so
  no source file imports platform-express and `generatePackageJson` cannot emit
  it — the emitted manifest carries `express` (28 deps, platform-express not
  among them) but not the driver that wraps it. **Fix applied**: added
  `@nestjs/platform-express@12.0.3` (exact, equal to the manifest's
  `@nestjs/core 12.0.3`) to the existing `npm install --no-save` line, which
  is this Dockerfile's own established mechanism for runtime packages the
  generated manifest cannot carry. After the fix the same image boots fully.
- **`docker-compose.prod.yml`**: unchanged and consistent — health check on
  `/api/health`, `depends_on: service_healthy` for caddy, image built from
  `apps/ptah-license-server/Dockerfile`. No CJS assumptions. **Correct.**

One observation, not a defect: the verification run passed the repo-root dev
`.env`, which sets `NODE_ENV=development`, so the log printed
`Environment: development` even inside the production image. The image itself
declares `ENV NODE_ENV=production`; the real deployment injects `.env.prod`
via `env_file`. Injected environment wins over the image ENV, which is the
intended precedence.

## Pruned lockfile

**Verdict: `nx run ptah-license-server:prune` FAILS on this branch — and on
`main` as well, for a reason unrelated to the migration.** The nested-manifest
defect that broke the sibling app does **not** apply here.

- **The sibling defect does not exist here.** Every nested manifest in the
  license server's dependency surface — `libs/api/*/package.json` (15 files)
  and `libs/api-contracts/community/package.json` — was compared against the
  root lockfile. All are metadata-only (`name`, `version`, `private`,
  `sideEffects`), with **zero** `dependencies`/`devDependencies`/`peerDependencies`.
  There is nothing to drift against the root. `apps/ptah-license-server/` has
  no nested `package.json` at all.
- **Why prune fails anyway.** Both `@nx/js:prune-lockfile` and
  `@nx/js:copy-workspace-modules` begin by reading
  `<project root>/package.json` — `node_modules/@nx/js/dist/src/executors/prune-lockfile/prune-lockfile.js:115`
  (`join(workspaceRoot, project.root, 'package.json')`, hard-coded, no option
  to point elsewhere). `apps/ptah-license-server/package.json` does not exist
  and never has (`git log --all -- apps/ptah-license-server/package.json` is
  empty; `git show origin/main:...` says the path never existed). So both
  executors abort:

```
$ npx nx run ptah-license-server:prune
Pruning lockfile...
NX   D:\projects\ptah-extension\apps\ptah-license-server\package.json does not exist.
Failed tasks:
- ptah-license-server:prune-lockfile
- ptah-license-server:copy-workspace-modules
```

- **The production image does not depend on the prune targets.** The
  production Dockerfile consumes the **build's** `generatePackageJson` output
  (`dist/apps/ptah-license-server/package.json` + `package-lock.json`), which
  the host build emits and which `npm ci` accepts (proven above, with the
  override re-injection). The prune path is currently dead weight for this
  app. The app `CLAUDE.md` still documents prune as the Docker deploy
  mechanism, which is stale.
- **Out-of-scope fix, described, not applied**: either (a) create
  `apps/ptah-license-server/package.json` carrying the runtime dependency set
  (both executors then work, and Nx overwrites the dist manifest with it on
  prune — the dependency list must then be maintained by hand, mirroring the
  `external` list in `project.json`), or (b) delete the three prune targets
  from `project.json` and fix the app `CLAUDE.md`, since the Dockerfile's
  deploy path does not use them. Option (b) is smaller and matches what the
  Dockerfile actually consumes; option (a) is required only if standalone
  `prune` output is wanted for non-Docker deploys. Both touch files outside
  the allowed scope for this lane, so neither was applied.

## Verification

Rebuild and restart:

```
$ docker compose build license-server
#18 [12/14] RUN cd apps/ptah-license-server && npx prisma generate
#18  ✔ Generated Prisma Client (7.10.0) to ./../../libs/api/core/src/lib/generated-prisma-client in 385ms
#21 naming to docker.io/library/ptah-extension-license-server:latest done

$ docker compose up -d license-server
 Container ptah_postgres Healthy
 Container ptah_license_server Started

$ docker ps --filter name=ptah_license_server --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
NAMES                 STATUS                   PORTS
ptah_license_server   Up 2 minutes (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
```

Versions inside the fixed container:

```
$ docker exec ptah_license_server sh -c "node -p \"require('/app/node_modules/typescript/package.json').version + ' / prisma ' + require('/app/node_modules/prisma/package.json').version\""
6.0.3 / prisma 7.10.0
```

Logs — no TS5103, no failed tasks; startup sequence and listener:

```
$ docker logs ptah_license_server | grep -E "migrations|Generated Prisma|successfully started|running on"
Running database migrations...
23 migrations found in prisma/migrations
No pending migrations to apply.
✔ Generated Prisma Client (7.10.0) to ./../../libs/api/core/src/lib/generated-prisma-client in 426ms
[NestApplication]  Nest application successfully started
[Webhook]  Application is running on: http://localhost:3000/api
[Webhook]  Webhook endpoint available at: http://localhost:3000/webhooks/paddle
```

Real HTTP request against the running container:

```
$ curl -s --max-time 10 http://localhost:3000/api/health
{"status":"ok","timestamp":"2026-09-21T10:44:25.132Z","database":"connected"}
```

Production build (host):

```
$ npx nx build ptah-license-server --configuration=production
NX   Successfully ran target build for project ptah-license-server and 1 task it depends on
Run duration: 13.3s      [exit code 0]
# dist/apps/ptah-license-server/: main.js (1,137,919 B), package.json, package-lock.json
```

Stage-2 replication (the exact commands the production image runs over the
exact emitted pair) — see the `docker production` section for the full
transcript: `npm ci --omit=dev --ignore-scripts` **failed without** the
override re-injection (ERESOLVE) and **succeeded with** it (`found 0
vulnerabilities`, exit 0), followed by a clean
`npm install --no-save prisma@7.10.0`.

Production image build and boot (the exact commands the deploy pipeline runs,
plus a real run of the resulting image against the dev postgres):

```
$ docker build -f apps/ptah-license-server/Dockerfile -t ptah-license-server:branch-verify .
#20 [deps 8/8] RUN npm install --omit=dev --no-save --ignore-scripts prisma@7.10.0 @nestjs/platform-express@12.0.3
#20  added 132 packages, and audited 330 packages in 25s
#26 naming to docker.io/library/ptah-license-server:branch-verify done
[exit code 0]

$ docker run -d --name ptah_license_server_prod_verify --network ptah_network \
    -p 3100:3000 --env-file .env \
    -e DATABASE_URL="postgresql://ptah:ptah_dev_password@postgres:5432/ptah_db" \
    ptah-license-server:branch-verify
$ docker ps --filter name=ptah_license_server_prod_verify --format '{{.Status}}'
Up 10 seconds (healthy)

$ curl -s http://localhost:3100/api/health
{"status":"ok","timestamp":"2026-09-21T11:16:30.449Z","database":"connected"}

$ docker logs ptah_license_server_prod_verify | grep -E "migrations|successfully started|running on"
23 migrations found in prisma/migrations
No pending migrations to apply.
[NestApplication]  Nest application successfully started
[Webhook]  Application is running on: http://localhost:3000/api
```

Before the two stage-2 fixes, the same run failed with measured errors:
without the override re-injection the image build failed at stage 2's
`npm ci` (ERESOLVE, transcript above); with it but without
`@nestjs/platform-express`, the container started, printed `No driver (HTTP)
has been selected`, and never became healthy. The verify container was removed
after the test; the dev container above remains running and healthy.

## Still broken

1. **`ptah-license-server:prune` / `prune-lockfile` / `copy-workspace-modules`
   remain non-functional.** Both executors require
   `apps/ptah-license-server/package.json`, which this app does not have and
   never had. The fix (create that manifest, or delete the targets and correct
   the app `CLAUDE.md`) is outside this lane's allowed scope, so it was
   described above and not applied. This does not affect the Docker production
   path, which consumes the build's generated pair, not the prune output.
2. Not this lane's defect, noted for the record: the working tree contains
   modifications to `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`
   and `.claude/skills/typesafe-ai/*` that predate this lane's work and were
   not touched by it.

Everything else rests on the pasted evidence above: the dev container is
**healthy** (not merely `Up`), answers a real HTTP request with
`database: connected`, its logs show the migrations applied and the server
listening on port 3000 — and the **production image built from the fixed
Dockerfile boots to healthy and answers the same request**, with the Prisma
7.10.0 client generated in `cjs` format and the ESM `main.js` bundle running
under Node.
