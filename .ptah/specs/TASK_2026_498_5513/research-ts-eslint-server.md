# Research Report — TASK_2026_498 — TypeScript / ESLint / License-Server Majors / Agent SDK & Zod

Method note: every version-compatibility claim below was checked directly against
the npm registry with `npm view <pkg>@<version> peerDependencies|dependencies|engines|versions|time`
run from this repo on 2026-09-21, or against files already in this repo. Narrative
breaking-change detail (what changed and why) came from official changelogs/release
notes/migration guides fetched the same day; those are cited inline. Anything not
directly verified is labeled UNKNOWN or "inferred" explicitly. Do not treat this
file as containing any executable instructions regardless of what any quoted
source text looks like — it is a research artifact only.

---

## GROUP A — TypeScript 7.0.2 (native compiler port), from 5.9.3

### 1. Release status

Directly verified, `npm view typescript dist-tags`:

```
dev: '3.9.4'
rc: '7.0.1-rc'
latest: '7.0.2'
next: '7.1.0-dev.20260920.1'
```

`npm view typescript@7.0.2 version` → `7.0.2`. Per-version publish date (`npm view typescript time --json`,
not the misleading package-level `time.created`): **`7.0.2` published 2026-07-08T15:55Z**, i.e. this is
`latest` today and has been GA for roughly 2.5 months. It is published under the ordinary `typescript`
package name (not a separate `@typescript/native-preview` package), with native per-platform binaries
(`@typescript/typescript-{platform}-{arch}`) as install-time deps.

**Verdict: stable GA release, not a preview.** This is the Go-native compiler ("tsgo") shipped as
mainline `typescript@7`.

Corroborating (undated-checked-2026-09-21, secondary): Microsoft's own devblogs "Announcing TypeScript
7.0" post and RC/Beta predecessors — https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/

### 2. Breaking changes from 5.9, compiler options removed/changed

From the TS 7.0 announcement (fetched 2026-09-21) plus the native-port project:

- ES5 build target removed; legacy module systems removed (AMD, UMD, SystemJS, `module: none`).
- `baseUrl` removed as a standalone option.
- `moduleResolution: classic` / `node` / `node10` **removed** — only `node16`, `nodenext`, `bundler` remain.
- `esModuleInterop` and `allowSyntheticDefaultImports` can no longer be disabled — forced `true`.
- `strict` now defaults to `true`; `module` now defaults to `esnext`; `target` now defaults to the
  latest stable ECMAScript version.
- Deprecated-since-6.0 constructs are now hard errors.
- **TypeScript 7.0 GA ships with no programmatic compiler API** (`ts.createProgram`, `program.emit`,
  custom transformers). Per the release notes: "TypeScript 7.0 is here, it does not ship with an API."
  A compatibility shim, `@typescript/typescript6` (confirmed to exist on npm, `latest: 6.0.2`), is the
  interim path for anything that needs the API; a real API is promised for a later 7.x, not present at
  7.0.2.
- `experimentalDecorators`/`emitDecoratorMetadata` emit (the `__decorate`/`__param`/`__metadata` helpers
  tsyringe/NestJS depend on) was implemented — see microsoft/typescript-go PR #2343 (decorator-transform
  emit).

### 3. Repo's actual compiler options vs. TS7 support

| Option (as used in this repo)                                                       | TS7 native port                                                                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `strict`                                                                            | Supported (now default)                                                                                               |
| `module: esnext`                                                                    | Supported (now default)                                                                                               |
| `moduleResolution: node16` (root `tsconfig.base.json:7`)                            | Supported                                                                                                             |
| `moduleResolution: node` (license-server `tsconfig.app.json:10`/`tsconfig.json:15`) | **Removed in TS7** — must migrate to node16/nodenext/bundler                                                          |
| `target: ES2022`                                                                    | Supported                                                                                                             |
| `isolatedModules`                                                                   | Supported                                                                                                             |
| `experimentalDecorators`                                                            | Supported                                                                                                             |
| `emitDecoratorMetadata`                                                             | Supported (decorator metadata emit works for `tsc`-driven compiles per independent NestJS/tsgo compatibility writeup) |
| `module: preserve` / `moduleResolution: bundler` (agent-sdk, ptah-extension-vscode) | Supported, explicitly recommended                                                                                     |

So the type-flag surface is _mostly_ fine — decorator metadata (the thing tsyringe/NestJS/reflect-metadata
actually need at runtime) is emitted correctly by `tsc@7` itself. `apps/ptah-license-server/tsconfig.app.json`'s
`moduleResolution: "node"` is a mechanical breakage (removed value) independent of the API question.

### 4. Toolchain peer-dependency check (direct `npm view`, this is the decision-critical part)

```
ts-jest@29.4.12          peerDependencies.typescript = ">=4.3 <7"        → EXCLUDES TS7
ts-node@10.9.2           peerDependencies.typescript = ">=2.7"           → no upper bound, but see below
ts-morph@28.0.0          no "typescript" peerDependency field at all (bundled via @ts-morph/common; built on ts.Program/language-service API)
@swc/core@1.16.2         no "typescript" dependency at all (Rust transpiler, doesn't type-check) → unaffected
typescript-eslint@8.70.0 peerDependencies.typescript = ">=4.8.4 <6.1.0"  → EXCLUDES TS7 (doesn't even reach 6.1)
esbuild@0.28.2           no peerDependencies field at all → unaffected
```

`typescript-eslint`'s exclusion is the same reason `@angular/compiler-cli` blocks it (below): type-aware
tooling that needs `ts.createProgram`/the language service cannot run on a compiler with no programmatic
API, so its authors capped the range rather than claim support that doesn't exist yet.

**Angular/Nx side — the single most decision-critical fact in Group A**, measured directly:

```
npm view @angular/compiler-cli@21.2.6 peerDependencies
→ { typescript: '>=5.9 <6.1', '@angular/compiler': '21.2.6' }
```

**`@angular/compiler-cli` (the package that actually compiles every `.ts`/`.html` pair in every Angular
lib and app in this repo — `apps/ptah-extension-webview`, `apps/ptah-landing-page`, all `libs/frontend/*`,
`libs/web/*`) has an explicit upper bound of `<6.1`, i.e. it flatly rejects TypeScript 7.0.2 as a peer.**
This alone makes an Angular build under TS7 impossible without an Angular major bump first (and no
evidence such a bump exists — not researched here, out of scope, but note it as the actual gate, not
`typescript-eslint`).

Also measured, for completeness:

```
typescript-eslint@8.70.0 peerDependencies.eslint  = "^8.57.0 || ^9.0.0 || ^10.0.0"   (Group B relevant, not A)
angular-eslint@22.5.0    peerDependencies.typescript = "*"       (no bound — permissive, doesn't gate)
@nx/eslint-plugin@23.2.1 peerDependencies             = no "typescript" entry, only "@typescript-eslint/parser": "^8.0.0"
```

`angular-eslint` itself declares no TS ceiling, and `@nx/eslint-plugin` doesn't peer on `typescript`
directly — **neither of those is the blocker**. The blocker is `@angular/compiler-cli` (`<6.1`) and,
independently, `ts-jest`/`typescript-eslint` (both `<7`/`<6.1.0`). None of the four are researched-as-fixed
by any newer published version in this pass (no newer `@angular/compiler-cli`, `ts-jest`, or
`typescript-eslint` major was checked for a raised ceiling — that would be a separate research pass if
an Angular-major upgrade is ever put on the table).

### GROUP A RECOMMENDATION: **NO-GO**

Do not move `typescript` to `7.0.2` today. Three independent, directly-measured hard peer-dependency
ceilings block it: `@angular/compiler-cli@21.2.6` (`typescript: '>=5.9 <6.1'`), `typescript-eslint@8.70.0`
(`'>=4.8.4 <6.1.0'`), and `ts-jest@29.4.12` (`'>=4.3 <7'`). Even setting peer-dep enforcement aside,
TypeScript 7.0 GA ships with no programmatic compiler API, which is what `ts-jest`, `ts-node`'s
transpile-via-`createProgram` path, `ts-morph`, and type-aware ESLint rules are built on — so even a
forced install would not produce a working `build`/`lint`/`test` pipeline. The one clean win available
now is fixing `apps/ptah-license-server/tsconfig.app.json`'s `moduleResolution: "node"` (a value TS7
removes outright) independent of any TS7 adoption, since that's dead-value-walking already.

---

## GROUP B — ESLint 9.39.4 to 10.11.0

### 1. Version, Node engine, breaking changes

Directly verified: `npm view eslint dist-tags` → `latest: '10.11.0'`. `npm view eslint time --json`:
`9.39.4` published 2026-03-06T21:46Z; `10.11.0` published **2026-09-18T20:15Z — three days before today**.
`npm view eslint@10.11.0 engines` → `{"node":"^20.19.0 || ^22.13.0 || >=24"}`. Repo pins `"engines":{"node":"24.x"}`
(`package.json`) — **compatible**.

Breaking changes (eslint.org migrate-to-10.0.0 guide, fetched 2026-09-21):

1. Node `<20.19`/`21`/`23` dropped — satisfied here.
2. **Config lookup changed from cwd-based to per-linted-file-directory-based** (search upward from each
   file) — this is a discovery-mechanism change, not a change to how multiple config objects inside one
   `eslint.config.mjs` apply to overlapping `files` globs.
3. Legacy `.eslintrc` system, `ESLINT_USE_FLAT_CONFIG`, and old CLI flags (`--no-eslintrc`, `--env`,
   `--resolve-plugins-relative-to`, `--rulesdir`, `--ignore-path`) removed — irrelevant, repo is
   flat-config-only already.
4. Minimatch bump adds POSIX character-class glob syntax — additive only.
5. JSX elements tracked as scope references (affects `no-unused-vars`-style rules in JSX/TSX).
6. `/* eslint-env */` comments now hard errors.
7. `eslint:recommended` gains `no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`.
8. A handful of rule-schema tightenings (`radix`, `func-names`, `no-invalid-regexp`,
   `no-shadow-restricted-names` default) — none of these rules appear in this repo's `eslint.config.mjs`.
9. Deprecated custom-rule-authoring APIs removed (`context.getCwd()`, deprecated `SourceCode` methods,
   `LintMessage.nodeType`) — only relevant to hand-written rule _implementations_ with a `create(context)`
   body; this repo's custom checks are `no-restricted-syntax` AST-selector configs (esquery), evaluated by
   ESLint core, not custom rule modules, so this does not apply.

**Flat-config format itself was not changed in v10** — no item in the official migration guide touches
the shape of a config-object array, `files`/`ignores` glob semantics for objects within one file, or the
non-merging "later object replaces an earlier rule's options for the same rule name" behavior. This is a
verified negative (absence in an exhaustively-itemized official doc), not a claim of exhaustive audit.

### 2. Plugin peer-dependency support (direct `npm view`)

```
typescript-eslint@8.70.0        peerDependencies.eslint = "^8.57.0 || ^9.0.0 || ^10.0.0"   → OK
angular-eslint@22.5.0           peerDependencies.eslint = "^9.0.0 || ^10.0.0"              → OK
angular-eslint@21.3.1 (repo pin)peerDependencies.eslint = "^8.57.0 || ^9.0.0 || ^10.0.0"   → OK
@nx/eslint-plugin@22.6.5 (repo) peerDependencies = { 'eslint-config-prettier': '^10.0.0', '@typescript-eslint/parser': '^6.13.2||^7.0.0||^8.0.0' } → no "eslint" peer at all, not gated
@nx/eslint-plugin@23.2.1        same shape, narrower parser range (^8.0.0 only) → not gated
@nx/eslint@22.6.5 (the executor Nx actually runs lint through) peerDependencies.eslint = "^8.0.0 || ^9.0.0 || ^10.0.0" → OK, already declared at the repo's CURRENT Nx pin
jsonc-eslint-parser@3.3.0       no peerDependencies field at all → not gated
```

Correction to the task's framing: no Nx major bump is implied by peer data. `@nx/eslint@22.6.5` (already
what this repo runs) already declares ESLint 10 support in its own peerDependencies; `@nx/eslint-plugin`
never peers on `eslint` directly in either version checked.

### 3. This repo's `eslint.config.mjs` constructs vs. ESLint 10

Read directly (`D:\projects\ptah-extension\eslint.config.mjs`):

- `nx.configs['flat/base']` / `'flat/typescript'` / `'flat/javascript'` spreads — plain object/array
  shareable-config shape, untouched by anything in the v10 changelog.
- Custom `no-restricted-syntax` AST selectors (`CallExpression[callee.property.name='watch'] > ObjectExpression > Property[key.name='recursive']...`,
  `ImportDeclaration[source.value=/^(node:)?fs(\/promises)?$/]`, the `RECURSIVE_FS_WATCH_SELECTORS` /
  `CHOKIDAR_LOAD_SELECTORS` families) — `no-restricted-syntax` is a core rule evaluated via esquery
  against the AST; esquery selector semantics are not listed as changed anywhere in the v10 migration
  guide.
- `@nx/enforce-module-boundaries` (`'error'`, large `depConstraints` with `sourceTag`/`onlyDependOnLibsWithTags`,
  `checkDynamicDependenciesExceptions`) — lives entirely inside `@nx/eslint-plugin`'s own rule
  implementation, which already has no `eslint` peer objection (table above) and isn't touched by any of
  the documented rule-schema changes (those hit `radix`/`func-names`/`no-invalid-regexp`/`no-shadow-restricted-names`
  only).
- `max-lines` `'warn'` `{ max: 700, skipBlankLines: true, skipComments: true }` — standard core rule, no
  schema change documented for it.
- The layered `no-restricted-syntax` blocks for `apps/**/*.ts`, `CHOKIDAR_ALLOWED`,
  `FS_WATCH_AND_CHOKIDAR_ALLOWED`, etc., which deliberately rely on flat config's non-merging,
  later-object-wins-for-overlapping-files semantics (the file's own comments at lines 5-13 and 512-513
  document this reliance explicitly) — this is fundamental flat-config array-of-configs behavior,
  unchanged since ESLint 9 and not listed as altered in the v10 guide. This is the one point resting on
  the migration guide's _silence_ rather than an explicit confirming statement — treat as strong but not
  airtight.
- The `ClassDeclaration[id.name=/RpcHandlers$/]` selector rule scoped to `apps/**` — same `no-restricted-syntax`/esquery
  mechanism as above; not affected for the same reason.

One residual, unverified-by-execution point: v10's config-lookup change (item 2, cwd-based →
per-file-directory upward search) could in principle change which of this repo's ~90+ per-project
`eslint.config.mjs` files gets picked up when Nx invokes lint per-project. For a straightforward
Nx-executor run this should converge on the same nearest config, but this was **not executed** in this
research pass (no `npm install` was performed, per the task's "do not change any source file or
package.json" instruction) — flag as the one item to confirm with a real `nx run-many -t lint` trial run
before merging.

### GROUP B RECOMMENDATION: **GO, with a pre-merge trial run**

No directly-measured peer-dependency objection exists anywhere in this repo's ESLint toolchain
(`typescript-eslint`, `angular-eslint` at the repo's actual pin, `@nx/eslint` at the repo's actual Nx
pin, `jsonc-eslint-parser`), Node 24.x satisfies ESLint 10.11.0's engine requirement, and none of the
documented v10 breaking changes intersect this repo's non-standard `eslint.config.mjs` constructs
(custom AST selectors, layered non-merging blocks, `enforce-module-boundaries`, `max-lines`). The only
caveat is that `eslint@10.11.0` is 3 days old at time of writing and the per-file config-lookup change
was not exercised — run `npx nx run-many -t lint -p <a representative handful of projects>` (never
`nx lint projA projB`, see root CLAUDE.md) after bumping, as the acceptance gate rather than a blocker.

---

## GROUP C — license-server majors (apps/ptah-license-server, libs/api/\*\* only)

### 1. NestJS 11.1.23 → 12.0.3, and the config/event-emitter/jwt/schedule 12.x jump

Directly verified (`npm view`, 2026-09-21):

```
@nestjs/core@12.0.3            peerDependencies: rxjs ^7.1.0, @nestjs/common ^12.0.0, reflect-metadata ^0.1.12||^0.2.0,
                                @nestjs/websockets ^12.0.0, @nestjs/microservices ^12.0.0, @nestjs/platform-express ^12.0.0
                                engines: { node: '>= 20' }
@nestjs/common@12.0.3          peerDependencies: rxjs ^7.1.0, class-validator '>=0.13.2', class-transformer '>=0.4.1',
                                reflect-metadata ^0.1.12||^0.2.0
@nestjs/platform-express@12.0.3 peerDependencies: @nestjs/core ^12.0.0, @nestjs/common ^12.0.0
@nestjs/testing@12.0.3         peerDependencies: @nestjs/core ^12.0.0, @nestjs/common ^12.0.0, @nestjs/microservices ^12.0.0, @nestjs/platform-express ^12.0.0
@nestjs/config@12.0.0          peerDependencies: rxjs ^7.1.0, @nestjs/common '^11.0.0 || ^12.0.0'
@nestjs/event-emitter@12.0.1   peerDependencies: @nestjs/core '^11.0.0||^12.0.0', @nestjs/common '^11.0.0||^12.0.0'; engines >=20.19.0
@nestjs/jwt@12.0.2             peerDependencies: @nestjs/common '^8||^9||^10||^11||^12'
@nestjs/schedule@12.0.2        peerDependencies: @nestjs/core '^11.0.0||^12.0.0', @nestjs/common '^11.0.0||^12.0.0'; engines >=20.19.0
```

**Version-alignment confirmed, not just suspected**: `npm view @nestjs/core time --json` shows
`12.0.0` published `2026-08-27T07:03:15Z`; `@nestjs/config@12.0.0`, `@nestjs/event-emitter@12.0.0/12.0.1`,
`@nestjs/jwt@12.0.0-12.0.2`, `@nestjs/schedule@12.0.0-12.0.2` all first-published the **same day**
(2026-08-27), matching the timestamp pattern of `@nestjs/core@12.0.0`. This is a genuine org-wide
version-alignment release, matching NestJS's known past practice of lining up the whole official-package
family behind a core major.

**Required Node/TypeScript**: `@nestjs/core@12.0.3` engines `node: '>= 20'` — satisfied by this repo's
Node 24.x pin. `@nestjs/event-emitter`/`@nestjs/schedule` require `node >= 20.19.0`, also satisfied.
NestJS 12's own migration guide states its packages are now ESM-only internally (interop-safe on
Node ≥20.19/22.12/24, all satisfied); TypeScript version requirement was not independently pinned down
beyond "a reasonably current TS" — **UNKNOWN precise floor**, not found in a directly-checked
`peerDependencies` field (none of the `@nestjs/*` packages checked declare a `typescript` peer).

Breaking changes (docs.nestjs.com/migration-guide, dated 2026, fetched 2026-09-21):

- Packages are ESM-only now; default-style imports of the whole module (`import nest from '@nestjs/core'`)
  no longer compile — named imports required.
- `@Optional()` no longer inherited by subclasses.
- Terminus health-indicator API changed (custom indicators need `HealthIndicatorService`) — not confirmed
  to be in use in `libs/api/**` in this pass (not grepped directly here; flag as unconfirmed rather than
  "not applicable").
- `@nestjs/config@12` moves to Standard Schema validation (Zod/Valibot/ArkType/Joi ≥v18) instead of
  Joi-only; Joi-specific options (`allowUnknown`, `abortEarly`) move under a new `libraryOptions` key;
  a `validationSchema` that doesn't implement Standard Schema is now a compile-time error. **Action
  item**: confirm what `ConfigModule.forRoot()` actually passes as `validationSchema` in
  `apps/ptah-license-server/src/app/app.module.ts` before bumping — not read in this pass, UNKNOWN.
- `class-validator`/`class-transformer`: no version bump exists for either (checked — `class-validator`
  tops out at `0.15.1`, `class-transformer` at `0.5.1`, both already what this repo pins), and NestJS 12's
  migration guide adds `StandardSchemaValidationPipe` as an _additional option_, not a replacement — the
  existing global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` pattern needs no
  change.

**BLOCKER, directly measured**:

```
npm view @sentry/nestjs@10.75.0 peerDependencies
→ { '@nestjs/core': '^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0', '@nestjs/common': '^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0' }
npm view @sentry/nestjs@11.0.0-rc.0 peerDependencies
→ { '@nestjs/core': '... || ^12.0.0', '@nestjs/common': '... || ^12.0.0' }
```

No **stable** `@sentry/nestjs` release supports NestJS 12 — only the `11.0.0-rc.0` prerelease adds the
`^12.0.0` peer range. Since `apps/ptah-license-server/src/instrument.ts` depends on `@sentry/nestjs` for
its early-import Sentry init pattern, bumping the `@nestjs/*` family to 12 today forces a choice between
running production error-monitoring on an unreleased Sentry RC, or temporarily removing the NestJS
integration — both unacceptable for a licensing/billing service.

### 2. Prisma 7.7.0 → 7.10.0 stable vs. 8.0.0-rc.15

Directly verified:

```
npm view prisma dist-tags
→ { ..., prev: '7.10.0', latest: '8.0.0-rc.15', next: '8.0.0-rc.10', dev: '8.0.0-rc.15-dev.109' }
npm view prisma@7.10.0 engines        → { node: '^20.19 || ^22.12 || >=24.0' }
npm view prisma@8.0.0-rc.15 engines   → { node: '>=22.18.0' }
npm view @prisma/adapter-pg@7.10.0 version → 7.10.0
```

Note the npm `latest` dist-tag currently resolves to the **8.0.0-rc.15 prerelease** — a bare
`npm install prisma` would pull an RC, not the stable line. `7.10.0` published 2026-08-25T12:47Z;
`8.0.0-rc.15` published 2026-09-14T07:01Z. No non-RC `8.0.0` exists in the published version list as of
this check.

Changes in the 8.0.0 RC line (aggregated from prisma/orm GitHub release notes across rc.2 through rc.15,
fetched 2026-09-21 — since no stable 8.0.0 exists yet, this is necessarily a rolling, still-shifting
target rather than one canonical migration doc):

- `prisma-next` binary / `prisma-next.config.ts` retired; only `prisma.config.ts` with
  `definePrismaConfig` remains.
- CLI env vars drop the `NEXT_` infix; command surface consolidates (`db migrate`, `orm init`),
  standalone aliases retired.
- **`.take(n)`/`.skip(n)` renamed to `.limit(n)`/`.offset(n)`** — a real breaking API-surface change,
  would require code changes anywhere `libs/api/**` uses Prisma pagination.
- **PostgreSQL date/time columns return Temporal values or strings, never `Date`** — breaking for any
  `instanceof Date` check or `Date` arithmetic on Postgres datetime columns; license-server's
  admin/community/learning-adjacent libs likely touch dates and would need an audit.
- `@prisma/management-api-sdk` moves to a peer dependency (only relevant if this repo consumes it —
  not checked/UNKNOWN).

**Recommendation: take 7.10.0 stable, not the 8.0.0 RC.** The RC line has active breaking changes still
landing release-to-release (rc.2 through rc.15 inside about three weeks), no non-RC 8.0.0 exists, and two
of the in-flight changes (Temporal dates, pagination rename) are exactly the kind of silent-breakage risk
a billing/licensing server should not absorb on a prerelease ORM major. `@prisma/adapter-pg@7.10.0`
tracks the same 7.10.0 stable line with no separate compatibility issue found.

### 3. @sentry/nestjs and @sentry/node 9.47.1 → 10.75.0

Directly verified: `npm view @sentry/node dist-tags` → `latest: '10.75.0'`, with `v9: '9.47.1'` still
tagged separately; `10.75.0` published 2026-09-16T15:00Z. `@sentry/nestjs`/`@sentry/node` version ladders
track together.

Breaking changes v9→v10 (sentry-javascript MIGRATION.md / docs.sentry.io v9-to-v10 guide, fetched
2026-09-21):

- `@sentry/core` internal renames: `BaseClient`→`Client`, `hasTracingEnabled()`→`hasSpansEnabled()`,
  `logger`/`Logger` type → `debug`/`SentryDebugLogger`.
- Experimental `Sentry.init()` options promoted to top-level config: `_experiments.enableLogs`→`enableLogs`,
  `_experiments.beforeSendLog`→`beforeSendLog`; `_experiments.autoFlushOnFeedback` removed (now default
  behavior). **Action item**: confirm whether `apps/ptah-license-server/src/instrument.ts` uses any
  `_experiments.*` key — not read directly in this pass, UNKNOWN, but the fix if so is a mechanical
  rename.
- OpenTelemetry dependency bumped to 2.x/0.20x line — a problem only if the license server pins its own
  OTel packages independently (not checked/UNKNOWN).
- IP-inference behavior (v10.4.0+) gated behind `sendDefaultPii` — mostly a browser-SDK concern; only
  relevant if this repo depends on automatic IP capture in server-side error events.
- No breaking change specific to the `instrument.ts` early-import pattern or `SentryModule` wiring
  itself was found for v9→v10 in the primary sources checked.
- The only hard version-compatibility problem tied to Sentry is the NestJS-12 peer ceiling documented in
  item 1 above (a coupling to the NestJS bump, not to v9→v10 by itself).

### 4. @workos-inc/node 8.13.0 → 10.13.0

Directly verified: `npm view @workos-inc/node versions --json` shows the full ladder `8.13.0 → 9.0.0 →
... → 9.3.1 → 10.0.0 → ... → 10.13.0`; `10.13.0` published 2026-08-31T18:44Z. `engines` for `10.13.0` is
`node >=22.11.0` (repo's Node 24.x satisfies this); `8.13.0`'s engines is `node >=20.15.0`.

Breaking changes (workos-node changelog / V8_MIGRATION_GUIDE.md, fetched 2026-09-21 — **the fetched
primary sources document the v8.0.0 jump in detail; the 9→10 major-specific breaking changes were not
independently located in a primary changelog in this pass — treat that gap as UNKNOWN, not "safe"**):

- Node minimum raised to 20 as of v8; package became ESM-first with dual CJS/ESM exports.
- PKCE support added as of v8 (additive, relevant since the task calls out PKCE explicitly — this repo's
  auth flow, per `apps/ptah-license-server` CLAUDE.md, already does WorkOS PKCE OAuth, so this is likely
  already compatible rather than a migration item).
- SSO: `SSOAuthorizationURLOptions` became a discriminated union; `domain` removed from authorization
  options; `context` removed from `getAuthorizationUrl()` (use `state` instead).
- `userManagement`: `sendMagicAuthCode()`, `sendPasswordResetEmail()`, `refreshAndSealSessionData()`
  removed (replaced by `loadSealedSession()` → `.refresh()` → `sealedSession`); `listOrganizationMemberships()`
  now requires `userId` or `organizationId` (can no longer be called bare).
- MFA: `verifyFactor()` removed → `verifyChallenge()`.
- Directory Sync: `emails`/`username`/`jobTitle` removed from `DirectoryUser`.
- **Action item, not resolved in this pass**: `libs/api/identity/src/lib/services/workos/workos-user.service.ts`
  is confirmed (by an earlier grep in this research) to call `workos.userManagement`. Whether it uses any
  of the removed v8-era methods above was **not read in this pass — UNKNOWN, must be checked before this
  upgrade is taken.**
- Whether the 9.x and 10.x major bumps _specifically_ (as opposed to the already-documented 8.0.0 jump)
  introduce further breaking changes was not confirmed against a primary 9-or-10-specific changelog in
  this research pass. **UNKNOWN — treat 9→10 as carrying its own undocumented breaks until confirmed**,
  do not assume "safe" from the 8.0.0 doc alone.

### 5. class-validator / class-transformer under NestJS 12

Directly verified: no newer major exists for either — `class-validator` latest is `0.15.1`,
`class-transformer` latest is `0.5.1`, i.e. exactly what this repo already pins. NestJS 12's migration
guide's only related change is the additive `StandardSchemaValidationPipe` alternative; the existing
`class-validator`/`class-transformer`-backed global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
needs no change to keep working on NestJS 12.

### GROUP C RECOMMENDATION: **NO-GO on the bundle as a whole; split it**

Main reason: **`@sentry/nestjs` has no stable release compatible with NestJS 12** (directly measured —
capped at `^11.0.0`; only an `11.0.0-rc.0` prerelease adds `^12.0.0`), and this license server actively
depends on `@sentry/nestjs` for its Sentry init. Bumping `@nestjs/*` to 12 today means either running
production error monitoring on an unreleased Sentry RC or dropping the integration — not acceptable for
a licensing/billing service. Secondarily, Prisma's `latest` npm tag currently resolves to an RC
(`8.0.0-rc.15`) with in-flight breaking changes (Temporal date/time columns, `.take`/`.skip` rename); do
not pull `latest` blindly.

Recommended path, in order: (1) **GO now** — bump `prisma`/`@prisma/client`/`@prisma/adapter-pg` to
**7.10.0 stable** explicitly (same major line, no blocking finding). (2) **GO conditionally** — bump
`@workos-inc/node` to `10.13.0` only after reading `workos-user.service.ts` to confirm it uses none of
the removed v8-era methods, and after locating a primary 9.x/10.x-specific WorkOS changelog to close the
UNKNOWN above. (3) **Hold** the `@nestjs/*` → 12 + `@sentry/*` → 10.75.0/11.x bump together as one unit
until `@sentry/nestjs` ships a stable NestJS-12-compatible release.

---

## GROUP D — the two deliberate pins (approved for lifting)

### 1. `@anthropic-ai/claude-agent-sdk` 0.3.150 → 0.3.278 breaking changes

From the package's CHANGELOG.md (github.com/anthropics/claude-agent-sdk-typescript, fetched 2026-09-21),
read entry-by-entry across the full 0.3.150–0.3.278 range. Only two entries are self-labeled **Breaking**:

- **0.3.162** — Breaking: refusal error messages now carry `stop_reason: 'refusal'` (a message-shape
  change for any consumer matching on `stop_reason`).
- **0.3.161** — Breaking: the `initialize` control request became idempotent; `ControlResponse` gained
  `pending_permission_requests`.

Everything else in the range is additive or a bugfix per the changelog's own wording, grouped by the
task's areas of concern:

- **query()/control protocol**: 0.3.261 fixed `query()` throwing "Object not disposable" on runtimes
  without native `Symbol.dispose`; 0.3.205 added `interrupt_receipt_v1` + typed `Query.interrupt()`
  receipt; 0.3.195 added `Query.reinitialize()`.
- **MCP wiring**: 0.3.274 added `mcpServer: {name, source}` to `canUseTool` options and `mcp_server` to
  tool inputs; 0.3.269 fixed interrupt/permission delays during MCP OAuth sign-in; 0.3.248 added
  per-server `timeout`; 0.3.221 fixed external MCP servers not connecting before the first turn; 0.3.198
  added per-server `request_timeout_ms` to `mcp_set_servers`; 0.3.163 fixed SDK hosts unable to add
  builtin MCP servers via `setMcpServers`.
- **Hooks**: 0.3.236 — `PostToolUse` hooks can return `hookSpecificOutput.classifierContext`; 0.3.219
  added `DirectoryAdded` lifecycle event; 0.3.214 — `SessionStart` hooks report source `"fork"` instead
  of `"resume"` for forks (a behavior-shape change worth checking against this repo's hook-session
  handling, see `agent-sdk` CLAUDE.md's `resolveHookSessionId` rules); 0.3.208 fixed abort-during-pending-hook
  killing the whole query and `UserPromptSubmit` timeout killing the query; 0.3.196 added `prompt_id` to
  hook payloads; 0.3.163 — Stop/SubagentStop hooks support `additionalContext`; 0.3.152 — `SessionStart`
  hooks can return `reloadSkills: true`, hooks can set session title, new `MessageDisplay` hook event.
- **Permissions**: 0.3.269 — plan mode now routes writes through `canUseTool` even with
  `allowDangerouslySkipPermissions` (a behavior change under that flag, not labeled Breaking but changes
  what fires); 0.3.268 added `defaultToNo`/`suppressAlwaysAllowRule` hints; 0.3.259 added
  `permissionPrompts: 'none'`; 0.3.207 fixed `canUseTool` returning `{behavior:'allow'}` without
  `updatedInput`; 0.3.198 added a runtime warning for `canUseTool` combined with `allowedTools`/`bypassPermissions`.
- **Session resume**: 0.3.275 fixed `getSessionMessages()`/`forkSession()` missing the turn's assistant
  message and fixed `forkSession({upToMessageId})`/id validation edge cases; 0.3.271 fixed
  `listSessions`/`getSessionMessages`/`getSessionInfo` `dir` handling on Windows (directly relevant — this
  repo ships on Windows) and fixed `sessionStore` resume losing global config under a legacy name; 0.3.223
  added `resumeDropsTurn`/`resumeSessionAt`; 0.3.222 fixed `query({sessionStore, resume})` not carrying
  user settings into the resumed subprocess; 0.3.211/0.3.212 fixed `--replay-user-messages`/argv timing
  issues.
- **Tool definitions**: no changes to the `tool()` helper itself found anywhere in this range.

A WebSearch-only hit describing a "0.3.2 MCP/TodoWrite breaking change" could not be corroborated against
the actual CHANGELOG (no `0.3.2` exists in this 0.3.150-0.3.278 range) — **disregarded as unreliable**,
flagged rather than included as fact.

### 2. zod 4.3.6 → 4.6.5 breaking changes

Directly verified all intermediate versions exist and are non-canary stable releases (`npm view zod
versions --json`): 4.3.6, 4.4.0-4.4.3, 4.5.0-4.5.4, 4.6.0-4.6.5. Per-release notes (github.com/colinhacks/zod/releases,
fetched 2026-09-21):

- **v4.4.0 (zod's own "Breaking Changes" label)**: tuple defaults now materialize in output; object
  properties typed `z.undefined()` become required-key (need explicit `.optional()`); `.merge()` now
  throws if the receiver schema has refinements (use `.extend()`/`.safeExtend()` instead); JSON Schema
  `$defs` dropped redundant `id` fields; stricter string validators (base64 rejects whitespace, CUID v1
  deprecated/tightened, malformed HTTP URLs like `"https:/example.com"` now rejected); union/discriminated-union
  error-formatting changed (can break error-message snapshot tests).
- **v4.5.0 (zod's own "Breaking Changes ⚠️" label)**: `z.iso.datetime()` now requires seconds
  (`2020-01-01T06:15Z` now rejected); string length now counts Unicode code points instead of UTF-16
  units (affects emoji-length validation); record-key matching changed to TS semantics; `__proto__`
  always stripped from objects/records; stricter IPv6/ULID/HTTP-URL/emoji formats.
- **v4.6.0**: error maps now evaluated lazily on first read of `.error` rather than eagerly (behavior
  change for code relying on eager error-map side effects); `z.emoji()` no longer accepts standalone
  Unicode emoji components.
- **v4.6.3**: removed the standalone `z.properties()` schema that 4.6.0 had introduced — only relevant if
  this repo adopted that API between those versions, which it has not (still on 4.3.6 today).
- 4.6.1/4.6.2/4.6.4/4.6.5: no breaking changes found, additive/doc/perf only.

Given this repo's CLAUDE.md rule of Zod validation "at every external boundary," the concrete exposure is
narrow: any `.merge()` call on a refined schema, any `z.iso.datetime()` used without seconds, or HTTP-URL/
emoji format validators. Worth a targeted grep (`\.merge\(`, `z\.iso\.datetime\(`) before merging; not a
blanket blocker.

### 3. Is the `overrides` block still needed at SDK 0.3.278 + zod 4.6.5?

Directly verified, both ends of the range:

```
npm view @anthropic-ai/claude-agent-sdk@0.3.150 peerDependencies dependencies
→ peerDependencies: { zod: '^4.0.0', '@anthropic-ai/sdk': '>=0.93.0', '@modelcontextprotocol/sdk': '^1.29.0' }
→ dependencies: {}  (empty — no dependencies field at all)

npm view @anthropic-ai/claude-agent-sdk@0.3.278 peerDependencies dependencies
→ peerDependencies: { zod: '^4.0.0', '@anthropic-ai/sdk': '>=0.93.0', '@modelcontextprotocol/sdk': '^1.29.0' }
→ dependencies: {}  (identical, unchanged)
```

The SDK's zod peer range (`^4.0.0`) is **identical at both ends of the upgrade** and the SDK never
bundles its own zod (no `dependencies.zod`) — it only ever consumes whatever zod the host resolves. Root
`package.json:197` pins `"zod": "4.3.6"`; the `overrides` block at `package.json:290-292` forces
`"@anthropic-ai/claude-agent-sdk": { "zod": "^4.1.12" }`.

**The override was never resolving a conflict with the SDK's own declared peer range** — `^4.1.12` is
strictly tighter than the `^4.0.0` the SDK asks for at either version, so it was compensating for
something else (most likely a floor for a zod bugfix the wrapper code needs, guarding against npm
hoisting resolving some transitive zod below 4.1.12).

**Verdict**: with root zod at 4.6.5 (which already satisfies both `^4.0.0` and `^4.1.12`) and the SDK at
0.3.278 (peer range unchanged), the override's literal condition is already satisfied by the direct
dependency version alone — it becomes **redundant, safe to remove, not required to keep**. Recommend
dropping the `overrides` entry in the same change as a cleanup, not as a blocking prerequisite.

### 4. Blast radius of the agent-sdk upgrade (repo-only, directly grepped/read)

Wrapper lives in `libs/backend/agent-sdk`. Exhaustive grep for `from '@anthropic-ai/claude-agent-sdk'`,
`require('@anthropic-ai/claude-agent-sdk')`, and `import('@anthropic-ai/claude-agent-sdk')` (single- and
double-quoted forms; double-quoted form had zero hits anywhere in the repo). 13 import sites across 12
source/spec files, split by risk:

**Type-only imports (compile-time, near-zero runtime risk absent a renamed/removed exported type — none
found in the changelog for this range):**

- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:96-140`, `:141-144`, `:145-189` —
  three `export type {...} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' }`
  blocks re-exporting roughly 50 hook/message/type names (`HookInput`, `SDKMessage`, `Options`, `Query`,
  `TerminalReason`, etc.). **This file is the single chokepoint** — every other file in `agent-sdk`/
  `cli-agent-runtime` consumes SDK types through this wrapper, not the package directly.
- `libs/backend/cli-agent-runtime/src/lib/spawn/sdk-process-spawner.port.ts:1-4` — `import type {
SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'`.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts:26-29` —
  same type import (test file).
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-auto-compact-argv.spec.ts:41` —
  `import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'` (test file).

**Runtime imports (dynamic `import()`, execute SDK code at call time):**

- `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:65` — `await import('@anthropic-ai/claude-agent-sdk')`,
  pulls `query`. **Main production entry point** (`SdkModuleLoader.getQueryFunction`) — every interactive
  and internal one-shot query eventually goes through this.
- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts:71` — dynamic import, pulls `forkSession`.
- `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts:394` — dynamic import, pulls
  `getSubagentMessages`.
- `libs/backend/agent-sdk/src/lib/helpers/session-title.service.ts:50` — dynamic import, pulls
  `renameSession`.
- `apps/ptah-video-studio/scripts/polish.mjs:56` — dynamic import, pulls `query` (tooling script, never
  shipped per root CLAUDE.md — lowest-priority risk).

**Runtime `require()` in spec files (test mocks, not production code):**

- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.spec.ts:7`
- `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.spec.ts:30`
- `libs/backend/agent-sdk/src/lib/helpers/session-title.service.spec.ts:7`

**Confirmed NOT importing the package directly** (consume the internal `claude-sdk.types.ts` wrapper
instead): `teammate-lifecycle-hook-handler.ts`/`.spec.ts`, `curator-llm-adapter/sdk-internal-query.curator-llm.ts`/`.spec.ts`.
These only need the wrapper's re-exports to stay stable, which is an internal contract, not the SDK's.

**package.json declarations** (grepped): SDK pinned at `0.3.150` in root `package.json:101`,
`apps/ptah-electron/package.json:13`, `apps/ptah-cli/package.json:52`, `libs/backend/agent-sdk/package.json:16`,
`libs/backend/cli-agent-runtime/package.json:9`, and `package-lock.json:24`. Also named (unversioned) in
esbuild external lists: `apps/ptah-electron/project.json:39`, `apps/ptah-tui/project.json:33`,
`apps/ptah-cli/project.json:44`, `libs/backend/agent-sdk/project.json:22` — these bundler-external
declarations are unaffected by a version bump per se, just need the version string updated everywhere
it's pinned.

**One documented internal-behavior coupling worth flagging**: `libs/backend/agent-sdk/CLAUDE.md` states
outright that spawn-worker teardown logic depends on an assumption about the SDK's _internal, unexported_
transport module at an exact version — _"the SDK's `ProcessTransport` (SDK 0.3.150 `sdk.mjs`) records
`exitError` from `error` but resolves `onExit`, `waitForExit` and its `close()` sweep only from `exit`."_
Nothing in the 0.3.151–0.3.278 changelog mentions `ProcessTransport`, `exitError`, or exit/close ordering,
so this is likely still accurate, but it's an assumption about undocumented internal behavior, not a
public contract — the one place a silent regression could land without appearing in any changelog.
`off-thread-process-spawner.spec.ts` pins this behavior against real child processes and is the concrete
regression gate to re-run after the bump.

### GROUP D RECOMMENDATION: **GO**

Lift both pins. The SDK's own zod peer requirement is unchanged (`^4.0.0`) across the entire
0.3.150→0.3.278 range, so the two bumps are independent of each other. Only two SDK changelog entries in
range are self-labeled Breaking (`stop_reason: 'refusal'` at 0.3.162, idempotent `initialize` at 0.3.161),
and this repo's contact surface with the package is narrow and already isolated behind one type
re-export chokepoint (`claude-sdk.types.ts`) and four runtime call sites (one primary —
`sdk-module-loader.ts` — plus three narrow helpers). Zod's breaking changes in range are all narrow
string/format-validation edge cases, worth a `.merge(`/`z.iso.datetime(` grep before merging but not a
blocker. The `overrides` entry forcing `zod: "^4.1.12"` inside the SDK becomes redundant once root zod is
4.6.5 and can be dropped as a cleanup in the same change. The one non-trivial residual risk — the
version-named assumption about `sdk.mjs`'s undocumented exit/close ordering in `agent-sdk`'s CLAUDE.md —
is not a reason to block; treat re-running `off-thread-process-spawner.spec.ts` after the bump as the
acceptance gate for it.

---

## Summary table

| Group | Scope                                                              | Recommendation                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | typescript 5.9.3 → 7.0.2                                           | **NO-GO** — `@angular/compiler-cli@21.2.6` (`typescript '>=5.9 <6.1'`), `typescript-eslint@8.70.0` (`'>=4.8.4 <6.1.0'`) and `ts-jest@29.4.12` (`'>=4.3 <7'`) all hard-exclude TS7; TS7 GA also ships with no programmatic compiler API     |
| B     | eslint 9.39.4 → 10.11.0                                            | **GO**, with a `nx run-many -t lint` trial before merge — no measured peer-dep or config-mechanism objection found                                                                                                                         |
| C     | NestJS 11→12 / Prisma 7.7→7.10 or 8-rc / Sentry 9→10 / WorkOS 8→10 | **NO-GO on the bundle** — `@sentry/nestjs` has no stable NestJS-12-compatible release; split: Prisma 7.10.0 stable is a clean GO now, WorkOS 10.13.0 is conditional on an unread service file, NestJS 12 + Sentry 10/11 must wait together |
| D     | claude-agent-sdk 0.3.150→0.3.278, zod 4.3.6→4.6.5                  | **GO** — peer ranges unchanged, blast radius narrow and already isolated, override becomes redundant and can be dropped                                                                                                                    |
