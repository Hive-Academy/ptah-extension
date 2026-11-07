---
id: TASK_2026_302
status: backlog
type: bugfix
title: >-
  Make DI phase registration importable under Jest
updated: 2026-11-07T00:00:00.000Z
description: >-
  `apps/ptah-electron/src/di/phase-2-libraries.ts` and `libs/backend/cli-engine/src/lib/container.ts`
  throw at module evaluation under Jest, so override specs pin call sites by reading source
  text. Remove the import-time weight so specs can call the real registration functions.
---

# DI phase registration is unimportable under Jest; override specs mirror instead of import

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Importing either registration module pulls `persistence-sqlite` (better-sqlite3),
`memory-curator`, `messaging-gateway` and similar libs, which do not load in a Jest process.
So the specs cannot call the real registration path, and an edit to the real override lines
cannot fail them. Remaining work:

- Remove the import-time weight from `apps/ptah-electron/src/di/phase-2-libraries.ts` and
  `libs/backend/cli-engine/src/lib/container.ts` (for example, lazy `require` or moving native
  loads behind factories), so both modules import cleanly under Jest.
- Rewrite `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts` and
  `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts` to call the real
  registration functions instead of reading their source.
- Check whether `container.smoke.spec.ts` and `bootstrap/with-engine.spec.ts` can then use the
  real registration path.

## Current state (2026-11-07)

- Not fixed. `phase-2-diagnostics-override.spec.ts:12-18` still says
  `require('./phase-2-libraries')` throws under Jest, and the call site "is pinned by reading
  its source".
- `container-diagnostics-override.spec.ts:16` uses the same source-pinning workaround.
- The specs no longer mirror the override snippet verbatim; they read the source text. Drift in
  the surrounding registration code is still not caught.
- `cli-engine` is kept for provider CLI lanes, so it stays in scope.
