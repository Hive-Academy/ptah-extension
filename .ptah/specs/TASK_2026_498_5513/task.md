---
status: in_progress
type: devops
title: Systematic npm and Nx dependency migration
description: >-
  Bring the outdated npm packages to their latest reachable versions in ordered
  waves, following Nx and npm migration practice. Includes Nx 23, Angular 22,
  TypeScript 6, ESLint 10, Electron 44, and Tailwind 4 with daisyui 5. Also lifts
  the two deliberate pins on @anthropic-ai/claude-agent-sdk and zod. Four targets
  are measured as unreachable and are excluded with evidence.
---

# Dependency migration

153 packages are outdated. 63 updates are inside the current semver range. 90 need
a major version jump.

The migration runs in eight waves. Each wave ends with `lint`, `typecheck`, `test`
across all projects, and one commit. A failing wave stops the chain.

| Wave | Content                                                                | Risk   |
| ---- | ---------------------------------------------------------------------- | ------ |
| 0    | Baseline: branch, green build, lockfile snapshot                       | none   |
| 1    | 63 in-range updates                                                    | low    |
| 2    | Nx 22.6.5 -> latest 22.x -> 23.2.1, Angular 21 -> 22, TypeScript 6.0.x | medium |
| 3    | Angular satellites: angular-eslint, jest-preset-angular, ngx-\*        | medium |
| 4    | ESLint 10, Prisma 7.10.0, WorkOS 10, ~25 smaller majors                | medium |
| 5    | Electron 44 and the better-sqlite3 ABI rebuild (143 -> 149)            | high   |
| 6    | Tailwind 4 and daisyui 5. Its own pull request.                        | high   |
| 7    | Pin lift: agent SDK 0.3.278, zod 4.6.5, overrides cleanup              | high   |

Baseline on 2026-09-21, commit d5d1a6bd7: `nx run-many -t typecheck test lint --all`
reported `Successfully ran targets typecheck, test, lint for 97 projects and 41 tasks
they depend on`. Any later failure belongs to this migration.

User decisions on 2026-09-21: full scope, all waves. Both pins move. No release
candidates on the license server.

## Follow-up tasks to open when this one closes

1. NestJS 12 with `@sentry/nestjs` 11, once Sentry 11 leaves release candidate.
2. `@huggingface/transformers` 4.x. It needs the `onnxruntime-node` pin to move from
   1.24.3 to 1.30.0, a rewrite of `patch-transformers-onnx-dep.js`, and an async
   refactor of `kokoro-pipeline.ts` where `toWav()` becomes `toBlob()`.
3. TypeScript 7, once Angular and Nx support it.

## Measured constraint: TypeScript 7 is out of reach

`npm view ng-packagr@22.1.1 peerDependencies` returns `"typescript": ">=6.0 <6.1"`.
`@angular/compiler-cli@22.1.7` and `@angular/build@22.1.8` carry the same pin. The Nx
23.1 release notes state that Nx does not support TypeScript 7, because TypeScript 7
does not yet ship the programmatic API that Nx and third-party tools call.

Angular 22 and TypeScript 7 are therefore mutually exclusive. This task takes
Angular 22 and TypeScript 6.0.x. TypeScript 7 moves to a future task.

`nx migrate` also drives the Angular hop through the `@nx/angular` migrations. Do not
run `ng update` separately. Waves 2 and 3 of the original plan merge into one hop.

## Measured constraint: @huggingface/transformers must stay at 3.8.1

`npm view @huggingface/transformers@4.3.0 dependencies` shows an exact pin,
`"onnxruntime-node": "1.30.0"`. `npm view kokoro-js@latest` shows version 1.2.1 with
`"@huggingface/transformers": "^3.5.1"`. kokoro-js 1.2.1 is the newest release. No
kokoro-js release accepts transformers 4.x.

A move to transformers 4.3.0 therefore breaks voice synthesis. The package stays at
3.8.1. The `overrides.onnxruntime-node` pin at 1.24.3 and the
`patch-transformers-onnx-dep.js` script stay unchanged.

## Excluded from this task

| Package                      | Target      | Reason                                                                 |
| ---------------------------- | ----------- | ---------------------------------------------------------------------- |
| typescript                   | 7.0.2       | Angular 22 and ng-packagr 22 pin `>=6.0 <6.1`. Nx does not support it. |
| @huggingface/transformers    | 4.3.0       | kokoro-js has no release that accepts 4.x.                             |
| onnxruntime-node             | 1.30.0      | Follows the transformers exclusion.                                    |
| @nestjs/\*                   | 12.0.3      | No stable Sentry release supports NestJS 12.                           |
| @sentry/nestjs, @sentry/node | 10.75.0     | Blocked with NestJS 12. They must move together.                       |
| prisma, @prisma/client       | 8.0.0-rc.15 | A release candidate. Take 7.10.0 stable instead.                       |

## Can an override lift an exclusion?

An npm `overrides` entry rewrites which version npm installs. It does not change the
calling code. It therefore fixes a declared range that is too conservative. It cannot
fix a real API break. Each exclusion was triaged against that test.

**typescript 7.0.2 — no override is possible.** The package ships no importable API.

```
npm view typescript@7.0.2   ->  main: (empty)              bin: { tsc }
npm view typescript@5.9.3   ->  main: ./lib/typescript.js  bin: { tsc, tsserver }
```

There is no `lib/typescript.js` and no `tsserver`. `@angular/compiler-cli` and Nx both
call `import ts from 'typescript'` to build a `ts.Program`. Those imports would resolve
to nothing. TypeScript 7.0.2 is a compiler executable, not a library.

**NestJS 12 — an override is the wrong tool, because a correct release exists.**

```
npm view @sentry/nestjs@11.0.0-rc.0 peerDependencies
  "@nestjs/core": "^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0 || ^12.0.0"
```

Sentry 11 supports NestJS 12 directly. Forcing Sentry 10 past its range would be worse,
because the Sentry Nest integration patches `@nestjs/core` internals. Sentry 11 is a
release candidate, and the user declined release candidates on 2026-09-21. NestJS 12
and Sentry move together in a follow-up task, once Sentry 11 is stable.

The NestJS satellite packages do not need to wait:

```
npm view @nestjs/config@12.0.0 peerDependencies
  "@nestjs/common": "^11.0.0 || ^12.0.0"
```

**@huggingface/transformers — under investigation.** This is a real override candidate.
See `research-kokoro-override.md`.

`npm view @sentry/nestjs@10.75.0 peerDependencies` returns
`"@nestjs/core": "^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0"`. `@nestjs/core@12.0.3`
requires `@nestjs/common: ^12.0.0`. Only `@sentry/nestjs@11.0.0-rc.0` supports NestJS
12, and it is a release candidate. NestJS and Sentry move together in a later task.

## Pin lift is clear

`npm view @anthropic-ai/claude-agent-sdk@0.3.150` and `@0.3.278` both return
`"zod": "^4.0.0"`. The range did not change. zod 4.6.5 satisfies it, so the
`overrides` entry forcing `zod: ^4.1.12` inside the SDK is redundant and is deleted.
Blast radius of the SDK upgrade is 12 files, with one type chokepoint.
