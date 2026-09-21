---
status: in_progress
type: devops
title: Move the web product to ESM and upgrade to NestJS 12
description: >-
  Convert libs/api and apps/ptah-license-server from CommonJS to ESM, then take
  NestJS 12 and the Sentry upgrade it unblocks. The ESM move is not a cleanup
  that happens to be nice. NestJS 12 ships type module, so ESM is a hard
  prerequisite. The same move unblocks sanitize-html 2.17.7, whose fix was
  unreachable while the consumer compiled to CommonJS.
---

# ESM + NestJS 12

## Why these are one task, not two

`npm view @nestjs/core@12.0.3 type` returns `module`. Every package in the
NestJS 12 family is ESM-only:

```
@nestjs/common 12.0.3            type = module
@nestjs/core 12.0.3              type = module
@nestjs/platform-express 12.0.3  type = module
@nestjs/config 12.0.0            type = module
@nestjs/jwt 12.0.2               type = module
@nestjs/schedule 12.0.2          type = module
@nestjs/event-emitter 12.0.1     type = module
@nestjs/testing 12.0.3           type = module
```

`@nestjs/throttler@6.7.0` is the exception: still CommonJS, but its peer range
already accepts `^12.0.0`, and an ESM app may import a CommonJS package. It is
not a blocker.

So NestJS 12 cannot be taken while `libs/api/**` compiles to CommonJS. The ESM
migration is the prerequisite, not a parallel improvement.

## Measured scope

All 15 `libs/api/*` set `"module": "commonjs"` in `tsconfig.lib.json`, and
`apps/ptah-license-server` builds `"format": ["cjs"]`. That is the NestJS default
and nobody had revisited it.

The production-code blockers are three lines, all `import x = require(...)`,
which is a TypeScript construct with no ESM equivalent:

| File                                                                       | Line | Import                 |
| -------------------------------------------------------------------------- | ---- | ---------------------- |
| `libs/api/core/src/lib/sentry/sentry.module.ts`                            | 20   | `@sentry/nestjs/setup` |
| `libs/api/marketing/src/lib/marketing/services/template-render.service.ts` | 3    | `sanitize-html`        |
| `apps/ptah-license-server/src/main.ts`                                     | 20   | `cookie-parser`        |

Every other `require()` and `__dirname` in this tree is in a `.spec.ts` or a
`src/testing/` helper — 120 of 452 files. Jest keeps running those through
`tsconfig.spec.json` on CommonJS, so they are out of scope. Splitting lib output
from spec compilation this way is the normal arrangement, not a workaround.

## Sentry: an override, and why it needs a real test

User decision, 2026-09-21: take NestJS 12 and force Sentry with an npm override
rather than wait for a stable Sentry 11.

```
@sentry/nestjs 10.75.0 peers  @nestjs/core ^8 || ^9 || ^10 || ^11
@sentry/nestjs 11.0.0-rc.0    ^8 || ^9 || ^10 || ^11 || ^12
```

An override changes which version npm installs. It does not change Sentry's code.
`@sentry/nestjs/setup` patches `@nestjs/core` internals, so the failure mode of a
forced peer is not a crash — it is error capture silently not working, which
surfaces during an incident when a report never arrives.

An install that resolves is therefore not evidence. This task must add a test
that asserts a thrown exception actually reaches the Sentry client, and that test
is the acceptance criterion for the override.

## Unblocked by the same move

`sanitize-html` 2.17.7 fixes two XSS advisories (GHSA-jxwj-j7wr-gfrw,
GHSA-g8qq-57p8-ggw5). It was unreachable because 2.17.6 moved `htmlparser2` to
`^12.0.0`, which is ESM-only with no `require` condition, and
`libs/api/marketing` compiled to CommonJS. Once marketing is ESM the pin can lift
and the advisory closes. Do NOT override `htmlparser2` back to 10: sanitize-html
is a security control, and running a sanitizer against a different parser than it
was written for invites a parsing differential, which is a bypass vector.

## Order

1. Convert the three `import = require` sites.
2. Flip `libs/api/*` `tsconfig.lib.json` to ESM, keep `tsconfig.spec.json` on CommonJS.
3. Flip the license server build to `esm`.
4. Verify green, commit. This is a behaviour-preserving step on NestJS 11.
5. Take NestJS 12 + `@nestjs/testing` 12.
6. Sentry override + the error-capture test.
7. Lift the `sanitize-html` pin to 2.17.7.
